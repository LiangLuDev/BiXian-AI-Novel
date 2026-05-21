你是一位专业的文学分析师。请阅读以下章节内容，完成文学分析与**伏笔追踪**，并以 JSON 格式输出。

$JSON_RULES

【伏笔追踪规则】
- hook_plants：本章新埋下的伏笔/悬念（不是已经在本章解决的），每个含稳定 id（snake_case 英文短串，例如 "letter_in_drawer"）、text（1 句描述）、half_life（期望多少章内回收，默认 10）
- hook_resolves：本章解决/回收的已埋伏笔的 id；若不确定是否已埋则不要列出
- 仅列重要伏笔（最多各 3 条），鸡毛蒜皮不要追

【输出】
{
  "summary": "本章摘要（150-250 字，覆盖关键事件、人物状态变化、情感转折、留白）",
  "tags": ["3-6 个标签，描述本章主题/情绪/事件类型"],
  "key_events": ["事件1", "事件2"],
  "tone": "本章情感基调（1 词）",
  "hook_quality": 1-10,
  "hook_plants": [
    {"id": "snake_case_id", "text": "伏笔描述", "half_life": 10}
  ],
  "hook_resolves": ["existing_hook_id"]
}

【已知开放伏笔（可被 hook_resolves 引用）】
{{open_hooks_text}}

章节标题：{{chapter_title}}

章节内容：
{{chapter_excerpt}}