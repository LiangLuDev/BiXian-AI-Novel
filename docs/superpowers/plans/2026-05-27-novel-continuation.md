# 小说续写功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已完成的小说项目新增"续写"能力——把 30 章扩展到 100/300 章，原 outline/人物/世界不变，新内容写入 `state.continuations[]` 作为"续集卷"，保证剧情稳定。

**Architecture:** 续集卷模式。新增 4 个 agent（prior_summary 摘要已写内容、continuation_outline/volume/arcs 生成续集结构）；新增 `contextForChapter(state, order)` 上下文路由（续写区间内换续集 outline/arcs）；orchestrator 新增 `runContinuation`；web 新增 `POST /api/continue`；前端在进度页"启动"按钮旁加"续写"按钮。

**Tech Stack:** Node.js 22 + ESM、React 18（无 JSX 编译，浏览器内动态加载）、Codex CLI/Claude CLI 作为 LLM 后端。无单元测试框架——靠真实项目 smoke test 验收（设计文档 §8）。

---

## File Structure

**Create:**
- `bixian/prompts/md/continuation/prior_summary/system.md`
- `bixian/prompts/md/continuation/prior_summary/user.md`
- `bixian/prompts/md/continuation/outline/system.md`
- `bixian/prompts/md/continuation/outline/user.md`
- `bixian/prompts/md/continuation/volume/system.md`
- `bixian/prompts/md/continuation/volume/user.md`
- `bixian/prompts/md/continuation/arcs/system.md`
- `bixian/prompts/md/continuation/arcs/user.md`

**Modify:**
- `src/state.mjs` — 新增 `Continuation` 类、`NovelState.continuations` 字段、`contextForChapter` 路由
- `src/project.mjs` — 持久化 `continuations[]` 到 project.json
- `src/agents-common.mjs` — `setupVars` 支持按章节注入续集上下文
- `src/agents.mjs` — 新增 4 个 agent；`chapterDesignRangeAgent` / `chapterBodyAgent` 用 `contextForChapter`
- `src/orchestrator.mjs` — 新增 `runContinuation`
- `src/runner.mjs` — `MODES` 加 `continue`，`_runTask` 派发
- `src/web.mjs` — `POST /api/continue` 端点
- `bixian/static/api.jsx` — 加 `api.continueWriting()`
- `bixian/static/screens/progress.jsx` — 顶部加"续写"按钮 + 对话框

---

## Task 1: Continuation 数据模型 + state.continuations[]

**Files:**
- Modify: `src/state.mjs`

- [ ] **Step 1.1: 在 state.mjs 增加 Continuation 类（紧跟 Hook 类后）**

```js
export class Continuation {
  constructor(data = {}) {
    Object.assign(this, {
      order: 0,
      from_chapter: 0,
      to_chapter: 0,
      prev_target: 0,
      outline: '',
      volumes: [],
      arcs: '',
      prev_summary: '',
      created_at: '',
    }, data);
    this.volumes = (this.volumes || []).map((v) => new Volume(v));
  }
  toJSON() { return { ...this }; }
}
```

- [ ] **Step 1.2: 在 NovelState 默认字段加 continuations**

把 NovelState 构造函数的默认对象中加 `continuations: [],`，并在末尾重新水化：

```js
this.continuations = (this.continuations || []).map((c) => new Continuation(c));
```

- [ ] **Step 1.3: 在 NovelState 上加 contextForChapter 方法**

放在 `chapterDesignsText` 附近：

```js
contextForChapter(order) {
  const cont = this.continuations.find((c) => order >= c.from_chapter && order <= c.to_chapter);
  if (!cont) {
    return {
      outline: this.outline,
      volumes: this.volumes,
      arcs: this.arcs,
      prev_summary: '',
      continuation: null,
    };
  }
  return {
    outline: cont.outline || this.outline,
    volumes: cont.volumes || [],
    arcs: cont.arcs || this.arcs,
    prev_summary: cont.prev_summary || '',
    continuation: cont,
  };
}
```

- [ ] **Step 1.4: 提交**

```bash
git add src/state.mjs
git commit -m "feat(state): add Continuation model + contextForChapter router"
```

---

## Task 2: 持久化 continuations[] 到 project.json

**Files:**
- Modify: `src/project.mjs`

- [ ] **Step 2.1: import Continuation**

`src/project.mjs:3` 末尾追加：

```js
import { Chapter, ChapterDesign, Character, CharacterRelation, Continuation, Hook, NovelState, ProjectSetup, PublishMeta, StyleGuide, Volume } from './state.mjs';
```

