# Page title: playground, exports and docs (plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- The playground drops its hand-built title and icon and uses `pageTitle`. It gains icon undo and keeps breadcrumbs, Trash, the page tree, link blocks and page morphs.
- Exporters, importers and the server runtime can carry the title when asked.
- The docs describe it all.

**Architecture:**
- **Part A, playground.** `index.html` passes `pageTitle: { holder: '#page-title-slot', onChange, onIconChange }` and `data: { title, icon, blocks }`. `PageRegistry` stays as the mirror that breadcrumbs, the page tree, link blocks and `document.title` read. The doc is the truth once the editor is up; the registry follows every change.
- **Part B, exports.** An opt-in `title: true` option on each exporter, importer and text helper (D1, D2, D12).
- **Part C, docs.**

**Overview and decisions:** `2026-10-08-page-title-followups-overview.md` (D1, D2, D3, D8, D9, D11, D12).

**Order:**
- Part A needs plan 1b (Tasks 2, 3) and plan 2 Task 4 (dev seed). The collab case also needs plan 2 Tasks 1–3.
- Part B needs only plan 1b Task 1.
- Part C goes last.

## Changes from the design spec

- **Holder placement.** The spec said `title: { holder }`; the key is `pageTitle`.
  - `renderPageHeader` empties `#page-header` with `host.replaceChildren(...)` (`src/playground/page-host.ts:934`).
  - Core's header already pads to the gutter and centres on `--blok-content-column` (`src/styles/page-title.css:8-28`). Inside `.pg-page-header` (max-width 720, `playground.css:31-42`) it would be inset twice.
  - So the holder is a new sibling slot in `#editor-col`, between `#page-header` and `#blok` (`index.html:1630-1631`), at full editor width.
- **Seeding without an undo step.** `blok.title.set` used to always record. Plan 1b Task 2 adds `{ record: false }`, which the collab seed and the remote-host verdict use.
- **Two things core does differently from the playground:**
  - Backspace from a heading or list block first turns it into a paragraph, then joins (`keyboardNavigation.ts:904-916`). The playground joined at once. Core's rule is kept (D11), and the e2e asserts it.
  - The playground stored the icon as an emoji string (`PageRecord.icon`, `page-host.ts:17-28`); core uses `PageIcon`. Convert at the boundary: `{ type: 'emoji', value }` going in. Going out, an image icon is left out of the registry, because the registry has no image form and the playground has no image picker.

## Global Constraints

- Same unit/e2e hygiene as the core plan. E2E uses roles or `data-blok-testid`. The core header hooks are `page-header`, `page-header-title`, `page-header-icon` and `page-header-add-icon` (`header-dom.ts:20,26`; `icon-control.ts:89,117`).
- The title's role and label are unchanged: role textbox, "Page title" (`en.json:781`). So `tools/page-host-sync.spec.ts:50-63` and `tools/page-real-host.spec.ts:115,120` should keep passing. Run them; don't assume.
- **The playground builds a new editor per page** (`swapEditor`: `destroy` then `new Blok`, `index.html:2365-2388`). The slot must exist before `new Blok`, because core resolves the holder in `prepare()`.
- **View transitions:**
  - Core's `renderText` replaces only the `h1`'s children, never the `h1`, so it is safe to name.
  - The icon button is replaced when its kind changes add↔icon (`icon-control.ts:134-145`); see D8.
  - Read `view-transition-named-element-laws` in memory before Task 7.
- **Exports:** the view stylesheet law (`view-stylesheet-law.test.ts`, 323fe10d) bans `data-blok-page-title` / `data-blok-page-header` hooks in `view.css`. The exported `h1` uses neither attribute.
- **Peer-session hazard:**
  - `src/view/document-schema.ts` and `src/shared/agent/*` may be dirty from another session. Never stage a file you did not change.
  - Check `git diff --cached --name-only` before each commit.

## Review Focus

