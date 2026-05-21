#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { MD_ROOT, loadBlocks, safeSubstitute } from './prompt-utils.mjs';

const chapterDir = path.join(MD_ROOT, 'chapter');
const basePath = path.join(chapterDir, 'system_base.md');
const shortPath = path.join(chapterDir, 'short_story_block.md');

if (!fs.existsSync(basePath)) {
  console.error(`Missing ${basePath}`);
  process.exit(1);
}

const blocks = loadBlocks();
const base = fs.readFileSync(basePath, 'utf8');
const renderedLong = safeSubstitute(base, blocks);
const renderedShort = renderedLong + (fs.existsSync(shortPath) ? fs.readFileSync(shortPath, 'utf8') : '');

const outDir = process.argv[2];
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'SYSTEM.txt'), renderedLong, 'utf8');
  fs.writeFileSync(path.join(outDir, 'SYSTEM_SHORT.txt'), renderedShort, 'utf8');
  console.log(`Wrote rendered chapter systems to ${outDir}`);
} else {
  console.log(`Rendered long system: ${Buffer.byteLength(renderedLong)} bytes`);
  console.log(`Rendered short system: ${Buffer.byteLength(renderedShort)} bytes`);
}
