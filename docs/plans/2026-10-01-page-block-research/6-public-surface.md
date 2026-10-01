# 6 — Public surface for a Notion-style PAGE block

Read-only audit of `/Users/jackuait/Packages/blok` on 2026-10-01 (HEAD `7cb1af87`, last tag `v1.15.2`).
Every claim cites a file:line read in this session. Items not checked are labelled **UNVERIFIED**.

---

## 0. The design fork to decide first

There are two storage models. They lead to different public contracts. This report does not decide between them silently.

**A. Single tree.** The sub-page's body is the page block's children, in the parent document's `OutputData`, linked with `parent`/`content` (`types/data-formats/output-data.d.ts:78,86`). This is CLAUDE.md law #3 ("a page is a block with children") taken literally.

What exists today for this model:
- No editor can be scoped to a subtree. No public type has a `rootId`/scope option (grep of `types/configs/blok-config.d.ts`, `types/api/*.d.ts`, `types/index.d.ts` found none).
- `blocks.render(data)` replaces the whole document (`types/api/blocks.d.ts:124`).
- `saver.save()` returns the whole document (`types/api/saver.d.ts:12`).
- `persistence` loads and saves one document (`types/configs/blok-config.d.ts:708-718`).
- So a "full page" mode needs new core APIs: render or mount a subtree as the editing root, save it back, keep the rest of the tree intact.
- Every whole-document walker includes the sub-page body (see §5). The workspace grows into one big `OutputData`.

**B. Per-page documents.** Each page is its own `OutputData`, loaded by the host (`load(pageId)`). The page block in the parent holds only a reference. This fits `persistence` (one document per editor) and matches how Notion stores pages.

The cost: the page block's `content` stays empty in the parent. That needs a written reconciliation with law #3 and #5 ("Page body IS blocks"). One honest reading: the body *is* blocks — in the child document, whose root is the page. The parent holds only the link block.

**Title ownership is the second decision, and it is tied to the first.**
- `OutputData` has no root or "this document is page X" field (`output-data.d.ts:109-124`). So "the page is the root of its own document" has no home in today's schema.
- Under model B, if the parent's page block holds `title`/`icon`, renaming the page from inside its own document leaves the parent's copy stale. Nothing in the current surface syncs it. Options:
  1. The parent's `title`/`icon` is a **cached display value**; `pages.resolve(id)` is authoritative and Blok refreshes the cache. Two values, one owner (host).
  2. The child document holds one top-level `page` block (same id) whose `content` is the body. The same id lives in two documents, and someone (host or Blok) must sync the two `title`s.
  3. **Model A**: the block itself is the page. One `title`, nothing to sync. This is the strongest argument for model A.
- Whatever is chosen decides what `PageData.title` *means*. That meaning is permanent once released.

**Do not copy the database drawer precedent.** It opens a row in a nested `new Blok()` (`src/tools/database/database-card-drawer.ts:601-625`). But it stores the row body as a whole `OutputData` inside a `richText` property: `descriptionProp = schema.find(p => p.type === 'richText')` (`src/tools/database/index.ts:1091`), and writes it with `updateRowBlock(rowId, { [descriptionPropId]: description })` (`index.ts:1155-1157`). The drawer reads it back from `row.properties[descriptionPropertyId] as OutputData` (`database-card-drawer.ts:384-385, 607-609`). That is a document nested inside a block's `data` — it breaks law #5. Only the nested-editor mechanics are a reusable precedent.

**Recommendation (a recommendation, not a finding; revisit with the title question above):** use model B, with option 1 for the title (parent copy is a cache, `pages.resolve` wins) for storage and loading, with the page block as the *root* of its own document, and add a sync seam so a host that wants model A can still inline. Reasons: no subtree editor exists, `persistence`/`collaboration` are one document each, and §5 shows whole-document walkers would leak sub-page bodies. Whether core would mount a page block's children inline in the editor DOM is a core question — **UNVERIFIED here**, deferred to the core report.

---

## 1. Config surface

