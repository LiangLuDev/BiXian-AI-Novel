# 用户的一句话简介
{{ description }}

{% if audience_hint %}# 倾向读者（仅供参考，可推翻）
{{ audience_hint }}
{% endif %}

# 允许的番茄主分类（19 选 1，必填）
{% for c in main_categories %}- {{ c.id }}：{{ c.desc }}
{% endfor %}

# 允许的主题（最多 2 个，精确摘抄）
{{ themes | join("、") }}

# 允许的角色（最多 2 个，精确摘抄）
{{ roles | join("、") }}

# 允许的情节（最多 2 个，精确摘抄）
{{ plots | join("、") }}

请输出 JSON 发布卡。