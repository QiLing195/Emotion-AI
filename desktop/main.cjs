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

  // Ctrl+Shift+P 打开/聚焦聊天窗口
  petWin.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'p') {
      openChat();
      event.preventDefault();
    }
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
