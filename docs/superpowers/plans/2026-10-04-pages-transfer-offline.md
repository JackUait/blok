# Page Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a host safe cross-document page operations, deep duplication, and receipt-scoped Undo without a Blok-owned workspace database.

**Architecture:** Slice E is a set of pure document transforms plus a host-supplied durable operation boundary. The host owns fresh authoritative reads, access checks, transactions, retries, recovery, page records, and UI; Blok never deletes a source document because a bare sync `204` arrived. The separate F plan at `docs/superpowers/plans/2026-10-04-pages-offline-row-bodies.md` uses this plan's `remapPageDocument` interface for export/import.

**Tech Stack:** TypeScript, Vitest, parse5, and the existing DOM-free `@bloklabs/core/view` subpath. The current C# sidecar contract is an explicit safety boundary; this plan does not change its protocol or package configuration.

**Spec:** `docs/superpowers/specs/2026-10-04-headless-page-platform-design.md`, slice E (`59-63`).

## Global Constraints

- Work on the existing `main` checkout. No branch, worktree, stash, commit, or push is part of this plan-writing handoff. Preserve unrelated dirty files.
- A page body is one `OutputData` document named by an opaque, title-free `pageId`. A `page` block is an owning pointer; a `page-link` block and `<a data-blok-page-id="…">` are non-owning references. These C-shape names are the agreed prerequisite.
- The host owns page records, tree traversal, authorization, transaction storage, filenames, archive format, destination picker, toast, and version policy. No `PageStore`, workspace shell, sidebar, or new Blok sidecar catalog.
- A transfer preserves block IDs. Duplication mints new block and page IDs. A page reparent transfers only its pointer, never the pointed-to body.
- The host must check source and target read/write rights and owning-tree cycles at the authoritative commit boundary, not only in browser validation. A denied or missing target leaves the source intact.
- A source removal is visible only in the same durable host transaction as its target insertion. The stock sidecar `/edit` path is **not** a receipt: `CollabRoom.cs:503-537` catches a working-set persistence failure and still returns Applied, and `EditEndpoint.cs:118-127` can answer 204 with no lineage/sequence. The journal branch returns sequence after append (`CollabRoom.cs:572-595`), but a two-document journal saga is not implemented in this plan.
- This plan implements only the host-transaction path. Blok's stock collaborative transfer stays disabled. A host may enable collaboration only with a live-document transaction on the authoritative rooms and conformance tests proving idempotency, crash recovery, and late-edit handling. A `204` alone never enables it.
- `undoPageTransfer` is receipt-scoped for the host's Undo toast. Existing synchronous `history.undo()` remains document-local; this plan does not pretend that a cross-document network operation is a synchronous editor undo step.
- The latest release at drafting was `v1.15.2` (`git tag --sort=-v:refname`). The page pointer was added after it (`git log v1.15.2..HEAD -- types/tools/page.d.ts`). Re-check the latest tag before labelling a public change BREAKING. A future journal protocol change needs its own release note.
- For each implementation task: write the stated test first, run only that new test and observe red, add the minimum code, rerun that test green, lint only changed files while iterating. The executor then runs the project's final gates and independent review under the current session instructions. The executable steps below intentionally contain no Git commit/push commands.

## Review Focus

1. A target `/edit` returns 204 without a durable receipt. Expected: collaborative transfer refuses before source removal (Task 3).
2. A host transaction commits but its response is lost. Expected: retry with the same operation ID returns the same receipt and makes no second pointer or block copy (Task 3).
3. A peer edits a transferred subtree before host commit or after it but before Undo. Expected: the fresh transaction includes the former, and Undo carries the latter rather than overwriting it (Tasks 3-4).
4. A reverse conversion cannot load its target page. Expected: the owning pointer stays untouched (Task 2).
5. Copy contains ordinary text equal to a block ID and an external URL containing a page ID. Expected: neither string is rewritten; only typed internal references are (Task 5).

---

## File map and prerequisite boundary

| File | Responsibility |
|---|---|
| `src/view/page-transfer.ts` (new) | Pure move/reparent and turn-into/turn-back document transforms on fresh `OutputData` |
| `src/view/page-transfer-host.ts` (new) | Small host operation/receipt gate; no direct editor mutation or built-in persistence |
| `src/view/page-document-remap.ts` (new) | Typed per-document block/page ID and internal-link rewriting; no archive traversal |
| `src/view/index.ts`, `types/view.d.ts` | Public DOM-free signatures for these primitives |
| `test/unit/view/page-transfer.test.ts`, `page-transfer-host.test.ts`, `page-document-remap.test.ts` | TDD for structure, transactions, retries, cycles, permissions, Undo and links |
| `docs/maintainers/page-transfer-host.md` (new) | Host transaction, receipt, retry, access, cycle and Undo recipe |

