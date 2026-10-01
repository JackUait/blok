# Cross-page move and undo: getting close to Notion when each page is its own document

Date: 2026-10-01. Research only. Nothing in the repo was changed.

Paths are relative to `/Users/jackuait/Packages/blok`. "Server" means `packages/server/dotnet`.

## Evidence rules

- Every code claim has a `file:line` that was read in this session.
- **The web was unavailable in this session.** Both WebSearch and WebFetch returned "weekly limit".
  - So every claim about what Notion *shows* (toast, ghost, where you land, what Ctrl+Z does after a move) is **UNVERIFIED**.
  - The only primary Notion evidence is in `docs/plans/2026-10-01-page-block-research/2-notion-backend.md` §4. It quotes Notion's data-model post, which says three things:
    - Changes apply to the in-memory and local cache.
    - "At the same time" they are saved to a TransactionQueue in IndexedDB/SQLite "until they're persisted by the server or rejected".
    - A move is one server transaction (`listRemove` + set parent + `listAfter`). That part is reverse-engineered from notion-py.
  - Follow-up: check the visible behaviour in a real Notion session with `playwright-cli`. It will create pages in the account.
- "Inference" marks a design conclusion. "Hypothesis" marks something not yet checked.

---

## 0. Facts the design rests on (all verified)

| # | Fact | Where |
|---|---|---|
| F1 | One room per doc, and each room is a **single-lane actor**: every doc access runs inside one `SemaphoreSlim(1,1)`. | `Blok.Server/Collab/CollabRoom.cs:79-82`, `:157`; `CollabRoomManager.cs:79`, `:211-255` |
| F2 | **One process per document.** The journal fence refuses a second live process with `DocumentOpenElsewhere`. Scale-out means "shard by doc id… never fan a doc across nodes". | `ICollabOperationStore.cs:9-15`, `:129-140`; `docs/plans/2026-08-31-multiplayer-design.md:215-220` |
| F3 | The journal is **per document**. Every write goes through one fenced session for one document. There is no multi-document commit. | `ICollabOperationStore.cs:86-111`, `:172-210` |
| F4 | **The stock host registers no journal.** `UseConformanceJournal` exists only under `#if BLOK_SERVER_CONFORMANCE`. | `Blok.Server.Host/Program.cs:84-96` |
| F5 | `/sync/{doc}/edit` takes the ops `insert`, `update` and `remove`. It is a closed schema and is planned before the transaction opens. A refused request leaves the doc unchanged, and an accepted one commits as one update. | `CollabEditOps.cs:18-41`; `YDocConverter.cs:190-235` |
| F6 | `insert` refuses an id that is already a key of the blocks map. The planner indexes **every** key in the blocks map, including entries that sit in no order array. | `YDocConverter.cs:577-583`, `:475-500` |
| F7 | `update` replaces the whole data map: keys missing from the payload are removed. Text keys are diffed into the live `YText`. | `YDocConverter.cs:885-925` |
| F8 | **Without a journal, `/edit` answers Applied even when persisting failed.** It logs the error, schedules a retry and still returns Applied (non-session branch). The README says the 204 comes "without that promise". | `CollabRoom.cs:503-535`; `packages/server/README.md:62` |
| F9 | The edit body is capped at `CollabMaxMessageBytes`. Anything larger gets a 413. | `EditEndpoint.cs:75-86` |
| F10 | The ticket must name the doc. `/edit` checks `ticket.Document == doc` and then `IBlokAuthorization.CanWriteDocumentAsync`. | `EditEndpoint.cs:38-61` |
| F11 | In collab mode the **consumer's record is a projection**. A room loads from the journal, or from the working set; it seeds from `{doc-endpoint}` only when it holds nothing. | `CollabRoom.cs:1232-1268` |
| F12 | The consumer endpoint URL is `{base}/{escaped docId}`. Version, lineage and sequence travel as headers. | `DocEndpointClient.cs:81-87`, `:150-175`, `:316-321` |
| F13 | Text keys (`text, code, caption, title, alt, artist`) are `Y.Text` on both the client and the server, in lockstep. The client writes them as a diff of the whole saved string. | `src/components/modules/yjs/serializer.ts:36`; `YDocConverter.cs:84-97`; `document-store.ts:1409-1452` |
| F14 | Yjs drops an edit to a deleted container. An item whose parent's item is deleted is deleted on integrate. | `node_modules/yjs/src/structs/Item.js:525-527` (yjs 13.6.32) |
| F15 | A map entry that no order array lists is **still emitted**, appended in an "orphan tail". This is true on the client and in the server export. | `document-store.ts:494-529`; `YDocConverter.cs:2737-2770` |
| F16 | `removeBlock` deletes the block's `Y.Map` and its order entries in one local, tracked transaction. | `document-store.ts:687-699` |
| F17 | An in-doc move runs under the **untracked `'move'` origin**. Its history lives in a separate `moveUndoStack`. A caret stack tagged `kind: 'move' \| 'edit'` interleaves the two timelines. | `document-store.ts:760-775`; `undo-history.ts:181-191`; `types.ts:103-112`, `:137-151` |
| F18 | Undo first asks whether the top entry still applies. A move a peer has since displaced is set aside, not replayed (`groupWasDisplacedSince`). | `undo-history.ts:1418-1440` |
| F19 | `undo()` is synchronous, and it flushes buffered typing first (`flushPendingWritesHook`). | `undo-history.ts:1374-1376`, `:1023` |
| F20 | The client can mint a ticket for any doc with `?doc=<id>` on the host's mint endpoint. | `src/components/utils/access-pass.ts:14-20`, `:51-58` |
| F21 | The client already has a per-doc IndexedDB outbox (`appendLocal`, `acknowledge`). | `src/components/modules/collaboration/operation-store.ts:24-27`, `:152-163` |
| F22 | The C# Yjs engine has **no relative positions** (grep for `RelativePosition`/`StickyIndex` finds nothing). The JS yjs has them. | grep in server; `node_modules/yjs/src/utils/RelativePosition.js:105`, `:163`, `:289` |
| F23 | The server already has a minimal, tag-atomizing text diff. | `Blok.Server/Collab/TextDiff.cs:12-27`, `:93` |

