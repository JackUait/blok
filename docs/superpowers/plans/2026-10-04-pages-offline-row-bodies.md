# Page Export, Offline, and Row Bodies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host export/import a permitted page subtree, download a selected unopened page for offline reading, manage that page's offline partition, and opt a database-row body into a durable page document without losing legacy data.

**Architecture:** Slice F builds on the pure `remapPageDocument` contract in the E plan at `docs/superpowers/plans/2026-10-04-pages-transfer-offline.md` and D's offline-scope partition API. E remaps typed saved IDs; the existing static renderer uses host-supplied page URLs, so F verifies the combined archive round-trip rather than writing URLs into saved page references. Blok adds headless cache operations; the host owns archive traversal/format, page records, authorization, UI and version policy. A row stays a block; its old rich-text blob remains readable, while an opt-in host transaction publishes the separate page body and row pointer together after a live-room legacy-write fence.

**Tech Stack:** TypeScript, Vitest, parse5, Yjs, IndexedDB/fake-indexeddb, the existing Blok collaboration provider, and `@bloklabs/core/view`. No package or project configuration edits.

**Spec:** `docs/superpowers/specs/2026-10-04-headless-page-platform-design.md`, slice F (`65-69`).

## Global Constraints

- Work on the existing `main` checkout; no branch, worktree or stash. Do not overwrite unrelated dirty files. This plan does not ask its executor to commit or push.
- Each body is a separate `OutputData` document addressed by opaque `pageId`. The host walks allowed owning page edges and chooses archive format, paths and UI. Blok receives one document at a time; it does not create a workspace store or tree.
- E's `remapPageDocument(data, { blockIds, pageIds })` mints no IDs; the host supplies complete maps. C's saved identities are `page { pageId }`, `page-link { pageId }` and `<a data-blok-page-id="…">`. Rewriting must not alter author text or external URLs.
- An offline download is opt-in with a stable opaque `offlineScope`. It fetches exactly the requested `doc` via the existing sync protocol, waits for validated control and completed SyncStep2, writes the cache snapshot transactionally, and opens no editor. No subpage fetch, prefetch or new socket multiplexing is in scope.
- The headless snapshot is conservative: mark it write-denied for offline boot unless a verified write grant is available through the existing protocol. A read-only offline page still meets this slice's offline-open acceptance; do not claim unsynced editing.
- D supplies `inspectOfflineScope(scope): Promise<OfflineScopeReport>` and internal `forgetOfflinePartitions(scope, matches, { discardPending: true }): Promise<OfflineScopeForgetResult>` in `src/components/modules/collaboration/offline-scope.ts`. `OfflineScopeReport.partitions` is a readonly array of `OfflinePartitionReport = { url, doc, outbox: { count, bytes }, quarantine: { count, bytes }, updates: { count, bytes }, mayHaveUnsentV1Edits }`. Per-page controls filter this exact model and retain its explicit discard and blocked-deletion semantics.
- A `database-row` remains a block under its database (`parent`/`content`); structured column values remain `data.properties`. Current drawer bodies are legacy `OutputData` blobs in a `richText` property, as evidenced at `src/tools/database/index.ts:1111-1182`. The migration reads these but does not make a second editable body. After durable `pageId` publication, the page document is the live body; the blob is only retained for recovery.
- The first row task is a **reproduction gate**, not a presumed fix. Source points to a default-schema drop (`database-model.ts:284-321` and `database/index.ts:1177-1182`), but no runtime regression was run while drafting. If the new test passes before a change, stop and report the premise rather than adding a redundant fix.
- Old clients in `v1.15.2` drop an unknown row field because `DatabaseRowTool.toRowData` and `snapshot` copy only properties, position and title (`src/tools/database-row/index.ts:6-19,52-63`). Thus opt-in migration needs a host version/capability gate and a legacy-write fence at the **live room** before `pageId` is written. A consumer GET/PUT gate alone cannot stop an already-connected Yjs peer. If the host cannot atomically publish the row pointer and page body while enforcing that fence, migration remains disabled and the legacy blob stays authoritative.
- Latest tag was `v1.15.2` when drafted. Re-check the published boundary before labelling a break. New row shape and any protocol gate require separate release notes.
- For each code task: write the stated test first, run only that new test and observe red, implement the smallest behavior, rerun that test green, lint only changed files while iterating. Run project final gates and independent review under current instructions. Do not edit `package.json`, bundler, TS, lint or test config.