The `src/view` routines deliberately accept document snapshots; they do not read the editor's current DOM or browser cache. A host must call them **inside** a transaction on its freshest authoritative documents. They are not permission or durability mechanisms by themselves. For collaboration, the source of truth is the live room/journal rather than a lagging consumer projection (`CollabRoom.cs:1232-1268`); a host adapter using only consumer GET/PUT does not qualify as live-document transactional.

### Task 1: Move a block subtree, not the pointed-to page body

**Files:**
- Create: `src/view/page-transfer.ts`
- Modify: `src/view/index.ts`, `types/view.d.ts`
- Test: `test/unit/view/page-transfer.test.ts`

**Interfaces:**
- Consumes: `OutputData` and its `id`/`parent`/`content` shape from `types/data-formats/output-data.d.ts:54-86`.
- Produces: `movePageBlocks(source: OutputData, target: OutputData, roots: readonly string[], place: { parentId: string | null; afterId: string | null }): { source: OutputData; target: OutputData; movedIds: string[] }`.
- The host's source and target permission/cycle check is Task 3; this pure function refuses malformed or conflicting local structure.

- [ ] **Step 1: Write the failing test.** Put the defect assertion first.

```ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { movePageBlocks } from '../../../src/view/page-transfer';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('moves one owning pointer without copying its page body', () => {
  const source = { blocks: [{ id: 'ptr', type: 'page', data: { pageId: 'child' } }] };
  const target = { blocks: [{ id: 'anchor', type: 'paragraph', data: { text: 'A' } }] };
  const moved = movePageBlocks(source, target, ['ptr'], { parentId: null, afterId: 'anchor' });

  expect(moved.target.blocks.map(block => block.id)).toEqual(['anchor', 'ptr']);
  expect(moved.target.blocks[1]?.data).toEqual({ pageId: 'child' });
  expect(moved.source.blocks).toEqual([]);
  expect(source.blocks[0]?.id).toBe('ptr');
});

it('carries a container and all content children with unchanged IDs', () => {
  const source = { blocks: [
    { id: 'toggle', type: 'toggle', data: { text: 'T' }, content: ['child'] },
    { id: 'child', type: 'paragraph', parent: 'toggle', data: { text: 'C' } },
  ] };
  const moved = movePageBlocks(source, { blocks: [] }, ['toggle'], { parentId: null, afterId: null });
  expect(moved.movedIds).toEqual(['toggle', 'child']);
  expect(moved.target.blocks[0]?.content).toEqual(['child']);
  expect(moved.target.blocks[1]?.parent).toBe('toggle');
});

it('uses content order even when the flat input array is shuffled', () => {
  const source = { blocks: [
    { id: 'list', type: 'list', data: {}, content: ['first', 'second'] },
    { id: 'second', type: 'paragraph', parent: 'list', data: { text: '2' } },
    { id: 'first', type: 'paragraph', parent: 'list', data: { text: '1' } },
  ] };
  const moved = movePageBlocks(source, { blocks: [] }, ['list'], { parentId: null, afterId: null });
  expect(moved.movedIds).toEqual(['list', 'first', 'second']);
  expect(moved.target.blocks.map(block => block.id)).toEqual(['list', 'first', 'second']);
});

it('refuses a cyclic target hierarchy without changing source', () => {
  const source = { blocks: [{ id: 'm', type: 'paragraph', data: { text: 'M' } }] };
  const target = { blocks: [
    { id: 'a', type: 'toggle', parent: 'b', content: ['b'], data: {} },
    { id: 'b', type: 'toggle', parent: 'a', content: ['a'], data: {} },
  ] };
  expect(() => movePageBlocks(source, target, ['m'], { parentId: 'a', afterId: null }))
    .toThrow(/cycle/i);
  expect(source.blocks[0]?.id).toBe('m');
});
```

Add cases in the same file for duplicate root IDs, missing referenced children, target ID collision, an invalid target sibling/parent, and a partially selected table cell. A refusal must leave both input objects byte-for-byte unchanged.

