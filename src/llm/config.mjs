import { LLMError } from './errors.mjs';
import { CodexProvider } from './providers/codex.mjs';
import { ClaudeCliProvider } from './providers/claude-cli.mjs';
import { GeminiProvider, OpenCodeProvider, QwenProvider } from './providers/cli-agent.mjs';
import { resolveCli } from './cli-resolver.mjs';

// Model-level config shared across all providers. Provider-specific knobs go
// under `extra`. New backends (openai-api, anthropic-api, openrouter…) just
// register in PROVIDER_FACTORIES below — no business-code changes required.
export class LLMConfig {
  constructor(data = {}) {
    Object.assign(this, {
      backend: 'codex',
      model: null,            // explicit override for any tier
      model_strong: 'gpt-5.5',
      model_mid: 'gpt-5.4',
      model_cheap: 'gpt-5.4-mini',
      model_image: 'gpt-5.4-mini',
      timeout: 600_000,
      timeout_long: 1_200_000,
      // Provider-specific options live here. CLI providers read binary/sandbox/etc.;
      // API providers will read apiKey/baseUrl/etc. Unknown keys are ignored.
      extra: {},
      // Legacy fields kept for backwards-compat with old call sites. Treated
      // as part of `extra` for CLI providers.
      binary: undefined,
      sandbox: undefined,
      ephemeral: undefined,
      skip_git_repo_check: undefined,
      extra_args: undefined,
    }, data);
  }

  static forClaude(data = {}) {
    return new LLMConfig({
      backend: 'claude',
      model_strong: 'claude-sonnet-4-6',
      model_mid: 'claude-sonnet-4-6',
      model_cheap: 'claude-haiku-4-5',
      ...data,
    });
  }

  static forBackend(backend = 'codex', data = {}) {
    if (backend === 'claude') return LLMConfig.forClaude(data);
    if (backend === 'gemini') {
      return new LLMConfig({
        backend,
        model_strong: 'gemini-3-pro-preview',
        model_mid: 'gemini-2.5-pro',
        model_cheap: 'gemini-2.5-flash',
        ...data,
      });
    }
    if (backend === 'qwen') {
      return new LLMConfig({
        backend,
        model_strong: 'qwen3-coder-plus',
        model_mid: 'qwen3-coder-plus',
        model_cheap: 'qwen3-coder-flash',
        ...data,
      });
    }
    if (backend === 'opencode') {
      return new LLMConfig({
        backend,
        model_strong: 'anthropic/claude-sonnet-4-5',
        model_mid: 'openai/gpt-5',
        model_cheap: 'google/gemini-2.5-pro',
        ...data,
      });
    }
    return new LLMConfig({ backend, ...data });
  }
}

// Backend id → provider factory. Add new providers here.
const PROVIDER_FACTORIES = {
  codex: (cfg) => {
    const explicit = cfg.binary ?? cfg.extra.binary;
    const resolved = explicit ? null : resolveCli('codex');
    return new CodexProvider({
      binary: explicit ?? resolved?.launchPath ?? 'codex',
      sandbox: cfg.sandbox ?? cfg.extra.sandbox ?? 'read-only',
      ephemeral: cfg.ephemeral ?? cfg.extra.ephemeral ?? true,
      skip_git_repo_check: cfg.skip_git_repo_check ?? cfg.extra.skip_git_repo_check ?? true,
      extra_args: cfg.extra_args ?? cfg.extra.extra_args ?? [],
    });
  },
  claude: (cfg) => {
    const explicit = cfg.binary ?? cfg.extra.binary;
    const resolved = explicit ? null : resolveCli('claude');
    return new ClaudeCliProvider({
      binary: explicit ?? resolved?.launchPath ?? 'claude',
      extra_args: cfg.extra_args ?? cfg.extra.extra_args ?? [],
    });
  },
  gemini: (cfg) => {
    const explicit = cfg.binary ?? cfg.extra.binary;
    const resolved = explicit ? null : resolveCli('gemini');
    return new GeminiProvider({
      binary: explicit ?? resolved?.launchPath ?? 'gemini',
      extra_args: cfg.extra_args ?? cfg.extra.extra_args ?? [],
    });
  },
  qwen: (cfg) => {
    const explicit = cfg.binary ?? cfg.extra.binary;
    const resolved = explicit ? null : resolveCli('qwen');
    return new QwenProvider({
      binary: explicit ?? resolved?.launchPath ?? 'qwen',
      extra_args: cfg.extra_args ?? cfg.extra.extra_args ?? [],
    });
  },
  opencode: (cfg) => {
    const explicit = cfg.binary ?? cfg.extra.binary;
    const resolved = explicit ? null : resolveCli('opencode');
    return new OpenCodeProvider({
      binary: explicit ?? resolved?.launchPath ?? 'opencode',
      extra_args: cfg.extra_args ?? cfg.extra.extra_args ?? [],
    });
  },
};

export const KNOWN_BACKENDS = Object.keys(PROVIDER_FACTORIES);

export function createProvider(config) {
  const cfg = config instanceof LLMConfig ? config : new LLMConfig(config);
  const factory = PROVIDER_FACTORIES[cfg.backend];
  if (!factory) {
    throw new LLMError(`unknown backend "${cfg.backend}" (known: ${KNOWN_BACKENDS.join(', ')})`);
  }
  return factory(cfg);
}

export function registerProvider(id, factory) {
  PROVIDER_FACTORIES[id] = factory;
}
