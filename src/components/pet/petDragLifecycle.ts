type FinishEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Bind renderer lifecycle events that must end an active pet drag. */
export function bindPetDragFinishEvents(
  windowTarget: FinishEventTarget,
  documentTarget: FinishEventTarget & Pick<Document, 'visibilityState'>,
  finish: (reason: string) => void,
): () => void {
  const onPointerUp: EventListener = () => finish('pointerup');
  const onPointerCancel: EventListener = () => finish('pointercancel');
  const onLostPointerCapture: EventListener = () => finish('lostpointercapture');
  const onBlur: EventListener = () => finish('window-blur');
  const onVisibilityChange: EventListener = () => {
    if (documentTarget.visibilityState === 'hidden') finish('visibility-hidden');
  };
  const onPageHide: EventListener = () => finish('pagehide');

  windowTarget.addEventListener('pointerup', onPointerUp);
  windowTarget.addEventListener('pointercancel', onPointerCancel);
  windowTarget.addEventListener('lostpointercapture', onLostPointerCapture);
  windowTarget.addEventListener('blur', onBlur);
  documentTarget.addEventListener('visibilitychange', onVisibilityChange);
  windowTarget.addEventListener('pagehide', onPageHide);

  return () => {
    windowTarget.removeEventListener('pointerup', onPointerUp);
    windowTarget.removeEventListener('pointercancel', onPointerCancel);
    windowTarget.removeEventListener('lostpointercapture', onLostPointerCapture);
    windowTarget.removeEventListener('blur', onBlur);
    documentTarget.removeEventListener('visibilitychange', onVisibilityChange);
    windowTarget.removeEventListener('pagehide', onPageHide);
  };
}
