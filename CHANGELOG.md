# Changelog

All notable changes to this project will be documented in this file.

## [1.2.1](https://github.com/JackUait/blok/compare/v1.2.0...v1.2.1) (2026-07-16)

### Features

- **Image** — Images now display at the full width of the article by default. Previously an image without an explicit size preset rendered at the medium (520px) preset; the default is now the `full` preset. Images with an explicitly saved `size` are unaffected.

### Bug Fixes

- **Popover** — The search input's focus ring was clipped along its bottom edge by the context label's opaque background painting over it; the search wrapper now renders in the positioned paint layer so the full ring is visible. The gap between the search field and the context label was also widened slightly.

## [1.2.0](https://github.com/JackUait/blok/compare/v1.1.1...v1.2.0) (2026-07-16)

### Features

- **Media** — Playback speed and loop preferences now persist across audio and video blocks. They are stored in `localStorage` under shared per-media-type keys (`blok:audio:rate`/`loop`, `blok:video:rate`/`loop`), joining the existing shared volume and per-source position keys, and are restored when a player attaches — without dirtying block data.

### Bug Fixes

- **Quote** — Saving a quote block no longer strips `href`/`target`/`rel` from links (leaving dead anchors in stored content) or unwraps bold/italic marks. Quote now uses the same inline-text sanitize rules as paragraph and header, so links, formatting, and color styles survive save and conversion.
- **Audio** — OneDrive share links from SPO-migrated accounts (the new `/u/c/<cid>` form) can't be resolved anonymously and produced a silently dead player; they now surface a clear "needs an uploader backend" error instead.
- **Toolbar** — The plus button and drag handle no longer stay stuck at the wrong offset after the slash-command popover opens or closes; the toolbar repositions on toolbox open/close instead of relying on a resize side effect.
- **Toolbox** — Opening the toolbox silenced the current block's mutation watching and never re-armed it, leaving the block permanently deaf to later content changes until re-render. Watching is now re-armed on both close paths, and the toolbar follows any inner-geometry change that doesn't resize the block holder.

### Maintenance

- **CI** — The build artifact now ships the extracted `packages/*/dist` adapter bundles alongside `dist/`, fixing downstream unit and E2E jobs; `yarn.lock` was synced to the `^1.1.1` core peer range.
- **Docs** — README and the docs site updated for the `@bloklabs/*` package family; the rename notice was subsequently dropped from the README.

## [1.1.1](https://github.com/JackUait/blok/compare/v1.1.0...v1.1.1) (2026-07-15)

### ⚠ BREAKING CHANGES — the `@bloklabs/*` scope rebrand

The package family moved from the personal `@jackuait` scope to the dedicated `@blok` npm scope, and the framework adapters became standalone packages:

| Old | New |
| --- | --- |
| `@jackuait/blok` | `@bloklabs/core` |
| `@jackuait/blok/react` | `@bloklabs/react` |
| `@jackuait/blok/vue` | `@bloklabs/vue` |
| `@jackuait/blok/angular` / `@jackuait/blok-angular` | `@bloklabs/angular` |
| `@jackuait/blok-cli` | `@bloklabs/cli` |
| `@jackuait/blok/tools` (and other subpaths) | `@bloklabs/core/tools` (unchanged subpaths) |

- **`@bloklabs/core` has zero peer dependencies.** The react/react-dom/vue optional peers are gone — installs no longer warn about frameworks you don't use, and the GitHub Packages `peerDependenciesMeta`-stripping bug (which forced Yarn Berry consumers to add a `packageExtensions` workaround) no longer applies. Delete that `.yarnrc.yml` entry after upgrading.
- **Adapters declare hard, accurate peers**: each requires its framework plus `@bloklabs/core` at the matching version.
- **GitHub Packages mirrors**: `@dodopizza/blok` remains the core mirror; adapters mirror as `@dodopizza/blok-react`, `@dodopizza/blok-vue`, `@dodopizza/blok-angular`; the CLI stays `@dodopizza/blok-cli`.
- **Migration**: the bundled codemod (`npx -p @bloklabs/core migrate-from-editorjs`) now also rewrites legacy `@jackuait/*` import specifiers and `package.json` dependency keys to the new names.

## [1.1.0](https://github.com/JackUait/blok/compare/v1.0.0...v1.1.0) (2026-07-15)

### Features

- **Audio** — Share links from seven more services — Dropbox, OneDrive, GitHub, GitLab, Hugging Face, Google Cloud Storage, and Internet Archive — are recognized and rewritten to their direct-content form, so they play in the browser with no backend. Google Drive share links (hotlink-blocked server-side) are normalized and routed through the consumer's `uploadByUrl` backend, with a Drive-specific error message when none is configured. The error state gets a styled callout with a retry button.
- **Read-only** — `readOnly` now accepts an object form: `{ hideControls: true }` enables read-only mode and suppresses the toolbar, block settings, and inline toolbar. Exposed via `isControlsHidden`, normalized across the React, Vue, and Angular adapters, and `ReadOnlyModeConfig` is exported from the types root.
- **Image** — `compress: { format: 'avif' }` now produces real AVIF via WebCodecs when the canvas encoder cannot, and a new `fallbackFormat` option (e.g. `'webp'`) covers browsers with no AV1 encoder instead of silently uploading the original bytes.

### Bug Fixes

- **Audio** — Audio inserted by URL is now enriched like uploads: waveform, title/artist metadata, and cover art, failing soft to a plain scrubber when the host blocks the CORS fetch.
- **Table** — Undo inside a table no longer duplicates cell blocks into invisible ghosts that reappear under the table after save; blocks placed at the top of a cell no longer drift to the bottom or become orphans on save. The Saver gains save-boundary guards for cell membership and cell block order (throw in dev/test, repair the emitted output in production).
- **Tooltip** — The tooltip bubble is click-transparent, so it never swallows clicks on controls it covers (e.g. color-picker swatches under a bottom-row tooltip).
- **Popover** — Nested popovers no longer collapse to their padding in WebKit; the marker color picker rendered as a 12px sliver in Safari.
- **Styles** — Body-mounted UI (link hover card, notifier toasts, drag previews) now carries the scope attribute, so its styles survive in consumer apps; a new architecture test enforces the invariant for every `document.body` mount.
- **Angular** — The ng-packagr build stages the readonly-config module, fixing a CI-only TS2307; an architecture test now walks the adapter's import graph to catch unstaged modules.

### Maintenance

- **Playground** — Gallery empty states run the real tool per state (with per-state tool config) instead of static mockups, including a live Google Drive error demo.
- **Tests** — Adversarial table undo probes (merge undo, insert undo/redo), tooltip click-transparency lifecycle guards, and an exhaustive swatch hit-test sweep.

## [1.0.0](https://github.com/JackUait/blok/compare/v0.25.0...v1.0.0) (2026-07-14)

First stable release. The public API, block-tool contract, and framework adapters (React, Vue, Angular) are now considered stable and follow semantic versioning going forward.

### Features

- **Header** — Toggle headings are now offered at all six levels, staying in sync 1:1 with regular headings.

### Bug Fixes

- **Migration** — The legacy Editor.js grammar is now authored as ESM so consumer dev servers can load blok's source graph without a build step.
- **Columns** — Blocks inserted via the plus button no longer save at the bottom of the column; saved order now matches the on-screen (WYSIWYG) order.
- **Styles** — Injected utilities are scoped so a host application's CSS reset can't flatten the editor.

### Maintenance

- **Migration** — Single-source `LEGACY_GRAMMAR` shared by both the runtime and the codemod; the codemod's source rewrite is now AST-guided (via the consumer's `@babel/parser`) to avoid mangling comments, strings, and unrelated identifiers.
- **CI** — Root-caused CI failures: scoped-utility drift on body-mounted UI, lint, and test flake fixes (webkit paste timing, six-level toggle-heading counts).

## [0.25.0](https://github.com/JackUait/blok/compare/v0.24.3...v0.25.0) (2026-07-13)

### Features

- **Spacer** — New adjustable-height spacer block. Drag either edge to resize (dual-edge grips), with a text-block-height floor, snap-to-sibling and snap-to-column alignment guidelines, an on-edge capsule resize pill, and accent hover cues. Fully invisible in read-only/published renders.
- **Image** — Uploads are now automatically compressed and re-encoded (`compress`, on by default), with opt-in smaller output formats. In-cell images gain a resize floor and fluid chrome via container queries.
- **Toolbar** — `Cmd`/`Ctrl+Slash` opens the block menu in read-only mode.

### Bug Fixes

