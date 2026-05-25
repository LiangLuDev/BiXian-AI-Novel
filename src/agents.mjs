import { loadPromptWithBlocks } from './prompts.mjs';
import { setupVars, renderPair } from './agents-common.mjs';
import { Character, CharacterRelation, Chapter, ChapterDesign, PublishMeta, StyleGuide, Volume, chapterBodyCjkCount, chapterBodyIssue } from './state.mjs';
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
