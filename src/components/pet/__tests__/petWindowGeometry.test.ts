import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { displayProbePoint, isCursorInsideHitRects, mouseIgnoreTransition, PET_HOVER_PADDING } = require('../../../../desktop/petWindowGeometry.cjs') as {
  displayProbePoint: (
    bounds: { x: number; y: number; width: number; height: number },
  ) => { x: number; y: number };
  isCursorInsideHitRects: (
    cursor: { x: number; y: number },
    windowPosition: { x: number; y: number },
    hitRects: Array<{ x: number; y: number; w: number; h: number; kind?: 'pet' | 'control' }>,
  ) => boolean;
  mouseIgnoreTransition: (current: boolean | null, requested: boolean) => { next: boolean; changed: boolean };
  PET_HOVER_PADDING: number;
};

describe('pet display probe point', () => {
  it('preserves the window center on a monitor above the primary display', () => {
    expect(displayProbePoint(
      { x: 400, y: -1000, width: 300, height: 400 },
    )).toEqual({ x: 550, y: -800 });
  });

  it('preserves the window center on a monitor below the primary display', () => {
    expect(displayProbePoint(
      { x: 400, y: 1400, width: 300, height: 400 },
    )).toEqual({ x: 550, y: 1600 });
  });
});

describe('pet cursor hit testing', () => {
  const windowPosition = { x: 1000, y: 500 };
  const pet = { x: 90, y: 170, w: 124, h: 184, kind: 'pet' as const };

  it('accepts a near-edge entry inside the pet hover padding', () => {
    expect(PET_HOVER_PADDING).toBe(24);
    expect(isCursorInsideHitRects({ x: 1000 + 69, y: 500 + 300 }, windowPosition, [pet])).toBe(true);
  });

  it('keeps distant transparent space click-through', () => {
    expect(isCursorInsideHitRects({ x: 1000 + 40, y: 500 + 300 }, windowPosition, [pet])).toBe(false);
  });

  it('does not expand button hit targets', () => {
    const control = { x: 100, y: 100, w: 24, h: 24, kind: 'control' as const };
    expect(isCursorInsideHitRects({ x: 1000 + 90, y: 500 + 110 }, windowPosition, [control])).toBe(false);
  });

  it('reconciles a renderer override with the next hover decision', () => {
    const afterRendererCleanup = mouseIgnoreTransition(true, false);
    expect(afterRendererCleanup).toEqual({ next: false, changed: true });

    const afterPointerLeaves = mouseIgnoreTransition(afterRendererCleanup.next, true);
    expect(afterPointerLeaves).toEqual({ next: true, changed: true });

    expect(mouseIgnoreTransition(true, true)).toEqual({ next: true, changed: false });
  });
});