- [ ] **Step 2.2: 在 save() 的 project.json 写入对象中加 continuations**

修改 `src/project.mjs:29-36`：

```js
atomicWriteJson(this.projectJson, {
  schema: 'bixian.project/v1',
  created_at: state.created_at || null,
  setup: state.setup,
  style_guide: state.style_guide,
  titles_proposed: state.titles_proposed,
  cover_image_path: state.cover_image_path,
  continuations: state.continuations || [],
});
```

- [ ] **Step 2.3: 在 load() 的 NovelState 构造里加 continuations**

`src/project.mjs:57-77` NovelState 构造对象里加：

```js
continuations: (index.continuations || []).map((c) => new Continuation(c)),
```

- [ ] **Step 2.4: 提交**

```bash
git add src/project.mjs
git commit -m "feat(project): persist continuations[] to project.json"
```

---

## Task 3: setupVars 支持按章节切换续集上下文

**Files:**
- Modify: `src/agents-common.mjs`

- [ ] **Step 3.1: setupVars 增加可选 chapter order 参数**

替换 `src/agents-common.mjs` 的 `setupVars` 函数为：

```js
export function setupVars(state, extras = {}) {
  const s = state.setup;
  const sgBlock = state.style_guide?.toBlock?.() || '';

  // 当 extras 指定了 chapter_order，并且该章节落在某个续集卷范围内时，
  // 把 outline/arcs/relations/prev_summary 切换为续集上下文。
  const orderHint = Number(extras.chapter_order || extras.from_chapter || 0);
  const ctx = orderHint > 0 ? state.contextForChapter(orderHint) : null;
  const outline = ctx ? ctx.outline : state.outline;
  const arcs = ctx ? ctx.arcs : state.arcs;
  const prevSummary = ctx ? ctx.prev_summary : '';

  return {
    title: s.title || '未命名小说', description: s.description, genre: s.genre, literary_style: s.literary_style,
    narrative_time: s.narrative_time, perspective: s.perspective, narrative_structure: s.narrative_structure,
    mood: s.mood, era: s.era, protagonist: s.protagonist, conflict: s.conflict, highlight: s.highlight, taboo: s.taboo,
    custom_requirements: s.custom_requirements, custom_requirements_block: customRequirementsBlock(s.custom_requirements), era_voice_lock_block: eraVoiceLockBlock(s.era),
    target_chapters: s.target_chapters, target_word_count_wan: s.target_word_count_wan, per_chapter_min: s.per_chapter_min, per_chapter_max: s.per_chapter_max,
    per_chapter_target: s.per_chapter_target, outline_type: s.outline_type, opening_type: s.opening_type, opening_hook: s.opening_hook,
    philosophical_theme: state.philosophical_theme, world_building: state.world_building, outline,
    style_guide_block: sgBlock, style_guide_text: sgBlock || '（未生成宪章）',
    main_characters: state.main_characters.map((c) => c.raw_card).join('\n\n'), secondary_characters: state.secondary_characters.map((c) => c.raw_card).join('\n\n'),
    character_cards: state.characterCardsMd(), relations_text: relationsMd(state), arcs,
    arcs_block: arcs || '', relations_block: relationsMd(state) || '',
    prev_summary: prevSummary,
    prev_summary_block: prevSummary ? `【上一卷已发生事实（不可改写）】\n${prevSummary}` : '',
    ...extras,
  };
}
```

注意：`extras` 仍可覆盖任何键（保持原有调用兼容）。

- [ ] **Step 3.2: 提交**

```bash
git add src/agents-common.mjs
git commit -m "feat(agents): setupVars routes outline/arcs by chapter_order for continuation"
```

---

## Task 4: 续集 prompt 模板（4 套 8 个文件）

**Files:**
- Create: `bixian/prompts/md/continuation/prior_summary/system.md`
- Create: `bixian/prompts/md/continuation/prior_summary/user.md`
- Create: `bixian/prompts/md/continuation/outline/system.md`
- Create: `bixian/prompts/md/continuation/outline/user.md`
- Create: `bixian/prompts/md/continuation/volume/system.md`
- Create: `bixian/prompts/md/continuation/volume/user.md`
- Create: `bixian/prompts/md/continuation/arcs/system.md`
- Create: `bixian/prompts/md/continuation/arcs/user.md`

- [ ] **Step 4.1: prior_summary/system.md**

