# Safe Page Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page pointers safe without saved metadata and define the host's canonical title-update and migration contract.

**Architecture:** Page title, icon, path, and access verdict stay in ephemeral resolved state; saved page blocks retain only `pageId`. Synchronous static exporters accept explicit host metadata. The host remains the canonical metadata and access authority; the independent index/tree plan is `docs/superpowers/plans/2026-10-04-pages-index.md`.

**Tech Stack:** TypeScript, Vitest, Playwright project tests, Blok's DOM-free `@bloklabs/core/view` entry and hand-authored `types/*.d.ts` declarations.

**Spec:** `docs/superpowers/specs/2026-10-04-headless-page-platform-design.md`

## Global Constraints

- Work on the existing `main` checkout only. Do not branch, create a worktree, stash, commit, push, or edit unrelated files.
- The shared checkout is dirty, including `src/tools/page/index.ts` and `test/unit/tools/page/page.test.ts`. Before each edit, record `git diff -- <target files>`; preserve every unrelated hunk. Re-check just before editing because another session may change a file.
- Write each regression test first, run its new file alone and see it fail, implement the smallest change, run it green, then run changed-file lint. Do not use a passing old test as proof of a new behavior.
- No new workspace database, sidebar, search service, page body store, or server persistence in Blok. Page bodies remain separate ordinary documents. A `page` block is the one owning pointer; a URL or later page reference is non-owning.
- Only a host-authorized `resolve(pageId)` response may supply live title/icon/path. `null` means missing, `{ access: 'none' }` means inaccessible, `undefined` means unresolved. These states may not fall back to `data.cache`.
- `subscribe(pageId, notify)` must deliver local-tab as well as remote changes. Later requests supersede earlier ones even for the same `pageId`; the previous displayed metadata is cleared while an access recheck is pending.
- Static metadata lookup stays synchronous and DOM-free: `pageInfo?: (pageId: string) => PageInfo | null | undefined`, alongside existing `pageHref`. Never call `pageHref` for missing/inaccessible pages. Do not infer identity from a URL or let a host URL encode a restricted title.
- Keep `cache?: PageCache` in the public input type only for legacy reads, marked deprecated; new `save()` output contains `pageId` only. The page tool was added after the latest release tag `v1.15.2` (`git log v1.15.2..HEAD -- src/tools/page/index.ts`), so this page-specific change is not labelled BREAKING unless the release boundary changes before execution.
- `types/*.d.ts` must be self-contained or import other published declarations, never `src/`. Reuse existing icons before adding one; a new icon also needs `index.html` gallery registration, regenerated `types/icons.d.ts`, and an icon relationship test.
- The host must scrub legacy caches from its consumer record, active collaboration working set, and journal/checkpoint **before** an unauthorized reader can receive a parent document. Blok rendering changes do not sanitize previously served bytes or old clients. Keep this deployment gate distinct from slice D's general live-session revocation and purge APIs.
- Translate new editor copy in every locale under `src/components/i18n/locales/` and run the repository's locale validation. A denied page's explanation is not an authorization mechanism.
- During iteration run only new tests and lint only modified files. At the final code gate use the project's final lint/test requirements, published-type drift checks, view purity check, and a real-host two-user/two-tab check. No gate is claimed to have run by this plan.

## Review Focus

1. An old parent document carrying a restricted cache must produce no cached title/icon in DOM, clipboard, Markdown, plain text, HTML, or a fresh save; Tasks A1, A3 and A4 pin every output.
2. Two responses for one page arriving out of order must leave the newer denial in force, including after a subscribe callback and after the pointer changes ID; Task A1 pins both races.
3. A page copied or drag-duplicated without `href` must not create a second owning pointer; Task A3 pins copy, paste, and duplicate.
4. A rejected title write or Undo/Redo must not leave a stale header, pointer, tree, or link in any tab; Task A5 pins rollback and notification order in a host integration.
5. A host-supplied URL or image icon with an unsafe scheme must never bypass the existing URL gate, and unresolved metadata must not call the URL callback; Task A4 pins both.