- [ ] **Step 2: Run only the new test to verify red.** Run `yarn test test/unit/view/page-transfer.test.ts`. Expected: missing export or assertion failure, not a pass.
- [ ] **Step 3: Implement the pure transform.** Validate unique IDs and `content` closure before building either output. Traverse `content` in saved order, check each child's `parent`, remove the full selected closure from the source, splice roots at the requested target placement, and rebuild affected `content` arrays. Never recursively load a `pageId`; it is scalar pointer metadata.

```ts
export function movePageBlocks(
  source: OutputData,
  target: OutputData,
  roots: readonly string[],
  place: { parentId: string | null; afterId: string | null }
): { source: OutputData; target: OutputData; movedIds: string[] } {
  const sourceById = new Map<string, OutputBlockData>();
  const targetById = new Map<string, OutputBlockData>();
  for (const [blocks, map] of [[source.blocks, sourceById], [target.blocks, targetById]] as const) {
    for (const block of blocks) {
      if (!block.id || map.has(block.id)) throw new Error('missing or duplicate block ID');
      map.set(block.id, block);
    }
  }
  if (roots.length === 0 || new Set(roots).size !== roots.length) throw new Error('invalid roots');
  const selected = new Set<string>();
  const visiting = new Set<string>();
  const movedOrder: string[] = [];
  const visit = (id: string): void => {
    const block = sourceById.get(id);
    if (!block) throw new Error('missing child block');
    if (visiting.has(id)) throw new Error('source hierarchy cycle');
    if (selected.has(id)) throw new Error('child selected twice');
    if (block.type === 'page' && (block.content?.length ?? 0) > 0) {
      throw new Error('a page pointer cannot own body blocks');
    }
    visiting.add(id);
    selected.add(id);
    movedOrder.push(id);
    for (const childId of block.content ?? []) {
      if (sourceById.get(childId)?.parent !== id) throw new Error('broken child link');
      visit(childId);
    }
    visiting.delete(id);
  };
  for (const root of roots) {
    if (selected.has(root)) throw new Error('nested root selected twice');
    visit(root);
  }
  for (const block of source.blocks) {
    if (block.parent && selected.has(block.parent) && !selected.has(block.id ?? '')) {
      throw new Error('child missing from content');
    }
  }
  const targetVisited = new Set<string>();
  const targetVisiting = new Set<string>();
  const validateTarget = (id: string): void => {
    if (targetVisiting.has(id)) throw new Error('target hierarchy cycle');
    if (targetVisited.has(id)) return;
    const block = targetById.get(id);
    if (!block) throw new Error('target child missing');
    targetVisiting.add(id);
    for (const childId of block.content ?? []) {
      if (targetById.get(childId)?.parent !== id) throw new Error('broken target child link');
      validateTarget(childId);
    }
    targetVisiting.delete(id);
    targetVisited.add(id);
  };
  for (const id of targetById.keys()) validateTarget(id);
  for (const id of selected) if (targetById.has(id)) throw new Error('target ID collision');
  const parent = place.parentId === null ? null : targetById.get(place.parentId);
  if (place.parentId !== null && !parent) throw new Error('target parent missing');
  if (parent?.type === 'page') throw new Error('page pointer cannot contain blocks');
  const sibling = place.afterId === null ? null : targetById.get(place.afterId);
  if (place.afterId !== null && (!sibling || (sibling.parent ?? null) !== place.parentId)) {
    throw new Error('target sibling is not a direct child');
  }
  if (parent && sibling && !parent.content?.includes(place.afterId as string)) {
    throw new Error('target sibling missing from content order');
  }
  for (const rootId of roots) {
    const oldParent = sourceById.get(sourceById.get(rootId)?.parent ?? '');
    if (oldParent?.type === 'table') throw new Error('move the whole table');
  }
  const movedIds = movedOrder;
  const nextSource = structuredClone(source);
  nextSource.blocks = nextSource.blocks
    .filter(block => !block.id || !selected.has(block.id))
    .map(block => block.content
      ? { ...block, content: block.content.filter(id => !selected.has(id)) }
      : block);
  const nextTarget = structuredClone(target);
  const rootSet = new Set(roots);
  const moved = movedIds.map(id => {
    const block = sourceById.get(id);
    if (!block) throw new Error('missing moved block');
    const copy = structuredClone(block);
    if (rootSet.has(id)) {
      if (place.parentId === null) delete copy.parent;
      else copy.parent = place.parentId;
    }
    return copy;
  });
  const descendantEnd = (id: string): number => {
    const block = targetById.get(id);
    if (!block) throw new Error('target block missing');
    return Math.max(target.blocks.findIndex(item => item.id === id),
      ...(block.content ?? []).map(descendantEnd));
  };
  const index = sibling ? descendantEnd(place.afterId as string) + 1
    : parent ? target.blocks.findIndex(block => block.id === parent.id) + 1
      : Math.max(0, target.blocks.findIndex(block => !block.parent));
  nextTarget.blocks.splice(index, 0, ...moved);
  if (parent) {
    const nextParent = nextTarget.blocks.find(block => block.id === parent.id);
    if (!nextParent) throw new Error('target parent missing');
    const content = [...(nextParent.content ?? [])];
    content.splice(sibling ? content.indexOf(sibling.id as string) + 1 : 0, 0, ...roots);
    nextParent.content = content;
  }
  return { source: nextSource, target: nextTarget, movedIds };
}
```

