# Page Links and Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ID-backed, non-owning page links and inline mentions with an accessible in-editor picker, safe render/copy/paste round-trips, and faithful Notion page-reference import.

**Architecture:** The existing `page` block remains the sole owning pointer. A new `page-link` block saves only `pageId`; inline references save an `a[data-blok-page-id]` mark with a neutral label and no saved URL or metadata. Live labels and destinations come from the host's page hooks, while DOM-free output uses slice A's synchronous `pageInfo` and `pageHref` callbacks. A single editor-owned picker uses the host's async search only for `@` and `[[` insertion; the host continues to own global search and navigation.

**Tech Stack:** TypeScript, Vitest/jsdom, Playwright E2E, parse5 view renderer, html-janitor editor/paste sanitizer, existing Blok popover and i18n.

**Spec:** `docs/superpowers/specs/2026-10-04-headless-page-platform-design.md`, especially lines 17–25, 47–51, 75–92. The independent slice D plan is `docs/superpowers/plans/2026-10-04-pages-access-lifecycle.md`.

## Global Constraints

- Finish slice A's ID-only page pointer, access-safe `resolve/subscribe`, and `BlocksToHtmlOptions.pageInfo?: (pageId: string) => PageInfo | null | undefined` before C's view work. Reuse that one metadata hook; do not add a second static resolver.
- `page` means owner. `page-link` and `a data-blok-page-id` mean reference. Never infer a page ID from a URL or treat a reference as a tree edge.
- The saved non-owning formats are exactly `{ type: 'page-link', data: { pageId: string } }` and `<a data-blok-page-id="p1">Page</a>`. Neither saves `href`, title, icon, cache or access verdict. A host-derived URL may not encode a restricted title.
- The host's search callback must return only pages the current user may see. The editor also filters a returned `{ access: 'none' }` before adding any DOM or accessible-name text, and rechecks access before insertion.
- Slice B's `pageIndex(data)` must count both formats as non-owning references and `page` alone as an owner. Rerun its reference tests after C; do not create a second index.
- The host owns page records, titles, URLs, grants, global quick-find, backlinks, and workspace UI. Do not add a `PageStore`, built-in workspace shell, or new package dependency.
- TDD per task: new regression test, observe RED with the single named test file, minimal code, observe GREEN, then refactor. Unit tests call `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`; no `any`, `@ts-ignore` or non-null assertions. E2E locators use roles or `data-blok-testid`, not CSS classes.
- While iterating, lint only changed files and run only the new test file per invocation. At the final gate, follow the project's then-current full-gate instruction, after checking that the shared dirty tree is not carrying another worker's failing changes.
- If adding `DATA_ATTR.pageId`, run `node scripts/generate-data-attributes-dts.mjs` and the published-type drift test. For new UI copy, use the `blok-translations` skill and run `node scripts/i18n/check-translations.mjs`. Read `docs/src/i18n/reference-prose.test.ts` before editing reference prose.
- Do not edit `package.json`, `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs` or `.env`. Preserve unrelated dirty files in the shared `main` checkout. Do not branch, worktree, stash, commit or push during this plan's execution unless the user separately asks.
- Latest tag observed while drafting: `v1.15.2`. `git log v1.15.2..HEAD -- src/tools/page/index.ts types/tools/page.d.ts` shows the page surface was added after that tag. Recheck the release boundary before labeling any eventual API change BREAKING.

## Review Focus

1. An old async search answer arrives after access is revoked: no restricted title reaches the picker DOM or screen reader, and Enter inserts nothing (Task 4).
2. A pasted anchor carries `data-blok-page-id` plus a stale or malicious `href` and title: the ID survives but URL/title do not become saved page metadata (Tasks 1 and 5).
3. A page reference is copied without a configured `href`: no second owning `page` block is created, and an inline reference keeps its ID (Tasks 2 and 5).
4. A Notion `link_to_page` payload omits or obscures its target: do not guess from the wrapper block ID or a URL; leave the unverified construct visibly degraded rather than pointing at the wrong page (Task 5).
5. A host renames a page while two references and a picker are mounted: only the newest allowed metadata paints, no undo entry appears, and both subscribers are released on destroy (Tasks 3 and 6).

