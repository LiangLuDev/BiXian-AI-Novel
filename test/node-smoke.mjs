#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NovelState, ProjectSetup, StyleGuide, Character, ChapterDesign, Chapter, chapterBodyIssue } from '../src/state.mjs';
import { NovelProject } from '../src/project.mjs';
import { Orchestrator, PipelineOptions } from '../src/orchestrator.mjs';
import { LLM, LLMConfig } from '../src/llm/index.mjs';
import { CodexProvider } from '../src/llm/providers/codex.mjs';
import { ClaudeCliProvider } from '../src/llm/providers/claude-cli.mjs';
import { loadPromptWithBlocks, render } from '../src/prompts.mjs';
import { usageSummary } from '../src/services/costing.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bixian-node-'));
const state = new NovelState({
  setup: new ProjectSetup({ title: '测试书', description: '一句话', protagonist: '苏沉' }),
  style_guide: new StyleGuide({ role: '作者' }),
  philosophical_theme: '主题',
  main_characters: [new Character({ name: '苏沉', raw_card: '# 苏沉' })],
  chapter_designs: [new ChapterDesign({ order: 1, title: '开局', raw: '# 开局' })],
  chapters: [new Chapter({ order: 1, design: new ChapterDesign({ order: 1, title: '开局' }), body: '苏沉醒来。', revisions: ['旧稿'] })],
  cost_log: [{ model: 'gpt-5.5', tokens_in: 1000, cached_in: 100, tokens_out: 200 }],
});

const project = new NovelProject(tmp);
project.save(state);
assert.equal(NovelProject.isProjectDir(tmp), true);
const loaded = project.load();
assert.equal(loaded.setup.title, '测试书');
assert.equal(loaded.main_characters[0].raw_card, '# 苏沉');
assert.equal(loaded.chapters[0].revisions[0], '旧稿');
assert.equal(loaded.characterCardsMd(), '# 苏沉');

const prompt = loadPromptWithBlocks('chapter/system_base');
assert.ok(prompt.includes('语言') || prompt.length > 1000);
assert.equal(render('你好 {{ name }}', { name: '亮哥' }), '你好 亮哥');
const usage = usageSummary(loaded.cost_log);
assert.equal(usage.calls, 1);
assert.ok(usage.cost_usd > 0);

const sparseDesignState = new NovelState({
  setup: new ProjectSetup({ target_chapters: 3 }),
  chapter_designs: [
    new ChapterDesign({ order: 2, title: '第二章', raw: '## 第二章' }),
    new ChapterDesign({ order: 3, title: '第三章', raw: '## 第三章' }),
  ],
});
const issues = sparseDesignState.chapterDesignIssues();
assert.deepEqual(issues.missing, [1]);
assert.throws(
  () => sparseDesignState.assertChapterDesignsReady(),
  /missing: 1/u,
);

const fakeLlm = {
  usageLog: [],
  setAbortSignal() {},
  totalTokens() { return {}; },
};
const orch = new Orchestrator(fakeLlm, new PipelineOptions());
await assert.rejects(
  () => orch.runChapters(sparseDesignState, { fromChapter: 1, toChapter: 1 }),
  /chapter design coverage invalid/u,
);

const rangedDesignState = new NovelState({
  setup: new ProjectSetup({ target_chapters: 5, title: '测试长篇', description: '一句话' }),
  style_guide: new StyleGuide({ role: '作者' }),
  philosophical_theme: '主题',
  outline: '大纲',
  main_characters: [new Character({ name: '苏沉', raw_card: '# 苏沉' })],
  chapter_designs: [new ChapterDesign({ order: 3, title: '旧第三章', raw: '## 第3章：旧第三章' })],
});
const rangeCalls = [];
const rangeLlm = {
  usageLog: [],
  async chat(_system, _user, { agentName }) {
    rangeCalls.push(agentName);
    const [, startRaw, endRaw] = agentName.match(/chapter_design_range\[(\d+)-(\d+)\]/u) || [];
    const start = Number(startRaw);
    const end = Number(endRaw);
    const lines = [];
    for (let order = start; order <= end; order += 1) {
      const heading = order === start
        ? `### **第${order}章：批次${order}**`
        : `第${order}章：批次${order}`;
      lines.push(`${heading}\n\n### 本章看点\n看点${order}\n\n### 核心冲突\n冲突${order}\n\n### 剧情与冲突\n剧情${order}\n\n### 情感基调\n紧张\n\n### 结尾钩子\n钩子${order}\n`);
    }
    return lines.join('\n---\n\n');
  },
  setAbortSignal() {},
  totalTokens() { return {}; },
};
const rangeOrch = new Orchestrator(rangeLlm, new PipelineOptions({ chapterDesignFullLimit: 3, chapterDesignBatchSize: 2 }));
await rangeOrch.runDesign(rangedDesignState);
assert.equal(rangedDesignState.chapter_designs.length, 5);
assert.equal(rangedDesignState.chapterDesignFor(3).title, '旧第三章');
assert.deepEqual(rangeCalls, ['chapter_design_range[1-2]', 'chapter_design_range[4-5]']);
rangedDesignState.assertChapterDesignsReady();

