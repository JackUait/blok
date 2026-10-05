# Pure Page Index and Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish DOM-free per-document page ownership/text facts and a pure, diagnostic tree projection for a host-owned workspace catalog.

**Architecture:** `pageIndex(data)` traverses one saved document with the existing view document model and plain-text reader. The host attaches that document's page ID and stores each projection in the same transaction as the consumer save; Blok owns no cross-page state. `projectPageTree(edges, metadata)` joins host-supplied edges with access-filtered metadata without guessing through duplicate or cyclic ownership. ID-backed non-owning references are a dependent task after slice C introduces their saved shapes.

**Tech Stack:** TypeScript, Vitest, `@bloklabs/core/view`, the existing `buildDocumentModel`/plain-text reader, and hand-authored `types/view.d.ts`.

**Spec:** `docs/superpowers/specs/2026-10-04-headless-page-platform-design.md`, slice B. The prerequisite page-metadata plan is `docs/superpowers/plans/2026-10-04-pages-meta-index.md`.

## Global Constraints

- Work on the existing `main` checkout only. Do not branch, create a worktree, stash, commit, push, or edit unrelated files. Record `git diff -- <target files>` before each edit and preserve the shared dirty tree.
- Follow red-green-refactor per task: write the new test, run only that file to see it fail, implement minimal code, run it green, then lint only changed files. The final code gate uses the project's final checks, view purity and published-type drift tests.
- The owner edge comes only from a real `page` pointer with a string, nonempty `pageId`. Its source block ID and DFS document order come from saved blocks; a page pointer's malformed children are not another document body.
- `pageId` is opaque and title-free. Never infer a page ID from an `href`, a legacy cache, a text match, or the playground's `parentId` registry.
- The host's saved parent documents are the ownership source of truth. A missing or duplicate owner is a diagnostic, not a guessed parent. A duplicate owner is never silently chosen for display.
- Metadata passed to the tree must already be filtered for the current viewer. Even if a caller mistakenly supplies `title`/`icon` beside `access: 'none'`, the projection must discard both. Search and backlink source filtering remains the host's authorization duty.
- Build only pure functions and published types under the existing `@bloklabs/core/view` subpath. Do not add a workspace store, database, UI, dependency, package export, or config edit. `types/view.d.ts` may import published types, never `src/`.
- The server room can accept edits before its deferred PUT. Catalog search/backlinks therefore reflect the latest consumer save, not necessarily live room state. A host may overlay local unsaved results, but the durable index update must be transactional with its own consumer save.
- No `references: []` placeholder is published in the initial B API. Slice C must first land `page-link` data `{ pageId }` and inline `<a data-blok-page-id="…">`; Task B3 then adds ID-backed reference extraction. Ordinary links are not guessed to be page references.

## Review Focus

1. A page pointer nested in a toggle, list, or table-related container must retain saved `content[]` sibling order and source block ID; Task B1 pins DFS ordering.
2. A legacy cached page title or icon must not become searchable text, an owner title, or a reference; Task B1 pins the output and Task B2 pins metadata filtering.
3. Duplicate owners, including duplicates in separate parent documents, must be reported with both source block IDs rather than choosing the first; Task B2 pins this.
4. A cycle disconnected from the root, or a child of an invalid parent, must terminate and remain diagnosable rather than vanish; Task B2 pins both.
5. A backlink source with `access: 'none'` must not reveal its source title, and an ordinary URL must not be treated as an ID-backed reference; Task B3 and the host recipe pin these after C.

---

### Task B1: Extract owning edges and searchable block text

**Files:**
- Create: `src/view/page-index.ts`
- Create: `test/unit/view/page-index.test.ts`
- Modify: `src/view/blocks-to-plain-text.ts`
- Modify: `src/view/index.ts`
- Modify: `types/view.d.ts`

**Interfaces:**
- Consumes: A's cache-free page conversion; `isPagePointer(type, data)`; the existing `buildDocumentModel` traversal and plain-text `ownSegments`/`tableText` logic.
- Produces:

```ts
export interface PageOwnerEdge {
  pageId: string;
  sourceBlockId: string;
  order: number; // zero-based visible reading position in this document
}
export interface PageTextEntry {
  blockId: string | null; // null preserves legacy id-less text at document level
  order: number;
  text: string; // text attributed to this visible block; a table includes its cell content
}
export interface PageIndex {
  owners: PageOwnerEdge[];
  text: PageTextEntry[];
}
export function pageIndex(data: OutputData | LooseOutputData | null | undefined): PageIndex;
```

