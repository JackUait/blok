# Page title: playground, exports and docs (plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- The playground drops its hand-built title and icon and uses `pageTitle`. It gains icon undo and keeps breadcrumbs, Trash, the page tree, link blocks, cross-tab sync and page morphs.
- Exporters, importers and the server runtime can carry the title when asked.
- The docs describe it all.

**Architecture:**
- **Part A, playground.**
  - `index.html` passes `pageTitle: { holder: '#page-title-slot', onChange, onIconChange }` and `data: { title, icon, blocks }`.
  - `PageRegistry` stays as the mirror that breadcrumbs, the page tree, link blocks and `document.title` read.
  - The open editor's doc is the truth for the open page. The registry follows every change, and a registry change from another tab is pushed into the editor with `record: false`.
- **Part B, exports.** An opt-in `title: true` option on each exporter, importer and text helper (D1, D2, D12).
- **Part C, docs.**

**Overview and decisions:** `2026-10-08-page-title-followups-overview.md` (D1, D2, D3, D8, D9, D11, D12).

**Order:**
- Part A needs plan 1b (Tasks 2, 3) and plan 2 Task 4 (dev seed). Task 6 (collab) also needs plan 2 Tasks 1–3.
- Inside Part A, Task 4 (remote host) must land before Task 5 (deletion): `remote-page-host.ts:4` imports `PAGE_TITLE_SELECTOR` and `replaceTitleText`, which Task 5 deletes.
- Part B needs only plan 1b Task 1.
- Part C goes last.

## Changes from the design spec

- **Holder placement.** The spec said `title: { holder }`; the key is `pageTitle`.
  - `renderPageHeader` empties `#page-header` with `host.replaceChildren(...)` (`src/playground/page-host.ts:934`).
  - Core's header already pads to the gutter and centres on `--blok-content-column` (`src/styles/page-title.css:8-28`). Inside `.pg-page-header` (max-width 720, `playground.css:31-42`) it would be inset twice.
  - So the holder is a new sibling slot in `#editor-col`, between `#page-header` and `#blok` (`index.html:1630-1631`), at full editor width.
- **Seeding without an undo step.** `blok.title.set` used to always record. Plan 1b Task 2 adds `{ record: false }`, which cross-tab sync, the collab seed and the remote-host verdict use.
- **Two things core does differently from the playground:**
  - **Backspace join.** Core turns a header or quote first block into a paragraph first, then joins on the next Backspace (`blockEvents/composers/keyboardNavigation.ts:902-912`). The playground joined at once. Core's rule is kept (D11), and the e2e asserts it.
  - **Icon shape.** The playground stores the icon as an emoji string (`PageRecord.icon`, `page-host.ts:17-28`); core uses `PageIcon`. Convert at the boundary:
    - Going in: `{ type: 'emoji', value }`.
    - Going out: an image icon or `null` becomes `undefined`, never `''`. `setIcon(id, '')` would store `icon: ''`, and `info()` would then emit `{ type: 'emoji', value: '' }` (`page-host.ts:191, 249-258`).

## Global Constraints

- **Hygiene.** The same unit and e2e hygiene as the core plan. E2E uses roles or `data-blok-testid`.
  - The core header hooks are `page-header`, `page-header-title` (`header-dom.ts:20,25`), `page-header-icon` and `page-header-add-icon` (`icon-control.ts:82,111`).
- **Role and label.** The title's role and label are unchanged: role textbox, "Page title" (`en.json:781`). `tools/page-real-host.spec.ts:115,120` should keep passing; run it.
  - `tools/page-host-sync.spec.ts:42-66` (two tabs, `?collab=off`) needs a rename and an Undo in tab A to reach tab B's title. Today the `storage` handler (`index.html:2248-2259`) re-renders the hand-built h1. Task 2 must replace that path, and this spec is the gate.
- **One editor per page.** The playground builds a new editor per page (`swapEditor`: `destroy` then `new Blok`, `index.html:2365-2388`). The slot must exist before `new Blok`, because core resolves the holder in `prepare()`.
- **The callbacks write to the page they were built for.** Use the `pageId` that `buildConfig` already captures (`const pageId = currentPageId`, `index.html:2009`), never `currentPageId`.
  - `goToPage` moves `currentPageId` before the old editor dies (`index.html:2430-2438`). A late `remote`/`undo` change from the old editor would otherwise land on the new page.