1. **Typing in the title updates the breadcrumb, sidebar row, link blocks and `document.title`**, and survives a reload. The registry must follow every `onChange` source, including `remote`.
2. **Undo after load does not erase the title.** The seed goes in through `config.data` (no undo step). The collab seed uses `record: false`.
3. **Icon undo.** Add an icon, change it, then Cmd+Z twice: the first icon, then none. Breadcrumb and sidebar follow each step.
4. **Page morph.** Opening a page from a link block still morphs title and icon with no hard cut, locally and in collab.
5. **Exports stay byte-identical without `title: true`.** Prove it with the existing snapshot tests passing unchanged.

## File Structure

| File | Change |
|---|---|
| `src/playground/page-host.ts` | delete the title/icon code (list in Task 4); keep the registry, breadcrumbs, Trash and morphs |
| `src/playground/page-title-wiring.ts` | new: builds the `pageTitle` config and `data` from the registry, and maps icons both ways |
| `index.html` | slot element, `buildConfig`, delete `wireTitleHistory`/`adoptRestoredTitle`/the `firstBlockKeydown` capture |
| `src/playground/remote-page-host.ts` | `wireTitle` onto `pageTitle.onChange` + `title.set(v, { record: false })` |
| `src/playground/playground.css` (`:116-182`) | delete `.pg-page-title` / `.pg-page-icon*` |
| `docs/maintainers/page-host-integration.md` | sample rewritten (line ~28) |
| `test/unit/playground/page-title-wiring.test.ts` | new |
| `test/unit/playground/page-host.test.ts`, `page-host-notifications.test.ts`, `page-transition.test.ts`, `remote-page-host.test.ts`, `history-drawer.test.ts`; delete `page-icon-size.test.ts` | updated |
| `test/playwright/tests/tools/playground-page-title.spec.ts` | new e2e |
| `src/view/blocks-to-markdown.ts`, `src/markdown/blocks-to-markdown-core.ts`, `src/view/blocks-to-html.ts`, `src/view/blocks-to-plain-text.ts`, `src/components/modules/api/blocks.ts:469-514` | opt-in title output |
| `src/markdown/mdast-to-blocks.ts`, `src/view/html-to-blocks.ts`, `src/markdown/index.ts` | opt-in title import |
| `src/view/server-runtime.ts:114-124` (+ ops `:386-421`) | keep `title`/`icon`, forward the option |
| `src/view/document-texts.ts` | opt-in title in `extractTexts`/`injectTexts` |
| `types/view.d.ts`, `types/markdown.d.ts`, `types/api/blocks.d.ts` | option and result fields |
| `docs/src/components/api/api-data.ts` and the nav/hub/i18n files listed in Task 11 | docs |

---

## Part A — Playground

### Task 1: Title wiring helper (pure, unit-tested)

