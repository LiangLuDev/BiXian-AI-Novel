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
    this.imageProviderFactory = createProvider;
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
      return parseJsonText(raw);
    } catch (firstError) {
      if (opts.repairJson === false) {
        throw jsonError(firstError, raw, opts.agentName);
      }
      const repaired = await this.repairJson(raw, opts, firstError);
      try {
        return parseJsonText(repaired);
      } catch (repairError) {
        throw jsonError(repairError, raw, opts.agentName, firstError);
      }
    }
  }

  async repairJson(raw, opts = {}, parseError = null) {
    const system = [
      '你是 JSON 语法修复器。',
      '只修复输入文本中的 JSON 语法错误，不改写、不增删、不翻译任何业务内容。',
      '输出必须是一个可被 JSON.parse 解析的 JSON 对象或数组。',
      '不要输出 markdown 代码块、解释、前后缀文字。',
    ].join('\n');
    const user = [
      '下面文本应该是 JSON，但解析失败。',
      parseError ? `解析错误：${parseError.message}` : '',
      '请修复为合法 JSON：',
      '',
      String(raw || ''),
    ].filter(Boolean).join('\n');
    const agentName = `${opts.agentName || 'agent'}_json_repair`;
    return this.chat(system, user, { ...opts, agentName, longForm: false, schema: null });
  }

  async generateImage(prompt, outputPath, { title = '', aspectRatio = '3:4', agentName = 'cover_image' } = {}) {
    let provider = this.provider;
    let backend = this.backend;
    let imageConfig = this.config;
    if (!provider.capabilities.image) {
      backend = this.config.image_backend || this.config.extra?.image_backend || 'codex';
      imageConfig = LLMConfig.forBackend(backend, {
        model: this.config.image_model || this.config.extra?.image_model || null,
        model_image: this.config.model_image,
        timeout: this.config.timeout,
        extra: this.config.extra?.image_extra || {},
      });
      provider = this.imageProviderFactory(imageConfig);
      if (!provider.capabilities.image) {
        throw new LLMNotSupportedError(`image generation requires a backend with image support (got ${this.backend}, fallback ${backend})`);
      }
    }
    const started = Date.now();
    const model = imageConfig.model || imageConfig.model_image || imageConfig.model_cheap;
    const { path: finalPath, usage } = await provider.generateImage({
      prompt, outputPath, title, aspectRatio,
      signal: this.abortSignal,
      timeout: imageConfig.timeout,
      agentName, model,
    });
    this.usageLog.push({ agent: agentName, backend, model, ...usage, elapsed_ms: Date.now() - started });
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

function parseJsonText(raw) {
  return JSON.parse(stripJsonFence(raw));
}

function preview(raw, limit = 500) {
  const text = String(raw || '').replace(/\s+/gu, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function jsonError(error, raw, agentName = '', firstError = null) {
  const suffix = firstError ? `; first parse error: ${firstError.message}` : '';
  return new LLMJSONError(
    `LLM output is not valid JSON: ${error.message}${suffix}; raw preview: ${preview(raw)}`,
    { raw, agent: agentName },
  );
}
