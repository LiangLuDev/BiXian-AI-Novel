import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeSubstitute, loadBlocks } from '../scripts/prompt-utils.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MD_ROOT = path.join(ROOT, 'bixian', 'prompts', 'md');

export function loadPrompt(name) {
  const file = path.join(MD_ROOT, `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`prompt template not found: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

export function loadPromptWithBlocks(name, blocks = loadBlocks()) {
  return safeSubstitute(loadPrompt(name), blocks);
}

export function render(template, vars = {}) {
  return template.replace(/\{\{\s*([A-Za-z_][\w.]*)\s*(?:\|\s*join\((['"])([\s\S]*?)\2\)|\|\s*default\((['"])([\s\S]*?)\4\))?\s*\}\}/gu, (match, key, joinQ, joinSep, _defaultQ, fallback) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), vars);
    if (value == null) {
      if (fallback !== undefined) return fallback;
      throw new Error(`missing template variable: ${key}`);
    }
    if (joinQ) return Array.isArray(value) ? value.join(joinSep) : String(value);
    return Array.isArray(value) ? value.join(',') : String(value);
  });
}
