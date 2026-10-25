# React / Nova migration · 2026-10-25

The Vue frontend has been replaced with React. Desktop surfaces, the control center, search, file-operation reports and widgets now share the source-owned Radix Nova components. The new manager uses a resizable navigation column, compact controls, consistent Lucide icons and neutral light/dark themes.

## Preserved boundaries

- No Rust source or native window policy changes in this migration. The existing Win+D/tray/context-menu handling and rolling diagnostics are retained.
- State remains file-backed with serial writes, three-way merging, exit flush, layout recovery and path-based file identity. Zustand publishes render snapshots and manages session drafts.
- dnd-kit owns internal pointer/keyboard dragging; Tauri retains external Explorer drops and actual file moves. Free desktop positioning and eight-way resizing retain the platform geometry adapter.
- Successful file organization stays quiet. Failures open the result dialog; retry processes only failed items and closes after complete success.

## Validation

- 186 frontend regression tests passed; 65 native regression tests passed.
- TypeScript and production frontend build passed. Main entry is approximately 501 kB minified / 160 kB gzip; manager, desktop, search and shared feature chunks remain split. Vite reports the default 500 kB chunk-size advisory; this is not a build failure.
- Production dependency audit against the official npm registry found no reported advisories at the time of checking.
- Browser fixtures use memory-only IPC. Verified all manager sections, light/dark styles, source details, Escape focus restoration and nested-confirm cancellation.
- Verified todo editing, saving and conflict protection against a simulated remote edit; the local draft remains available.
- Verified file-move failure reports and retry: three initial attempts, two failed-item retries, no repeated move for the successful item, automatic close after success.
- Verified desktop title editing and simulated directory rename, keyboard drag cancellation without accidental launches, and right-click/dropdown/select dismissal. Repeated popup open/close leaves zero transparent hit planes.

## Native acceptance still required

Browser fixtures cannot prove Windows keyboard attachment, Explorer OLE behavior, multi-monitor/DPI transitions, or Win+D Z-order in the user's session. The previously intermittent desktop disappearance was not reproduced or claimed fixed by this UI migration. Keep the diagnostic build workflow and test these interactions after starting the new executable.

The prior running application was not terminated or replaced during development. Exit it from its tray menu before starting this build so pending state can finish saving.
