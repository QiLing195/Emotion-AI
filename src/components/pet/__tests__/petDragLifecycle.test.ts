import { describe, expect, it } from 'vitest';
import { bindPetDragFinishEvents } from '../petDragLifecycle';

describe('pet drag renderer finish events', () => {
  it('routes cancellation, capture loss, blur, page hide, and hidden visibility to drag cleanup', () => {
    const windowTarget = new EventTarget() as unknown as Window;
    const documentTarget = new EventTarget() as unknown as Document;
    let visibilityState: DocumentVisibilityState = 'visible';
    Object.defineProperty(documentTarget, 'visibilityState', { get: () => visibilityState });
    const reasons: string[] = [];

    bindPetDragFinishEvents(windowTarget, documentTarget, (reason) => reasons.push(reason));
    windowTarget.dispatchEvent(new Event('pointercancel'));
    windowTarget.dispatchEvent(new Event('lostpointercapture'));
    windowTarget.dispatchEvent(new Event('blur'));
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    windowTarget.dispatchEvent(new Event('pagehide'));
    visibilityState = 'hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));

    expect(reasons).toEqual([
      'pointercancel',
      'lostpointercapture',
      'window-blur',
      'pagehide',
      'visibility-hidden',
    ]);
  });

  it('removes every listener after a drag ends', () => {
    const windowTarget = new EventTarget() as unknown as Window;
    const documentTarget = new EventTarget() as unknown as Document;
    const reasons: string[] = [];
    const cleanup = bindPetDragFinishEvents(windowTarget, documentTarget, (reason) => reasons.push(reason));

    cleanup();
    windowTarget.dispatchEvent(new Event('pointercancel'));
    windowTarget.dispatchEvent(new Event('lostpointercapture'));
    windowTarget.dispatchEvent(new Event('blur'));
    windowTarget.dispatchEvent(new Event('pagehide'));
    documentTarget.dispatchEvent(new Event('visibilitychange'));

    expect(reasons).toEqual([]);
  });
});
