import { render } from './prompts.mjs';
import { customRequirementsBlock, eraVoiceLockBlock } from './blocks.mjs';

export function relationsMd(state) {
  if (!state.relations?.length) return '';
  return ['## 主线关系', ...state.relations.map((r) => `- ${r.a} 与 ${r.b}：${r.relation}${r.description ? ` — ${r.description}` : ''}`)].join('\n');
}

export function setupVars(state, extras = {}) {
  const s = state.setup;
  const sgBlock = state.style_guide?.toBlock?.() || '';

  // 续集路由：当 extras 指定 chapter_order/from_chapter 落入续集卷范围时，把
  // outline/arcs 切到续集版本，并暴露 prev_summary。
  const orderHint = Number(extras.chapter_order || extras.from_chapter || 0);
  const ctx = orderHint > 0 && typeof state.contextForChapter === 'function'
    ? state.contextForChapter(orderHint)
    : null;
  const outline = ctx && ctx.continuation ? ctx.outline : state.outline;
  const arcs = ctx && ctx.continuation ? ctx.arcs : (state.arcs || '');
  const prevSummary = ctx && ctx.continuation ? (ctx.prev_summary || '') : '';

  return {
    title: s.title || '未命名小说', description: s.description, genre: s.genre, literary_style: s.literary_style,
    narrative_time: s.narrative_time, perspective: s.perspective, narrative_structure: s.narrative_structure,
    mood: s.mood, era: s.era, protagonist: s.protagonist, conflict: s.conflict, highlight: s.highlight, taboo: s.taboo,
    custom_requirements: s.custom_requirements, custom_requirements_block: customRequirementsBlock(s.custom_requirements), era_voice_lock_block: eraVoiceLockBlock(s.era),
    target_chapters: s.target_chapters, target_word_count_wan: s.target_word_count_wan, per_chapter_min: s.per_chapter_min, per_chapter_max: s.per_chapter_max,
    per_chapter_target: s.per_chapter_target, outline_type: s.outline_type, opening_type: s.opening_type, opening_hook: s.opening_hook,
    philosophical_theme: state.philosophical_theme, world_building: state.world_building, outline,
    style_guide_block: sgBlock, style_guide_text: sgBlock || '（未生成宪章）',
    main_characters: state.main_characters.map((c) => c.raw_card).join('\n\n'), secondary_characters: state.secondary_characters.map((c) => c.raw_card).join('\n\n'),
    character_cards: state.characterCardsMd(), relations_text: relationsMd(state), arcs,
    arcs_block: arcs || '', relations_block: relationsMd(state) || '',
    prev_summary: prevSummary,
    prev_summary_block: prevSummary ? `【上一卷已发生事实（不可改写）】\n${prevSummary}` : '',
    ...extras,
  };
}

export function renderPair(systemTemplate, userTemplate, vars) { return [render(systemTemplate, vars), render(userTemplate, vars)]; }