The host validates dynamic target tool contracts at its commit boundary; this DOM-free transform rejects the known childless `page` pointer. The final implementation must also reject a partial move out of a table/column container; use the same tests in Step 1 to force those checks. Do not call the private paste `remapIds`: it rewrites every equal string (`blok-data-handler.ts:541-567`).

- [ ] **Step 4: Run green and scoped checks.** Run `yarn test test/unit/view/page-transfer.test.ts`, then `yarn eslint src/view/page-transfer.ts src/view/index.ts types/view.d.ts test/unit/view/page-transfer.test.ts`. Expected: pass and no changed-file lint errors.
- [ ] **Step 5: Review checkpoint.** Inspect the diff for input mutation, accidental page-body traversal, child order drift, and undeclared public types.

### Task 2: Convert blocks to a page and load before the reverse conversion

**Files:**
- Modify: `src/view/page-transfer.ts`, `src/view/index.ts`, `types/view.d.ts`
- Test: `test/unit/view/page-transfer.test.ts`

**Interfaces:**
- Consumes: `movePageBlocks` from Task 1.
- Produces: `turnBlocksIntoPage(source, roots, { pageId, pointerId }): { source, pageBody, pointerId }` and `turnPageIntoBlocks(source, pointerId, loaded: { pageId: string; body: OutputData } | null): { source, retiredPageId, movedIds }`. The host retires the emptied source page only in the same transaction that places its blocks in the parent.
- A `null` load is failed/missing, not an empty page. The reverse compares `loaded.pageId` to the pointer's `data.pageId` and throws before changing anything on mismatch.

- [ ] **Step 1: Write failing conversion tests.**

```ts
it('replaces selected blocks with one page pointer after building the new body', () => {
  const source = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }] };
  const result = turnBlocksIntoPage(source, ['a'], { pageId: 'new-page', pointerId: 'ptr' });
  expect(result.pageBody.blocks[0]?.id).toBe('a');
  expect(result.source.blocks).toEqual([{ id: 'ptr', type: 'page', data: { pageId: 'new-page' } }]);
});

it('does not replace a pointer when loading its body failed', () => {
  const source = { blocks: [{ id: 'ptr', type: 'page', data: { pageId: 'child' } }] };
  expect(() => turnPageIntoBlocks(source, 'ptr', null)).toThrow(/body/i);
  expect(source.blocks[0]?.id).toBe('ptr');
  expect(() => turnPageIntoBlocks(source, 'ptr', { pageId: 'other', body: { blocks: [] } }))
    .toThrow(/pageId/i);
});
```

Also pin the valid empty-body case, nested child order, and a pointer whose `pageId` does not match the loaded document requested by the host. Put the intact-pointer assertion first in the load-failure case.

- [ ] **Step 2: Run `yarn test test/unit/view/page-transfer.test.ts` and observe red.**
- [ ] **Step 3: Implement the two transforms.** The first moves selected blocks into a new document and inserts `{ type: 'page', data: { pageId } }` at their old placement. The reverse checks the load and pointer identity before any transform:

```ts
const pointer = source.blocks.find(block => block.id === pointerId);
if (pointer?.type !== 'page' || typeof pointer.data.pageId !== 'string') {
  throw new Error('page pointer missing');
}
if (loaded === null) throw new Error('page body failed to load');
if (loaded.pageId !== pointer.data.pageId) throw new Error('pageId mismatch');
```

