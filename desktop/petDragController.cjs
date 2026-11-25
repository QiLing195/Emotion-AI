/**
 * Drag state and reset-event wiring for the Electron pet window.
 * Dependencies are injected so the main-process lifecycle can be tested without Electron.
 */
class PetDragController {
  constructor({ getCursor, moveBy, savePosition }) {
    this.getCursor = getCursor;
    this.moveBy = moveBy;
    this.savePosition = savePosition;
    this.last = null;
  }

  begin() {
    this.last = this.getCursor();
  }

  move() {
    if (!this.last) return false;
    const now = this.getCursor();
    const dx = now.x - this.last.x;
    const dy = now.y - this.last.y;
    if (!dx && !dy) return false;
    this.moveBy(dx, dy);
    this.last = now;
    return true;
  }

  end() {
    const wasActive = this.isActive();
    this.last = null;
    this.savePosition();
    return wasActive;
  }

  reset() {
    const wasActive = this.isActive();
    this.last = null;
    this.savePosition();
    return wasActive;
  }

  isActive() {
    return this.last !== null;
  }
}

function bindPetDragResetEvents(petWindow, reset, recoverRenderer = () => undefined) {
  petWindow.on('blur', () => reset('window-blur'));
  petWindow.webContents.on('render-process-gone', (_event, details) => {
    reset('render-process-gone');
    recoverRenderer(details || {});
  });
  petWindow.webContents.on('destroyed', () => reset('webcontents-destroyed'));
}

module.exports = { PetDragController, bindPetDragResetEvents };