- **View transitions.** Morph names come from a stylesheet (`playground.css:200-293`). `blok.destroy()` runs inside the update callback, after the old snapshot (`page-host.ts:1225-1240`, `index.html:2370`). `morphRules` skips a selector that matches zero or several elements (`page-host.ts:1076`).
  - Core's `renderText` replaces only the `h1`'s children, never the `h1` itself.
  - The icon button is replaced when its kind changes add↔icon (`icon-control.ts:134-145`); see D8.
  - Keep the view-transition names `pg-page-title` / `pg-page-icon` and their keyframes in `playground.css`.
- **Exports.** The view stylesheet law (`view-stylesheet-law.test.ts`, 323fe10d) bans `data-blok-page-title` / `data-blok-page-header` hooks in `view.css`. The exported `h1` uses neither attribute.
- **Peer-session hazard.** `src/view/document-schema.ts` and `src/shared/agent/*` may be dirty from another session.
  - Never stage a file you did not change.
  - Check `git diff --cached --name-only` before each commit.
  - Commit with `git commit -- <paths>`.

## Review Focus

1. **Typing in the title updates everything that shows it**: the breadcrumb, sidebar row, link blocks, `document.title` and a second tab's title. The change also survives a reload.
2. **Undo after load does not erase the title.** The seed goes in through `config.data`, which makes no undo step. Cross-tab and collab seeds use `record: false`.
3. **Icon undo.** Add an icon, change it, then Cmd+Z twice: the first icon, then none. Breadcrumb and sidebar follow each step.
4. **Late callbacks from a dying editor never rename the next page.**
5. **The remote host keeps every guarantee `wireTitle` has today**: the save queue, latest-write verdict, pending refresh hold, reject revert and subscribe refresh.
6. **Exports stay byte-identical without `title: true`.** The existing snapshot tests must pass unchanged.

## File Structure

| File | Change |
|---|---|
| `src/playground/page-host.ts` | delete the title/icon code (list in Task 5); keep the registry, breadcrumbs, Trash and morphs |
| `src/playground/page-title-wiring.ts` | new: `pageTitle` config and `data` from the registry, icon mapping both ways |
| `index.html` | slot element, `buildConfig`, storage handler, `slowLoad` loader, delete the old title wiring |
| `src/playground/remote-page-host.ts` | `wireTitle` onto `editor.title` (same guarantees) |
| `src/playground/playground.css` | delete `.pg-page-title` / `.pg-page-icon*` box styles (`:116-181`); keep the view-transition rules (`:200-293`) |
| `docs/maintainers/page-host-integration.md` | sample rewritten (around line 28) |
| `test/unit/playground/page-title-wiring.test.ts` | new |
| `test/unit/playground/page-host.test.ts`, `page-host-notifications.test.ts`, `page-transition.test.ts`, `remote-page-host.test.ts`, `history-drawer.test.ts` | updated; `page-icon-size.test.ts` deleted |
| `test/playwright/tests/tools/playground-page-title.spec.ts` | new e2e |
| `src/view/blocks-to-markdown.ts`, `src/markdown/blocks-to-markdown-core.ts`, `src/view/blocks-to-html.ts`, `src/view/blocks-to-plain-text.ts`, `src/components/modules/api/blocks.ts:469-514` | opt-in title output |
| `src/markdown/mdast-to-blocks.ts`, `src/markdown/index.ts`, `src/view/html-to-blocks.ts` | opt-in title import |
| `src/view/server-runtime.ts` (`readDocument` `:114-124`, ops `:386-421`), `packages/server/dotnet/.../BlokDocumentConverter.cs` (`:49`, `:314`) | carry `title`/`icon` and the option |
| `src/view/document-texts.ts` | opt-in title in `extractTexts`/`injectTexts` |
| `types/view.d.ts`, `types/markdown.d.ts`, `types/data-formats/markdown-import-config.d.ts`, `types/api/blocks.d.ts` | options and result fields |
| `docs/src/components/api/api-data.ts` and the files in Task 11 | docs |

---

## Part A: Playground

### Task 1: Title wiring helper (pure, unit-tested)