---

## 1. The core mechanism: a three-phase move recorded in the source document

This one mechanism answers questions 1, 2, 3, 4 and 6. Sections 2 to 7 then show each Notion behaviour against it.

### The intent record is the block itself

There is no new store. The intent is a marker on the moving block's own `Y.Map` in the **source** document:

```
move: { id: <moveId>, to: <targetPageId>, by: <actor>, state: 'pending' | 'moved', base?: {<textKey>: string} }
```

Why it lives there:

- It is document content passing through the service. The working set already stores it, and the per-doc journal already stores it when one is registered (F3, F4).
- It needs no `/documents/*` route and no Blok-owned store. "Everything is a block" holds.
- It is a **per-block** key, beside `parentId` and `contentIds`. It must not sit in `data`, because `update` wipes data keys it does not name (F7).

### Phases

| Phase | Where | What | Idempotency without a journal |
|---|---|---|---|
| **A. Claim** | Source lane, via a **new** `/edit` op `claim {id, moveId, to}` | Refuse if the block is missing or already carries a `move` from another `moveId`. Otherwise set `move.state = 'pending'`. The block **stays in the order**. Every client sees the marker within milliseconds. It is also the quiesce signal (§4). | Re-claiming with the same `moveId` is a no-op success. |
| **B. Copy** | Target lane, `/edit insert…` with the **same ids**, parent first | The subtree lands in the target. `move.base` records the text of each text key as copied, which becomes the rebase base. | "already has a block" (F6) on our ids means an earlier attempt landed. That holds only if the copied block carries the `moveId` stamp, so a foreign block with the same id is not mistaken for ours. |
| **C. Commit** | Source lane, new op `commit {id, moveId}` | Allowed only **after durable proof of B** (see below). Unlink the block from the order arrays and set `move.state = 'moved'`. The `Y.Map` stays as a **forwarding stub**. | Committing an already committed `moveId` is a no-op success. |
| **D. Reap** | Source lane, later | Delete the stub's `Y.Map`. | A missing block is a no-op success. |

