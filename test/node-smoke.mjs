#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NovelState, ProjectSetup, StyleGuide, Character, ChapterDesign, Chapter } from '../src/state.mjs';
import { NovelProject } from '../src/project.mjs';
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

console.log('Node smoke checks passed');