### Where it is typed
- `types/configs/blok-config.d.ts` (1345 lines). `BlokConfig = BlokMountOptions & BlokState` (doc at `:502`).
- `BlokState` (`:294`) holds LIVE keys. Each must have a runtime setter. `test/unit/architecture/reactive-config-contract-law.test.ts` enforces this. It also fingerprints every adapter, including Angular at `:102`.
- `BlokMountOptions` (`:504`) holds keys fixed at construction.

### How tools are configured
- `tools?: { [toolName]: ToolConstructable | ToolSettings }` (`:605`).
- Tool-level host hooks live in the tool's `config`. Examples:
  - `DatabaseConfig { adapter?: DatabaseAdapter }` (`types/tools/database.d.ts:162-164`), a full async CRUD backend (`:96-160`).
  - `CalloutConfig.emojiPicker?: (onSelect) => void` (`types/tools/callout.d.ts:25`), a host-supplied UI opener.

### Host callbacks that exist today
| Callback | Where | Notes |
|---|---|---|
| `onChange(api, event)` | `blok-config.d.ts:384` | BlokState |
| `onSave(data, api)` | `:414` | presence is load-bearing |
| `onEnter(event, api) → boolean\|void` | `:437` | return `true` = handled |
| `onSubmit(data, api)` | `:462` | |
| `onBeforeRender(blocks) → blocks` | `:481` | |
| `onAfterRender(api)` | `:494` | |
| `onBeforePaste(html) → string\|null` | `:572` | |
| `persistence { load(), save(data, ctx), onError? }` | `:708-718` | two functions, not a URL (doc `:653-707`) |
| `uploader?: BlokUploader` | `:720` | editor-level fallback; a tool-level uploader wins (doc `:610-628`) |
| `server?: string` | `:639` | shorthand that fills in `uploader` and the bookmark endpoint |
| `collaboration` | `:782` | cannot be combined with `persistence` |
| `link { target, rel, transformHref, transform, unfurl }` | `:944-1012` | |
| `linkPaste` | `:1016` | |
| `onReady(blok?)` | `:1046` | |
| `onError(error, ctx)` | `:1058` | `BlokErrorContext.source: 'save'` only (`:180-186`), "object so new sources can be added" |
| `onImageFailure(report) → boolean\|void` | `:1070` | return `false` = host takes over the UI |
| `scrollToBlock { topOffset }` | `:1230` | hash → block, always on |
| `resolveUser(id) → UserInfo \| Promise \| null` | `:1287` | sync or async resolver, asked once per id |
| `confirmLeave(): Promise<boolean>` | method, `types/index.d.ts:624` | |

### Is there a navigate/open callback or router integration?
**No.** A grep for `onNavigate|onOpen[A-Z]|openPage|router|onLinkClick` in `types/`, `src/` and the adapter sources found only popover `onNavigateBack` (`types/utils/popover/popover.d.ts:121`) and caret/keyboard internals. No host navigation hook exists.

### How a link click decides same-window vs new tab
- Anchor attributes: `resolveLinkAttributes` (`src/components/utils/resolve-link-attributes.ts:39-68`) sets `target = isSamePageLink(href) ? '_self' : (link.target ?? '_blank')` (`:44`). `transform` may override it (`:47-59`).
- `isSamePageLink` (`src/tools/link/registry.ts:1686-1705`) is true for a bare `#…` or the same `origin + pathname`.
- The editor click path is `UI.redactorClicked` (`src/components/modules/ui.ts:1347`). It swallows the click (`:1394-1396`) and calls `openLink` (`:1444`):
  - unsafe scheme → nothing;
  - same page with a fragment → `BlocksAPI.scrollToBlock(fragment)`;
  - same page with a different query → `openSameWindow` (`:1495`), which is `window.open(url, '_self')` (`src/components/utils/browser.ts:199-207`), a **full reload**;
  - anything else → `openTab(getValidUrl(href))` (`ui.ts:1461`), which is `window.open(url, '_blank')` (`browser.ts:182-189`).