## Review Focus

1. An imported document contains ordinary text equal to a block ID and an external URL containing a page ID. Expected: only typed page references and exact local anchors change (Task 1).
2. A host chooses a page that has never been opened in any editor. Expected: one completed headless sync makes it readable offline; subpages are not downloaded (Task 2).
3. A headless sync fails before a verified control/SyncStep2 or its IndexedDB write fails. Expected: no new adoptable cache is claimed and a previous valid copy is not destroyed (Task 2).
4. A per-page forget sees pending v2 outbox rows, v1 uncertainty, quarantine or an active IDB handle. Expected: an explicit discard decision is required and a blocked deletion reports failure, not success (Task 3).
5. A legacy client edits a row body after page migration begins. Expected: the live-room version gate rejects that write or migration remains off; no new page body silently overwrites the legacy edit (Task 6).

---

## File map and cross-plan contracts

| File | Responsibility |
|---|---|
| `src/view/page-document-remap.ts`, `src/view/blocks-to-html.ts`, `types/view.d.ts` | E's ID remap and the existing host-supplied static page URL seams; change only if the archive test exposes a concrete gap |
| `test/unit/view/page-document-remap.test.ts` | Allowed-subtree import and static-export round-trip tests |
| `src/components/modules/collaboration/headless-offline-page.ts` (new) | Verify one sync in a temporary Yjs document and cache a snapshot with no editor |
| `src/components/modules/collaboration/offline-pages.ts` (new) | Filter D's scope report and deletion seam to one URL/document partition |
| `src/blok.ts`, `src/full.ts`, `types/index.d.ts` | Public headless offline functions and hand-authored types; no package export change |
| `test/unit/components/modules/collaboration/headless-offline-page.test.ts`, `offline-pages.test.ts` | Offline download, scope and failure coverage |
| `src/tools/database/index.ts`, `src/tools/database/database-card-drawer.ts`, `src/tools/database/database-model.ts` | Reproduce/fix default-schema body drop, project row `pageId`, opt-in body handoff |
| `src/tools/database-row/index.ts`, `src/tools/database/types.ts`, `types/tools/database.d.ts`, `src/view/document-schema.ts` | Preserve optional row `pageId` and a typed opt-in host callback |
| `test/unit/tools/database/database.test.ts`, `database-card-drawer.test.ts`, `test/unit/tools/database-row/database-row.test.ts`, `test/unit/view/document-schema.test.ts` | Regression and compatibility tests |
| `test/unit/tools/database/row-page-migration.test.ts` (new) | First-edit durable copy, retry, old-client gate and authority selection |
| `docs/maintainers/page-archive-host.md` (new), `docs/maintainers/offline-row-bodies.md` (new) | Short host recipes and release caveats |

Prerequisites to execute F: E Task 5 exports `remapPageDocument`; C has the three saved page-reference shapes above; D exports the named offline-scope functions and internal filtered deletion seam. Reconcile signatures with those landed plans before touching code, but do not make F silently substitute a parallel ID remapper or a second offline registry.

### Task 1: Verify a permitted subtree's import IDs and static export links

**Files:**
- Test: `test/unit/view/page-document-remap.test.ts`
- Create: `docs/maintainers/page-archive-host.md`
- Modify only on a demonstrated failing test: `src/view/page-document-remap.ts`, `src/view/blocks-to-html.ts`, `types/view.d.ts`

**Interfaces:**
- Consumes E's `remapPageDocument(data, { blockIds, pageIds })` for saved identity changes and `blocksToHtml(data, { pageHref, pageInfo })` for host-selected static URLs/metadata. C and A provide page-link/inline-reference rendering from saved `pageId`.
- No new saved-`href` rewrite is needed: C's inline reference is ID-only, and its sanitizer removes a stored `href`. Writing an archive path into saved HTML would make the document host-specific and violate that contract. The host chooses file paths only for static output.

- [ ] **Step 1: Write an allowed-subtree acceptance test.** Build three host-supplied documents whose owning pointers form root → child → grandchild. Supply deterministic fresh block/page ID maps, call `remapPageDocument` once per document, then render each imported document with `blocksToHtml` and a host `pageHref` callback. Put the external-link non-rewrite assertion first.