- **Table** — Large batch of Notion-parity fixes: paste-header handling, the cell color picker, the cell menu, arrow-key navigation between cells, and column width reset. The cell box now follows the caret (instead of the pointer) and the resize handle no longer forces overflow. Focus stays inside a cell when its content is deleted, the caret stays put after clearing a multi-cell selection, multi-line cell selections merge into one rounded shape, drag-selecting several lines within a single cell works, and list items scale to the cell font instead of outsizing sibling paragraphs.
- **Columns** — Stranded resize separators left behind by removing a column no longer render as a phantom column.
- **Core** — Never Tab-indent a block into a tool-owned container.
- **Toolbox** — Keep plus-button blocks on a table out of its cells, and anchor fuzzy search at word boundaries.
- **Selection** — Stop hijacking intra-line text drags inside table cells.
- **Embed** — Validate stored URLs at render time (stored-XSS guard).
- **List** — Keep bullet markers non-editable so Enter never ghosts an item.
- **Toolbar** — Read-only drag-handle refinements: announce it as a menu button, show a pointer cursor, and drop the `⌘/` and "Drag to move" hint lines; no read-only handle appears beside blocks that paint nothing.
- **Tunes** — Hide the copy-link shortcut hint in read-only mode.
- **Styles** — Right `contentAlign` no longer collapses into centering, and preflight resets are scoped to `@layer base` so Blok's own utilities win.
- **React** — Guard against stale `dist` exports and a `StrictMode` readiness race.

## [0.24.3](https://github.com/JackUait/blok/compare/v0.24.2...v0.24.3) (2026-07-10)

### Features

- **Header** — Opt-in `anchorIds` config derives stable heading anchor ids from heading text.

### Bug Fixes

- **Link** — Pad the edit-menu input wrapper so the focus ring isn't clipped, and enlarge the remove-link (trash) icon.

### Maintenance

- **CI** — Fetch mirror tags before pushing to avoid creating over an existing tag.

## [0.24.2](https://github.com/JackUait/blok/compare/v0.24.1...v0.24.2) (2026-07-09)

### Features

- **Link** — New `link.transform` config, a superset of `transformHref`: consumers can set per-anchor `href`/`target`/`rel` plus extra attributes (`class`/`title`/`data-*`) without post-processing the rendered DOM. Applies consistently across every anchor path (render, paste, and hand-created links); omitted fields fall back to existing defaults (including the same-page `_self` rule) and extra attributes never clobber the managed `href`/`target`/`rel`.

### Bug Fixes

- **Columns** — Keep the inter-column gutter in read-only/published renders. The gap was previously produced entirely by the (no-op in read-only) resize handles, so read-only columns rendered flush; the gutter is now decoupled from the resizers.
- **Link** — Center the hover card under the pointer (shifting near viewport edges) with a fixed gap to the link, and stop the block toolbar leaking through the card when hovering top-layer chrome.
- **Notifier** — Fix top-layer placement so the toast stays in its corner (no UA Canvas box or top-left jump), remove the in-pill dismiss cross (auto-dismiss/Escape still close it), and tighten the pill's vertical padding.

## [0.24.1](https://github.com/JackUait/blok/compare/v0.24.0...v0.24.1) (2026-07-09)

### Bug Fixes

- **Types** — Fixed a publishing defect (introduced in 0.24.0) where importing `@dodopizza/blok/react` — or `@dodopizza/blok/markdown` — made a consumer's TypeScript compiler follow the published declarations into raw `src/` implementation, producing spurious errors about unresolved `micromark-util-types` / `@types/mdast` (`TS2307`) and implicit `any` (`TS7006`). The public `types/*.d.ts` surface is now self-contained and no longer re-exports from `src/`.

### Maintenance

- **Types** — Mechanically enforce that no published `types/*.d.ts` re-exports or imports from `src/`, and generate the self-contained icon declarations from source (`scripts/generate-icons-dts.mjs`).

## [0.24.0](https://github.com/JackUait/blok/compare/v0.23.5...v0.24.0) (2026-07-09)

### Features

- **Vue** — New first-class `@jackuait/blok/vue` adapter: `BlokEditor` component, `useBlok`, and `provideBlok`, plus `createVueBlock`/`useBlocks` for authoring custom blocks and driving the block tree from Vue. Custom Vue blocks support read-only in-place toggling.
- **Angular** — New first-class `@jackuait/blok/angular` adapter shipped as an Angular Package Format build (ng-packagr): the editor component/directive, a block portal registry, the `BLOK_BLOCK_CONTEXT` render-context token, `createAngularBlock` authoring, and the reactive `injectBlocks` block-tree API.
- **React** — New `useBlocks` hook exported from `@jackuait/blok/react`: a reactive block-tree API with reads, `insert` (position + append-to-parent, explicit id, tunes, `replace`), `move` (before/after/toIndex), `nest`/`unnest`/`remove`/`transact`, `insertMany`, atomic `insertTree` for nested subtrees, and additive `insertMarkdown`. Block-creation semantics are hardened across hierarchy edges with compile-time drift guards against the core API.
- **Adapters** — Closed React/Vue/Angular parity gaps across component paths and escape hatches; shared one blocks-api core so Vue's `useBlocks` reaches React parity, and extracted shared `fillDefaults`/`PropSchema` helpers. Custom-block authoring is now first-class on the public API surface.
- **Accessibility** — Five-wave overhaul adapting shadcn/ui interaction patterns to Blok's UI primitives: dismissal-layer/popover teardown/scroll-lock/announcer foundations, an anchored-positioning engine and shared modal `Dialog`, keyboard reachability for toolbars/menus/radios/rename, and assistive-tech feedback parity across selection, drag, menus, and arrival.
- **Link** — Clickable links with a hover card in both edit and read-only modes (with enter/leave animation), an edit mode featuring a title field and remove-link action, refined hover-card chrome, blocking of unsafe-scheme navigation, and a consistent same-page/anchor-link rule that opens such links in the same window across all link-creation paths.
- **Blocks** — Structural `parentId` nesting: any block can now be nested inside any list (flat per-block indent), with list keyboard nesting and drag/serialization migrated onto the structural block tree.
- **Keyboard** — `Cmd+Left`/`Cmd+Right` navigate between blocks at block edges; `Backspace` at the start of a nested block removes one indent level; mixed-list `Tab` indents both kinds; and numerous Notion-parity `Tab`/arrow/Delete/Backspace fixes.
- **Paste** — Paste-without-formatting (`Cmd`/`Ctrl+Shift+V`); recovery of buildin/Notion toggles and soft breaks from lossy GFM HTML fallback.
- **Inline** — Link-markdown auto-format and a link-paste menu; shortcut-triggered Link/Equation/Marker now open a standalone menu positioned right under the selection.
- **Popover** — Custom cross-platform scrollbar that hides the classic OS bar while keeping a stable gutter; reel-like edge distortion replacing the scroll haze.
- **Convert** — Shared `buildConvertMenuEntries` with `titleKey` resolution, used by both block settings and the inline "Turn into" menu (which now lists the full text family), guarded by parity E2E.
- **Image** — Configurable auto-retry on image load failure (default 5).

### Bug Fixes

- **CRDT/Yjs** — Undo/redo no longer yanks the caret to the top of the document; the caret restores to the correct position, `split()` inherits full tool data (correct heading undo caret), redo moves the caret to the new block on an Enter split, and five further Yjs sync gaps in tools and modules were closed.
- **List** — Closed dozens of Notion-parity divergences across convert, keyboard, drag, selection, and copy/paste; source ordered lists renumber when an item is dragged away; bullet glyphs refresh on depth change.
- **Text/Header** — Fixed 30+ Notion-parity bugs by root cause (slash+space, duplicate pulse, indent toolbar, caret offset preservation on turn-into, and more).
- **Table** — Preserve merged cells and lists when pasting external tables, and keep list markup when copying cells out to external apps.
- **Paste** — Preserve lists and quote-ness in pasted blockquotes; pasted links use the default link color; the link menu shows on non-empty blocks without erasing content; closed remaining sanitizer/merge data-loss gaps found by an audit.
- **Blocks** — Re-parent a merged block's children onto the survivor instead of orphaning them; release toggle children as siblings when turning a toggle into text; fire the tool `moved()` hook on `setBlockParent`; never write split text into a mutation-free decoration.
- **Columns** — Match Notion's inter-column gutter spacing; restore DOM order when undoing column creation.
- **Drag** — List-item drop line tucks under the text with a marker lead-in; depth changes apply on same-slot drops; non-list blocks stop previewing nested drops they can't reach.
- **Selection** — Fake highlight matches the native selection color and stays visible while a menu input is focused; `Cmd+A` container-scoped staging.
- **Marker** — Reset `<mark>` background so colored text never shows the browser's yellow highlight.
- **Toggle** — Arrow container stays a constant 28px square and pins to the first line for multi-line toggle/heading.
- **Styles** — Reserve a scrollbar gutter on all scrollable components and keep it in nested inline-toolbar menus; auto-hide scrollbars system-style while keeping the gutter.

### Maintenance

