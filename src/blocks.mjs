import { loadPrompt } from './prompts.mjs';
import { safeSubstitute } from '../scripts/prompt-utils.mjs';

export const BLOCKS = {
  I0: loadPrompt('blocks/i0'), U9: loadPrompt('blocks/u9'), GD: loadPrompt('blocks/gd'), H9: loadPrompt('blocks/h9'),
  D0: loadPrompt('blocks/d0'), R0: loadPrompt('blocks/r0'), P0: loadPrompt('blocks/p0'), N0: loadPrompt('blocks/n0'),
  M0: loadPrompt('blocks/m0'), HD: loadPrompt('blocks/hd'), WRITING_POINTS: loadPrompt('blocks/writing_points'),
  OPENING_HARD: loadPrompt('blocks/opening_hard'), CHARACTER_QUERY_BLOCK: loadPrompt('blocks/character_query_block'),
  CONSTITUTION_COMPLIANCE: loadPrompt('blocks/constitution_compliance'), CHAPTER_DESIGN_GUIDE: loadPrompt('blocks/chapter_design_guide'),
  ANTI_AI_FLAVOR: loadPrompt('blocks/anti_ai_flavor'), WEBNOVEL_VOICE: loadPrompt('blocks/webnovel_voice'),
  ERA_VOICE_LOCK: loadPrompt('blocks/era_voice_lock'), LANG_LOCK: loadPrompt('blocks/lang_lock'),
  LANG_LOCK_STRICT: loadPrompt('blocks/lang_lock_strict'), JSON_RULES: loadPrompt('blocks/json_rules'),
};

export function UD(unit = '章') { return safeSubstitute(loadPrompt('blocks/ud'), { UNIT: unit }); }
export function MD(unit = '章') { return safeSubstitute(loadPrompt('blocks/md'), { UNIT: unit }); }

export const HISTORICAL_ERA_KEYWORDS = ['古代','古风','古言','江湖','武侠','仙侠','修真','修仙','玄幻','洪荒','封神','上古','九州','汉','三国','魏晋','南北朝','隋','唐','五代','宋','元','明','清','春秋','战国','秦','民国','晚清','北洋'];
export function isHistoricalEra(era) { return !!era && HISTORICAL_ERA_KEYWORDS.some((kw) => String(era).includes(kw)); }
export function eraVoiceLockBlock(era) { return isHistoricalEra(era) ? BLOCKS.ERA_VOICE_LOCK : ''; }
export function customRequirementsBlock(requirements = '') { const r = String(requirements || '').trim(); return r ? `【用户特殊要求 - 必须严格遵守，不得违反或忽略】\n${r}` : ''; }

export const DEFAULT_ANTI_AI_TELLS = ['心里轻轻一动','心里某根弦','心里咯噔一下','心头一震','心头一颤','心底某处','忽然意识到','突然意识到','第一次真正','终于读懂','终于看清','宛如','仿若','霎那间','刹那之间','她当时还不知道','他当时还不知道','彼时的','不动声色','微不可察','克制又','锋利又','像一枚','没有一丝多余','以一种','更像一个','所谓体面','所谓克制','所谓专业'];
