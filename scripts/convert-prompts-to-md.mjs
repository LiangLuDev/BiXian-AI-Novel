#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { MD_ROOT, PROMPT_MODULES, listMarkdownFiles } from './prompt-utils.mjs';

// The prompt refactor made Markdown files the source of truth. This script keeps
// the old conversion entry point available without Python AST parsing: it reports
// the current md template inventory and fails if any prompt module has no md dir.

let total = 0;
let missing = 0;
for (const mod of PROMPT_MODULES.filter((m) => m !== 'blocks')) {
  const dir = path.join(MD_ROOT, mod);
  if (!fs.existsSync(dir)) {
    console.error(`✗ ${mod}: missing ${path.relative(process.cwd(), dir)}`);
    missing += 1;
    continue;
  }
  const files = listMarkdownFiles(dir);
  total += files.length;
  console.log(`✓ ${mod.padEnd(16)} ${String(files.length).padStart(2)} templates`);
}

if (missing) process.exit(1);
console.log(`\nMarkdown prompt templates are already generated and are now the source of truth (${total} templates).`);
