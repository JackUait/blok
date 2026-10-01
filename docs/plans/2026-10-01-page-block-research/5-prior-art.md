# Prior art: Notion-style "page blocks" in open-source block editors

Research date: 2026-10-01. Read-only. Every link pins a commit SHA (or a release tag) so line anchors stay valid.

Evidence labels:
- **Verified**: I read the cited source lines in this session.
- **Inference**: my reading of verified code. The step that is not in the code is named.
- **Unverified**: not checked. It is stated only as a lead.

Pinned revisions:

| Repo | Revision |
|---|---|
| toeverything/AFFiNE (BlockSuite now lives in `blocksuite/` here) | `b71bb7cfc45f66998ed3827ba5606e0420f8fbb4` |
| AppFlowy-IO/AppFlowy | `5cf3a365dec0d59f64bad1ee4bb1050471a39b93` |
| AppFlowy-IO/AppFlowy-Collab | `be5aa89b4aeafd4e7159e92b86784c02caaa85ce` |
| outline/outline | `05ef55e38aeb3b625e819edab907c7ee2d33af8a` |
| yjs/yjs | tag `v13.6.32` (the version Blok pins in `package.json`) |
| ueberdosis/hocuspocus | `c7e372e77d43c1bc6cf2d0d61252c9c815a5b327` |
| docmost/docmost | `b6434371ed5fe5aada45126cdf7fe3aae9b22fcf` |
| makeplane/plane | `e72bf10fa529d0764a671b19d0657fb244882811` |
| anyproto/any-block | `c0f4f77bdf91d1759b32acd0a5fbbe426230c73d` |
| logseq/logseq | `a538a9b60c95490c35bf278903e60f3a9f03a330` |
| hcengineering/platform (Huly) | `e4fd72b36a03e9ef531ea20d32cc14ecda6596c1` |
| suitenumerique/docs (La Suite "Docs", built on BlockNote) | `bd71ed87e1050b1ff3eb0208bfff9f5d290a5442` |

---

## 0. The one-line finding

Every project I checked stores **one CRDT document per page, plus a separate tree or metadata store** that says which pages exist and who their parent is. None of them ships embedded Yjs subdocuments over a stock provider in production today.

| Project | Per-page content | Tree / metadata store |
|---|---|---|
| AFFiNE | one `Y.Doc` per doc, `guid = docId` | `rootYDoc.getMap('meta').pages` |
| AppFlowy | one `Document` collab per view | one `Folder` collab (`views` + `relation`) |
| Outline | one Y.Doc per document (`document.<id>`) | SQL `parentDocumentId` + `Collection.documentStructure` |
| Docmost | `pages.ydoc` column | SQL `pages.parentPageId` + `position` |
| Plane | `Page.description_binary` | SQL `Page.parent` |
| Huly | `Document.content` blob ref | `Document.parent` |
| La Suite Docs | one doc per node | treebeard `MP_Node` materialized path |

The **page block** inside a parent page is, in every editor that has one, a **pointer**: `{ pageId }` (AFFiNE), `{ view_id }` (AppFlowy), `{ docId }` (La Suite), `targetBlockId` (Anytype). The block does not hold the child page's content.

---

## 1. AFFiNE / BlockSuite

### 1.1 Model: doc-as-page, workspace root doc holds the page list

