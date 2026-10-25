/** Windows clips the desktop WebView to .nestra-hit rectangles. The transparent
 * plane lets Radix receive outside-pointer events; Radix still owns dismissal. */
import { useLayoutEffect, useState, type Ref } from 'react';
import { useComposedRefs } from '@radix-ui/react-compose-refs';
import { createPortal } from 'react-dom';
export function useDesktopPopupBoundary<T extends HTMLElement>(forwardedRef: Ref<T> | undefined) {
  const [node, setNode] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const ref = useComposedRefs(forwardedRef, setNode);
  // Select mounts closed children in a detached collection fragment. Its
  // Content ref is assigned only to the real, open popup. The plane must also
  // be a React sibling of Content so Radix classifies a click as outside.
  useLayoutEffect(() => {
    const update = () => setConnected(Boolean(node?.isConnected && node.getAttribute('data-state') !== 'closed'));
    update();
    if (!node) return;
    // Select may retain its content ref while parking its collection outside
    // the document. The native input plane must follow actual DOM attachment.
    const observer = new MutationObserver(update);
    observer.observe(document.body, {subtree:true, childList:true});
    observer.observe(node, {attributes:true, attributeFilter:['data-state']});
    return () => observer.disconnect();
  }, [node]);
  const plane = connected && document.body.dataset.window === 'desktop'
    ? createPortal(<div aria-hidden="true" className="nestra-hit fixed inset-0 z-[9699]" style={{pointerEvents:'auto'}}/>, document.body)
    : null;
  return {ref, plane};
}
