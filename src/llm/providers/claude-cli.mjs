import { LLMProvider, EMPTY_USAGE } from '../provider.mjs';
import { runAsync } from '../runtime.mjs';

function parseText(stdout) {
  try {
    const data = JSON.parse(stdout);
    return data.result || data.content || stdout;
  } catch {
    return String(stdout || '').trim();
  }
}

function parseUsage(stdout) {
  try {
    const data = JSON.parse(stdout);
    const u = data.usage || {};
    return {
      tokens_in: Number(u.input_tokens || 0),
      tokens_out: Number(u.output_tokens || 0),
      cached_in: Number(u.cache_read_input_tokens || 0),
      reasoning_out: 0,
    };
  } catch {
    return EMPTY_USAGE();
  }
}

export class ClaudeCliProvider extends LLMProvider {
  static id = 'claude';

  constructor({ binary = 'claude', extra_args = [] } = {}) {
    super();
    this.binary = binary;
    this.extra_args = extra_args;
  }

  get capabilities() { return { chat: true, image: false, schema: false, json: true }; }

  async chat({ system, user, model, signal, timeout, agentName = 'agent' }) {
    const cmd = [
      this.binary, '-p', '-',
      '--model', model,
      '--output-format', 'json',
      '--max-turns', '1',
      '--allowedTools', '',
      '--system-prompt', system,
      ...this.extra_args,
    ];
    const res = await runAsync(cmd[0], cmd.slice(1), { input: user, timeout, agentName, signal });
    return { text: parseText(res.stdout), usage: parseUsage(res.stdout) };
  }
}