```
你是一名严谨的中文长篇小说"事实摘要员"。

【任务】基于已写完的章节摘要、原大纲、原弧线、最后一章末尾原文，压缩出一份用于续集创作的"事实背景"。

【输出格式】纯中文 Markdown，不超过 2000 字，按以下五段输出：
1. 主线进度（一段，~300 字，到上一卷收尾时事件链推到哪一步）
2. 人物当前状态（每个主角/重要配角一段，写他们现在的处境、关系、心理）
3. 未平的钩子与伏笔（列表，每条一行）
4. 世界规则与设定（一段，~300 字，明确不可改写的硬约束）
5. 上一卷收尾基调（一段，~150 字，结尾留下的情绪/悬念）

【硬约束】
- 只总结已发生的事实，不预测、不评论、不引入新设定
- 严格使用简体中文，禁止英文/繁体
- 不输出 JSON、不输出标题、不输出 "以下是" 之类的元话语
```

- [ ] **Step 4.2: prior_summary/user.md**

```
{{ custom_requirements_block }}

【作品宪章】
{{ style_guide_text }}

【原书全文大纲】
{{ outline }}

【原书弧线】
{{ arcs }}

【已写章节摘要】
{{ written_summaries }}

【最后一章末尾原文】
{{ last_chapter_tail }}

请输出"事实背景"五段。
```

- [ ] **Step 4.3: outline/system.md**

```
你是一名网文连载的"续集大纲规划师"。

【任务】基于上一卷的事实背景和原书设定，规划"续集卷"的全文大纲。续集必须有真正的新冲突、新目标、新对手，而不是把旧爽点再来一遍。

【输出格式】纯中文 Markdown，三段式结构：起 / 承 / 转 / 合（如已要求三段式则用 起/承/转 + 收尾）。每段下列出：
- 主要事件（编号列表，5-8 条）
- 看点与钩子（一段）
- 冲突升级（仅承/转段需要）
- 关键反转或揭示（仅转段需要）

【硬约束】
- 续集不得改写或推翻"事实背景"中已经发生的内容
- 续集不得复用上一卷的核心爽点模板（如打脸店员、暴买豪车等若是旧爽点，必须升级或更换为新的冲突维度）
- 严格使用简体中文，禁止英文/繁体
- 只输出大纲正文，不输出标题、不输出 JSON、不输出元话语
```

- [ ] **Step 4.4: outline/user.md**

```
{{ custom_requirements_block }}

【作品宪章】
{{ style_guide_text }}

【原书故事描述】
{{ description }}

【哲学主题】
{{ philosophical_theme }}

【背景介绍】
{{ world_building }}

【上一卷事实背景（不可改写）】
{{ prev_summary }}

【续集规模】
- 续集卷覆盖第 {{ continuation_from }} 章到第 {{ continuation_to }} 章（共 {{ continuation_count }} 章）
- 全书续到 {{ target_chapters }} 章
- 大纲结构：{{ outline_type }}

请输出续集卷大纲。
```

- [ ] **Step 4.5: volume/system.md**

```
你是一名网文分卷规划师。基于续集大纲，把续集卷范围切成 2-4 个子卷，每卷 8-30 章。

【输出格式】JSON 对象，schema：

{
  "volumes": [
    {"order": <整数>, "title": "<卷名>", "summary": "<本卷一句话剧情>", "chapter_range": [<起>, <止>]}
  ]
}

【硬约束】
- chapter_range 严格落在续集范围 [{{ continuation_from }}, {{ continuation_to }}] 内
- 所有 chapter_range 拼起来恰好覆盖整个续集范围，不重叠不漏
- 只输出 JSON，不要 Markdown 包裹，不要任何解释文本
```

- [ ] **Step 4.6: volume/user.md**

```
【续集卷大纲】
{{ continuation_outline }}

【续集范围】
- 起：第 {{ continuation_from }} 章
- 止：第 {{ continuation_to }} 章

请输出续集分卷 JSON。
```

- [ ] **Step 4.7: arcs/system.md**

```
你是一名长篇小说的弧线规划师。基于续集大纲，规划续集卷的"主线弧 + 副线弧"，明确每条弧的起点章、关键节点章、收束章。

【输出格式】纯中文 Markdown，每条弧用以下结构：

## 主线弧 / 副线弧：<弧名>
- 起点：第 N 章 — 描述
- 关键节点：第 N 章 — 描述
- 收束：第 N 章 — 描述

【硬约束】
- 所有章节号严格落在续集范围 [{{ continuation_from }}, {{ continuation_to }}] 内
- 弧不得改写已发生事实；新弧的主角动机要与"事实背景"中的人物状态衔接
- 不输出 JSON、不输出标题、只输出 Markdown 正文
```

- [ ] **Step 4.8: arcs/user.md**

