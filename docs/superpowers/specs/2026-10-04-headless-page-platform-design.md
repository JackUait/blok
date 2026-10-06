# Headless Page Platform Design

Date: 2026-10-04
Status: approved by user on 2026-10-04
Scope: the full page-feature roadmap, delivered as independent, testable slices.

## Intent and boundary

Blok supplies document-level editing, page pointers, pure document analysis, and safe operations needed by a host application. The host owns persistent page records, documents, users, roles, search indexes, per-user preferences, and the presentation of workspace UI. Blok does not ship a sidebar, global search screen, trash screen, favorites screen, access-settings screen, or page database.

The one editor-owned exception is feedback for an inaccessible page block: a lock icon and an accessible explanation dialog on click or Enter. This is distinct from a readable page that is merely read-only.

Success means a host can build all of those screens with documented public Blok primitives, without reaching into playground code or private modules. The first real integration must survive reload, a second device, concurrent edits, permission changes, and failure/retry paths.

This design develops the 2026-10-01 page-block research and Notion-parity reports. Their “research only; nothing built” banners are stale. The current page tool already exists; its public contract is in `types/tools/page.d.ts`.

## Non-negotiable model

- Each page body is one ordinary Blok document, identified by an opaque, title-free `pageId`. Its content is blocks. A host must not use a title or URL slug as the ID: the ID is saved in readable parent documents.
- A `page` block in another document is an owning pointer. Its position in that document defines the parent-to-child edge and sibling order. It does not contain or duplicate the target body.
- A link or mention to a page is non-owning. Copying, pasting or drag-duplicating an owning pointer must not silently create a second owner, including when no `href` callback is configured.
- The host's page record is the canonical source for title and icon. Blok's page pointer saves `pageId` only. Old `data.cache` is accepted on input for migration but is neither displayed before access resolution nor saved again. Hosts must remove old caches before providing shared parent documents to unauthorized readers; a browser-side cleanup cannot undo an earlier disclosure.
- A host-supplied `resolve(pageId)` returns only metadata the current user may see. `subscribe(pageId, notify)` must notify in the same tab as well as other tabs/devices. A page block re-resolves on notification. Async replies use latest-request-wins ordering, so a stale allowed response cannot undo a newer access denial. `null` means missing; `{access:'none'}` means inaccessible. Neither state displays cached metadata.
- The host owns the title save and version/conflict policy. Local editing changes the open header, tree, and links immediately, then persists to the host. On rejected save it restores the last accepted title and shows an error. Undo/redo update the canonical record as ordinary title changes. `history.track('title')` may remain the collaborative/undo mirror, but its Yjs value is not a durable replacement for the host record: the C# consumer export currently contains only `time` and `blocks`.
- The host's catalog derives ownership edges from saved `page` blocks, rather than maintaining an independent editable parent/order tree. A missing or duplicate owner is reported for repair, not silently guessed.

No workspace documents or catalog records are stored by the Blok sidecar. Its existing per-document room, ticket and GET/PUT persistence remain the basis for collaboration.

## Slices and acceptance

### A. Safe page pointer and metadata updates

The page tool must save only `pageId`. With no resolved metadata it renders a neutral label, not an old cached title. When access is denied, it renders a lock and “No access”; click and navigation-mode Enter open a localized, accessible explanation dialog and never navigate. Missing-page behavior stays distinct. Host-provided resolved titles/icons update without an undo entry, including in the same tab, and local title editing/Undo remains instant. Copy, clipboard output, plain-text/Markdown conversion, hover preview, static HTML and raw saved JSON must not use an untrusted cached title or icon. Static rendering receives metadata explicitly from the host: allowed pages show their title, `access: 'none'` shows a non-link lock and “No access”, and missing metadata shows a neutral “Page” label. Static HTML has no event loop, so its host handles any explanatory dialog there. A page URL supplied by the host must not encode a restricted title.

