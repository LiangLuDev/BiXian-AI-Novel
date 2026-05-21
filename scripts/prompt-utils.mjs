import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MD_ROOT = path.join(ROOT, 'bixian', 'prompts', 'md');

export const PROMPT_MODULES = [
  'blocks',
  'theme',
  'world',
  'outline',
  'volume',
  'characters',
  'chapter_design',
  'chapter',
  'title',
  'cover',
  'qa',
  'builder',
  'constitution',
  'formatters',
  'publish_meta',
];

export const BLOCK_FILES = {
  LANG_LOCK: 'blocks/lang_lock.md',
  LANG_LOCK_STRICT: 'blocks/lang_lock_strict.md',
  JSON_RULES: 'blocks/json_rules.md',
  I0: 'blocks/i0.md',
  U9: 'blocks/u9.md',
  GD: 'blocks/gd.md',
  H9: 'blocks/h9.md',
  D0: 'blocks/d0.md',
  R0: 'blocks/r0.md',
  P0: 'blocks/p0.md',
  N0: 'blocks/n0.md',
  M0: 'blocks/m0.md',
  HD: 'blocks/hd.md',
  WRITING_POINTS: 'blocks/writing_points.md',
  OPENING_HARD: 'blocks/opening_hard.md',
  CHARACTER_QUERY_BLOCK: 'blocks/character_query_block.md',
  CONSTITUTION_COMPLIANCE: 'blocks/constitution_compliance.md',
  CHAPTER_DESIGN_GUIDE: 'blocks/chapter_design_guide.md',
  ANTI_AI_FLAVOR: 'blocks/anti_ai_flavor.md',
  WEBNOVEL_VOICE: 'blocks/webnovel_voice.md',
  ERA_VOICE_LOCK: 'blocks/era_voice_lock.md',
  _SEVERITY_RUBRIC: 'qa/severity_rubric.md',
};

export function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function loadTemplate(relWithoutExt) {
  return readUtf8(path.join(MD_ROOT, `${relWithoutExt}.md`));
}

export function loadBlocks() {
  const blocks = {};
  for (const [name, rel] of Object.entries(BLOCK_FILES)) {
    const file = path.join(MD_ROOT, rel);
    if (fs.existsSync(file)) blocks[name] = readUtf8(file);
  }
  return blocks;
}

export function safeSubstitute(input, values) {
  const sentinel = '\u0000DOLLAR\u0000';
  return input
    .replace(/\$\$/g, sentinel)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
      const key = braced ?? bare;
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    })
    .replaceAll(sentinel, '$');
}

export function mdFileToConstName(fileName) {
  return path.basename(fileName, '.md').toUpperCase();
}

export function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}