**Files:** `src/playground/page-title-wiring.ts`, `test/unit/playground/page-title-wiring.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `toPageIcon('🚀')` → `{ type: 'emoji', value: '🚀' }`
  - `toPageIcon('')` → `undefined`
  - `fromPageIcon({ type: 'emoji', value: '🚀' })` → `'🚀'`
  - `fromPageIcon({ type: 'image', url })` → `''`
  - `fromPageIcon(null)` → `''`
  - `titleData(pages, pageId)` → `{ title, icon }` from the registry, for the root (`ROOT_STORAGE_KEY`, default `'Blok'`, `page-host.ts:37-41`) and for a child page.
- [ ] **Step 2: Run** `yarn test test/unit/playground/page-title-wiring.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Pure functions only. They read `PageRegistry` through its public methods (`info`, `root`).
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(playground): map page records to the built-in title`.

### Task 2: The playground boots on `pageTitle`

**Files:** `index.html` (slot near `:1630`, `buildConfig` `:1931`, `storeBlocks` `:2144-2148, 2193`, `swapEditor` `:2365-2388`), `src/playground/playground.css`, `test/playwright/tests/tools/playground-page-title.spec.ts`.

- [ ] **Step 1: Failing e2e** (new spec, local mode, `--no-server` fixture as the existing playground specs use; copy their setup):
  - the root page shows `page-header-title` with the registry title, and only one element with role textbox "Page title" exists;
  - typing ` Plan` updates the breadcrumb and `document.title`;
  - reload keeps it;
  - a child page opened from a link block shows its own title, and the link block text follows a rename.
- [ ] **Step 2: Run** `yarn e2e test/playwright/tests/tools/playground-page-title.spec.ts`. Expect FAIL. The role-count assertion fails while both headers exist.
- [ ] **Step 3: Implement.**
  - Add `<div id="page-title-slot"></div>` between `#page-header` and `#blok`.
  - In `buildConfig`: `pageTitle: { holder: '#page-title-slot', onChange: (t) => { pages.setTitle(currentPageId, t); refreshCrumbs(); updateDocumentTitle(); }, onIconChange: (i) => { pages.setIcon(currentPageId, fromPageIcon(i)); … } }`, and `data: { ...titleData(pages, currentPageId), blocks }`.
  - Both callbacks run for every source, including `remote` and `undo`.
  - `storeBlocks` keeps storing `.blocks` only. The registry stays the local title store, so local docs need no migration (records already hold `title`).
  - Stop `renderPageHeader` from drawing the h1 and icon row. It keeps breadcrumbs and the Trash banner.
- [ ] **Step 4: Run** the spec (PASS). Then run `tools/page-host-sync.spec.ts` and `tools/page-real-host.spec.ts`.
- [ ] **Step 5: Commit** `feat(playground): the page title comes from Blok`.

### Task 3: Icon undo and the moved keyboard

**Files:** `playground-page-title.spec.ts`.

- [ ] **Step 1: Failing e2e:**
  - Click Add icon: a random emoji is set and the picker opens. Pick another one. Cmd+Z restores the random one, Cmd+Z again removes it. The breadcrumb icon follows each step.
  - Do not assert `\p{Extended_Pictographic}` on the random pick, because flags fail it (design spec, "Icon").
- [ ] **Step 2: Keyboard e2e:**
  - Enter mid-title splits into a new first block.
  - ArrowDown from the title end lands in the first block.
  - Backspace at the start of a paragraph first block joins into the title.
  - Backspace at the start of a heading first block turns it into a paragraph first (D11).
  - Wait 60ms between identical key presses (core plan, known trap).
- [ ] **Step 3: Run.** The undo case may fail before Task 4 deletes the old capture listener, because keys are handled twice. Fix it in Task 4, then re-run.
- [ ] **Step 4: Commit** with Task 4.

### Task 4: Delete the hand-built title

**Files:** `src/playground/page-host.ts`, `index.html`, `playground.css`, unit tests.

- [ ] Delete:
  - from `page-host.ts`:
    - `firstBlockKeydown` (`:531-604`), `replaceTitleText` (`:610-620`), `caretToFirstBlock` (`:623-639`);
    - `PAGE_TITLE_SELECTOR` (`:669`);
    - the title/icon parts of `renderPageHeader` (`:720-935`);
    - `randomIcon`, `openIconPicker`, `closeIconPicker`, `disposeIconPicker` (`:972-1028`);
  - from `index.html`:
    - the `renderHeader` options `splitTitle`/`toFirstBlock`/`recordTitle`/`undo`/`redo`/`i18n` (`:2222-2244`);
    - the `firstBlockKeydown` capture listener (`:2261`);
    - `wireTitleHistory` (`:2293-2351`) and `adoptRestoredTitle` (`:2354-2361`);
    - the `PAGE_TITLE_SELECTOR` focus guards (`:2117, 2254, 2347`);
  - from `playground.css`: `.pg-page-title` and `.pg-page-icon*` (`:116-182`).