```ts
it('imports three levels and renders copied internal links without changing external links', () => {
  const copiedRoot = remapPageDocument(rootBody, {
    blockIds: rootBlockIds,
    pageIds: new Map([['child', 'copy-child'], ['grandchild', 'copy-grandchild']]),
  });
  const text = copiedRoot.blocks.find(block => block.id === 'copy-text')?.data.text;
  expect(text).toContain('href="https://outside.test/child"');
  expect(text).toContain('data-blok-page-id="copy-child"');
  const html = blocksToHtml(copiedRoot, {
    pageHref: id => id === 'copy-child' ? 'pages/copy-child.html' : '',
    pageInfo: id => allowedPageInfo.get(id) ?? null,
  });
  expect(html).toContain('pages/copy-child.html');
  expect(copiedRoot.blocks.find(block => block.id === 'copy-pointer')?.data.pageId)
    .toBe('copy-child');
});
```

Define `rootBody`, `rootBlockIds` and `allowedPageInfo` as literal fixtures in this test, and give the child/grandchild their own documents and maps. Assert their owning edges still nest, their exact `#blockId` anchors use new block IDs, a link outside the allowed subtree stays external/non-owning, and an inaccessible sibling is never supplied to the renderer. The host recipe lists the authorization-filtered traversal and archive file mapping; it does not pick a format for the consumer.

- [ ] **Step 2: Run `yarn test test/unit/view/page-document-remap.test.ts`.** This is an integration verification task after E/A/C, so it may already pass. If it fails for a concrete typed reference, keep the failing assertion and make only that gap's minimal code change. Do not add a redundant URL-rewriting abstraction to force a red phase.
- [ ] **Step 3: Write `docs/maintainers/page-archive-host.md` with the tested call order: host filters allowed pages, allocates all IDs, remaps each document once, uses host URLs only at static render, and commits imported documents/pointers before making them visible.** Link the public signatures and note that Blok does not traverse, name or store the archive.
- [ ] **Step 4: Rerun the focused test and lint only any changed code/test files; expect green.**
- [ ] **Step 5: Review checkpoint.** No saved typed link gains an archive `href` and no restricted page metadata is rendered.

### Task 2: Download exactly one selected page without constructing an editor

**Files:**
- Create: `src/components/modules/collaboration/headless-offline-page.ts`
- Modify: `src/blok.ts`, `src/full.ts`, `types/index.d.ts`
- Test: `test/unit/components/modules/collaboration/headless-offline-page.test.ts`

**Interfaces:**
- Produces `downloadOfflinePage(input: { url: string; doc: string; offlineScope: string; ticket?: (options?: { forceRefresh?: boolean }) => Promise<string>; signal?: AbortSignal; socketFactory?: CollabSocketFactory }): Promise<{ url: string; doc: string; lineage: string }>`; the socket factory is the same optional transport seam the current collaboration config already accepts.
- Consumes existing `createCollabProvider` (`src/components/modules/collaboration/provider.ts`), `DocumentStore`/`YBlockSerializer`, and `createOperationStore({url,doc,offlineScope})`. `connected` is reported only after completed sync (`provider.ts:1052-1074`); `recordSession(tag, true, protocol, snapshot)` stores a conservative read-only cache in one call (`operation-store.ts:134-149`).
- The public call never creates `Blok`, an editor holder, a page block, or a second URL from `pageId`. The host constructs the exact authorized URL and opts in to storage.

- [ ] **Step 1: Write the failing headless test.** Use `fake-indexeddb` and a scripted socket that sends a valid control frame and SyncStep2 for `child`, following the frame builders in `test/unit/components/modules/collaboration/sync-first-load.test.ts:118-`.

```ts
it('makes an unopened selected page adoptable without fetching its subpage', async () => {
  const socket = makeSyncSocket({
    doc: 'child',
    blocks: [
      { id: 'p', type: 'paragraph', data: { text: 'Offline text' } },
      { id: 'ptr', type: 'page', data: { pageId: 'grandchild' } },
    ],
  });
  const result = await downloadOfflinePage({
    url: 'wss://sync.test/api/sync/child',
    doc: 'child',
    offlineScope: 'account-a',
    ticket: async () => 'ticket',
    socketFactory: socket.factory,
    signal: AbortSignal.timeout(5000),
  });
  const store = createOperationStore({
    url: 'wss://sync.test/api/sync/child', doc: 'child', offlineScope: 'account-a',
  });
  const cached = await store.open();
  expect(cached?.meta.lineage).toBe(result.lineage);
  expect(cached?.updates.length).toBeGreaterThan(0);
  expect(socket.requestedDocs).toEqual(['child']);
  await store.close();
});
```