- [ ] **Step 1: Write the failing tests.** Build a saved document whose toggle `content: ['child', 'owner']` differs from array order; assert that its child text precedes the nested page edge in DFS order, that the edge includes `sourceBlockId`, and that the legacy page cache never appears in `text`. Add one page pointer without a block ID, one foreign `type: 'page'` with no `pageId`, one malformed pointer child, a table cell with HTML text, and two pointers to the same page ID. The two valid duplicate pointers must remain separate edges for B2 to diagnose.

```ts
const data = { time: 1, blocks: [
  { id: 'toggle', type: 'toggle', content: ['child', 'owner'], data: { text: 'Roadmap' } },
  { id: 'owner', type: 'page', parent: 'toggle',
    data: { pageId: 'p2', cache: { title: 'Restricted title' } } },
  { id: 'child', type: 'paragraph', parent: 'toggle', data: { text: 'Alpha &amp; Beta' } },
] };
expect(pageIndex(data).owners).toEqual([
  { pageId: 'p2', sourceBlockId: 'owner', order: 2 },
]);
expect(pageIndex(data).text).toEqual([
  { blockId: 'toggle', order: 0, text: 'Roadmap' },
  { blockId: 'child', order: 1, text: 'Alpha & Beta' },
  { blockId: 'owner', order: 2, text: '' },
]);
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/view/page-index.test.ts`. Expected: `pageIndex` is not exported.

- [ ] **Step 3: Implement the shared walk and extractor.** Refactor `blocksToPlainTextWithReport`'s existing `visit` into one private reader that optionally calls `onBlock(block, ownText, order)` after `ownSegments`. Its normal public result must remain byte-for-byte unchanged. An internal `collectPageIndexBlocks(data)` export can gather these visits for `page-index.ts`; do not parse inline HTML again in the index or call `blocksToPlainText` once per block. For table cells, preserve the reader's current table aggregation at the table block and do not double-emit referenced child blocks. Skip page-pointer children exactly as the reader does. In `page-index.ts`, emit one `text` row per visited block (including empty and id-less rows), but replace a page pointer's neutral visual placeholder with `''`; emit an owner only when its `pageId` and source block ID are nonempty strings. Do not deduplicate page IDs. Export the runtime function/types through `src/view/index.ts` and mirror the exact declarations in `types/view.d.ts`.

```ts
const owners: PageOwnerEdge[] = [];
const text: PageTextEntry[] = [];
for (const { block, ownText, order } of collectPageIndexBlocks(data)) {
  const pageId = block.data.pageId;
  const pointer = isPagePointer(block.type, block.data)
    && typeof pageId === 'string' && pageId !== '';
  text.push({ blockId: block.id ?? null, order, text: pointer ? '' : ownText });
  if (pointer && block.id !== undefined) {
    owners.push({ pageId, sourceBlockId: block.id, order });
  }
}
return { owners, text };
```

- [ ] **Step 4: Verify green.** Run the new file, `test/unit/view/blocks-to-plain-text.test.ts`, `test/unit/view/blocks-to-plain-text-report.test.ts`, `test/unit/view/document-model.test.ts`, `test/unit/view/page-type-compat.test.ts`, `test/unit/view/index.purity.test.ts` and `test/unit/architecture/published-types-no-src-refs.test.ts` separately. Run ESLint only on changed files.

- [ ] **Step 5: Review checkpoint.** A saved document produces deterministic facts without DOM access, new stores, or page-cache reads. An id-less text block remains searchable at document level; an id-less pointer cannot claim ownership because it has no source block ID.

### Task B2: Project a tree without hiding catalog defects

**Files:**
- Create: `src/view/page-tree.ts`
- Create: `test/unit/view/page-tree.test.ts`
- Create: `test/unit/view/page-index-host-projection.test.ts`
- Create: `docs/maintainers/page-index-integration.md`
- Modify: `src/view/index.ts`
- Modify: `types/view.d.ts`

**Interfaces:**
- Consumes: B1's `PageOwnerEdge`. The host adds the source document page ID (`null` for its root document) to each edge and passes access-filtered metadata:

```ts
export interface HostPageEdge extends PageOwnerEdge {
  ownerPageId: string | null;
}
export interface PageTreeNode {
  pageId: string;
  sourceBlockId: string;
  order: number;
  access: 'allowed' | 'none' | 'missing';
  title?: string;
  icon?: PageIcon;
  children: PageTreeNode[];
}
export type PageTreeDiagnostic =
  | { kind: 'duplicate-owner'; pageId: string; edges: HostPageEdge[] }
  | { kind: 'cycle'; pageId: string; path: string[] }
  | { kind: 'missing-page'; pageId: string; sourceBlockId: string }
  | { kind: 'missing-owner'; pageId: string }
  | { kind: 'unreachable'; pageId: string; sourceBlockId: string };
export interface PageTreeProjection {
  roots: PageTreeNode[];
  diagnostics: PageTreeDiagnostic[];
}
export function projectPageTree(
  edges: readonly HostPageEdge[],
  metadata: Readonly<Record<string, PageInfo | null | undefined>>
): PageTreeProjection;
```