---

## File map and interfaces

| Unit | Files | Responsibility |
| --- | --- | --- |
| Saved inline law | `src/shared/page-reference.ts`, `src/components/shared/inline-content-sanitize.ts`, `src/components/inline-tools/inline-tool-link.ts`, `src/components/modules/paste/index.ts` | One attribute name and one sanitizer rule across save, paste, conversion and view. |
| Non-owning block | `src/tools/page-link/index.ts`, `types/tools/page-link.d.ts`, `src/tools/index.ts`, `types/tools-entry.d.ts`, `src/view/document-schema.ts` | A link block with `pageId` only, no `create` and no ownership behavior. |
| Static readers | `src/view/emitters.ts`, `src/view/blocks-to-html.ts`, `src/view/blocks-to-plain-text.ts`, `src/markdown/blocks-to-markdown-core.ts` | Access-filtered HTML and safe degradation where ID links cannot be represented. |
| Live inline references | `src/components/modules/pageReferences.ts`, `src/components/modules/index.ts`, `src/types-internal/blok-modules.ts` | Resolve/subscribe rendered marks without writing derived title to saved data or history. |
| Picker and triggers | `src/tools/page/page-picker.ts`, `src/components/modules/blockEvents/composers/pageReferenceTrigger.ts`, `src/components/modules/blockEvents/index.ts`, `src/components/modules/uiControllers/controllers/keyboard.ts`, `src/tools/page/types.ts`, `types/tools/page.d.ts` | Async host search, caret replacement, keyboard and ARIA behavior. |
| Import and delivery | `src/components/modules/paste/notion-blocks-v3.ts`, `docs/src/components/tools/tools-data.ts`, `docs/src/i18n/en.json`, `docs/src/i18n/ru.json`, other editor locale JSON, `test/playwright/tests/tools/page.spec.ts` | Notion mapping, host recipe, real-editor checks. |

### Task 1: Canonical inline page-reference mark

**Files:**
- Create: `src/shared/page-reference.ts`
- Modify: `src/components/constants/data-attributes.ts`, `types/data-attributes.d.ts` (generated)
- Modify: `src/components/shared/inline-content-sanitize.ts`, `src/components/inline-tools/inline-tool-link.ts`, `src/components/modules/paste/index.ts`
- Test: `test/unit/components/shared/page-reference-mark.test.ts` (new), `test/unit/view/html-to-blocks.test.ts` (add one round-trip assertion)

**Interfaces:**
- Produces: `PAGE_REFERENCE_ATTR = 'data-blok-page-id'` and `PAGE_REFERENCE_FALLBACK = 'Page'` from the pure shared module.
- Produces: `preservePageReferenceAnchor(node: Element): TagConfig`. An anchor with a nonempty ID keeps that attribute, drops `href/target/rel`, and rewrites children to `Page`. An ordinary anchor retains the current link whitelist.
- Consumed by Tasks 3–5 and slice B's extractor. No public runtime helper is needed: insertion may create a DOM anchor and use `outerHTML`, and the DOM-free Notion parser already has attribute escaping.

- [ ] **Step 1: Write failing editor/view sanitizer tests.** In the new file use the real `clean` and `sanitizeHtmlFragment` paths, not a mocked sanitizer:

```ts
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('keeps an ID but never a derived title or URL', () => {
  const dirty = '<a data-blok-page-id="p1" href="javascript:alert(1)" title="Secret">Secret</a>';
  const expected = '<a data-blok-page-id="p1">Page</a>';

  expect(clean(dirty, INLINE_TEXT_SANITIZE)).toBe(expected);
  expect(sanitizeHtmlFragment(dirty, INLINE_TEXT_SANITIZE)).toBe(expected);
});

it('does not turn an ordinary URL mention into a page reference', () => {
  expect(clean('<a href="https://example.test">Site</a>', INLINE_TEXT_SANITIZE))
    .toBe('<a href="https://example.test">Site</a>');
});
```