`makeSyncSocket` is a test-local scripted `CollabSocketFactory` (not a product API). Make it emit the control and SyncStep2 bytes from the existing `sync-wire` test helpers, and record requested document IDs. In the same test file, simulate no control, a wrong lineage/reset, forbidden close, aborted request, and IndexedDB transaction failure; assert the promise rejects and `store.open()` returns no newly adoptable document. If there was an earlier valid cache, assert it remains readable after a failed refresh. Add an integration test that boots a real collaboration editor disconnected under the same `url`/`doc`/`offlineScope` and observes the downloaded body in read-only mode.

- [ ] **Step 2: Run only `yarn test test/unit/components/modules/collaboration/headless-offline-page.test.ts` and observe red.**
- [ ] **Step 3: Implement headless sync.** Build a temporary `DocumentStore(new YBlockSerializer())` and an internal `CollabDocSeam` wrapper using its update/state-vector/awareness methods. The wrapper's `onDocUpdate` must filter remote echoes, `onAnyDocUpdate` must see the full snapshot, `resetForRelineage` must swap the Y.Doc, and `flushPendingWrites` is a no-op because headless sync never edits. Open the operation store first; start the provider; on first `connected`, take `provider.tag` and `provider.protocol`, encode the complete state, await `recordSession(tag, true, protocol, snapshot)`, then destroy provider, document and store. Reject on terminal error, an abort, or a fixed 15-second no-sync deadline. Always close resources in `finally`. Do not write cache meta on an unverified control alone.
- [ ] **Step 4: Run focused test and changed-file lint green.**
- [ ] **Step 5: Review checkpoint.** Verify the exact selected URL was the only request, no editor was constructed, and the cache did not become editable merely because the downloader had a read ticket.

### Task 3: List and forget one offline page using D's partition model

**Files:**
- Create: `src/components/modules/collaboration/offline-pages.ts`
- Modify: `src/blok.ts`, `src/full.ts`, `types/index.d.ts`
- Test: `test/unit/components/modules/collaboration/offline-pages.test.ts`
- Modify: `docs/maintainers/offline-row-bodies.md` (create it here)

**Interfaces:**
- Consumes D's `inspectOfflineScope`, `OfflinePartitionReport`, `forgetOfflinePartitions` and `OfflineScopeForgetResult` from `src/components/modules/collaboration/offline-scope.ts`.
- Produces `listOfflinePages(scope: string): Promise<readonly OfflinePartitionReport[]>` and `forgetOfflinePage(scope: string, page: { url: string; doc: string }, options: { discardPending: true }): Promise<OfflineScopeForgetResult>`. The exact `url`+`doc` pair disambiguates equal doc IDs on different servers.
- This is a filtered view/deletion of D's scope partitions, not another registry. It includes a partition with only outbox/quarantine so the host can see and consciously discard it.

- [ ] **Step 1: Write failing partition tests.**

```ts
it('forgets only the selected account/server/document partition', async () => {
  await seedPartition({ scope: 'a', url: 'wss://one/doc', doc: 'p', pending: 1 });
  await seedPartition({ scope: 'a', url: 'wss://two/doc', doc: 'p', pending: 0 });
  await seedPartition({ scope: 'b', url: 'wss://one/doc', doc: 'p', pending: 0 });
  await expect(forgetOfflinePage('a', { url: 'wss://one/doc', doc: 'p' },
    { discardPending: true })).resolves.toMatchObject({ deletedPartitions: 1 });
  expect((await listOfflinePages('a')).map(row => row.url)).toEqual(['wss://two/doc']);
  expect(await listOfflinePages('b')).toHaveLength(1);
});
```

`seedPartition` is test-local and writes through `createOperationStore`, including a valid `recordSession` before a pending `appendLocal`. Also test that omitting the literal `discardPending: true` is a type error and a runtime refusal, that quarantine/v1 uncertainty appear in the returned report, and that an open handle blocks deletion rather than reporting success. Close/switch every active editor before normal deletion; the blocked-handle test deliberately violates this precondition.

- [ ] **Step 2: Run `yarn test test/unit/components/modules/collaboration/offline-pages.test.ts` and observe red.**
- [ ] **Step 3: Implement two small wrappers.**