**Files:** `src/playground/page-title-wiring.ts`, `test/unit/playground/page-title-wiring.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `toPageIcon('🚀')` gives `{ type: 'emoji', value: '🚀' }`; `toPageIcon('')` and `toPageIcon(undefined)` give `undefined`.
  - `fromPageIcon({ type: 'emoji', value: '🚀' })` gives `'🚀'`; `fromPageIcon({ type: 'image', url })` and `fromPageIcon(null)` give `undefined`.
  - `titleData(read, pageId)` returns `{ title, icon }` from a page reader. Cover two cases: the root (`ROOT_STORAGE_KEY`, `page-host.ts:41`, default `'Blok'`) and a child page.
    - `read` is a function so remote mode can pass the overlay's `pages.get`. `info` is not overridden by the overlay and reads local records that remote mode never writes (`remote-page-host.ts:417-437`).
- [ ] **Step 2: Run** `yarn test test/unit/playground/page-title-wiring.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Pure functions only.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(playground): map page records to the built-in title`.

### Task 2: The playground boots on `pageTitle`

**Files:** `index.html` (slot near `:1630`, `buildConfig` `:1931` with its `pageId` at `:2009`, `slowLoad` loader `:2036`, `storeBlocks` `:2145-2149`, storage handler `:2248-2259`, `swapEditor` `:2365-2388`), `src/playground/playground.css`, `test/playwright/tests/tools/playground-page-title.spec.ts`.

- [ ] **Step 1: Failing e2e.** New spec, local mode, with the same setup as the existing playground specs.
  - The root page shows `page-header-title` with the registry title. Exactly one role-textbox "Page title" exists; this assertion fails while both headers exist.
  - Typing ` Plan` updates the breadcrumb and `document.title`, and a reload keeps it.
  - A child page opened from a link block shows its own title, and the link block's text follows a rename.
  - Rename page A, then navigate to page B at once. B's title and registry record are unchanged (Review Focus 4).
  - `?slowLoad`: the title shows after the delayed load.
- [ ] **Step 2: Run** `yarn e2e test/playwright/tests/tools/playground-page-title.spec.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Add `<div id="page-title-slot"></div>` between `#page-header` and `#blok`.
  - In `buildConfig`, with the captured `pageId`:
    - `pageTitle: { holder: '#page-title-slot', onChange: (t) => { pages.setTitle(pageId, t); renderHeader(); }, onIconChange: (i) => { pages.setIcon(pageId, fromPageIcon(i)); renderHeader(); } }`.
    - `renderHeader()` already calls `updateDocumentTitle`. There is no `refreshCrumbs`.
    - Both callbacks run for every source, `remote` and `undo` included. Boot does not fire them: a local `loadPage` is a silent, non-undo transaction (`yjs/index.ts:253-266`), and `refresh()` fires no callbacks (`pageTitle/index.ts:136-140`).
  - Set `data: { ...titleData(pages.info, pageId), blocks }`.
  - The `?slowLoad` `persistence.load` must return `titleData` too. After a persisted load, core calls `loadPage({ title: data.title })` (`core.ts:529-531`), so a `{ blocks }`-only result clears the title.
  - `storeBlocks` keeps storing `.blocks` only. The registry stays the local title store, and records already hold `title`, so no migration is needed.
  - **Storage handler (cross-tab).** When another tab changes the open page's registry record and the title is not focused, push the change into the editor:
    - `if (editor.title.get() !== record.title) editor.title.set(record.title, { record: false })`;
    - the same for the icon through `toPageIcon`.
    - The `record: false` set fires `onChange` with `{ source: 'api', record: false }`. The callback writes the same value back to the registry, which is a no-op, so there is no loop.
    - TabSync (`tabSync/index.ts`) is not relied on: no file there reads or writes the page map (`grep getPageFields\|pageFromJSON src/components/modules/tabSync` is empty).
  - Stop `renderPageHeader` from drawing the h1 and icon row. It keeps breadcrumbs and the Trash banner.
- [ ] **Step 4: Run** the spec (PASS), then `tools/page-host-sync.spec.ts` (the cross-tab gate) and `tools/page-real-host.spec.ts`.
- [ ] **Step 5: Commit** `feat(playground): the page title comes from Blok`.

### Task 3: Icon undo and the moved keyboard

**Files:** `playground-page-title.spec.ts`.

- [ ] **Step 1: Failing e2e.**
  - Click Add icon. A random emoji is set and the picker opens. Pick another one.
  - Cmd+Z restores the random emoji; Cmd+Z again removes it. The breadcrumb icon follows each step.
  - Do not assert `\p{Extended_Pictographic}` on the random pick, because flags fail it.
