import { loadPromptWithBlocks } from './prompts.mjs';
import { setupVars, renderPair } from './agents-common.mjs';
import { Character, CharacterRelation, Chapter, ChapterDesign, Continuation, PublishMeta, StyleGuide, Volume, chapterBodyCjkCount, chapterBodyIssue, nowIso } from './state.mjs';
import { DEFAULT_ANTI_AI_TELLS } from './blocks.mjs';
import { LIMITS as FANQIE_LIMITS, MAIN_CATEGORIES, PLOTS, ROLES, THEMES, fanqieValidIds } from './services/fanqie_tags.mjs';

const P = (name) => loadPromptWithBlocks(name);

// ---------- output parsers ----------
function mergeTells(extra = []) {
  const out = [];
  const seen = new Set();
  for (const t of [...DEFAULT_ANTI_AI_TELLS, ...(Array.isArray(extra) ? extra : [])]) {
    const s = String(t || '').trim();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

function parseCards(md, tier) {
  const cards = [];
  const parts = String(md || '').split(/^##\s+/mu);
  for (const part of parts.slice(1)) {
    const [firstLine = '', ...rest] = part.split('\n');
    const name = firstLine.split('（')[0].split('(')[0].trim();
    if (!name) continue;
    cards.push(new Character({
      name, tier,
      raw_card: `## ${firstLine.trim()}\n${rest.join('\n').replace(/\s+$/u, '')}`,
    }));
  }
  return cards;
}

function parseRelations(md) {
  const rels = [];
  const re = /^-\s*(.+?)\s*与\s*(.+?)[:：]\s*(.+?)(?:\s*[—-]\s*(.+))?$/u;
  for (const line of String(md || '').split(/\r?\n/u)) {
    const m = line.trim().match(re);
    if (!m) continue;
    rels.push(new CharacterRelation({
      a: m[1].trim(), b: m[2].trim(),
      relation: m[3].trim(), description: (m[4] || '').trim(),
    }));
  }
  return rels;
}

function parseChapterDesigns(md) {
  const out = [];
  const markdownHeading = /^\s*#{1,6}\s*(?:[-*]\s*)?(?:\*\*)?第?\s*(\d+)\s*[章节回]?\s*(?:\*\*)?\s*[：:、.\-\s]*(.*?)\s*(?:\*\*)?\s*$/u;
  const chineseHeading = /^\s*(?:[-*]\s*)?(?:\*\*)?第\s*(\d+)\s*[章节回]\s*(?:\*\*)?\s*[：:、.\-\s]*(.*?)\s*(?:\*\*)?\s*$/u;
  let current = null;
  for (const line of String(md || '').split(/\r?\n/u)) {
    const m = line.match(markdownHeading) || line.match(chineseHeading);
    if (m) {
      if (current) out.push(current);
      current = { order: Number(m[1]), title: (m[2] || '').replace(/\*\*/gu, '').trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) out.push(current);
  return out.map((section) => {
    const raw = section.lines.join('\n').trim();
    return new ChapterDesign({
      order: section.order,
      title: section.title || null,
      raw,
    });
  }).sort((a, b) => a.order - b.order);
}

function lengthRevisionNotes(issue, cjk, setup) {
  const min = Number(setup?.per_chapter_min || 0);
  const max = Number(setup?.per_chapter_max || min);
  const target = setup?.per_chapter_target || Math.floor((min + max) / 2);
  if (/too short/u.test(issue)) {
    const stretchTarget = Math.min(max, Math.max(target, min + Math.floor((max - min) * 0.7)));
    const need = Math.max(600, stretchTarget - cjk);
    return [
      `当前正文约 ${cjk} 个中文正文字符，低于最低 ${min}。`,
      `请在不改变主线事件的前提下，至少补充 ${need} 个中文正文字符，最终控制在 ${min}-${max}，优先贴近 ${stretchTarget}，不要只贴着最低线补写。`,
      '补写只能扩展本章分章设计与原文已经出现的场景、动作、对话和即时反应；禁止新增场景、人物、设定、时间跳跃或支线事件来凑字数。',
      '优先扩写：关键动作过程、对话交锋、诊疗/推理/决策细节、人物即时反应；禁止水文、禁止重复上一段信息。',
    ].join('\n');
  }
  if (/too long/u.test(issue)) {
    const cut = Math.max(300, cjk - max + 200);
    return [
      `当前正文约 ${cjk} 个中文正文字符，超过最高 ${max}。`,
      `请在保留主线事件完整的前提下，至少删减 ${cut} 个中文正文字符，最终控制在 ${min}-${max}，尽量贴近 ${target}。`,
      '优先删除：重复解释、环境铺陈、旁支细节、同义反复；保留冲突推进和结尾钩子。',
    ].join('\n');
  }
  return [
    `当前正文无效：${issue}`,
    `请重新输出完整正文，最终控制在 ${min}-${max} 个中文正文字符之间，尽量贴近 ${target}。`,
    '只输出正文，不要标题、字数统计、JSON、元信息或解释。',
  ].join('\n');
}

function knownCharactersText(state) {
  const names = state.allCharacters().map((c) => c.name).filter(Boolean);
  return names.length ? names.join('、') : '（暂无已知角色）';
}

function openHooksText(state, order = null) {
  const hooks = state.openHooks(order);
  if (!hooks.length) return '（暂无开放伏笔）';
  return hooks.map((h) => `- ${h.id}: ${h.text}（第${h.planted_chapter}章埋下，half_life=${h.half_life}）`).join('\n');
}

function chapterQaVars(state, chapter) {
  const order = Number(chapter.order || 0);
  return setupVars(state, {
    chapter_order: order,
    chapter_title: chapter.design?.title || '',
    chapter_design_text: state.chapterDesignTextFor(order) || chapter.design?.raw || '',
    current_chapter: chapter.body || '',
    chapter_excerpt: chapter.body || '',
    known_characters: knownCharactersText(state),
    open_hooks_text: openHooksText(state, order),
    prev_chapter_block: state.prevChapterEnding(order),
    recent_summaries_block: state.recentChapterSummaries(),
    arcs: state.arcs || '',
  });
}

function normalizeSeverity(report) {
  return ['ok', 'warn', 'error'].includes(report?.severity) ? report.severity : 'ok';
}

function hardLintChapter(state, chapter) {
  const issues = [];
  const order = Number(chapter.order || 0);
  for (const h of state.openHooks(order)) {
    const planted = Number(h.planted_chapter || 0);
    const halfLife = Math.max(1, Number(h.half_life || 10));
    if (planted > 0 && order - planted > halfLife) {
      issues.push({
        severity: 'warn',
        rule: 'hook_expired',
        message: `伏笔 ${h.id} 已超过 half_life=${halfLife}（种于第 ${planted} 章；本章为第 ${order} 章）`,
      });
    }
  }
  return issues;
}

function collectQaFixHints(reports = {}) {
  const lines = [];
  for (const [name, report] of Object.entries(reports)) {
    if (name === 'hard_lint' || name === 'literary' || name === 'wordcount' || name === 'auto_revise') continue;
    if (normalizeSeverity(report) !== 'error') continue;
    for (const issue of report.issues || []) {
      const hint = String(issue.fix_hint || '').trim();
      if (hint) lines.push(`- [${name}/${issue.kind || '问题'}] ${hint}`);
    }
  }
  return lines;
}

function upsertRelation(list, relation) {
  const rel = new CharacterRelation(relation);
  if (!rel.a || !rel.b || !rel.relation) return null;
  const key = (r) => [r.a, r.b, r.relation, r.description].map((x) => String(x || '').trim()).join('\u0001');
  if (!list.some((r) => key(r) === key(rel))) list.push(rel);
  return rel;
}

function applyChapterExtract(state, chapter, data = {}) {
  const literary = data.literary || {};
  chapter.qa_reports = { ...(chapter.qa_reports || {}), literary };
  if (literary.summary) chapter.summary = String(literary.summary).trim();

  const known = new Set(state.allCharacters().map((c) => c.name).filter(Boolean));
  const added = [];
  for (const raw of data.new_characters || []) {
    const name = String(raw?.name || '').trim();
    if (!name || known.has(name)) continue;
    const card = new Character({
      ...raw,
      name,
      tier: raw.tier === 'secondary' ? 'secondary' : 'minor',
      role: String(raw.role || raw.tier || '新出场角色'),
      first_chapter: chapter.order,
      raw_card: [
        `## ${name}`,
        `- 层级：${raw.tier === 'secondary' ? '次要' : '小角色'}`,
        raw.role ? `- 角色定位：${raw.role}` : '',
        raw.personality_hint ? `- 性格线索：${raw.personality_hint}` : '',
        raw.first_appearance_excerpt ? `- 首次出场：${raw.first_appearance_excerpt}` : '',
      ].filter(Boolean).join('\n'),
    });
    state.secondary_characters.push(card);
    chapter.new_characters.push(card);
    known.add(name);
    added.push(card);
  }

  const deltas = [];
  for (const raw of [...(data.relations || []), ...(data.relation_deltas || [])]) {
    const relation = upsertRelation(state.relations, {
      a: String(raw?.a || '').trim(),
      b: String(raw?.b || '').trim(),
      relation: String(raw?.relation || raw?.change || '').trim(),
      description: String(raw?.description || raw?.evidence || '').trim(),
    });
    if (relation) deltas.push(relation);
  }
  chapter.relations_delta = deltas;

  for (const h of literary.hook_plants || []) {
    const id = String(h?.id || '').trim();
    const text = String(h?.text || '').trim();
    if (id && text) state.plantHook({ id, text, planted_chapter: chapter.order, half_life: Number(h.half_life || 10) });
  }
  for (const id of literary.hook_resolves || []) {
    state.resolveHook(String(id || '').trim(), chapter.order);
  }
  return { added, deltas };
}

async function extractChapterSignals(state, llm, chapter) {
  if (typeof llm.chatJson !== 'function') return chapter;
  const vars = chapterQaVars(state, chapter);
  const [sys, usr] = renderPair('', P('qa/chapter_extract'), vars);
  const data = await llm.chatJson(sys, usr, { agentName: `chapter_extract[${chapter.order}]` });
  applyChapterExtract(state, chapter, data);
  return chapter;
}

async function runChapterQaChecks(state, llm, chapter) {
  if (typeof llm.chatJson !== 'function') return chapter.qa_reports || {};
  const vars = chapterQaVars(state, chapter);
  const reports = {
    ...(chapter.qa_reports || {}),
    hard_lint: hardLintChapter(state, chapter),
  };
  for (const [key, promptName] of [
    ['arc', 'qa/arc_analyzer'],
    ['foreshadow', 'qa/foreshadow_tracker'],
    ['plot_coherence', 'qa/plot_coherence'],
  ]) {
    const [sys, usr] = renderPair('', P(promptName), vars);
    reports[key] = await llm.chatJson(sys, usr, { agentName: `${key}[${chapter.order}]` });
  }
  chapter.qa_reports = reports;
  return reports;
}

// ---------- setup-phase agents ----------
export async function styleGuideAgent(state, llm) {
  const [sys, usr] = renderPair(P('style_guide/system'), P('style_guide/user'), setupVars(state));
  const data = await llm.chatJson(sys, usr, { agentName: 'style_guide' });
  state.style_guide = new StyleGuide({
    role: String(data.role || ''),
    context: String(data.context || ''),
    task: String(data.task || ''),
    constraint: String(data.constraint || ''),
  });
  state.setup.anti_ai_tells = mergeTells(data.anti_ai_tells);
  return state;
}

export async function themeAgent(state, llm) {
  const [sys, usr] = renderPair(P('theme/system'), P('theme/user'), setupVars(state));
  state.philosophical_theme = await llm.chat(sys, usr, { agentName: 'theme' });
  return state;
}

export async function worldAgent(state, llm) {
  const [sys, usr] = renderPair(P('world/system'), P('world/user'), setupVars(state));
  state.world_building = await llm.chat(sys, usr, { agentName: 'world', longForm: true });
  return state;
}

export async function outlineAgent(state, llm) {
  const [sys, usr] = renderPair(P('outline/system'), P('outline/user'), setupVars(state));
  state.outline = await llm.chat(sys, usr, { agentName: 'outline', longForm: true });
  return state;
}

export async function volumeAgent(state, llm) {
  const [sys, usr] = renderPair(P('volume/system'), P('volume/user'), setupVars(state));
  const data = await llm.chatJson(sys, usr, { agentName: 'volume' });
  state.volumes = (data.volumes || []).map((v, i) => new Volume({
    order: Number(v.order || i + 1),
    title: String(v.title || `卷${i + 1}`),
    summary: String(v.summary || ''),
    chapter_range: v.chapter_range || [1, state.setup.target_chapters],
  }));
  return state;
}

export async function mainCharsAgent(state, llm) {
  const [sys, usr] = renderPair(P('characters/main_chars_system'), P('characters/main_chars_user'), setupVars(state));
  state.main_characters = parseCards(await llm.chat(sys, usr, { agentName: 'main_chars' }), 'main');
  return state;
}

export async function secondaryCharsAgent(state, llm) {
  const [sys, usr] = renderPair(P('characters/secondary_chars_system'), P('characters/secondary_chars_user'), setupVars(state));
  state.secondary_characters = parseCards(await llm.chat(sys, usr, { agentName: 'secondary_chars' }), 'secondary');
  return state;
}

export async function relationsAgent(state, llm) {
  const [sys, usr] = renderPair(P('characters/relations_system'), P('characters/relations_user'), setupVars(state));
  state.relations = parseRelations(await llm.chat(sys, usr, { agentName: 'relations' }));
  return state;
}

export async function mainArcsAgent(state, llm) {
  const [sys, usr] = renderPair(P('characters/main_arcs_system'), P('characters/main_arcs_user'), setupVars(state));
  const md = await llm.chat(sys, usr, { agentName: 'main_arcs' });
  state.arcs = state.arcs ? `${state.arcs}\n\n${md}` : md;
  return state;
}

export async function secondaryArcsAgent(state, llm) {
  const [sys, usr] = renderPair(P('characters/secondary_arcs_system'), P('characters/secondary_arcs_user'), setupVars(state));
  const md = await llm.chat(sys, usr, { agentName: 'secondary_arcs' });
  state.arcs = state.arcs ? `${state.arcs}\n\n${md}` : md;
  return state;
}

export async function bookTitleAgent(state, llm) {
  const outline_snippet = state.outline ? String(state.outline).slice(0, 1000) : '（未生成大纲）';
  const [sys, usr] = renderPair(P('title/book_title_system'), P('title/book_title_user'), setupVars(state, { outline_snippet }));
  const raw = await llm.chat(sys, usr, { agentName: 'book_title' });
  state.titles_proposed = raw.split(/\r?\n/u)
    .map((s) => s.replace(/^[-\d.、\s]+/u, '').trim())
    .filter(Boolean);
  if (!state.setup.title && state.titles_proposed[0]) state.setup.title = state.titles_proposed[0];
  return state;
}

// ---------- design + write + finalize agents ----------
export async function chapterDesignFullAgent(state, llm) {
  const [sys, usr] = renderPair(P('chapter_design/full_system'), P('chapter_design/full_user'), setupVars(state));
  const md = await llm.chat(sys, usr, { agentName: 'chapter_design_full', longForm: true });
  state.chapter_designs = parseChapterDesigns(md);
  state.assertChapterDesignsReady({ toChapter: state.setup.target_chapters });
  return state;
}

export async function chapterDesignRangeAgent(state, llm, { startChapter, endChapter } = {}) {
  const start = Math.max(1, Number(startChapter || 1));
  const end = Math.max(start, Number(endChapter || start));
  const vars = setupVars(state, {
    start_chapter: start,
    end_chapter: end,
    batch_count: end - start + 1,
    previous_designs: state.chapterDesignsText({ beforeChapter: start, limit: 5 }) || '（暂无前置分章设计）',
  });
  const [sys, usr] = renderPair(P('chapter_design/range_system'), P('chapter_design/range_user'), vars);
  const md = await llm.chat(sys, usr, { agentName: `chapter_design_range[${start}-${end}]`, longForm: true });
  const designs = parseChapterDesigns(md);
  const outOfRange = designs.filter((d) => d.order < start || d.order > end).map((d) => d.order);
  if (outOfRange.length) {
    throw new Error(`chapter design range ${start}-${end} returned out-of-range chapters: ${outOfRange.join(', ')}`);
  }
  const seen = new Set();
  const duplicates = [];
  for (const d of designs) {
    if (seen.has(d.order)) duplicates.push(d.order);
    seen.add(d.order);
  }
  const missing = [];
  const empty = [];
  for (let order = start; order <= end; order += 1) {
    const design = designs.find((d) => d.order === order);
    if (!design) missing.push(order);
    else if (!String(design.raw || design.plot || design.highlight || '').trim()) empty.push(order);
  }
  const parts = [];
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (empty.length) parts.push(`empty: ${empty.join(', ')}`);
  if (duplicates.length) parts.push(`duplicates: ${duplicates.join(', ')}`);
  if (parts.length) {
    throw new Error(`chapter design range ${start}-${end} invalid (${parts.join('; ')})`);
  }
  state.replaceChapterDesignRange(start, end, designs);
  state.assertChapterDesignsReady({ fromChapter: start, toChapter: end });
  return state;
}

export async function chapterBodyAgent(state, llm, order) {
  const design = state.chapterDesignFor(order);
  const designText = state.chapterDesignTextFor(order);
  if (!design || !designText) {
    throw new Error(`chapter ${order} has no chapter design; run/fix design generation before writing`);
  }
  const vars = setupVars(state, {
    chapter_order: order,
    chapter_order_next: order + 1,
    chapter_title: design.title || '',
    chapter_design_text: designText,
    progress_context: `第${order}/${state.setup.target_chapters}章`,
    prev_chapter_block: state.prevChapterEnding(order),
    recent_summaries_block: state.recentChapterSummaries(),
    open_hooks_block: state.openHooks(order).map((h) => `- ${h.id}: ${h.text}`).join('\n'),
    relations_block: '',
    arcs_block: state.arcs,
  });
  const [sys, usr] = renderPair(P('chapter/system_base'), P('chapter/user'), vars);
  const reviseSysTemplate = P('chapter/revise_system');
  const reviseUsrTemplate = P('chapter/revise_user');
  const attempts = 8;
  let lastIssue = '';
  let lastBody = '';
  let lastCjk = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const canRevise = attempt > 1 && lastBody.trim() && !/empty body|CLI result envelope/u.test(lastIssue);
    const [attemptSys, attemptUsr] = canRevise
      ? renderPair(reviseSysTemplate, reviseUsrTemplate, {
          ...vars,
          original_body: lastBody,
          revision_notes: lengthRevisionNotes(lastIssue, lastCjk, state.setup),
        })
      : [sys, `${usr}${lastIssue ? `\n\n【上一次正文无效，必须重新生成】\n失败原因：${lastIssue}\n${lengthRevisionNotes(lastIssue, lastCjk, state.setup)}` : ''}`];
    const body = canRevise
      ? await llm.chat(attemptSys, attemptUsr, { agentName: `chapter_body_revise_${attempt}`, longForm: true })
      : await llm.chat(
          attemptSys,
          attemptUsr,
          { agentName: attempt === 1 ? 'chapter_body' : `chapter_body_retry_${attempt}`, longForm: true },
        );
    const cjk = chapterBodyCjkCount(body);
    const chapter = new Chapter({ order, design, body, word_count: cjk });
    const issue = chapterBodyIssue(chapter, state.setup, { strictRange: true });
    if (!issue) {
      state.chapters = state.chapters.filter((c) => c.order !== order);
      state.chapters.push(chapter);
      state.chapters.sort((a, b) => a.order - b.order);
      return state;
    }
    lastIssue = issue;
    lastBody = body;
    lastCjk = cjk;
  }
  throw new Error(`chapter ${order} body invalid after ${attempts} attempts: ${lastIssue}`);
}

export async function chapterPostprocessAgent(state, llm, order) {
  let chapter = state.chapters.find((c) => c.order === order);
  if (!chapter) throw new Error(`chapter ${order} not found for postprocess`);

  const maxQaRevisions = typeof llm.chatJson === 'function' ? 2 : 0;

  for (let attempt = 0; attempt <= maxQaRevisions; attempt += 1) {
    const reports = await runChapterQaChecks(state, llm, chapter);
    const fixHints = collectQaFixHints(reports);
    if (!fixHints.length) {
      await extractChapterSignals(state, llm, chapter);
      return state;
    }
    if (attempt === maxQaRevisions) {
      throw new Error(`chapter ${order} failed QA after ${maxQaRevisions} revisions: ${fixHints.join(' ')}`);
    }

    const vars = setupVars(state, {
      chapter_order: order,
      chapter_title: chapter.design?.title || '',
      chapter_design_text: state.chapterDesignTextFor(order) || chapter.design?.raw || '',
      original_body: chapter.body,
      revision_notes: [
        '以下是审稿发现的硬伤，必须修正；保持原主线、人物身份、生死状态和章节结尾钩子。',
        ...fixHints,
        `修订后仍必须落入 ${state.setup.per_chapter_min}-${state.setup.per_chapter_max} 个中文正文字符。`,
      ].join('\n'),
    });
    const [sys, usr] = renderPair(P('chapter/revise_system'), P('chapter/revise_user'), vars);
    const revised = await llm.chat(sys, usr, { agentName: `chapter_qa_revise_${attempt + 1}[${order}]`, longForm: true });
    const revisedChapter = new Chapter({
      ...chapter,
      body: revised,
      word_count: chapterBodyCjkCount(revised),
      revisions: [...(chapter.revisions || []), chapter.body],
      qa_reports: {},
      new_characters: [],
      relations_delta: [],
    });
    const issue = chapterBodyIssue(revisedChapter, state.setup, { strictRange: true });
    if (issue) throw new Error(`chapter ${order} QA revision invalid: ${issue}`);
    const index = state.chapters.findIndex((c) => c.order === order);
    state.chapters[index] = revisedChapter;
    chapter = revisedChapter;
  }
  return state;
}

export async function coverAgent(state, llm) {
  const [sys, usr] = renderPair(P('cover/system'), P('cover/user'), setupVars(state));
  state.cover_prompt = await llm.chat(sys, usr, { agentName: 'cover' });
  return state;
}

export async function coverImageAgent(state, llm, { outputPath, aspectRatio = '3:4' }) {
  if (!state.cover_prompt || !state.cover_prompt.trim()) await coverAgent(state, llm);
  const title = state.setup.title || state.titles_proposed?.[0] || '';
  const finalPath = await llm.generateImage(state.cover_prompt, outputPath, {
    title, aspectRatio, agentName: 'cover_image',
  });
  state.cover_image_path = String(finalPath);
  return finalPath;
}

// ---------- publish_meta helpers + agent ----------
function clipList(items, { max_len, max_item } = {}) {
  const out = [];
  const seen = new Set();
  for (const x of items || []) {
    if (typeof x !== 'string') continue;
    let s = x.trim();
    if (!s) continue;
    if (max_item) s = s.slice(0, max_item);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (max_len && out.length >= max_len) break;
  }
  return out;
}

function intersect(items, allowed) {
  return items.filter((x) => allowed.has(x));
}

export async function publishMetaAgent(description, llm, { audienceHint = '' } = {}) {
  const vars = {
    description: String(description || '').trim(),
    audience_hint: audienceHint,
    main_categories: MAIN_CATEGORIES,
    themes: THEMES,
    roles: ROLES,
    plots: PLOTS,
  };
  const [sys, usr] = renderPair(P('publish_meta/system'), P('publish_meta/user'), vars);
  const data = await llm.chatJson(sys, usr, { agentName: 'publish_meta' });
  const valid = fanqieValidIds();
  const book_name = String(data.book_name || '').trim().slice(0, FANQIE_LIMITS.book_name_max);
  const candidates = clipList(data.title_candidates || [book_name], {
    max_len: 5, max_item: FANQIE_LIMITS.book_name_max,
  });
  if (book_name && !candidates.includes(book_name)) candidates.unshift(book_name);
  return new PublishMeta({
    book_name,
    title_candidates: candidates,
    audience: ['male', 'female'].includes(data.audience) ? data.audience : (audienceHint || 'male'),
    main_category: valid.main_category.has(String(data.main_category || '')) ? String(data.main_category) : '',
    themes: intersect(clipList(data.themes, { max_len: FANQIE_LIMITS.theme[1] }), valid.theme),
    roles: intersect(clipList(data.roles, { max_len: FANQIE_LIMITS.role[1] }), valid.role),
    plots: intersect(clipList(data.plots, { max_len: FANQIE_LIMITS.plot[1] }), valid.plot),
    protagonists: clipList(data.protagonists, { max_len: 2, max_item: FANQIE_LIMITS.protagonist_max }),
    synopsis: String(data.synopsis || '').trim(),
    generated_at: new Date().toISOString(),
    locked: false,
  });
}

// ---------- continuation agents ----------

export function ensureContinuation(state, newTarget) {
  const writtenMax = state.chapters
    .filter((c) => c.body && c.body.trim())
    .reduce((m, c) => Math.max(m, c.order), 0);
  const prevTarget = Math.max(Number(state.setup.target_chapters || 0), writtenMax, 0);
  const nt = Number(newTarget);
  if (!Number.isFinite(nt) || nt <= prevTarget) {
    throw new Error(`new target ${newTarget} must exceed current ${prevTarget}`);
  }
  const existing = state.continuations.find(
    (c) => c.from_chapter === prevTarget + 1 && c.to_chapter === nt,
  );
  if (existing) return { cont: existing, prevTarget, isNew: false };
  const cont = new Continuation({
    order: state.continuations.length + 1,
    from_chapter: prevTarget + 1,
    to_chapter: nt,
    prev_target: prevTarget,
    created_at: nowIso(),
  });
  state.continuations.push(cont);
  return { cont, prevTarget, isNew: true };
}

function writtenSummariesText(state, throughChapter) {
  const lines = [];
  for (const ch of state.chapters
    .filter((c) => c.order <= throughChapter)
    .sort((a, b) => a.order - b.order)) {
    const title = ch.design?.title || '';
    const summary = (ch.summary || '').trim()
      || (ch.design?.raw || '').slice(0, 400).trim()
      || (ch.body || '').slice(0, 400).trim();
    lines.push(`## 第${ch.order}章 ${title}\n${summary}`);
  }
  return lines.join('\n\n');
}

export async function priorSummaryAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('priorSummaryAgent requires continuation');
  if (continuation.prev_summary && continuation.prev_summary.trim()) return state;
  const lastOrder = continuation.prev_target;
  const lastChapter = state.chapters.find((c) => c.order === lastOrder);
  const vars = setupVars(state, {
    written_summaries: writtenSummariesText(state, lastOrder) || '（无可用章节摘要）',
    last_chapter_tail: (lastChapter?.body || '').slice(-600) || '（无）',
  });
  const [sys, usr] = renderPair(
    P('continuation/prior_summary/system'),
    P('continuation/prior_summary/user'),
    vars,
  );
  const text = await llm.chat(sys, usr, { agentName: 'prior_summary', longForm: true });
  continuation.prev_summary = String(text || '').trim();
  if (!continuation.prev_summary) throw new Error('priorSummaryAgent returned empty summary');
  return state;
}

export async function continuationOutlineAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('continuationOutlineAgent requires continuation');
  if (continuation.outline && continuation.outline.trim()) return state;
  const vars = setupVars(state, {
    prev_summary: continuation.prev_summary,
    continuation_from: continuation.from_chapter,
    continuation_to: continuation.to_chapter,
    continuation_count: continuation.to_chapter - continuation.from_chapter + 1,
    target_chapters: continuation.to_chapter,
  });
  const [sys, usr] = renderPair(
    P('continuation/outline/system'),
    P('continuation/outline/user'),
    vars,
  );
  continuation.outline = await llm.chat(sys, usr, { agentName: 'continuation_outline', longForm: true });
  if (!continuation.outline.trim()) throw new Error('continuationOutlineAgent returned empty outline');
  return state;
}

export async function continuationVolumeAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('continuationVolumeAgent requires continuation');
  if (continuation.volumes?.length) return state;
  const vars = setupVars(state, {
    continuation_outline: continuation.outline,
    continuation_from: continuation.from_chapter,
    continuation_to: continuation.to_chapter,
  });
  const [sys, usr] = renderPair(
    P('continuation/volume/system'),
    P('continuation/volume/user'),
    vars,
  );
  const data = await llm.chatJson(sys, usr, { agentName: 'continuation_volume' });
  continuation.volumes = (data.volumes || []).map((v, i) => new Volume({
    order: v.order || i + 1,
    title: v.title || `续集卷 ${i + 1}`,
    summary: v.summary || '',
    chapter_range: v.chapter_range || [continuation.from_chapter, continuation.to_chapter],
  }));
  if (!continuation.volumes.length) throw new Error('continuationVolumeAgent returned no volumes');
  return state;
}

export async function continuationArcsAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('continuationArcsAgent requires continuation');
  if (continuation.arcs && continuation.arcs.trim()) return state;
  const volumesText = (continuation.volumes || [])
    .map((v) => `- 卷${v.order} ${v.title}（${v.chapter_range[0]}-${v.chapter_range[1]}）：${v.summary}`)
    .join('\n');
  const vars = setupVars(state, {
    prev_summary: continuation.prev_summary,
    continuation_outline: continuation.outline,
    continuation_volumes_text: volumesText || '（无）',
    continuation_from: continuation.from_chapter,
    continuation_to: continuation.to_chapter,
  });
  const [sys, usr] = renderPair(
    P('continuation/arcs/system'),
    P('continuation/arcs/user'),
    vars,
  );
  continuation.arcs = await llm.chat(sys, usr, { agentName: 'continuation_arcs', longForm: true });
  if (!continuation.arcs.trim()) throw new Error('continuationArcsAgent returned empty arcs');
  return state;
}