**Read rules (client and server, in lockstep):**

- A block with `move.state = 'moved'` is skipped by the DFS **and by the orphan tail**. Without this skip, F15 renders the stub at the end of the page and leaks it into the consumer's PUT.
- A block with `move.state = 'pending'` renders as a ghost, and the export keeps it as a normal block. So the consumer's record still has it until the target holds it: a duplicate is possible, a loss is not.

### Three conditions before "never loses data" is true

1. **Durable proof of B before C.**
   - On the stock host, a 204 from `/edit` is *not* durable (F8).
   - Here is how data is lost: the target answers 204, the source commits, then the target process dies before its working set persists.
   - So C requires one of these proofs:
     - a journal receipt (`Blok-Doc-Lineage` / `Blok-Doc-Sequence` on the 204, `EditEndpoint.cs:118-124`);
     - an additive response signal that the working set was persisted (a new header, for example `Blok-Edit-Persisted`);
     - the target's exported projection showing the block.
   - Until then, the stub is the **recovery copy**. That makes it load-bearing for "never lose", not only for forwarding late typing.
2. **Chunked copies.**
   - A large subtree (a toggle, or a big table) can exceed `CollabMaxMessageBytes` (F9). The 413 breaks B's all-or-nothing.
   - B must then send parent-first chunks, each idempotent by the id-collision rule.
   - The source must not commit until **every** chunk is durable. A partial target copy is a visible duplicate fragment, never a loss.
3. **Returns revive, they do not re-insert.**
   - The stub keeps the id in the source's blocks map, and the planner counts it (F6). So moving the block back (B→A), an undo, or a later A→B→A would get "already has a block".
   - A move *into* a document that holds a stub for the same id must therefore **revive** the stub: re-link it, clear `move`, and back-forward the edits made in the target.
   - Reviving also keeps the source's Yjs item identity, which is better than inserting a copy.

### Who drives the saga

| Driver | Pros | Cost / residual |
|---|---|---|
| **The mover's browser** (default) | Instant and optimistic. Its sync connection already has the source open. It mints a target ticket with `?doc=` (F20). The saga queue sits beside the IndexedDB outbox (F21). | It cannot finish if the tab closes after A. Recovery then needs another driver. |
| **The sidecar "move resumer"** | When a room loads, or when a pending marker passes a timeout, the server resumes B, C and D. | <ul><li>The target may live in **another process** (F2). In-process it gets `Unavailable`. Over HTTP it needs its own externally routable URL (new config) plus a ticket it mints itself (it holds the signing secret in ticket mode).</li><li>It acts on authority checked at claim time, which may have been revoked since (residual).</li><li>In ASP.NET in-process mode there is no ticket. It would call `IBlokAuthorization` again as the recorded actor.</li></ul> |
| **The consumer backend** | It already holds both records and authority. `/edit` is documented as its door (`EditEndpoint.cs:8-12`). | The consumer has to implement the resumer. Opt-in. |

**Different processes are not a problem for the saga itself.**

- Every step is a single-doc, linearizable call on one lane: A, C and D on the source, B on the target.
- Each step reaches its room through the load balancer's doc-id routing.
- No cross-process lock is ever needed.
- The only thing that needs both rooms in **one** process is an atomic *export* of both projections (§6).

### A compare-and-set that a client can bypass