Add an `htmlToBlocks` test importing `<p>See <a data-blok-page-id="p1">Page</a></p>` and expecting the attribute in `data.text`. Add a real `Paste.processText`/clipboard test with that HTML and the page tool registered but no Link inline tool; the mark must survive the first whole-document sanitizer and the block's save sanitizer. Pin the supported inline fields: paragraph, header, toggle, list and quote `text`, plus table-cell HTML (legacy inline string and child-block content). Their current sanitize paths spread `INLINE_TEXT_SANITIZE`; test each through save/paste. Do not claim quote or media captions until their own round-trips are proven.

- [ ] **Step 2: Run the new test file only.** `yarn test test/unit/components/shared/page-reference-mark.test.ts`. Expected RED: the current anchor whitelist strips `data-blok-page-id`.
- [ ] **Step 3: Implement the smallest shared rule.** Keep the existing ordinary-link behavior:

```ts
export const PAGE_REFERENCE_ATTR = 'data-blok-page-id';
export const PAGE_REFERENCE_FALLBACK = 'Page';

export const preservePageReferenceAnchor = (node: Element): TagConfig => {
  const pageId = node.getAttribute(PAGE_REFERENCE_ATTR);

  if (pageId !== null && pageId !== '') {
    node.textContent = PAGE_REFERENCE_FALLBACK;
    return { [PAGE_REFERENCE_ATTR]: true };
  }

  return { href: true, target: true, rel: true };
};
```

Use this rule for `INLINE_TEXT_SANITIZE.a`, `LinkInlineTool.sanitize.a` and the paste first-pass `a` entry. Keep page-reference attributes out of `pasteConfig.tags`: that map also substitutes a tag into a block, so whitelisting `A` there would turn unrelated pasted links into page blocks. Add `DATA_ATTR.pageId` and regenerate its published declaration.

- [ ] **Step 4: Run the new test, then the affected existing tests.** First `yarn test test/unit/components/shared/page-reference-mark.test.ts`; expected GREEN. Separately run `yarn test test/unit/view/html-to-blocks.test.ts` and `yarn test test/unit/components/shared/inline-content-sanitize.test.ts`. Run `yarn eslint` on the changed TS files only.
- [ ] **Step 5: Review checkpoint.** Confirm `git diff --check`; confirm save, paste, view and HTML import all use the same attribute and no unauthorized display text survives a save.

### Task 2: Non-owning `page-link` block and static output

**Files:**
- Create: `src/tools/page-link/index.ts`, `types/tools/page-link.d.ts`
- Modify: `src/tools/index.ts`, `types/tools-entry.d.ts`, `src/view/document-schema.ts`, `src/view/emitters.ts`, `src/view/blocks-to-html.ts`, `src/view/blocks-to-plain-text.ts`, `src/markdown/blocks-to-markdown-core.ts`
- Test: `test/unit/tools/page-link/page-link.test.ts` (new), `test/unit/view/page-links.test.ts` (new), `test/unit/view/document-schema.test.ts`, `test/unit/markdown/blocks-to-markdown.parity.test.ts`
- Follow-up test: slice B's `pageIndex` reference test once that extractor is present.

**Interfaces:**
- Produces: `export interface PageLinkData extends BlockToolData { pageId: string }`; `export declare class PageLink implements BlockTool`; export `PageLink` from `@bloklabs/core/tools` and add `'page-link': PageLinkData` to `BlokBlockDataMap`.
- Consumes: existing `PageConfig.resolve(pageId)`, `subscribe(pageId, notify)`, `href(pageId)`, `open(pageId, ctx)`. It never calls `PageConfig.create`. No `copyAsLink` hook: duplicating a non-owner stays a non-owner.
- Consumes: slice A's static `pageInfo` and `pageHref`. A denied or missing result is never an active link.

