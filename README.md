<p align="center">
  <img src="og-image.png" alt="笔仙助手 — 三句话，AI 写完一本小说" width="900">
</p>

# 笔仙助手 · BiXian AI Novel

> 三句话，AI 写完一本小说。

一个 AI 全自动写作工作台。一句简介、一个类型、一个章节数，其余的世界观、人物、大纲、章节正文，全部交给 AI。

网站：https://liangludev.github.io/BiXian-AI-Novel/

## 下载

进入 [最新版本](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest) 选择对应平台，或使用稳定直链：

| 平台 | 文件 |
|---|---|
| macOS · Apple Silicon | [`BiXianAssistant-mac-arm64.dmg`](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest/download/BiXianAssistant-mac-arm64.dmg) |
| macOS · Intel | [`BiXianAssistant-mac-x64.dmg`](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest/download/BiXianAssistant-mac-x64.dmg) |
| Windows · 安装器 | [`BiXianAssistant-win-x64-setup.exe`](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest/download/BiXianAssistant-win-x64-setup.exe) |
| Windows · 便携版 | [`BiXianAssistant-win-x64-portable.exe`](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest/download/BiXianAssistant-win-x64-portable.exe) |
| Linux · AppImage | [`BiXianAssistant-linux-x64.AppImage`](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest/download/BiXianAssistant-linux-x64.AppImage) |
| Linux · deb | [`BiXianAssistant-linux-amd64.deb`](https://github.com/LiangLuDev/BiXian-AI-Novel/releases/latest/download/BiXianAssistant-linux-amd64.deb) |

## 它能做什么

- **一句话开局，整本书产出**：从「一句简介 + 类型 + 章节数」一路跑到完整长篇——风格定调、世界观、人物卡、人物关系、主副线、分卷、章纲、正文、封面、出版元数据，全部 AI 接管
- **16 个专精 agent，按阶段流水线**：风格 → 主题 → 世界 → 大纲 → 分卷 → 人物 → 关系 → 弧线 → 章纲 → 正文 → 封面，每步独立 prompt 可复跑可断点
- **10 项内建质量检查**：剧情连贯性、伏笔追踪、人物指代、字数控制、人物关系抽取、文学性评估——不是写完拉倒，是写完会自检
- **网文专项调优**：内置反 AI 腔、开篇黄金三章、网文节奏、语言锁、时代锁、平台 4 维标签等 23 个可复用 prompt 块，针对番茄/起点书架转化率优化
- **139 个内置网文选题**：开箱即用，懒得想题材直接挑

## 产品长这样

<table>
  <tr>
    <td width="50%" align="center">
      <img src="attachments/2bded2c2-9cc4-4e9b-a7a3-312f99b386f9_ig_03e8f701e9938de7016a0c5a8aa7208193897d0f0ba54039b2.png" alt="书架"><br>
      <sub><b>书架</b> · 一屏管理所有在写小说</sub>
    </td>
    <td width="50%" align="center">
      <img src="attachments/97be61d0-72c1-4024-9ce8-d8a9e6637452_ig_03e8f701e9938de7016a0c5b3da2b88193964882f8b4b5dce3.png" alt="人物"><br>
      <sub><b>人物</b> · 主配角卡片 + 关系网络</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="attachments/43082693-7915-48f8-8845-8ba76b842bdc_ig_03e8f701e9938de7016a0c5b8b85588193bd4a69cfb3f5a951.png" alt="大纲"><br>
      <sub><b>大纲</b> · 分卷三幕节奏，AI 自动布局</sub>
    </td>
    <td align="center">
      <img src="attachments/ef863f06-df39-4f9f-ae8c-2f9661e8ecbb_ig_03e8f701e9938de7016a0c5beec67c8193afbc841078b93661.png" alt="阅读器"><br>
      <sub><b>阅读器</b> · 干净的章节正文展示</sub>
    </td>
  </tr>
</table>

## 它不一样的地方

- **不用配 API key**：直接调本机的 `codex` 或 `claude` CLI，不绑某家供应商
- **数据全在本地**：一本小说 = 一个目录，所有中间产物（人物卡、大纲、关系图、章节）都是结构化文件，可手动改、可断点续跑、可 git 版本管理
- **免费、本地、不上传**：除了 LLM 调用本身，没有任何数据离开你的机器

---

## 本地运行（开发者）

环境要求：Node 22+、本机已安装并登录 [`codex`](https://github.com/openai/codex) CLI（或 [`claude`](https://docs.claude.com/claude-code) CLI）。

```bash
./start.sh
```

自动安装依赖、构建前端、启动 Web，默认 `http://127.0.0.1:8000`。

可选环境变量：`HOST`、`PORT`、`WORKSPACE_DIR`（默认 `.runtime/`）。

## License

[MIT](./LICENSE)
