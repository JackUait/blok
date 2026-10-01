# Page block on the frontend — Blok core audit

Scope: read-only research of `/Users/jackuait/Packages/blok` on 2026-10-01. Every claim cites a file:line I read in this session. Items I did not check are labelled **unverified**. Items taken from the project memory notes (not re-read here) are labelled **memory-derived**.

---

## 0. Answer first

- Blok has no concept of a "visible root" or "navigate into block X". Search for `rootBlockId|viewRoot|zoom|subtree root` found nothing in core (only image/darkroom zoom code).
- Every block in the store gets a holder in the DOM, and every block's `rendered()` hook runs on load (`src/components/blocks.ts:419-428`, `:452-458`).
- Hiding children today means a `hidden` CSS class on mounted holders (collapsed toggle, `src/tools/toggle/toggle-lifecycle.ts:114`, `:141-147`). There is no "in the tree but not mounted" state, except the database rows, whose holders are empty divs mounted at the root (characterization snapshot, see 1.5).
- Re-rooting by re-calling `render(subtree)` is ruled out (section 2.2).
- **Recommendation: (c) hybrid, built on one new generic core lever: a "detached child slot" (children are in the tree but core never mounts them).** Details in section 7.

---

## 1. Block tree: how it works in memory and in the DOM

### 1.1 The model

- `Block.parentId: string | null` and `Block.contentIds: string[]` (`src/components/block/index.ts:156`, `:162`). The constructor copies `contentIds` because hierarchy ops mutate it in place (`:323-328`).
- `Block.isEmpty` returns false when the block has children (`src/components/block/index.ts:903-905`). A page with an empty title and a body will not be treated as empty. Good for a page.
- `src/components/utils/tree-order.ts` holds pure tree reads:
  - parentId is membership, contentIds is sibling order, and the flat array must be a depth-first walk (`:1-4`).
  - `subtreeEnd` (`:63-74`), `flatIndexForPlacement` (`:95-110`), `childrenInTreeOrder` (`:135-136`), `dfsOrder` (`:146-185`), `placementImpliedByFlat` (`:194-208`).
- The `Blocks` store keeps a flat array plus an id index (`src/components/blocks.ts:19`, `:27`). All holders go into one `workingArea` (`:32`).

### 1.2 Mounting holders

- `Blocks.insertMany` appends EVERY block's holder into a fragment, puts it in the working area, then runs `callRenderedHook` on each (`src/components/blocks.ts:417-428`, `:433-458`).
- `Blocks.mount(block, index, slot)` moves a holder into a slot (or the working area when slot is null), anchored on the next later holder already in that slot (`:595-608`).
- `Blocks.activateBlock`: if the holder already has a parent element, only `rendered()` runs. Otherwise the holder is inserted next to a neighbour (`:679-725`).
- `BlockHierarchy.placeBlock` is the model+DOM placement primitive (`src/components/modules/blockManager/hierarchy.ts:591-682`):
  - It fixes contentIds and parentId, splices the subtree in the flat array (`:627-651`).
  - It then mounts each member via `resolveHomeSlot` (`:657-677`). Kind `slot` or `root` mounts. Kind `self-placing` mounts only if the holder already sits in one of that parent's cells (`:671-676`). Otherwise the holder stays where it was.
- `resolveHomeSlot` (`src/components/utils/home-slot.ts:36-65`) walks up the parents:
  - a table/database ancestor gives `self-placing` (`:56-58`);
  - an ancestor with a `CHILD_SLOT_SELECTOR` element gives that slot (`:60-62`);
  - otherwise it keeps walking up. So **a parent with no slot makes its children mount into the grandparent's slot, as flat siblings**. That is the "slotless" rule (`src/tools/nested-blocks.ts:113-119`).
- `CHILD_SLOT_SELECTOR = '[data-blok-toggle-children], [data-blok-nested-blocks]'` (`src/tools/nested-blocks.ts:104`). `DATA_ATTR.nestedBlocks = 'data-blok-nested-blocks'` (`src/components/constants/data-attributes.ts:324`).
- `SELF_PLACING_PARENTS = {'table', 'database'}` (`src/tools/nested-blocks.ts:110`).

