import path from 'node:path';
import { estimateEntryCost } from './services/costing.mjs';
import { NovelProject } from './project.mjs';
import { isChapterBodyValid } from './state.mjs';
import {
  bookTitleAgent, chapterBodyAgent, chapterDesignFullAgent, chapterDesignRangeAgent, coverAgent, coverImageAgent,
  mainArcsAgent, mainCharsAgent, outlineAgent, relationsAgent,
  secondaryArcsAgent, secondaryCharsAgent, styleGuideAgent, themeAgent, volumeAgent, worldAgent,
} from './agents.mjs';

export class PipelineOptions {
  constructor(data = {}) {
    Object.assign(this, {
      autosavePath: null,
      chapterCountOverride: null,
      chapterDesignBatchSize: 25,
      chapterDesignFullLimit: 80,
      generateCoverImage: false,
      controller: null,
    }, data);
  }
}

export class PipelineAbort extends Error {
  constructor() { super('pipeline aborted'); this.name = 'PipelineAbort'; }
}

// Cooperative pause/resume/abort gate. Orchestrator awaits `checkpoint()`
// between agents/chapters; UI flips pause/abort via runner.
export class PipelineController {
  constructor() {
    this._paused = false;
    this._aborted = false;
    this._abortController = new AbortController();
    this._waiters = [];
    this.hooks = {};
  }
  on(name, fn) { this.hooks[name] = fn; return this; }
  emit(name, payload = {}) { try { this.hooks[name]?.(payload); } catch {} }
  get paused() { return this._paused; }
  get aborted() { return this._aborted; }
  get signal() { return this._abortController.signal; }
  pause() { this._paused = true; this.emit('paused'); }
  resume() {
    this._paused = false;
    this._waiters.splice(0).forEach((w) => w());
    this.emit('resumed');
  }
  abort() {
    if (this._aborted) return;
    this._aborted = true;
    this._paused = false;
    this._abortController.abort();
    this._waiters.splice(0).forEach((w) => w());
  }
  async checkpoint() {
    if (this._aborted) throw new PipelineAbort();
    while (this._paused && !this._aborted) {
      await new Promise((resolve) => this._waiters.push(resolve));
    }
    if (this._aborted) throw new PipelineAbort();
  }
}

const SETUP_STEPS = [
  ['style_guide', styleGuideAgent],
  ['theme', themeAgent],
  ['world', worldAgent],
  ['outline', outlineAgent],
  ['volume', volumeAgent],
  ['main_chars', mainCharsAgent],
  ['secondary_chars', secondaryCharsAgent],
  ['relations', relationsAgent],
  ['main_arcs', mainArcsAgent],
  ['secondary_arcs', secondaryArcsAgent],
  ['book_title', bookTitleAgent],
];

function missingOrInvalidRanges(state, target) {
  const issues = state.chapterDesignIssues({ toChapter: target });
  const orders = [...new Set([...issues.missing, ...issues.empty, ...issues.duplicates])]
    .filter((n) => n >= 1 && n <= target)
    .sort((a, b) => a - b);
  if (!orders.length) return [];
  const ranges = [];
  let start = orders[0];
  let prev = orders[0];
  for (const order of orders.slice(1)) {
    if (order === prev + 1) {
      prev = order;
      continue;
    }
    ranges.push([start, prev]);
    start = order;
    prev = order;
  }
  ranges.push([start, prev]);
  return ranges;
}

export class Orchestrator {
  constructor(llm, options = new PipelineOptions()) {
    this.llm = llm;
    this.options = options instanceof PipelineOptions ? options : new PipelineOptions(options);
    this.controller = this.options.controller || null;
  }

  autosave(state) {
    if (this.options.autosavePath) new NovelProject(this.options.autosavePath).save(state);
  }

  async _runAgent(name, fn, state, extraArgs = []) {
    if (this.controller) {
      await this.controller.checkpoint();
      this.controller.emit('agent_started', { agent: name });
    }
    const before = this.llm.usageLog.length;
    try {
      await fn(state, this.llm, ...extraArgs);
      this.controller?.emit('agent_completed', { agent: name, usage_delta: this.llm.usageLog.slice(before) });
      this.autosave(state);
      this.controller?.emit('state_updated', {});
    } catch (e) {
      if (this.controller?.aborted) throw new PipelineAbort();
      if (e instanceof PipelineAbort) throw e;
      this.controller?.emit('agent_failed', { agent: name, error: String(e?.message || e) });
      throw e;
    }
  }

  async runSetup(state) {
    this.controller?.emit('phase_started', { phase: 'setup' });
    for (const [name, fn] of SETUP_STEPS) {
      // 书名已由主题/用户预设时跳过 AI 拟名，避免 UI 出现"未完成"幽灵。
      if (name === 'book_title' && state.setup.title?.trim()) continue;
      await this._runAgent(name, fn, state);
    }
    this.controller?.emit('phase_completed', { phase: 'setup' });
    return state;
  }

  async runDesign(state) {
    this.controller?.emit('phase_started', { phase: 'design' });
    const target = Number(state.setup.target_chapters || 0);
    const fullLimit = Number(this.options.chapterDesignFullLimit || 80);
    if (target > 0 && target <= fullLimit) {
      await this._runAgent('chapter_design_full', chapterDesignFullAgent, state);
    } else {
      await this.runDesignRanges(state);
    }
    this.controller?.emit('phase_completed', { phase: 'design' });
    return state;
  }

