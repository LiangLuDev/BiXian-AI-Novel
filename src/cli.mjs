#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { NovelProject } from './project.mjs';
import { NovelState, ProjectSetup } from './state.mjs';
import { LLM, LLMConfig, requireAiBackend, detectAiBackends } from './llm/index.mjs';
import { Orchestrator, PipelineOptions } from './orchestrator.mjs';
import { runServer } from './web.mjs';

// Tiny CLI arg parser: `--key value` (or `--flag`), `-k value` (or `-f`),
// remaining positionals → args[]. Strings only; coerce per-command.
function parse(argv) {
  const [cmd, ...rest] = argv;
  const args = [];
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--') || a.startsWith('-')) {
      const key = a.replace(/^-+/, '');
      const next = rest[i + 1];
      if (next && !next.startsWith('-')) { opts[key] = next; i += 1; }
      else opts[key] = true;
    } else {
      args.push(a);
    }
  }
  return { cmd, args, opts };
}

function reqDir(p) {
  if (!p) throw new Error('缺少 project_dir');
  if (String(p).endsWith('.json')) throw new Error('项目路径必须是目录，不是 .json 文件');
  return path.resolve(p);
}

const loadState = (dir) => new NovelProject(dir).load();
const saveState = (dir, state) => new NovelProject(dir).save(state);

function makeLlm(opts, state = null) {
  const backend = opts.backend || opts.b || state?.setup?.backend || 'codex';
  const model = opts.model || opts.m || null;
  const config = LLMConfig.forBackend(backend, { model });
  return new LLM(config);
}

function help() {
  console.log(`笔仙助手 CLI

Commands:
  init <dir> --description <text> [--title <title>]
  setup <dir> [--backend codex|claude|gemini|qwen|opencode] [--model name]
  design <dir>
  write <dir> [--from 1] [--to N]
  finalize <dir>
  run-all <dir> [--description text] [--cap N]
  export <dir> --out out.md
  inspect <dir>
  serve <dir-or-workspace> [--host 127.0.0.1] [--port 8000]`);
}

async function cmdInit(args, opts) {
  const dir = reqDir(args[0]);
  if (NovelProject.isProjectDir(dir)) throw new Error(`project already exists at ${dir}`);
  requireAiBackend(opts.backend || opts.b || 'codex');
  const state = new NovelState({
    setup: new ProjectSetup({
      title: opts.title || null,
      description: opts.description || opts.d || '',
      genre: opts.genre || '通用',
      literary_style: opts.style || '现代白话',
      target_chapters: Number(opts.chapters || 20),
      target_word_count_wan: Number(opts.wan || 10),
      short_story: Boolean(opts['short-story']),
    }),
  });
  saveState(dir, state);
  console.log(`initialised → ${dir}/`);
}

function cmdInspect(args) {
  const dir = reqDir(args[0]);
  const st = loadState(dir);
  console.log(`${st.setup.title || '未命名'} / ${st.setup.genre} / ${st.setup.literary_style}`);
  console.log(`path: ${dir}`);
  console.log(`target: ${st.setup.target_chapters} ch · ${st.setup.target_word_count_wan} 万字`);
  console.log(`style_guide: ${st.style_guide ? '✓' : '✗'}`);
  console.log(`theme: ${st.philosophical_theme ? '✓' : '✗'}`);
  console.log(`world: ${st.world_building ? '✓' : '✗'}`);
  console.log(`outline: ${st.outline ? '✓' : '✗'}`);
  console.log(`main characters: ${st.main_characters.length}`);
  console.log(`secondary characters: ${st.secondary_characters.length}`);
  console.log(`relations: ${st.relations.length}`);
  console.log(`chapter designs: ${st.chapter_designs.length}`);
  console.log(`chapters written: ${st.chapters.length}`);
  console.log(`total words: ${st.chapters.reduce((a, c) => a + (c.word_count || 0), 0)}`);
}

function cmdExport(args, opts) {
  const dir = reqDir(args[0]);
  const out = opts.out || opts.o || 'out.md';
  const st = loadState(dir);
  const lines = [
    `# ${st.setup.title || '未命名小说'}\n`,
    ...st.chapters
      .sort((a, b) => a.order - b.order)
      .map((c) => `\n## 第${c.order}章 ${c.design.title || ''}\n\n${c.body}\n`),
  ];
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`exported → ${out} (${st.chapters.length} chapters)`);
}

async function cmdPipeline(cmd, args, opts) {
  const dir = reqDir(args[0]);
  const state = NovelProject.isProjectDir(dir)
    ? loadState(dir)
    : new NovelState({ setup: new ProjectSetup({ description: opts.description || opts.d || '' }) });
  const llm = makeLlm(opts, state);
  state.setup.backend = opts.backend || opts.b || state.setup.backend;
  const orch = new Orchestrator(llm, new PipelineOptions({
    autosavePath: dir,
    chapterCountOverride: opts.cap ? Number(opts.cap) : null,
  }));
  if (cmd === 'setup') await orch.runSetup(state);
  else if (cmd === 'design') await orch.runDesign(state);
  else if (cmd === 'write') await orch.runChapters(state, {
    fromChapter: Number(opts.from || 1),
    toChapter: opts.to ? Number(opts.to) : null,
  });
  else if (cmd === 'finalize') await orch.runFinalize(state);
  else if (cmd === 'run-all') await orch.runAll(state);
  orch.flushUsageToState(state);
  saveState(dir, state);
  console.log(`done: ${cmd}`);
  console.log(JSON.stringify(llm.totalTokens()));
}

async function run() {
  const { cmd, args, opts } = parse(process.argv.slice(2));
  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) return help();
  if (cmd === 'init') return cmdInit(args, opts);
  if (cmd === 'inspect') return cmdInspect(args);
  if (cmd === 'export') return cmdExport(args, opts);
  if (cmd === 'serve') {
    return runServer(reqDir(args[0]), {
      host: opts.host || '127.0.0.1',
      port: Number(opts.port || 8000),
    });
  }
  if (['setup', 'design', 'write', 'finalize', 'run-all'].includes(cmd)) {
    return cmdPipeline(cmd, args, opts);
  }
  throw new Error(`未知命令: ${cmd}`);
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
