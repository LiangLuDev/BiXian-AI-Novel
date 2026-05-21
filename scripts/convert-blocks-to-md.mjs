#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { MD_ROOT, BLOCK_FILES } from './prompt-utils.mjs';

// The prompt refactor made Markdown files the source of truth. This script keeps
// the old conversion entry point available without importing Python: it validates
// that every static block template exists under bixian/prompts/md/blocks.

let missing = 0;
for (const [name, rel] of Object.entries(BLOCK_FILES)) {
  if (!rel.startsWith('blocks/')) continue;
  const file = path.join(MD_ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(`✗ ${name}: missing ${path.relative(process.cwd(), file)}`);
    missing += 1;
  } else {
    const chars = fs.readFileSync(file, 'utf8').length;
    console.log(`✓ ${name.padEnd(30)} -> ${path.relative(process.cwd(), file)} (${chars} chars)`);
  }
}

if (missing) process.exit(1);
console.log('\nMarkdown block templates are already generated and are now the source of truth.');