- The claim is linearizable only if every claim goes through `/edit`.
- A client, or an old client, can write a `move` key directly through Yjs.
- Read rule to make that harmless: a marker with no target copy proven by the resumer is treated as `pending` and resolved by the resumer, or expired back to normal.
- A forged marker can then delay a block or ghost it, but never lose it.

### Mixed-version rollout (residual)

- Clients without the new read rule show a `moved` stub as a visible duplicate at the end of the page (F15).
- The page-block feature needs a minimum client version per room. One option is a format tag, the same way the working set refuses unknown formats (`CollabRoom.cs:1255-1260`).

---

## 2. Making the move look instant (Q1)

| Notion behaviour | Proposed mechanism | Principle respected | Cost | Residual user-visible difference |
|---|---|---|---|---|
| The block leaves the source page at once. Notion applies the transaction to its local cache and queues it in IndexedDB (report 2 §4, primary). Toast and visual details are **UNVERIFIED**. | <ul><li>The mover's client hides the block **locally** at once. This is a view-only "leaving" state, not a doc write.</li><li>It shows a toast "Moved to ‹title›" with Undo.</li><li>It enqueues the saga in IndexedDB beside the outbox (F21).</li><li>Phase A runs right after.</li></ul> | Blok hosts nothing. The queue lives in the user's own browser storage. | Small. A view flag on the holder, the toast, and a saga queue keyed by `moveId`. | If A is refused (someone else moved or deleted it first), the block reappears with a toast "‹user› moved this to ‹page›". Notion would reject at commit and roll back. Same idea, no difference expected (**UNVERIFIED**). |
| Other viewers of the source see the block vanish (**UNVERIFIED**). | Phase A's marker reaches every client. They render the block as a **ghost** ("Moving to ‹page›…", read-only, the mover's avatar) until C, then remove it. | Data is the signal ("everything is a block"). | Ghost rendering in core, keyed on the marker. | Peers see a brief ghost, usually under one round trip plus the copy time. Notion probably shows no intermediate state (**UNVERIFIED**). |
| The target shows the block if it is open. | <ul><li>If the target is open in the same tab (a peek, or a second pane with its own editor and Y.Doc), the client may apply B **locally first**. Yjs writes are optimistic by nature.</li><li>Otherwise the block appears when B's relay arrives. `/edit` "reaches every open tab" (README:60).</li></ul> | — | None beyond B. | If the target is not open, there is nothing to show. That is the same in Notion. |
| Turn into page / drag onto a page block | <ul><li>Same saga.</li><li>"Turn into page" first calls `pages.create`, as in the existing recommendation §6.3. The target page id comes from that call. Then A→B→C.</li><li>The page **pointer** is inserted in the source in the **same** source transaction as C. The user sees "the block became a page link" in one step.</li></ul> | The consumer owns page creation. | `pages.create` already planned. C gains an optional "insert pointer" step. | With the stock host, the page link appears and the text disappears only once B is durable. Until then the block stays a ghost. |

---

## 3. Never lose data, always complete (Q2)