- [ ] **Step 2: Keyboard e2e.**
  - Enter mid-title splits the title into a new first block.
  - ArrowDown from the title end lands in the first block.
  - Backspace at the start of a paragraph first block joins it into the title.
  - Backspace at the start of a heading first block first turns it into a paragraph (D11).
  - Wait 60ms between identical key presses.
- [ ] **Step 3: Run.** Undo may be handled twice until Task 5 deletes the old capture listener. If it is, mark the case `test.fixme` with that reason and remove the mark in Task 5.
- [ ] **Step 4: Commit** `test(playground): page icon undo and title keyboard`.

### Task 4: `?host=remote` onto the built-in title (D9)

Do this before Task 5.

**Files:** `src/playground/remote-page-host.ts` (`wireTitle` `:269-377`, the import at `:4`, overlay `:417-437`), `test/unit/playground/remote-page-host.test.ts`, `tools/page-real-host.spec.ts`, `docs/maintainers/page-host-integration.md`, `index.html` (`wirePageTitle` `:2389-2396`, its call at `:2486`).

- [ ] **Step 1: Carry over the existing tests.** Every `wireTitle` case in `remote-page-host.test.ts` keeps its assertion and switches its fixture from `history.track` to a fake `editor.title`. The guarantees to keep:
  - the serialized save queue;
  - the `latestWrite` ticket: only the latest write's verdict shows;
  - `pending`: a host refresh waits while saves are in flight;
  - `latestRead` ordering;
  - reject: reload, revert, `showError`;
  - `loadPage` failure: stop, clear, error;
  - `host.subscribe` refresh;
  - `hosted.display`: the breadcrumb shows the title before the host confirms;
  - the `generation` guard and `data-page-host-wired`.
- [ ] **Step 2: New failing tests.**
  - A host verdict that differs calls `editor.title.set(verdict, { record: false })`.
  - Its own `record: false` change does not call the host.
  - A `remote` change does not call the host.
  - A title typed before `wire()` resolves (it resolves only after `loadPage`) is buffered and saved once wired. It is neither dropped nor saved twice.
- [ ] **Step 3: Run** `yarn test test/unit/playground/remote-page-host.test.ts`. Expect FAIL.
- [ ] **Step 4: Implement.** Swap only the value channel, line for line:
  - `tracked.get()` becomes `editor.title.get()`;
  - `tracked.set(v, { record: false })` becomes `editor.title.set(v, { record: false })`;
  - user input comes from `pageTitle.onChange` (`user`/`undo`/`redo`) through a small buffer, instead of `history.track`'s callback.
  
  Remove the `PAGE_TITLE_SELECTOR` / `replaceTitleText` import (`:4`) and their uses. Remove `wirePageTitle` from `index.html`. In remote mode, `titleData` reads the overlay's `pages.get`.
- [ ] **Step 5:** Unit PASS, then `yarn e2e test/playwright/tests/tools/page-real-host.spec.ts`.
- [ ] **Step 6:** Rewrite the sample in `docs/maintainers/page-host-integration.md` to use `pageTitle.onChange` + `title.set(v, { record: false })`.
- [ ] **Step 7: Commit** `feat(playground): the remote host uses the built-in title`.

### Task 5: Delete the hand-built title

**Files:** `src/playground/page-host.ts`, `index.html`, `playground.css`, unit tests.

- [ ] **Delete from `page-host.ts`:**
  - `placeCaret` and `caretToTitleEnd` (`:516-522`);
  - `firstBlockKeydown` (`:531-604`);
  - `replaceTitleText` (`:610-620`);
  - `caretToFirstBlock` (`:623-639`);
  - `PAGE_TITLE_SELECTOR` (`:669`);
  - the title/icon parts of `renderPageHeader` (`:720-935`);
  - `randomIcon`, `openIconPicker`, `closeIconPicker` and `disposeIconPicker` (`:972-1028`).
- [ ] **Delete from `index.html`:**
  - the deleted names in the import at `:1820`;
  - the `renderHeader` title options (`:2229-2236`);
  - the `firstBlockKeydown` capture listener (`:2261`);
  - `wireTitleHistory` (`:2293-2351`);
  - `adoptRestoredTitle` (`:2355-2361`) and its `onRestored` use (`:2474`). A restore now reaches Blok as a `remote` page-map change, and `onChange` updates the registry. Plan 2 Task 5 confirms nothing else reads it.
  - the `PAGE_TITLE_SELECTOR` focus guards (`:2117, 2254, 2302, 2311, 2347, 2448`).