---

## Slice A — Safe page pointer and metadata updates

### Task A1: Keep metadata ephemeral and make re-resolution latest-wins

**Files:**
- Create: `test/unit/tools/page/page-safe-metadata.test.ts`
- Modify: `src/tools/page/index.ts`
- Modify: `src/tools/page/types.ts`
- Modify: `types/tools/page.d.ts`
- Update affected legacy expectations only: `test/unit/tools/page/page.test.ts`

**Interfaces:**
- Consumes: existing `PageConfig.resolve(pageId): PageInfo | null | undefined | Promise<...>` and `subscribe(pageId, notify)`.
- Produces: `PageTool.save(): { pageId: string }` at runtime; the published `PageData` still accepts deprecated `cache` on input. `resolve` outcomes are `unresolved | missing | no-access | allowed` in tool state, never saved.

- [ ] **Step 1: Write the failing tests.** Copy the typed `createOptions` helper from `test/unit/tools/page/page.test.ts:10-41` into the new test file; keep `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`. Add these assertions, with the leak assertion first.

```ts
const legacy = { pageId: 'p1', cache: {
  title: 'Private plan',
  icon: { type: 'emoji' as const, value: '🔐' },
} };
const dispatchChange = vi.fn();
const tool = new PageTool(createOptions({
  data: legacy,
  config: { resolve: () => undefined },
  dispatchChange,
}));
const root = tool.render();
tool.rendered();
await flush();
expect(root.textContent).not.toContain('Private plan');
expect(root.textContent).not.toContain('🔐');
expect(tool.save()).toEqual({ pageId: 'p1' });
expect(dispatchChange).not.toHaveBeenCalled();
```

Add a second test with two pending `resolve` promises and captured `notify`. Resolve request 2 as `{ access: 'none' }`, then request 1 as `{ title: 'Private plan' }`; assert the title never reappears. Add a third test that changes `pageId` via `setData({ pageId: 'p2', cache: legacy.cache })` while p1 is pending and asserts that p1 cannot paint p2. Also assert a notification immediately replaces an allowed title with the neutral label before the next response arrives.

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/tools/page/page-safe-metadata.test.ts`. Expected: the legacy title appears and `save()` includes `cache`; the same-ID race test also fails when the late response wins.

- [ ] **Step 3: Implement only the state transition.** Discard `options.data.cache` in the constructor and `setData`, remove `readCache`/`sameCache`/`writeCache`/`shown` and the read-only flush, and make `save` return only `{ pageId: this.data.pageId }`. Retain `PageCache` only as a legacy input declaration. Keep resolved `PageInfo` in an unsaved field. Increment a request counter before each resolve and when the page ID changes or the tool is removed. Clear title/icon/path before every access recheck; apply a reply only when both the counter and page ID still match.

```ts
private requestVersion = 0;
private info: PageInfo | null | undefined;

public save(): PageData {
  return { pageId: this.data.pageId };
}