- `openLink(href)` never reads the anchor's `target` (`ui.ts:1444-1461`). So even `link.target: '_self'` does not stop a plain click from opening a new tab.
- The listener is a plain bubble-phase `click` on the redactor (`ui.ts:1109`, no capture flag). So a page tool's OWN click handler on its card runs first and can `preventDefault` + `stopPropagation`; core never sees that click. The core path matters for **inline page mentions and page links inside text**, which no tool owns.
- The listener comment says it is "read-only-insensitive" (`ui.ts:608-613`), so the same path likely runs in read-only mode. **UNVERIFIED** at runtime.
- **Consequence:** an inline `<a href="/pages/123">` in text opens a NEW TAB on a plain click, or does a full reload when only the query differs. Neither goes through the host router. The `link` config cannot express "hand this click to my router". Core needs a host hook for page mentions and links. The page block's card can handle its own click if the tool calls the same hook.

---

## 2. Blocks API (`types/api/blocks.d.ts`)

What exists to read and write a subtree:
- Read: `getById(id)` (`:185`), `getChildren(parentId)` (`:210`), `getBlockIndex` (`:196`), `getBlocksCount` (`:224`). On a block: `BlockAPI.getChildren()` (`types/api/block.d.ts:178`), `setParent` (`:187`), `insertChild` (`:208`), `moveChild` (`:223`).
- Write: `insertAt(type, data, { parentId, position, id, tunes, focus, replace })` (`:269`, options `:47-69`). `moveTo(id, { parentId, position })` moves a block with its whole subtree (`:284`, target `:74-82`). Both throw `BlockPlacementError` (`:40-43`). Also `insertMany` (`:289`), `update` (`:309`), `convert` (`:320`), `insertInsideParent` (`:377`), `setBlockParent` (`:218`).
- Whole document: `render(data)` (`:124`), `clear()` (`:114`), `importMarkdown`/`exportMarkdown` (`:140,152`), `scrollToBlock?(id)` (`:450`).
- Missing for pages: `render`/`save` scoped to a subtree, an "open page" call, an "extract subtree as `OutputData`" call, and a "page changed" event. The public event map holds only `block:rendered`, `blocks:rendered`, `block:childrenMounted`, `i18n:changed` and `collaboration:status` (`types/events/editor-events.ts:251-257`).

What a page block would need, by model:
- Model A: `blocks.getSubtree(id) → OutputData` (or a `saver.save({ root })` option), `blocks.renderSubtree`/a scoped mount, and `pages.open(id)`.
- Model B: only `pages.open(id, opts)` (navigation intent). The host renders a separate editor for the child document.

A new API namespace (e.g. `api.pages`) triggers `test/unit/architecture/blok-class-api-parity-law.test.ts`: every `API` member must also be on the `Blok` class type, by declaration merging. It also becomes reachable from React, Vue and Angular custom blocks at once, because each block receives `api: API` (React `ReactBlockRenderProps.api`, `packages/react/src/createReactBlock.tsx:124`).

---

## 3. Host navigation contract — candidate shapes

Shape precedents found:
- **Editor-level function bag:** `persistence { load, save, onError }` (`blok-config.d.ts:708`); `resolveUser` (sync or async resolver, `:1287`); `onImageFailure` (returning `false` = host takes over, `:1070`).
- **Tool-level adapter:** `DatabaseConfig.adapter` (`types/tools/database.d.ts:96-163`); `CalloutConfig.emojiPicker` (`callout.d.ts:25`).
- **Hybrid:** `uploader`, an editor-level fallback where a tool-level config wins (`blok-config.d.ts:610-620`).

