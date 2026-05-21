import { LLMNotSupportedError } from './errors.mjs';

// Strategy interface. Each backend implements chat() and optionally generateImage().
// Returns shape:
//   chat() -> { text: string, usage: { tokens_in, tokens_out, cached_in, reasoning_out } }
//   generateImage() -> absolute path string
export class LLMProvider {
  // Provider id, e.g. 'codex' / 'claude' / 'openai-api'. Subclasses override.
  static id = 'base';
  get id() { return this.constructor.id; }

  // Capabilities: features the orchestrator can probe before calling.
  get capabilities() {
    return { chat: true, image: false, schema: false, json: true };
  }

  async chat(/* { system, user, model, schema, signal, timeout, agentName, longForm } */) {
    throw new LLMNotSupportedError(`${this.id}: chat() not implemented`);
  }

  async generateImage(/* { prompt, outputPath, title, aspectRatio, signal, agentName } */) {
    throw new LLMNotSupportedError(`${this.id}: image generation not supported`);
  }
}

export const EMPTY_USAGE = () => ({ tokens_in: 0, tokens_out: 0, cached_in: 0, reasoning_out: 0 });