const repairCalls = [];
const jsonRepairLlm = new LLM(new LLMConfig({ model: 'test-model' }));
jsonRepairLlm.provider = {
  capabilities: { chat: true, image: false, schema: false, json: true },
  async chat({ agentName }) {
    repairCalls.push(agentName);
    const badJson = '```json\n{"summary":"因"男女大防"受挫"}\n```';
    const fixedJson = '{"summary":"因\\"男女大防\\"受挫"}';
    return {
      text: repairCalls.length === 1 ? badJson : fixedJson,
      usage: { tokens_in: 1, tokens_out: 1, cached_in: 0, reasoning_out: 0 },
    };
  },
};
const repairedJson = await jsonRepairLlm.chatJson('system', 'user', { agentName: 'volume' });
assert.equal(repairedJson.summary, '因"男女大防"受挫');
assert.deepEqual(repairCalls, ['volume', 'volume_json_repair']);

const cliEnvelopeBody = '{"type":"result","result":"","terminal_reason":"completed"}';
assert.match(
  chapterBodyIssue(new Chapter({ order: 2, body: cliEnvelopeBody, word_count: 0 }), state.setup),
  /CLI result envelope/u,
);
assert.match(
  chapterBodyIssue(new Chapter({ order: 2, body: '苏沉'.repeat(1000), word_count: 2000 }), new ProjectSetup({ per_chapter_min: 2500, per_chapter_max: 3500 }), { strictRange: true }),
  /too short/u,
);
assert.match(
  chapterBodyIssue(new Chapter({ order: 2, body: '苏沉'.repeat(2000), word_count: 4000 }), new ProjectSetup({ per_chapter_min: 2500, per_chapter_max: 3500 }), { strictRange: true }),
  /too long/u,
);
assert.equal(
  chapterBodyIssue(new Chapter({ order: 2, body: '苏沉'.repeat(2000), word_count: 4000 }), new ProjectSetup({ per_chapter_min: 2500, per_chapter_max: 3500 })),
  '',
);
const invalidBodyState = new NovelState({
  setup: new ProjectSetup({ target_chapters: 3, per_chapter_min: 2500 }),
  chapter_designs: [
    new ChapterDesign({ order: 1, title: '第一章', raw: '## 第一章' }),
    new ChapterDesign({ order: 2, title: '第二章', raw: '## 第二章' }),
    new ChapterDesign({ order: 3, title: '第三章', raw: '## 第三章' }),
  ],
  chapters: [
    new Chapter({ order: 1, body: '苏沉'.repeat(1300), word_count: 2600 }),
    new Chapter({ order: 2, body: cliEnvelopeBody, word_count: 0 }),
    new Chapter({ order: 3, body: '苏沉'.repeat(1300), word_count: 2600 }),
  ],
});
assert.equal(invalidBodyState.firstUnwrittenOrInvalidChapter(), 2);
const invalidBodyLlm = {
  usageLog: [],
  async chat() { return cliEnvelopeBody; },
  setAbortSignal() {},
  totalTokens() { return {}; },
};
await assert.rejects(
  () => new Orchestrator(invalidBodyLlm, new PipelineOptions()).runChapters(invalidBodyState, { fromChapter: 2, toChapter: 2 }),
  /chapter 2 body invalid/u,
);
assert.equal(invalidBodyState.chapters.find((c) => c.order === 2), undefined);

