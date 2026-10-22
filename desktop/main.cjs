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
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionPet(petWin);
  petWin.loadURL(`${APP_URL}/pet`);
  petWin.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 1100, height: 760, backgroundColor: '#0f1120' },
  }));
  petWin.on('closed', () => { petWin = null; });

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

function registerPetIpc() {
  const { ipcMain } = require('electron');
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
    const roots = [path.join(process.env.USERPROFILE || '', 'Desktop')];
    if (process.env.PUBLIC) roots.push(path.join(process.env.PUBLIC, 'Desktop'));
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
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]).popup({ window: petWin });
  });
}

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
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', () => { if (captureTimer) clearInterval(captureTimer); });
}