- [ ] **Delete from `playground.css`:** the `.pg-page-title` / `.pg-page-icon*` box styles (`:116-181`). Keep the view-transition rules (`:200-293`).
- [ ] **Replace** new-page focus (`index.html:2447-2448`) with `editor.title.focus()`.
- [ ] **Keep** `history-changes.ts` `VALUES_TITLE` (`:141-150`) for old history records. Fix its comment to say it is legacy.
- [ ] **Tests:**
  - Delete `page-icon-size.test.ts`.
  - In `page-host.test.ts`, delete the title/icon cases (`:412-679`, `:1447+`, `:1649+`, `:1694+`), and rewrite the storage-event cases (`:1139-1212`) for breadcrumbs plus the Task 2 push.
  - Rewrite the `wireTitleHistory` / `adoptRestoredTitle` slices of `page-host-notifications.test.ts` (`:165-540`) as tests of the Task 2 callbacks. Task 6 covers the collab seed contract (`:193-306`).
  - Remove the Task 3 `fixme` marks.
- [ ] **Run** every changed unit file, the Task 2/3 e2e, and `tools/page-*.spec.ts`. All must PASS.
- [ ] **Check** that `grep -rnE "'#pg-page-title'|\.pg-page-icon[^-]|PAGE_TITLE_SELECTOR|firstBlockKeydown|replaceTitleText" src test index.html` is empty. The view-transition names stay.
- [ ] **Commit** `refactor(playground): drop the hand-built title and icon`.

### Task 6: Collab: the title arrives and stays in sync

Needs plan 2 Tasks 1–4.

**Files:** `index.html`, `playground-page-title.spec.ts` (or `tools/page-host-sync.spec.ts`), `test/unit/playground/page-host-notifications.test.ts`.

- [ ] **Step 1: Failing e2e** with two pages on one collab room. Read the "models 4 things wrongly" note in memory `collab-browser-e2e-harness` first, and use a server-backed playground spec if the harness cannot model it.
  - A demo page shows its seeded title on both peers (plan 2 Task 4).
  - A title typed on A appears on B, and B's breadcrumb follows.
  - B's focus does not move.
- [ ] **Step 2: Decide the seed contract (this reverses a tested one).**
  - Today `page-host-notifications.test.ts:193-306` asserts two things: a profile's local title is never seeded into shared history, and a remote title never overwrites the registry. The `index.html` comment says the same.
  - New contract:
    - (a) A remote title DOES update the registry. It now flows through `onChange`, and Review Focus 1 needs it.
    - (b) The local title is seeded only for a page this profile just created: a local `create` in this session, whose room has no seed. Never for a page that exists elsewhere.
  - This keeps the old guard's reason, which is that a stale registry title in another browser must not resurrect a title a peer cleared. Rewrite those tests to this contract first, and watch them fail.
- [ ] **Step 3: Implement.** On the first `collaboration:status` = `'connected'` after creation, with a once guard (it fires on every reconnect, `collaboration/index.ts:1232-1243`): if `editor.title.get() === ''`, call `editor.title.set(title, { record: false })`. Do the same for the icon. `waitForPageContent` polls the DOM and is not a sync signal (`page-host.ts:1148-1171`).
- [ ] **Step 4: Run** (PASS). Also assert that one Cmd+Z right after the seed does not clear it.
- [ ] **Step 5: Commit** `feat(playground): collab pages carry their title`.

### Task 7: Page morphs target Blok's title (D8)

**Files:** `src/playground/page-host.ts` (`PAGE_HEADER_MORPH` `:1037`), `test/unit/playground/page-transition.test.ts:183-214`.

- [ ] **Step 1: Failing unit test.**
  - The morph selectors are `[data-blok-testid="page-header-title"]` and `[data-blok-testid="page-header-icon"]`. `page-header-add-icon` is never one of them.
  - `morphRules` already skips a selector with no match (`:1076`), so a page with no icon names nothing.
  - The header exists before `isReady`, so `waitForPageContent` needs no change.
- [ ] **Step 2: Implement.** Change only `PAGE_HEADER_MORPH`, then run the unit test and the existing morph e2e (`grep -rln "runPageTransition\|page-morph" test/playwright`).
- [ ] **Step 3: Collab check.** Open a page whose icon arrives after the snapshot. The transition finishes with no hard cut. If it cuts, record it in the overview's known limits. Do not change core (D8).
- [ ] **Step 4: Commit** `fix(playground): page morphs follow Blok's title and icon`.

