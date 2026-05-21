import { LLMProvider, EMPTY_USAGE } from '../provider.mjs';
import { runAsync } from '../runtime.mjs';

const CHAT_OUTPUT_POLICY = `

---

# OUTPUT POLICY
- Output ONLY the requested content.
- Do not call tools, do not edit files, do not run shell commands.
- Reply once and stop.
`;

function composePrompt(system, user) {
  return `# SYSTEM INSTRUCTIONS (highest priority - follow exactly)

${String(system || '').trim()}

---

# USER REQUEST

${String(user || '').trim()}${CHAT_OUTPUT_POLICY}`;
}

function textFromValue(value, out) {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) textFromValue(item, out);
    return;
  }
  if (typeof value.text === 'string') textFromValue(value.text, out);
  if (typeof value.delta === 'string') textFromValue(value.delta, out);
  if (typeof value.content === 'string') textFromValue(value.content, out);
  if (Array.isArray(value.content)) textFromValue(value.content, out);
  if (Array.isArray(value.parts)) textFromValue(value.parts, out);
  if (value.message && typeof value.message === 'object') textFromValue(value.message, out);
}

function parseJsonStreamText(stdout) {
  const chunks = [];
  let parsedAny = false;
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      parsedAny = true;
      textFromValue(event, chunks);
    } catch {}
  }
  const text = chunks.join('').trim();
  return text || (parsedAny ? '' : String(stdout || '').trim());
}

function parsePlainText(stdout) {
  return String(stdout || '').trim();
}

export class CliAgentProvider extends LLMProvider {
  static id = 'cli-agent';

  constructor({ binary, buildArgs, parse = 'plain', env = {}, extra_args = [] } = {}) {
    super();
    this.binary = binary;
    this.buildArgs = buildArgs;
    this.parse = parse;
    this.env = env;
    this.extra_args = extra_args;
  }

  get capabilities() { return { chat: true, image: false, schema: false, json: true }; }

  async chat({ system, user, model, signal, timeout, agentName = 'agent' }) {
    const args = this.buildArgs({ model }).concat(this.extra_args || []);
    const res = await runAsync(this.binary, args, {
      input: composePrompt(system, user),
      timeout,
      agentName,
      signal,
      env: { ...process.env, ...(this.env || {}) },
    });
    const text = this.parse === 'json-stream'
      ? parseJsonStreamText(res.stdout)
      : parsePlainText(res.stdout);
    return { text, usage: EMPTY_USAGE() };
  }
}

export class GeminiProvider extends CliAgentProvider {
  static id = 'gemini';
  constructor({ binary = 'gemini', extra_args = [] } = {}) {
    super({
      binary,
      extra_args,
      parse: 'json-stream',
      env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      buildArgs: ({ model }) => {
        const args = ['--output-format', 'stream-json', '--yolo'];
        if (model) args.push('--model', model);
        return args;
      },
    });
  }
}

export class QwenProvider extends CliAgentProvider {
  static id = 'qwen';
  constructor({ binary = 'qwen', extra_args = [] } = {}) {
    super({
      binary,
      extra_args,
      parse: 'plain',
      buildArgs: ({ model }) => {
        const args = ['--yolo'];
        if (model) args.push('--model', model);
        return args;
      },
    });
  }
}

export class OpenCodeProvider extends CliAgentProvider {
  static id = 'opencode';
  constructor({ binary = 'opencode', extra_args = [] } = {}) {
    super({
      binary,
      extra_args,
      parse: 'json-stream',
      buildArgs: ({ model }) => {
        const args = ['run', '--format', 'json', '--dangerously-skip-permissions'];
        if (model) args.push('--model', model);
        return args;
      },
    });
  }
}