- [ ] Replace new-page focus (`index.html:2447-2448`) with `editor.title.focus()`.
- [ ] Keep `history-changes.ts` `VALUES_TITLE` (`:141-150`) for old history records. Fix its comment to say it is legacy.
- [ ] Tests:
  - delete `test/unit/playground/page-icon-size.test.ts`;
  - delete the title/icon cases in `page-host.test.ts` (`:412-679`, `:1447+`, `:1649+`, `:1694+`), and rewrite the storage-event cases (`:1139-1212`) for breadcrumbs only;
  - rewrite the `wireTitleHistory`/`adoptRestoredTitle` slices in `page-host-notifications.test.ts` (`:165-540`) as tests of the Task 2 callbacks.
- [ ] Run every changed unit file, then the Task 2/3 e2e and `tools/page-*.spec.ts`. All PASS.
- [ ] `grep -rn "pg-page-title\|pg-page-icon\|PAGE_TITLE_SELECTOR\|firstBlockKeydown" src test index.html` is empty.
- [ ] Commit `refactor(playground): drop the hand-built title and icon`.

### Task 5: Collab: the title arrives and stays in sync

Needs plan 2 Tasks 1–4.

**Files:** `index.html`, `playground-page-title.spec.ts` (or `tools/page-host-sync.spec.ts`), `src/playground/page-title-wiring.ts`.

- [ ] **Step 1: Failing e2e** with two pages on one collab room (follow `collab-browser-e2e-harness` in memory; read its "models 4 things wrongly" note first). If a real-server spec is needed, use the existing server-backed playground specs.
  - A demo page shows its seeded title on both peers.
  - A title typed on A appears on B, and B's breadcrumb follows.
  - B's focus does not move.
- [ ] **Step 2: Failing test** for a page the user created: the room seeds `{ blocks: [] }`.
  - After the first sync, if `editor.title.get() === ''` and the registry has a title, call `editor.title.set(registryTitle, { record: false })` once. Do the same for the icon.
  - Assert that one Cmd+Z right after does not clear it.
  - Two tabs seeding the same value converge, because both write the same string.
- [ ] **Step 3: Implement.** Wait for the first sync using the existing signal `waitForPageContent` uses (`page-host.ts`, around `:1045-1290`), then seed.
- [ ] **Step 4: Run** (PASS). **Step 5: Commit** `feat(playground): collab pages carry their title`.

### Task 6: `?host=remote` onto the built-in title (D9)

**Files:** `src/playground/remote-page-host.ts:269-377`, `test/unit/playground/remote-page-host.test.ts`, `tools/page-real-host.spec.ts`, `docs/maintainers/page-host-integration.md`.

- [ ] **Step 1: Failing unit tests.** `wireTitle` now takes the editor, not `history`:
  - a `user`/`undo`/`redo` change calls `host.saveTitle(pageId, title, version)`;
  - a host verdict that differs calls `editor.title.set(verdict, { record: false })`;
  - a `remote` change does not call the host;
  - an `api` change with `record: false` (its own verdict) does not call the host either.
