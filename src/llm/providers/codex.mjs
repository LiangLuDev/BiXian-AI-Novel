import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LLMProvider, EMPTY_USAGE } from '../provider.mjs';
import { LLMError } from '../errors.mjs';
import { runAsync } from '../runtime.mjs';

const CHAT_OUTPUT_POLICY = `

---

# OUTPUT POLICY
- Output ONLY the requested content. Do not call any tools, do not write files, do not run commands.
- Reply once and stop.
`;

const COVER_PROMPT_TEMPLATE = (title, prompt, out, aspectRatio) =>
  `你是小说封面生图子代理。请使用 Codex 可用的 image_gen / 图像生成能力，根据下面的中文 prompt 生成一张竖版小说封面图，并把最终图片保存到指定路径。

要求：
- 必须实际调用图像生成能力，不要生成 SVG/HTML/占位图/代码图。
- 画幅：竖版 ${aspectRatio}，最终成图按 600x800 封面尺寸来生成或导出。
- 图片中必须出现且只出现书名《${title || '未命名'}》。
- 书名位置不要紧贴顶部边缘，应位于画面距顶部约 3/8 高度处，保持明显留白。
- 书名字体要大、高对比、适合网文封面缩略图。
- 除书名外，不要出现任何其他文字、英文、数字、Logo、水印、二维码、签名。
- 如果生成工具返回临时图片文件，请复制或移动到【输出路径】。
- 完成后只回复保存路径；不要解释。

【必须写进图片的书名】
${title || '未命名'}

【图像 prompt】
${String(prompt || '').trim()}

【输出路径】
${out}
`;

function parseUsage(stdout) {
  const out = EMPTY_USAGE();
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    try {
      const ev = JSON.parse(line);
      if (ev.type !== 'turn.completed') continue;
      const u = ev.usage || {};
      out.tokens_in += Number(u.input_tokens || 0);
      out.tokens_out += Number(u.output_tokens || 0);
      out.cached_in += Number(u.cached_input_tokens || 0);
      out.reasoning_out += Number(u.reasoning_output_tokens || 0);
    } catch {}
  }
  return out;
}

function scrapeLastMessage(stdout) {
  let last = '';
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    try {
      const ev = JSON.parse(line);
      if (ev.message || ev.content || ev.text) last = ev.message || ev.content || ev.text;
      if (ev.type === 'response_item' && ev.item) {
        if (ev.item.message || ev.item.content || ev.item.text) last = ev.item.message || ev.item.content || ev.item.text;
        if (Array.isArray(ev.item.content)) {
          const text = ev.item.content
            .map((part) => part?.text || part?.content || '')
            .filter(Boolean)
            .join('');
          if (text.trim()) last = text;
        }
      }
    } catch {}
  }
  return String(last).trim();
}

function readLastMessage(outPath, stdout = '') {
  return fs.existsSync(outPath)
    ? fs.readFileSync(outPath, 'utf8').trim()
    : scrapeLastMessage(stdout);
}

function isRecoverableMaxTurns(error) {
  const combined = `${error?.stderr || ''}\n${error?.stdout || ''}\n${error?.message || ''}`;
  return /"terminal_reason"\s*:\s*"max_turns"/u.test(combined)
    || /Reached maximum number of turns/iu.test(combined);
}

export class CodexProvider extends LLMProvider {
  static id = 'codex';

  constructor({
    binary = 'codex',
    sandbox = 'read-only',
    ephemeral = true,
    skip_git_repo_check = true,
    extra_args = [],
  } = {}) {
    super();
    this.binary = binary;
    this.sandbox = sandbox;
    this.ephemeral = ephemeral;
    this.skip_git_repo_check = skip_git_repo_check;
    this.extra_args = extra_args;
  }

  get capabilities() { return { chat: true, image: true, schema: true, json: true }; }

  async chat({ system, user, model, schema, signal, timeout, agentName = 'agent' }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bixian-llm-'));
    const outPath = path.join(tmp, 'last.txt');

    const cmd = [this.binary, 'exec'];
    if (this.ephemeral) cmd.push('--ephemeral');
    if (this.skip_git_repo_check) cmd.push('--skip-git-repo-check');
    cmd.push('-s', this.sandbox, '--json', '--output-last-message', outPath);
    if (model) cmd.push('-m', model);
    if (schema) {
      const schemaPath = path.join(tmp, 'schema.json');
      fs.writeFileSync(schemaPath, JSON.stringify(schema), 'utf8');
      cmd.push('--output-schema', schemaPath);
    }
    cmd.push(...this.extra_args, '-');

    const input = `# SYSTEM INSTRUCTIONS (highest priority — follow exactly)\n\n${system.trim()}\n\n---\n\n# USER REQUEST\n\n${user.trim()}${CHAT_OUTPUT_POLICY}`;

    try {
      const res = await runAsync(cmd[0], cmd.slice(1), { input, timeout, agentName, signal });
      return { text: readLastMessage(outPath, res.stdout), usage: parseUsage(res.stdout) };
    } catch (error) {
      const text = readLastMessage(outPath, error?.stdout || '');
      if (text && isRecoverableMaxTurns(error)) {
        return { text, usage: parseUsage(error?.stdout || '') };
      }
      throw error;
    }
  }

  async generateImage({ prompt, outputPath, title = '', aspectRatio = '3:4', signal, timeout, agentName = 'cover_image', model }) {
    const out = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch {}

    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `bixian-${agentName}-`));
    const cmd = [this.binary, 'exec'];
    if (this.ephemeral) cmd.push('--ephemeral');
    if (this.skip_git_repo_check) cmd.push('--skip-git-repo-check');
    cmd.push('-s', 'workspace-write', '--json');
    if (model) cmd.push('-m', model);
    cmd.push(...this.extra_args, '-');

    const res = await runAsync(cmd[0], cmd.slice(1), {
      input: COVER_PROMPT_TEMPLATE(title, prompt, out, aspectRatio),
      cwd: workdir,
      timeout,
      agentName,
      signal,
    });

    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      throw new LLMError(`${agentName}: image not generated at ${out}`);
    }
    return { path: out, usage: parseUsage(res.stdout) };
  }
}
