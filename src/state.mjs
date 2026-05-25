export function nowIso() {
  return new Date().toISOString();
}

export class ProjectSetup {
  constructor(data = {}) {
    Object.assign(this, {
      title: null,
      description: '',
      genre: '通用',
      literary_style: '现代白话',
      narrative_time: '线性叙事',
      perspective: '第三人称',
      narrative_structure: ['三段式'],
      mood: '',
      era: '',
      protagonist: '',
      conflict: [],
      highlight: [],
      taboo: [],
      anti_ai_tells: [],
      custom_requirements: '',
      target_chapters: 50,
      target_word_count_wan: 30.0,
      per_chapter_min: 2500,
      per_chapter_max: 3500,
      opening_type: '',
      opening_hook: '',
      outline_type: '三段式',
      short_story: false,
      backend: 'codex',
      model: '',
      theme_id: null,
    }, data);
  }
  get per_chapter_target() {
    return Math.floor((this.per_chapter_min + this.per_chapter_max) / 2);
  }
  toJSON() { return { ...this }; }
}

export class StyleGuide {
  constructor(data = {}) { Object.assign(this, { role: '', context: '', task: '', constraint: '' }, data); }
  toBlock() {
    if (![this.role, this.context, this.task, this.constraint].some(Boolean)) return '';
    const lines = ['【作品宪章 / Style Guide】'];
    if (this.role) lines.push(`- 角色定位：${this.role}`);
    if (this.context) lines.push(`- 背景与约束：${this.context}`);
    if (this.task) lines.push(`- 创作目标：${this.task}`);
    if (this.constraint) lines.push(`- 硬性约束：${this.constraint}`);
    return lines.join('\n');
  }
  toJSON() { return { ...this }; }
}

export class Character {
  constructor(data = {}) { Object.assign(this, { name: '', tier: 'main', role: '', age: null, gender: null, appearance: '', personality: '', background: '', motivation: '', ability: '', speech_pattern: '', habits: '', fears: '', secret: '', arc: '', raw_card: '' }, data); }
  toJSON() { return { ...this }; }
}

export class CharacterRelation { constructor(data = {}) { Object.assign(this, { a: '', b: '', relation: '', description: '' }, data); } toJSON() { return { ...this }; } }
export class Volume { constructor(data = {}) { Object.assign(this, { order: 0, title: '', summary: '', chapter_range: [0, 0] }, data); } toJSON() { return { ...this }; } }
export class ChapterDesign { constructor(data = {}) { Object.assign(this, { order: 0, title: null, highlight: '', core_conflict: '', plot: '', emotional_tone: '', ending_hook: '', raw: '' }, data); } toJSON() { return { ...this }; } }
export class Hook { constructor(data = {}) { Object.assign(this, { id: '', text: '', planted_chapter: 0, half_life: 10, due_chapter: null, resolved_chapter: null }, data); } toJSON() { return { ...this }; } }
export class PublishMeta { constructor(data = {}) { Object.assign(this, { book_name: '', audience: '', main_category: '', themes: [], roles: [], plots: [], protagonists: [], synopsis: '', title_candidates: [], generated_at: null, locked: false }, data); } toJSON() { return { ...this }; } }

export class Chapter {
  constructor(data = {}) {
    Object.assign(this, { order: 0, design: new ChapterDesign(), body: '', word_count: 0, summary: '', new_characters: [], relations_delta: [], qa_reports: {}, revisions: [] }, data);
    this.design = new ChapterDesign(this.design);
    this.new_characters = (this.new_characters || []).map((c) => new Character(c));
    this.relations_delta = (this.relations_delta || []).map((r) => new CharacterRelation(r));
  }
  toJSON() { return { ...this }; }
}

export function chapterBodyCjkCount(body) {
  return [...String(body || '')].filter((c) => c >= '一' && c <= '鿿').length;
}

export function looksLikeCliResultEnvelope(body) {
  const raw = String(body || '').trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return false;
  try {
    const data = JSON.parse(raw);
    return data?.type === 'result'
      && Object.hasOwn(data, 'result')
      && Object.hasOwn(data, 'terminal_reason');
  } catch {
    return false;
  }
}