- [ ] **Step 1: Write failing block and pure view tests.**

```ts
it('saves only the non-owning target ID', async () => {
  const create = vi.fn();
  const link = new PageLink(createOptions({
    data: { pageId: 'p1' },
    config: { create, resolve: () => ({ title: 'Roadmap' }) },
  }));

  link.render();
  link.rendered();
  await flush();

  expect(link.save()).toEqual({ pageId: 'p1' });
  expect(create).not.toHaveBeenCalled();
});

it('renders access-filtered HTML without making an owner', () => {
  const doc = { blocks: [{ id: 'r1', type: 'page-link', data: { pageId: 'p1' } }] };
  const html = blocksToHtml(doc, {
    pageInfo: () => ({ access: 'none' }),
    pageHref: () => '/pages/secret-title',
  });

  expect(html).toContain('No access');
  expect(html).not.toContain('href=');
  expect(html).not.toContain('secret-title');
});
```

Add a `pageIndex(doc)` assertion that `owners` is empty and `references` includes `p1`, using B's published result fields once B lands. Add a schema assertion that `page-link` requires a nonempty `pageId` and disallows saved `cache/title/href`.

- [ ] **Step 2: Run each new test file alone.** `yarn test test/unit/tools/page-link/page-link.test.ts` and then `yarn test test/unit/view/page-links.test.ts`. Expected RED: the tool/export and view emitter do not exist.
- [ ] **Step 3: Implement the block and reader branches.** The runtime tool uses the same safe resolve/subscribe ordering as slice A, but cannot mint or own a page:

```ts
public save(): PageLinkData {
  return { pageId: this.data.pageId };
}

public validate(data: PageLinkData): boolean {
  return typeof data.pageId === 'string' && data.pageId !== '';
}

public static get acceptsChildren(): boolean {
  return false;
}
```

Do not add `page-link` to `defaultBlockTools`: the host must register it with its page config and insert a selected ID. Static HTML uses `pageInfo` for allowed title/icon or the neutral/locked state, and `pageHref` only after allowed metadata. Plain text must use allowed title or neutral `Page`/`No access`, never a saved cache. Markdown has no ID-backed page-reference syntax; emit neutral visible text with a degradation warning rather than silently dropping the block or inventing a URL. Add the self-contained public declaration and document-schema branch.

- [ ] **Step 4: Run affected tests.** Run the two new files separately to GREEN, then `yarn test test/unit/view/document-schema.test.ts`, `yarn test test/unit/view/blocks-to-html.test.ts` and `yarn test test/unit/markdown/blocks-to-markdown.parity.test.ts` separately. Run changed-file ESLint and `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`.
- [ ] **Step 5: Review checkpoint.** Confirm a `page-link` copy/duplicate remains `page-link` with the same ID, while only an explicit `page` insertion can add an owning edge. Check `git diff --check`.

### Task 3: Live inline labels without saved metadata

**Files:**
- Create: `src/components/modules/pageReferences.ts`
- Modify: `src/components/modules/index.ts`, `src/types-internal/blok-modules.ts`
- Test: `test/unit/components/modules/pageReferences.test.ts` (new), `test/playwright/tests/tools/page.spec.ts` (later integration cases)

**Interfaces:**
- Consumes the page tool's configured `PageConfig.resolve`, `subscribe`, `href` and `open`. If no page tool or no resolver is configured, keep the neutral saved `Page` mark. An allowed mark remains keyboard/click navigable through `open(pageId, { event })` even when `href` is absent; a denied mark never invokes `open` or browser navigation.
- Produces no new public API. One mounted ID may have several anchors; each uses the newest resolve result. Cleanup unsubscribes when anchors disappear and on editor destroy.

