// 桌宠 Electron 主进程（v1.83）
// - 透明置顶无边框窗口，加载 http://127.0.0.1:3000/pet
// - 轮询 /api/pet/capture/request，收到请求就用 desktopCapturer 截屏，回写 /api/pet/capture/result
//   （PowerShell 抓屏会被杀软当恶意脚本拦，所以抓屏放在 Electron 里；OCR 仍由 server 侧 PowerShell 做）
const { app, BrowserWindow, desktopCapturer, screen, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_URL = process.env.PET_APP_URL || 'http://127.0.0.1:3000';
const SCREEN_DIR = path.join(process.cwd(), 'memories', 'screens');
const POLL_MS = 1500;

let petWin = null;
let chatWin = null;
let captureTimer = null;
let busy = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiJson(url, init) {
  const res = await fetch(url, { ...(init || {}), signal: AbortSignal.timeout(15000) });
  if (res.status === 204) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function positionPet(win) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const [w, h] = win.getSize();
  win.setPosition(Math.max(0, width - w - 24), Math.max(0, height - h - 24));
}

async function captureOnce() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 720 },
  });
  if (!sources.length) throw new Error('no_screen_source');
  const source = sources[0];
  const size = source.thumbnail.getSize();
  const jpg = source.thumbnail.toJPEG(78);
  if (!fs.existsSync(SCREEN_DIR)) fs.mkdirSync(SCREEN_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');
  const imagePath = path.join(SCREEN_DIR, `screen-${stamp}.jpg`);
  fs.writeFileSync(imagePath, jpg);
  return { imagePath, bytes: jpg.length, width: size.width, height: size.height };
}