const revisedBodyState = new NovelState({
  setup: new ProjectSetup({ target_chapters: 1, per_chapter_min: 2500, per_chapter_max: 3500 }),
  style_guide: new StyleGuide({ role: '作者' }),
  philosophical_theme: '主题',
  world_building: '世界',
  outline: '大纲',
  main_characters: [new Character({ name: '苏沉', raw_card: '# 苏沉' })],
  chapter_designs: [new ChapterDesign({ order: 1, title: '开局', raw: '## 第1章：开局\n剧情' })],
});
const revisedCalls = [];
const reviseLlm = {
  usageLog: [],
  async chat(_system, user, { agentName }) {
    revisedCalls.push({ agentName, user });
    return revisedCalls.length === 1 ? '苏沉'.repeat(1000) : '苏沉'.repeat(1300);
  },
  setAbortSignal() {},
  totalTokens() { return {}; },
};
await new Orchestrator(reviseLlm, new PipelineOptions()).runChapters(revisedBodyState, { fromChapter: 1, toChapter: 1 });
assert.equal(revisedBodyState.chapters[0].word_count, 2600);
assert.deepEqual(revisedCalls.map((c) => c.agentName), ['chapter_body', 'chapter_body_revise_2']);
assert.match(revisedCalls[1].user, /至少补充/u);
assert.match(revisedCalls[1].user, /至少补充 1200/u);
assert.match(revisedCalls[1].user, /优先贴近 3200/u);
assert.match(revisedCalls[1].user, /禁止新增场景、人物、设定、时间跳跃或支线事件/u);

const fakeCodex = path.join(tmp, 'fake-codex.mjs');
fs.writeFileSync(fakeCodex, [
  '#!/usr/bin/env node',
  'import fs from "node:fs";',
  'const outIndex = process.argv.indexOf("--output-last-message");',
  'const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "";',
  'if (outPath) fs.writeFileSync(outPath, "正文已经生成。", "utf8");',
  'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 5 } }));',
  'console.log(JSON.stringify({ terminal_reason: "max_turns", errors: ["Reached maximum number of turns (1)"] }));',
  'process.exit(1);',
  '',
].join('\n'), { mode: 0o755 });
const recoveredCodex = new CodexProvider({ binary: fakeCodex });
const recoveredChat = await recoveredCodex.chat({ system: 'sys', user: 'usr', agentName: 'chapter_body' });
assert.equal(recoveredChat.text, '正文已经生成。');
assert.equal(recoveredChat.usage.tokens_in, 3);
assert.equal(recoveredChat.usage.tokens_out, 5);

const fakeClaude = path.join(tmp, 'fake-claude.mjs');
const claudeArgsPath = path.join(tmp, 'claude-args.jsonl');
fs.writeFileSync(fakeClaude, [
  '#!/usr/bin/env node',
  'import fs from "node:fs";',
  `fs.appendFileSync(${JSON.stringify(claudeArgsPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
  'console.log(JSON.stringify({ result: "ok", usage: { input_tokens: 1, output_tokens: 1 } }));',
  '',
].join('\n'), { mode: 0o755 });
const claude = new ClaudeCliProvider({ binary: fakeClaude, max_turns: 1, max_turns_long: 10 });
await claude.chat({ system: 'sys', user: 'usr', model: 'm', agentName: 'short_task' });
await claude.chat({ system: 'sys', user: 'usr', model: 'm', agentName: 'chapter_body', longForm: true });
const claudeArgLines = fs.readFileSync(claudeArgsPath, 'utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line));
assert.equal(claudeArgLines[0][claudeArgLines[0].indexOf('--max-turns') + 1], '1');
assert.equal(claudeArgLines[1][claudeArgLines[1].indexOf('--max-turns') + 1], '10');

const fallbackImageLlm = new LLM(LLMConfig.forClaude());
fallbackImageLlm.provider = {
  capabilities: { chat: true, image: false, schema: false, json: true },
};
let fallbackImageConfig = null;
fallbackImageLlm.imageProviderFactory = (cfg) => {
  fallbackImageConfig = cfg;
  return {
    capabilities: { chat: false, image: true, schema: false, json: false },
    async generateImage({ outputPath, model, title }) {
      assert.equal(title, '古代女医 · 太医院的第一人');
      assert.equal(model, 'gpt-5.4-mini');
      fs.writeFileSync(outputPath, 'fake image bytes');
      return { path: outputPath, usage: { tokens_in: 2, tokens_out: 3, cached_in: 0, reasoning_out: 0 } };
    },
  };
};
const fallbackCoverPath = path.join(tmp, 'fallback-cover.png');
assert.equal(
  await fallbackImageLlm.generateImage('prompt', fallbackCoverPath, { title: '古代女医 · 太医院的第一人' }),
  fallbackCoverPath,
);
assert.equal(fallbackImageConfig.backend, 'codex');
assert.equal(fallbackImageLlm.usageLog[0].backend, 'codex');

console.log('Node smoke checks passed');
