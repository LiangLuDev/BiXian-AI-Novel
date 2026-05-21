#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { MD_ROOT, loadBlocks, safeSubstitute } from './prompt-utils.mjs';

const snapshot = process.argv[2] ?? '/tmp/bixian_prompt_snapshot_before';
const blocks = loadBlocks();

if (!fs.existsSync(snapshot)) {
  console.error(`Snapshot directory not found: ${snapshot}`);
  console.error('Usage: node scripts/verify-md-byte-exact.mjs [snapshot_dir]');
  process.exit(2);
}

const fails = [];
const skipped = [];
let total = 0;

for (const mod of fs.readdirSync(snapshot).sort()) {
  const modDir = path.join(snapshot, mod);
  if (!fs.statSync(modDir).isDirectory()) continue;
  const mdModDir = path.join(MD_ROOT, mod);
  if (!fs.existsSync(mdModDir)) {
    skipped.push(`  [skip module] ${mod} (no md/ generated yet)`);
    continue;
  }
  for (const snapName of fs.readdirSync(modDir).filter((n) => n.endsWith('.txt')).sort()) {
    const name = path.basename(snapName, '.txt');
    const mdPath = path.join(mdModDir, `${name.toLowerCase().replace(/^_+/, '')}.md`);
    if (!fs.existsSync(mdPath)) {
      skipped.push(`  [skip] ${mod}/${name} (no .md generated; likely synthesised entry)`);
      continue;
    }
    total += 1;
    const expected = fs.readFileSync(path.join(modDir, snapName));
    const raw = fs.readFileSync(mdPath, 'utf8');
    const rendered = Buffer.from(safeSubstitute(raw, blocks), 'utf8');
    if (!rendered.equals(expected)) {
      let first = 0;
      const lim = Math.min(rendered.length, expected.length);
      while (first < lim && rendered[first] === expected[first]) first += 1;
      fails.push([mod, name, first]);
    }
  }
}

console.log(`\n${'='.repeat(60)}\nResult: ${total - fails.length}/${total} PASS, ${fails.length} FAIL`);
if (skipped.length) {
  console.log('\nSkipped:');
  for (const line of skipped.slice(0, 20)) console.log(line);
  if (skipped.length > 20) console.log(`  ... (${skipped.length - 20} more)`);
}
if (fails.length) {
  console.log('\nFAILURES:');
  for (const [mod, name, pos] of fails.slice(0, 15)) console.log(`  ${mod}/${name}: first diff at byte ${pos}`);
  if (fails.length > 15) console.log(`  ... (${fails.length - 15} more)`);
  process.exit(1);
}