## Part B: Exports (all opt-in)

### Task 8: Markdown, HTML and plain-text export with `title: true` (D1, D3)

**Files:**
- `src/markdown/blocks-to-markdown-core.ts`: export the private `escapePlainText` (`:186`) and the header newline/trailing-`#` handling (`:1226-1228`) as one `markdownHeadingText` helper.
- `src/view/blocks-to-markdown.ts:242,258`, covering `blocksToMarkdown` and `blocksToMarkdownWithReport`.
- `src/components/modules/api/blocks.ts:469-514`.
- `src/view/blocks-to-html.ts:691-704`.
- `src/view/blocks-to-plain-text.ts:465,488`, covering `blocksToPlainText` and `blocksToPlainTextWithReport`.
- `types/view.d.ts`: add `title?: boolean` to `BlocksToHtmlOptions` (`:94`), to both Markdown `Pick<BlocksToHtmlOptions, 'pageInfo' | 'pageHref'>` lists (`:412`, `:425`), and to `BlocksToPlainTextOptions` (`:229`).
- `types/api/blocks.d.ts:174`: `exportMarkdown(options?: { title?: boolean })`.

- [ ] **Step 1: Failing tests.**
  - **Markdown** (`test/unit/view/blocks-to-markdown.test.ts`):
    - `{ title: 'Plan', icon: emoji('🚀'), blocks }` with `{ title: true }` starts with `# 🚀 Plan\n\n`.
    - An image icon gives `# Plan`, and no title gives no heading line.
    - A title with `*`, a leading `#` or a trailing ` #` is escaped.
    - Without the option, the output equals today's.
    - The `WithReport` variant matches.
  - **Editor** (`blocks-export-markdown.test.ts`): `blocks.exportMarkdown({ title: true })` matches the view output. Keep `test/unit/markdown/blocks-to-markdown.parity.test.ts` green.
  - **HTML** (`blocks-to-html.test.ts`):
    - `{ title: true }` emits `<h1><span aria-hidden="true">🚀</span> Plan</h1>` before the body, inside the `root` wrapper when `root: true`.
    - An image icon emits `<h1><img alt="" src="…"> Plan</h1>`, with the URL through the existing safe-href helper.
    - The title goes through `escapeHtml` (`src/view/sanitize.ts:70`).
    - Without the option, the output is unchanged.
  - **Plain text:** `{ title: true }` puts the title as the first line. The `WithReport` variant matches.
- [ ] **Step 2: Run** those files. Expect FAIL.
- [ ] **Step 3: Implement** one shared `titleLine` per format. `blocksToViewNodes` (`view-nodes.ts:107-111`) inherits the HTML change.
- [ ] **Step 4:** PASS. Then run `view-stylesheet-law.test.ts`, the Markdown parity test, and every existing exporter snapshot test unchanged.
- [ ] **Step 5: Playground.** The Blok View panel (`index.html:2868`) passes `title: true`.
- [ ] **Step 6: Commit** `feat(export): opt-in page title in Markdown, HTML and plain text`.

### Task 9: Import lifts a leading title with `title: true` (D2)

The plain importers return block arrays: `markdownToBlocks` returns `Promise<OutputBlockData[]>` (`types/markdown.d.ts:16`), and `htmlToBlocks(html)` takes no options and returns an array (`types/view.d.ts:734`). So only the `*WithReport` variants can return the title.

**Files:** `src/markdown/mdast-to-blocks.ts:215`, `src/markdown/index.ts:18`, `src/view/html-to-blocks.ts:1259-1262`, `types/data-formats/markdown-import-config.d.ts` (the option goes here; `importMarkdown` uses this config too, `types/api/blocks.d.ts:162`), `types/markdown.d.ts` (`MarkdownImportResult`), `types/view.d.ts` (`htmlToBlocks` optional second parameter, `HtmlImportResult` `:710`), `src/components/modules/api/blocks.ts:353-356`.