### 1.3 Container tools

- `mountChildBlocks(container, children)` is the reconciler that tools call from `rendered()` (`src/tools/nested-blocks.ts:164-225`). It puts each MODEL child into the container at its model position. It also reclaims holders stranded in an enclosing container (`:212-215`).
- Users: toggle, callout (`src/tools/callout/index.ts:286-293`), column (`src/tools/column/index.ts:85-112`), column_list (`src/tools/column-list/index.ts:91-133`), and the React/Vue/Angular adapters (per the doc comment at `nested-blocks.ts:153-158`).
- `child-decoration.ts` lets a container stamp attributes on a child's holder / content wrapper (`src/tools/child-decoration.ts:1-60`). This is the per-child styling channel. A page does not need it.
- `childTools = { allow?, deny? }` (`src/components/utils/child-tools.ts:28-41`, `:91-101`). It demotes a disallowed tool on insert and hides it in the toolbox.
- `ownsChildren` is all-or-nothing and clamps moves only (`src/components/tools/block.ts:123-141`). Users: column_list (`src/tools/column-list/index.ts:284`) and table (`src/tools/table/index.ts:503`).

### 1.4 Collapsed toggles: hidden, not unmounted

- `updateChildrenVisibility` first calls `mountChildBlocks`, then adds or removes the `hidden` class on every child holder (`src/tools/toggle/toggle-lifecycle.ts:121-155`). The comment says it directly: "Children are hidden via the 'hidden' CSS class (display: none), not removed from the DOM" (`:114`).
- A newly placed block under a collapsed parent gets `hidden` too (`src/components/modules/blockManager/new-block-placement.ts:33-50`). `hierarchy.syncVisibilityWithParent` handles moves in and out (`hierarchy.ts:523-544`).

### 1.5 The database rows: the only "not visibly rendered" children today

- `database-row` renders an empty `<div data-blok-tool="database-row">` (`src/tools/database-row/index.ts:39-45`). The database reads rows through `api.blocks.getChildren` (`src/tools/database/index.ts:317-350`).
- The database has no `data-blok-nested-blocks` slot (grep of `src/tools/database/*.ts` found none). Row holders stay mounted at the editor root. The characterization snapshot shows `"r1@-"`, `"r2@-"`, which means mounted with no owning block holder (`test/unit/tools/__snapshots__/column-database-placement.characterization.integration.test.ts.snap:1470-1472`; the `@-` rule is `holderOwner`, `test/unit/tools/column-database-placement.characterization.integration.test.ts:121-125`).
- Inference from 1.2: if a row had child blocks, they would follow the row's holder as flat root siblings and show up inline in the main editor. **Unverified by running.** This is a plausible reason the drawer keeps the body out of the tree.

### 1.6 The drawer precedent vs the law

- The drawer boots a nested `new Blok({...toolsConfig, holder, data: description, readOnly, onChange})` (`src/tools/database/database-card-drawer.ts:601-627`).
- `toolsConfig` comes from `api.tools.getToolsConfig()`. That returns `tools`, `inlineToolbar`, `tunes`, `theme` only (`src/components/modules/api/tools.ts:14-31`). **So the nested instance gets no collaboration config and no i18n/locale config.**
- The body is saved as an `OutputData` blob into the row's richText property (`src/tools/database/index.ts:1145-1150`).
- This breaks the law in CLAUDE.md ("Page body IS blocks via contentIds"). The published schema also contradicts it: `'database-row'` is described as "Rich page content lives in this block's children, not here" (`src/view/document-schema.ts:324-326`).
- Consequences:
  - The body is one property value, so a collab write replaces the whole value. Two people editing the same row body lose each other's edits. **This is inferred from the property write, not tested.**
  - The body is invisible to the Saver tree, `/view` children, find, and hash deep links.
  - The nested instance has its own Yjs doc and undo stack.

