class PetRendererRecovery {
  constructor({
    getWebContents,
    now = Date.now,
    schedule = setTimeout,
    log = (message) => console.warn(message),
    maxRetries = 3,
    windowMs = 60_000,
    reloadDelayMs = 250,
  }) {
    this.getWebContents = getWebContents;
    this.now = now;
    this.schedule = schedule;
    this.log = log;
    this.maxRetries = maxRetries;
    this.windowMs = windowMs;
    this.reloadDelayMs = reloadDelayMs;
    this.recentRetries = [];
  }

  recover(details = {}) {
    if (details.reason === 'clean-exit') return false;
    const contents = this.getWebContents();
    if (!contents || contents.isDestroyed()) return false;

    const now = this.now();
    this.recentRetries = this.recentRetries.filter((at) => now - at < this.windowMs);
    if (this.recentRetries.length >= this.maxRetries) {
      this.log(`[Pet] renderer 在 ${this.windowMs}ms 内多次退出，暂停自动重载`);
      return false;
    }

    this.recentRetries.push(now);
    this.log(`[Pet] renderer 异常退出(${details.reason || 'unknown'})，${this.reloadDelayMs}ms 后重载`);
    this.schedule(() => {
      const current = this.getWebContents();
      if (!current || current.isDestroyed()) return;
      try {
        current.reload();
      } catch (error) {
        this.log(`[Pet] renderer 自动重载失败: ${error?.message || error}`);
      }
    }, this.reloadDelayMs);
    return true;
  }

  manualReload() {
    this.recentRetries = [];
    const contents = this.getWebContents();
    if (!contents || contents.isDestroyed()) return false;
    this.log('[Pet] renderer 自动重载计数已由用户重置');
    try {
      contents.reload();
      return true;
    } catch (error) {
      this.log(`[Pet] renderer 手动重载失败: ${error?.message || error}`);
      return false;
    }
  }
}

module.exports = { PetRendererRecovery };
