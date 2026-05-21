import { render } from './prompts.mjs';
import { customRequirementsBlock, eraVoiceLockBlock } from './blocks.mjs';

export function relationsMd(state) {
  if (!state.relations?.length) return '';
  return ['## 主线关系', ...state.relations.map((r) => `- ${r.a} 与 ${r.b}：${r.relation}${r.description ? ` — ${r.description}` : ''}`)].join('\n');
}

export function setupVars(state, extras = {}) {
  const s = state.setup;
  const sgBlock = state.style_guide?.toBlock?.() || '';
  return {
    title: s.title || '未命名小说', description: s.description, genre: s.genre, literary_style: s.literary_style,
    narrative_time: s.narrative_time, perspective: s.perspective, narrative_structure: s.narrative_structure,
    mood: s.mood, era: s.era, protagonist: s.protagonist, conflict: s.conflict, highlight: s.highlight, taboo: s.taboo,
    custom_requirements: s.custom_requirements, custom_requirements_block: customRequirementsBlock(s.custom_requirements), era_voice_lock_block: eraVoiceLockBlock(s.era),
    target_chapters: s.target_chapters, target_word_count_wan: s.target_word_count_wan, per_chapter_min: s.per_chapter_min, per_chapter_max: s.per_chapter_max,
    per_chapter_target: s.per_chapter_target, outline_type: s.outline_type, opening_type: s.opening_type, opening_hook: s.opening_hook,
    philosophical_theme: state.philosophical_theme, world_building: state.world_building, outline: state.outline,
    style_guide_block: sgBlock, style_guide_text: sgBlock || '（未生成宪章）',
    main_characters: state.main_characters.map((c) => c.raw_card).join('\n\n'), secondary_characters: state.secondary_characters.map((c) => c.raw_card).join('\n\n'),
    character_cards: state.characterCardsMd(), relations_text: relationsMd(state), arcs: state.arcs || '',
    arcs_block: state.arcs || '', relations_block: relationsMd(state) || '',
    ...extras,
  };
}

export function renderPair(systemTemplate, userTemplate, vars) { return [render(systemTemplate, vars), render(userTemplate, vars)]; }