| Notion behaviour | Proposed mechanism | Principle respected | Cost | Residual |
|---|---|---|---|---|
| A move is one atomic transaction: both pages change, or neither does (report 2 §4, reverse-engineered). | <ul><li>Three phases, copy before delete. The intent record is the marker in the source doc (§1).</li><li>Commit waits for durable proof of the copy (condition 1).</li><li>The stub is the recovery copy.</li></ul> | <ul><li>The intent is document content, so it lives in the consumer's data and the working set.</li><li>No Blok-owned records and no new store.</li><li>The journal is used only as the per-doc store it already is (F3).</li></ul> | <ul><li>New edit ops `claim` / `commit` / `reap`, or one `move` op with a phase. This is additive on a closed schema (F5) and needs a mirror in the JS document store.</li><li>A per-block `move` key with lockstep read rules in `document-store.ts` and `YDocConverter.cs`, both DFS and orphan tail (F15).</li><li>A durable-proof signal for the no-journal host.</li><li>Chunked B.</li></ul> | <ul><li>**Duplicate, never loss**, during failure windows. A crash between B and C leaves a ghost in the source plus a copy in the target until the resumer runs.</li><li>Not atomic in the strict sense (§6).</li></ul> |
| Notion's queue survives a reload (IndexedDB TransactionQueue, primary). | <ul><li>Client saga queue in IndexedDB, keyed by `moveId`.</li><li>It is **an accelerator, not the guarantee**. The guarantee is the pending marker in the source doc, which any driver can resume.</li></ul> | Browser storage stays per-user convenience. Durable state lives in the doc. | Small. Reuse the patterns in `operation-store.ts` (`appendLocal`/`acknowledge`, F21). | A browser that never comes back is covered only if a server-side or consumer resumer exists. Otherwise the ghost stays until someone with target write access opens the source. |
| Retries are safe. | <ul><li>Each phase is idempotent by `moveId` plus the id-collision refusals (F6).</li><li>With a journal, `Blok-Idempotency-Key = H(moveId, phase, chunk)` gets real deduplication (`CollabRoom.cs:470-499`).</li></ul> | — | None beyond the ops. | Without a journal, an `update` inside a phase would not be idempotent (report 4 §2B). Keep the phases free of `update`. Forwarding (§4) uses a new `patch` op that is idempotent by base. |
| Where may the intent live? | **Chosen: in the source doc.** Alternatives below. | | | |
| — `ICollabOperationStore` | The journal is a per-doc op log behind a single-doc fence. There is no cross-doc record and no write path outside a session (F3, `ICollabOperationStore.cs:102-105`). A marker written as an ordinary op **is** journalled automatically. A separate "intent" entity would be a seam change, and the stock host has no journal anyway (F4). | Allowed exception, but it would widen its scope. | High | Not recommended. |
| — browser storage only | It cannot recover when the browser is gone. | OK | Low | Ghost forever. Rejected as the sole record. |
| — a consumer endpoint (`POST {move-endpoint}`) | Optional notification of intent and commit, so the consumer can mirror the move in its own hierarchy table. | OK. These are their records. | Medium, opt-in | Useful for the host's page tree and backlinks, not needed for safety. |

---

## 4. Concurrent typing in the moved block (Q3)

**Can the server quiesce the block?** Partly.

- The lane serializes everything that reaches the room (F1).
- But clients keep typing until they *see* the marker.
- Keystrokes already in flight, plus buffered local writes, arrive after A and after C.

So three tiers:

| Tier | Mechanism | Evidence | Cost | Residual |
|---|---|---|---|---|
| **T1 Quiesce (cheap)** | <ul><li>The phase-A marker is the freeze signal. Every client makes the block read-only and **flushes** its buffered typing at once (`flushPendingWritesHook`, F19).</li><li>The copy (B) is built from the source as it stands *in the lane* after A plus a short settle. So the copy holds everything that arrived before the freeze.</li></ul> | F1, F19 | Ghost/read-only render keyed on the marker. | A window of one network trip: keystrokes sent before the marker arrived. These land in the source block **after** B's snapshot. T2 recovers them. |
| **T2 Forwarding stub plus 3-way patch (server-capable)** | <ul><li>Late edits land in the source block. While `pending` it is live; after C it is the stub. They are **not lost**, because the stub's `Y.Map` is alive. Deleting it would drop them (F14).</li><li>After C and on each later change to a stub, the driver (client or server) sends a new target op: `patch {id, key, base, value}`.</li><li>The target lane computes `diff(base→value)` and `diff(base→current)`, transforms the first through the second (string OT for insert/delete), and applies the result with `EditText`.</li><li>Inputs: `base` is `move.base[key]` (text at copy time); `value` is the stub's current text.</li><li>`TextDiff` already atomizes tags, so markup is not split (F23).</li><li>Leaf fields (checked, level and so on) forward as last-writer-wins only if they changed since the base.</li><li>New children appended under the stub forward as `insert`.</li></ul> | F7, F13, F14, F15, F23 | <ul><li>Medium: the `patch` op, a string-level transform, and a server-side watch for changes to stubs. The room has no per-block observer today (grep: no `ObserveDeep` in `CollabRoom.cs`). The resumer can poll stubs instead.</li><li>A reap policy (below).</li></ul> | <ul><li>Merging at string level with fuzzy offsets can misplace an edit when both sides rewrote the same run. That is rare, and never a silent drop.</li><li>Edits that reach a stub **after it is reaped** are lost (F14).</li></ul> |
| **T3 Exact replay by item identity (client only)** | <ul><li>Yjs item ids belong to one doc, so a source update can never be applied to the target.</li><li>But the target's copy of each text key was written by **one insert in one transaction**. So a base offset `k` maps to the item id `(client, clock₀ + k)`.</li><li>A client that holds the target Y.Doc can rebuild exact positions with `createRelativePositionFromJSON({item:{client, clock}})` and `createAbsolutePositionFromRelativePosition` (F22).</li><li>Requirement: B must return `(client, clock₀)` per text key. Today the `/edit` response carries no body.</li></ul> | F22 | High: a new response shape, a client-side replay, and target sync in the forwarding client. The C# engine cannot do it (F22), so the server stays on T2. | Exact on the client. Unavailable when no client holds the target. |