```ts
export async function listOfflinePages(scope: string): Promise<readonly OfflinePartitionReport[]> {
  return (await inspectOfflineScope(scope)).partitions;
}
export function forgetOfflinePage(
  scope: string,
  page: { url: string; doc: string },
  options: { discardPending: true }
): Promise<OfflineScopeForgetResult> {
  return forgetOfflinePartitions(scope,
    partition => partition.url === page.url && partition.doc === page.doc, options);
}
```

D's deletion seam handles pending work, quarantine snapshots, blocked IndexedDB deletion and idempotent retries. The host must close or switch active tabs first so a live editor cannot recreate the partition. Document that offline devices retaining bytes cannot be erased until they reconnect.

- [ ] **Step 4: Run focused test, D's `offline-scope.test.ts` and changed-file lint green.**
- [ ] **Step 5: Review checkpoint.** No new manifest, `localStorage` table, user identity derivation or weaker discard option.

### Task 4: Reproduce default-schema drawer-body loss, then fix only that path

**Files:**
- Modify: `src/tools/database/index.ts`, `src/tools/database/database-card-drawer.ts`
- Test: `test/unit/tools/database/database.test.ts`, `test/unit/tools/database/database-card-drawer.test.ts`

**Interfaces:**
- Consumes the existing `database-row` block and `richText` property shape. The default schema currently has title/status but no rich-text property (`src/tools/database/database-model.ts:284-321`); the drawer still mounts a body editor (`database-card-drawer.ts:637-669`).
- Produces no new public API. On the first changed drawer body with no `richText` column, the tool adds one real schema property, then stores the body in that row's `properties[propertyId]` and updates the drawer's description-property ID. Existing rows with a rich-text property keep their old path. This is a temporary legacy body representation; Task 6 moves it only when the host opts in.

- [ ] **Step 1: Write a regression through the database tool's public render/row APIs.** Reuse the `createMockAPI`/row-block fixture at `test/unit/tools/database/database.test.ts:85-130` and the drawer's mocked nested editor at `database-card-drawer.test.ts:8-51`.

```ts
it('saves a changed drawer body with the default schema', async () => {
  const body = { blocks: [{ id: 'body-p', type: 'paragraph', data: { text: 'Kept' } }] };
  const rowBlock = createMockRowBlock({
    id: 'row-1', position: 'a0', properties: { 'prop-title': 'Row' },
  });
  const tool = makeDatabaseWithDefaultSchema([rowBlock]);
  await editDrawerBodyThroughMockedBlok(tool, 'row-1', body);
  const bodyPropertyId = tool.save(document.createElement('div')).schema
    .find(property => property.type === 'richText')?.id ?? 'missing-body-property';
  expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { [bodyPropertyId]: body });
  expect(bodyPropertyId).not.toBe('missing-body-property');
});
```

The test-local `makeDatabaseWithDefaultSchema` uses the existing `DatabaseTool` constructor and `render()` pattern from `database.test.ts`; `editDrawerBodyThroughMockedBlok` clicks the rendered row, invokes the mocked nested editor's public `onChange` and resolves `save()` to `body`. Do not call a private `initSubsystems` or write the model directly. Tighten the assertion to the actual new property ID returned by the public schema after red is observed. Add close/reopen and serialized row-block checks: body remains, and a second edit reuses the same property rather than adding another.

- [ ] **Step 2: Run only the new test case with `yarn test test/unit/tools/database/database.test.ts -t "saves a changed drawer body with the default schema"`. Expected: red by source hypothesis. If green, stop and report the premise before changing code.**
- [ ] **Step 3: If red, implement the smallest fix.** On first body write with `descriptionPropId === undefined`, call the existing model `addProperty` once for a real `richText` column named with existing localized `tools.database.cardDetails` copy, set the drawer's description-property ID, and update the row block's properties immediately. The database block's ordinary save then includes both schema and row data. Send the optional backend schema call before its row call, but do not treat either callback as a durable receipt: `DatabaseBackendSync.safeCall` swallows failures and reports them through `onError` (`database-backend-sync.ts:18-22`). Do not invent an out-of-schema property key.

```ts
let bodyPropertyId = descriptionPropId;
if (bodyPropertyId === undefined) {
  const property = this.model.addProperty(this.api.i18n.t('tools.database.cardDetails'), 'richText');
  bodyPropertyId = property.id;
  this.cardDrawer?.setDescriptionPropertyId(bodyPropertyId);
  void this.sync.syncCreateProperty({ id: property.id, name: property.name, type: 'richText', position: property.position })
    .then(created => {
      if (created !== undefined) this.sync.syncUpdateRow({ rowId, properties: { [property.id]: description } });
    });
} else {
  this.sync.syncUpdateRow({ rowId, properties: { [bodyPropertyId]: description } });
}
this.updateRowBlock(rowId, { [bodyPropertyId]: description });
```