- **Paste** — Mechanically enforce the paste attribute law and the paste stamp law via architecture tests.
- **Tests** — Repaired all CI-matrix E2E shards; added regression coverage across list keyboard shortcuts, columns undo order, popover scrollbar spec, and adapter integration/e2e.
- **Lint** — Resolved all 69 root ESLint problems at the root cause.

## [0.23.5](https://github.com/JackUait/blok/compare/v0.23.4...v0.23.5) (2026-06-25)

### Features

- **Core** — The `link` config (`{ target, rel, transformHref }`) now also applies on the **render** and **paste** paths, not just the interactive link tool. Anchors coming from stored block HTML (rendered via `blocks.render()`) and `<a>` arriving through the clipboard now get the configured `target`/`rel` forced and `transformHref` applied to their href — so consumers no longer need to post-process the rendered or pasted DOM. Because the render path rewrites live anchors whose href round-trips into saved data, `transformHref` must be idempotent.
- **Core** — New `onBeforeRender(blocks) => blocks` config transforms the blocks array before every render (the initial render and each `blocks.render()`), letting you run app-specific data migrations inside Blok instead of pre-processing the data yourself. It runs on the raw saved blocks before format analysis, so it can also inject blocks into an empty document.
- **Core** — New `onAfterRender(api)` config fires after a render completes and the blocks are in the DOM (initial render and every `blocks.render()`), for post-render side effects such as scroll restoration — distinct from the once-only `onReady`.
- **Core** — A stable `data-blok-rendered` attribute (exposed as `DATA_ATTR.rendered`) is now set on the editor wrapper when a render batch finishes inserting blocks, and removed while a re-render is in flight — a DOM-level render-readiness gate that complements the existing `blocks:rendered` event.
- **Block Tunes** — A custom tune's `render(context)` now receives an optional `BlockTuneRenderContext` whose `getPopoverElement()` returns the host tune popover element (`[data-blok-popover]`), so tunes can anchor sub-menus or portals inside Blok's popover without reaching into the DOM via `closest(...)`. The element resolves once the popover mounts (it is `null` synchronously during `render()`).
- **React** — `<BlokEditor>`/`useBlok` now accept `onBeforeRender` and `onAfterRender`. Both are attached only when provided and are ref-stable, so updating the callbacks never recreates the editor.

## [0.23.4](https://github.com/JackUait/blok/compare/v0.23.3...v0.23.4) (2026-06-25)

### Features

- **Core** — New `onSave(data, api)` config delivers the full serialized `OutputData` (debounced via the existing change-batch window) whenever content changes — the "output half" of a controlled editor. Pair it with the `data` config to mirror editor state into your own store with a single callback instead of calling `saver.save()` by hand. Only user-driven changes trigger it; programmatic `render()` does not (the change observer is disabled during render), so a controlled round-trip won't recurse. Available to all consumers, not just React.
- **React** — `<BlokEditor>`/`useBlok` now accept `onSave`, making `<BlokEditor data={data} onSave={setData} />` a true controlled component to pair with the reactive `data` prop from 0.23.3. The callback is ref-stable (never recreates the editor) and attached only when provided. Echoing the payload straight back via `onSave={setData}` is caret-stable: the adapter records the editor's own emitted output as the content baseline, so the round-trip deep-equal–dedupes to a no-op (no re-render, no caret reset) while genuine external `data` changes still render in place.

## [0.23.3](https://github.com/JackUait/blok/compare/v0.23.2...v0.23.3) (2026-06-25)

### Features

- **React** — The `<BlokEditor>`/`useBlok` `data` prop is now reactive: passing new content re-renders the editor in place via `editor.render()` instead of being read only once at creation. Identical content is de-duplicated (deep-equality) so the caret is never clobbered, rapid changes are serialized, and a freshly-seeded editor is not double-rendered.
- **Core** — New typed render events: `blocks:rendered` (payload `{ count }`) fires when a batch finishes rendering, and `block:rendered` (payload `{ blockId }`) fires per block. The runtime event-name constants `BlocksRendered`/`BlockRendered` are exported, so consumers can react to rendering instead of polling the DOM. The public `Events` API is now typed against an event/payload map while still accepting arbitrary string events.
- **Core** — New `link` config (`{ target, rel, transformHref }`) lets consumers configure the anchors the link tool creates instead of post-processing the DOM. Defaults (`_blank`/`nofollow`) are preserved, configured values now survive save, and URL validation/allowlisting is unchanged.
- **Paste** — New `onBeforePaste(html) => string | null` config hook transforms (or drops) raw clipboard HTML before Blok preprocessing; returning `null` falls back to plain-text paste.
- **API** — New `editor.tools.update(name, config)` shallow-merges a tool's config in place — e.g. swap an uploader — without recreating the editor.

### Maintenance

- **Tests** — Exported stable `TEST_ID` constants (plus button, settings toggler, block wrapper) wired into the editor chrome via `data-blok-testid`, so consumers no longer query internal selectors.

## [0.23.2](https://github.com/JackUait/blok/compare/v0.23.1...v0.23.2) (2026-06-25)

### Maintenance

- **Docs** — Documented two React-adapter caveats. `<BlokEditor>` must not be wrapped in `styled()` or any HOC that reserves the `theme` prop: styled-components claims `theme` for its own `ThemeProvider`, so it never reaches the editor and theme sync silently breaks — render it directly and style the container via `className`. And `deps` values must be referentially stable (each value compared individually, not the array wrapper), otherwise the editor is recreated on every render. Both caveats now appear in the README, the docs site, and the `BlokEditor`/`useBlok` JSDoc and published type declarations.

## [0.23.1](https://github.com/JackUait/blok/compare/v0.23.0...v0.23.1) (2026-06-25)

### Features

- **Core** — A new `editor.placeholder` runtime API (`get`/`set`) lets consumers read and change the empty-paragraph placeholder on a live editor, mirroring the existing `width` API. Updates apply to existing blocks and to blocks created afterwards.
- **React** — `<BlokEditor>` now accepts a reactive `placeholder` prop (backed by the new core API) that updates the editor in place without recreating it, and forwards all standard `<div>` attributes — `id`, `aria-*`, `data-*`, and the like — to the editor container.

## [0.23.0](https://github.com/JackUait/blok/compare/v0.22.0...v0.23.0) (2026-06-24)

### Features

- **React** — A blessed `<BlokEditor>` component is now the recommended way to embed Blok in React. It forwards a typed ref to the live editor instance, takes an uncontrolled `data` seed, and reactively syncs `readOnly`, `autofocus`, `theme`, and `width` props without recreating the editor. Its `onReady` callback fires after the ref commits, so consumers can safely call `ref.current` from inside it. The lower-level `useBlok` hook plus `BlokContent` remain available as an escape hatch.

### Maintenance

- **React** — `useBlok` now reactively syncs `theme` and `width` prop changes to the editor instance, mirroring the existing `readOnly`/`autofocus` pattern.
- **Docs** — The demo wrapper now dogfoods `BlokEditor`, and the README React section documents the recommended `BlokEditor` path, the uncontrolled `data` contract, reactive props, and the `useBlok` + `BlokContent` escape hatch.
- **Tests** — Added e2e coverage for save-via-ref and live prop toggles, a published-vs-source type-drift guard, and `data-blok-testid`-based locators.

## [0.22.0](https://github.com/JackUait/blok/compare/v0.21.1...v0.22.0) (2026-06-24)

### Features

- **Paste** — Content copied from buildin.ai now imports as native Blok blocks at full fidelity. buildin's clipboard carries a lossless `text/next-space-blocks` JSON payload beside a lossy Markdown/HTML twin; Blok previously fell back to the twin, where tables collapsed to literal `|pipes|`, media degraded to links, and callouts, toggles, columns, to-dos, and code language flattened away. A new handler decodes the JSON directly, reconstructing the same native blocks as a Blok→Blok paste — paragraphs, to-dos, H1–H4, tables (grid + parented cells), bulleted/numbered lists, toggles, dividers, quotes, callouts (emoji + colour), code (with language), equations, toggle-headings, column lists, and image/video/audio/file/embed-bookmark media. (Inline marks — bold/italic/link/colour — are a documented follow-up.)

### Bug Fixes

- **Paste** — Callout body and colour now survive import from both Notion and buildin.ai. Blok's callout stores its body in child blocks, so the inline title/body text the parsers emitted as `data.text` was silently discarded — the callout is now emitted (colours only) plus a child paragraph carrying its text. Out-of-palette callout colours (e.g. buildin's British `grey`, or any name outside Blok's 9-colour preset) previously produced an undefined CSS variable that dropped both the background and the border; colours now normalize through Blok's preset palette (`grey`→`gray`; unknown names clamp to null).

## [0.21.1](https://github.com/JackUait/blok/compare/v0.21.0...v0.21.1) (2026-06-24)