The host continues to enforce document access. A dialog is not authorization. Legacy caches must be removed from the authoritative consumer record, collaboration working set and journal/checkpoint before an unauthorized reader can receive the parent document; filtering only the consumer GET does not clean a live room. Old clients must be rejected from affected rooms or prevented server-side from writing `cache` back after migration. A host integration example documents that migration and the title notification contract.

Acceptance: the page pointer never generates a restricted title/icon in its visible DOM, clipboard output, static exports, or saved data; the host strips legacy pointer caches before serving a parent document to an unauthorized reader. Author-written text elsewhere in that document is outside this guarantee. An authorized reader sees an immediate title change in header/tree/link, including after Undo and across tabs.

### B. Document facts for host-built workspace UI

Publish a small DOM-free `pageIndex(data)`-style extractor in `@bloklabs/core/view` returning owning page edges (with source block IDs and order), non-owning page references, and searchable text per block. Build on existing plain-text conversion and typed block traversal rather than a workspace store. The host calls it on each consumer document save and writes its own index transactionally with that projection. In collaboration mode the room can accept edits before its deferred PUT, so workspace search/backlinks are eventually consistent with the live room; a host may overlay current local results for instant feedback. Blok does not provide a cross-page search database or a sidebar component.

Publish a pure tree projection over host-supplied owning edges and access-filtered page metadata, with cycle, duplicate-owner and missing-page diagnostics. The host uses that projection to render its own tree and breadcrumbs, and uses indexed text/references for search and backlinks. Results and backlink sources are filtered under host access rules. Favorites/recent pages are per-user lists of page IDs in the host; no new Blok API is needed.

Acceptance: after the consumer save catches up, rename/move of an owning pointer changes the host tree without duplicate parents; search and backlinks reflect that saved projection and expose no inaccessible source titles.

### C. Links, mentions, and in-editor selection

Give the editor a host-supplied async page search callback only where it needs to offer an in-editor page picker. Provide distinct owning `page` and non-owning link-to-page blocks, and an inline page reference identified by `pageId`, not only by URL. Add editor-owned `@` and `[[` triggers for inserting that reference; a normal URL mention remains a separate case. References retain their identity across rename and move. A link's saved HTML attributes, paste sanitizer, view renderer and copy/paste path must agree. Notion paste must map subpages and link-to-page blocks to the corresponding Blok blocks instead of bookmarks or dropped blocks. The host renders global quick-find, backlinks, and navigation UI.

Acceptance: a link/mention survives round-trip, paste and rename; an inaccessible result is not selectable or exposed; keyboard and screen-reader behavior work for the picker.

### D. Access lifecycle, trash, and purge

The host defines grants, inheritance, trash retention, restore, and permanent deletion. Blok's server already asks a registered `IBlokAuthorization` about each document at connection/edit time; add a targeted way to recheck or close a live document/member session when the host revokes access. Do not use a document reset as an ACL operation. Add a fenced, authorized document purge seam covering the working set and any journal, so permanently deleted content cannot be resurrected from sidecar state. Expose a client operation to forget the complete opt-in offline partition on logout/account switch, including adoptable updates, pending outbox and quarantine. Because pending edits may be unsent, the API reports them and requires an explicit host discard decision rather than silently losing them. Active tabs must close or switch scope before forgetting, so they cannot recreate the old partition. Offline devices already holding bytes cannot be remotely erased until they reconnect; document that limit.

Acceptance: revoked users cannot continue reading/writing through an already-open connection; trash/restore preserves data; permanent purge and cache forget do not revive it on restart/reconnect. A second user cannot see restricted metadata in a parent document.

### E. Cross-document operations and Undo

A page reparent moves only its owning pointer. “Turn into page” and its reverse (“turn page into blocks”), moving ordinary blocks across pages, and deep page duplication move/copy document content. The reverse operation must load the target body before replacing the pointer; a failed load leaves the page intact. No source deletion may follow merely from a `204` edit response: the stock server can acknowledge an edit before durable persistence. Specify a durable target receipt or a host-supplied transactional transfer, idempotency key, retries and crash recovery before enabling collaborative transfer. Preserve IDs when moving and mint fresh IDs when duplicating. Reject cycles and check permissions for source and target. Undo must reverse one completed transfer, not delete a different peer's work. The host draws the destination picker and toast; Blok supplies operations/receipts.

