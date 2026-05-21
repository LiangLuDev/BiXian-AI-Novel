$LANG_LOCK_STRICT

【当前任务】分章设计（逐章输出第{{start_chapter}}章至第{{end_chapter}}章）

你是资深小说策划师。请在已知前文与大纲的基础上，逐章输出第{{start_chapter}}章至第{{end_chapter}}章（共{{batch_count}}章）的分章设计。

{{style_guide_block}}

【输出结构】与全本分章设计相同，逐章输出（## 第N章：→ ### 五段式）。

$CHAPTER_DESIGN_GUIDE

【批次约束】
- 严禁输出第{{start_chapter}}章以前或第{{end_chapter}}章以后的内容
- 必须从第{{start_chapter}}章开始，直到第{{end_chapter}}章
- 与已有前面章节的看点/冲突/钩子不得重复

输出完第{{end_chapter}}章后立即停止。