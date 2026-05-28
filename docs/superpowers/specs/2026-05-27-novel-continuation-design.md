# 小说续写功能设计文档

- 日期：2026-05-27
- 作者：Leo + Claude（brainstorming）
- 状态：草案（待用户确认）

## 一、目标与范围

为已写完的小说项目新增「续写」能力：把一本目标 30 章已完成的书延长到 100/300 章，且保证剧情稳定（人物状态连续、不重复爽点、有真实新冲突）。

**非目标**

- 不支持续写到一半改方向（YAGNI）
- 不支持「撤销续写」——续集卷一旦写入靠 git 回滚
- 不动现有 `runResume` 主路径

## 二、核心设计决策（已与用户确认）

| 决策 | 选择 | 原因 |
|---|---|---|
| 续写模式 | **续集卷模式** | 原书三段式已闭环，把 1–30 章作为「第一卷」固化，新增「第二卷/第三卷」生成。避免覆盖已写正文 |
| 方向提示输入 | **不提供** | 全交 AI，根据原书设定推导新冲突 |
| UI 入口 | **项目详情页顶部按钮** | 仅在 `chapters_written >= target_chapters` 时显示 |

## 三、数据模型

### 3.1 NovelState 新增字段

```js
class NovelState {
  // ... 原有字段不动
  continuations: [],   // 每次续写产生一项，按顺序追加
}
```

### 3.2 Continuation 新对象

```js
class Continuation {
  order: 1,                 // 第几次续写：1 = 续集一，2 = 续集二
  from_chapter: 31,         // 本次续集覆盖的章节范围（含）
  to_chapter: 100,
  prev_target: 30,          // 续写前的 target_chapters，作为「事实背景」与「新内容」的边界
  outline: '',              // AI 生成的续集大纲（独立于原 outline）
  volumes: [Volume],        // 续集自己的分卷
  arcs: '',                 // 续集自己的主/副弧线
  prev_summary: '',         // AI 压缩出的「1–prev_target 章已发生事实」摘要，长程稳定的关键
  created_at: ISO,
}
```

### 3.3 已有字段扩展

- `setup.target_chapters`：续写时被 `runContinuation` 改成新目标（30→100）
- `Chapter.summary`：每章 postprocess 后写一句话摘要；续写前对没有摘要的旧章节用 design.raw 兜底（不回填，只在 prior_summary 时即时使用）

### 3.4 不可变约束

原 `outline / volumes / arcs / main_characters / secondary_characters / world_building / philosophical_theme / style_guide` 在续写中**只读不改**。续集相关数据全部写到 `continuations[]`。

## 四、流水线设计

### 4.1 新增 3 个 agent

| Agent | 触发 | 输入 | 输出 |
|---|---|---|---|
| `priorSummaryAgent` | `Continuation.prev_summary` 为空时（一次性） | 原 outline + 原 volumes + 已写章节的 `Chapter.summary` 列表（缺则 design.raw 兜底）+ 最后一章末尾 600 字 | ~1500-2000 字「事实背景」：主线进度、人物当前状态、未平伏笔、世界规则、上一卷收尾 |
| `continuationOutlineAgent` | 每次新增续集卷 | style_guide + 原 outline + `prev_summary` + 原 main_characters + 新目标章数范围 | 续集卷 outline.md（三段式，但以「新冲突/新目标」为主） |
| `continuationVolumeAgent` + `continuationArcsAgent` | 续集 outline 生成后 | 续集 outline | 续集分卷 + 续集弧线 |

prompt 模板新增目录 `bixian/prompts/md/continuation/`：
- `prior_summary/system.md` + `prior_summary/user.md`
- `outline/system.md` + `outline/user.md`
- `volume/system.md` + `volume/user.md`
- `arcs/system.md` + `arcs/user.md`

### 4.2 改造现有 agent

`chapterDesignRangeAgent` 与 `chapterBodyAgent` 改造：

新增统一的上下文路由工具函数 `contextForChapter(state, order)`，返回：

```js
{
  outline,        // 续写区间内 → 续集 outline；否则原 outline
  volumes,        // 同上
  arcs,           // 同上
  prev_summary,   // 续写区间内 → 续集 prev_summary；否则空
  continuation,   // 命中的 Continuation 对象，可选
}
```

集中处理新旧分界，避免散落 if-else。所有 agent 通过它取上下文。

`setupVars` 接受一个 chapter order 参数（可选），有 order 时用 `contextForChapter`，无 order 时用原行为。