- The page list is a Y.Array at `rootYDoc.getMap('meta').get('pages')`. **Verified**: [docs.ts L40-L45](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/frontend/core/src/modules/doc/stores/docs.ts#L40-L45) and [meta.ts L95-L100](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/frontend/core/src/modules/workspace/impls/meta.ts#L95-L100).
- Each entry is a `DocMeta { id, title, tags, createDate, updatedDate?, favorite?, trash? }`. It has **no parent field**. **Verified**: [workspace-meta.ts L13-L21](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/framework/store/src/extension/workspace/workspace-meta.ts#L13-L21).
  - **Inference**: AFFiNE's page hierarchy is not stored in the doc meta. Whatever drives sidebar nesting lives somewhere else. I did not trace it.

### 1.2 Subdocs today: a compat stub, with content in a separate non-embedded Y.Doc

[`DocImpl._initSpaceDoc` L26-L45](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/frontend/core/src/modules/workspace/impls/doc.ts#L26-L45) does three things. **Verified**:

1. It writes an **empty placeholder subdoc** into `rootDoc.getMap('spaces')` if one is missing. The comment there reads: "old version relies on the subdoc instance on `spaces`… new version no longer needs subdoc on `spaces`."
2. It creates the real content doc as a **separate, non-embedded** `new Y.Doc({ guid: this.id })` and shares the root's `clientID`.
3. It does not load the content doc yet.

`load()` calls `spaceDoc.load()` and then `workspace.onLoadDoc(spaceDoc)`: [L161-L176](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/frontend/core/src/modules/workspace/impls/doc.ts#L161-L176). The app wires `onLoadDoc` to `engine.doc.connectDoc(doc)`: [workspace.ts L110-L113](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/frontend/core/src/modules/workspace/entities/workspace.ts#L110-L113).

So lazy loading is **per-doc and explicit**. A page's content is fetched only when someone calls `load()`.

The storage layer (nbstore) is keyed by `docId`. Its API includes `getDoc(docId)`, `getDocDiff(docId, state)` and `pushDocUpdate({docId,…})`: [storage/doc.ts L81-L91](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/common/nbstore/src/storage/doc.ts#L81-L91). `connectDoc` schedules a load job per `docId`. It also has a per-doc **priority** (`addPriority`) so the open page syncs first: [frontend/doc.ts L299-L330, L399-L404](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/common/nbstore/src/frontend/doc.ts#L299-L330). **Verified**.

Legacy code: `blocksuite/framework/sync/src/doc/peer.ts` still has a subdoc load queue that listens to `rootDoc.on('subdocs')`: [peer.ts L74-L90, L246-L270](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/framework/sync/src/doc/peer.ts#L74-L90). Code search shows `@blocksuite/sync` imported by the playground (`blocksuite/playground/apps/_common/sync/...`). **Unverified** whether the AFFiNE app still uses it. The app path I traced goes through nbstore.

### 1.3 What went wrong with subdocs (history)

- **2023-06**: AFFiNE ported its providers to subdocs. See [AFFiNE#2763](https://github.com/toeverything/AFFiNE/issues/2763) and [#2831](https://github.com/toeverything/AFFiNE/pull/2831). It added a data migration in [#2820](https://github.com/toeverything/AFFiNE/pull/2820).
- **Every page loaded at once**: "pages/subdocuments are loaded all at once for every workspace and this could take a long time" ([AFFiNE#3029](https://github.com/toeverything/AFFiNE/issues/3029)). The fix was a ref-counted "lazy provider" ([blocksuite#3602](https://github.com/toeverything/blocksuite/pull/3602)). Its RFC says: "When invoking `subdoc.load`, events related to subdocuments… will be emitted at the parent doc. However, this level of granularity is too broad for our needs."
- **GUID instability caused data loss.** They changed subdoc GUIDs to prefixed IDs ([blocksuite#3359](https://github.com/toeverything/blocksuite/pull/3359)). Then:
  - [AFFiNE#4338](https://github.com/toeverything/AFFiNE/issues/4338): "subdoc guid should always have root doc guid as its prefix".
  - [AFFiNE#4664](https://github.com/toeverything/AFFiNE/pull/4664): "avoid workspace subdoc guid conflict".
  - [AFFiNE#4912](https://github.com/toeverything/AFFiNE/pull/4912), quoted: "there are some cases that [upstream PR] will cause data loss… the page id could be different with its doc id… when fetching the rows of this doc using the doc id === page id, it will return EMPTY".
- **Provider rewrite**: [AFFiNE#4900 "refactor: new provider"](https://github.com/toeverything/AFFiNE/pull/4900) (merged 2023-11-17) gives the reason. The old `LazyProvider` "cannot guarantee" Yjs update order, and the app was "Not Usable Offline".
- **2025-01**: "new worker workspace engine" ([#9257](https://github.com/toeverything/AFFiNE/pull/9257)) and "remove legacy blocksuite doc" ([#9521](https://github.com/toeverything/AFFiNE/pull/9521)). These come from the commit list for `impls/doc.ts`. I did not read either PR body.
- **Conclusion (verified to this extent)**: the current app keeps a subdoc stub only for backward compatibility. Content docs are standalone Y.Docs that the storage engine connects one by one, keyed by `docId`. I did **not** find a single PR that says "we removed subdocs". The claim "they moved away" rests on the code comment and the code path above.

### 1.4 The page-pointer blocks

- `affine:embed-linked-doc`: the props are `{ pageId, params?, title?, description?, style, caption, footnoteIdentifier }`. **Verified**: [linked-doc-schema.ts L10-L19](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/model/src/blocks/embed/linked-doc/linked-doc-schema.ts#L10-L19) and [linked-doc-model.ts L16-L20](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/model/src/blocks/embed/linked-doc/linked-doc-model.ts#L16-L20).
  - `params` can carry `{ mode, blockIds, elementIds, databaseId, databaseRowId, xywh, commentId }`. This deep-links into a block of the target page: [consts/doc.ts L38-L57](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/model/src/consts/doc.ts#L38-L57).
  - `title`/`description` are **aliases**: a local override for the display name. They are not the source of truth.
- `affine:embed-synced-doc` has the same `pageId`. It renders the other doc **inline and read-only**: [synced-doc-schema.ts L16-L28](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/model/src/blocks/embed/synced-doc/synced-doc-schema.ts#L16-L28).
  - Its loader is `workspace.getDoc(pageId).getStore({ readonly: true })`. It treats a trashed or missing doc as a "deleted" state, calls `load()` if needed, then waits for `rootAdded`: [embed-synced-doc-block.ts L415-L484](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/blocks/embed-doc/src/embed-synced-doc-block/embed-synced-doc-block.ts#L415-L484).
  - **Cycle guard**: it walks up through enclosing `editor-host` elements. If any host's `store.id === pageId`, it renders a cycle state instead of recursing: [L422-L429](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/blocks/embed-doc/src/embed-synced-doc-block/embed-synced-doc-block.ts#L422-L429).

---

## 2. AppFlowy

### 2.1 Storage: one Folder collab for the tree, one Document collab per page

- AppFlowy-Collab uses **yrs** (the Rust port of Yjs): `yrs = { version = "0.25", features = ["sync"] }` in the [workspace Cargo.toml L6](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/Cargo.toml#L6), and `yrs.workspace = true` in [collab/Cargo.toml L11](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/collab/Cargo.toml#L11). **Verified**.
- Each collab object has a `CollabType`: `Document`, `Database`, `WorkspaceDatabase`, `Folder`, `DatabaseRow`, `UserAwareness`, …. It is keyed by `object_id`: [collab_object.rs L20-L33, L248-L255](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/collab/src/entity/collab_object.rs#L20-L33). **Verified**.
- The Folder collab has a `views` map and a `relation` map: [folder.rs L55-L56](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/collab/src/folder/folder.rs#L55-L56).
  - `relation` is `{ parent_id: [child_id, …] }`, an ordered child array per parent: [relation.rs L11-L18](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/collab/src/folder/relation.rs#L11-L18).
  - A `View` carries `parent_view_id`, `name`, `children`, `layout`, `icon`, `is_locked`, timestamps, and more: [view.rs L857-L880](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/collab/src/folder/view.rs#L857-L880). **Verified**.
- `move_nested_view` dissociates the view from its old parent, associates it with the new one after `prev_view_id`, and sets `parent_view_id`, all in one Folder transaction: [folder.rs L1549-L1590](https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/be5aa89b4aeafd4e7159e92b86784c02caaa85ce/collab/src/folder/folder.rs#L1549-L1590).
  - **Verified**: there is **no ancestor/cycle check inside this function**. I did not trace whether callers check.

### 2.2 The `sub_page` block (shipped Oct-Nov 2024)

- PRs: [#6427 "feat: sub page block"](https://github.com/AppFlowy-IO/AppFlowy/pull/6427), [#6567 inline sub page mention](https://github.com/AppFlowy-IO/AppFlowy/pull/6567), [#6685 "turn into page"](https://github.com/AppFlowy-IO/AppFlowy/pull/6685), and [#6824 sub page in row detail page](https://github.com/AppFlowy-IO/AppFlowy/pull/6824).
- The node is `{ type: 'sub_page', attributes: { view_id } }` plus the transient flags `was_copied` / `was_cut`: [sub_page_block_component.dart L26-L45](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_block_component.dart#L26-L45). **Verified**.
- **The block and the folder tree stay in sync through a transaction side-effect handler**: [sub_page_transaction_handler.dart L16-L249](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L16-L249). **Verified**. Its rules:

| Event in the parent document | Effect on the Folder |
|---|---|
| A block is dragged or turned into another type (`isDraggingNode \|\| isTurnInto`) | Nothing ([L35-L37](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L35-L37)) |
| Block removed | `deleteView(view_id)`, which moves the view to trash ([L57-L83](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L57-L83)) |
| New block with no `view_id` | `createView(parentViewId)`, then writes `view_id` back with `recordUndo: false`, then opens the view. On failure it deletes the node ([L97-L139](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L97-L139)) |
| Paste after **cut** | `TrashService.putback` + `moveViewV2(newParentId)` ([L141-L159](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L141-L159)) |
| Paste after **copy** | `duplicate(includeChildren: true)`, then rewrites `view_id` to the copy ([L160-L224](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L160-L224)) |
| Re-added otherwise (undo of a delete) | `putback` from trash, then `moveViewV2` if the parent differs ([L226-L247](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_transaction_handler.dart#L226-L247)) |

- **Self-healing render**: if `getView(view_id)` returns nothing, or the view shows up in trash, the block **deletes itself** (`recordUndo: false`): [L133-L150, L316-L330](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_block_component.dart#L133-L150). It subscribes to `ViewListener(viewId)` for live title and icon: [L108-L131](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_block_component.dart#L108-L131). **Verified**.
  - **Inference (risk)**: a client whose folder has not synced yet would also see `view == null` and delete the block. I did not check whether this happens in practice.

---

## 3. Outline

- **Tree**: `Document.parentDocumentId` (SQL FK): [Document.ts L678-L683](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/models/Document.ts#L678-L683). There is also a denormalized `Collection.documentStructure: NavigationNode[]` (JSONB): [Collection.ts L274-L276](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/models/Collection.ts#L274-L276). **Verified**.
- **Cycle guard on the server**: a `@BeforeUpdate` hook rejects self-parenting and rejects a parent that is among `findAllChildDocumentIds()`. The error is "infinite loop detected": [Document.ts L600-L624](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/models/Document.ts#L600-L624). The descendant query is a recursive CTE: [L1178-L1222](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/models/Document.ts#L1178-L1222). **Verified**.
- **Content**: one Y.Doc per document. The client room name is `` `document.${documentId}` `` with an IndexedDB cache: [MultiplayerEditor.tsx L77-L95](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/app/scenes/Document/components/MultiplayerEditor.tsx#L77-L95).
  - The server (Hocuspocus extension) splits `documentName` on `.` and loads `documents.state` (binary Yjs). If there is no state, it builds one from `content` (JSON) or `text` under a row lock: [PersistenceExtension.ts L34-L101](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/collaboration/PersistenceExtension.ts#L34-L101). **Verified**.
- **Moves are whole-document reparents only**: `documentMover` runs in a DB transaction. It removes the doc from the old `documentStructure`, sets `collectionId`/`parentDocumentId`, and adds it at `toIndex`: [documentMover.ts L23-L105](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/commands/documentMover.ts#L23-L105). I did not find a block-level "move content to another document". That absence is **unverified** beyond this file.
- **Links to docs**: an inline atom `mention` node with `{ type, label, modelId, actorId, id, anchorId, href, unfurl }`. The link holds an ID and a cached label, not content: [Mention.tsx L98-L123](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/shared/editor/nodes/Mention.tsx#L98-L123). **Verified**.

---

## 4. BlockNote / Tiptap / Lexical

- **BlockNote core**: no page or sub-page block found via issue search ("subpage", "sub page", "page block"). Not checked beyond that.
- **La Suite Docs** (French government, built on BlockNote) is the most relevant BlockNote app:
  - The tree is in the DB: `Document(MP_Node)` (django-treebeard materialized path, `steplen = 7`): [models.py L953-L997](https://github.com/suitenumerique/docs/blob/bd71ed87e1050b1ff3eb0208bfff9f5d290a5442/src/backend/core/models.py#L953-L997).
  - In the editor, a custom **inline** content `interlinkingLinkInline { docId }` links to another doc: [InterlinkingLinkInlineContent.tsx L17-L100](https://github.com/suitenumerique/docs/blob/bd71ed87e1050b1ff3eb0208bfff9f5d290a5442/src/frontend/apps/impress/src/features/docs/doc-editor/components/custom-inline-content/Interlinking/InterlinkingLinkInlineContent.tsx#L17-L100).
  - The "New sub-doc" slash item calls `createChildDoc({ parentId })`, adds the result to the sidebar tree, and does `router.push('/docs/<id>')`. It **does not insert any block into the parent doc**: [useCreateChildDocTree.tsx L7-L35](https://github.com/suitenumerique/docs/blob/bd71ed87e1050b1ff3eb0208bfff9f5d290a5442/src/frontend/apps/impress/src/features/docs/doc-management/hooks/useCreateChildDocTree.tsx#L7-L35). **Verified**.
  - So hierarchy and in-document links are **decoupled**. Open issue [#2715](https://github.com/suitenumerique/docs/issues/2715) reports that users built "massive document trees" and wants linking across trees.
- **Tiptap**: the paid "Notion-like Editor Template" docs list no page or sub-page node among the node components. It scopes collaboration with a `room` prop, one room per document ([tiptap.dev/docs/ui-components/templates/notion-like-editor](https://tiptap.dev/docs/ui-components/templates/notion-like-editor)). Issue search for "subpage" / "nested pages" in ueberdosis/tiptap found nothing. Absence is **not proven**.
- **Docmost** (Tiptap-based) has a `subpages` node with **no attributes**: `atom`, `draggable`, `isolating`, rendered by a React node view: [subpages.ts L19-L71](https://github.com/docmost/docmost/blob/b6434371ed5fe5aada45126cdf7fe3aae9b22fcf/packages/editor-ext/src/lib/subpages/subpages.ts#L19-L71).
  - **Inference**: since the node stores nothing, it must list children from the server tree (`pages.parentPageId`). I did not read the node view.
- **Lexical**: issue search found no sub-page pattern. Not checked further.

---

## 5. Others, briefly

- **Docmost**: the `Pages` table has `parentPageId`, `position`, `content` (JSON), `ydoc` (binary) and `spaceId`: [db.d.ts L313-L336](https://github.com/docmost/docmost/blob/b6434371ed5fe5aada45126cdf7fe3aae9b22fcf/apps/server/src/database/types/db.d.ts#L313-L336). The collab persistence loads `page.ydoc`, or converts `content` JSON to a Y.Doc if it is missing: [persistence.extension.ts L59-L90](https://github.com/docmost/docmost/blob/b6434371ed5fe5aada45126cdf7fe3aae9b22fcf/apps/server/src/collaboration/extensions/persistence.extension.ts#L59-L90). **Verified**.
- **Plane pages**: `Page.parent` FK plus `description_binary` (Yjs bytes): [page.py L23-L52](https://github.com/makeplane/plane/blob/e72bf10fa529d0764a671b19d0657fb244882811/apps/api/plane/db/models/page.py#L23-L52). **Verified**.
- **Huly**: `Document { title, content: MarkupBlobRef, parent: Ref<Document>, space, rank, … }`: [types.ts L23-L39](https://github.com/hcengineering/platform/blob/e4fd72b36a03e9ef531ea20d32cc14ecda6596c1/plugins/document/src/types.ts#L23-L39). **Verified**.
- **Anytype**: a `Link` block holds `targetBlockId` (an object ID) plus display options (`iconSize`, `cardStyle`, `description`, `relations`): [models.proto L199-L224](https://github.com/anyproto/any-block/blob/c0f4f77bdf91d1759b32acd0a5fbbe426230c73d/format/v1/proto/models.proto#L199-L224). That is a pointer block again. **Unverified**: how any-sync stores each object; I did not read it.
- **Logseq (DB version)**: all pages and blocks share **one** datascript DB. A cross-page move is a single transaction. It re-points `:block/parent`, `:block/order` and `:block/page` on the block, and sets `:block/page` on every non-page descendant. The `:block/uuid` stays the same, so references survive. It throws `not-allowed-move-block-page` when you try to make a page the child of a block: [outliner/core.cljs L1310-L1346](https://github.com/logseq/logseq/blob/a538a9b60c95490c35bf278903e60f3a9f03a330/deps/outliner/src/logseq/outliner/core.cljs#L1310-L1346). **Verified**.

---

## 6. Yjs subdocuments in practice

**API.** Source: [docs.yjs.dev/api/subdocuments](https://docs.yjs.dev/api/subdocuments). **Verified**, fetched 2026-10-01.
- A subdoc is a `Y.Doc` placed in a shared type of a root doc.
- It is empty until `subDoc.load()`. `new Y.Doc({ autoLoad: true })` makes peers load it automatically.
- The root emits `subdocs` with `{ added, removed, loaded }`.
- Docs are identified by `guid`, which is used as the room name. Two docs with the same `guid` sync with each other.
- Quotes:
  - "It is up to the providers to sync subdocuments… all official Yjs providers currently think of sub-documents as separate entities."
  - "Not all providers support subdocuments yet."
- The recommended lazy-load recipe is to open one provider per `subdoc.guid` when `loaded` fires.

**Provider support**:

| Provider | Status | Evidence |
|---|---|---|
| y-websocket | No subdoc handling | grep of `src/*.js` at `f786ae97` found no "subdoc" |
| y-indexeddb | No subdoc handling | same grep at `ff468b5e` found nothing; [y-indexeddb#32 "sub-doc syncing support"](https://github.com/yjs/y-indexeddb/issues/32) is **open** since 2023-06 |
| Hocuspocus | No subdoc support | [hocuspocus#583 "Subdocs"](https://github.com/ueberdosis/hocuspocus/issues/583) is **open** since 2023-04; a maintainer reply from 2023-04 says it was "planned… towards the end of the year" |
| Hocuspocus multiplexing | Shipped | one `HocuspocusProviderWebsocket` shared by many `HocuspocusProvider`s, one per document ([HocuspocusProvider.ts L79-L95](https://github.com/ueberdosis/hocuspocus/blob/c7e372e77d43c1bc6cf2d0d61252c9c815a5b327/packages/provider/src/HocuspocusProvider.ts#L79-L95); design in [hocuspocus#484](https://github.com/ueberdosis/hocuspocus/pull/484): "add a field… that indicates the documentName") |
| (general) | — | [yjs#526 "About subdocuments"](https://github.com/yjs/yjs/issues/526) (open): "there's no providers implement it"; AFFiNE pointed to its own custom provider |

Hocuspocus multiplexing gives "many docs, one socket" without subdocs.

**Gotchas, verified on the version Blok runs (yjs 13.6.32)**:
- **Removing a subdoc from its parent destroys it.** At the end of the transaction, Yjs emits `subdocs` and then calls `subdoc.destroy()` on every removed subdoc: [Transaction.js L386-L388 @ v13.6.32](https://github.com/yjs/yjs/blob/v13.6.32/src/utils/Transaction.js#L386-L388).
  - [yjs#750 "Don't destroy subdocs on deletion from parent"](https://github.com/yjs/yjs/issues/750) (open, 2025-11) hits this while relinking items to other parents. Re-inserting the same instance then fails with "This document was already integrated as a sub-document".
  - So **"move a subdoc to another parent" is delete + insert of a fresh instance with the same guid**. It is not a move.
- **The GUID must equal the stable page ID forever.** AFFiNE's GUID-prefix change caused empty docs and data loss ([AFFiNE#4912](https://github.com/toeverything/AFFiNE/pull/4912)).
- **Event granularity**: all subdoc events arrive on the root doc ([blocksuite#3602 RFC](https://github.com/toeverything/blocksuite/pull/3602)).

**The alternative everyone uses**: one standalone Y.Doc per page (`guid = pageId`), opened on demand, plus a tree/metadata store. That store is either a Y.Doc (AFFiNE `meta`, AppFlowy Folder) or SQL (Outline, Docmost, Plane). See §0.

---

## 7. Moving content across pages (separate CRDT docs)

No project I read makes a block-level cross-doc move **atomic**. Two CRDT docs cannot share a transaction. What they do:

| Project | Mechanism | Order of operations | IDs preserved? |
|---|---|---|---|
| AFFiNE "convert to linked doc" | `sliceToSnapshot` → `workspace.createDoc()` → `clipboard.pasteBlockSnapshot(...)` in the new doc → insert `embed-linked-doc { pageId }` card → `deleteBlock` each source model ([render-linked-doc.ts L150-L205](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/blocks/embed/src/common/render-linked-doc.ts#L150-L205)) | The paste is **async**, and its errors only reach `console.error`. The card insert and source deletes run **synchronously, without awaiting the paste**. **Verified** from the code | Unknown (not read) |
| AppFlowy "turn into page" | `deepCopy` the nodes into a blank `Document` → `createView(initialDataBytes: …)` → **only on success** insert `sub_page {view_id}` and delete the source nodes in one editor transaction → then `moveViewV2` any nested sub-page views under the new view ([block_action_option_cubit.dart L502-L560](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/actions/block_action_option_cubit.dart#L502-L560)) | Create the target with its **initial state baked in**, await it, then delete the source. On error the source is untouched | Unknown (`deepCopy` semantics not read) |
| AppFlowy cut/paste of a sub-page block | `moveViewV2` in the Folder; content doc untouched ([§2.2](#22-the-sub_page-block-shipped-oct-nov-2024)) | Only the pointer and the tree edge move | View ID preserved (same `view_id`) |
| Outline | Whole-document reparent in one SQL transaction ([documentMover.ts](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/server/commands/documentMover.ts#L23-L105)) | Atomic, because the tree is SQL | Doc ID preserved |
| Logseq DB | One datascript transaction re-points parent and page ([core.cljs L1310-L1346](https://github.com/logseq/logseq/blob/a538a9b60c95490c35bf278903e60f3a9f03a330/deps/outliner/src/logseq/outliner/core.cljs#L1310-L1346)) | Atomic, because there is a **single DB** | **Yes**, uuid kept (verified) |

The pattern that works in practice: **moving a page is a tree-edge edit, never a content copy.** Only "turn these blocks into a new page" copies content. The safe ordering is the one AppFlowy uses: create the target with its content, confirm, then delete from the source.

---

## 8. Navigation contract in an embeddable editor

- **BlockSuite: event plus host filter**.
  - Clicking a linked-doc card emits `RefNodeSlotsProvider.docLinkClicked.next({ pageId, params, openMode, event, host })`: [embed-linked-doc-block.ts L211-L222](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/blocks/embed-doc/src/embed-linked-doc-block/embed-linked-doc-block.ts#L211-L222).
  - The `docLinkClicked` Subject is a **module-level singleton shared by every editor**: [reference-node-slots.ts L8-L29](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/inlines/reference/src/reference-node/reference-node-slots.ts#L8-L29). So the host must filter with `if (host !== editorContainer.host) return`.
  - The host then picks `open-in-active-view` / `open-in-new-tab` / `open-in-new-view` / `open-in-center-peek`: [detail-page.tsx L223-L245](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/packages/frontend/core/src/desktop/pages/workspace/detail-page/detail-page.tsx#L223-L245).
  - **URL builder**: a DI service `GenerateDocUrlService.generateDocUrl(docId, params?) => string | void`, supplied by the host: [generate-url-service.ts L5-L21](https://github.com/toeverything/AFFiNE/blob/b71bb7cfc45f66998ed3827ba5606e0420f8fbb4/blocksuite/affine/shared/src/services/generate-url-service.ts#L5-L21). **Verified**.
- **AppFlowy**: not embeddable. The block calls the app's global `TabsBloc` directly (`TabsEvent.openPlugin(view)` on desktop, `context.pushView(view)` on mobile): [sub_page_block_component.dart L399-L419](https://github.com/AppFlowy-IO/AppFlowy/blob/5cf3a365dec0d59f64bad1ee4bb1050471a39b93/frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/sub_page/sub_page_block_component.dart#L399-L419). **Verified**.
- **Outline**: the editor takes a prop `onClickLink(href, event?)`, and the host app routes: [app/editor/index.tsx L172-L175](https://github.com/outline/outline/blob/05ef55e38aeb3b625e819edab907c7ee2d33af8a/app/editor/index.tsx#L172-L175). Links are real `href`s. **Verified**.
- **La Suite Docs**: the app calls `router.push('/docs/<id>')` directly ([useCreateChildDocTree.tsx L21](https://github.com/suitenumerique/docs/blob/bd71ed87e1050b1ff3eb0208bfff9f5d290a5442/src/frontend/apps/impress/src/features/docs/doc-management/hooks/useCreateChildDocTree.tsx#L21)).

---

## Patterns to copy

1. **One CRDT doc per page, `guid = pageId`, loaded on demand. Keep the page tree in a separate store.** Used by AFFiNE (§1.2), AppFlowy (§2.1), Outline (§3), Docmost, Plane and Huly (§5). For Blok, this means a page block's children live in their own Y.Doc, and the parent doc stores only the pointer.
2. **The page block is a pointer with display aliases: `{ pageId, title?, icon? }`.** The child's real title and icon come from the tree/metadata store and update live.
   - AFFiNE `embed-linked-doc` keeps `title`/`description` as aliases (§1.4).
   - AppFlowy `sub_page {view_id}` uses a `ViewListener` (§2.2).
   - Anytype `Link.targetBlockId` (§5).
3. **Allow a deep-link payload on the pointer.** AFFiNE `ReferenceParams { blockIds, mode, databaseRowId, … }` (§1.4) lets "open page and scroll to block X" work without a second API.
4. **Load content lazily, with a priority hint for the visible page.** AFFiNE nbstore `connectDoc` + `addPriority` (§1.2). A synced/inline preview loads the target read-only and waits for its root (AFFiNE synced-doc, §1.4).
5. **Turn the block's lifecycle into tree operations in one place.** AppFlowy's single transaction handler (§2.2) covers every path:
   - new block → create page
   - delete → trash (not hard delete)
   - undo → restore from trash and reparent
   - cut + paste → reparent
   - copy + paste → duplicate with children
   - drag or turn-into → nothing
6. **Soft-delete through trash so undo can restore.** AppFlowy `deleteView` → trash and `TrashService.putback` on re-add (§2.2). AFFiNE `DocMeta.trash` (§1.1).
7. **Guard cycles twice**:
   - On the tree write, reject a new parent that is a descendant (Outline `checkParentDocument` with a recursive CTE, §3).
   - At render time, refuse to render a page inside itself (AFFiNE `_checkCycle`, §1.4).
8. **For "turn blocks into a page", create the target with its initial state, await success, then delete the source.** AppFlowy `turnIntoPage` passes `initialDataBytes` and deletes only on success (§7).
9. **Moving a page is a tree-edge edit, not a content copy.** AppFlowy cut+paste → `moveViewV2`; Outline `documentMover` (§7).
10. **Navigation is the host's job, reached through a callback or event plus a URL builder.**
    - BlockSuite has `docLinkClicked` with `openMode` plus `GenerateDocUrlService` (§8).
    - Outline has `onClickLink(href)` (§8).
    - Giving real `href`s keeps middle-click and new-tab working (Outline; BlockSuite's `open-in-new-tab`).
11. **Multiplex many per-page docs over one connection** instead of using subdocs. Hocuspocus shares one `websocketProvider` across providers (§6).

## Patterns to avoid

1. **Embedded Yjs subdocuments as the page container.**
   - No official provider syncs them (y-websocket, y-indexeddb and Hocuspocus have no handling; y-indexeddb#32 and hocuspocus#583 are open; §6).
   - AFFiNE built its own and still ended up with a compat stub plus standalone docs (§1.2-1.3).
2. **Moving a page by moving its subdoc between parents.** In yjs 13.6.32 a removed subdoc is `destroy()`ed ([Transaction.js L386-L388](https://github.com/yjs/yjs/blob/v13.6.32/src/utils/Transaction.js#L386-L388); yjs#750 open).
3. **Ever changing a page's doc GUID or its mapping to the page ID.** AFFiNE's GUID-prefix migration made docs load EMPTY and lost data (AFFiNE#4338, #4664, #4912).
4. **Fire-and-forget content copy followed by a synchronous source delete.** AFFiNE `convertSelectedBlocksToLinkedDoc` deletes the source blocks without awaiting the async `pasteBlockSnapshot`. Paste errors only reach `console.error` (§7). Prefer AppFlowy's await-then-delete.
5. **Shared global event buses in an embeddable editor.** BlockSuite's `docLinkClicked` Subject is one module-level instance for all editors, so every host must filter by `host` (§8). Blok has a multi-editor document-listener law. Scope the callback per editor instance.
6. **Navigating by calling the app's global router from inside the block.** AppFlowy `TabsBloc` (§8) and La Suite `router.push` are fine for a monolith but impossible for a headless library.
7. **Auto-deleting a pointer block when its target "isn't found".** AppFlowy deletes the `sub_page` node when `getView` returns null (§2.2). **Inference**: this is unsafe while the tree store is still syncing or permissions are loading. Render a "missing/no access" state instead.
8. **A tree move without a cycle check in the move primitive.** AppFlowy's `move_nested_view` has none in-function (§2.1). Outline puts it in the model hook (§3).
9. **Decoupling hierarchy from in-document links entirely.** La Suite's "New sub-doc" adds a tree child but no block in the parent (§4), and its users ended up with "massive document trees" (issue #2715). In Notion's model the page block *is* the tree edge, so keep the block and the tree consistent (pattern 5).

## Open questions (not answered here)

- Whether AFFiNE / AppFlowy keep block IDs when content moves into a new page. This matters for Blok's anchors and placement references. Only Logseq is verified to keep them.
- How AFFiNE derives sidebar nesting, since `DocMeta` has no parent field.
- Whether AppFlowy callers of `move_nested_view` check for cycles, and how concurrent Folder moves resolve.