**Client-side redirect (Q3c).**

- A client that holds pending local edits for a block whose marker turns `moved` learns "block X moved to page P" from the doc itself. It does not need a separate channel.
- It then sends `patch` for its own unsent text to P, with a ticket minted through `?doc=P` (F20).
- If it has no write access to P, it leaves the edit in the stub, and the server's T2 pass forwards it.
- This is the same mechanism as T2, run by the client that owns the edit.

**Reap policy (residual).**

- The stub must outlive every client that could still write to it. Collab has an offline cache, so a client can come back days later.
- Proposal: reap after (a) every member present at C has synced past C, and (b) a TTL at least as long as the offline cache horizon. The horizon is unverified: the eviction policy of `operation-store.ts` was not read.
- An offline edit that returns after the reap is lost (F14). Today the same edit would be lost against any deleted block, so this is not new loss, but it is a known gap.

**Notion comparison:**

- Notion's move is one server transaction on one shard (report 2 §5, inference).
- How it treats a keystroke in flight from another user is **UNVERIFIED**. Notion's offline CRDT internals are unpublished (report 2 §4).
- T1 and T2 close the gap to an edge case of one network trip that merges rather than drops.

---

## 5. One-step undo across two documents (Q4)

| Notion behaviour | Proposed mechanism | Principle respected | Cost | Residual |
|---|---|---|---|---|
| Ctrl+Z after "Move to" or a drop onto a page puts the block back. This is **UNVERIFIED**: Notion's per-page undo after a move was not observed. | <ul><li>A **third timeline**, `kind: 'transfer'`, beside `'move'` and `'edit'` (F17). It gets its own `transferUndoStack` / `transferRedoStack` with entries `{moveId, blockIds, from: BlockPlacement, to: pageId}`.</li><li>Phases A and C are written in the source under an **untracked** origin, as `'move'` already is (`document-store.ts:760-775`). So `Y.UndoManager` never captures half a transfer.</li><li>**Undo = revive.** If the stub still exists (inside the reap window), the source re-links it at `from`, clears `move`, and runs synchronously. The target side (remove the copy, back-forward edits made in the target with T2 in reverse) goes to the saga queue as an inverse transfer `moveId'`.</li><li>After the reap, undo becomes a full reverse transfer (A→B→C toward the source), and the source shows the block optimistically.</li><li>Redo replays the transfer.</li><li>Applies-check, like F18: if the target copy was since moved, deleted, or claimed by another move, the entry is **set aside**, not replayed.</li></ul> | Everything stays in documents. History stays client-side, as today. | <ul><li>Medium, at known sites. Every `kind === 'move'` branch needs a third arm: `undo-history.ts:1425` (undo top), `:1601` and `:1679-1708` (set-aside and put-back), `:1726` (redo top), `:1803` (shedding), `:2445` (`canUndo`/`canRedo` walk), plus `types.ts:112`.</li><li>`undo()` stays synchronous (F19) because the visible half is the local revive. The cross-doc half is asynchronous behind the toast.</li><li>A move back must **revive, not insert** (condition 3), or it hits "already has a block" (F6).</li></ul> | <ul><li>Ctrl+Z in the **target** editor does nothing. The insert arrived there as a remote origin, which is excluded from undo (memory `multiplayer-design`: "unknown origins… undo-excluded"). Notion's behaviour here is **UNVERIFIED**.</li><li>A host-level shared history across editors would close this gap. Out of scope.</li><li>An undo the target refuses (no write access any more, or the page was deleted) leaves the block in the target, with a toast. It is never lost.</li></ul> |
| The two undo stacks give a duplicate (the problem statement). | <ul><li>The source records the transfer as **one** entry.</li><li>The target records **nothing**, because its insert is untracked or remote there.</li><li>So no pair of independent undos exists to fire.</li></ul> | — | — | — |

---

## 6. Optional strict atomicity: a consumer batch endpoint (Q5)

| Mode | Is strict atomicity real? | Mechanism | Cost | Residual |
|---|---|---|---|---|
| **Single-player `persistence`** (no sidecar; the consumer record is the truth) | **Yes.** | <ul><li>Opt-in host callback `pages.transfer({ moveId, from: {pageId, data, version}, to: {pageId, data, version} })`.</li><li>The host commits both records in one database transaction, or rejects both.</li><li>If it is absent, Blok falls back to `pages.insert`, then a local delete and save.</li></ul> | Small. A typed member in `types/` (hand-authored, published-types law) and the fallback path. | None beyond the host's own database. |
| **Collab, no journal** (working set authoritative, consumer record a projection, F11) | **Only the projection.** | <ul><li>New opt-in `--doc-batch-endpoint`: a **separately configured URL**.</li><li>It cannot be `{doc-endpoint}/batch`, because `UrlFor` builds `{base}/{escaped id}` (F12) and a document named `batch` would collide.</li><li>Body: `{ move: {id, from, to}, documents: [ {doc, data, version, lineage?, sequence?} ] }`. Version, lineage and sequence move **from headers into per-entry fields** (F12).</li><li>Answer: 200 with versions per doc, or 409 for the whole batch.</li></ul> | <ul><li>Medium. Emitted at phase C, and only if **both rooms are in this process**. Then hold both lanes in ordinal doc-id order, so there is no deadlock, and export both.</li><li>Cross-process means no batch; fall back to independent PUTs.</li></ul> | The live rooms still move in three phases. Only the consumer's copy jumps atomically. |
| **Collab with journal** (journal authoritative) | **No.** | Atomicity would need a multi-document append across two fenced sessions. The seam deliberately has none (F3), and the fences may sit in two processes (F2). | High: a seam change plus two-phase commit. | Not recommended. Use §1. |

**What stays opt-in:**

- No config key, no batch.
- Version headers on the existing PUT do not change.
- Additive, so not breaking (CLAUDE.md "Breaking Changes": new surfaces only).

---

## 7. Concurrent moves of the same block, and cycles (Q6)

| Case | Notion | Mechanism | Cost | Residual |
|---|---|---|---|---|
| Two users move the same block to P1 and P2 at once. | One transaction wins on the server. The UI result is **UNVERIFIED**. | <ul><li>Phase A is a compare-and-set **inside the source lane** (F1), and one process per doc (F2) makes it linearizable. The second claim is refused with 409.</li><li>The loser's client reverts its optimistic hide and toasts "‹user› moved this to ‹page›".</li><li>The loser has not copied yet, because B follows A, so nothing is left to clean up.</li><li>Fallback when the claim cannot use the lane (persistence-only, or a client writing through Yjs): last-writer-wins on `move`. The loser sees a foreign `moveId` and removes its own copy from its target (compensation).</li></ul> | Small, given the ops in §1. | <ul><li>Fallback path: a copy may remain if someone edited the loser's copy before compensation ran. A duplicate, never a loss.</li><li>An edit-vs-move race on the same block is T1/T2.</li></ul> |
| One user moves a block, another deletes it. | **UNVERIFIED** | <ul><li>A delete of a block carrying a `pending` marker is refused or deferred by core.</li><li>After C, a delete of the stub is a no-op (it is invisible).</li><li>Delete before A makes the claim fail ("no block"), and the mover's UI reverts.</li></ul> | Small | A peer's delete through Yjs bypasses the lane. The read rule must keep a pending block until the resumer resolves it. |
| Moving a block into its own sub-page (a cycle). Prior art: Outline checks cycles in the model hook; Logseq throws `not-allowed-move-block-page` (report 5 §3, §7). | Refused (**UNVERIFIED** in the UI). | <ul><li>**Local check (Blok):** refuse if the moved subtree holds a page block whose `pageId` is the target. Inside one doc this reuses `wouldFormCycle` (`document-store.ts:790-792`) for a page block dropped onto itself.</li><li>**Deep check (host):** the target may be a *descendant* of a page inside the moved subtree, and only the host knows the page tree. Add an optional `pages.canMove?(blockIds, toPageId) → boolean \| Promise<boolean>`, or `pages.ancestors?(pageId)`, asked before A.</li></ul> | Small | <ul><li>A host without the check can get a pointer cycle (P1 contains a link to P2 and P2 contains a link to P1, from two concurrent moves in two different source docs). No single lane sees both, so only the host's hierarchy can refuse it.</li><li>It is a navigation cycle, not data loss. Breadcrumbs and the host's cascade-delete need a loop guard.</li></ul> |
| Moving a **page block** (the pointer) to another page. | One transaction (report 2 §4). | <ul><li>The same saga moves only the small pointer block. The page's own document does not move (report 5 §7, "a tree-edge edit, never a content copy").</li><li>The host's parent record updates through the optional move notification (§3).</li></ul> | Small | The host's sidebar tree lags until it processes the notification. |

---

## 8. What to build, in order (inference, for a future plan)

1. **Read rules and the `move` key**, client and server in lockstep. Skip `moved` in the DFS and the orphan tail (F15). Render `pending` as a ghost. Add a format or version gate.
2. **Edit ops `claim` / `commit` / `reap` / `patch`** in `CollabEditOps.cs` and `YDocConverter.cs`, plus the durable-proof signal on the no-journal path (F8). TDD per op. Run only the new test classes.
3. **Client saga driver:** an IndexedDB queue, target tickets through `?doc=`, chunked B, revive-on-return.
4. **Undo `kind: 'transfer'`** at the listed sites (§5).
5. **Forwarding (T2)** and the reap policy.
6. **Optional:** `pages.transfer` (single-player atomic), `pages.canMove`, `--doc-batch-endpoint`, and a sidecar resumer with a self URL.

**BREAKING check:**

- All of this is additive: new ops, a new per-block key, new optional config.
- **But** the new per-block key changes the doc schema. Old clients render stubs (§1 residual).
- So the room format gate is the real compatibility decision for the user.

## 9. Still unverified

- Every visible Notion behaviour above: the toast, ghosts, Ctrl+Z after a move, where you land, and the result of a concurrent move. The web was unavailable. Check with `playwright-cli`.
- The offline cache retention horizon, which sets the reap TTL.
- Whether `/edit` can grow a response body (T3) without breaking existing callers.
- Whether a string-level transform can follow the client's `diffText` rule of inserting before deleting (`document-store.ts:1437-1447`).