```
【作品宪章】
{{ style_guide_text }}

【上一卷事实背景（不可改写）】
{{ prev_summary }}

【续集卷大纲】
{{ continuation_outline }}

【续集分卷】
{{ continuation_volumes_text }}

请输出续集弧线。
```

- [ ] **Step 4.9: 提交**

```bash
git add bixian/prompts/md/continuation/
git commit -m "feat(prompts): add continuation prompt templates (prior_summary/outline/volume/arcs)"
```

---

## Task 5: 续集 4 个新 agent

**Files:**
- Modify: `src/agents.mjs`

- [ ] **Step 5.1: 在 agents.mjs 顶部 import 增加 Continuation**

修改 import 行（agents.mjs:3）：

```js
import { Character, CharacterRelation, Chapter, ChapterDesign, Continuation, PublishMeta, StyleGuide, Volume, chapterBodyCjkCount, chapterBodyIssue } from './state.mjs';
```

- [ ] **Step 5.2: 在 agents.mjs 末尾追加 4 个 agent**

```js
// ---------- continuation agents ----------

function nextContinuationFor(state, newTarget) {
  const prevTarget = Math.max(
    Number(state.setup.target_chapters || 0),
    ...state.chapters.filter((c) => c.body).map((c) => c.order),
    0,
  );
  if (newTarget <= prevTarget) {
    throw new Error(`new target ${newTarget} must exceed current ${prevTarget}`);
  }
  const existing = state.continuations.find(
    (c) => c.from_chapter === prevTarget + 1 && c.to_chapter === newTarget,
  );
  if (existing) return { cont: existing, prevTarget, isNew: false };
  const cont = new Continuation({
    order: state.continuations.length + 1,
    from_chapter: prevTarget + 1,
    to_chapter: newTarget,
    prev_target: prevTarget,
    created_at: nowIsoSafe(),
  });
  state.continuations.push(cont);
  return { cont, prevTarget, isNew: true };
}

function nowIsoSafe() {
  try { return new Date().toISOString(); } catch { return ''; }
}

function writtenSummariesText(state, throughChapter) {
  const lines = [];
  for (const ch of state.chapters.filter((c) => c.order <= throughChapter).sort((a, b) => a.order - b.order)) {
    const title = ch.design?.title || '';
    const summary = (ch.summary || '').trim()
      || (ch.design?.raw || '').slice(0, 400).trim()
      || (ch.body || '').slice(0, 400).trim();
    lines.push(`## 第${ch.order}章 ${title}\n${summary}`);
  }
  return lines.join('\n\n');
}

export async function priorSummaryAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('priorSummaryAgent requires continuation');
  if (continuation.prev_summary && continuation.prev_summary.trim()) return state;
  const lastOrder = continuation.prev_target;
  const lastChapter = state.chapters.find((c) => c.order === lastOrder);
  const vars = setupVars(state, {
    written_summaries: writtenSummariesText(state, lastOrder) || '（无可用章节摘要）',
    last_chapter_tail: (lastChapter?.body || '').slice(-600) || '（无）',
  });
  const [sys, usr] = renderPair(P('continuation/prior_summary/system'), P('continuation/prior_summary/user'), vars);
  const text = await llm.chat(sys, usr, { agentName: 'prior_summary', longForm: true });
  continuation.prev_summary = String(text || '').trim();
  if (!continuation.prev_summary) throw new Error('priorSummaryAgent returned empty summary');
  return state;
}

export async function continuationOutlineAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('continuationOutlineAgent requires continuation');
  if (continuation.outline && continuation.outline.trim()) return state;
  const vars = setupVars(state, {
    prev_summary: continuation.prev_summary,
    continuation_from: continuation.from_chapter,
    continuation_to: continuation.to_chapter,
    continuation_count: continuation.to_chapter - continuation.from_chapter + 1,
    target_chapters: continuation.to_chapter,
  });
  const [sys, usr] = renderPair(P('continuation/outline/system'), P('continuation/outline/user'), vars);
  continuation.outline = await llm.chat(sys, usr, { agentName: 'continuation_outline', longForm: true });
  if (!continuation.outline.trim()) throw new Error('continuationOutlineAgent returned empty outline');
  return state;
}