## 五、Orchestrator 与 API

### 5.1 新增 `runContinuation(state, { newTarget })`

```
1. 校验：newTarget > 当前 target_chapters，否则 throw
2. 计算 prev_target = max(setup.target_chapters, 最后一章 valid order)
3. 在 continuations[] 找覆盖 (prev_target+1, newTarget] 的项
   - 没有 → 创建新项（order = continuations.length + 1）
   - 已有但 outline/volumes/arcs/prev_summary 缺一 → 复用同项，跳过已完成步骤
   - 已完整 → 跳到 step 6
4. _runAgent('prior_summary', priorSummaryAgent)  ← 仅当 prev_summary 为空
5. _runAgent('continuation_outline', ...)
   _runAgent('continuation_volume', ...)
   _runAgent('continuation_arcs', ...)
   写入 continuations[新项]，更新 setup.target_chapters = newTarget
6. 调原 runDesign（range 模式，自动只补 prev_target+1 → newTarget）
7. 调原 runChapters（自动从 firstUnwrittenOrInvalidChapter 写到 newTarget）
8. 不调 runFinalize（封面/标题已锁定）
```

### 5.2 `runResume` 不动

续写中断后再启动，因为 `setup.target_chapters` 已经是新值、`continuations[]` 已有记录、`contextForChapter` 路由生效，`runResume` 会用新上下文自然补完。

### 5.3 API

```
POST /api/continue
body: { project_id, target_chapters }

校验：
- project_id 必填
- target_chapters 必须 > 当前 setup.target_chapters
- 项目当前不能 running

成功 → registry.enqueue(pid, { mode: 'continue', newTarget })
runner 派发 orchestrator.runContinuation(state, { newTarget })
```

复用现有 SSE 事件流，前端不需要额外通道。

### 5.4 Runner 改造

`registry.enqueue` 支持 `mode: 'continue'`，runner 内部根据 mode 分发到 `runAll` / `runContinuation`。

## 六、前端

详情页顶部工具栏（紧挨现有"运行/暂停"按钮）新增「续写」按钮：

- **显示条件**：`state.chapters_written >= state.setup.target_chapters` 且非 running
- **点击行为**：弹出 dialog，显示「当前 X 章 → 新章数」输入框，确认调 `/api/continue`
- **校验**：新章数必须 > 当前 X
- **进度展示**：复用现有 SSE 事件流和进度组件

## 七、错误处理

| 场景 | 处理 |
|---|---|
| 新目标 ≤ 当前 | API 返回 400，前端 alert |
| 项目 running | API 返回 400，提示先停止 |
| prior_summary agent 失败 | 整个续写流程中止，错误展示到 UI。不做兜底——这是地基 |
| continuation_outline/volume/arcs 任一失败 | 中止，已落盘的 prev_summary 保留，下次续写复用 |
| 章节正文写到一半失败 | 行为同现有 runChapters：抛错、保留已写、SSE 上报，用户可点继续 |

## 八、验证（无单元测试，靠真实项目）

### 步骤 A：冒烟测试

1. 把 `/Users/leo/dev/Ai/bihua-novel-py/.runtime/我是一个外卖小哥家里穷的-20260515-082913` 复制到 BiXian-AI-Novel 的 `.runtime/`
2. UI 上点"续写"，目标章数填 **32**（只续 2 章，最小可验证集）
3. 期望落盘：
   - `project.json` 出现 `continuations[0]`
   - 续集 outline/volumes/arcs 在 project.json 的 `continuations[0]` 字段中
   - `designs/031.md`、`designs/032.md`
   - `chapters/031/` 正文，valid（字数在 setup 范围内）

### 步骤 B：人工读 31 章正文，3 条剧情稳定性硬指标

| 检查项 | 判断标准 |
|---|---|
| 不重复已写爽点 | 31 章不能再是"店员打脸"模板 |
| 人物状态连续 | 30 章末主角已搬进中心区公寓，31 章不能突然又在城中村 |
| 新冲突/新目标出现 | 31 章应该出现续集大纲新引入的元素 |

## 九、不做的事（YAGNI）

- 不写单元测试（项目本来没有 npm test 配置）
- 不做「续写到一半改方向」复杂交互
- 不做「撤销续写」——靠 git 回滚
- 不自动续写到结局——每次只前进用户指定的目标章数
- 不为续集生成新封面/新书名