### Candidate 1 — editor-level `pages` (follows `persistence` + `resolveUser` + `onImageFailure`)
```ts
// BlokMountOptions (not BlokState → no runtime-setter law; see below)
pages?: {
  /** Href for a page id. Used for anchors, middle-click, copy-link and the /view renderer. Required: without it no anchor can be built. */
  href(pageId: string): string;
  /** PRESENCE is the signal (like onSave/onSubmit): when set, the host owns every page click and Blok does no navigation of its own. */
  open?(pageId: string, ctx: { mode: 'full' | 'peek'; source: 'block' | 'mention' | 'link'; event?: MouseEvent }): void;
  /** Model B only: load a page's own document (for peek, title lookup or inline preview). */
  load?(pageId: string): Promise<OutputData | PersistedDocument | null>;
  /** Title/icon lookup for mentions of pages outside this document (mirrors resolveUser). */
  resolve?(pageId: string): PageInfo | Promise<PageInfo | null> | null | undefined;
};
/** New published type (mirrors UserInfo, types/configs/user-info.d.ts). */
interface PageInfo { title: string; icon?: PageIcon }
type PageIcon = { type: 'emoji'; value: string } | { type: 'image'; url: string };
```
- Fits because core link clicks (§1) and `/view` (§5) must both navigate. A tool-level config cannot reach `UI.redactorClicked` or `blocksToHtml`.
- Return polarity: the two existing return-valued hooks disagree. `onEnter` returns `true` = handled (`:437`). `onImageFailure` returns `false` = Blok's own UI is suppressed (`:1070`). A boolean `open` would be a third convention, and a host that routes and returns nothing (`void`) would get Blok's default navigation too, so the user navigates twice. So `open` returns `void`, and its **presence** is the signal, as the `onSave` doc (`:403`, "Its PRESENCE is load-bearing") and the `onSubmit` doc (`:453`) already state.
- Laws triggered:
  - Published types: hand-author it in `types/configs/blok-config.d.ts`.
  - React/Vue exhaustive key guards (§4) force adding it to `USE_BLOK_CONFIG_KEYS` and `BLOK_EDITOR_CONFIG_KEYS`.
  - If put in `BlokState`: `reactive-config-contract-law` (runtime setter plus an adapter path in all three adapters). Keeping it in `BlokMountOptions` avoids that, but hosts would have to recreate the editor to change it. The `handlers.set({...})` pattern for `onSave` etc. is the precedent if live updates are wanted.

### Candidate 2 — tool-level `PageConfig` with editor-level fallback (follows `DatabaseConfig.adapter` + the `uploader` hybrid)
```ts
// types/tools/page.d.ts
export interface PageAdapter {
  href(pageId: string): string;
  open?(pageId: string, ctx: { mode: 'full' | 'peek' }): boolean | void;
  load?(pageId: string): Promise<OutputData | null>;
  create?(params: { id: string; parentId: string | null; title: string }): Promise<void>;
  delete?(params: { id: string }): Promise<void>;
}
export interface PageConfig { adapter?: PageAdapter }
```
- Matches the database tool's async CRUD adapter (`database.d.ts:96-160`), including `create`/`delete` for a backend that stores pages separately (model B).
- Weakness: inline page *mentions* and the core link-click path are not owned by the page tool. They would need the editor-level fallback anyway, which is the `uploader` hybrid (`blok-config.d.ts:617-619`).

**Recommendation:** Candidate 1 for navigation (`href`, `open`, `resolve`), because it is a cross-cutting editor concern. Candidate 2's `create`/`delete` belong in `PageConfig.adapter` only if Blok must call the backend when a page block is created or removed (model B). Start with the smallest set: `href` + `open`. Each extra member is a permanent surface.

---

## 4. Adapters

How each forwards config:
- **React.** `UseBlokConfig extends Omit<BlokConfig,'holder'>` (`packages/react/src/types.ts:26`). `USE_BLOK_CONFIG_KEYS` (`packages/react/src/config-keys.ts:11-62`) has a compile-time exhaustive guard (`:68-69`). A new `BlokConfig` key fails `tsc` until it is listed. It then works as a `<BlokEditor pages={…}>` prop.
- **Vue.** `BLOK_EDITOR_CONFIG_KEYS` (`packages/vue/src/config-keys.ts:16`), plus `EmitMappedConfigKey = 'onReady'|'onChange'|'onSave'|'onAfterRender'|'onThemeChange'` (`:70`). Exhaustive guard at `:78`. **Return-valued callbacks must be props, not emits:** `onImageFailure` (returns boolean) is a prop (`packages/vue/src/BlokEditor.ts:78`), and so is `resolveUser` (`:64`). So `pages.href → string`, `pages.open → boolean`, `pages.load → Promise` must be props. An `@open-page` emit cannot return "handled".
- **Angular.** Has 20 discrete `@Input()`s (`packages/angular/src/blok-editor.component.ts:137-243`) plus `@Input() config?: Partial<BlokAngularConfig>` as an escape hatch (`:240`), typed `Omit<BlokConfig,'holder'> & {width}` (`packages/angular/src/types.ts:8`). **No exhaustive guard was found** (no `Exclude<keyof …>` in `packages/angular/src`). A new mount key reaches Angular only through `config`. Nothing forces a discrete `@Input() pages`. Only `BlokState` keys are fingerprinted, by the reactive-config law (`reactive-config-contract-law.test.ts:102`).