### Features

- **Media** — Image, video, audio, and file blocks can now be restricted to upload-only or link-only via configuration, so consumers can offer a single source instead of always exposing both.

### Maintenance

- **Media** — Deduped `MediaSource` into a single shared type across the media tools.
- **Docs** — Documented the audio block tool, and added upload-only and link-only empty states to the playground gallery.

## [0.21.0](https://github.com/JackUait/blok/compare/v0.20.0...v0.21.0) (2026-06-23)

### Bug Fixes

- **Paste** — Rich clipboards (Notion and similar) ship both a faithful HTML payload and a lossy Markdown twin. Routing now prefers the HTML handler, so pasted images, links, and structure the Markdown twin drops are preserved.
- **Paste** — Notion content keeps its document order: nested children no longer render above their parents (only table cells stay children-first, since the table tool resolves cell ids on insert). Internal references that previously vanished — sub-pages, linked databases / collection views, and inline page mentions — now paste as Notion bookmarks/links instead of being dropped or leaking the raw "‣" glyph, and uploaded media whose binary isn't on the clipboard becomes a Notion-link bookmark carrying the filename rather than a bare filename paragraph.
- **Paste** — Pasted external Notion audio now shows its title (the player reads `data.title`, which was left blank), and a malformed inline date annotation no longer leaks the raw "‣" placeholder glyph.

### Maintenance

- **Tests** — Added regression coverage for HTML-over-Markdown routing, document-order preservation, internal-reference rescue, pasted audio titles, and date-glyph handling.

## [0.20.0](https://github.com/JackUait/blok/compare/v0.19.2...v0.20.0) (2026-06-22)

### Features

- **Paste** — Content copied from Notion now migrates as native blocks with full state preserved. When Notion's lossless clipboard JSON is present it is used directly (the high-fidelity path), with an HTML fallback for sources that only expose markup. Inline equations and page mentions are mapped to their Blok equivalents.
- **Audio** — Custom cover art. A cover picker (file upload or image URL) opens from an editable overlay button on the player; covers can be set, replaced, or removed (via a "Remove cover" block setting), with an animated picker open, a sliding Upload/Link tab transition, a themed surface that matches the player, and i18n across all locales. Audio blocks with no cover now show an inertial spinning-vinyl turntable placeholder instead of an empty panel.

### Bug Fixes

- **Audio** — Repaired the transport controls and the video-style playback-speed menu, which now stays open after picking a preset. The volume bar fill is fixed so a muted track reads differently from a full one, and the playing waveform pulses smoothly without gouging its dots. The caption toggle stays on the compositor, and the cover picker no longer jumps height on tab swap, gets an explicit width so the URL field isn't cramped, and revokes leaked cover blobs on a destroy race.
- **Table** — Pinned the top toolbar anchor flush to the table edge.

### Maintenance

- **Tests** — Added unit and e2e coverage for custom cover set/remove and for real Notion page-mention arity, and cleared the lint/type violations the cover-art work introduced.

## [0.19.2](https://github.com/JackUait/blok/compare/v0.19.1...v0.19.2) (2026-06-20)

### ⚠ BREAKING CHANGES

- **Types** — `OutputBlockData`'s `data` field is now typed `Record<string, unknown>` instead of `any` (matching `BlockToolData` and `SavedData`). Reading a property off a saved block's `data` — e.g. on `save()` output — now yields `unknown` rather than `any`, so code that indexes into `block.data` may need a cast or type guard. This is a type-only change with no runtime effect.

### Bug Fixes

- **Types** — Published `.d.ts` declarations are now self-contained and no longer re-export raw `src/*.ts`. A bare `import { Blok } from '@jackuait/blok'` previously dragged editor source into the consumer's TypeScript program (through `tooltip` and `popover` → `flipper`), surfacing internal type errors under strict consumer flags such as `noUncheckedIndexedAccess`. The `tooltip` and `popover` declarations now inline their public types, so consuming the package no longer type-checks Blok's internals. (The opt-in `/markdown` subpath is unchanged.)
- **Types** — The published declarations are now internally consistent under `skipLibCheck: false`. Fixed an incorrect `BlockToolData` import path in the `database`/`header`/`list` tool declarations (which also produced spurious "incorrectly extends `BlockTool`" errors), added a missing `InlineToolConstructable`/`InlineToolConstructorOptions` import in the type entry, and removed phantom `Dictionary`/`DictValue` re-exports.

### Maintenance

- **Dependencies** — Moved `nanoid` to `devDependencies`; it is bundled into every dist artifact and was never a runtime external.

## [0.19.1](https://github.com/JackUait/blok/compare/v0.19.0...v0.19.1) (2026-06-20)

### Features

- **Types** — `isReady` now resolves with the fully-initialized `Blok` instance (was `Promise<void>`), so `const editor = await blok.isReady` yields a ready, fully-typed editor without a cast. New exported `PendingBlok` type describes the surface available synchronously after `new Blok()` and before `isReady` resolves (`isReady`, `destroy`, `theme`, `width`) — type a reference held during that window as `PendingBlok` instead of widening to `Partial<Blok>`, then await `isReady` to narrow it to the full API. `new Blok()` still returns the full `Blok`, so existing usage is unaffected.

## [0.19.0](https://github.com/JackUait/blok/compare/v0.18.0...v0.19.0) (2026-06-20)

### Features

- **Width** — New public `width` API on the editor instance: `instance.width.get()`, `set('full' | 'narrow')`, and `toggle()` switch the content layout between `'narrow'` (the default, constrained to `--max-width-content`) and `'full'` (the content `max-width` is removed so it fills its container). It mirrors the `theme` API, including buffering a `set()` call made before the editor is ready and replaying it once the editor is initialized.

### Bug Fixes

- **Types** — Declare the `history` API on the exported `Blok` instance type. `history` (`clear()`, `undo()`/`redo()`, `canUndo()`/`canRedo()`) was already available at runtime; consumers no longer need to cast the instance to reach it.

## [0.18.0](https://github.com/JackUait/blok/compare/v0.17.0...v0.18.0) (2026-06-19)

### Features

- **Audio** — New native Audio block tool. Now-playing card with cover art (lazy `music-metadata` extraction), a waveform canvas with click/drag seek, transport controls (play/pause, volume, playback speed, loop, keyboard shortcuts, persisted preferences), file and URL upload, paste handling routed away from the File block, read-only support, and i18n across all locales. The player card is a full-bleed redesign — a tall cover panel (music-note placeholder when there is no art), a hero waveform scrubber with rounded bars, a slim transport bar, and motion polish.
- **Media** — Image, video, and audio blocks now accept any file of their media family (`image/*`, `video/*`, `audio/*`) by default. Restrict the accepted types through the existing `types` config, which now accepts both exact MIME types (`image/png`) and family wildcards (`image/*`).

### Bug Fixes

- **Types** — Export `File`, `Audio`, and `Video` (and their data/config/uploader types) and add the `file`/`audio`/`video` keys to `defaultBlockTools` from the `@jackuait/blok/tools` types entry. The runtime already exported these tools; consumers no longer need a local ambient type shim to import them.

### Maintenance

- **Playground** — Audio block states in the block-states gallery (real ID3-tagged track and a "No cover art" state) plus an e2e harness for insert/upload/play/seek.

## [0.17.0](https://github.com/JackUait/blok/compare/v0.16.1...v0.17.0) (2026-06-19)

### Features

- **Video** — New native Video block with a custom Airbnb-style player, brought to YouTube parity: full keyboard control (`j`/`l`/`k`, `0`–`9`, `Home`/`End`, frame-step, volume, speed), a scrubber with buffered range, hover frame-preview tooltip and mini progress bar, an in-player gear menu (Notion-style playback speed with glide, loop, ambient-glow intensity), and view modes — picture-in-picture, a FLIP-morphed theater/cinema mode, and a fade-in ambient glow. Player polish includes click-to-toggle play/pause, a centre play/pause burst, press-and-hold for 2× playback, arrow-key ±5s seek with side indicators, idle auto-hide, buffer spinner, time-remaining toggle, right-click menu, stats overlay and persisted preferences.
- **Video** — Custom fullscreen surface with a top caption bar, a "Hide controls" tune for a control-free player, and GIF-style autoplay/loop tunes.
- **Image** — Auto-convert dropped, pasted and remote-URL GIFs into a looping Video block via WebCodecs + webm-muxer, gated by the `convertGifToVideo` config (default on); the original GIF is kept on CORS failure, with a "Converting…" label shown during conversion.
- **Media** — 30MB default upload limit with per-type `maxSize` configuration and human-readable too-large errors.

### Bug Fixes