Then move every root of `loaded.body` into the pointer's exact sibling position with unchanged IDs and remove the pointer from the computed source snapshot. A zero-block body still removes the pointer only after a valid load. Return its `retiredPageId` for the host transaction; the host atomically commits page creation/retirement and both snapshots. These functions do not save.
- [ ] **Step 4: Run the new test and changed-file lint; expect green.**
- [ ] **Step 5: Review checkpoint.** The only route removing the pointer must require a non-null loaded body, including for an empty but valid document.

### Task 3: Require a durable host transaction before transfer

**Files:**
- Create: `src/view/page-transfer-host.ts`
- Modify: `src/view/index.ts`, `types/view.d.ts`
- Test: `test/unit/view/page-transfer-host.test.ts`
- Create: `test/unit/view/page-transfer-host-fixture.ts`, `docs/maintainers/page-transfer-host.md`

**Interfaces:**
- Produces a public `PageTransferRequest` discriminated by `kind: 'move-blocks' | 'reparent-page' | 'turn-into-page' | 'turn-into-blocks' | 'duplicate-page'`. Every request carries a caller-stable `operationId` and `sourcePageId`; variants carry the named target page/pointer, roots and placement. The host caller retains the same ID over timeout and reload.
- Produces `PageTransferReceipt = { operationId: string; kind: PageTransferRequest['kind']; sourcePageId: string; targetPageId: string; rootIds: string[]; undoToken: string; durability: { kind: 'transaction'; transactionId: string } }`. The transaction ID names a durable host commit of both authoritative documents and its operation record. It is a host promise, not a claim that Blok can independently inspect its database.
- Produces `PageTransferHost = { mode: 'saved-transaction' | 'live-transaction'; run(request: PageTransferRequest): Promise<PageTransferReceipt> }` and `executePageTransfer(host, request, { collaboration: boolean }): Promise<PageTransferReceipt>`. A saved-document transaction is forbidden while collaboration is on: its consumer projection can lag an open room. A live transaction must cover those authoritative rooms, not merely consumer GET/PUT.
- Host `run` reads fresh documents, authorizes source and target, rejects owning-tree cycles/duplicate owners, computes Task 1 or 2's transform, commits source + target + operation record atomically, and only then resolves. Same `operationId` and same request digest returns the recorded receipt; same ID and different digest conflicts. A crash after commit/before response is recovered by retrying that ID. Blok itself writes neither document.

- [ ] **Step 1: Write failing gate and transaction tests.** Define the request in the test rather than relying on an implicit fixture.

```ts
const moveRequest: PageTransferRequest = {
  kind: 'move-blocks',
  operationId: 'move-1',
  sourcePageId: 'source',
  targetPageId: 'target',
  rootIds: ['text'],
  place: { parentId: null, afterId: null },
};

it('refuses stock collaboration before calling a saved-document adapter', async () => {
  const run = vi.fn();
  await expect(executePageTransfer({ mode: 'saved-transaction', run }, moveRequest, { collaboration: true }))
    .rejects.toThrow(/durable live document/i);
  expect(run).not.toHaveBeenCalled();
});

it('refuses a bare 204 instead of treating it as proof', async () => {
  const run = vi.fn().mockResolvedValue({ status: 204 });
  await expect(executePageTransfer({ mode: 'live-transaction', run }, moveRequest, { collaboration: true }))
    .rejects.toThrow(/receipt/i);
});
```

In `page-transfer-host-fixture.ts`, build a deterministic `MemoryTransferHost` implementing `PageTransferHost`. Start it with `source` containing `text` and an empty `target`. Its `run` follows this exact order: (1) look up `operationId` and compare a canonical request digest; (2) check source-read/source-write/target-write authorization and the owning-edge graph for a target descendant; (3) read the current documents, not copies supplied by the browser; (4) call `movePageBlocks`; (5) fail on an injected `beforeCommit` switch; (6) atomically swap both map entries and store `{ digest, receipt }`; (7) fail on an injected `afterCommitBeforeResponse` switch; (8) return the receipt. Give the fixture `editSource(blockId,text)`, `deny(pageId)`, `addOwningEdge(parent,child)` and `document(pageId)` methods. The commit is one synchronous state swap within `run` in this test fixture; the real host recipe uses its database transaction.