  async runDesignRanges(state) {
    const target = Number(state.setup.target_chapters || 0);
    if (!target) return state;
    const batchSize = Math.max(1, Number(this.options.chapterDesignBatchSize || 25));
    for (const [rangeStart, rangeEnd] of missingOrInvalidRanges(state, target)) {
      for (let start = rangeStart; start <= rangeEnd; start += batchSize) {
        const end = Math.min(rangeEnd, start + batchSize - 1);
        await this._runAgent(`chapter_design_range[${start}-${end}]`, chapterDesignRangeAgent, state, [{ startChapter: start, endChapter: end }]);
      }
    }
    state.assertChapterDesignsReady({ toChapter: target });
    return state;
  }

  async runChapters(state, { fromChapter = 1, toChapter = null } = {}) {
    this.controller?.emit('phase_started', { phase: 'write' });
    const end = Math.min(
      toChapter || state.setup.target_chapters,
      this.options.chapterCountOverride || Infinity,
    );
    state.assertChapterDesignsReady({ fromChapter, toChapter: end });
    const written = new Set(state.chapters.filter((c) => isChapterBodyValid(c, state.setup)).map((c) => c.order));
    for (let order = fromChapter; order <= end; order += 1) {
      if (written.has(order)) continue;
      state.chapters = state.chapters.filter((c) => c.order !== order);
      if (this.controller) {
        await this.controller.checkpoint();
        this.controller.emit('chapter_started', { order });
      }
      await this._runAgent('chapter_body', chapterBodyAgent, state, [order]);
      const ch = state.chapters.find((c) => c.order === order);
      this.controller?.emit('chapter_completed', { order, word_count: ch?.word_count || 0 });
    }
    this.controller?.emit('phase_completed', { phase: 'write' });
    return state;
  }

  async runFinalize(state) {
    this.controller?.emit('phase_started', { phase: 'finalize' });
    if (!state.setup.title?.trim()) await this._runAgent('book_title', bookTitleAgent, state);
    await this._runAgent('cover', coverAgent, state);
    if (this.options.generateCoverImage) await this.generateCoverImage(state);
    this.controller?.emit('phase_completed', { phase: 'finalize' });
    return state;
  }

  // Smart resume — picks up wherever the persisted state left off.
  // 一个偶然的"启动"点击不应该覆盖已生成的章节。
  async runAll(state) { return this.runResume(state); }

  async runResume(state) {
    const setupOk = state.style_guide != null
      && Boolean(state.philosophical_theme)
      && Boolean(state.world_building)
      && Boolean(state.outline)
      && state.main_characters.length > 0;
    if (!setupOk) await this.runSetup(state);

    const hasTitle = Boolean(state.setup.title?.trim()) || state.titles_proposed?.length > 0;
    if (hasTitle && !state.cover_prompt) await this._runAgent('cover', coverAgent, state);

    const target = state.setup.target_chapters || 0;
    const designIssues = state.chapterDesignIssues({ toChapter: target });
    if (state.chapter_designs.length < target || designIssues.missing.length || designIssues.empty.length || designIssues.duplicates.length) {
      await this.runDesign(state);
    }

    const effectiveTarget = this.options.chapterCountOverride
      ? Math.min(target, this.options.chapterCountOverride)
      : target;
    const nextChapter = state.firstUnwrittenOrInvalidChapter({ toChapter: effectiveTarget });
    if (nextChapter != null) await this.runChapters(state, { fromChapter: nextChapter, toChapter: effectiveTarget });

    const needFinalize = !hasTitle
      || !state.cover_prompt
      || (this.options.generateCoverImage && !state.cover_image_path);
    if (needFinalize) await this.runFinalize(state);
    return state;
  }

  coverImageOutputPath(state) {
    if (this.options.autosavePath) return path.join(this.options.autosavePath, 'cover.png');
    const raw = state.setup.title || state.titles_proposed?.[0] || 'novel';
    const safeTitle = raw.replace(/[^\w\-]/gu, '-').replace(/^-+|-+$/gu, '') || 'novel';
    return path.join('.runtime', 'covers', `${safeTitle.slice(0, 48)}-cover.png`);
  }

  // 封面落在项目目录内时只存文件名（如 "cover.png"），便于目录搬迁。
  normalizeCoverPath(raw) {
    if (!raw || !this.options.autosavePath) return raw;
    try {
      const rel = path.relative(path.resolve(this.options.autosavePath), path.resolve(raw));
      return rel.startsWith('..') ? raw : rel;
    } catch {
      return raw;
    }
  }

  async generateCoverImage(state, { logPrefix = 'cover image generation' } = {}) {
    if (this.controller) await this.controller.checkpoint();
    const coverPath = this.coverImageOutputPath(state);
    this.controller?.emit('cover_image_started', { path: coverPath, log_prefix: logPrefix });
    try {
      await coverImageAgent(state, this.llm, { outputPath: coverPath });
      state.cover_image_path = this.normalizeCoverPath(state.cover_image_path);
      this.autosave(state);
      this.controller?.emit('cover_image_completed', { path: state.cover_image_path, prompt: state.cover_prompt });
      this.controller?.emit('state_updated', {});
      return null;
    } catch (e) {
      this.controller?.emit('cover_image_failed', { error: String(e?.message || e) });
      return e;
    }
  }

  flushUsageToState(state) {
    state.cost_log.push(...this.llm.usageLog.map(estimateEntryCost));
  }
}