`setDescriptionPropertyId` is added to the drawer in this task; it replaces its current read-only field and is used by later open/save paths. The optional backend adapter's failure still reaches its existing `onError` route. The first body is safe in the row block's local saved document, but the host must not claim its backend callback committed until its own storage confirms it.

- [ ] **Step 4: Rerun the regression and existing database tests, then lint only changed files.**
- [ ] **Step 5: Review checkpoint.** Confirm default rows now preserve a body through save/reload, older rich-text rows are unchanged, and the row is still a block.

### Task 5: Preserve an optional row page ID through every row projection

**Files:**
- Modify: `src/tools/database-row/index.ts`, `src/tools/database/types.ts`, `types/tools/database.d.ts`, `src/tools/database/index.ts`, `src/view/document-schema.ts`
- Test: `test/unit/tools/database-row/database-row.test.ts`, `test/unit/view/document-schema.test.ts`, `test/unit/tools/database/database.test.ts`

**Interfaces:**
- Produces optional `DatabaseRowData.pageId?: string` and `DatabaseRow.pageId?: string`. It is a pointer on the row block, not a second row record.
- Consumes the current `toRowData`/`snapshot` field list (`src/tools/database-row/index.ts:6-19,52-63`) and `syncRowsFromBlocks` projection (`src/tools/database/index.ts:339-371`).

- [ ] **Step 1: Write failing preservation and schema tests.**

```ts
it('loads and saves a migrated row without dropping its pageId or legacy body', () => {
  const legacy = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Legacy' } }] };
  const tool = new DatabaseRowTool({ data: {
    properties: { description: legacy }, position: 'a0', pageId: 'row-page',
  } } as BlockToolConstructorOptions<DatabaseRowData>);
  const saved = tool.save(document.createElement('div'));
  expect(saved.pageId).toBe('row-page');
  expect(saved.properties.description).toEqual(legacy);
});
```

Add a schema-validation test for `pageId` as nonempty string and a legacy row with no `pageId` that saves without acquiring one. Add a database render test that the projected `DatabaseRow` passed to the drawer retains `pageId`. Avoid `any`, `@ts-ignore` and non-null assertions.

- [ ] **Step 2: Run only the new tests in the named files as separate scoped invocations and observe red.**
- [ ] **Step 3: Add the optional field to the internal and hand-authored published row types, both `toRowData`/`snapshot`, the row projection, and `database-row` in `document-schema.ts`.** Copy it only when a nonempty string was supplied. Do not erase the legacy rich-text property or expose the new ID as a column value.
- [ ] **Step 4: Run focused tests, `published-types-no-src-refs.test.ts`, `view/index.purity.test.ts` and changed-file lint green.**
- [ ] **Step 5: Review checkpoint.** A pre-migration row's saved shape is unchanged; a migrated row retains both the pointer and recovery blob through read/save.

### Task 6: Copy a legacy row body on first edit, then publish pageId only after durable confirmation

**Files:**
- Modify: `src/tools/database/types.ts`, `types/tools/database.d.ts`, `src/tools/database/index.ts`, `src/tools/database/database-card-drawer.ts`
- Test: `test/unit/tools/database/row-page-migration.test.ts`
- Modify: `docs/maintainers/offline-row-bodies.md`

**Interfaces:**
- Produces an opt-in `DatabaseConfig.rowPages` host seam:
  `copyFromLegacy(input: { rowId: string; operationId: string; body: OutputData }): Promise<{ pageId: string; transactionId: string; acceptedBody: OutputData }>` and
  `mount(pageId: string, holder: HTMLElement): { destroy(): void }`.
- `copyFromLegacy` is a host transaction: it fences all legacy-body writers at the authoritative row document, re-reads the latest row blob, compares it structurally with `body`, checks the old-client version gate if collaboration is used, then atomically writes the target page body, `row.pageId`, and operation record. It returns the accepted body and transaction ID only after durable commit. The host must make `operationId` idempotent, use one stable page ID per row across retries, and reject a changed request under the same ID. Blok mirrors the committed `pageId` locally only after a matching receipt; that mirror is not a second durability step. It never deletes `properties[descriptionId]`. Stock collaboration cannot enable this path without a host live-room transaction.
- Once a row has `pageId`, the drawer asks `rowPages.mount` to mount the page editor into its body slot; it does not mount the legacy nested editor in parallel. Without `rowPages`, legacy behavior stays on. The host owns the per-page persistence/collaboration config.