export async function continuationVolumeAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('continuationVolumeAgent requires continuation');
  if (continuation.volumes?.length) return state;
  const vars = setupVars(state, {
    continuation_outline: continuation.outline,
    continuation_from: continuation.from_chapter,
    continuation_to: continuation.to_chapter,
  });
  const [sys, usr] = renderPair(P('continuation/volume/system'), P('continuation/volume/user'), vars);
  const data = await llm.chatJson(sys, usr, { agentName: 'continuation_volume' });
  continuation.volumes = (data.volumes || []).map((v, i) => new Volume({
    order: v.order || i + 1,
    title: v.title || `续集卷 ${i + 1}`,
    summary: v.summary || '',
    chapter_range: v.chapter_range || [continuation.from_chapter, continuation.to_chapter],
  }));
  if (!continuation.volumes.length) throw new Error('continuationVolumeAgent returned no volumes');
  return state;
}

export async function continuationArcsAgent(state, llm, { continuation } = {}) {
  if (!continuation) throw new Error('continuationArcsAgent requires continuation');
  if (continuation.arcs && continuation.arcs.trim()) return state;
  const volumesText = (continuation.volumes || []).map((v) => `- 卷${v.order} ${v.title}（${v.chapter_range[0]}-${v.chapter_range[1]}）：${v.summary}`).join('\n');
  const vars = setupVars(state, {
    prev_summary: continuation.prev_summary,
    continuation_outline: continuation.outline,
    continuation_volumes_text: volumesText || '（无）',
    continuation_from: continuation.from_chapter,
    continuation_to: continuation.to_chapter,
  });
  const [sys, usr] = renderPair(P('continuation/arcs/system'), P('continuation/arcs/user'), vars);
  continuation.arcs = await llm.chat(sys, usr, { agentName: 'continuation_arcs', longForm: true });
  if (!continuation.arcs.trim()) throw new Error('continuationArcsAgent returned empty arcs');
  return state;
}

