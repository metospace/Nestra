# React / Nova UI contract

Nestra uses React 19 + TypeScript + Vite. The user explicitly requested migration from Vue to this stack. Do not reintroduce Vue, Nuxt UI, Reka UI, Iconify, or a parallel component system.

| Concern | Single approved implementation |
| --- | --- |
| Accessible controls, dialogs, menus, tabs | shadcn/ui **Radix Nova**, source in `src/components/ui` |
| Icons | Named static imports from `lucide-react`; no remote icon fetches |
| Animation | `motion/react`, under `MotionConfig reducedMotion="user"` |
| Adjacent resizable columns | `react-resizable-panels` via the shadcn resizable component |
| Internal item drag and drop | `@dnd-kit/core` with Pointer/Keyboard sensors and 6px activation threshold |
| Reactive UI state and session drafts | Zustand vanilla stores + React subscriptions |
| Native desktop and real file operations | Existing Tauri/Rust APIs and thin platform adapters |

## Source ownership

The files in `src/components/ui` come from the official MIT-licensed Nova registry at `https://ui.shadcn.com/r/styles/radix-nova/`. Their source is committed, so fixes and styling are reviewable. `scripts/import-nova.mjs` is an intentional upgrade tool, never a build-time download. The installed primitive library is only `radix-ui`.

Local adaptations: registry icon placeholders become static Lucide imports; native portal content/overlays receive `.nestra-hit`; stacking uses the desktop overlay range; registry state shorthands become standard Radix selectors. The second animation CSS package is not installed. Motion is used for page/status transitions; focus, positioning, selection and keyboard navigation belong to the primitives.

All colors live in `src/style.css` as semantic tokens. Light/dark modes share one neutral palette, compact Nova controls, and one blue accent. The system Windows font stack keeps Chinese text legible and offline. Desktop translucency and per-surface appearance remain user settings. Module CSS describes layout, not alternative control implementations.

## State boundary

The existing file-backed application service remains the only writer of persistent state. Zustand publishes detached render snapshots. React components call named service actions or `mutateStore`, never mutate a render snapshot. Async file work is not placed inside a draft mutation. Session drafts and move reports use Zustand without localStorage persistence.

Keep serial writes, CAS/three-way merging, remote-apply suppression, exit acknowledgement, recovery metadata, and path-based ID migration. Remote changes publish a UI snapshot without echo-saving it. Publishing scan arrays reuses detached snapshots until a new scan replaces the source array.

## Required platform adaptations

`react-resizable-panels` handles adjacent manager columns. Arbitrary desktop x/y placement, eight-way resize, multi-monitor containment and save-on-gesture-end remain the native surface adapter; split panels cannot represent that geometry. Internal file drag uses dnd-kit; Explorer OLE drops keep Tauri paths. UI movement never substitutes for a successful disk move.

All keyboard input on the non-activating desktop layer still passes through `desktopInputFocus`. All portals must participate in `.nestra-hit`. Keep focus-session serialization, gesture click suppression, drag cancellation, and the native Win+D/tray/menu rules in AGENTS.md.

## Dependency control

Before introducing a package, check whether the approved libraries already express the behavior correctly. Do not implement generic select/dialog/focus-trap/drag-sensor behavior manually. Compose the source-owned primitives. Add a runtime dependency only with a concrete uncovered requirement and update both this document and the allowlist in `scripts/check-ui-stack.mjs`. Commit the pnpm lockfile. `pnpm build` runs the guard before TypeScript and Vite.

## Verification

`node scripts/test.mjs` covers file operations, persistence, focus, layout, search/IME, drag and Zustand snapshots. Browser fixtures under `tests/fixtures/` use memory-only mock IPC; they must never access real files. Browser QA does not validate Windows native focus/OLE/Z-order. Release builds also retain native tests and the shell worker smoke test. The previous intermittent Win+D disappearance is still unconfirmed; its rolling diagnostic recorder is preserved.
