#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { MD_ROOT, PROMPT_MODULES, listMarkdownFiles, loadBlocks, mdFileToConstName, safeSubstitute, writeUtf8 } from './prompt-utils.mjs';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node scripts/dump-prompt-snapshot.mjs <out_dir>');
  process.exit(1);
}

const blocks = loadBlocks();
fs.mkdirSync(outDir, { recursive: true });
let total = 0;

for (const mod of PROMPT_MODULES) {
  const mdDir = path.join(MD_ROOT, mod);
  if (!fs.existsSync(mdDir)) continue;
  const modOut = path.join(outDir, mod);
  fs.mkdirSync(modOut, { recursive: true });
  let count = 0;
  for (const fileName of listMarkdownFiles(mdDir)) {
    const raw = fs.readFileSync(path.join(mdDir, fileName), 'utf8');
    const rendered = safeSubstitute(raw, blocks);
    writeUtf8(path.join(modOut, `${mdFileToConstName(fileName)}.txt`), rendered);
    count += 1;
  }
  console.log(`  bixian.prompts.${mod}: ${count} entries`);
  total += count;
}

console.log(`\nTotal: ${total} entries dumped to ${outDir}`);