- [ ] **Step 1: Failing tests.**
  - `markdownToBlocksWithReport('# 🚀 Plan\n\nBody', { title: true })` returns `title: 'Plan'`, `icon: emoji('🚀')`, and blocks without that heading.
    - Only a leading emoji grapheme followed by a space counts as the icon.
  - The plain `markdownToBlocks(…, { title: true })` drops the leading heading and returns blocks only.
  - HTML: `htmlToBlocksWithReport` lifts a leading `<h1>` the same way. `htmlToBlocks(html, { title: true })` is a new optional parameter, which is additive.
  - Not lifted: a non-leading `#`, or a `##`.
  - Without the option, every result is unchanged.
  - `importMarkdown(md, { title: true })` sets the editor title in the same undo step as the blocks. Without the option it keeps the current title, as `keepId` does today.
  - Round trip: `blocksToMarkdown(x, { title: true })` then `markdownToBlocksWithReport(…, { title: true })` gives back the same title, icon and block count.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(import): opt-in page title from a leading heading`.

### Task 10: Server runtime and translation carry the title (D12)

**Files:** `src/view/server-runtime.ts` (`readDocument` `:114-124`, ops `:386-421`), `src/view/document-texts.ts`, `types/view.d.ts:331-365`, `test/unit/server-runtime/index.test.ts`, `test/unit/view/document-texts.test.ts`, `packages/server/dotnet/Blok.Server/.../BlokDocumentConverter.cs` (`ToMarkdownAsync` `:49`, `ToHtmlAsync` `:314`) and its tests.

- [ ] **Step 1: Failing tests.**
  - `readDocument` keeps `title`/`icon`; today it returns `{ blocks }` only.
  - The runtime ops take the document only (`:386-401`). Define an optional `title: true` field on the op input next to the document, and pass it through to the exporters.
  - `extractTexts(doc, { title: true })[0] === doc.title`, and `injectTexts` writes it back.
  - Without the option, every result is unchanged.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Regenerate the runtime with `scripts/build-server-runtime.mjs` and run `build-server-runtime.test.ts`.
- [ ] **Step 5: C# (required).**
  - Add an optional `Title` flag to the options of `ToMarkdownAsync` / `ToHtmlAsync`, and forward it in the op input.
  - C# test first: a document with a title and `Title = true` renders the heading; without it, the output is unchanged.
  - Run `dotnet test … --filter FullyQualifiedName~BlokDocumentConverter`.
- [ ] **Step 6: Commit** `feat(view): server runtime and translation can carry the page title`.

## Part C: Docs

### Task 11: Reference docs

**Files:**
- `docs/src/components/api/api-data.ts`:
  - a `pageTitle` row in the config table (`:388+`);
  - a new `title-api` section modelled on `width-api` (`:2822`);
  - `title`/`icon` in the `output-data` interface (`:3551+`);
  - the new exporter, importer and text options.
- `api-nav.ts:7,46`
- `docs-hub-summaries.ts:35,110` (en and ru)
- `hooks/useApiTranslations.ts:34`
- `hooks/useDocsSidebarSections.ts:32`
- `en.json` and `ru.json`

- [ ] **Step 1: Failing guard test.** Add the `OutputData` twin of the `OutputBlockData` coverage test (`api-data.test.ts:943`): every key of `OutputData` in `types/data-formats/output-data.d.ts` must be in the `output-data` section. It fails on `title`/`icon` today.
- [ ] **Step 2: Write the entries.** Follow `docs/CLAUDE.md`'s Prose rules, with the same block shape in en and ru. Document:
  - that a host section between the title and the editor lines up with `max-width: var(--blok-content-column); margin-inline: auto` plus the editor gutter (owed from plan 1);
  - `title.set(…, { record: false })` and `title.mount(null)`;
  - the known limits from the overview.
- [ ] **Step 3: Run** `docs/src/i18n/reference-prose.test.ts`, `api-data.test.ts` and `api-data.ru-coverage.test.ts`. Then run `node docs/scripts/update-lastmod-ledger.mjs` and its test.
- [ ] **Step 4: Commit** `docs: page title config, API, saved data and export options`.

### Task 12: Final gate

- [ ] Scoped lint on changed files.
- [ ] Unit tests: the changed files, plus every referencing test (grep the changed symbols across `test/`).
- [ ] The new and touched e2e specs.
- [ ] Full `yarn lint`, plus the related-test set as the final gate. Per the run-only-related-tests rule, do not run the full `yarn test` or the full e2e suite.
- [ ] `git pull --ff-only`, `git push`, then `git status` must be up to date.
- [ ] Hand-off: list the overview's release-note entry and the known limits. Nothing here is BREAKING, because every changed shipped surface is opt-in.