export function ensureContinuation(state, newTarget) {
  return nextContinuationFor(state, newTarget);
}
```

- [ ] **Step 5.3: 提交**

```bash
git add src/agents.mjs
git commit -m "feat(agents): add continuation agents (prior_summary/outline/volume/arcs)"
```

---

## Task 6: chapterDesignRangeAgent + chapterBodyAgent 注入续集上下文

**Files:**
- Modify: `src/agents.mjs`

- [ ] **Step 6.1: chapterDesignRangeAgent 传 chapter_order 给 setupVars**

找到 `src/agents.mjs:349-388` 的 `chapterDesignRangeAgent`，把 `vars` 那段改为：

```js
const vars = setupVars(state, {
  chapter_order: start,            // 触发 contextForChapter
  start_chapter: start,
  end_chapter: end,
  batch_count: end - start + 1,
  previous_designs: state.chapterDesignsText({ beforeChapter: start, limit: 5 }) || '（暂无前置分章设计）',
});
```

只新增 `chapter_order: start,` 这一行。

- [ ] **Step 6.2: chapterBodyAgent 已经传 chapter_order，确认 setupVars 路由生效**

`src/agents.mjs:396-407` 的 `chapterBodyAgent` 已经传 `chapter_order: order`，Step 3 改的 setupVars 会自动路由。**不需要改代码**，但需要确认 prompt 的 outline/arcs 引用走 setupVars 的字段（实际上 `outline`/`arcs_block` 都来自 setupVars，所以续集 outline/arcs 会自动被注入）。

- [ ] **Step 6.3: 提交**

```bash
git add src/agents.mjs
git commit -m "feat(agents): route design-range to continuation context via setupVars"
```

---

## Task 7: Orchestrator.runContinuation

**Files:**
- Modify: `src/orchestrator.mjs`

- [ ] **Step 7.1: import 续集 agent**

修改 `src/orchestrator.mjs:5-9` import：

```js
import {
  bookTitleAgent, chapterBodyAgent, chapterDesignFullAgent, chapterDesignRangeAgent, chapterPostprocessAgent, coverAgent, coverImageAgent,
  continuationArcsAgent, continuationOutlineAgent, continuationVolumeAgent, ensureContinuation, priorSummaryAgent,
  mainArcsAgent, mainCharsAgent, outlineAgent, relationsAgent,
  secondaryArcsAgent, secondaryCharsAgent, styleGuideAgent, themeAgent, volumeAgent, worldAgent,
} from './agents.mjs';
```

- [ ] **Step 7.2: 在 Orchestrator class 末尾（generateCoverImage 之前）加 runContinuation**

```js
async runContinuation(state, { newTarget }) {
  this.controller?.emit('phase_started', { phase: 'continuation' });

  const { cont, prevTarget, isNew } = ensureContinuation(state, Number(newTarget));
  if (isNew) {
    this.autosave(state);
    this.controller?.emit('state_updated', {});
  }

  if (!cont.prev_summary?.trim()) {
    await this._runAgent('prior_summary', priorSummaryAgent, state, [{ continuation: cont }]);
  }
  if (!cont.outline?.trim()) {
    await this._runAgent('continuation_outline', continuationOutlineAgent, state, [{ continuation: cont }]);
  }
  if (!cont.volumes?.length) {
    await this._runAgent('continuation_volume', continuationVolumeAgent, state, [{ continuation: cont }]);
  }
  if (!cont.arcs?.trim()) {
    await this._runAgent('continuation_arcs', continuationArcsAgent, state, [{ continuation: cont }]);
  }

  // 续集元数据齐全后，提升 target_chapters 让后续 runDesign/runChapters 自然推进。
  if (Number(state.setup.target_chapters || 0) < cont.to_chapter) {
    state.setup.target_chapters = cont.to_chapter;
    this.autosave(state);
  }

  await this.runDesign(state);
  await this.runChapters(state, { fromChapter: cont.from_chapter, toChapter: cont.to_chapter });

  this.controller?.emit('phase_completed', { phase: 'continuation' });
  return state;
}
```

- [ ] **Step 7.3: 提交**

```bash
git add src/orchestrator.mjs
git commit -m "feat(orchestrator): add runContinuation pipeline"
```

---

## Task 8: Runner 加 'continue' 模式

**Files:**
- Modify: `src/runner.mjs`

- [ ] **Step 8.1: MODES 加 continue**

修改 `src/runner.mjs:8`：

```js
const MODES = new Set(['all', 'resume', 'setup', 'design', 'write', 'finalize', 'continue']);
```

- [ ] **Step 8.2: enqueue 签名加 newTarget**

修改 `src/runner.mjs:87`：

```js
enqueue(projectId, { mode = 'all', fromChapter = 1, toChapter = null, cap = null, newTarget = null } = {}) {
```

并在 `src/runner.mjs:99-104` task 对象里加 `newTarget`：

```js
const task = {
  projectId, mode, fromChapter, toChapter, cap, newTarget,
  status: 'queued', paused: false, cancelled: false,
  currentAgent: null, currentChapter: null,
  controller: null, promise: null,
};
```

- [ ] **Step 8.3: _runTask 派发 continue**

修改 `src/runner.mjs:264-269` 那段 if/else：

```js
if (task.mode === 'all' || task.mode === 'resume') await orch.runAll(state);
else if (task.mode === 'setup') await orch.runSetup(state);
else if (task.mode === 'design') await orch.runDesign(state);
else if (task.mode === 'write') await orch.runChapters(state, { fromChapter: task.fromChapter, toChapter: task.toChapter });
else if (task.mode === 'finalize') await orch.runFinalize(state);
else if (task.mode === 'continue') await orch.runContinuation(state, { newTarget: task.newTarget });
```

- [ ] **Step 8.4: 提交**

```bash
git add src/runner.mjs
git commit -m "feat(runner): dispatch continue mode to runContinuation"
```

---

## Task 9: POST /api/continue 端点

**Files:**
- Modify: `src/web.mjs`

- [ ] **Step 9.1: 在 /api/run 端点之后追加 /api/continue**

找到 `src/web.mjs:586` 的 `}` 之后（紧跟 /api/run 块的结束），插入：

```js
      if (method === 'POST' && pathname === '/api/continue') {
        const body = await readBody(req);
        const pid = body.project_id || activeId;
        if (!pid) return send(res, 400, { detail: 'no project_id' });
        const newTarget = Number(body.target_chapters || 0);
        if (!newTarget || newTarget <= 0) return send(res, 400, { detail: 'target_chapters required' });
        let state;
        try { state = requireState(workspace, pid); }
        catch (e) { return send(res, 404, { detail: e.message }); }
        const current = Number(state.setup.target_chapters || 0);
        if (newTarget <= current) {
          return send(res, 400, { detail: `target_chapters must exceed current ${current}` });
        }
        const taskState = registry.stateOf(pid);
        if (taskState.running || taskState.queued) {
          return send(res, 400, { detail: 'project is busy; stop or wait before continuing' });
        }
        const capErr = aiCapabilityError(state.setup.backend || null);
        if (capErr) return send(res, 412, { detail: capErr.message, code: 'ai_unavailable', backend: state.setup.backend || '' });
        const st = registry.enqueue(pid, { mode: 'continue', newTarget });
        return send(res, 200, { ok: true, ...st });
      }