- [ ] **Step 2: Run** `yarn test test/unit/playground/remote-page-host.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Remove `history.track('title', …)` (`:286-293`), and remove `wirePageTitle` from `index.html` (`:2390-2397`). Point the remote config's `pageTitle.onChange` at the new `wireTitle` input.
- [ ] **Step 4:** Unit PASS, then `yarn e2e test/playwright/tests/tools/page-real-host.spec.ts`.
- [ ] **Step 5:** Rewrite the sample in `docs/maintainers/page-host-integration.md` (around line 28) to use `pageTitle.onChange` + `title.set(v, { record: false })`.
- [ ] **Step 6: Commit** `feat(playground): the remote host uses the built-in title`.

### Task 7: Page morphs target Blok's title (D8)

**Files:** `src/playground/page-host.ts` (`PAGE_HEADER_MORPH` `:1037`, `runPageTransition`/`pageNavMorphs`/`waitForPageContent` `:1045-1290`), `test/unit/playground/page-transition.test.ts:183-214`.

- [ ] **Step 1: Failing unit test.** The morph names `[data-blok-testid="page-header-title"]`, and names `[data-blok-testid="page-header-icon"]` only when it exists at snapshot time. It never names `page-header-add-icon`.
- [ ] **Step 2: Failing unit test.** `waitForPageContent` also waits until the title element exists in the slot.
- [ ] **Step 3: Implement.** Run the unit test and the existing morph e2e (`grep -rln "runPageTransition\|page-morph" test/playwright`).
- [ ] **Step 4: Check the collab case.**
  - In a two-peer collab e2e, open a page whose icon arrives after the snapshot. The transition must finish with no hard cut.
  - If it cuts, the icon was named while the add button showed. Assert that the name is absent in that state.
- [ ] **Step 5: Commit** `fix(playground): page morphs follow Blok's title and icon`.

## Part B — Exports (all opt-in)

### Task 8: Markdown, HTML and plain-text export with `title: true` (D1, D3)

**Files:** `src/markdown/blocks-to-markdown-core.ts` (export the private `escapePlainText` `:186`, and the header newline/trailing-`#` handling `:1226-1228`, as one `markdownHeadingText` helper), `src/view/blocks-to-markdown.ts:242,258`, `src/components/modules/api/blocks.ts:469-514`, `src/view/blocks-to-html.ts:691-704`, `src/view/blocks-to-plain-text.ts:465,488`, `types/view.d.ts` (`BlocksToHtmlOptions` `:94`, the Markdown options, `BlocksToPlainTextOptions` `:229`), `types/api/blocks.d.ts:174`.

- [ ] **Step 1: Failing tests:**
  - **Markdown** (`test/unit/view/blocks-to-markdown.test.ts`):
    - `{ title: 'Plan', icon: emoji('🚀'), blocks }` with `{ title: true }` starts with `# 🚀 Plan\n\n`;
    - an image icon gives `# Plan`;
    - no title gives no heading line;
    - a title with `*`, a leading `#` and a trailing ` #` is escaped;
    - without the option the output equals today's.
  - **Editor** (`blocks-export-markdown.test.ts`): `blocks.exportMarkdown({ title: true })` matches the view output. Keep `test/unit/markdown/blocks-to-markdown.parity.test.ts` green.
  - **HTML** (`blocks-to-html.test.ts`):
    - `{ title: true }` emits `<h1><span aria-hidden="true">🚀</span> Plan</h1>` before the body, inside the `root` wrapper when `root: true`;
    - an image icon gives `<h1><img alt="" src="…"> Plan</h1>`, with the URL through the existing safe-href helper;
    - the title goes through `escapeHtml` (`src/view/sanitize.ts:70`);
    - without the option the output is unchanged.
  - **Plain text:** `{ title: true }` puts the title as the first line.
- [ ] **Step 2: Run** those files. Expect FAIL.
- [ ] **Step 3: Implement.** One shared `titleLine` per format. `blocksToViewNodes` (`view-nodes.ts:20`) inherits the HTML change.
- [ ] **Step 4:** PASS. Run `test/unit/view/view-stylesheet-law.test.ts`, the Markdown parity test and every existing exporter snapshot test unchanged.
- [ ] **Step 5: Commit** `feat(export): opt-in page title in Markdown, HTML and plain text`.

### Task 9: Import lifts a leading title with `title: true` (D2)

**Files:** `src/markdown/mdast-to-blocks.ts:215`, `src/markdown/index.ts:18`, `src/view/html-to-blocks.ts:1259-1262`, `types/markdown.d.ts`, `types/view.d.ts:710` (`HtmlImportResult`), `src/components/modules/api/blocks.ts:353-356` (`importMarkdown`).