- [ ] **Step 1: Write a failing editor-level test using real `Blok` construction.**

```ts
it('updates two inline references on same-tab notify without an undoable edit', async () => {
  const notify = { current: () => undefined };
  const resolve = vi.fn(() => ({ title: 'Before' }));
  const editor = createEditor({
    text: '<a data-blok-page-id="p1">Page</a> + <a data-blok-page-id="p1">Page</a>',
    page: { resolve, subscribe: (_id, next) => { notify.current = next; } },
  });
  await editor.isReady;

  resolve.mockReturnValue({ title: 'After' });
  notify.current();

  await waitFor(() => expect(editorRoot.querySelectorAll('[data-blok-page-id="p1"]')[0].textContent)
    .toBe('After'));
  expect((await editor.save()).blocks[0].data.text)
    .toBe('<a data-blok-page-id="p1">Page</a> + <a data-blok-page-id="p1">Page</a>');
});
```

Use the editor harness conventions in `test/unit/blok.test.ts`, not the schematic `createEditor` above verbatim. Add tests for a newer denial beating an older allowed promise, for removed anchors releasing subscriptions, and for destruction cleaning observers. The first assertion in the denial test must be no restricted title in DOM. Add click and navigation-mode Enter tests: with `open` configured and no `href`, an allowed reference calls `open` once with `pageId`; after a same-tab access revocation, the same actions call it zero times and do not navigate. Use public editor Undo plus the collaboration test harness to assert that a rename-only DOM repaint creates no undo step and does not enter the Yjs document/update before `save`; a sanitized `save` assertion alone does not prove this.

- [ ] **Step 2: Run the new test file alone.** `yarn test test/unit/components/modules/pageReferences.test.ts`. Expected RED: loaded anchors remain neutral and never subscribe.
- [ ] **Step 3: Add the small module.** Register it in `Modules` and the internal module type. Discover marks under this editor's wrapper on initial render and child changes. Mark derived anchors `data-blok-mutation-free` and `contenteditable="false"` at runtime; the shared sanitizer strips both and restores the neutral `Page` label on save. Cache one subscription and a request counter per page ID:

```ts
const request = ++entry.request;
const info = await Promise.resolve(resolve(pageId));

if (this.isDestroyed || request !== entry.request) return;
for (const anchor of entry.anchors) {
  anchor.textContent = info?.access === 'none' ? noAccessLabel
    : info?.title || fallbackLabel;
}
```

A denial removes any derived `href` and cached icon. Allowed URLs come only from `PageConfig.href` through `safeHref`. Handle click and navigation-mode Enter at the editor wrapper: recheck current access at activation, call `PageConfig.open(pageId, { event })` for allowed references even with no `href`, otherwise use only a safe derived `href`; never navigate on a denied, missing or unresolved reference. Avoid a broad document observer: observe only the editor wrapper, and disconnect it on destroy. Derived text must be mutation-free for both the editor history path and Yjs observer path, not merely stripped on `save`.

- [ ] **Step 4: Run the new file to GREEN and related mutation tests.** Run `yarn test test/unit/components/modules/pageReferences.test.ts`, then `yarn test test/unit/components/block/mutation-handler.test.ts`. Run changed-file ESLint.
- [ ] **Step 5: Review checkpoint.** Confirm reload, same-tab notification, denied access, removal and destroy do not leave metadata or subscriptions behind; an allowed no-`href` mark invokes `open`, and a revoked mark does not. Confirm no repaint appears in Yjs, Undo or saved data; check `git diff --check`.

### Task 4: Host search callback and accessible `@` / `[[` picker

**Files:**
- Modify: `src/tools/page/types.ts`, `types/tools/page.d.ts`
- Create: `src/tools/page/page-picker.ts`, `src/components/modules/blockEvents/composers/pageReferenceTrigger.ts`
- Modify: `src/components/modules/blockEvents/index.ts`, `src/components/modules/uiControllers/controllers/keyboard.ts`
- Modify: `src/components/i18n/locales/*.json`, `types/message-keys.d.ts` (generated)
- Test: `test/unit/components/modules/blockEvents/composers/pageReferenceTrigger.test.ts` (new), `test/unit/tools/page/page-picker.test.ts` (new), `test/playwright/tests/tools/page.spec.ts` (later)

