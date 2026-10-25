import { useLayoutEffect, useRef, useState } from 'react';
import { fitOrganizer } from '@/domain/organizerLayout';
import { displayAtPoint } from '@/lib/layout';
import type { DisplayInfo, PanelLayout } from '@/types';

/** Measure chrome, excluding content whose size we control. */
export function useOrganizerLayout(layout: PanelLayout | undefined, count: number, displays: DisplayInfo[]) {
  const rootRef = useRef<HTMLElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [chrome, setChrome] = useState({ height: 42, padding: 16 });
  useLayoutEffect(() => {
    const root = rootRef.current, content = contentRef.current;
    if (!root || !content) return;
    const measure = () => {
      const height = [...root.children].filter(child => child !== content && !(child as HTMLElement).hasAttribute('data-organizer-pages'))
        .reduce((sum, child) => { const style = getComputedStyle(child); return style.position === 'absolute' || style.position === 'fixed' ? sum : sum + child.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0); }, 0);
      const style = getComputedStyle(content), padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setChrome(previous => Math.abs(previous.height - height) < .5 && previous.padding === padding ? previous : { height: Math.ceil(height), padding });
    };
    const resize = new ResizeObserver(measure);
    const observe = () => { resize.disconnect(); resize.observe(root); for (const child of root.children) if (child !== content) resize.observe(child); measure(); };
    const mutations = new MutationObserver(observe);
    mutations.observe(root, { childList: true });
    observe();
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => { resize.disconnect(); mutations.disconnect(); window.removeEventListener('resize', onResize); };
  }, [Boolean(layout)]);
  const bounds = layout && displays.length ? displayAtPoint(layout.x + layout.width / 2, layout.y + layout.height / 2, displays) : { x: 0, y: 0, ...viewport };
  return { rootRef, contentRef, fit: layout ? fitOrganizer(layout, count, bounds, chrome.height, chrome.padding) : undefined };
}
