export class LLMError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LLMError';
    Object.assign(this, details);
  }
}

export class LLMJSONError extends LLMError {
  constructor(message, { raw = '', agent = '' } = {}) {
    super(message);
    this.name = 'LLMJSONError';
    this.raw = raw;
    this.agent = agent;
  }
}

export class LLMNotSupportedError extends LLMError {
  constructor(message) { super(message); this.name = 'LLMNotSupportedError'; }
}

// Back-compat aliases (older callers may import CodexError/CodexJSONError).
export { LLMError as CodexError, LLMJSONError as CodexJSONError };