Block authoring: each adapter's custom block gets `api` (React `createReactBlock.tsx:103-143`: `data, commit, block, api, readOnly, config, BlockChildren`). An `api.pages.open(id)` would be usable from custom blocks in all three adapters with no adapter change. Vue and Angular block-props parity was **UNVERIFIED** in detail (only the React interface was read).

Read-only rendering: **only React has `BlokView`/`useBlokView`** (`packages/react/src/index.ts:22-24`). A grep for `BlokView|blocksToHtml` in `packages/vue/src` and `packages/angular/src` found nothing. That is an existing parity gap. A page-aware `BlokView` prop would be React-only unless Vue/Angular views are built.

What each adapter would need for pages:
- Minimum: pass `pages` through, which the exhaustive guards force for React and Vue. For Angular, decide whether `pages` gets a discrete `@Input`.
- Optional: React `<BlokView pages={{ href }}>`; a `<BlokPage id>` convenience component that boots an editor on `pages.load(id)` (model B). The latter is a new component in three adapters, so defer it.

Parity and drift guards that apply:
- `packages/react/src/config-keys.ts:68` and `packages/vue/src/config-keys.ts:78` (compile-time).
- `test/unit/architecture/reactive-config-contract-law.test.ts` (only if `BlokState`).
- `blok-class-api-parity-law.test.ts` (new API namespace).
- `useblocks-scope-parity-law.test.ts` and `child-decoration-parity-law.test.ts`: the pattern for "one implementation in shared core, all three adapters wire it". Copy it if pages add adapter code.
- Type checks: `test/unit/types/react-types-typecheck.ts`, `test/unit/vue/types-typecheck.ts`.

---

## 5. View / read-only renderer (`@bloklabs/core/view`)

- `blocksToHtml(data, options)` (`types/view.d.ts:180`). Options include `renderers`, `inlineRenderers`, `onUnknownBlock: 'skip'|'comment'` (default `skip`), `blockIds`, `transformUrl` and `classes` (`:83-168`).
- Custom renderer: `(data, ctx) => string` (`:34`). `ctx = { sanitizeInline, renderBlocks, plainText, renderChildren }` (`:19-28`). **`ctx` carries no block id**, so a `page` renderer cannot build `href(pageId)` from the id. `ViewUrlContext` is `{ attr, blockType? }` (`:61-70`), also with no id. Adding `blockId` to `ViewRenderContext` and/or `ViewUrlContext` is additive.
- Containers: `database` and `database-row` use `childrenOnly`, which renders children bare (`src/view/emitters.ts:151-155, 571-572`). `toggle` wraps its children (`emitters.ts:487-490`).
- **Leak, verified for HTML:** for an unknown tool, "the block is skipped/commented, its children still render" (`src/view/blocks-to-html.ts:379-384`). So a `/view` without a `page` emitter, or a consumer on an older `/view` reading a newer document, **inlines every sub-page body** into the published page (model A only). Other walkers recurse the same way:
  - outline: `model.childrenOf(block.id).forEach(visit)` (`src/view/outline.ts:86-87`), so sub-page headings enter the parent's table of contents;
  - plain text: `model.childrenOf(block.id)` (`src/view/blocks-to-plain-text.ts:245, 371-373`), which affects search and indexing;
  - `extractTexts` iterates every block of the flat array (`src/view/document-texts.ts:127`);
  - markdown export walks `childrenOf` (`src/markdown/blocks-to-markdown-core.ts:398, 533-540`).
