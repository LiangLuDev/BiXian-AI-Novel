import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import os from 'node:os';

const CLI_ENV_KEYS = {
  codex: 'CODEX_BIN',
  claude: 'CLAUDE_BIN',
  gemini: 'GEMINI_BIN',
  qwen: 'QWEN_BIN',
  opencode: 'OPENCODE_BIN',
};

const CLI_DEFS = {
  codex: {
    id: 'codex',
    bin: 'codex',
    envKey: CLI_ENV_KEYS.codex,
    versionArgs: ['--version'],
    installCommand: 'npm i -g @openai/codex',
    loginCommand: 'codex login',
  },
  claude: {
    id: 'claude',
    bin: 'claude',
    envKey: CLI_ENV_KEYS.claude,
    versionArgs: ['--version'],
    fallbackBins: ['openclaude'],
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    loginCommand: 'claude',
  },
  gemini: {
    id: 'gemini',
    bin: 'gemini',
    envKey: CLI_ENV_KEYS.gemini,
    versionArgs: ['--version'],
    installCommand: 'npm install -g @google/gemini-cli',
    loginCommand: 'gemini',
  },
  qwen: {
    id: 'qwen',
    bin: 'qwen',
    envKey: CLI_ENV_KEYS.qwen,
    versionArgs: ['--version'],
    installCommand: 'npm install -g @qwen-code/qwen-code@latest',
    loginCommand: 'qwen',
  },
  opencode: {
    id: 'opencode',
    bin: 'opencode-cli',
    fallbackBins: ['opencode'],
    envKey: CLI_ENV_KEYS.opencode,
    versionArgs: ['--version'],
    installCommand: 'npm install -g opencode-ai',
    loginCommand: 'opencode auth login',
  },
};

function unique(items, normalize = (x) => x) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const key = normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function existingChildBinDirs(root, segments = ['bin']) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(root, { encoding: 'utf8', withFileTypes: true });
  } catch {
    return out;
  }
  entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
    .forEach((entry) => {
      const candidate = path.join(root, entry.name, ...segments);
      if (existsSync(candidate)) out.push(candidate);
    });
  return out;
}

export function wellKnownCliDirs({ home = os.homedir(), env = process.env, includeSystemBins = process.platform !== 'win32' } = {}) {
  const dirs = [];
  const npmPrefix = String(env.NPM_CONFIG_PREFIX || env.npm_config_prefix || '').trim();
  if (npmPrefix) dirs.push(path.join(npmPrefix, 'bin'));

  if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(
      path.join(appData, 'npm'),
      path.join(localAppData, 'pnpm'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.volta', 'bin'),
    );
  } else {
    dirs.push(
      path.join(home, '.local', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.asdf', 'shims'),
      path.join(home, 'Library', 'pnpm'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.npm-packages', 'bin'),
    );
    if (includeSystemBins) dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  }

  dirs.push(
    ...existingChildBinDirs(path.join(home, '.nvm', 'versions', 'node')),
    ...existingChildBinDirs(path.join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'bin']),
    ...existingChildBinDirs(path.join(home, '.fnm', 'node-versions'), ['installation', 'bin']),
    ...existingChildBinDirs(path.join(home, '.local', 'share', 'mise', 'installs', 'node')),
  );

  return unique(dirs, (dir) => (process.platform === 'win32' ? dir.toLowerCase() : dir));
}

function pathDirs(env = process.env) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  return unique([
    ...String(env[pathKey] || '').split(delimiter),
    ...wellKnownCliDirs({ env }),
  ], (dir) => (process.platform === 'win32' ? dir.toLowerCase() : dir));
}

function windowsExecutableExts(env = process.env) {
  return String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);
}

function isExecutableFile(filePath) {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (process.platform === 'win32') {
      const ext = path.extname(filePath).toUpperCase();
      return windowsExecutableExts().map((x) => x.toUpperCase()).includes(ext);
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandHome(value) {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveOnPath(bin, env = process.env) {
  const exts = process.platform === 'win32' && !path.extname(bin)
    ? windowsExecutableExts(env)
    : [''];
  for (const dir of pathDirs(env)) {
    for (const ext of exts) {
      const full = path.join(dir, `${bin}${ext}`);
      if (isExecutableFile(full)) return full;
    }
  }
  return null;
}

function configuredOverride(def, env = process.env) {
  const raw = def.envKey ? env[def.envKey] : '';
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const expanded = path.resolve(expandHome(raw.trim()));
  return isExecutableFile(expanded) ? expanded : null;
}

function safeRealpath(filePath) {
  try { return realpathSync(filePath); } catch { return null; }
}

function codexNativeTargetTriple() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-musl';
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-musl';
  if (process.platform === 'win32' && process.arch === 'arm64') return 'aarch64-pc-windows-msvc';
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc';
  return `${process.platform}-${process.arch}`;
}

function codexNativeCandidates(wrapperPath) {
  const roots = new Set();
  for (const seed of [wrapperPath, safeRealpath(wrapperPath)]) {
    if (!seed) continue;
    let current = path.dirname(seed);
    while (current && current !== path.dirname(current)) {
      roots.add(current);
      current = path.dirname(current);
    }
  }
  const triple = codexNativeTargetTriple();
  const suffix = `${process.platform}-${process.arch}`;
  const out = [];
  for (const root of roots) {
    const scoped = path.join(root, 'node_modules', '@openai');
    const packageDirs = [path.join(scoped, `codex-${suffix}`)];
    try {
      for (const entry of readdirSync(scoped, { encoding: 'utf8', withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('codex-')) packageDirs.push(path.join(scoped, entry.name));
      }
    } catch {}
    for (const dir of unique(packageDirs)) {
      out.push(
        path.join(dir, 'vendor', triple, 'codex', 'codex'),
        path.join(dir, 'vendor', triple, 'codex', 'codex.exe'),
        path.join(dir, 'codex'),
        path.join(dir, 'codex.exe'),
        path.join(dir, 'bin', 'codex'),
        path.join(dir, 'bin', 'codex.exe'),
      );
    }
  }
  return unique(out);
}

function resolveCodexLaunchPath(selectedPath) {
  if (!selectedPath) return null;
  for (const candidate of codexNativeCandidates(selectedPath)) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return selectedPath;
}

export function resolveCli(id, env = process.env) {
  const def = CLI_DEFS[id];
  if (!def) return null;
  const configuredPath = configuredOverride(def, env);
  let pathResolvedPath = null;
  for (const bin of [def.bin, ...(def.fallbackBins || [])]) {
    pathResolvedPath = resolveOnPath(bin, env);
    if (pathResolvedPath) break;
  }
  const selectedPath = configuredPath || pathResolvedPath;
  const launchPath = id === 'codex' ? resolveCodexLaunchPath(selectedPath) : selectedPath;
  return {
    ...def,
    configuredPath,
    pathResolvedPath,
    selectedPath,
    launchPath,
    source: configuredPath ? 'configured' : pathResolvedPath ? 'path' : 'missing',
  };
}

function quoteWindowsCommandArg(value) {
  if (!/[\s"&<>|^%]/u.test(value)) return value;
  const escaped = String(value).replace(/"/g, '""').replace(/%/g, '"^%"');
  return `"${escaped}"`;
}

export function createCommandInvocation(command, args = [], env = process.env) {
  if (process.platform === 'win32' && /\.(bat|cmd)$/iu.test(command)) {
    const inner = [command, ...args].map(quoteWindowsCommandArg).join(' ');
    return {
      command: env.ComSpec || process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${inner}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command, args };
}

export { CLI_DEFS };