- [ ] **Step 1: Write the failing tests.** Pass shuffled edges from two saved documents and assert roots/siblings sort by numeric `order` with stable input order for ties. Assert an accessible page takes only host metadata, not any pointer cache. A denied record `{ access: 'none', title: 'Secret', icon: ... }` creates a no-access node with neither `title` nor `icon`. A missing metadata entry creates a missing node plus `missing-page` diagnostic. Two owners for the same page produce one `duplicate-owner` diagnostic carrying both edges (source document and source block IDs) and no chosen node. Add a disconnected A↔B cycle and an edge under an invalid parent; assert `cycle` and `unreachable` diagnostics without recursion/hang. A metadata page with no owner produces `missing-owner`. In the host-projection test, index two saved documents, join their owner edges with source document IDs, move a pointer between the saved snapshots, and assert one new parent and replacement (not append) of old search text.

```ts
const edges: HostPageEdge[] = [
  { ownerPageId: null, pageId: 'secret', sourceBlockId: 'b1', order: 3 },
  { ownerPageId: null, pageId: 'secret', sourceBlockId: 'b2', order: 8 },
];
const result = projectPageTree(edges, { secret: { title: 'Secret' } });
expect(result.roots).toEqual([]);
expect(result.diagnostics).toContainEqual({
  kind: 'duplicate-owner', pageId: 'secret', edges,
});
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/view/page-tree.test.ts` and `yarn test test/unit/view/page-index-host-projection.test.ts` separately. Expected: `projectPageTree` is not exported, so both new files fail before code.

- [ ] **Step 3: Implement one pure join.** Group edges by `pageId`. Mark every ID with more than one edge invalid; do not choose one. For each remaining edge, walk `ownerPageId` chains with a visiting set to identify cycles even when no root reaches them. Build children from only unique, acyclic edges, sorted by `order` and original input position. A node's metadata comes from an own property of the metadata record; `null`/absent yields `missing`, `access: 'none'` yields only `access: 'none'`, and allowed yields title/icon. Mark every unvisited edge `unreachable` and every catalog metadata ID without an edge `missing-owner`. Keep diagnostics deterministic and carry source IDs; do not mutate either input. In `docs/maintainers/page-index-integration.md`, show one consumer-save transaction: save the document, run `pageIndex(saved)`, replace that document's owner and text rows, then commit. Join persisted edges with `ownerPageId`, reject/repair duplicate or missing-owner diagnostics before showing a definitive parent, and filter search sources by the current viewer's document access. Explain that deferred room PUT makes global search eventually consistent; an optional local overlay is not durable. Favorites/recent remain host-owned ID lists. Use this exact transaction shape:

```ts
await host.transaction(async (tx) => {
  await tx.saveConsumerDocument(documentPageId, saved);
  const facts = pageIndex(saved);
  await tx.replaceOwners(documentPageId, facts.owners);
  await tx.replaceText(documentPageId, facts.text);
});
```

```ts
const byPage = new Map<string, HostPageEdge[]>();
edges.forEach((edge) => byPage.set(edge.pageId, [...byPage.get(edge.pageId) ?? [], edge]));
const duplicate = new Set([...byPage].filter(([, owners]) => owners.length > 1).map(([id]) => id));
const visibleInfo = (id: string): PageInfo | null | undefined =>
  Object.hasOwn(metadata, id) ? metadata[id] : undefined;
// When info?.access === 'none', construct no title/icon properties at all.
```

- [ ] **Step 4: Verify green.** Run both new B2 files, B1's test, `test/unit/view/index.purity.test.ts` and `test/unit/architecture/published-types-no-src-refs.test.ts`. Run changed-file ESLint. Test an ID named `__proto__` to prove lookup uses own properties, and a 200-node chain to verify termination without a recursion overflow in the supported document size.

- [ ] **Step 5: Review checkpoint.** One owner places one node; two owners place none. Cycles and unreachable edges remain in diagnostics. No restricted title, icon, or path leaks through the projection, even from a malformed metadata value.

### Task B3: Add ID-backed non-owning references **after slice C saves them**