**Interfaces:**
- Produces: `PageSearchResult = { pageId: string; title?: string; icon?: PageIcon; access?: 'none' }` and `PageConfig.search?(query: string): Promise<readonly PageSearchResult[]>`. The host filters by access; the editor rejects malformed, inaccessible and stale results before display or commit.
- Internal picker: `open(query, anchor, onPick)`, `setResults(results)`, `handleKeydown(event): boolean`, `close()`. It uses an existing `PopoverDesktop` with a custom HTML item for positioning/stacking, not a new global overlay system.
- Consumes Task 1's canonical mark and Task 3's live decoration.

- [ ] **Step 1: Write failing trigger and picker tests.**

```ts
it.each(['See @road', 'See [[road'])('commits one ID-backed mark from %s', async (text) => {
  const { trigger, block, search, setCaret } = setup(text);
  setCaret(text.length);
  search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);

  await trigger.handleInput(new InputEvent('input', { inputType: 'insertText', data: 'd' }));
  trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  expect(block.currentInput?.innerHTML).toContain('data-blok-page-id="p1"');
  expect(block.currentInput?.textContent).not.toContain('[[road');
});

it('never paints or commits an inaccessible or stale result', async () => {
  const { trigger, search, input } = setup('See @road');
  search.mockResolvedValue([{ pageId: 'p1', title: 'Secret', access: 'none' }]);

  await trigger.handleInput(new InputEvent('input', { inputType: 'insertText', data: 'd' }));

  expect(input.ownerDocument.body.textContent).not.toContain('Secret');
  expect(trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
});
```

Add picker tests for `role="listbox"`, option accessible names, `aria-activedescendant` pointing to the actual highlighted option, arrow navigation, Escape closing only this layer, pointer selection, Tab leaving focus, IME composition ignored, and an email such as `a@b.test` not opening the picker. Use `vi.clearAllMocks`/`vi.restoreAllMocks` in both files.

- [ ] **Step 2: Run each new test file alone.** `yarn test test/unit/components/modules/blockEvents/composers/pageReferenceTrigger.test.ts` and `yarn test test/unit/tools/page/page-picker.test.ts`. Expected RED: no search hook or trigger.
- [ ] **Step 3: Implement query and commit.** Read the existing `EmojiTrigger` keydown/input ordering before wiring: the page picker must claim its keys before block navigation, but only while open. Scan the current text-like block and collapsed caret for a boundary-valid `@` or `[[` span; do not run in native inputs, code blocks, read-only mode or during composition. Bump a request token on every query and close. Filter before DOM creation:

```ts
const token = ++this.searchToken;
const hits = await search(query);
if (token !== this.searchToken || !this.opened) return;
this.picker.setResults(hits.filter((hit) =>
  typeof hit.pageId === 'string' && hit.pageId !== '' && hit.access !== 'none'
));
```

Before replacing the trigger span, call `resolve(pageId)` again when available and reject `null` or `{ access: 'none' }`. Create the anchor with `document.createElement('a')` and `setAttribute(PAGE_REFERENCE_ATTR, pageId)`; set its text to `Page` and replace exactly the typed trigger/query range in one undo group. Keep the normal URL mention path in `src/tools/link/mention/mention.ts` separate and unchanged. When no `PageConfig.search` exists, `@` and `[[` remain literal text.

- [ ] **Step 4: Run the new tests to GREEN.** Run both new files separately, then `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts` and `yarn test test/unit/components/modules/blockEvents/native-input-guard.test.ts` separately. Run changed-file ESLint; generate message-key declarations and run the all-locale translation checker.
- [ ] **Step 5: Review checkpoint.** Confirm no blue selected row, only a neutral current-option surface; focus ring appears for keyboard modality only. Confirm picker and editor keyboard handlers release on destroy; check `git diff --check`.