- [ ] **Step 1: Failing tests:**
  - `markdownToBlocks('# 🚀 Plan\n\nBody', { title: true })` returns `title: 'Plan'`, `icon: emoji('🚀')`, and blocks without that heading. Only a leading emoji grapheme followed by a space counts as the icon.
  - HTML: a leading `<h1>` is lifted the same way.
  - A non-leading `#`, or `##`, is not lifted.
  - Without the option, the result is unchanged.
  - `importMarkdown(md, { title: true })` sets the editor title as one undo step together with the blocks. Without the option it keeps the current title (today's `keepId` behaviour).
  - Round trip: `blocksToMarkdown(x, { title: true })` → `markdownToBlocks(…, { title: true })` gives back the same title, icon and block count.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(import): opt-in page title from a leading heading`.

### Task 10: Server runtime and translation carry the title (D12)

**Files:** `src/view/server-runtime.ts:114-124, 386-421`, `src/view/document-texts.ts`, `types/view.d.ts:331-365`, `test/unit/server-runtime/index.test.ts`, `test/unit/view/document-texts.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `readDocument` keeps `title`/`icon` (today it returns `{ blocks }` only).
  - The runtime's Markdown and HTML ops pass `title: true` through when the caller's options carry it.
  - `extractTexts(doc, { title: true })[0] === doc.title`, and `injectTexts` writes it back.
  - Without the option, both are unchanged.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Regenerate the runtime with `scripts/build-server-runtime.mjs` and run `build-server-runtime.test.ts`.
- [ ] **Step 5: C# callers.** If `BlokDocumentConverter.cs:49,314` builds the options object, add a `Title` option there too, with a C# test. Otherwise record that the C# surface needs no change.
- [ ] **Step 6: Commit** `feat(view): server runtime and translation can carry the page title`.

## Part C — Docs

### Task 11: Reference docs

**Files:**
- `docs/src/components/api/api-data.ts`: a `pageTitle` config row in the table at `:388+`; a new `title-api` section modelled on `width-api` (`:2822`); `title`/`icon` in the `output-data` interface at `:3551+`; the new exporter, importer and text options.
- `docs/src/components/api/api-nav.ts:7,46`
- `docs/src/components/.../docs-hub-summaries.ts:35,110` (en and ru)
- `hooks/useApiTranslations.ts:34`
- `hooks/useDocsSidebarSections.ts:32`
- `en.json`, `ru.json`

- [ ] **Step 1: Failing guard test.** Add the `OutputData` twin of the `OutputBlockData` coverage test (`api-data.test.ts:943`): every key of `OutputData` in `types/data-formats/output-data.d.ts` is listed in the `output-data` section. It fails on `title`/`icon` today.
- [ ] **Step 2:** Write the entries. Follow the Prose rules in `docs/CLAUDE.md`, with the same block shape in en and ru.
  - Document that a host section placed between the title and the editor lines up with `max-width: var(--blok-content-column); margin-inline: auto` plus the editor gutter. This was owed from plan 1.
  - Also document `title.set(…, { record: false })`, `title.mount(null)`, and the known limits from the overview.
- [ ] **Step 3: Run** `docs/src/i18n/reference-prose.test.ts`, `api-data.test.ts`, `api-data.ru-coverage.test.ts`, then `node docs/scripts/update-lastmod-ledger.mjs` and its test.
- [ ] **Step 4: Commit** `docs: page title config, API, saved data and export options`.

### Task 12: Final gate

- [ ] Scoped lint on changed files. Run the changed and referencing unit tests (grep changed symbols across `test/`). Run the new and touched e2e specs.
- [ ] Full `yarn lint` and the related-test set as the final gate. Per the run-only-related-tests rule, do not run the full `yarn test` or the full e2e suite.
- [ ] `git pull --ff-only`, `git push`, `git status` up to date.
- [ ] Hand-off: list the overview's release-note entry and the known limits. Nothing here is BREAKING, because every changed shipped surface is opt-in.