private async refresh(): Promise<void> {
  const pageId = this.data.pageId;
  const version = ++this.requestVersion;
  this.info = undefined;
  this.renderView();
  if (pageId === '' || this.config.resolve === undefined) return;
  const info = await Promise.resolve().then(() => this.config.resolve?.(pageId))
    .catch((): undefined => undefined);
  if (this.detached || version !== this.requestVersion || pageId !== this.data.pageId) return;
  this.info = info;
  this.renderView();
}
```

Use `info === null` for missing, `info?.access === 'none'` for denial, and a separate unresolved state for `undefined`. A successful empty object is an allowed untitled page. Do not call `dispatchChange` for metadata refresh. Keep `createPage`'s derived ID write. Never call `preview` for unresolved, missing, or denied pages.

- [ ] **Step 4: Verify green and reconcile old assertions.** Run `yarn test test/unit/tools/page/page-safe-metadata.test.ts`. Then update the cache-based expectations identified at `test/unit/tools/page/page.test.ts:80-165,372-548,624-665,865-974,1163-1189` without deleting unrelated coverage; run that file alone. Run changed-file ESLint on `src/tools/page/index.ts`, `src/tools/page/types.ts` and both changed tests.

- [ ] **Step 5: Review checkpoint.** Confirm `git diff -- src/tools/page/index.ts test/unit/tools/page/page.test.ts` contains only this task's hunks plus the pre-existing changes recorded before editing. The editor still mints one page ID on user/API insert, and metadata refresh creates no undo step.

### Task A2: Explain denied access without navigating

**Files:**
- Create: `test/unit/tools/page/page-access-dialog.test.ts`
- Modify: `src/tools/page/index.ts`
- Modify: `src/components/icons/index.ts` and `index.html` only if no fitting lock icon exists
- Regenerate if adding an icon: `types/icons.d.ts`
- Modify: all `src/components/i18n/locales/*.json`
- Create if adding an icon: `test/unit/components/icons/icon-page-lock.test.ts`

**Interfaces:**
- Consumes: A1's `info` state and existing `openModalDialog(options): ModalDialogHandle` from `src/components/utils/modal-dialog.ts`.
- Produces: `tools.page.unresolved`, `tools.page.accessDialogTitle`, `tools.page.accessDialogBody`, and `tools.page.accessDialogClose` locale keys; denied pointer click and navigation-mode Enter open one accessible dialog and return no navigation.

- [ ] **Step 1: Write the failing tests.** With `resolve: () => ({ access: 'none' })` and spies for `open` and `href`, render the tool in `document.body`. Click its `[data-blok-testid="page-link"]` and call `onNavigationEnter(new KeyboardEvent('keydown', { key: 'Enter' }))`. Assert the navigation spies remain untouched; `getByRole('dialog')` has a localized accessible title and description; Escape or the close button restores focus. Assert missing `null` remains a distinct “Page not found” state and opens no denied-access dialog. Assert the denied icon is a lock, not the old cached icon.

```ts
const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
expect(open).not.toHaveBeenCalled();
expect(href).not.toHaveBeenCalled();
expect(dialog?.getAttribute('aria-modal')).toBe('true');
expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
expect(root.textContent).not.toContain('Private plan');
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/tools/page/page-access-dialog.test.ts`. Expected: clicking a disabled denied page opens no dialog and Enter returns `false`.

- [ ] **Step 3: Implement the minimal UI.** Use `openModalDialog` rather than a new focus trap. Reuse the dark/light-stable dialog surface and button tokens from `src/components/utils/notifier/draw.ts` (`CSS.notification`, `CSS.dialog`, `CSS.btn`, `CSS.okBtn`) and the body-mounted `data-blok-interface` pattern in `src/components/utils/leave-banner.ts:47-98`; cap the panel at the mobile viewport width and give it readable padding. Build the title, explanation and close button with `textContent` and the four locale keys; use `labelledBy`/`describedBy`, initial focus on close, `onDismiss` closing the handle, and clean up on `removed()/destroy()`. Route both click and Enter through the same denied-state method; keep missing and unresolved non-navigable. Reuse a fitting lock icon if one exists at implementation time. If none exists, add one 20×20 currentColor icon per `src/components/icons/README.md`, copy its static SVG into `src/shared/tool-classes/page.ts` for the pure view renderer, pin the drawing relationship to the editor icon, add it to `iconGroups`, then run `node scripts/generate-icons-dts.mjs`.

```ts
if (this.state === 'no-access') {
  this.showNoAccessDialog();
  return true;
}
if (!this.isNavigable) return false;
```

- [ ] **Step 4: Verify green.** Run the new dialog test, the new icon test if needed, `test/unit/components/icons/icon-page-glyph.test.ts`, and the existing page tool test separately. Run locale validation and ESLint only on files changed by this task. Check the dialog with keyboard focus and Escape in a focused browser test, not only jsdom.

- [ ] **Step 5: Review checkpoint.** Confirm denied/missing/unresolved have no `href`, `open` call, or hover preview. Confirm the lock is visible for denial, the explanation is localized and accessible, and a merely read-only but allowed page still navigates.

### Task A3: Remove cache from copy, duplicate, Markdown, plain text and translation outputs

**Files:**
- Create: `test/unit/tools/page/page-safe-outputs.test.ts`
- Modify: `test/unit/tools/page/page-clipboard.integration.test.ts`
- Modify: `src/tools/page/index.ts`
- Modify: `src/markdown/blocks-to-markdown-core.ts`
- Modify: `src/view/blocks-to-plain-text.ts`
- Modify: `src/view/document-texts.ts`
- Modify: `src/components/modules/drag/DragController.ts`
- Update affected expectations: `test/unit/view/blocks-to-plain-text.test.ts`, `test/unit/view/blocks-to-markdown.test.ts`, `test/unit/view/document-texts.test.ts`

**Interfaces:**
- Consumes: A1's `PageTool.save()` and existing `BlockToolAdapter.copyAsLink` distinction: `undefined` means no hook, `null` means hook exists but has no URL.
- Produces: safe neutral “Page” text in synchronous conversion paths without host metadata; copy/paste and Alt-drag never produce another owning `page` block, even with no `href`.

- [ ] **Step 1: Write the failing tests.** In the new file, give all outputs a page with `cache.title = 'Private plan'` and `cache.icon.value = '🔐'`. Assert `PageTool.copyAsLink` with a safe `href` has neutral text; `conversionConfig.export`, `blocksToPlainText`, `blocksToMarkdown`, and `extractTexts` do not include either cache field. In the existing real-editor clipboard integration, add a no-`href` case: copy the page, paste twice, and assert the document still has exactly one `type: 'page'` block and no Blok clipboard payload retains `cache`. Add an Alt-drag duplicate test through `DragOperations`/`DragController` that asserts the same owner count.

```ts
const source = { pageId: 'p1', cache: { title: 'Private plan' } };
expect(blocksToPlainText({ time: 1, blocks: [
  { id: 'b1', type: 'page', data: source },
] })).not.toContain('Private plan');
expect(blocksToMarkdown({ time: 1, blocks: [
  { id: 'b1', type: 'page', data: source },
] })).not.toContain('Private plan');
expect(extractTexts({ time: 1, blocks: [
  { id: 'b1', type: 'page', data: source },
] })).not.toContain('Private plan');
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/tools/page/page-safe-outputs.test.ts`, then only the new no-`href` clipboard and duplicate cases. Expected: current conversion and text readers emit the cached title; duplicate currently clones the owner when `copyAsLink` returns `null`.

- [ ] **Step 3: Implement safe fallbacks.** Make `PageTool.copyAsLink` return `{ url, text: 'Page' }` when `href` is safe and `null` otherwise; make its conversion export return `'Page'`. In the shared Markdown core's `case 'page'`, output `Page` rather than `data.cache.title`, preserving its degradation warning. In `blocks-to-plain-text.ts`, return neutral `Page` for a real page pointer instead of its cache title; in `document-texts.ts`, remove the cache-title slot. Retain the `isPagePointer` guard so a consumer's foreign `type: 'page'` tool is not reclassified. In `DragController`, distinguish a tool that implements `copyAsLink` but returns `null` from a tool with no hook; convert that block to the default tool's neutral exported text instead of cloning it. Do not invent a fallback URL or infer page identity from URLs.

```ts
const link = tool?.copyAsLink(data);
if (link !== undefined && link !== null) return linkToBlock(link, defaultTool);
if (link === null && tool !== undefined) {
  const exported = convertBlockDataToString(data, tool.conversionConfig);
  const text = typeof exported === 'string' ? exported : '';
  return { tool: defaultTool.name,
    data: convertStringToBlockData(text, defaultTool.conversionConfig, defaultTool.settings) };
}
return null;
```

- [ ] **Step 4: Verify green.** Run the new safe-output file, the new clipboard case, the duplicate test, Markdown parity, page-type compatibility, and changed-reader files individually. Run ESLint only on changed source/tests. Update old assertions that explicitly expected cached title output; keep their non-page coverage.

- [ ] **Step 5: Review checkpoint.** The raw Blok MIME flavor, HTML flavor, Markdown/plain text, copy-as-link, paste and drag must not serialize an untrusted cache. With no `href`, copy may become neutral text or be omitted, but it must never create a second owner. A true cut may recreate the original owner once only when no live owner remains.

### Task A4: Resolve static page cards from explicit host metadata

**Files:**
- Create: `test/unit/view/page-metadata.test.ts`
- Modify: `src/view/blocks-to-html.ts`
- Modify: `src/view/emitters.ts`
- Modify: `src/view/blocks-to-plain-text.ts`
- Modify: `src/view/blocks-to-markdown.ts` and `src/markdown/blocks-to-markdown-core.ts` only to thread the same `pageInfo` option into Markdown
- Modify: `types/view.d.ts`
- Update affected expectations: `test/unit/view/blocks-to-html.test.ts` and `test/unit/view/blocks-to-markdown.test.ts`

**Interfaces:**
- Consumes: published `PageInfo` from `types/tools/page.d.ts`; existing `pageHref(pageId)` and URL sanitizer.
- Produces: one optional synchronous `pageInfo?: (pageId: string) => PageInfo | null | undefined` in static view options; `blocksToHtml`, `blocksToPlainText` and `blocksToMarkdown` read host metadata only. `null` is missing, `undefined` is neutral “Page”, `access: 'none'` is a non-link lock plus “No access”.

- [ ] **Step 1: Write the failing tests.** Assert legacy cache is invisible when `pageInfo` is absent or returns `undefined`, and `pageHref` is not called for either unresolved case. With `pageInfo: () => ({ title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } })`, assert escaped title and icon appear. With denial, assert “No access”, lock SVG and no anchor; `pageHref` must not be called. With `null`, assert “Page not found” and no link. Keep the existing unsafe-scheme and `transformUrl` tests. Add matching plain-text/Markdown assertions and a bare-Node import of `@bloklabs/core/view` without DOM globals.

```ts
const html = blocksToHtml(documentWithLegacyCache, {
  pageInfo: () => ({ access: 'none' }),
  pageHref: vi.fn(() => '/p/p1'),
});
expect(html).not.toContain('Private plan');
expect(html).not.toContain('href=');
expect(html).toContain('No access');
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/view/page-metadata.test.ts`. Expected: current HTML and text exporters render `data.cache` and have no `pageInfo` option.

- [ ] **Step 3: Implement the one resolver option.** Extend `BlocksToHtmlOptions` with `pageInfo` and mirror the declaration in `types/view.d.ts` by importing `PageInfo` from `./tools/page`, not from `src`. Pass resolved metadata to `emitPage` through `EmitterEnv` or a small per-page callback. Use only the callback result, never `block.data.cache`. Call `pageHref` only after `pageInfo` returns a non-null object without `access: 'none'`; absent metadata is neutral and non-link. Keep `env.url('href', ..., 'page')` for transform and unsafe-scheme checks, and `env.url('src', ..., 'page')` for image icons. Use a copied pure lock glyph from `src/shared/tool-classes/page.ts`. For plain text, read `options.pageInfo` in its existing `ownText` closure. For Markdown, add `options?: Pick<BlocksToHtmlOptions, 'pageInfo'>` to both view functions and pass that callback as an optional third argument through `serializeBlocksToMarkdown`; the editor's two-argument call keeps the neutral `Page` fallback. Use the same `pageInfo` name and state labels; do not create separate metadata callbacks. Mirror both view function signatures in `types/view.d.ts`.

```ts
export interface BlocksToHtmlOptions {
  pageInfo?: (pageId: string) => PageInfo | null | undefined;
  pageHref?: (pageId: string) => string;
}
const info = env.pageInfo(block.data.pageId);
const allowed = info !== null && info !== undefined && info.access !== 'none';
const href = allowed ? env.pageHrefAttr(block.data.pageId) : '';
```

- [ ] **Step 4: Verify green.** Run the new file, existing HTML/Markdown/plain-text page cases, `test/unit/view/index.purity.test.ts`, `test/unit/architecture/published-types-no-src-refs.test.ts`, and `test/unit/view/page-type-compat.test.ts`. Run changed-file ESLint. Update exact old cache-based snapshots only where the new contract requires it.

- [ ] **Step 5: Review checkpoint.** A static export with only legacy cache is neutral, allowed host metadata is escaped and URL-gated, denied/missing pages are non-links, and malformed foreign `type: 'page'` blocks still follow unknown-tool handling. Static HTML does not promise an event-loop dialog; the host handles that UI.

### Task A5: Demonstrate canonical title writes and enforce the host migration gate

**Files:**
- Create: `test/unit/playground/page-host-notifications.test.ts`
- Modify: `src/playground/page-host.ts`
- Modify: `index.html` only at its existing page-host wiring
- Create: `docs/maintainers/page-host-integration.md`
- Create: `test/playwright/tests/tools/page-host-sync.spec.ts` for two tabs of the playground demo; the separate real-host gate below cannot be replaced by this test

**Interfaces:**
- Consumes: `PageRegistry.subscribe(pageId, notify)`, `PageRegistry.setTitle(pageId, title)`, `PageRegistry.setIcon(pageId, icon)`, and `history.track('title', onChange)`. The latter calls `onChange` for Undo, Redo, and remote edits, but its value is absent from `save()` (`types/api/history.d.ts:34-82`).
- Produces: same-tab notification in the playground demo; a copyable host recipe whose canonical title record owns accepted value/version, optimistic display, failure rollback, and fan-out notifications. No new Blok title database.

- [ ] **Step 1: Write the failing notification test.** Subscribe to a page, call `setTitle` and `setIcon`, and assert one notification per changed metadata update in the same tab; unchanged values need no notification. Call `reload` after changing storage in another tab simulation and assert the existing remote notification path remains. Add a test for a title revert through the tracked-value callback: the registry reports the reverted title to the pointer subscriber and tree/header redraw hook.

```ts
const notify = vi.fn();
const stop = pages.subscribe('p1', notify);
pages.setTitle('p1', 'Renamed');
expect(notify).toHaveBeenCalledTimes(1);
pages.setTitle('p1', 'Renamed');
expect(notify).toHaveBeenCalledTimes(1);
stop();
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/playground/page-host-notifications.test.ts`. Expected: `PageRegistry.edit` persists but does not call subscribers in the same tab (`src/playground/page-host.ts:347-355`).

- [ ] **Step 3: Fix only demo notification.** Reuse `reload`'s before/after `info` comparison for all subscribed IDs in `edit` and `editRoot`, so a renamed ancestor also refreshes descendant preview paths. Do not notify on block-body-only `setBlocks`. Keep `reload`'s cross-tab comparison. Remove `pointerBlock`'s `cache` write and stop `findPageLink`/`buildPageTree` from reading pointer caches in the playground, using registry records or neutral labels only.

```ts
const before = new Map([...this.listeners.keys()].map((id) => [id, JSON.stringify(this.info(id))]));
this.pages[pageId] = change(page);
this.persist();
before.forEach((old, id) => {
  if (JSON.stringify(this.info(id)) !== old) {
    this.listeners.get(id)?.forEach((listener) => listener());
  }
});
```

- [ ] **Step 4: Write the two-tab demo test and host recipe.** The new Playwright spec opens two tabs in one browser context on `/editor/page/getting-started`, renames the `Page title` textbox in tab A, observes tab B's header update, then invokes Undo in tab A and observes the restored title in both tabs. Use role/test-id locators and auto-waiting, not CSS classes or fixed sleeps. For example:

```ts
const other = await context.newPage();
await page.goto('/editor/page/getting-started');
await other.goto('/editor/page/getting-started');
const titleA = page.getByRole('textbox', { name: 'Page title' });
const titleB = other.getByRole('textbox', { name: 'Page title' });
await titleA.fill('Renamed in tab A');
await expect(titleB).toHaveText('Renamed in tab A');
await titleA.press('ControlOrMeta+z');
await expect(titleB).toHaveText('Getting started');
```

In `docs/maintainers/page-host-integration.md` show a host-owned record `{ pageId, title, icon, version }`, a stable title-free `href(pageId)`, per-user access-filtered `resolve`, and a `subscribe` fan-out that delivers on local write, server event, Undo/Redo and access change. Its write sequence is: paint locally and notify; `PUT` the next title with the accepted version; on success adopt the returned title/version and notify; on rejection restore the last accepted title, notify, and show an error. A later user edit must not be overwritten by an older rejected response; guard save responses by a local request counter or an equivalent version token. The title mirror from `history.track('title')` must call the same canonical write path on Undo/Redo and remote changes, but bootstrap from the host record; never treat Yjs `track` as durable storage. Include an executable example of that sequence:

```ts
import type { History } from '@bloklabs/core';
type TitleRecord = { title: string; version: number };
type TitleHost = {
  loadPage(id: string): Promise<TitleRecord>;
  saveTitle(id: string, title: string, expectedVersion: number): Promise<TitleRecord>;
  subscribe(id: string, notify: () => void): () => void;
};
async function wireTitle(
  pageId: string, host: TitleHost, history: History,
  paint: (title: string) => void, notify: (id: string) => void,
  showError: () => void
): Promise<{ input: (title: string, typing: boolean) => void; stop: () => void }> {
  let accepted = await host.loadPage(pageId);
  let latest = 0;
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();
  const tracked = history.track<string>('title', (value, { source }) => {
    if (source === 'remote') { paint(value ?? ''); notify(pageId); return; }
    if (source === 'undo' || source === 'redo') changeTitle(value ?? '');
  });
  function changeTitle(next: string): void {
    const ticket = ++latest;
    pending += 1;
    paint(next);
    notify(pageId);
    queue = queue.then(async () => {
      try {
        const saved = await host.saveTitle(pageId, next, accepted.version);
        if (saved.version >= accepted.version) accepted = saved;
        if (ticket === latest) { paint(accepted.title); notify(pageId); }
      } catch {
        if (ticket === latest) {
          paint(accepted.title);
          tracked.set(accepted.title, { record: false });
          notify(pageId);
          showError();
        }
      } finally { pending -= 1; }
    });
  }
  tracked.set(accepted.title, { record: false });
  const stop = host.subscribe(pageId, () => {
    void host.loadPage(pageId).then((record) => {
      if (record.version <= accepted.version) return;
      accepted = record;
      if (pending === 0) { paint(record.title); notify(pageId); }
    });
  });
  return { input: (title, typing) => { tracked.set(title, { typing }); changeTitle(title); }, stop };
}
```

The recipe must state that a production host still needs conflict-resolution policy and durable record writes; the playground's `localStorage` registry is a demo, not that host. Add a gate checklist for stripping `data.cache` from authoritative parent documents, active rooms, journals and checkpoints, rejecting old-client reintroduction, and checking both old and new records under an unauthorized identity. A consumer GET-only filter is insufficient. Slice D supplies broader ACL recheck/purge, not a substitute for this pre-serve migration.

- [ ] **Step 5: Verify integration and checkpoint.** Run the new notification file, `test/unit/playground/page-host.test.ts`, the new two-tab browser spec, and changed-file ESLint. In an actual consuming host, use user A allowed and user B denied with two tabs: rename, Undo, denied access, stale delayed resolve, rejected save, reload, and a second device; inspect DOM, clipboard, network parent JSON and persisted parent snapshot for restricted cache bytes. Record the host/test command and results in the implementation handoff. If no real host is available, leave security acceptance explicitly blocked; do not substitute the playground or a mock for it.

---