- **Paste** — URL paste always prompts now; the previous auto-embed behaviour has been removed. **Breaking:** consumers relying on silent auto-embed must opt in through the paste menu.
- **Video** — Reserve the aspect ratio before metadata loads to prevent squeeze-on-load, centre and letterbox the fullscreen player, strip editor chrome in fullscreen, and hide the bottom mini progress bar while fullscreen.
- **Video** — Exit theater mode reliably on Escape via a capture-phase listener with a smooth deferred dismiss, and drive the scrubber fill with `requestAnimationFrame` for smooth playback tracking.

### Maintenance

- **Build** — Move `webm-muxer` to devDependencies so it is bundled rather than treated as an external runtime dependency.
- **README** — Replace the logo with the optimized noodle mascot.
- **Playground** — Use real self-hosted videos in the block-states gallery.

## [0.16.0](https://github.com/JackUait/blok/compare/v0.15.1...v0.16.0) (2026-06-16)

### Features

- **File** — New File block tool. Tabbed empty state with upload (validation, progress bar, cancel), URL and drag-and-drop; per-type icon and tint; editable filename; consumer upload endpoints and download card. Rich preview modal dispatched by kind: PDF (top-layer modal with open-in-new-tab), Office (docx/xlsx/pptx via lazy renderers, xlsx parsed through JSZip), and text/code/markdown — including advanced markdown (math, footnotes, references, alerts, anchors, safe block-level raw HTML) with an animated Rendered ⇄ Raw toggle. Read-only support, i18n in every locale, and Storybook stories.
- **Embed** — Generic embed: frame arbitrary URLs through a gated resolver, offered in the paste menu behind the `linkPaste.allowGenericEmbed` flag with an `api.config` accessor. Replace the source via an empty-state URL bar and an overlay more-menu item.
- **Migration** — Complete Editor.js block-type coverage plus a drop-in UMD build; adapt legacy Editor.js inline tools and `linkTool` data.
- **Playground** — Block-states selector as a fixed left side menu; real docx/xlsx/pptx, code and text samples for the File block; richer quarterly-budget sheet; File block wired into the editor demo.

### Bug Fixes

- **Table** — Resolve merged-cell coordinate bugs; preserve merges on load; split overlapped merges on paste so no destination data is dropped; keep empty cells editable on the read-only→edit toggle; harden input, clipboard and move-guard handling.
- **File** — Unbreak pptx preview; vertically center the preview modal; stop wrong-colour strips and toggle flicker during preview transitions; block `javascript:` URLs in download hrefs.
- **Build** — Make the published install self-contained (ship `src`, keep markdown and nanoid as runtime deps) so bundlephobia can build; green the self-contained-install and css-token audits.

### Maintenance

- **Refactor** — Extract table visual-subsystem orchestration into `TableSubsystems`; split `BlockOperations` into focused worker classes; share the media uploader empty state across the image and file tools.
- **Code** — Cover every Prism token in both the light and dark themes.
- **Lint** — Resolve all lint errors by root cause and mute advisory-only rules.
- **Docs** — Refresh the README tool list and entry points; add a File block tool reference entry.

## [0.15.1](https://github.com/JackUait/blok/compare/v0.15.0...v0.15.1) (2026-06-13)

### Bug Fixes

- **Types** — Declare `Embed` and `Bookmark` (and their `defaultBlockTools` entries) in the published `@jackuait/blok/tools` types. The runtime exported them in 0.15.0 but the `.d.ts` did not, so `import { Embed, Bookmark }` failed to typecheck.

## [0.15.0](https://github.com/JackUait/blok/compare/v0.14.1...v0.15.0) (2026-06-12)

### Features

- **Link Paste** — Pasting a URL now offers a Notion-style menu to keep it as a link, or convert it into a Bookmark card or rich Embed block. The pasted link shows immediately with the menu anchored at its end, and menu labels name the detected link type via provider metadata.
- **Embed** — Worldwide embed registry covering ~115 services across video, audio, social, documents, design and developer domains, including Google published docs/forms and draw.io. Per-source minimum resize widths keep each provider's iframe legible, and fixed-width providers hug their content with figure, handles and toolbar.
- **Bookmark** — Notion-parity bookmark card with a dev unfurl endpoint; crawler-UA retry recovers metadata from bot-blocked sites.
- **Playground** — Smooth cross-fade theme switching via View Transitions, plus an Airbnb-style neutral redesign.

### Bug Fixes

- **Embed** — Preserve the live iframe across every editor action: caption and alignment toggles now apply in place instead of reloading the player. Selection highlight hugs the figure dimensions.
- **Drag & Drop** — FLIP-animate the column drop moment and slim the vertical drop bar to read like the horizontal line.
- **Security** — Harden URL-scheme filtering and neutralize XSS gaps in markdown paste, the inline link tool, and the paste/render pipeline.
- **Tools** — Implement `setReadOnly` on embed, bookmark and column tools so read-only toggles in place without a full re-render.
- **Icons** — Unify the icon set on the 20×20 / 1.25 house spec; refine heading family, quote, caption, pencil, cells, toggles, and numbered-list glyphs.
- **CI** — Pin Node 24.14.1 to dodge a Playwright install hang; share Playwright setup to stop Storybook browser install hanging; repair 6 failing CI specs (5 stale expectations, 1 real drop-indicator regression).

### Maintenance

- **Dependencies** — Resolve all 52 open Dependabot alerts; bump brace-expansion, ws, smol-toml.
- **Tests** — Embed/bookmark/link stories with screenshot baselines, wave-2 embed visual-regression baselines, verified real sample URLs replacing fixtures, refreshed `main.css` golden snapshot.
- **Docs & Playground** — Embed, bookmark and link entries in tools data and the editor demo.

## [0.14.1](https://github.com/JackUait/blok/compare/v0.14.0...v0.14.1) (2026-06-08)

### Features

- **Tools** — Register the Columns tool with a single `Columns` group key. Tool-group "provides" manifests expand into their underlying block tools during `prepare()`, so consumers add one key instead of wiring each block.

### Bug Fixes

- **Tools** — Export `Columns` from public types for single-key registration; keep `defaultBlockTools` settings-only so the group key forwards settings without re-registering.

## [0.14.0](https://github.com/JackUait/blok/compare/v0.13.2...v0.14.0) (2026-06-05)

### Features

