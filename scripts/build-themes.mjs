#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './prompt-utils.mjs';

const WORD_COUNT_LEAD_RE = /^\s*写\s*[一1]?\s*[部篇本]?\s*(?:约|大约|大概|预计)?\s*\d+(?:\.\d+)?\s*(?:w|W|万)\s*字\s*的?/u;
const WORD_COUNT_ANY_RE = /(?:前|后|开篇|中段|中前期|中后期)?\s*\d+(?:\.\d+)?\s*(?:w|W|万)\s*字/gu;

function sanitizeThemeDescription(desc = '') {
  return desc.trim()
    .replace(WORD_COUNT_LEAD_RE, '')
    .replace(WORD_COUNT_ANY_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[，,。；;：:]+/u, '')
    .trim();
}

function parseHistoryThemes(content) {
  const themes = [];
  const pattern = /(\d+)\.\s*\*\*([^*]+)\*\*[：:]\s*([^\n]+(?:\n(?!\d+\.)[^\n]+)*)/gu;
  for (const match of content.matchAll(pattern)) {
    const num = Number(match[1]);
    themes.push({
      id: `history-${String(num).padStart(3, '0')}`,
      title: match[2].trim(),
      description: sanitizeThemeDescription(match[3].trim().replace(/\n/g, ' ')),
      audience: 'male',
      genre: '历史',
      target_chapters: 100,
      target_word_count_wan: 60.0,
      category: '历史小说',
      tags: ['历史', '职业流'],
      source: 'history-novel-themes.md',
      status: 'available',
    });
  }
  return themes;
}

function parseNovelPromptsV1(content) {
  return parseNovelPrompts(content, {
    source: 'novel_prompts.md',
    idPrefix: (audience) => `${audience}-v1`,
    sectionMatcher: (s) => s.trimStart().startsWith('男频') ? 'male' : (s.trimStart().startsWith('女频') ? 'female' : null),
  });
}

function parseNovelPromptsV2(content) {
  return parseNovelPrompts(content, {
    source: 'novel_prompts_v2.md',
    idPrefix: (audience) => `${audience}-v2`,
    sectionMatcher: (s) => {
      const head = s.slice(0, 20);
      if (head.includes('男频') && head.includes('25 本')) return 'male';
      if (head.includes('女频') && head.includes('25 本')) return 'female';
      return null;
    },
  });
}

function parseNovelPrompts(content, options) {
  const themes = [];
  const sections = (`\n${content}`).split(/\n## (?!#)/u);
  for (const section of sections) {
    const audience = options.sectionMatcher(section);
    if (!audience) continue;
    const items = (`\n${section}`).split(/\n###\s+/u).slice(1);
    for (const item of items) {
      const match = item.match(/(\d+)\.\s+([^\n]+)\s*\n+([\s\S]+)/u);
      if (!match) continue;
      const num = Number(match[1]);
      const body = match[3].trim();
      const desc = sanitizeThemeDescription(body.startsWith('写一部') ? body.split('\n')[0].trim() : body.slice(0, 500).trim());
      themes.push({
        id: `${options.idPrefix(audience)}-${String(num).padStart(3, '0')}`,
        title: match[2].trim(),
        description: desc,
        audience,
        genre: '通用',
        target_chapters: audience === 'male' ? 100 : 80,
        target_word_count_wan: audience === 'male' ? 60.0 : 50.0,
        category: '现代/都市',
        tags: audience === 'male' ? ['创新题材'] : ['大女主', '职业'],
        source: options.source,
        status: 'available',
      });
    }
  }
  return themes;
}

const files = [
  ['history-novel-themes.md', parseHistoryThemes],
  ['novel_prompts.md', parseNovelPromptsV1],
  ['novel_prompts_v2.md', parseNovelPromptsV2],
];

const allThemes = [];
for (const [fileName, parser] of files) {
  const file = path.join(ROOT, fileName);
  if (!fs.existsSync(file)) continue;
  console.log(`解析 ${fileName}...`);
  const parsed = parser(fs.readFileSync(file, 'utf8'));
  allThemes.push(...parsed);
  console.log(`  → 提取 ${parsed.length} 个主题`);
}

const themesDb = {
  meta: { version: '1.0', updated_at: '2026-05-16', total: allThemes.length },
  themes: allThemes,
};

const outputFile = path.join(ROOT, 'data', 'themes.json');
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(themesDb, null, 2)}\n`, 'utf8');

console.log(`\n✓ 主题库已生成: ${outputFile}`);
console.log(`  总计 ${allThemes.length} 个主题`);
console.log(`  - 历史小说: ${allThemes.filter((t) => t.source === 'history-novel-themes.md').length}`);
console.log(`  - V1主题: ${allThemes.filter((t) => t.id.includes('v1')).length}`);
console.log(`  - V2主题: ${allThemes.filter((t) => t.id.includes('v2')).length}`);
console.log(`  - 男频: ${allThemes.filter((t) => t.audience === 'male').length}`);
console.log(`  - 女频: ${allThemes.filter((t) => t.audience === 'female').length}`);
