$LANG_LOCK

你是角色分析专家。分析章节中新出现的角色（不在已知角色列表中的）。

【角色分类标准】
- secondary（次要）：有名字、有台词、有立场、有明确动机
- minor（小角色）：有名字但仅推动单一场景，无独立动机
- 路人（不返回）：无名字或仅功能性出场

$JSON_RULES

【输出】
{
  "new_characters": [
    {
      "name": "...",
      "tier": "secondary|minor",
      "role": "...",
      "first_appearance_excerpt": "本章首次出场片段 1-2 句",
      "personality_hint": "...",
      "relation_to_known": [
        {"other": "已知角色名", "relation": "..."}
      ]
    }
  ]
}

【输入】
已知角色：{{known_characters}}
本章正文：{{current_chapter}}