- [ ] **Step 1: Write failing migration and mixed-version tests.**

```ts
it('keeps the legacy blob authoritative until a matching durable page receipt arrives', async () => {
  const receipt = deferred<{ pageId: string; transactionId: string; acceptedBody: OutputData }>();
  const rowPages = makeRowPages({ copyFromLegacy: vi.fn(() => receipt.promise) });
  const harness = openLegacyRowWithBody(rowPages, 'Old body');
  harness.editBody('Latest body');
  expect(harness.rowData().pageId).toBeUndefined();
  expect(harness.legacyText()).toBe('Latest body');
  receipt.resolve({ pageId: 'row-page', transactionId: 'tx-2', acceptedBody: harness.savedBody() });
  await harness.settle();
  expect(harness.rowData().pageId).toBe('row-page');
  expect(harness.legacyText()).toBe('Latest body');
});
```

`deferred`, `makeRowPages` and `openLegacyRowWithBody` are test-local fixtures built from the `DatabaseTool` public constructor/render and mocked nested editor; define them in this new test file. The fake transaction must expose its authoritative row and page snapshots: before resolving the receipt, assert it committed both or neither. Add cases: target write rejects (legacy body remains editable/readable), response lost after durable commit then same-ID retry (one page document and one row pointer), body differs from the authoritative row (reject and retry after sync), second edit after migration (writes page document only), and host old-client gate refusal before migration (no `pageId`). While the transaction is pending, the drawer suspends legacy editing; the host fence rejects any other client legacy write and surfaces a conflict, never silently discarding it. In a two-client host fixture, attempt an older client's legacy write after the fence; assert that the live boundary refuses it and the old blob remains available for recovery. If a real host cannot make that last test pass, do not enable `rowPages` for collaboration.

- [ ] **Step 2: Run `yarn test test/unit/tools/database/row-page-migration.test.ts` and observe red.**
- [ ] **Step 3: Implement the opt-in handoff.** Update the local legacy rich-text property on the first edit, then suspend legacy editing while calling `copyFromLegacy` with a caller-stable operation ID and that body. The host accepts only when its authoritative row blob matches, fences other legacy writes, and atomically commits the page body, row pointer, and operation record. Accept only a nonempty page ID/transaction ID and an `acceptedBody` equal to the sent and current legacy body, using the existing `equalsOutputData` comparison; otherwise leave the local row on the legacy path and surface a retry/conflict. A lost response retries the same operation ID. Mirror the committed `pageId` on the existing row block after confirmation; do not treat that local update as durability proof. On migrated rows, mount only the host page body; a mount/load failure displays a non-editable failure state and keeps the legacy blob for recovery, never silently falls back to editing it. A row without the opt-in seam continues using the old body.
- [ ] **Step 4: Run focused test, row serialization/schema tests, and changed-file lint green.**
- [ ] **Step 5: Review checkpoint.** One row block and one authoritative live body remain. The host recipe must state that `v1.15.2` clients strip `pageId`, that every legacy writer must be fenced at the live-room boundary during migration, and that a consumer projection gate alone is insufficient.

## F release gate and handoff

- [ ] Run each new F test file separately while iterating, plus relevant existing offline, database-row, database drawer, document-schema, published-type and view-purity tests.
- [ ] Use a real host fixture to verify a selected never-opened page opens offline after reload, a second identity cannot inspect it, and the host downloads no subpages. Measure cold and warm page-open durations with the same page and device profile, record the numbers, and optimize neither prefetch nor sockets without measured evidence.
- [ ] Run a host export/import of a permitted three-level subtree with internal page and block links, an inaccessible sibling, and a retry. Check one owner per imported page, stable internal links and no restricted source title in exports.
- [ ] Run a mixed-version row migration check with an old open tab: either the live-room version gate refuses its write or keep migration disabled. Check legacy body recovery after a failed copy and after a new page mount failure.
- [ ] Run the repository's final gates required by current project instructions and obtain independent review. Preserve the shared checkout; do not stage unrelated work.