**Dependency:** Do not execute or publish this task in the initial B release. Slice C must first land the saved `page-link` block `{ pageId: string }` and inline `<a data-blok-page-id="…">…</a>` identity, with its sanitizer/paste/round-trip tests. This task is the B follow-up that enables backlinks; no URL inference or empty placeholder precedes it.

**Files:**
- Create: `test/unit/view/page-index-references.test.ts`
- Modify: `src/view/page-index.ts`
- Modify: `types/view.d.ts`
- Modify: `docs/maintainers/page-index-integration.md`

**Interfaces:**
- Consumes: C's saved ID-backed forms, B1's `PageIndex` and B2's host transaction.
- Produces: `PageIndex.references: PageReference[]` with `PageReference = { pageId: string; sourceBlockId: string | null; order: number }`; `order` is the containing visible block's DFS order, not a cell coordinate (a table-cell child link inherits its table's position); preserve occurrence order in the `references` array. The host stores these non-owning refs separately from `owners`.

- [ ] **Step 1: Write the failing tests.** An ordinary `<a href="/pages/p1">` without `data-blok-page-id` yields no reference. A `page-link` block and an inline `<a data-blok-page-id="p2">` in a verified rich-text `text` field each yield a reference with source block ID and visible order. Add one legacy inline table cell containing the mark and one table cell whose `blocks` points to a paragraph containing it: the first reference names the table block, the second names the paragraph block, and both use the table's visible order. Repeated inline references remain repeated; covered merged cells and blank IDs are ignored. An owning `page` yields only an owner, malformed markup is parsed without DOM execution, and unverified plain-text media captions are not claimed as inline references. A denied source document is filtered by the host query, not by trusting the text of the link.

```ts
const facts = pageIndex({ time: 1, blocks: [
  { id: 'link', type: 'page-link', data: { pageId: 'p1' } },
  { id: 'text', type: 'paragraph', data: {
    text: '<a href="/pages/p9">URL only</a> <a data-blok-page-id="p2">ID link</a>',
  } },
] });
expect(facts.references).toEqual([
  { pageId: 'p1', sourceBlockId: 'link', order: 0 },
  { pageId: 'p2', sourceBlockId: 'text', order: 1 },
]);
```

- [ ] **Step 2: Verify red.** Run `yarn test test/unit/view/page-index-references.test.ts` only after C's format is in source. Expected: no `references` property or ID-backed extraction in B1.

- [ ] **Step 3: Implement the minimal extraction.** In the same document walk, read `page-link.data.pageId` directly. Scan the C-verified inline-HTML `text` fields on paragraph/header/toggle/list/quote blocks with `parseInlineFragment(field).childNodes` from `src/view/html-text.ts`; collect nonempty `data-blok-page-id` only on `a` elements. For tables, reuse `repairedTableRows`/`sourceCellsInDisplayOrder` to scan visible legacy cell HTML and the referenced cell blocks from `buildDocumentModel(data).byId` that the plain-text reader aggregates under the table; apply the same direct `page-link` or rich-text-anchor rules to those child blocks, without visiting one child twice. Attribute legacy cell references to the table ID and referenced child-block links to the child ID; both inherit the table's visible order, with occurrences retained in cell order. Quote `caption` and media captions are not supported: C's verified sanitizer path preserves the mark on quote `text`, not its `caption`, and does not yet prove media caption marks. Do not index those plain-text fields as ID-backed references. Do not use a browser DOM, parse URL paths, or read legacy page caches. Preserve each occurrence; update `PageIndex` and hand-authored public type.

```ts
if (block.type === 'page-link' && typeof block.data.pageId === 'string'
  && block.data.pageId !== '') {
  references.push({ pageId: block.data.pageId, sourceBlockId: block.id ?? null, order });
}
// C's sanitizer must preserve the ID on saved inline anchors.
```

- [ ] **Step 4: Verify green.** Run the new file, C's sanitizer/paste-law and round-trip tests, `test/unit/view/index.purity.test.ts`, and published-type drift checks. Update the host recipe's transaction to replace `references` alongside `owners`/`text` and show a backlink query that filters each source under the current user's access.

- [ ] **Step 5: Review checkpoint.** A link/mention is never an owner, a URL without an ID is never guessed to be a page, and inaccessible backlink sources return no title or snippet.

---

## Execution handoff

Implement Tasks B1–B2 as an independently testable B slice after A's safe metadata contract. Treat B3 as a separate dependent change after C, not as a partial initial B release. Review both this plan and the spec before any production edit. No commit, push, branch, worktree, stash, or config change is authorized by these plans.