Acceptance: injected failure at each phase leaves data in at least one document, retries create no duplicates, concurrent typing is not silently discarded, and Undo restores the intended blocks.

### F. Export, import, offline, and database rows

Provide only the missing per-document link-rewriting and ID-remapping primitives so the host can export or import a permitted page subtree with stable internal links. The host traverses its own page tree and chooses archive format, filenames, and UI. Add a headless download/sync operation for a host-selected page so it can become available offline without opening an editor. Add per-page offline list/forget controls and measure cold/warm page open before optimizing prefetch or socket use; subpages are not downloaded implicitly. First reproduce and fix the default-schema drawer-body loss, if the reported defect still exists. Then migrate database-row bodies to page documents only through a read-compatible, opt-in path: make old row tools preserve new page identifiers, copy a body on first edit, confirm persistence, and keep the old blob readable until the host can retire it. A migrated row needs a version gate or a tested reconciliation rule: an older client can keep editing the legacy body after the copy, and that edit must not vanish.

Acceptance: export/import preserves nesting and links within the allowed subtree; a selected, previously unopened page can open offline after download, offline scope never crosses users, and old database rows keep their body through mixed versions.

## Additional product features

Covers, templates, favorites, recent pages, side/center peek, comments, history/version lists, public links, and access-setting screens remain host presentation and records. Blok only adds a primitive when a concrete integration test proves a missing editor or document capability. Page titles/icons stay host metadata; a cover is also host metadata unless it is inserted as a content block. Block IDs already serve as anchors for host comments and links. No speculative `PageStore` class or built-in workspace shell is added.

## Delivery order and compatibility

Implement A, B, C, D, E and F as separate written implementation plans and independently verified changes. Security-critical D may be pulled ahead of C where an integration needs ACLs before mentions. E cannot ship until the durability contract is proven. Treat row migration and protocol changes as separate release notes. Before labelling a public API change BREAKING, compare it with the latest published tag; the page tool was introduced after `v1.15.2` as of this design's initial investigation.

Each code slice follows red-green-refactor with scoped new tests while iterating, changed-file lint, then the project's final gates. Ship a small host integration recipe with each new public primitive, not a bundled page database or workspace UI. Include a real-host two-user/two-tab check for metadata and access, fault-injection tests for transfer/purge, published-type drift checks, paste-law tests for inline references, all-locale translation checks for new copy, and an independent review by parallel subagents. Never create a branch or worktree; preserve unrelated work in the shared main checkout.

## Existing evidence and remaining design work

- `types/tools/page.d.ts:21-95`: current pointer and host hooks.
- `src/playground/page-host.ts:17-46,129-153,211-219`: local registry and tab notifications; same-tab `setTitle` does not notify page-block subscribers.
- `src/playground/page-tree.ts:86-125`: tree from page blocks, private to the playground.
- `types/view.d.ts:211-248`: plain-text extraction for indexing.
- `packages/server/dotnet/Blok.Server/Collab/CollabDocConverter.cs:15-44`: document export does not persist a tracked title.
- `packages/server/dotnet/Blok.Server.AspNetCore/IBlokAuthorization.cs:5-53`: optional per-document access checks.
- `packages/server/dotnet/Blok.Server/Collab/ICollabWorkingSetStore.cs:49-71`: no delete.
- `docs/plans/2026-10-01-page-block-notion-parity/1-move-undo.md`: evidence on non-atomic transfer and unsafe edit acknowledgement.

This umbrella design fixes the ownership boundary and acceptance criteria. Each slice's implementation plan must choose exact public signatures after checking its current code and release boundary; it may not weaken the invariants here.
