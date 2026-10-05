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

**Guarantee.** No blocks are lost, outside the one window below. Blocks may end in both pages. The adapter never deletes a copy. The only destructive edit is the source removal, and it runs only after the copy is verified. The steps are:

1. Read `GET /sync/{doc}/state` for both pages. Run the pure transform on that fresh state. Write the plan to the log. The plan is never rebuilt under the same operation ID.
2. Insert the copy into the receiving page. Large copies are split into requests under `maxEditBytes` (the server's `CollabMaxMessageBytes`, 1 MiB by default). Parents go first. Each request must return a durable receipt. The copy carries no `If-Match`: the server already refuses an insert whose parent, sibling or ID no longer fits.
3. Read the giving page again. Every block being removed must look exactly as planned: same data, parent and children. If not, a peer changed them, so the source stays.
4. Read the receiving page again. Every copied block must be there with the planned data, parent and children. If not, the copy is incomplete or changed, so the source stays.
5. Remove the blocks from the giving page in one request, with `If-Match` set to the head read in step 3. For turn-into-page, the same request inserts the pointer. On 412, a peer edited elsewhere in the giving page. The adapter goes back to step 3, up to `maxAttempts` times.

Any failure leaves the source plus whatever copy exists, whole or partial. The error says which page holds what.

**The remaining window.** Step 4 and step 5 touch two documents, and no request can guard both. If someone deletes the copy after step 4 reads it and before step 5 lands, the blocks are gone from both pages. That window is one read and one edit long. Only a deletion of the copy in it loses blocks. A peer edit does not.

**Keys and overlapping runs.** Each request's idempotency key is a hash of the operation ID, the step and the chunk index. Nothing else goes into it. Two runs with the same operation ID can overlap, for example when a host retries while the first call still runs. They then send the same keys. With the same body the journal applies it once. With a different body, from a plan built at another moment, the server answers 409 and that run stops before writing.

**Recovery.** The host supplies `log: { get(operationId), put(record) }` and stores each record as given. Blok stores nothing. A retry with the same operation ID replays the logged plan: the journal answers committed requests with their first receipt and applies the rest. A partial copy therefore resumes. A network error or 5xx is treated as unknown: the adapter throws, and a retry resolves it. If the source no longer looks as planned, the adapter replays the removal with the planned head. If that removal was already committed, this returns its receipt. Otherwise the stale head makes the server refuse. If a page's lineage changed since the plan, the journal forgot those keys, and the adapter refuses because the outcome is unknown.

If the user deletes the copy after a failure, a retry with the same operation ID will not insert it again: its keys are already committed. The retry reports the copy as incomplete and keeps the source. Use a new operation ID to copy again.

**Directions.** For `move-blocks`, `reparent-page` and `turn-into-page`, blocks go from `sourcePageId` to `targetPageId`. For `turn-into-blocks`, `sourcePageId` is the page being turned back and `targetPageId` holds its pointer. The pointer must name `sourcePageId`. The blocks land next to the pointer, and removing the pointer is the destructive step. The page body is left as it is; the host retires that page.

**Limits.**

- `duplicate-page` is refused. It needs every copied body in one transaction.
- Undo covers `move-blocks` and `reparent-page`. It runs the same steps in reverse under a new operation ID, using the placements stored in the log. Its plan is fixed once, like a transfer's. It refuses if the roots are no longer together at the destination. It checks position only. It cannot prove the roots still belong to that transfer. If a peer moves them away and back to the same place, Undo still runs. Undo also does not recheck page owners or cycles. The host must do that before calling it. Undo of `turn-into-page` and `turn-into-blocks` is refused: run the inverse transfer instead.
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
