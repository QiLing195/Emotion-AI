// 桌宠窗口的 preload：只暴露窗口拖动所需的最小能力（contextIsolation 开）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petWindow', {
  /** 相对移动窗口（旧接口；v2.07 起拖动改用 dragBegin/dragMove/dragEnd） */
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', { dx, dy }),
  /** v2.07：光标驱动的整窗拖动（主进程按屏幕光标位移移动窗口，避免 movementX 漂移/卡住） */
  dragBegin: () => ipcRenderer.send('pet:drag-begin'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  /** v2.08：透明区域点击穿透（只有她本人/按钮可点，其余让给桌面） */
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore),
  /** v2.08：上报可点击区域（client 坐标，主进程按窗口位置换算成屏幕坐标） */
  setHitRects: (rects) => ipcRenderer.send('pet:set-hit-rects', rects),
  /** 当前窗口位置（调试/边界回弹用） */
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  /** 打开聊天窗口 */
  openChat: () => ipcRenderer.send('pet:open-chat'),
  /** 打开桌面上的某个东西（主进程校验路径 + 类型后再 shell.openPath） */
  openPath: (p) => ipcRenderer.invoke('pet:open-path', p),
  /** 打开唤醒词设置窗口 */
  openVoiceSettings: () => ipcRenderer.send('pet:open-voice-settings'),
  /** 右键菜单（打开聊天 / 唤醒词设置 / 退出） */
  showMenu: () => ipcRenderer.send('pet:show-menu'),
});