async function pollCaptureOnce() {
  if (busy) return;
  busy = true;
  try {
    const req = await apiJson(`${APP_URL}/api/pet/capture/request`);
    if (!req || !req.id) return;
    console.log('[Pet] capture request', req.id, req.trigger || '');
    const shot = await captureOnce();
    await apiJson(`${APP_URL}/api/pet/capture/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: req.id, ...shot }),
    });
    console.log('[Pet] capture done', shot.imagePath, Math.round(shot.bytes / 1024) + 'KB');
  } catch (e) {
    console.warn('[Pet] capture poll failed:', e && e.message);
  } finally {
    busy = false;
  }
}

function createPetWindow() {
  petWin = new BrowserWindow({
    width: 300,
    height: 400,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: false,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
  });
  petWin.setBackgroundColor('#00000000');
  // v2.07：硬尺寸上限 —— 双击无边框窗口时 Windows 可能直接下发"最大化"，
  // 而 maximizable:false 不能完全挡住；最大尺寸能让系统把窗口夹回 300x400。
  petWin.setMinimumSize(300, 400);
  petWin.setMaximumSize(300, 400);
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionPet(petWin);
  petWin.loadURL(`${APP_URL}/pet`);
  petWin.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 1100, height: 760, backgroundColor: '#0f1120' },
  }));
  petWin.on('closed', () => { petWin = null; });

  // v2.07：双击拖动区/系统手势会把无边框窗口最大化甚至全屏（用户实测变"挡屏"）——
  // 统一恢复成桌宠的 300x400，并夹回工作区。
  let petRestoring = false;
  const restorePetWindow = (reason) => {
    if (!petWin || petWin.isDestroyed() || petRestoring) return;
    const [w, h] = petWin.getSize();
    // 只拦"明显变大"（系统手势/双击最大化的典型值），不影响 DPI/边框造成的几像素差异
    const badSize = w > 380 || h > 480;
    const badState = petWin.isFullScreen() || petWin.isMaximized();
    if (!badSize && !badState) return;
    petRestoring = true;
    console.log('[Pet] 窗口异常(' + w + 'x' + h + ')，恢复桌宠窗口（' + reason + '）');
    if (petWin.isFullScreen()) petWin.setFullScreen(false);
    if (petWin.isMaximized()) petWin.unmaximize();
    petWin.setSize(300, 400);
    positionPet(petWin);
    setTimeout(() => { petRestoring = false; }, 300);
  };
  petWin.on('maximize', () => restorePetWindow('maximize'));
  petWin.on('enter-full-screen', () => restorePetWindow('full-screen'));
  // Windows 把无边框窗口双击当"最大化"时不一定发 maximize 事件，用 resize 兜底
  petWin.on('resize', () => restorePetWindow('resize'));

  // Ctrl+Shift+P 打开/聚焦聊天窗口；Ctrl+Shift+Q 退出桌宠
  petWin.webContents.on('before-input-event', (event, input) => {
    if (!input.control || !input.shift) return;
    const key = input.key.toLowerCase();
    if (key === 'p') { openChat(); event.preventDefault(); }
    if (key === 'q') { app.quit(); event.preventDefault(); }
  });
}

function openChat() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.show(); chatWin.focus(); return; }
  chatWin = new BrowserWindow({ width: 1100, height: 760, backgroundColor: '#0f1120' });
  chatWin.loadURL(APP_URL);
  chatWin.on('closed', () => { chatWin = null; });
}

/**
 * v1.86：鼠标直接拖动桌宠（不走 -webkit-app-region，否则会把点击/双击吃掉）。
 * 渲染层用 pointermove 的 movementX/Y 发相对位移，这里负责夹在屏幕工作区内。
 */
function movePetBy(dx, dy) {
  if (!petWin || petWin.isDestroyed()) return;
  const [x, y] = petWin.getPosition();
  const [w, h] = petWin.getSize();
  const display = screen.getDisplayNearestPoint({ x: x + Math.round(w / 2), y: y + Math.round(h / 2) });
  const wa = display.workArea;
  const nx = Math.min(Math.max(x + Math.round(dx), wa.x - 40), wa.x + wa.width - w + 40);
  const ny = Math.min(Math.max(y + Math.round(dy), wa.y - 20), wa.y + wa.height - h + 40);
  petWin.setPosition(nx, ny);
}

let petDrag = null;
/** v2.07：整窗拖动开始 —— 记录屏幕光标起点（不再依赖 renderer 的 movementX） */
function petDragBegin() {
  if (!petWin || petWin.isDestroyed()) return;
  // 曾被双击拖动区/系统手势意外最大化或全屏 → 先恢复，否则拖动坐标与窗口大小都会错
  if (petWin.isFullScreen()) petWin.setFullScreen(false);
  if (petWin.isMaximized()) petWin.unmaximize();
  petDrag = { last: screen.getCursorScreenPoint() };
}
function petDragMove() {
  if (!petDrag || !petWin || petWin.isDestroyed()) return;
  const now = screen.getCursorScreenPoint();
  const dx = now.x - petDrag.last.x;
  const dy = now.y - petDrag.last.y;
  if (dx || dy) {
    movePetBy(dx, dy);
    petDrag.last = now;
  }
}
function petDragEnd() { petDrag = null; }

function registerPetIpc() {
  const { ipcMain } = require('electron');
  ipcMain.on('pet:drag-begin', () => petDragBegin());
  ipcMain.on('pet:drag-move', () => petDragMove());
  ipcMain.on('pet:drag-end', () => petDragEnd());
  ipcMain.on('pet:move-by', (_evt, payload) => {
    const dx = Number(payload?.dx ?? 0);
    const dy = Number(payload?.dy ?? 0);
    if (Number.isFinite(dx) && Number.isFinite(dy)) movePetBy(dx, dy);
  });
  ipcMain.handle('pet:get-position', () => {
    if (!petWin || petWin.isDestroyed()) return null;
    const [x, y] = petWin.getPosition();
    return { x, y };
  });
  ipcMain.on('pet:open-chat', () => openChat());

  // 打开桌面上的条目：主进程再做一次校验（只允许桌面路径 + 不允许 exe/脚本），然后交给系统默认程序
  ipcMain.handle('pet:open-path', async (_evt, p) => {
    const target = String(p ?? '');
    const { shell } = require('electron');
    const path = require('node:path');
    const fs = require('node:fs');
    // v1.92：桌面可能被重定向（本机 D:\桌面）⇒ 向 server 要真实桌面根目录，并缓存 30s
    let roots = petDesktopRootsCache;
    if (!roots || Date.now() - petDesktopRootsAt > 30000) {
      try {
        const r = await apiJson(`${APP_URL}/api/pet/desktop/roots`);
        if (r && Array.isArray(r.roots) && r.roots.length) {
          roots = r.roots;
          petDesktopRootsCache = roots;
          petDesktopRootsAt = Date.now();
        }
      } catch { /* 用旧缓存 */ }
    }
    roots = roots || [];
    const abs = path.resolve(target);
    const inDesktop = roots.some((r) => abs.startsWith(path.resolve(r) + path.sep) || abs === path.resolve(r));
    if (!inDesktop) return { ok: false, error: 'not_in_desktop' };
    const ext = path.extname(abs).toLowerCase();
    const blocked = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi', '.dll', '.scr', '.com', '.reg'];
    if (blocked.includes(ext)) return { ok: false, error: 'blocked_type' };
    if (!fs.existsSync(abs)) return { ok: false, error: 'missing' };
    const err = await shell.openPath(abs);
    if (err) return { ok: false, error: err };
    console.log('[Pet] 打开桌面条目：' + path.basename(abs));
    return { ok: true };
  });

  ipcMain.on('pet:open-voice-settings', () => openVoiceSettings());

  ipcMain.on('pet:show-menu', () => {
    if (!petWin || petWin.isDestroyed()) return;
    const { Menu } = require('electron');
    Menu.buildFromTemplate([
      { label: '打开聊天窗口', click: () => openChat() },
      { label: '唤醒词设置…', click: () => openVoiceSettings() },
      { label: '回到右下角', click: () => { if (petWin && !petWin.isDestroyed()) { if (petWin.isFullScreen()) petWin.setFullScreen(false); if (petWin.isMaximized()) petWin.unmaximize(); petWin.setSize(300, 400); positionPet(petWin); } } },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]).popup({ window: petWin });
  });
}

let petDesktopRootsCache = null;
let petDesktopRootsAt = 0;
let voiceSettingsWin = null;
function openVoiceSettings() {
  if (voiceSettingsWin && !voiceSettingsWin.isDestroyed()) { voiceSettingsWin.show(); voiceSettingsWin.focus(); return; }
  voiceSettingsWin = new BrowserWindow({
    width: 460,
    height: 520,
    resizable: false,
    title: '唤醒词设置',
    backgroundColor: '#12141f',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  voiceSettingsWin.loadURL(`${APP_URL}/pet/settings`);
  voiceSettingsWin.on('closed', () => { voiceSettingsWin = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (petWin) { petWin.show(); petWin.focus(); } });

  // v1.92 桌宠启动时顺带打开常用程序（配置在 desktop/pet-startup.json，改配置不用改代码）
  function isProcessRunning(exeBase) {
    try {
      const { execFileSync } = require('node:child_process');
      const procName = exeBase.replace(/\.exe$/i, '');
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Measure-Object).Count`],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      return Number(String(out).trim()) > 0;
    } catch { return false; }
  }

  function openStartupApps() {
    const fs = require('node:fs');
    const path = require('node:path');
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'pet-startup.json'), 'utf8')); } catch { return; }
    const apps = Array.isArray(cfg && cfg.apps) ? cfg.apps : [];
    if (!apps.length) return;
    const delay = Number(cfg.delayMs);
    const wait = Number.isFinite(delay) && delay >= 0 ? delay : 3000;
    const skipIfRunning = cfg.skipIfRunning !== false;
    setTimeout(() => {
      const { spawn } = require('node:child_process');
      const { shell } = require('electron');
      for (const item of apps) {
        const exe = String(item && item.path ? item.path : '');
        const name = String(item && item.name ? item.name : path.basename(exe));
        if (!exe || !fs.existsSync(exe)) { console.log(`[Pet] 启动项缺失，跳过：${name}（${exe}）`); continue; }
        if (skipIfRunning && isProcessRunning(path.basename(exe))) { console.log(`[Pet] ${name} 已在运行，跳过`); continue; }
        try {
          const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
          child.on('error', () => { void shell.openPath(exe); });
          child.unref();
          console.log(`[Pet] 已打开：${name}`);
        } catch { void shell.openPath(exe); }
      }
    }, wait);
  }

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // 等后端就绪（最多 30s）
    for (let i = 0; i < 30; i++) {
      try {
        const health = await apiJson(`${APP_URL}/health`);
        if (health && health.status === 'ok') break;
      } catch { /* retry */ }
      await sleep(1000);
    }
    registerPetIpc();
    createPetWindow();
    captureTimer = setInterval(pollCaptureOnce, POLL_MS);
    pollCaptureOnce();
    openStartupApps();
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', () => { if (captureTimer) clearInterval(captureTimer); });
}