- How a page block should render in published output: as a **link card** (icon + title → `<a href>`) and NOT its children. The `page` emitter must ship in the same release as the tool, and the text, outline and markdown walkers need the same "stop at page" rule. With model B there are no children in the parent, so the leak is moot. That is another point for B.
- Same-window navigation in `BlokView`: it maps the view tree to plain React elements (`packages/react/src/BlokView.tsx:39-50` doc). Client-side routing of the `<a>` is the host's job (e.g. delegated click handling). **UNVERIFIED** whether `view-nodes-to-react.ts` offers any element hook for anchors (not read).

---

## 6. Saved data

The shape (`types/data-formats/output-data.d.ts`):
- `OutputBlockData { id?, type, data, tunes?, parent?, content?, indent?, lastEditedAt?, lastEditedBy? }` (`:54-107`).
- Hierarchy is `parent: BlockId` (`:78`) and `content: BlockId[]` (`:86`). In saved data it is NOT `parentId`/`contentIds` (those are the runtime names).
- `OutputData { version?, time?, blocks }` (`:109-124`).
- Input accepts a loose shape where `null` hierarchy refs are dropped (`:138-162`).
- `dataModel: 'legacy'|'hierarchical'|'auto'` (`blok-config.d.ts:522-533`). How a page serializes under `'legacy'` (nested) is **UNVERIFIED**.

What `data` a page tool would hold, with evidence:
- **`title: string` as a top-level data key.** `title` is already in `DIFFABLE_TEXT_KEYS = ['text','code','caption','title','alt','artist']` (`src/components/modules/yjs/serializer.ts:36`). The server mirrors it in lockstep: `DiffableTextKeys` (`packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs:89-97`). So a top-level `title` merges per character with no CRDT or server change. Commit `50c9ab63` did exactly this for `DatabaseRowData.title` (`types/tools/database.d.ts:42-54`) and records that nested keys are atomic leaves.
  - Title as data vs a child block: law #4 says properties are not blocks, and law #5 says the body is blocks. The title is page metadata, like the row title, so it belongs in `data`. A title stored as a first child `header` block would let a user delete or move it, and the parent's link card would have to read a child.
- **Icon:** the precedent is `CalloutData.emoji: string` (`types/tools/callout.d.ts:11`). An icon that may later be an uploaded image argues for `icon?: { type: 'emoji', value } | { type: 'image', url }`. A bare `emoji` string would be BREAKING to widen later.
- **Cover:** the precedent is `AudioData.coverUrl?: string` (`types/tools/audio.d.ts:24`), uploaded through `uploader` with `kind: 'image'` (`blok-config.d.ts:610-614`). Caveat: the `static assetKind` discovery contract assumes the asset is at `data.url` (`types/tools/block-tool.d.ts:288-296`, "stores a host-uploaded asset URL at `data.url`"). A page cover at `coverUrl` is not discoverable as an asset for orphan cleanup. Flag it as a gap.
- **Model B only:** `pageId`/`ref` if the page's document id differs from the block id. Prefer **block id == page id** so `href(pageId)` and "copy link to block" share one id.
- Sanitize: declare `title` PLAINTEXT, as database/database-row do (`static sanitize`, `types/tools/database-row.d.ts:23-26`), unless inline marks are wanted. Changing that later changes the saved format.

What becomes BREAKING if wrong (once released):
- the tool type string (`'page'`);
- every `data` key name and type (`title`, `icon`, `cover…`);
- whether children are stored inline (A) or in another document (B);
- whether `title` holds plain text or HTML;
- id identity (block id == page id).

The `migrations` config (`blok-config.d.ts:536-550`) and `upgradeData` (`types/tools/block-tool.d.ts:335`) can upgrade shapes later. But consumers' backends, `/view` and the C# server would still see the old shape.

Published-types work: add `types/tools/page.d.ts`, export it from `types/tools-entry.d.ts` (like Database, `:84-86, 112`), and add `page: _PageData` to `BlokBlockDataMap` (`:170-191`). Any new `data-blok-*` attribute needs `node scripts/generate-data-attributes-dts.mjs` (CLAUDE.md, Types). No file under `types/` may import from `src/`.

---

## 7. Notion migration and import today