```ts
it('returns the same receipt after a lost response, with no duplicate', async () => {
  const host = new MemoryTransferHost();
  host.failOnce = 'afterCommitBeforeResponse';
  await expect(executePageTransfer(host, moveRequest, { collaboration: false })).rejects.toThrow();
  const receipt = await executePageTransfer(host, moveRequest, { collaboration: false });
  expect(host.document('target').blocks.filter(block => block.id === 'text')).toHaveLength(1);
  expect(host.document('source').blocks.some(block => block.id === 'text')).toBe(false);
  expect(receipt.operationId).toBe('move-1');
});
```

Add test cases using the fixture for `beforeCommit` (source intact), a source edit immediately before `run` (latest text transferred), source/target permission denial, a target page below a moved owning pointer (cycle refused), and same ID/different digest (conflict). Assert the block's surviving document before checking an error message.

- [ ] **Step 2: Run `yarn test test/unit/view/page-transfer-host.test.ts` and observe red.**
- [ ] **Step 3: Implement the thin gate and validation.**

```ts
export async function executePageTransfer(
  host: PageTransferHost,
  request: PageTransferRequest,
  context: { collaboration: boolean }
): Promise<PageTransferReceipt> {
  if (context.collaboration && host.mode !== 'live-transaction') {
    throw new Error('Cross-document transfer needs a durable live document adapter');
  }
  const receipt = await host.run(request);
  assertMatchingTransactionReceipt(request, receipt);
  return receipt;
}
```

`assertMatchingTransactionReceipt` checks a nonempty ID, matching kind/source/target/root IDs, nonempty `undoToken` and `transactionId`. Define it in this file. The documented host adapter must retain the operation record and request digest in the same transaction; its receipt is not a sidecar ACK. The stock `/edit` `204` path remains disabled. Do not add a journal-saga mode or protocol code in this task.

- [ ] **Step 4: Run the focused test green and lint changed TS files only.**
- [ ] **Step 5: Review checkpoint.** No branch may call `blocks.delete()`, `render()`, or `/edit` on its own; the host owns mutation and the UI only acts on a committed receipt.

### Task 4: Make Undo receipt-scoped, conflict-safe and idempotent

**Files:**
- Modify: `src/view/page-transfer-host.ts`, `src/view/index.ts`, `types/view.d.ts`, `docs/maintainers/page-transfer-host.md`
- Test: `test/unit/view/page-transfer-host.test.ts`

**Interfaces:**
- Consumes: `PageTransferReceipt` from Task 3.
- Produces: `PageTransferUndoRequest = { operationId: string; undoOf: PageTransferReceipt }`, `PageTransferUndoReceipt = { operationId: string; undoOfOperationId: string; undoToken: string; durability: { kind: 'transaction'; transactionId: string } }`, `PageTransferUndoHost extends PageTransferHost { undo(request: PageTransferUndoRequest): Promise<PageTransferUndoReceipt> }`, and `undoPageTransfer(host: PageTransferUndoHost, request, context): Promise<PageTransferUndoReceipt>`. The Undo receipt binds the inverse to exactly one original operation.
- The host persists the undo request/digest in the same transaction as the inverse move. It checks the original moved roots' **current** placement and provenance, not a stale snapshot. For a move, it transfers current subtree data (including peer edits/children) back. If a peer displaced or deleted a root, it refuses without touching either document. For a duplicate, Undo may remove a copy only if no peer edited it; otherwise it refuses rather than deleting peer work.

- [ ] **Step 1: Write failing inverse tests.**

```ts
it('undoes the current moved subtree and preserves a peer edit', async () => {
  const first = await executePageTransfer(host, moveRequest, { collaboration: false });
  host.edit('target', 'text', 'peer revision');
  const undone = await undoPageTransfer(host, { operationId: 'undo-1', undoOf: first }, { collaboration: false });
  expect(host.document('source').blocks.find(block => block.id === 'text')?.data.text).toBe('peer revision');
  expect(undone.operationId).toBe('undo-1');
});

it('refuses Undo after another peer moved the root', async () => {
  const first = await executePageTransfer(host, moveRequest, { collaboration: false });
  host.moveRoot('text', 'third');
  await expect(undoPageTransfer(host, { operationId: 'undo-2', undoOf: first }, { collaboration: false }))
    .rejects.toThrow(/conflict/i);
  expect(host.document('third').blocks.some(block => block.id === 'text')).toBe(true);
});
```

