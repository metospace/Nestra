import { useCallback, useRef } from 'react';

type AutoFocusHandler = (event: Event) => void;

/** Radix owns focus trapping. This only supplies the return target for controlled
 * dialogs opened without a DialogTrigger, using its documented lifecycle hooks. */
export function useDialogFocus({ onOpenAutoFocus, onCloseAutoFocus }: {
  onOpenAutoFocus?: AutoFocusHandler;
  onCloseAutoFocus?: AutoFocusHandler;
}) {
  const returnTarget = useRef<HTMLElement | null>(null);
  const handleOpenAutoFocus = useCallback((event: Event) => {
    const active = document.activeElement;
    returnTarget.current = active instanceof HTMLElement && active !== document.body && active !== document.documentElement ? active : null;
    // Callers may intentionally focus an input or a cancel button and prevent
    // Radix's initial focus. Capturing the return target must precede that work.
    onOpenAutoFocus?.(event);
  }, [onOpenAutoFocus]);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    const target = returnTarget.current;
    returnTarget.current = null;
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented || !target?.isConnected ||
        target.matches(':disabled,[aria-disabled="true"]') ||
        target.closest('[inert],[hidden],[aria-hidden="true"]') ||
        !target.getClientRects().length || getComputedStyle(target).visibility === 'hidden') return;
    target.focus({ preventScroll: true });
    // If focus could not be restored, leave Radix's normal fallback intact.
    if (target.ownerDocument.activeElement === target) event.preventDefault();
  }, [onCloseAutoFocus]);

  return { onOpenAutoFocus: handleOpenAutoFocus, onCloseAutoFocus: handleCloseAutoFocus };
}