- **Columns** — New side-by-side layout tool (#67). Create 2–5 column presets from the toolbox, or drag a block beside another to spawn a column. Drop anywhere left/right of a block to make a new column, or into a column body to stack inside it. Columns nest, auto-unwrap when emptied, and stack vertically on narrow viewports.
- **Columns** — "Turn into columns" command wraps a multi-block selection into a column layout, available from the Convert-to menu.
- **Columns** — Hover-revealed resize separators between columns: drag to resize, keyboard-resizable with ARIA slider semantics, double-click a divider to equalize widths.
- **Columns** — Horizontal arrow keys traverse between sibling columns; new columns animate in Notion-style.
- **Inline Toolbar** — Appears instantly on selection release, no animation delay.

### Bug Fixes

- **Inline Toolbar** — Removed entry animation that delayed appearance.

### Maintenance

- **i18n** — Column resize aria-labels and turn-into-columns strings across all locales.
- **CI** — Repair unit tests, e2e merge, and mirror push on master; mirror push works for both branch and tag events.
- **Tests** — Exhaustive block-in-column compatibility suite, live-drag lifecycle specs for every block type, multi-select block-settings header i18n regression.
- **Playground** — Columns example in the editor demo and block-states gallery.

## [0.13.2](https://github.com/JackUait/blok/compare/v0.13.1...v0.13.2) (2026-05-30)

### Bug Fixes

- **Read-Only** — Collapse the empty bottom click-to-add zone to 0px in read-only mode and restore the configured min-height when editing

## [0.13.1](https://github.com/JackUait/blok/compare/v0.13.0...v0.13.1) (2026-05-29)

### Features

- **Image** — Auto-retry failed image loads with loading overlay; distinguish upload-failed vs broken-image error states; predict loading-placeholder dimensions from URL, SVG, and cache; pipe upload progress to bar (#41)
- **Codemod** — Default migrated images to `size: 'full'` and inherit the stretched flag into migrated image size
- **Block Link** — Highlight pulse on hash-link arrival
- **Read-Only** — Show copy-link menu on block hover
- **Playground** — Add loading image state demo in block-states gallery

### Bug Fixes

- **Image** — Force full width and compact overlay for short images; reuse looping-arrows glyph for replace icon
- **Paste** — Keep Google Docs images inside tables and stop double-bolding headings; prevent default page background collapsing to gray preset
- **Table** — Recover migrated cell text detached by a pre-fix save
- **Toolbar** — Align plus/drag handle with content lane for stretched blocks
- **Block Settings** — Anchor popover to trigger instead of (0,0); translate popover context label
- **Database** — Center block toolbar on the title line

### Maintenance

- **i18n** — Translate strings identical to English across 25 locales
- **Lint** — Resolve all ESLint and tsc problems
- **Image** — Move inline upload-failed SVG to icons module
- **Tests** — Cover migrated cell content surviving load→save round-trip; fix CSS guard test failures from image loading shimmer

## [0.12.0](https://github.com/JackUait/blok/compare/v0.11.1...v0.12.0) (2026-04-22)

### Features

- **Image** — New image block tool (#66): drag-drop/URL/file upload, captions, alt text via inline popover, resize handles with symmetric growth, edge-pinned aspect-ratio resize, crop editor (rect/circle/oval) in modal, fullscreen lightbox with wheel/pinch zoom, drag-to-pan, rubber-band, alignment popover (left/center/right), block settings entries (size/download/copy-url), three-dots overflow menu for narrow images, empty/uploading/error states with unified card design, light-theme crop editor, legacy editor.js shape migration
- **Code** — Migrate from Shiki to Prism.js for syntax highlighting with lazy grammar loading and class-based applier; add auto-indent and bracket expansion on Enter; add Mermaid highlighting with One Dark/Light palette; gutter line-number click focuses the line
- **Fonts** — Bundle @fontsource fonts via generator script; new `fontFamilySans/Serif/Mono/Handwriting` config fields with CSS variable injection; `font-display: swap` for body text
- **Popover** — Render above all elements via CSS Top Layer; nested-submenu viewport clamping on both axes; close transition via ghost clone; tighter item sizing; end-of-list padding hidden on empty search; simpler animations
- **Toolbar** — Hide plus and dots buttons while toolbox is open; place block settings popover left of the dots button
- **Toolbox** — Nowrap pill with tighter radius and unified plus/slash search styling
- **Playground** — Icon gallery lightbox; block states gallery tab; settings panel shortcuts; hide header on scroll; logotype image example
- **CSS Variables** — Tokenize radii, spacing, icon sizes, border widths, z-index ladder, duration/easing, typography; extract direct `rgba` literals to palette tokens; migrate `@apply` arbitrary hex values; split `actions-icon`/`divider` vars; add audit test and visual regression baselines
- **Database** — Match Notion card shadow and radius on kanban cards; showcase all 10 column color variants
- **Block Settings** — Add shortcut keys to i18n with regression tests
- **Icons** — Migrate inline SVGs to shared icon layer

### Bug Fixes

- **Inline Toolbar** — Tighten item padding and radius; suppress toolbar inside code blocks; apply symmetric top/bottom padding
- **Code** — Pin caret color so it does not inherit Prism token colors; restore trailing `<br>` after highlight so Enter works once; refresh gutter/highlight after native paste; focus line end when clicking empty strip of short lines; scope inline-code styling to not leak into code block; support `contenteditable="plaintext-only"` and preserve view mode on undo; correct syntax highlighting offset calculation
- **Toolbar** — Reposition + / ⋮⋮ live while hovered block resizes; disable pointer-events on every actions descendant for left-edge blocks; keep slash search in inserted block after plus button
- **Popover** — Distinguish synthesized hover from real hover; hide context label while searching; keep block settings menu visible and attached to dots trigger
- **Block Manager** — Skip cross-container auto-heal inside move group
- **Tooltip** — Anchor wrapper with `position: fixed` to survive page scroll; render above popover and survive UA stylesheet
- **Fonts** — Add error handling for font load failures

### Maintenance

- **Styles** — Split `main.css` into 11 concern-files
- **License** — Add fork attribution and NOTICE file
- **Build** — Replace shiki with prismjs
- **Tests** — Fix 60+ unit + E2E failures across the suite; add Prism integration test for all highlightable languages
- **Chore** — Untrack `.vscode`; remove stale root files; add favicon to dev playground; drop `.editorconfig`

## [0.11.1](https://github.com/JackUait/blok/compare/v0.11.0...v0.11.1) (2026-04-16)

### Features

- **Bundles** — Ship CJS (`require()`) and IIFE (`<script>` tag / CDN) bundles alongside ESM; add `"main"`, `"browser"`, `"unpkg"`, and `"jsdelivr"` fields to `package.json`

### Maintenance

- **README** — Add installation section documenting ESM, CJS, and CDN usage

## [0.10.9](https://github.com/JackUait/blok/compare/v0.10.8...v0.10.9) (2026-04-14)

### Features

- **Toggle** — Gray arrow icon when toggle body is empty

### Bug Fixes

- **Drag** — Eliminate "wrong block dropped" with multi-layer stale-block defense; block paste, undo/redo, and move shortcuts during active drag; integrate drag-reparent with undo as a single step
- **Hierarchy** — Reject dangling parentId at universal chokepoint; reconcile remote Yjs reparents; close remaining container drift vectors; exempt Yjs remote sync from dangling parent throw
- **Paste** — Inherit container parent on replace-insert and x-blok root paste; harden container paste ejection across all container block types
- **Callout** — Restore plus button and drag handle; stop paste from ejecting children via stale contentIds; prevent Enter from inserting new block inside callout
- **Undo** — Collapse multi-block paste and alt-drag duplicate into one undo group; eliminate spurious entries from metadata-only writes
- **Toolbar** — Keep drag handle visible when editing inside table cell
- **Insert** — Universally protect all Enter paths from nested-block leak
- **Table** — Tighten list item spacing inside table cells
- **Yjs** — Map 'no-capture' origin to local to prevent mid-op sync clobbering tool state

### Maintenance

- **Yjs** — Make `DocumentStore.ydoc` private; enforce local origin whitelist with exhaustive mapper
- **CI** — Shard E2E tests via reusable workflow; add merge-reports job; run spec-file coverage validator on every PR; remove size-limit bundle size check

## [0.10.8](https://github.com/JackUait/blok/compare/v0.10.7...v0.10.8) (2026-04-13)

### Bug Fixes

- **Table** — Normalize flat-array table child parents at every entry point
- **Data Model** — Recursively expand legacy nested toggleList/callout bodies

## [0.10.7](https://github.com/JackUait/blok/compare/v0.10.6...v0.10.7) (2026-04-13)

### Bug Fixes

- **Theme** — Prevent nested editor instances from overriding parent theme on prepare

## [0.10.6](https://github.com/JackUait/blok/compare/v0.10.5...v0.10.6) (2026-04-12)

### Features

- **Config** — Replace `user.name` with `user.id` + `resolveUser` callback for multi-editor identity tracking
- **Keyboard** — Del shortcut for block delete; markdown shortcuts for quote (`"` + space) and code (`` ``` `` + space) blocks

### Bug Fixes

- **i18n** — Use Blok locale for date formatting with full month names; strip trailing abbreviation suffixes for ru/uk locales
- **Popover** — Display scroll haze instantly on open instead of fading in

### Maintenance

- **Deps** — Add lodash-es resolution to pin ^4.18.0

## [0.10.5](https://github.com/JackUait/blok/compare/v0.10.4...v0.10.5) (2026-04-11)

### Features

- **Database** — DatabaseView rendering layer with kanban board DOM

### Bug Fixes

- **i18n** — Localize hardcoded "Last edited" strings in block settings footer; add missing translations across 67 locales
- **Theme** — Expose theme API before `isReady` to prevent dark theme race condition

### Maintenance

- **Lint** — Resolve all 226 lint issues across source and test files
- **CI** — Enable Corepack before setup-node to resolve Yarn version mismatch; remove dead version-check job
- **Tests** — Resolve 119 failing tests across E2E, unit, and docs suites

## [0.10.4](https://github.com/JackUait/blok/compare/v0.10.3...v0.10.4) (2026-04-11)

### Features

- **Database** — Kanban board view with drag-and-drop cards and columns, card drawer with nested editor, inline title editing, list view with collapsible sections, multi-view tabs with drag reorder, property-based data model, column controls, backend sync, and read-only mode ([#60](https://github.com/JackUait/blok/pull/60))
- **Copy block link** — `CopyLinkTune` block tune with Cmd+Ctrl+L shortcut and automatic scroll-to-block on URL hash load ([#64](https://github.com/JackUait/blok/pull/64))
- **Block edit metadata** — Track `lastEditedAt`/`lastEditedBy` on every block mutation with Yjs sync, saved output inclusion, and block settings footer display; new `user` config option
- **Popover** — Scroll haze indicators on popover lists
- **Shortcut keys** — Render shortcut keys as SVG icons with readable tooltip on hover

### Bug Fixes

- **Inline tools** — Preserve trailing nbsp through format/unformat cycles; preserve trailing spaces when applying inline formatting; extend trailing-whitespace range detection; unwrap whitespace-only bold ancestors when un-bolding partial selection
- **Block** — Default `lastEditedAt` to `Date.now()` so footer always shows; preserve user-provided block IDs and deduplicate on render; validate block ID format in constructor
- **Paste** — Prevent new table block when pasting into table cell with lost focus; handle hsl/hsla color formats
- **Scroll to block** — Guard `decodeURIComponent` against malformed URL hash; encode block ID in URL hash
- **Theme** — Prevent nested editor from resetting parent theme

## [0.10.3](https://github.com/JackUait/blok/compare/v0.10.2...v0.10.3) (2026-04-09)

### Bug Fixes

- **Table** — Guard `addBlockToCell` and `setCellBlocks` against writing into covered (merged) cells; resolve paste target and copy source coordinates from model attributes instead of DOM visual position; fix overlay/pill missing and wrong merge/split button after rect expansion; expand selection rect to include full spans of merged cells; use logical cell coordinates in `getCellPosition`; don't intercept copy/cut when user has text selected in a single cell; `reindexCoordinates` assigns model coordinates instead of DOM physical indices; center row grip on merged cell using `getBoundingClientRect`
- **Toolbar** — Correct `marginLeft` for nested blocks and popover position when scrolled; restore focus to originally-typed block after plus+Escape
- **Toolbox** — Position popover at caret when inside nested blocks (toggle/callout)
- **Keyboard** — Prevent text-jumping by preserving focus on toolbar interactions

## [0.10.0](https://github.com/JackUait/blok/compare/v0.5.0...v0.10.0) (2026-04-08)

### Features

- **Code block** — New `CodeTool` with syntax highlighting (via Shiki), line numbers toggle, language selector popover, copy button, wrap toggle, and preview tab for KaTeX/Mermaid rendering ([#61](https://github.com/JackUait/blok/pull/61))
- **Inline code** — New `InlineCodeTool` with CMD+E shortcut
- **Quote block** — Notion-style quote block with size options submenu
- **Divider block** — Horizontal rule block with `---` markdown shortcut
- **Callout block** — Callout block with emoji picker and skin tone persistence ([#59](https://github.com/JackUait/blok/pull/59))
- **Toggle list** — Collapsible toggle list block with drag & drop support inside toggles ([#46](https://github.com/JackUait/blok/pull/46), [#52](https://github.com/JackUait/blok/pull/52))
- **Toggle headings** — Toggle heading blocks with markdown shortcuts (`>#`, `>##`, `>###`) and body placeholder
- **Marker inline tool** — Color text/background inline tool with color picker and dark mode support
- **Underline & Strikethrough** — New inline tools with CMD+U and CMD+SHIFT+S shortcuts
- **Table enhancements** — Cell color picker, cell placement picker, HTML `<table>` rendering, corner drag, Tab/Arrow escape from cells, and cross-table block protection ([#38](https://github.com/JackUait/blok/pull/38), [#45](https://github.com/JackUait/blok/pull/45), [#63](https://github.com/JackUait/blok/pull/63))
- **Markdown import** — `importMarkdown()` API method and paste handler with GFM support including math (KaTeX) extensions
- **React adapter** — `useBlok` hook and `BlokContent` component for React integration ([#55](https://github.com/JackUait/blok/pull/55))
- **Read-only toggle** — Seamless in-place `readonly` mode toggle with scroll position preservation ([#62](https://github.com/JackUait/blok/pull/62))
- **Editor width API** — `editor.width` namespace with `WidthManager` module and `config.width` options
- **Content alignment** — `config.style.contentAlign` option for global block content alignment
- **Font family config** — `config.style.fontFamily` option for editor and popover typography
- **Theme API** — `ThemeAPI` module for programmatic dark/light theme control
- **Fuzzy toolbox search** — Ranked fuzzy search in slash menu with animated filtering ([#51](https://github.com/JackUait/blok/pull/51))
- **Toolbox plus button** — Opens blocks menu directly without inserting `/`
- **Link suggestion chip** — URL type detection chip in inline toolbar
- **Google Docs paste** — Expand `<details>` tags into toggle blocks with parent-child wiring
- **blok-cli package** — New `@jackuait/blok-cli` package with `convert` (HTML→JSON) and `convert-gdocs` commands
- **i18n search terms** — Multilingual toolbox search via `searchTermKeys` across all 68 locales

### Bug Fixes

- **Drag & drop** — Toggle hierarchy, ghost preview, subtree depth preservation, and spring-load auto-expand for closed toggles
- **Toolbar** — Drag handle reachability, left-edge overflow, and actions not intercepting toggle arrow clicks
- **Inline toolbar** — Cross-block selection positioning, background element cleanup on close
- **Table** — Cross-table block stealing, undo/redo focus, cell selection border persistence, and arrow key navigation between blocks
- **Marker** — Partial selection color removal, dark theme palette, and active color display on toolbar button
- **Toggle** — Backspace/Delete boundary crossing, undo atomicity for Enter, children DOM nesting, and collapse in read-only mode
- **List** — Tab indent for multi-selected items, depth reduction cascade on outdent, and bullet marker pinning
- **Paste** — Table cell content appearing outside table, marker formatting preservation, and math formula detection

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1-beta.5...v0.5.0) (2026-01-23)

### Features

- **CRDT-based undo/redo** — The undo/redo system now uses Conflict-Free Replicated Data Type principles for better conflict resolution and history tracking ([#33](https://github.com/JackUait/blok/pull/33)) ([98477264](https://github.com/JackUait/blok/commit/984772642af711dcbe23d06f14ed77c003012ecc))

### Bug Fixes

- **toolbar hover behavior after cross-block selection** — The inline toolbar now resets its positioning state when extending selections across multiple blocks ([#35](https://github.com/JackUait/blok/pull/35)) ([122a50fc](https://github.com/JackUait/blok/commit/122a50fcdabee2e7003c8f464701ecc35e4fc9af))
- **PatternPasteEvent for internal cut/paste** — Internal cut and paste operations now emit PatternPasteEvent, so external code can react to all clipboard actions ([d98fd369](https://github.com/JackUait/blok/commit/d98fd36951cd5824d728ddb006572d071f6e8650))

## [0.4.1-beta.5](https://github.com/JackUait/blok/compare/v0.4.1-beta.4...v0.4.1-beta.5) (2025-12-07)

### Bug Fixes

- **Tailwind CSS conflicts** — Fixed CSS conflicts that caused external plugins to break by isolating Tailwind's style precedence ([ee68032](https://github.com/JackUait/blok/commit/ee68032720482dbfba6cf9d3cf3602a6df755226))

### Features

- **data-blok-header-level attribute** — Headers in the formatting popover now include a `data-blok-header-level` attribute for styling and testing hooks ([d27a758](https://github.com/JackUait/blok/commit/d27a7587803342279a10cbd7fdd317c984119fcd))

## [0.4.1-beta.4](https://github.com/JackUait/blok/compare/v0.4.1-beta.3...v0.4.1-beta.4) (2025-12-07)

### Refactoring

- **revert React migration** — Rolled back the internal React migration to maintain vanilla JavaScript architecture ([#16](https://github.com/JackUait/blok/pull/16)) ([558e620](https://github.com/JackUait/blok/commit/558e6201e1bd2fff6c333827be5cf149551fed3b))

## [0.4.1-beta.3](https://github.com/JackUait/blok/compare/v0.4.1-beta.2...v0.4.1-beta.3) (2025-12-06)

### Features

- **undo/redo** — Added keyboard shortcuts (Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z) for editing history navigation ([#15](https://github.com/JackUait/blok/pull/15)) ([207a4c1](https://github.com/JackUait/blok/commit/207a4c1fd3d5b65fb97c07e41b0e8933c60ee9ce))

## [0.4.1-beta.2](https://github.com/JackUait/blok/compare/v0.4.1-beta.1...v0.4.1-beta.2) (2025-12-05)

### Refactoring

- **migrate internals to React** — Changed the internal component architecture to React (later rolled back in beta.4) ([#14](https://github.com/JackUait/blok/pull/14)) ([ea36157](https://github.com/JackUait/blok/commit/ea3615702597d971171e377e938ee549185b220c))

## [0.4.1-beta.0](https://github.com/JackUait/blok/compare/v0.3.1-beta.0...v0.4.1-beta.0) (2025-12-16)

### Features

- **RTL language support** — Added translations for Hebrew, Persian, Urdu, Yiddish, Pashto, Sindhi, Uyghur, Kurdish, and Dhivehi with right-to-left layout ([28191fd](https://github.com/JackUait/blok/commit/28191fd786d9e3ea2fffa4bd32cf99018b60e0cd))
- **Eastern European languages** — Added Czech, Romanian, and Hungarian translations ([8be8c17](https://github.com/JackUait/blok/commit/8be8c177a174606fb6821f7877180fe2439b13b0))
- **Southeast Asian languages** — Added Thai, Ukrainian, and Greek translations ([24584fe](https://github.com/JackUait/blok/commit/24584feae996f743824686c76cd8dcf376eadbbe))
- **South Asian languages** — Added Hindi, Bengali, Indonesian, and Vietnamese translations ([e696674](https://github.com/JackUait/blok/commit/e6966745b799ca3d0d71b4c6e2594b0f983a226c))
- **Turkic languages** — Added Turkish and Azerbaijani translations ([ce381f6](https://github.com/JackUait/blok/commit/ce381f615c74b989b86866a3f4a21d56b241bb1f))
- **Arabic** — Added Arabic translation with RTL support ([c2bd2c4](https://github.com/JackUait/blok/commit/c2bd2c4b358dfc8d21b5b2085341a8a1e7d90e94))
- **Northern European languages** — Added Dutch, Polish, and Swedish translations ([5a7898e](https://github.com/JackUait/blok/commit/5a7898eec0ff19bc37176e0267611a0ae0cf82ec))
- **Korean, Japanese, Italian, Portuguese, German, French, Spanish** — Added translations ([fb0f0d5](https://github.com/JackUait/blok/commit/fb0f0d5b542437e2d21ebe95f866ddad57858f60) [f71fa79](https://github.com/JackUait/blok/commit/f71fa79eb85e260acae624c89f4faa389be92b86) [f74790e](https://github.com/JackUait/blok/commit/f74790e4d40ab04f591084e7b39116e2e73ad92a) [94f5bde](https://github.com/JackUait/blok/commit/94f5bde875875ec416c34a7e5915118cb1208baf) [1f48c73](https://github.com/JackUait/blok/commit/1f48c73f7482e72e551347cb2220d89825829693) [8d954f5](https://github.com/JackUait/blok/commit/8d954f51ebd2c298f4f8914efca65480e0833290) [f06f55b](https://github.com/JackUait/blok/commit/f06f55b2f247d2067525a09b696b55efcdb18a29))
- **Armenian, Chinese, Russian** — Added translations ([a891b61](https://github.com/JackUait/blok/commit/a891b6124657ad645d900e6048e52b8a5ea9fd42) [173f44b](https://github.com/JackUait/blok/commit/173f44bb06feba5db15f139a0b8e3600ecff481a) [fc19d28](https://github.com/JackUait/blok/commit/fc19d288fc4f70b90319f809700eca3a27c21bfc))
- **rename checklist to to-do list** — Changed terminology from "checklist" to "to-do list" ([931e53c](https://github.com/JackUait/blok/commit/931e53c0f7273f397a22c03ef2f4da4b83bf80c1))
- **drag & drop** — Rewrote the drag and drop system for smoother interactions ([#26](https://github.com/JackUait/blok/pull/26)) ([b5e48e1](https://github.com/JackUait/blok/commit/b5e48e199cb848df040b8f27f62091b3fe9edea6))
- **flat data model** — Changed from nested to flat structure using `parentId` and `contentIds` references ([#24](https://github.com/JackUait/blok/pull/24)) ([931e678](https://github.com/JackUait/blok/commit/931e678bde948b453a784e788641d80298633826))
- **lists: flat data model** — List items now use the flat data structure ([#25](https://github.com/JackUait/blok/pull/25)) ([4a259b4](https://github.com/JackUait/blok/commit/4a259b46e0f958a7975b5e2b43a97b5f752660e2))
- **keyboard navigation** — Added keyboard shortcuts for editing without the mouse ([#22](https://github.com/JackUait/blok/pull/22)) ([a01e2ba](https://github.com/JackUait/blok/commit/a01e2ba1b2aab46ec42b69e1ebc465e588569626))
- **list tools** — Added numbered lists, ordered (nested) lists, and to-do lists with checkboxes ([#21](https://github.com/JackUait/blok/pull/21)) ([6625fe5](https://github.com/JackUait/blok/commit/6625fe536086e8e0249d7b151c6d65c08d55c64a))
- **paragraph tool: custom configuration** — The paragraph tool supports custom configuration for placeholder text and styling ([#20](https://github.com/JackUait/blok/pull/20)) ([30b3a05](https://github.com/JackUait/blok/commit/30b3a056dc73eb921f1dc3ad583bbef0f0c82878))
- **header tool: custom configuration** — The header tool supports custom configuration for levels and placeholder text ([#19](https://github.com/JackUait/blok/pull/19)) ([74a8f72](https://github.com/JackUait/blok/commit/74a8f72b2b21bd8f0b27ecf56c90c9c206771837))
- **navigation mode** — Added arrow key navigation through blocks, separate from text editing ([#18](https://github.com/JackUait/blok/pull/18)) ([0c7dd77](https://github.com/JackUait/blok/commit/0c7dd772343f4ec7ac22df4e62a9bc068d5bda2c))
- **UX improvements** — Focus management, cursor positioning, and block interactions ([#17](https://github.com/JackUait/blok/pull/17)) ([8a37c4d](https://github.com/JackUait/blok/commit/8a37c4dd7a2ddd418e640e2bd4777e6282b3be13))

### Bug Fixes

- **translation keys: camelCase** — Converted all translation keys to camelCase ([f8858ea](https://github.com/JackUait/blok/commit/f8858eaea9dfbf370891f65f63947327a5d8fc4e))
- **translation key parsing** — Fixed nested translation key parsing ([ed114f8](https://github.com/JackUait/blok/commit/ed114f817bf9609c8fe0fa312ba80154ad758118))
- **remove redundant translation keys** — Cleaned up duplicate and unused translation keys ([142252c](https://github.com/JackUait/blok/commit/142252c0512fd4209c2e641ebe1217902191f5cb))
- **fix Russian translation** — Corrected a missing word in the Russian translation ([4c7eb8b](https://github.com/JackUait/blok/commit/4c7eb8b1e43c3dfd20062aa78e2d61c91eb41e0f))
- **fake selection display** — Fixed how fake (visual-only) selections render ([#23](https://github.com/JackUait/blok/pull/23)) ([b303aea](https://github.com/JackUait/blok/commit/b303aea0727faaddc9d3c28a8bb145f0889bed73))
- **close inline toolbar on outside click** — The inline toolbar now closes when clicking outside the editor ([0117d14](https://github.com/JackUait/blok/commit/0117d1455652a67594f9acaf91ff94223a69d265))
- **toolbar centering** — Fixed toolbar positioning to stay centered regardless of content width ([888bb1f](https://github.com/JackUait/blok/commit/888bb1f378dc90e5aecb817439dc82120d029f77))

## [0.4.1](https://github.com/JackUait/blok/compare/v0.3.1-beta.0...v0.4.1) (2025-12-16)

> This release is identical to 0.4.1-beta.0, promoted to stable status after thorough testing.

## [0.3.1-beta.0](https://github.com/JackUait/blok/compare/v0.3.0...v0.3.1-beta.0) (2025-12-03)

### Chores

- **codemod improvements** — Better pattern matching and safer transformations for the Editor.js migration ([#13](https://github.com/JackUait/blok/pull/13)) ([3514c5b](https://github.com/JackUait/blok/commit/3514c5b34072bdc2788bd934822e1ba9de85f7d4))

## [0.3.0](https://github.com/JackUait/blok/compare/v0.2.0...v0.3.0) (2025-12-02)

### Features

- **bundle paragraph and header tools** — These tools are now included by default in the core bundle ([fbf30d5](https://github.com/JackUait/blok/commit/fbf30d57403d3a3c8c0fea7f8d808327d0fcec91))

## [0.2.0](https://github.com/JackUait/blok/compare/v0.1.5...v0.2.0) (2025-12-02)

### Features

- **drag & drop** — Block reordering via the block handle (☰) icon ([e37fe12](https://github.com/JackUait/blok/commit/e37fe12fbd45ec41cd7b5023cc00f05d84b52c35))

### Bug Fixes

- **remove debug logging** — Cleaned up console.log statements and resolved performance bottlenecks ([e1bd5a17](https://github.com/JackUait/blok/commit/e1bd5a17e13a95ed880ca8f51d581e0b0cfe5d70))

### Styling

- **rebrand to Blok** — Updated logos, color schemes, and documentation ([#6](https://github.com/JackUait/blok/pull/6)) ([28a253dc](https://github.com/JackUait/blok/commit/28a253dc6524f74e8855688efcf3c93d9d3d0587))

## [0.1.5](https://github.com/JackUait/blok/compare/v0.1.4...v0.1.5) (2025-11-24)

### Refactoring

- **ESLint configuration** — Fixed ESLint setup ([9f3accba](https://github.com/JackUait/blok/commit/9f3accba9b18a4ff1983a75a423e632b33b8d4ec))

## [0.1.0](https://github.com/JackUait/blok/releases/tag/v0.1.0) (2025-11-24)

### Initial Release

- **fork from Editor.js** — Blok forked from Editor.js, preserving the block-based editing architecture
- **initial feature set** — Block management, inline formatting, slash toolbox, and plugin system