Also test same `undo-1` retry, a different digest under `undo-1`, permission revoked between transfer and Undo, and duplicate copy edited by a peer. The no-deletion assertion comes before error-shape checks.

- [ ] **Step 2: Run the focused host test and observe red.**
- [ ] **Step 3: Implement `undoPageTransfer` as the same receipt gate around `host.undo`.**

```ts
export async function undoPageTransfer(
  host: PageTransferHost,
  request: PageTransferUndoRequest,
  context: { collaboration: boolean }
): Promise<PageTransferUndoReceipt> {
  if (context.collaboration && host.mode !== 'live-transaction') {
    throw new Error('Undo needs a durable live document adapter');
  }
  assertDurableOriginalReceipt(request.undoOf);
  const receipt = await host.undo(request);
  assertMatchingUndoReceipt(request, receipt);
  return receipt;
}
```

`assertDurableOriginalReceipt` rejects an absent original transaction ID or Undo token. `assertMatchingUndoReceipt` checks the new operation ID and transaction ID, plus `undoOfOperationId` and `undoToken` against the original receipt; it cannot infer peer ownership from the receipt, so the host conformance test must. Do not push a fake entry into Yjs `UndoHistory`: `history.undo(): void` (`types/api/history.d.ts:8`) cannot await or report this network operation, and the host already owns the toast. The sample host adapter uses `undoToken` plus current root ownership and an operation record to decide whether the inverse applies; it never deletes by matching a stale ID alone.
- [ ] **Step 4: Rerun focused test and scoped lint green.**
- [ ] **Step 5: Review checkpoint.** Verify one host Undo request reverses one completed transfer and a conflict leaves every peer-owned block untouched.


### Task 5: Remap only typed IDs and internal links for a copied page document

**Files:**
- Create: `src/view/page-document-remap.ts`
- Modify: `src/view/index.ts`, `types/view.d.ts`
- Test: `test/unit/view/page-document-remap.test.ts`

**Interfaces:**
- Produces `remapPageDocument(data: OutputData, ids: { blockIds: ReadonlyMap<string, string>; pageIds: ReadonlyMap<string, string> }): OutputData`. The caller supplies complete, collision-free fresh IDs for blocks in this document and pages in the copied subtree.
- This primitive is consumed by Task 6 and by the later F plan. It rewrites `id`, `parent`, `content`, owning `page.data.pageId`, non-owning `page-link.data.pageId`, inline `<a data-blok-page-id="…">`, and exact local `href="#block-id"` anchors. It does not rewrite arbitrary text, external URL substrings, author-written page titles, or a reference outside the supplied maps.
- Prerequisite C has the agreed saved shapes `page-link { pageId }` and `<a data-blok-page-id="…">`. If C lands with a different representation, reconcile those exact tags before this task, not by a generic recursive string replacer.

- [ ] **Step 1: Write the failing test.**

```ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { remapPageDocument } from '../../../src/view/page-document-remap';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('remaps hierarchy and typed page references but not ordinary strings', () => {
  const original = { blocks: [
    { id: 'old-block', type: 'toggle', content: ['child'], data: { text: 'old-block' } },
    { id: 'child', type: 'paragraph', parent: 'old-block',
      data: { text: '<a data-blok-page-id="old-page">Open</a> <a href="#old-block">Top</a> <a href="https://x.test/old-page">External</a>' } },
    { id: 'ptr', type: 'page', data: { pageId: 'old-page' } },
    { id: 'link', type: 'page-link', data: { pageId: 'old-page' } },
  ] };
  const copied = remapPageDocument(original, {
    blockIds: new Map([['old-block', 'new-block'], ['child', 'new-child'], ['ptr', 'new-ptr'], ['link', 'new-link']]),
    pageIds: new Map([['old-page', 'new-page']]),
  });
  expect(copied.blocks[0]?.data.text).toBe('old-block');
  expect(copied.blocks[0]?.content).toEqual(['new-child']);
  expect(copied.blocks[1]?.parent).toBe('new-block');
  expect(copied.blocks[1]?.data.text).toContain('data-blok-page-id="new-page"');
  expect(copied.blocks[1]?.data.text).toContain('href="https://x.test/old-page"');
  expect(copied.blocks[2]?.data.pageId).toBe('new-page');
  expect(copied.blocks[3]?.data.pageId).toBe('new-page');
});
```

