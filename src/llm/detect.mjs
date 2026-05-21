import { spawnSync } from 'node:child_process';
import { LLMError } from './errors.mjs';
import { KNOWN_BACKENDS } from './config.mjs';
import { createCommandInvocation, resolveCli } from './cli-resolver.mjs';

let cache = null;

function backendLabel(id) {
  return ({
    codex: 'Codex',
    claude: 'Claude Code',
    gemini: 'Gemini CLI',
    qwen: 'Qwen Code',
    opencode: 'OpenCode',
  })[id] || id;
}

function versionProbe(resolution) {
  if (!resolution?.launchPath) {
    return { status: 'missing', version: '', detail: `PATH 中未找到 ${resolution?.bin || 'CLI'}` };
  }
  const invocation = createCommandInvocation(resolution.launchPath, resolution.versionArgs || ['--version'], process.env);
  const res = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: process.platform === 'win32',
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  if (res.error) {
    const code = res.error.code || '';
    const notInvocable = code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR';
    return {
      status: notInvocable ? 'missing' : 'broken',
      version: '',
      detail: `${resolution.bin} 启动失败：${res.error.message}`,
    };
  }
  if (res.status === 126 || res.status === 127) {
    return {
      status: 'missing',
      version: '',
      detail: `${resolution.bin} wrapper 无法启动底层程序（exit ${res.status}）`,
    };
  }
  const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
  if (res.status === 0) {
    return {
      status: 'ready',
      version: String(res.stdout || output).trim().split(/\r?\n/u)[0] || '',
      detail: '',
    };
  }
  return {
    status: 'found',
    version: '',
    detail: output || `${resolution.bin} --version exit ${res.status}`,
  };
}

function probe(id) {
  const resolution = resolveCli(id);
  if (!resolution) {
    return {
      id,
      status: 'unsupported',
      ready: false,
      available: false,
      binary: '',
      launchPath: '',
      source: 'missing',
      version: '',
      installCommand: '',
      loginCommand: '',
      detail: `未知 AI 后端：${id}`,
    };
  }
  const checked = versionProbe(resolution);
  return {
    id,
    status: checked.status,
    ready: checked.status === 'ready' || checked.status === 'found',
    available: checked.status === 'ready' || checked.status === 'found',
    binary: resolution.selectedPath || '',
    launchPath: resolution.launchPath || '',
    source: resolution.source,
    configuredPath: resolution.configuredPath || '',
    detectedPath: resolution.pathResolvedPath || '',
    version: checked.version,
    installCommand: resolution.installCommand,
    loginCommand: resolution.loginCommand,
    detail: checked.detail,
  };
}

export function detectAiBackends({ force = false } = {}) {
  if (cache && !force) return cache;
  const result = { providers: [], by_id: {}, details: {}, available: false };
  for (const id of KNOWN_BACKENDS) {
    const detail = probe(id);
    result.details[id] = detail;
    result.by_id[id] = Boolean(detail.available);
    if (detail.available) result.providers.push(id);
  }
  result.available = result.providers.length > 0;
  cache = result;
  return cache;
}

export function aiCapabilityError(backend = null) {
  const info = detectAiBackends();
  if (backend && info.by_id[backend]) return null;
  if (!backend && info.available) return null;
  const target = backend ? info.details[backend] : null;
  const targetLine = target
    ? `所选后端「${backendLabel(backend)}」不可用：${target.detail || target.status}`
    : '未检测到可用的 AI 能力。';
  return new LLMError(
    `${targetLine}\n请先安装并登录以下任一 CLI，或在设置中指定 CLI 绝对路径：\n`
    + '  · codex  (npm i -g @openai/codex)\n'
    + '  · claude (npm i -g @anthropic-ai/claude-code)\n'
    + '安装后点击重新检测即可生效。',
  );
}

export function requireAiBackend(backend = null) {
  const err = aiCapabilityError(backend);
  if (err) throw err;
  return detectAiBackends();
}

export function resetAiBackendCache() { cache = null; }