export function chapterBodyIssue(chapter, setup = {}, { strictRange = false } = {}) {
  const body = String(chapter?.body || '');
  if (!body.trim()) return 'empty body';
  if (looksLikeCliResultEnvelope(body)) return 'CLI result envelope saved instead of chapter text';
  const cjk = chapterBodyCjkCount(body);
  if (cjk <= 0) return 'no Chinese chapter text';
  if (!strictRange) return '';
  const min = Math.max(1, Number(setup?.per_chapter_min || 0));
  const max = Math.max(min, Number(setup?.per_chapter_max || min));
  if (cjk < min) return `too short: ${cjk} CJK chars (minimum ${min})`;
  if (cjk > max) return `too long: ${cjk} CJK chars (maximum ${max})`;
  return '';
}

export function isChapterBodyValid(chapter, setup = {}) {
  return !chapterBodyIssue(chapter, setup);
}

export class NovelState {
  constructor(data = {}) {
    Object.assign(this, {
      setup: new ProjectSetup(),
      publish_meta: null,
      style_guide: null,
      philosophical_theme: '',
      world_building: '',
      outline: '',
      volumes: [],
      main_characters: [],
      secondary_characters: [],
      relations: [],
      arcs: '',
      chapter_designs: [],
      chapters: [],
      hooks: [],
      titles_proposed: [],
      cover_prompt: '',
      cover_image_path: '',
      cost_log: [],
      created_at: nowIso(),
    }, data);
    this.setup = new ProjectSetup(this.setup);
    this.publish_meta = this.publish_meta ? new PublishMeta(this.publish_meta) : null;
    this.style_guide = this.style_guide ? new StyleGuide(this.style_guide) : null;
    this.volumes = (this.volumes || []).map((v) => new Volume(v));
    this.main_characters = (this.main_characters || []).map((c) => new Character(c));
    this.secondary_characters = (this.secondary_characters || []).map((c) => new Character(c));
    this.relations = (this.relations || []).map((r) => new CharacterRelation(r));
    this.chapter_designs = (this.chapter_designs || []).map((d) => new ChapterDesign(d));
    this.chapters = (this.chapters || []).map((c) => new Chapter(c));
    this.hooks = (this.hooks || []).map((h) => new Hook(h));
  }
  allCharacters() { return [...this.main_characters, ...this.secondary_characters]; }
  characterCardsMd() { return this.allCharacters().map((c) => c.raw_card).filter(Boolean).join('\n\n'); }
  recentChapterSummaries(n = 5) { return this.chapters.slice(-n).map((c) => `## 第${c.order}章 ${c.design.title || ''}\n${c.summary || c.body.slice(0, 300)}`).join('\n\n'); }
  prevChapterEnding(chapterOrder) { return this.chapters.find((c) => c.order === chapterOrder - 1)?.body.slice(-600) || ''; }
  openHooks(beforeChapter = null) { return this.hooks.filter((h) => h.resolved_chapter == null && (beforeChapter == null || h.planted_chapter <= beforeChapter)).sort((a, b) => a.planted_chapter - b.planted_chapter); }
  findHook(id) { return this.hooks.find((h) => h.id === id) || null; }
  plantHook({ id, text, planted_chapter, half_life = 10 }) { const existing = this.findHook(id); if (existing) return existing; const h = new Hook({ id, text, planted_chapter, half_life }); this.hooks.push(h); return h; }
  resolveHook(id, chapterOrder) { const h = this.findHook(id); if (h && h.resolved_chapter == null) h.resolved_chapter = chapterOrder; return h; }
  chapterDesignFor(order) { return this.chapter_designs.find((d) => d.order === order) || null; }
  replaceChapterDesignRange(fromChapter, toChapter, designs) {
    const start = Math.max(1, Number(fromChapter || 1));
    const end = Math.max(start, Number(toChapter || start));
    const replacements = (designs || []).map((d) => new ChapterDesign(d));
    const kept = this.chapter_designs.filter((d) => d.order < start || d.order > end);
    this.chapter_designs = [...kept, ...replacements].sort((a, b) => a.order - b.order);
    return this.chapter_designs;
  }
  chapterDesignsText({ beforeChapter = null, limit = 5 } = {}) {
    const before = beforeChapter == null ? Infinity : Number(beforeChapter);
    return this.chapter_designs
      .filter((d) => d.order < before && this.chapterDesignTextFor(d.order))
      .sort((a, b) => a.order - b.order)
      .slice(-Math.max(0, Number(limit || 0)))
      .map((d) => d.raw || `## 第${d.order}章：${d.title || ''}\n\n${d.plot || d.highlight || ''}`)
      .join('\n\n');
  }
  chapterDesignTextFor(order) {
    const d = this.chapterDesignFor(order);
    return d ? String(d.raw || d.plot || d.highlight || '').trim() : '';
  }
  chapterDesignIssues({ fromChapter = 1, toChapter = null } = {}) {
    const start = Math.max(1, Number(fromChapter || 1));
    const end = Math.max(start, Number(toChapter || this.setup.target_chapters || 0));
    const missing = [];
    const empty = [];
    const seen = new Map();
    const duplicates = [];
    for (const d of this.chapter_designs) {
      const order = Number(d.order || 0);
      if (!order) continue;
      const count = (seen.get(order) || 0) + 1;
      seen.set(order, count);
      if (count === 2) duplicates.push(order);
    }
    for (let order = start; order <= end; order += 1) {
      const design = this.chapterDesignFor(order);
      if (!design) missing.push(order);
      else if (!this.chapterDesignTextFor(order)) empty.push(order);
    }
    return { from: start, to: end, missing, empty, duplicates };
  }
  assertChapterDesignsReady({ fromChapter = 1, toChapter = null } = {}) {
    const issues = this.chapterDesignIssues({ fromChapter, toChapter });
    const parts = [];
    if (issues.missing.length) parts.push(`missing: ${summarizeOrders(issues.missing)}`);
    if (issues.empty.length) parts.push(`empty: ${summarizeOrders(issues.empty)}`);
    if (issues.duplicates.length) parts.push(`duplicates: ${summarizeOrders(issues.duplicates)}`);
    if (parts.length) {
      throw new Error(`chapter design coverage invalid for ${issues.from}-${issues.to} (${parts.join('; ')})`);
    }
    return true;
  }
  chapterBodyIssues({ fromChapter = 1, toChapter = null } = {}) {
    const start = Math.max(1, Number(fromChapter || 1));
    const end = Math.max(start, Number(toChapter || this.setup.target_chapters || 0));
    const missing = [];
    const invalid = [];
    const duplicates = [];
    const seen = new Map();
    for (const ch of this.chapters) {
      const order = Number(ch.order || 0);
      if (!order) continue;
      const count = (seen.get(order) || 0) + 1;
      seen.set(order, count);
      if (count === 2) duplicates.push(order);
    }
    for (let order = start; order <= end; order += 1) {
      const ch = this.chapters.find((c) => c.order === order);
      if (!ch) missing.push(order);
      else {
        const issue = chapterBodyIssue(ch, this.setup);
        if (issue) invalid.push({ order, issue });
      }
    }
    return { from: start, to: end, missing, invalid, duplicates };
  }
  firstUnwrittenOrInvalidChapter({ toChapter = null } = {}) {
    const end = Number(toChapter || this.setup.target_chapters || 0);
    for (let order = 1; order <= end; order += 1) {
      const ch = this.chapters.find((c) => c.order === order);
      if (!ch || chapterBodyIssue(ch, this.setup)) return order;
    }
    return null;
  }
  assertChapterBodiesReady({ fromChapter = 1, toChapter = null } = {}) {
    const issues = this.chapterBodyIssues({ fromChapter, toChapter });
    const parts = [];
    if (issues.missing.length) parts.push(`missing: ${summarizeOrders(issues.missing)}`);
    if (issues.invalid.length) parts.push(`invalid: ${issues.invalid.slice(0, 10).map((x) => `${x.order} (${x.issue})`).join(', ')}`);
    if (issues.duplicates.length) parts.push(`duplicates: ${summarizeOrders(issues.duplicates)}`);
    if (parts.length) {
      throw new Error(`chapter body coverage invalid for ${issues.from}-${issues.to} (${parts.join('; ')})`);
    }
    return true;
  }
}

function summarizeOrders(orders, limit = 20) {
  const list = [...new Set(orders)].sort((a, b) => a - b);
  const shown = list.slice(0, limit).join(', ');
  return list.length > limit ? `${shown}... (+${list.length - limit} more)` : shown;
}