---

## 2. Re-rooting: can one instance show a subtree as its root?

### 2.1 What exists

- Nothing. `Renderer.render(blocksData)` (`src/components/modules/renderer.ts:175-196`) → `insertRenderedBlocks` → `BlockManager.insertMany(blocks, 0, …)` (`:411`).
- The view renderer (`src/view/blocks-to-html.ts`) has a hook that fits a page. `renderers[type]` gets `ctx.renderChildren()` and can choose not to call it (`:326-336`, `:346-351`). Built-ins: `database`/`database-row` are `childrenOnly` and render children inline (`src/view/emitters.ts:151-158`, `:571-572`). An unknown type renders its children inline (`blocks-to-html.ts:379-384`).

### 2.2 Why "render the page's children" is not a navigation

- `insertMany` without `skipYjsSync` calls `YjsManager.fromJSON`, which replaces the whole Yjs document and clears undo (`src/components/modules/blockManager/blockManager.ts:704-716`; `document-store.ts:200-204`).
- With `skipYjsSync` under collaboration, `resolveRenderSource` renders the Yjs document, not the caller's array (doc comment at `renderer.ts:413-447`).
- `Saver.save()` serializes only `BlockManager.blocks` (`src/components/modules/saver.ts:225`).
- Result: re-rendering the subtree would either wipe the shared document or make `save()` emit only the visible page. **Navigation in one instance has to be a mount filter over the full store, not a re-render.**

### 2.3 What a mount filter would need

- A "view root" id on the UI/Blocks layer. Holders of blocks outside that root's subtree are detached. The root's own holder (the page block) is replaced by a title surface. **Design, not existing code.**
- Every DOM-placement path would have to respect it: `Blocks.insert`, `insertMany`, `activateBlock`, `mount`, `placeBlock`, `setBlockParent`. Plus the full read-only fallback, which does save → render (`src/components/modules/readonly.ts:264-283`). That is the same set of paths that section 7's lever needs anyway.

---

## 3. Three architectures, costed against this code

(a) One instance holds the whole tree. A page's children are in the tree but not mounted inline. Opening a page re-roots the visible area.
(b) One instance per page, loading only that page's subtree (like the drawer). The parent shows only the page block record.
(c) Hybrid. The document tree is the source of truth (children via contentIds, saved flat). The inline page block never mounts its children. Opening a page shows its subtree in a second instance (or the host routes to it), bound to the same blocks.

