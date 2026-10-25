import { useEffect, useRef, useState, type RefObject } from 'react';
import { PanelAutoHide, pointerInside } from '@/domain/panelAutoHide';
import { subscribeDesktopPointer, subscribePanelReveal } from './desktopPointer';

export function usePanelAutoHide(key: string, root: RefObject<HTMLElement | null>, enabled: boolean, delay: number, keepOpen: boolean) {
  const [expanded, setExpanded] = useState(false);
  const controller = useRef(new PanelAutoHide());
  const options = useRef({ delay, keepOpen }); options.current = { delay, keepOpen };
  useEffect(() => {
    if (enabled && keepOpen) { controller.current.step(performance.now(), false, true, false, delay); setExpanded(true); }
  }, [enabled, keepOpen, delay]);
  useEffect(() => {
    if (!enabled) return;
    controller.current = new PanelAutoHide();
    controller.current.step(performance.now(), false, options.current.keepOpen, false, options.current.delay);
    setExpanded(options.current.keepOpen);
    const stop = subscribeDesktopPointer(point => {
      const node = root.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const active = document.activeElement;
      const editing = !!active && node.contains(active) && active.matches('input,textarea,[contenteditable="true"],[role="textbox"]');
      const held = editing || !!node.querySelector('[data-native-menu-open="true"]')
        || ['is-gesturing','is-item-dragging','is-external-dragging'].some(name => document.body.classList.contains(name))
        || !!document.querySelector('[role="menu"][data-state="open"],[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]');
      const shown = controller.current.step(performance.now(), !!point && pointerInside(point, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }), options.current.keepOpen || point === null, held, options.current.delay);
      setExpanded(previous => previous === shown ? previous : shown);
    });
    const stopReveal = subscribePanelReveal(key, () => { controller.current.reveal(performance.now()); setExpanded(true); });
    return () => { stop(); stopReveal(); };
  }, [enabled, key, root]);
  return !enabled || keepOpen || expanded;
}
