/**
 * Window geometry helpers shared by the Electron main process and tests.
 */
const PET_HOVER_PADDING = 24;

function displayProbePoint(bounds) {
  return {
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  };
}

function isCursorInsideHitRects(cursor, windowPosition, hitRects) {
  return hitRects.some((rect) => {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return false;
    const x = windowPosition.x + rect.x;
    const y = windowPosition.y + rect.y;
    const padding = rect.kind === 'pet' ? PET_HOVER_PADDING : 0;
    return cursor.x >= x - padding && cursor.y >= y - padding
      && cursor.x <= x + rect.w + padding && cursor.y <= y + rect.h + padding;
  });
}

function mouseIgnoreTransition(current, requested) {
  const next = Boolean(requested);
  return { next, changed: current !== next };
}

module.exports = { displayProbePoint, isCursorInsideHitRects, mouseIgnoreTransition, PET_HOVER_PADDING };