| Concern | (a) one instance, re-root | (b) instance per page | (c) hybrid |
|---|---|---|---|
| **Undo/redo** | One `Y.UndoManager` over the whole blocks map and root order (`yjs/undo-history.ts:381-389`, `document-store.ts:195-197`). Undo on page X can undo an edit made on page Y. That is not Notion's behaviour (Notion's undo is per page view — **unverified**). | Natural per-page undo (own Yjs doc per instance). | Per-instance undo while each instance owns its page's blocks. |
| **Select-all / selection** | `allBlocksSelected = true` selects EVERY block in the store (`blockSelection.ts:172-177`). Cmd+A on page X would select the parent page and all sibling pages too. Needs scoping. `copySelectedBlocks` deep-copies via contentIds (`blockSelection.ts:793-818`). | Fine. The page block is a leaf in the parent instance. | Fine in each instance. |
| **Keyboard nav** | `Caret.navigateNext` uses `nextVisibleBlock` (`caret.ts:574`), which skips only holders with class `hidden` (`blockManager/operations.ts:283-312`). Detached page children without `hidden` would take the caret. Delete-forward is protected by its parentId check (`keyboardNavigation.ts:1002-1004`). | Fine. | Inline page block: children must be skipped (same fix as (a)). |
| **Drag & drop** | Drop edges are only `top/bottom/left/right` (`drag/target/DropTargetDetector.ts:16-18`). Nesting by drop exists only for open toggles: drop at the bottom → becomes first child (`:1059-1085`). "Drop ONTO page → becomes last child" needs a new resolution. After the drop, `placeBlock` must detach the holder, not mount it (section 7). | Dropping onto the page means removing the blocks from instance A and inserting them into page B's storage: a cross-instance transfer. No core support exists. | Same as (a), on the single tree. |
| **Copy/paste a page block** | Copy already carries the whole subtree (`blockSelection.ts:463-469`, `:793-818`). Paste remaps ids and keeps the hierarchy (`paste/handlers/blok-data-handler.ts:228-255`). Works out of the box. | Parent instance only has the record. Copy would lose the body unless the host deep-copies. | Works if the page's subtree is in the parent store (it is in (c)). |
| **Find in page** | Walks `document.body` with a TreeWalker (`find/index.ts:540`, `find/text-index.ts:43-53`). `display:none` is not skipped, so collapsed toggle text is found on purpose (`find/index.ts:5`, `:606-632`). Sub-page text is excluded ONLY if the holders are detached, or the skip selector (`text-index.ts:24-28`) learns a marker. | Fine (each instance's DOM). | Fine if detached. |
| **Saver** | Emits the whole flat tree with `parent`/`content` (`saver.ts:225`, `:975-995`). Good, that is the law. But the stranded-holder gate throws in dev/test when a block's parent holder is connected and its own holder is not (`saver.ts:858-883`, `hierarchy-invariant.ts:189-213`). The exemption covers only DIRECT children of `table`/`database` (`saver.ts:386`, `:862-866`). The home-slot gate exempts children of self-placing parents (`hierarchy-invariant.ts:269-271`). A page needs both exemptions. | The parent saves only the page record. Each page is a separate document. To meet the law, the host must stitch them into one tree. | One save emits the whole tree. |
| **Yjs sync** | Remote adds: `addToArray` → `activateBlock` → `placeOrReparent` (`blockManager/yjs-sync.ts:1966-1987`). `activateBlock` mounts any holder with no parent (`blocks.ts:679-725`). So a remote child added to a page would be mounted next to a neighbour unless the lever stops it. | One Y.Doc per instance. No core cross-doc linking. Drawer instances get no collab config at all (`api/tools.ts:14-31`). | One doc. The second instance needs a way to bind to the subtree. That does not exist (section 7). |
| **onChange** | One `config.onChange`, batched in `modificationsObserver` (`modificationsObserver.ts:85-92`). It fires for edits on any page. The host can't tell which page changed without reading event block ids. **Partly unverified** (I did not read the event payload). | Per instance. | Per instance. |
| **readOnly** | In-place `setReadOnly` per block, or a fallback full save → render (`readonly.ts:221-233`, `:264-283`). The fallback rebuilds the DOM, so a view root would have to be re-applied after it. | Per instance (drawer passes `readOnly`, `database-card-drawer.ts:614`). | Per instance. |
| **/view, Markdown, outline** | `childrenOf` walks the whole saved tree. With no `page` emitter, an unknown type renders its children inline (`blocks-to-html.ts:379-384`). A built-in `page` emitter has to render a link and stop. | Each page is its own document. | Same as (a): needs a `page` emitter. |
| **Load cost** | `insertMany` composes every block and runs `rendered()` on all of them (`blocks.ts:428`, `:458`). 29 tool files measure layout (`getBoundingClientRect`/`ResizeObserver`/`offsetWidth`, by grep count). Every sub-page renders, detached, at boot. A large workspace is slow. | Only the open page loads. | Same as (a) for whatever subtree the host passes. The host can pass a shallow tree (page records only) and lazy-load bodies. Core needs no new feature for that, because an unloaded child is just "not in the data". |

---

## 4. Turn-into, links, anchors

### 4.1 Turn into page

- The conversion keeps the text through `conversionConfig` export/import strings (toggle: `export: 'text', import: 'text'`, `src/tools/toggle/index.ts:464-469`). A page tool with `conversionConfig: { export: 'title', import: 'title' }` keeps the text as the title. **Design.**
- Children: `replace` re-homes the old children onto the new block through `setBlockParent`, but only those `canAdoptChild` accepts (`blockManager/block-mutation.ts:788-805`).
- `canAdoptChild` refuses when the target is in `SELF_PLACING_PARENTS` (`src/components/utils/turn-into-children.ts:47-48`). **So making `page` self-placing would make "turn into page" drop the children to the parent level.**
- `releasesChildrenOnTurnInto` lifts the children out when:
  - the source is a toggle heading and the target is not one;
  - the source is a callout and the target is not a toggle or toggle heading (`turn-into-children.ts:25-38`).
  - **Toggle heading → page and callout → page would therefore spill the children instead of making them the page body.** That needs a change: a page target should keep the children.
- After re-homing, `setBlockParent` → `placeBlock` mounts the children in the page's home slot. With no slot, they go into the grandparent's slot as flat siblings (`home-slot.ts:60-62`). That is wrong for a page (section 7).

### 4.2 Links and deep links

- `resolveHashTarget` finds a block by `document.querySelector('[data-blok-id="…"]')`, then a heading anchor inside the holder (`src/components/utils/hash-target.ts:48-76`).
  - A block on an unmounted sub-page does not resolve, because the lookup is DOM-only.
  - "Link to block on another page" needs: find the block in the store → find its page ancestor → open the page → scroll.
- Same-page link clicks go to `BlocksAPI.scrollToBlock(fragment)` (`src/components/modules/ui.ts:1455-1496`; `api/blocks.ts:973-997`).
- The link tool's heading suggestions walk every block in the store and call `holder.querySelector('h1..h6')` (`src/components/inline-tools/inline-tool-link.ts:941-952`). That works on detached holders too. So in (a)/(c) **sub-page headings would leak into suggestions** unless the walk is scoped.
- There is no "link to page" inline mention. A page link today would be a normal anchor with `#<blockId>` or a host URL. **Design.**

---

## 5. Registering a new `page` tool

- Toolbox entry shape: `icon`, `titleKey`, `name`, `searchTerms`, `searchTermKeys`, `shortcut`, `section`, `preview: { render, descriptionKey }` (toggle example `src/tools/toggle/index.ts:451-461`).
- Every built-in entry must have a `preview` with a `descriptionKey` present in `en.json`, and a fresh element per `render()` (`test/unit/tools/toolbox-previews.test.ts:24-55`). Toolbox sections are `['basic','media','database','advanced']` (`src/components/ui/toolbox.ts:1092`).
- Icon: there is no `IconPage`. Candidates exist: `IconFile` (page with folded corner + 2 lines, `src/components/icons/index.ts:1097-1104`) and `IconFileDoc` (3 lines, `:1115-1121`).
  - Both are already used: in the File block and in `iconGroups` 'Link Types' / 'File Types' (`index.html:2282-2283`).
  - Reusing `IconFileDoc` follows the "reuse icons first" rule, but the toolbox would then show the same glyph for File and Page. A new icon also needs `iconGroups`, `node scripts/generate-icons-dts.mjs`, and a relationship test (project CLAUDE.md).
- i18n: tool names live under `toolNames.*` (`en.json:51-60`, `toolNames.database` at `:171`). New keys: `toolNames.page`, `toolbox.preview.page`, the title placeholder, "Open page", "Untitled".
  - **Memory-derived (not re-read):** each new key must go into all 69 locale files, plus ledger digests, cognate retentions, lifecycle pins, and a regenerated `types/message-keys.d.ts`. I confirmed only that `test/unit/components/i18n/untranslated-strings.test.ts` and `scripts/generate-message-keys-dts.mjs` exist.
- Wiring: `defaultBlockTools` in `src/tools/index.ts:75`.
  - **Memory-derived:** also add it to `types/tools-entry.d.ts`, `test/unit/tools/tools-entry-typecheck.ts`, and the e2e fixture `test/playwright/fixtures/test.html`. All three files exist; I did not read their contents.
- Schema: the block `type` in `blokDocumentSchema` is a free `string` (`src/view/document-schema.ts:51-52`). Per-type `data` validation goes through `if/then` rows (`:89-90`). A `page` block validates without a schema change. Adding a `$defs.page` row is optional and additive.
- Note: the migration plan's "Option C (page block)" (`docs/plans/2026-09-24-notion-model-migration.md:51`) means a ROOT page wrapping the whole document. That is a different, BREAKING idea. It is not this nested page block.

---

## 6. Core code that assumes every block is mounted (risk list for unmounted children)

1. `Blocks.insertMany` mounts every holder at the root, then `rendered()` runs for all (`blocks.ts:417-458`). Page descendants would appear inline at boot.
2. `Blocks.activateBlock` mounts any holder without a parent next to a flat neighbour (`blocks.ts:679-725`). Used by local inserts (`block-insertion.ts:523-525`) and remote adds (`yjs-sync.ts:1980`).
3. `resolveHomeSlot` / `placeBlock` mount a slotless parent's children into the grandparent's slot (`home-slot.ts:60-62`, `hierarchy.ts:657-670`). Drop-onto-page, turn-into-page and API inserts under a page would all show the children inline.
4. `setBlockParent` → `placeBlock`, plus a first-slot mount for self-placing parents (`hierarchy.ts:481-517`).
5. Saver gates: stranded holders (`saver.ts:858-883`), tree placement / home slot (`saver.ts:886-900`, `hierarchy-invariant.ts:260-290`), DOM-order check (`saver.ts:386`, `:423-438`). Each throws in dev/test.
6. `nextVisibleBlock` / `previousVisibleBlock` skip only `hidden` (`operations.ts:283-312`). `getNextContentfulBlock` skips nothing (`repository.ts:218-222`).
7. Select-all and `allBlocksSelected` cover the whole store (`blockSelection.ts:162-177`, `:1545-1575`).
8. The link tool's heading list walks the store and reads detached holders (`inline-tool-link.ts:941-952`).
9. Find walks `document.body` (`find/index.ts:540`). Safe only if the holders are detached, not hidden.
10. The hash target is DOM-only (`hash-target.ts:53`). Sub-page blocks can't be reached.
11. The toggle hide/show logic and `hideUnderCollapsedParent` use the `hidden` class and the `data-blok-toggle-open` marker (`new-block-placement.ts:33-50`, `hierarchy.ts:523-544`). They assume children are mounted.
12. The read-only fallback rebuild (`readonly.ts:264-283`) and `repaintBlocks` (`utils/repaint-blocks.ts:23-66`) re-render the full tree. Any view-root state must be re-applied.
13. `rendered()` of container tools inside sub-pages runs on detached DOM. 29 tool files measure layout. A detached boot has broken table cell placement before (**memory-derived**: table-cell-blocks-detached-boot-collapse, fixed e3ad65b4).
14. The view/Markdown/outline walkers render all children of unknown or childrenOnly types inline (`blocks-to-html.ts:379-384`, `emitters.ts:151-158`).

---

## 7. Recommendation: (c) hybrid on one generic "detached slot" lever

### Why

- **(b) as the drawer does it breaks the law.** Page body would be a blob, not blocks. It contradicts the schema (`document-schema.ts:326`). Collab gets whole-value writes. Copy, find, /view and deep links lose the body.
- **(a) is rejected for two reasons.**
  - Navigation by re-render is impossible (2.2).
  - A mount filter over a whole-workspace store pays the full load cost (every `rendered()` hook, detached). It also needs scoping for undo, select-all, find, link suggestions and keyboard nav at once.
- **(c)** keeps the law (one tree, `parent`/`content`, saved flat). The inline page block shows only its title. Its children are real blocks in the same store but are never mounted inline. The host decides how much of the tree to load (a shallow tree for a big workspace, the full subtree for a small doc).
  - Opening a page shows its subtree. Two options:
    - **c1:** a re-root of the same instance (a view-root mount filter), reusing the lever below. One doc, one undo stack.
    - **c2:** host routing: save the subtree → open it in a page editor → write it back. Simpler. The host owns stitching.
  - **c1 is the end state, c2 the first step.**

### Core changes required

1. **New declared lever, not a page hack:** e.g. `static get detachedChildren(): true` (name TBD) on `BlockToolConstructable`, read in `src/components/tools/block.ts` next to `ownsChildren`/`childTools` (`:123-141`). Published in `types/tools/block-tool.d.ts` (`:230-261` is where the siblings live).
2. **`resolveHomeSlot` gets a new kind `'detached'`** when an ancestor declares it (`home-slot.ts:36-65`). `homeSlotElement` returns null for it (`:78-89`).
3. **`placeBlock` removes holders whose home is `'detached'`** (`hierarchy.ts:657-677`). `setBlockParent` skips the first-slot mount (`:499-517`). `syncVisibilityWithParent` leaves them alone (`:523-544`).
4. **`Blocks.insertMany` and `Blocks.activateBlock` do not mount detached-home holders** (`blocks.ts:405-459`, `:679-725`). They still run `rendered()`, or defer it until the page is opened. Deferring is the cheaper option, but needs a "mounted later" hook. **Design decision.**
5. **Saver exemptions:** add detached-home children to the stranded-holder exemption (`saver.ts:858-871`), the DOM-order exemption (`:386`, `:423`) and the home-slot check (`hierarchy-invariant.ts:269-271`). Do NOT add `page` to `SELF_PLACING_PARENTS`. That set also drives `canAdoptChild` (refuses children on turn-into, `turn-into-children.ts:47-48`) and leaves dropped holders visible at their old place (`hierarchy.ts:671-676`).
6. **Turn-into:** `releasesChildrenOnTurnInto` must return false when the target declares detached children (`turn-into-children.ts:25-38`). Then toggle heading → page and callout → page keep their children as the body.
7. **Navigation/selection scoping:** `nextVisibleBlock`/`previousVisibleBlock` skip detached holders (`!holder.isConnected` or a home check, `operations.ts:283-312`). Select-all limits itself to the visible root's subtree (`blockSelection.ts:172-177`). The link heading list skips blocks with a detached home (`inline-tool-link.ts:941-952`).
8. **Drag & drop:** a new "drop onto block" resolution for detached-children targets: `parentId = page.id`, `afterId = last child` (`DropTargetDetector.ts:16-18`, `:1059-1085`). Plus an indicator style for "into".
9. **Deep links:** `scrollToBlock`/`resolveHashTarget` fall back to the store when the DOM lookup misses. They find the nearest detached-children ancestor and emit an "open page" request to the host (or re-root in c1) (`api/blocks.ts:973`, `hash-target.ts:48-76`).
10. **/view:** a built-in `page` emitter that renders a link (title + `data-blok-id`) and does NOT call `childrenOf` (`emitters.ts:560-573`). Plus an option to render one page's subtree as the document root. The Markdown and outline walkers need the same stop (**unverified** which walker functions need it; I read only `blocks-to-html.ts` and `emitters.ts`).
11. **Database alignment (follow-up):** make `database-row` declare the same lever and move the drawer body from the richText `OutputData` blob into row children (`database/index.ts:1145-1150`, `database-card-drawer.ts:601-627`). That closes the existing law violation, but it changes the saved shape for row bodies. Check whether it is breaking: `git tag --sort=-v:refname | head -1`, then `git log <tag>..HEAD -- src/tools/database` (**not checked**).
12. **For c1 only:** a view-root on UI/Blocks that runs the same detach rule for everything outside the root's subtree, re-applied after `readonly.ts:264-283` / `repaintBlocks`. A title surface for the root page block. Undo scoping stays document-wide unless `UndoManager` scope is narrowed (`undo-history.ts:381-389`). That is an open question.

### Open questions for the user

- Page per URL (host routing, c2) or in-editor navigation (c1)?
- Should undo be per page (Notion-like) or per document?
- Should a large workspace load lazily (shallow tree) from the start? That changes whether `rendered()` deferral (change 4) is needed in v1.