- Lossless clipboard flavour `text/_notion-blocks-v3-production` (`src/components/modules/paste/notion-blocks-v3.ts:1-24`).
- `case 'page'` (`:347-351`): "A `page` block inside content is a SUB-PAGE reference … Emit a bookmark linking to that page". Output: `{ tool: 'bookmark', data: { url: notionPageUrl(id), title } }`. Pinned by `test/unit/components/modules/paste/notion-blocks-v3.test.ts:481-492`.
- Top-level ids with no value in the record-map (linked databases, collection views, link-to-page) become a bookmark too (`:168-176`).
- `link_to_page` and `alias` are dropped (`:366-372`).
- Inline page mentions become `<a href="https://www.notion.so/<id>">title|Untitled</a>` (`:832-837`). URL builder at `:779-781`.
- Oddity: the comment at `:140` says "Structural wrapper (page / tab): drop it", but `page` maps to a bookmark (non-null), so any `content` children of a pasted page would be walked as children of a *bookmark* (`:136, 164`). Whether a sub-page's children ever arrive in the clipboard is **UNVERIFIED** (the code comment at `:349-350` says they do not).
- `src/migrate` has no Notion page handling (grep for `notion|subpage` found nothing there).
- What a page tool changes:
  - `case 'page'` could emit `{ tool: 'page', data: { title } }`, plus a host hook to resolve the Notion id to a local page;
  - mentions could become page mentions;
  - `link_to_page` could become a page link.
  - Changing the bookmark output is a behaviour change, not a type change. Mention it in the release notes.

---

## Recommended public contract (smallest set that is safe to freeze)

1. **Tool `page`** (`types/tools/page.d.ts`):
   ```ts
   interface PageData extends BlockToolData {
     title: string;                                   // top-level, PLAINTEXT, CRDT-mergeable (serializer.ts:36)
     icon?: { type: 'emoji'; value: string } | { type: 'image'; url: string };
     coverUrl?: string;                               // audio precedent
   }
   ```
   Page id == block id. Body = blocks whose root is the page (model B: its own document; model A: `content`). Under model B, `title`/`icon` here are a display cache and `pages.resolve` is authoritative (see §0).
2. **Editor-level `pages`** in `BlokMountOptions`:
   ```ts
   pages?: {
     href(pageId: string): string;
     open?(pageId: string, ctx: { mode: 'full' | 'peek'; source: 'block' | 'mention'; event?: MouseEvent }): void; // presence = host owns navigation
     resolve?(pageId: string): PageInfo | Promise<PageInfo | null> | null | undefined;
   }
   ```
   It is wired into `UI.redactorClicked` so page mentions and links never fall through to `openTab`. The page tool's card calls the same hook from its own click handler. `PageInfo`/`PageIcon` are new published types. Vue gets it as a prop (not an emit). Angular decides on `@Input()` vs `config`.
3. **API:** `api.pages.open(id, opts?)`, merged onto `Blok` (parity law). Defer subtree render/save until model A is chosen.
4. **View:** a built-in `page` emitter (link card, never children), plus `blockId` on `ViewRenderContext`/`ViewUrlContext`, plus a `pages.href` option on `BlocksToHtmlOptions`. Apply the same "stop at page" rule to plain text, outline, `extractTexts` and markdown.
5. **Paste:** Notion `page`/`link_to_page`/mentions map to the page tool only when `pages` is configured. Otherwise keep today's bookmark/link.

## Surfaces that become permanent once released
- The block type string `'page'` and every `PageData` key and its type (`title`, `icon` union, `coverUrl`).
- The storage model (children inline vs per-page document) and id identity (block id == page id).
- The `BlokConfig.pages` key, its member names, `href` being required, the presence-means-ownership rule of `open`, the `ctx` fields (`mode` values, `source` values), and the `PageInfo`/`PageIcon` types.
- What `PageData.title` means (the source of truth vs a cache).
- Any `api.pages.*` method (also on the `Blok` class type).
- Adapter props: React/Vue `pages` prop, any Angular `@Input`, any `<BlokPage>` / `BlokView` page prop.
- View options (`pages.href`, `ViewRenderContext.blockId`) and the emitted HTML of the page link card (consumers style it, e.g. `data-blok-tool="page"`).
- Any new `data-blok-*` attribute or CSS variable for the page card.
- Paste output for Notion sub-pages (behavioural; release-notes item).