```

注意：参考 /api/run 上面的端点使用 `requireState` 和 `aiCapabilityError`，如果这些 helper 没在作用域里，按 /api/run 的 imports 补齐。

- [ ] **Step 9.2: 提交**

```bash
git add src/web.mjs
git commit -m "feat(web): add POST /api/continue endpoint"
```

---

## Task 10: 前端 - api client + 续写按钮

**Files:**
- Modify: `bixian/static/api.jsx`
- Modify: `bixian/static/screens/progress.jsx`

- [ ] **Step 10.1: api.jsx 增加 continueWriting**

在 `bixian/static/api.jsx:46`（紧跟 `resume:` 后）插入：

```js
  continueWriting: (projectId, targetChapters) =>
    api.postJSON("/api/continue", { project_id: projectId, target_chapters: Number(targetChapters) }),
```

- [ ] **Step 10.2: progress.jsx 加 续写按钮 + dialog**

找到 `bixian/static/screens/progress.jsx:113-115` "启动" 按钮所在的 div，把它替换为：

```jsx
            <button className="btn sm" onClick={() => setModelModalOpen(true)} disabled={!canControl} title="设置本书后续生成使用的模型">
              <I.Sliders size={12} /> {backendLabel} · {modelLabel}
            </button>
            {chapters >= target && target > 0 && !isWriting && !isPaused && (
              <button className="btn sm" onClick={() => setContinueModalOpen(true)} disabled={!canControl} title="续写更多章节">
                <I.Plus size={12} /> 续写
              </button>
            )}
            <button className="btn sm" onClick={togglePause} disabled={!canControl}>
              {isPaused ? <><I.Play size={12} /> 继续</> : isWriting ? <><I.Pause size={12} /> 暂停</> : <><I.Play size={12} /> 启动</>}
            </button>
```

并在 progress.jsx 组件 state 区（搜索 `setModelModalOpen` 一带）加：

```jsx
const [continueModalOpen, setContinueModalOpen] = React.useState(false);
const [continueTarget, setContinueTarget] = React.useState(String((target || 30) * 2));
const [continueBusy, setContinueBusy] = React.useState(false);
const [continueErr, setContinueErr] = React.useState("");

