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

`DatabaseConfig.rowPages` is an opt-in host integration for moving a row's rich-text body into a page document. Blok has no built-in transaction or live-room fence for this handoff. Do not enable it with stock collaboration. A host must first verify the live-room gate against an older open client; a consumer-side version check is not enough. Version `v1.15.2` clients strip `pageId` and can still write the legacy row body.

The host supplies `copyFromLegacy({ rowId, operationId, body })` and `mount(pageId, holder)`. Treat a copy as one transaction:

1. At the authoritative row document, refuse every other legacy-body writer and any old client that can still write it.
2. Re-read the row body and compare it structurally with `body`. Reject a changed body; let the editor keep the legacy body for a later retry.
3. Commit the page body, the row's `pageId`, and an operation record together. Use one stable page ID per row. A retry with the same `operationId` and body returns the same receipt; a changed body under that ID is rejected.
4. Return `{ pageId, transactionId, acceptedBody }` only after the commit is durable. Blok mirrors `pageId` on the row only after that matching receipt; this local mirror is not proof of durability.

`mount` owns the page editor's access checks, persistence, and collaboration settings. A row with `pageId` uses that editor, not the legacy nested editor. If mounting fails, show a non-editable error state. Keep the legacy rich-text property for recovery; do not delete it as part of the handoff. A failed copy leaves the row on the legacy path.

Before enabling this integration for shared documents, test a real host with an old tab still open: its legacy write must be refused at the live-room boundary. Also check that failed target writes leave neither a page nor a pointer, and that a lost response retried with the same operation ID creates only one page. The unit contract fixture does not verify a real host fence.