### Task 5: Notion blocks and clipboard references

**Files:**
- Modify: `src/components/modules/paste/notion-blocks-v3.ts`
- Create: `test/fixtures/notion/link-to-page.blocks-v3.json` (a captured, redacted real clipboard payload; do not invent its undocumented target field)
- Modify: `test/unit/components/modules/paste/notion-blocks-v3.test.ts`, `test/unit/components/modules/paste/notion-preprocessor.test.ts` only if the HTML flavor needs normalization
- Test: `test/unit/components/modules/paste/page-reference-paste.test.ts` (new), `test/playwright/tests/tools/page.spec.ts` (later)

**Interfaces:**
- `page` in Notion's record map becomes owning `{ tool: 'page', data: { pageId: value.id } }`. Its body is still a separate document.
- A verified `link_to_page` target becomes non-owning `{ tool: 'page-link', data: { pageId: targetId } }`. A Notion rich-text `p` flag becomes the canonical inline anchor from Task 1. Neither is a bookmark or an ordinary URL mention.
- The `link_to_page` target field is not evidenced by the current repository. The current `test/fixtures/notion/README.md` documents how to capture the proprietary `text/_notion-blocks-v3-production` clipboard flavor from a live Notion page. Use that method after adding a link-to-page block to an edit-enabled page. Do not use `value.id` or a parsed Notion URL as a guessed target. If capture fails or lacks an identifiable target, stop this mapping, report the missing evidence, and do not claim slice C acceptance; never leave a permanently red test in a delivered change.

- [ ] **Step 1: Capture the target shape and write failing tests.** Follow `test/fixtures/notion/README.md` steps 18–29: in Notion's block-selection mode, copy an edit-enabled page containing a link-to-page block, capture `text/_notion-blocks-v3-production` with a paste listener, and isolate the block plus its referenced record-map entries. Keep the fixture in `test/fixtures/notion/` with title/user data redacted but target-bearing structure intact. If the target cannot be verified, stop with an evidence request instead of fabricating the test. Once verified, add:

```ts
it('maps a Notion subpage as an owning page pointer', () => {
  const out = parseNotionBlocksV3(v3(value('child-id', 'page', { properties: title(['Child']) })));
  expect(out?.[0]).toEqual({ id: 'child-id', tool: 'page', data: { pageId: 'child-id' } });
});

it('maps a captured link-to-page to a non-owning target', () => {
  const out = parseNotionBlocksV3(readFileSync(linkToPageFixture, 'utf8'));
  expect(out).toContainEqual({
    id: 'link-block-id', tool: 'page-link', data: { pageId: 'target-page-id' },
  });
});

it('keeps a Notion inline page ID, not a title or Notion URL', () => {
  const out = parseNotionBlocksV3(v3(value('a', 'text', {
    properties: title(['see '], ['‣', [['p', 'target-page-id']]]),
  })));
  expect(out?.[0].data.text).toBe('see <a data-blok-page-id="target-page-id">Page</a>');
});
```

Replace the old tests at `notion-blocks-v3.test.ts:417–500,1099–1107` that assert bookmark/drop behavior. In the new paste test, pass an HTML anchor with `data-blok-page-id` through the real `Paste` sanitizer and save path; assert the ID persists, no stale href/title survives, and a copied owning page with no configured href never pastes as a second owner.

