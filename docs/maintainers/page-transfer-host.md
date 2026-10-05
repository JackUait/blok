# Page transfers in a host

Blok's page-transfer functions calculate new document snapshots. They do not check access or save either document. A `page` block owns a page document; moving that pointer does not move the body it names.

## Transaction boundary

Use one host operation ID for the first attempt and every retry. In a transaction against the authoritative documents:

1. Look up the operation ID. If it exists with the same request digest, return its recorded receipt. If the digest differs, reject the request.
2. Check source read/write and target write access. Check that moving an owning pointer will not create a page-tree cycle or a second owner.
3. Read the latest source and target documents. Do not use browser snapshots.
4. Run the applicable pure transform, such as `movePageBlocks`, `turnBlocksIntoPage`, or `turnPageIntoBlocks`. For the reverse conversion, load the matching page body before removing its pointer.
5. Atomically save every changed document and the operation record. Return a receipt only after that commit is durable.

A failure before commit leaves the source intact. If the response is lost after commit, retry the same operation ID and return the stored receipt without applying the transform again. Retain operation records for at least the host's retry and Undo window.

`executePageTransfer` checks that the host returned a matching transaction receipt. It cannot inspect the host's database or make a false receipt durable. The stock `/sync/{doc}/edit` HTTP 204 is not a transfer receipt. A saved-document adapter is barred while collaboration is active: its consumer projection may lag the live room. A live adapter must transact the authoritative room state, not just consumer GET/PUT snapshots. Use the sidecar adapter below, or a host transaction you test yourself. Otherwise leave collaborative cross-page transfer disabled.

## The sidecar adapter

`createSidecarTransferHost({ baseUrl, ticketFor, log, fetch?, maxEditBytes?, maxAttempts? })` from `@bloklabs/core/view` returns a `live-saga` host. It works with the stock collab sidecar. `executePageTransfer` and `undoPageTransfer` accept it while collaboration is on.

**Requirement.** The sidecar must run with an operation journal (`--collab-journal`). Without one, `/state` and `/edit` return no `Blok-Doc-Lineage`/`Blok-Doc-Sequence` headers. The adapter then refuses before it writes anything. It also stops on any 428. An edit 204 without those headers has already applied its copy. The adapter stops there and keeps the source, so the receiving page keeps that copy.

The adapter hashes idempotency keys with `crypto.subtle`. Browsers expose it only in a secure context (HTTPS or localhost). Elsewhere it fails before any write.

`/state` needs a read pass and `/edit` a write pass. In `--auth ticket` the server requires an allowed `Origin` on every request. A browser sends it. A Node host does not, so pass a `fetch` that adds an allowed `Origin` header.

`test/unit/view/page-transfer-sidecar.server.test.ts` runs the adapter against the real host. Set `BLOK_CONFORMANCE_SERVER` to a built `Blok.Server.Host` to run it.

**Guarantee.** No blocks are lost. A copy may show in both pages for a short time. The steps are:

1. Read `GET /sync/{doc}/state` for both pages. Run the pure transform on that fresh state.
2. Insert the copy into the receiving page. Large copies are split into requests under `maxEditBytes` (the server's `CollabMaxMessageBytes`, 1 MiB by default). Parents go first. Every request carries `If-Match`: the first uses the head read in step 1, and each later one uses the receipt of the request before it. Each request must return a durable receipt.
3. Remove the blocks from the giving page in one request, with `If-Match` set to the head read in step 1. For turn-into-page, the same request inserts the pointer.
4. On 412, a peer changed the giving page. The adapter removes its copy and tries again from a fresh read, up to `maxAttempts` times. The removal carries `If-Match` set to the receipt of its last copy request. So it only lands while nobody else has touched the receiving page since the copy. If anything changed there, the adapter leaves the copy and throws. Both pages then hold the blocks.

The adapter never decides "this copy is mine" from content. Two runs with the same operation ID can overlap, for example when a host retries while the first call still runs. They write the same IDs and data. A content check would let one run delete the other run's copy just before that run removes the source. The head check rules this out. A busy receiving page therefore ends with a duplicate more often, never a loss.

**Recovery.** The host supplies `log: { get(operationId), put(record) }` and stores each record as given. Blok stores nothing. The adapter writes the exact request bodies to the log before the first edit. A retry with the same operation ID replays the same bodies and idempotency keys. The journal then returns the first result instead of applying it again. A network error or 5xx is treated as unknown: the adapter throws and keeps the log, and a retry resolves it. It never rebuilds the plan on a retry before the logged plan gets a definite answer. If a page's lineage changed since the record was written, the journal forgot those keys. The adapter refuses, because the outcome is unknown.

**Directions.** For `move-blocks`, `reparent-page` and `turn-into-page`, blocks go from `sourcePageId` to `targetPageId`. For `turn-into-blocks`, `sourcePageId` is the page being emptied and `targetPageId` holds its pointer. The pointer must name `sourcePageId`.

**Limits.**

- `duplicate-page` is refused. It needs every copied body in one transaction.
- Undo covers `move-blocks` and `reparent-page`. It runs the reverse saga under a new operation ID, using the placements stored in the log. It refuses if the roots are no longer together at the destination. It checks position only. It cannot prove the roots still belong to that transfer. If a peer moves them away and back to the same place, Undo still runs. Undo also does not recheck page owners or cycles. The host must do that before calling it. Undo of `turn-into-page` and `turn-into-blocks` is refused: run the inverse transfer instead.
- The adapter cannot see the page tree or permissions. `ticketFor(doc, { write })` supplies each pass, and the server checks it. The host must still check owning-page cycles beyond a pointer that names its own target.
- A block field that an `/edit` insert cannot carry, such as a non-zero `indent`, is refused rather than dropped.

## Deep page duplication

For `duplicate-page`, the host walks the current owning `page` pointers from the selected source pointer. Check read access on every descendant and write access at the destination. Reject a cycle, a duplicate owner, or an unreadable descendant before publishing any copy. Non-owning `page-link` and inline references do not add descendants.

Allocate fresh page IDs for the whole subtree and fresh block IDs for each body. Call `remapPageDocument` once per body with the complete page-ID map. Then commit **all** copied bodies and the final new owning pointer in one durable host transaction. The original pointer and bodies stay unchanged. If the host cannot commit the whole subtree atomically, refuse duplication; hidden partial copies are not a receipt.

Persist the operation ID, allocation map, request digest, and receipt together. A retry after a lost response returns that receipt and the same copied page IDs, with no second owner. Do not use a Blok-owned page store or treat the stock sidecar's per-document 204 as this transaction.

## Undo and access

The host owns the destination picker and Undo toast. A cross-document Undo is a new, receipt-scoped transaction, not `history.undo()` or a Yjs history entry. Keep the original operation record, its Undo token, and each moved root's original placement and provenance for the Undo window.

For `undoPageTransfer`, use a new caller-stable operation ID. In one transaction against the latest authoritative documents:

1. Look up the Undo ID. Return its recorded receipt for the same request digest; reject a different digest.
2. Match the original receipt and Undo token to the committed operation record. Recheck access to both pages.
3. Check each root is still at the committed destination and still belongs to that transfer. If a peer displaced or deleted it, refuse without changing either document.
4. Move the **current** subtree back to its recorded source placement, including peer edits and children. Recheck owners and cycles. For a deep duplicate, remove its pointer and every copied page body in the same transaction. If a peer changed any copied descendant, refuse the whole Undo. Equality with an old snapshot alone is not proof.
5. Atomically save the inverse documents and Undo record. Return the Undo receipt only after the commit is durable. A lost response is retried with the same Undo ID.

The gate validates both receipts but cannot inspect host storage or infer peer ownership. A conflict leaves peer work intact. Keep page titles, icons, permissions, trash, and the page catalog in host records. Do not infer ownership from links or URLs.
