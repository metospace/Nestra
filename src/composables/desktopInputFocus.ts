/** One input session for the non-activating desktop WebView. Native requests are
 * serialized; only the latest user intent may restore a DOM editor afterwards. */
export function installDesktopInputFocus(
  grant: () => Promise<void>,
  release: () => Promise<void>,
  reportError: () => void,
): () => void {
  const selector = 'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable]:not([contenteditable="false"]), [data-desktop-input]:not(:disabled)';
  const editor = (node: EventTarget | null): HTMLElement | null =>
    node instanceof HTMLElement ? node.closest<HTMLElement>(selector) : null;
  const valid = (node: HTMLElement) => node.isConnected && node.matches(selector);
  let wanted: HTMLElement | null = null;
  let revision = 0, applied = 0;
  let running = false, held = false, granting = false, restoring = false, disposed = false;
  let frame = 0;
  let retryRevision = -1, failures = 0;
  let cancelRetry: (() => void) | undefined;

  function retryDelay(delay: number): Promise<void> {
    return new Promise(resolve => {
      const finish = () => { window.clearTimeout(timer); cancelRetry = undefined; resolve(); };
      const timer = window.setTimeout(finish, delay);
      cancelRetry = finish;
    });
  }

  async function reconcile(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (true) {
        if (wanted && !valid(wanted)) { wanted = null; revision++; }
        if (!wanted) {
          if (!held) break;
          // release resolves only once the window thread has detached input.
          held = false;
          try { await release(); } catch { if (!disposed) reportError(); }
          continue;
        }
        if (applied === revision) break;
        const target = wanted, request = revision;
        let retry = false;
        granting = true;
        try {
          await grant();
          held = true;
          if (request === revision && wanted === target && valid(target)) {
            // MoveFocus can briefly blur the DOM editor while handing input to
            // WebView2. Ignore our own focusin instead of starting another IPC.
            restoring = true;
            try { target.focus({ preventScroll: true }); }
            finally { restoring = false; }
          }
        } catch {
          // Even a timed-out request may have reached the native window thread.
          held = true;
          if (request === revision && wanted === target && valid(target)) {
            if (retryRevision !== request) { retryRevision = request; failures = 0; }
            failures++;
            // A stale foreground queue or a WebView MoveFocus transition can
            // fail once. Detach first, then retry only the same live intent.
            if (failures < 3) {
              try {
                await release(); held = false;
                if (request === revision && wanted === target && valid(target)) {
                  await retryDelay(failures * 80);
                  retry = request === revision && wanted === target && valid(target);
                }
              } catch { /* Unknown native cleanup state: stop retrying. */ }
            }
            if (!retry && request === revision) { wanted = null; revision++; reportError(); }
          }
        } finally { granting = false; applied = retry ? -1 : request; }
      }
    } finally { running = false; }
  }

  function request(target: HTMLElement | null): void {
    if (disposed || restoring) return;
    if (target === wanted && (running || !target)) return;
    wanted = target;
    revision++;
    cancelRetry?.();
    void reconcile();
  }
  function checkFocus(): void {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!wanted) return;
      if (!valid(wanted)) request(null);
      // Do not let a transient MoveFocus blur revoke the pending grant.
      else if (!granting && editor(document.activeElement) !== wanted) request(null);
    });
  }
  function focusIn(event: FocusEvent): void {
    const target = editor(event.target);
    if (target) request(target);
    else if (!granting) request(null);
  }
  function pointerDown(event: PointerEvent): void {
    if (event.button === 0) request(editor(event.target));
  }
  function windowBlur(): void { request(null); }
  const observer = new MutationObserver(() => {
    // Removing an input (save/Escape/close) need not emit focusout.
    if (wanted && !valid(wanted)) request(null);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['disabled', 'contenteditable'] });
  // Editors stop propagation to prevent panel dragging. Capture still sees
  // their clicks, including a click on an already DOM-focused input.
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('focusin', focusIn, true);
  document.addEventListener('focusout', checkFocus, true);
  window.addEventListener('blur', windowBlur);

  return () => {
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('focusin', focusIn, true);
    document.removeEventListener('focusout', checkFocus, true);
    window.removeEventListener('blur', windowBlur);
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    request(null);
    disposed = true;
  };
}
