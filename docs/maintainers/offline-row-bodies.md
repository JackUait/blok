# Offline page controls in a host

Blok stores collaboration data under the host-supplied `offlineScope`. The host chooses that scope, the exact sync `url` and `doc`, and which pages a viewer may use. Do not derive a scope from a page title or reuse one across accounts.

`listOfflinePages(scope)` returns every partition in that scope, including partitions with only pending operations or quarantine data. Show `outbox`, `quarantine`, `updates`, and `mayHaveUnsentV1Edits` before offering removal. A partition is identified by its exact `url` and `doc` pair; a document ID alone can refer to different servers.

```ts
const partitions = await listOfflinePages(offlineScope);
const selected = partitions.find(row => row.url === syncUrl && row.doc === pageId);

if (selected !== undefined && viewerConfirmedDiscard) {
  await forgetOfflinePage(
    offlineScope,
    { url: selected.url, doc: selected.doc },
    { discardPending: true }
  );
}
```

The host must close or switch active editors before forgetting a partition. An open IndexedDB handle can block deletion; the function waits for success or error and may remain pending until the other tab closes its handle. Do not report success while it waits. `discardPending: true` can destroy unsent edits; never pass it without an explicit viewer decision. To log out an account, use `inspectOfflineScope` and `forgetOfflineScope` for the whole scope after the same confirmation and close steps.

Forgetting a local scope removes bytes only on this device. Other offline devices keep their copies until they reconnect and the host enforces access there. Neither the per-page list nor deletion changes the server's access policy.

## Database row bodies

`DatabaseConfig.rowPages` is an opt-in host integration. It moves a row's rich-text body into a page document. Blok has no built-in transaction or live-room fence for this handoff. Do not enable it with stock collaboration.

### Host methods

```ts
interface DatabaseRowPages {
  lookup(input: { rowId: string }): Promise<{ pageId: string; acceptedBody: OutputData } | null>;
  copyFromLegacy(input: { rowId: string; operationId: string; body: OutputData }): Promise<DatabaseRowPageReceipt>;
  reconcileLegacy(input: {
    rowId: string; pageId: string; operationId: string; body: OutputData; acceptedBody: OutputData;
  }): Promise<DatabaseRowPageReceipt>;
  mount(pageId: string, holder: HTMLElement): { destroy(): void };
}

interface DatabaseRowPageReceipt { pageId: string; transactionId: string; acceptedBody: OutputData }
```

`acceptedBody` is the legacy body the page has already taken in. Blok compares bodies by blocks only. `time`, `version` and edit stamps do not count.

### Never copy a row twice

The row's `pageId` is only a mirror. Older clients delete it (see below). So Blok never treats a missing `pageId` as "not moved".

- `lookup` is the source of truth. Return the row's page, or `null` if the row was never moved. It must read durable host state, not the row's `pageId`.
- Blok calls `lookup` when a row opens, before every copy, and when a peer's change drops `pageId` or changes a moved row's legacy body.
- While `lookup` runs, the body stays empty and inert. If it fails, Blok shows the non-editable error state and an error toast. This also holds for the lookup before a copy. It never falls back to the legacy editor.
- A row that already has `pageId` mounts its page at once. Its lookup runs in the background, only to catch an old client's edit. If that lookup fails, Blok stays quiet: the page is shown, and the legacy body waits for the next check.
- An old-client edit that lands while a reconcile is in flight is merged by a second reconcile right after.
- When `lookup` returns a page, Blok writes `pageId` back to the row. The write is derived, so undo does not remove it.
- `copyFromLegacy` on a row that already has a page MUST reject. It must never overwrite the page. Blok then calls `lookup` and goes down the reconcile path with the body the user typed.

Treat a copy as one transaction:

1. At the authoritative row document, refuse every other legacy-body writer you can.
2. Re-read the row body and compare it with `body`. Reject a changed body. The editor keeps the legacy body for a later retry.
3. Commit the page body, the row's page record, and an operation record together. Use one stable page ID per row. A retry with the same `operationId` and body returns the same receipt. A changed body under that ID is rejected.
4. Return the receipt only after the commit is durable. Blok mirrors `pageId` on the row only after a matching receipt. This mirror is not proof of durability.

### Reconcile: keep both bodies

An older client can still change the legacy body after the copy. Blok sees this when the row's legacy body differs from `acceptedBody`. It then calls `reconcileLegacy` with the current legacy `body` and the `acceptedBody` it compared against.

The host must:

- Merge `body` into the existing page. Never overwrite the page. Keep both: for example, append the legacy blocks after the page content.
- Do nothing if `body` already equals the stored `acceptedBody`. Many clients may reconcile the same change at once; it must land once.
- Store `body` as the new `acceptedBody` in the same durable commit.
- Return `{ pageId, transactionId, acceptedBody }` with the same `pageId` and `acceptedBody` equal to `body`.

Blok checks the receipt. Then it restores `pageId` if it was missing. A new client never writes the legacy property for a row it knows is moved. In the race above it has already saved the typed body before it learns of the move; reconcile carries that body into the page. A read-only editor does not look up, reconcile, or write anything.

`mount` owns the page editor's access checks, persistence, and collaboration settings. A row with a page uses that editor, not the legacy nested editor. If mounting fails, Blok shows a non-editable error state. Keep the legacy rich-text property for recovery. Do not delete it as part of the handoff.

### What v1.15.2 clients do

Checked by running v1.15.2 code in jsdom (no real socket), unless marked "code reading".

- Its row tool saves only `properties` and `position`. Its save flush then deletes every other top-level key. So any local row write removes `pageId` for everyone. Opening and closing the row drawer is enough, even with no typing: closing re-saves the body with a new `time`.
- A remote update alone does not strip `pageId`. Booting does not either.
- Its database tool also sends row bodies to the host adapter (`adapter.updateRow`, 500 ms debounce). No collaboration fence sees that path (code reading).
- The current row tool keeps top-level keys it does not know, so future keys survive this version's saves. One limit: the save path HTML-sanitizes an unknown string key (`a & <b>x</b>` becomes `a &amp; x`). A row tool cannot declare a rule for keys it does not know; that needs a core change.

### Fences against old clients

Reconcile is the safety net. It is the only route that also covers the adapter path. Use a fence only to make it rarer.

- **Read-only tickets for old clients.** v1.15.2 fetches its ticket with a plain GET and sends no version or capability. A host can mint `write: false` tickets for clients that do not present a capability header. A v1.15.2 tab then boots locked. Limits (code reading): it only works for hosts that use `ticket`; an open tab keeps its cached ticket until it nears expiry, so the host must close it with code 4401 to force a new ticket; and turning read-only re-saves an open drawer, which still calls `adapter.updateRow`. When such a tab re-mints and locks, its unsent room writes are dropped or quarantined. They never reach the legacy body, so reconcile cannot see them.
- **Read-only via the server's own write check, or a capability token on connect.** Do not use these to make old clients read-only. The old UI stays editable. Version 1 writes are dropped and version 2 writes are quarantined (code reading). That loses edits silently. Refusing the connection (4403) is safe but ends the old tab's session.
- **Reconcile alone.** Covers the room and the adapter, as long as `lookup` reads durable host state and `reconcileLegacy` keeps both bodies.

Before enabling this for shared documents, test a real host with an old tab open. Check that its edit after the copy shows up in the page. Check that failed target writes leave neither a page nor a pointer. Check that a lost response retried with the same operation ID creates only one page. The unit contract fixture does not verify a real host.
