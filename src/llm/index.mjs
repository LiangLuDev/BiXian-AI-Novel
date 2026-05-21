import fs from 'node:fs';
import { usageSummary } from '../services/costing.mjs';
import { LLMConfig, createProvider } from './config.mjs';
import { LLMError, LLMJSONError, LLMNotSupportedError, CodexError, CodexJSONError } from './errors.mjs';

export { LLMConfig, createProvider };
export { LLMError, LLMJSONError, LLMNotSupportedError, CodexError, CodexJSONError };
export { detectAiBackends, aiCapabilityError, requireAiBackend, resetAiBackendCache } from './detect.mjs';
export { LLMProvider } from './provider.mjs';

export class LLM {
  constructor(config = new LLMConfig()) {
    this.config = config instanceof LLMConfig ? config : new LLMConfig(config);
    this.provider = createProvider(this.config);
    this.usageLog = [];
    this.abortSignal = null;
  }

  setAbortSignal(signal) { this.abortSignal = signal || null; return this; }

  get backend() { return this.config.backend; }
  get capabilities() { return this.provider.capabilities; }

  // Strong model for long-form/structural calls (chapter/design/outline/world…);
  // cheap model for short structured tasks (extract/title/qa/meta…); mid otherwise.
  pickModel(agentName = '', longForm = false) {
    if (this.config.model) return this.config.model;
    if (longForm || /chapter|design|outline|world|theme|arcs|body/u.test(agentName)) return this.config.model_strong;
    if (/extract|format|title|meta|qa|wordcount/u.test(agentName)) return this.config.model_cheap;
    return this.config.model_mid;
  }

  async chat(system, user, { agentName = 'agent', longForm = false, schema = null } = {}) {
    const model = this.pickModel(agentName, longForm);
    const started = Date.now();
    const { text, usage } = await this.provider.chat({
      system, user, model, schema,
      signal: this.abortSignal,
      timeout: longForm ? this.config.timeout_long : this.config.timeout,
      agentName,
      longForm,
    });
    this.usageLog.push({ agent: agentName, model, ...usage, elapsed_ms: Date.now() - started });
    return text;
  }

  async chatJson(system, user, opts = {}) {
    const raw = await this.chat(system, user, opts);
    try {
      return JSON.parse(stripJsonFence(raw));
    } catch {
      throw new LLMJSONError('LLM output is not valid JSON', { raw, agent: opts.agentName });
    }
  }

  async generateImage(prompt, outputPath, { title = '', aspectRatio = '3:4', agentName = 'cover_image' } = {}) {
    if (!this.provider.capabilities.image) {
      throw new LLMNotSupportedError(`image generation requires a backend with image support (got ${this.backend})`);
    }
    const started = Date.now();
    const model = this.config.model || this.config.model_image || this.config.model_cheap;
    const { path: finalPath, usage } = await this.provider.generateImage({
      prompt, outputPath, title, aspectRatio,
      signal: this.abortSignal,
      timeout: this.config.timeout,
      agentName, model,
    });
    this.usageLog.push({ agent: agentName, model, ...usage, elapsed_ms: Date.now() - started });
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size === 0) {
      throw new LLMError(`${agentName}: image not generated at ${finalPath}`);
    }
    return finalPath;
  }

  totalTokens() { return usageSummary(this.usageLog); }
}

function stripJsonFence(raw) {
  return String(raw).trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '');
}