Add a test for duplicate mapped IDs, missing block-ID mappings, an out-of-subtree `pageId`, a local anchor that is not mapped, and an HTML text field with `old-page` only as plain text. Put the non-rewrite assertion first in the external URL test.

- [ ] **Step 2: Run `yarn test test/unit/view/page-document-remap.test.ts` and observe red.**
- [ ] **Step 3: Implement the typed rewrite.** Validate every block has a mapped new ID and no two map to the same ID. Copy each block and rewrite only its structural fields. For `page` and `page-link`, rewrite `data.pageId` if mapped. For a saved rich-text HTML field, use the existing DOM-free parse5 path used by `src/view`, visit anchors only, replace `data-blok-page-id` and exact `#blockId` references, then serialize. Do not call the private paste `remapIds`, which replaces any equal string. Preserve unknown tool data unchanged; a host custom tool can pre/post-process its own documented IDs before calling this primitive.
- [ ] **Step 4: Run focused test and changed-file lint green.**
- [ ] **Step 5: Review checkpoint.** Compare every rewritten field with the interface list above; there must be no global string replacement or network access.

### Task 6: Duplicate a permitted page subtree without a second owner

**Files:**
- Modify: `src/view/page-transfer-host.ts`, `docs/maintainers/page-transfer-host.md`
- Test: `test/unit/view/page-transfer-host.test.ts`

**Interfaces:**
- Consumes `PageTransferRequest` kind `duplicate-page` (Task 3) and `remapPageDocument` (Task 5).
- The host, not Blok, enumerates permitted owning edges from its current catalog and creates fresh page IDs and block-ID maps. Its `run` stores all new page documents and the final owning pointer in one host transaction. A retry uses the same `operationId`, allocation map and receipt; a host that cannot transact the subtree refuses the request rather than exposing a partial duplicate.

- [ ] **Step 1: Write a failing three-level host integration test.**

```ts
it('duplicates three permitted levels with fresh IDs and links inside the copy', async () => {
  host.addPageTree('root', ['child', 'grandchild']);
  const receipt = await executePageTransfer(host, duplicateRequest, { collaboration: false });
  const copies = host.pagesCreatedBy(receipt.operationId);
  expect(new Set(copies.map(page => page.id)).size).toBe(3);
  expect(copies.flatMap(page => page.body.blocks).every(block => block.id !== 'original-block')).toBe(true);
  expect(host.ownersOf(copies[0].id)).toHaveLength(1);
  expect(host.internalLinkIn(copies[0].id)).toBe(copies[1].id);
});
```

In the same test host, inject failure while writing the second descendant, revoke read permission on one descendant, and retry after response loss. Assert no visible duplicate pointer on failure, no unauthorized body read, and exactly one new owner per committed page.

- [ ] **Step 2: Run the focused test and observe red.**
- [ ] **Step 3: Add `duplicate-page` handling to the host recipe/adapter fixture, not a Blok workspace store.** A depth-first scan with a visited set refuses cycles and duplicate owners; it checks each source page's read permission and destination write permission before copying. Map every page ID first, then call `remapPageDocument` once per body using that complete map. Commit every copied body and the new owning pointer in one durable host transaction. Reject the request if the host cannot atomically commit that whole subtree; invisible staged copies are not a substitute for this receipt.
- [ ] **Step 4: Run focused test green and changed-file lint.**
- [ ] **Step 5: Review checkpoint.** Deleting or moving an original pointer must not touch copied bodies, and the host's owning-edge projection must report one owner per new page.

## E release gate and handoff

- [ ] Run `yarn test test/unit/view/page-transfer.test.ts`, `yarn test test/unit/view/page-transfer-host.test.ts` and `yarn test test/unit/view/page-document-remap.test.ts` as separate scoped invocations while iterating.
- [ ] Run published declaration drift and view-purity tests: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts` and `yarn test test/unit/view/index.purity.test.ts`.
- [ ] Exercise the transactional host fixture with failures before commit, after commit/before response, unauthorized source/target, descendant cycle, concurrent source typing, target peer edits, and Undo conflict. The stock collaborative gate must stay red-to-enable/green-to-refuse: no journal/live transaction receipt means no collaborative source removal.
- [ ] Run the repository's final gates required by the current project instructions, then independent review. Preserve the shared checkout and do not stage unrelated work.
