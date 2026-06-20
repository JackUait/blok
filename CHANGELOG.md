# Changelog

All notable changes to this project will be documented in this file.

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