const submitContinue = async () => {
  setContinueBusy(true); setContinueErr("");
  try {
    const n = Number(continueTarget);
    if (!n || n <= target) throw new Error(`新章数必须大于当前 ${target} 章`);
    await api.continueWriting(projectId, n);
    setContinueModalOpen(false);
    reloadState();
  } catch (e) {
    setContinueErr(e.message || String(e));
  } finally {
    setContinueBusy(false);
  }
};
```

并在 `return (...)` 末尾、根 `</div>` 之前插入 modal（参考已有 `modelModalOpen` 的渲染位置）：

```jsx
{continueModalOpen && (
  <div className="modal-backdrop" onClick={() => !continueBusy && setContinueModalOpen(false)}>
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
      <div className="modal-head">
        <div className="modal-title">续写本书</div>
        <button className="iconbtn" onClick={() => !continueBusy && setContinueModalOpen(false)}><I.X size={14} /></button>
      </div>
      <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
          当前 <span className="mono" style={{ color: "var(--text-0)" }}>{target}</span> 章已完成。把目标章数改大，AI 会生成"续集卷"大纲、分卷、弧线，并按续集上下文继续写章节。
        </div>
        <label style={{ fontSize: 12, color: "var(--text-3)" }}>新目标章数</label>
        <input
          type="number"
          className="input"
          value={continueTarget}
          onChange={(e) => setContinueTarget(e.target.value)}
          min={target + 1}
          autoFocus
        />
        {continueErr && <div style={{ color: "var(--danger, #e5484d)", fontSize: 12 }}>{continueErr}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={() => setContinueModalOpen(false)} disabled={continueBusy}>取消</button>
        <button className="btn brand" onClick={submitContinue} disabled={continueBusy}>{continueBusy ? "提交中…" : "开始续写"}</button>
      </div>
    </div>
  </div>
)}
```

如果 `I.Plus` 不存在，先在 `bixian/static/icons.jsx` 里加（或者复用其他可用 icon 比如 `I.ChevronUp`、`I.ArrowUp`）。

- [ ] **Step 10.3: 重建前端 bundle**

```bash
npm run build:static
```

期望：dist/app.js 更新无报错。

- [ ] **Step 10.4: 提交**

```bash
git add bixian/static/api.jsx bixian/static/screens/progress.jsx bixian/static/icons.jsx
git commit -m "feat(ui): add continue-writing button + dialog on progress page"
```

---

## Task 11: 冒烟测试 — 把参考书续写 2 章

**Files:** （无代码改动，仅运行验证）

- [ ] **Step 11.1: 复制参考书到本工程的 .runtime/**

```bash
mkdir -p /Users/leo/dev/Gentleflow/BiXian-AI-Novel/.runtime
cp -R "/Users/leo/dev/Ai/bihua-novel-py/.runtime/我是一个外卖小哥家里穷的-20260515-082913" /Users/leo/dev/Gentleflow/BiXian-AI-Novel/.runtime/
```

确认目录存在：

```bash
ls /Users/leo/dev/Gentleflow/BiXian-AI-Novel/.runtime/
```

- [ ] **Step 11.2: 启动服务**

```bash
cd /Users/leo/dev/Gentleflow/BiXian-AI-Novel && ./start.sh
```

期望：终端打印 `笔仙助手: http://127.0.0.1:8000`。后台运行（用 run_in_background）。

- [ ] **Step 11.3: 调 /api/continue 直接验证后端**

```bash
curl -s http://127.0.0.1:8000/api/projects | python3 -c 'import sys,json; ps=json.load(sys.stdin); print([p["id"] for p in ps])'
```

找到参考书的 project_id。然后：

```bash
curl -s -X POST http://127.0.0.1:8000/api/continue \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"我是一个外卖小哥家里穷的-20260515-082913","target_chapters":32}'
```

期望返回 `{"ok":true,...}`。

- [ ] **Step 11.4: 等续写完成，观察 SSE 事件流**

```bash
curl -s -N "http://127.0.0.1:8000/api/events?project_id=我是一个外卖小哥家里穷的-20260515-082913" | head -200
```

期望看到事件顺序：
- `phase_started phase=continuation`
- `agent_started agent=prior_summary` → `agent_completed`
- `agent_started agent=continuation_outline` → `agent_completed`
- `agent_started agent=continuation_volume` → `agent_completed`
- `agent_started agent=continuation_arcs` → `agent_completed`
- `phase_started phase=design`
- `chapter_design_range[31-32]`
- `phase_started phase=write`
- `chapter_started order=31` → `chapter_completed`
- `chapter_started order=32` → `chapter_completed`
- `pipeline_completed mode=continue`

- [ ] **Step 11.5: 验收磁盘产物**

```bash
PROJ=/Users/leo/dev/Gentleflow/BiXian-AI-Novel/.runtime/我是一个外卖小哥家里穷的-20260515-082913
ls $PROJ/designs/031.md $PROJ/designs/032.md $PROJ/chapters/031/body.md $PROJ/chapters/032/body.md
python3 -c "import json; d=json.load(open('$PROJ/project.json')); print('target=',d['setup']['target_chapters']); print('continuations=',len(d.get('continuations',[])))"
```

期望：
- 4 个文件都存在
- `target=32`
- `continuations=1`

- [ ] **Step 11.6: 人工读 31 章正文，3 条硬指标**

```bash
cat /Users/leo/dev/Gentleflow/BiXian-AI-Novel/.runtime/我是一个外卖小哥家里穷的-20260515-082913/chapters/031/body.md
```

检查（人工判断）：

1. **不重复爽点**：31 章不能是又一次"店员/服务员被打脸"模板
2. **人物状态连续**：30 章末主角已搬进中心区公寓，31 章不能突然又在城中村
3. **新冲突出现**：应能识别出 31 章引入了续集大纲的新元素（看续集 outline 内容对照）

如有任意一条不达标，先看续集 outline (`cat $PROJ/project.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["continuations"][0]["outline"])'`) 是否方向跑偏，再定位是 prompt 问题还是路由问题。

- [ ] **Step 11.7: 关停服务**

按 Ctrl+C 或 kill 后台进程。

- [ ] **Step 11.8: 不 commit 测试产物**

`.runtime/` 已被 `.gitignore` 排除（如果没有，加一条）。验证：

```bash
git status --short
```

期望：只显示之前 commit 后的工作树状态，没有 `.runtime/` 下的文件。

---

## Self-Review checklist（写完整份 plan 后我自查）

- [ ] **Spec 覆盖**: §3 数据模型 → Task 1+2；§4 流水线 → Task 3-6；§5 Orchestrator+API → Task 7-9；§6 前端 → Task 10；§8 验证 → Task 11。全部覆盖。
- [ ] **Placeholder scan**: 无 TBD/TODO/"实现略"等。
- [ ] **类型一致**: Continuation 字段在 state.mjs / project.mjs / orchestrator / agents 全部一致使用 from_chapter/to_chapter/prev_target/outline/volumes/arcs/prev_summary。
- [ ] **YAGNI**: 无单元测试任务（设计文档明确不写）；无封面/书名续生成；无续写撤销。
