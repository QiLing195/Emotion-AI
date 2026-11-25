import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { PetDragController, bindPetDragResetEvents } = require('../../../../desktop/petDragController.cjs') as {
  PetDragController: new (deps: {
    getCursor: () => { x: number; y: number };
    moveBy: (dx: number, dy: number) => void;
    savePosition: () => void;
  }) => { begin: () => void; move: () => boolean; end: () => boolean; reset: () => boolean; isActive: () => boolean };
  bindPetDragResetEvents: (
    petWindow: EventEmitter & { webContents: EventEmitter },
    reset: (reason: string) => void,
    recoverRenderer?: (details: { reason?: string }) => void,
  ) => void;
};

describe('pet drag reset lifecycle', () => {
  it('clears an active drag on blur and starts the next drag from a fresh cursor anchor', () => {
    let cursor = { x: 100, y: 200 };
    const moves: Array<{ dx: number; dy: number }> = [];
    let saves = 0;
    const drag = new PetDragController({
      getCursor: () => cursor,
      moveBy: (dx, dy) => moves.push({ dx, dy }),
      savePosition: () => { saves += 1; },
    });
    const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
    const resetReasons: string[] = [];
    bindPetDragResetEvents(window, (reason) => {
      resetReasons.push(reason);
      drag.reset();
    });

    drag.begin();
    cursor = { x: 108, y: 205 };
    expect(drag.move()).toBe(true);
    expect(moves).toEqual([{ dx: 8, dy: 5 }]);

    window.emit('blur');
    expect(resetReasons).toEqual(['window-blur']);
    expect(drag.isActive()).toBe(false);
    expect(saves).toBe(1);

    cursor = { x: 900, y: 700 };
    drag.begin();
    cursor = { x: 903, y: 702 };
    expect(drag.move()).toBe(true);
    expect(moves).toEqual([{ dx: 8, dy: 5 }, { dx: 3, dy: 2 }]);
  });

  it('clears drag state when the renderer exits or its web contents are destroyed', () => {
    const reasons: string[] = [];
    const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
    bindPetDragResetEvents(window, (reason) => reasons.push(reason));

    window.webContents.emit('render-process-gone');
    window.webContents.emit('destroyed');

    expect(reasons).toEqual(['render-process-gone', 'webcontents-destroyed']);
  });

  it('passes renderer exit details to the recovery policy after clearing drag state', () => {
    const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter() });
    const events: string[] = [];
    bindPetDragResetEvents(
      window,
      (reason) => events.push(`reset:${reason}`),
      (details) => events.push(`recover:${details.reason}`),
    );

    window.webContents.emit('render-process-gone', {}, { reason: 'killed' });

    expect(events).toEqual(['reset:render-process-gone', 'recover:killed']);
  });

  it('makes repeated reset and end calls safe', () => {
    let saves = 0;
    const drag = new PetDragController({
      getCursor: () => ({ x: 0, y: 0 }),
      moveBy: () => undefined,
      savePosition: () => { saves += 1; },
    });

    expect(drag.reset()).toBe(false);
    drag.begin();
    expect(drag.end()).toBe(true);
    expect(drag.reset()).toBe(false);
    expect(drag.isActive()).toBe(false);
    expect(saves).toBe(3);
  });
});
