// 桌宠窗口的 preload：只暴露窗口拖动所需的最小能力（contextIsolation 开）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petWindow', {
  /** 相对移动窗口（用指针 movementX/Y 驱动，拖动手感才跟手） */
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', { dx, dy }),
  /** 当前窗口位置（调试/边界回弹用） */
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  /** 打开聊天窗口 */
  openChat: () => ipcRenderer.send('pet:open-chat'),
});