- [ ] **Step 2: Run the new paste file and changed Notion test alone.** `yarn test test/unit/components/modules/paste/page-reference-paste.test.ts`, then `yarn test test/unit/components/modules/paste/notion-blocks-v3.test.ts`. Expected RED: bookmarks/drops and stripped attributes.
- [ ] **Step 3: Implement only verified mappings.** Use the observed target field from the captured fixture in a narrow `readLinkToPageTarget(value: NotionValue): string | null` reader; return `null` rather than another block's ID if absent. Reuse `escapeAttr` and `PAGE_REFERENCE_ATTR` for the inline `p` flag, with `Page` as neutral text. Keep unrelated Notion bookmarks and ordinary URL anchors unchanged.
- [ ] **Step 4: Run both files to GREEN and the relevant paste law.** Separately run `yarn test test/unit/components/modules/paste/page-reference-paste.test.ts`, `yarn test test/unit/components/modules/paste/notion-blocks-v3.test.ts` and `yarn test test/unit/architecture/paste-attribute-law.test.ts`; run changed-file ESLint. A missing real target fixture blocks this step; no inferred mapping or knowingly red suite is acceptable.
- [ ] **Step 5: Review checkpoint.** Inspect the actual fixture/target field, serialized output, clipboard MIME/HTML and the browser paste path; confirm no owner duplication or URL-to-ID inference. Check `git diff --check`.

### Task 6: Host recipe, two-tab behavior and C acceptance

**Files:**
- Modify: `docs/src/components/tools/tools-data.ts`, `docs/src/i18n/en.json`, `docs/src/i18n/ru.json`
- Modify: `test/playwright/tests/tools/page.spec.ts`
- Test: `docs/src/components/tools/tools-data.test.ts`, `docs/src/i18n/reference-prose.test.ts`

**Interfaces:**
- Document registration of both tools with the same host `PageConfig`, `search(query)` returning only accessible pages, same-tab `subscribe` notification, and `blocksToHtml(data, { pageInfo, pageHref })`. The host owns all global search/backlink/UI screens.
- No new runtime interface.

- [ ] **Step 1: Add a failing browser test.** In the existing page E2E helper, open a page with two editors/tabs sharing a host metadata registry. Type `[[road`, select the accessible result by role, rename in the other tab, then assert both inline and block link labels update without changing saved IDs. Change access to `none` and notify; assert no title/icon in either DOM or clipboard and Enter cannot navigate. Use role/testid locators only and `await expect(...)` for async state.

```ts
await page.getByRole('option', { name: 'Roadmap' }).click();
await expect(page.getByTestId('page-reference')).toHaveAttribute('data-blok-page-id', 'p1');
await expect(page.getByTestId('page-reference')).toHaveText('Renamed');
expect((await saveBlok(page)).blocks[0].data.text).toContain('data-blok-page-id="p1"');
```

- [ ] **Step 2: Run only that E2E case.** `yarn e2e test/playwright/tests/tools/page.spec.ts -g "inline page reference"`. Expected RED before the C modules are connected end-to-end.
- [ ] **Step 3: Complete the host integration recipe.** Update the tool reference in both literal `tools-data.ts` and authoritative `en.json` (plus `ru.json` with the same paragraph/list shape). Show the exact `page`/`page-link` saved shapes and `data-blok-page-id`; state that unauthorized results never enter `search`, `pageInfo` and `resolve`, the host publishes same-tab notifications, and normal URL mentions stay URL-backed. Read the prose guard before editing; do not repeat the old cached-title documentation.
- [ ] **Step 4: Run acceptance gates.** Run only the E2E case to GREEN, the relevant docs tests separately, `node scripts/i18n/check-translations.mjs`, `node scripts/generate-data-attributes-dts.mjs` and `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`. Run ESLint on changed TS files only while iterating. At the final shared-tree gate, coordinate the project's `yarn lint`/`yarn test` requirement with the other active workers; do not attribute unrelated dirty-tree failures to C without comparing changed files.
- [ ] **Step 5: Review checkpoint.** Re-read spec C lines 47–51 and global invariants 19–25 against the tests. Obtain independent review of the saved format, sanitizer, access filtering and keyboard behavior. Record the review findings in the implementation handoff; do not commit or push without a separate user request.
