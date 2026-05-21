// Electron main process: starts the embedded Node HTTP server, then loads it
// into a native BrowserWindow. Renderer is the existing static React UI; it
// talks to its own backend via http://127.0.0.1:<port> like before.

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');

const APP_NAME = 'Bixian';
const PRODUCT_NAME = '笔仙助手';

// ---------- PATH augmentation ----------
// When .app is launched from Finder, PATH is LaunchServices' minimal set.
// Prepend the dirs where users typically install `codex` / `claude`.
function augmentPath() {
  const home = app.getPath('home');
  const extras = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'),
        path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'pnpm'),
        path.join(home, '.bun', 'bin'),
        path.join(home, '.volta', 'bin'),
      ]
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        path.join(home, '.npm-global/bin'),
        path.join(home, '.npm-packages/bin'),
        path.join(home, '.local/bin'),
        path.join(home, '.bun/bin'),
        path.join(home, '.deno/bin'),
        path.join(home, '.volta/bin'),
        path.join(home, '.asdf/shims'),
        path.join(home, 'Library/pnpm'),
      ];
  try {
    const nvmRoot = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(nvmRoot)) {
      for (const v of fs.readdirSync(nvmRoot)) extras.push(path.join(nvmRoot, v, 'bin'));
    }
  } catch {}
  const cur = (process.env.PATH || '').split(':').filter(Boolean);
  const merged = [...new Set([...extras, ...cur])];
  process.env.PATH = merged.join(':');
}

// ---------- workspace & port ----------
function workspaceDir() {
  const ws = process.env.BIXIAN_WORKSPACE
    || path.join(app.getPath('appData'), APP_NAME);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

function pickPort(host, start) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const s = net.createServer();
      s.once('error', () => {
        port += 1;
        if (port > start + 50) reject(new Error('no free port'));
        else tryPort();
      });
      s.once('listening', () => s.close(() => resolve(port)));
      s.listen(port, host);
    };
    tryPort();
  });
}

// ---------- server bootstrap ----------
let serverInstance = null;

async function startServer() {
  augmentPath();
  const ws = workspaceDir();
  const host = '127.0.0.1';
  const port = await pickPort(host, Number(process.env.BIXIAN_PORT) || 8000);

  const webPath = path.join(__dirname, '..', 'src', 'web.mjs');
  const webModule = await import(`file://${webPath}`);
  serverInstance = webModule.runServer(ws, { host, port, openBrowser: false });
  return `http://${host}:${port}`;
}

// Graceful shutdown: cancel every running pipeline / cover worker so their
// codex/claude child processes get SIGTERM (then SIGKILL after 2s) instead of
// orphaning under launchd and burning tokens after the window closes.
async function shutdownGracefully({ timeoutMs = 3000 } = {}) {
  if (!serverInstance) return;
  const registry = serverInstance.registry;
  if (registry?.shutdown) {
    try { await registry.shutdown({ timeoutMs }); } catch {}
  }
  try { serverInstance.close(); } catch {}
  serverInstance = null;
}

// ---------- window ----------
let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: PRODUCT_NAME,
    backgroundColor: '#0b0e14',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // External links open in the system browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
}

// ---------- menu (minimal but functional Cmd+Q / Reload / DevTools) ----------
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- app lifecycle ----------
app.setName(PRODUCT_NAME);

app.whenReady().then(async () => {
  buildMenu();
  try {
    const url = await startServer();
    createWindow(url);
  } catch (e) {
    dialog.showErrorBox('启动失败', String(e?.stack || e?.message || e));
    app.quit();
  }
});

let isQuitting = false;

app.on('window-all-closed', () => app.quit());

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const url = serverInstance
      ? `http://127.0.0.1:${serverInstance.address().port}`
      : await startServer();
    createWindow(url);
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  shutdownGracefully({ timeoutMs: 3000 }).finally(() => app.quit());
});
