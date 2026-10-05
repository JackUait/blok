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

`executePageTransfer` checks that the host returned a matching transaction receipt. It cannot inspect the host's database or make a false receipt durable. The stock `/sync/{doc}/edit` HTTP 204 is not a transfer receipt. A saved-document adapter is barred while collaboration is active: its consumer projection may lag the live room. A live adapter must transact the authoritative room state, not just consumer GET/PUT snapshots. Until a host supplies and tests that boundary, leave collaborative cross-page transfer disabled.

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
