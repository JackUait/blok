# The correct variant — how to build it, and what it actually costs

Research run 2026-09-18, continuing `2026-09-18-path-3-rich-text-as-data.md`. Three parallel
investigations plus my own measurements, each independently re-verified. Everything is
measured on **yjs 13.6.32** unless labelled.

The question this answers: *what do we need for the correct variant?*

---

## 0. The answer in three lines

1. **No second CRDT.** The Peritext model builds on yjs — measured, including the cases yjs's
   own formatting gets wrong.
2. **"Everything Is a Block" does not have to bend.** There is a shape where document order
   stays exactly where it is today and splits are still correct — measured.
3. **The cost is not in the data model. It is in the editing layer, and there it is a
   rewrite of the core plus a break in the published tool contract.**

---

## 1. Marks as data, on yjs — measured

Characters in a `Y.Text` with **no formatting at all**. Marks in a separate `Y.Array`, each
anchored by two `Y.RelativePosition`s — character identities, not offsets.

| case | yjs native `ContentFormat` | anchored marks |
|---|---|---|
| two peers, same key, overlapping ranges | `"The fox"` bold, `" jumped."` **not** — a peer's mark dropped on a region they never contested | `"The fox jum"` bold — **union, correct** |
| peer types inside a marked range | correct | `"fXXox"` bold — correct |
| peer types at the boundary | — | `"two"[bold,link]` then `"X"[bold]` — **bold expands, the link does not** |
| two marks of ONE type (comments) | **impossible** — one key per name | `"The "[c1] "fox"[c1,c2] " jum"[c2]` — correct |
| 1000 marks over 50k chars | — | resolve in **1 ms** |

`assoc` (-1 / +1) on a relative position reproduces Peritext's `expand` exactly. That is the
one feature the model is usually said to need a bespoke CRDT for, and yjs already has it.

---

## 2. Two blockers in the naive version — both found by measurement, both silent

The version validated in the first pass — *marks in an array, removal by deleting the entry*
— is **broken in two ways that converge, never self-repair, and therefore never trigger any
error path.**

### Blocker A — concurrent partial un-format loses BOTH users' edits

A fully bold sentence. A un-bolds `quick`; B concurrently un-bolds `lazy`. Each does the
natural thing: drop the entry, push the two surviving halves.

```
want: BBBB.....BBBBBBBBBBBBBBBBBBBBBBBBBB....BBBBB
got : BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB      converged: true
```

Each peer's surviving halves re-cover the other's hole. **Neither un-bold survives, and the
document is self-consistent, so nothing ever notices.**

This is exactly why Peritext says *"we never remove an operation, we only ever generate new
operations"* — a deleted array entry carries no timestamp, so a concurrent add has nothing to
arbitrate against.

**The fix, measured:** removal is an **operation**, not a delete. Entries are
`{op: 'add' | 'remove', type, start, end, lamport, client}`; the renderer resolves
per character by highest `(lamport, client)`.

```
want: BBBB.....BBBBBBBBBBBBBBBBBBBBBBBBBB....BBBBB
got : BBBB.....BBBBBBBBBBBBBBBBBBBBBBBBBB....BBBBB      converged: true, correct
```

*(I verified both halves of this myself. My earlier "removal works and converges" measured
the wrong case — deleting a mark outright, which does work. Partial removal is the one that
breaks.)*

### Blocker B — undo of a deletion desyncs marks across peers, permanently

Delete a bolded range, press Ctrl+Z. The text comes back byte-identical everywhere.

| `followUndoneDeletions` | the undoer sees | every other peer sees |
|---|---|---|
| `true` (**the yjs default**) | `5..10` — bold restored | `10..10` — **collapsed, gone** |
| `false` | `10..10` | `10..10` |

Cause, from source: `createAbsolutePositionFromRelativePosition`
(`node_modules/yjs/src/utils/RelativePosition.js:301`) follows `Item.redone`, which is set
only in `redoItem` (`src/structs/Item.js:241`) and **never appears in
`src/utils/encoding.js`** — it is a local-only field, never transmitted. Peers have no link
to follow.

**The fix:** pass `followUndoneDeletions: false` everywhere. That is convergent but lossy —
undo restores the text and not the mark, on every machine. Restoring the mark on undo means
making the mark-undo a tracked operation in its own right.

---

## 3. The shape that keeps "Everything Is a Block"

The earlier document concluded that a correct split requires giving up per-block text
containers, which is exactly what the founding law prescribes. **That conclusion was too
strong.** There is a third shape, and I verified it independently.

### The pool

- One document-level `Y.Text` holds every block's characters.
- Each block's run is delimited by a **pair of embeds**: `{s: id} … {e: id}`.
- **Position in the pool means nothing and is never read.** Document order stays exactly
  where it is today — `Y.Array('root')` plus each block's `contentIds`, walked by
  `deriveOrderedIds` (`document-store.ts:364`).
- A **move touches no characters at all** — it edits order arrays, byte-for-byte today's
  `moveBlock` (`document-store.ts:547`).
- A **split is two marker inserts at the caret.** Nothing is deleted, nothing re-created, so
  the tail characters keep their identity.

Measured, independently reproduced:

| scenario | result |
|---|---|
| Enter, peer typing in the tail | `{b: "Hello", b2: " worZZZld"}` — **in the tail, in the right place** |
| move a block, peer typing in it | `{b: "bbbXY"}`, order `[a, c, b]` — **nothing lost** |
| delete a block, peer typing in it | gone cleanly — **not misattributed to the neighbour** |

### Why the obvious flat shape is worse, not better

The Automerge-style shape — where **pool order IS document order** — was measured and is
unusable here:

| scenario | outcome |
|---|---|
| split inside a nested list item, peer typing in the tail | correct |
| **move a child between parents, peer typing in it** | peer's text lands in the **previous block** |
| **delete a mid-doc block, peer typing in it** | peer's text relocated into the **preceding block** |
| **two peers move the same block** | order returns `['x','h1','h2','tail','x']` — **the block appears twice**, one copy holding the text, one an empty ghost |
| **A splits a block, B moves it** | the split is **entirely lost**; an empty phantom block is left behind |

Every one of those is the same law Blok already has written down
(`document-store.ts:53-58`): *a move must never delete-and-recreate a block's container,
because a peer's concurrent edit would have nowhere to land.* Making pool order load-bearing
forces exactly that. Decoupling the two is what makes the pool safe.

The paired markers (rather than one marker per block) are load-bearing too: with a single
marker, a peer typing into a block another peer deleted has its characters **misattributed
into the preceding block**. With a pair, they land between two runs, belong to no block, and
both peers agree.

---

## 4. Mark lifecycle — the numbers

| question | measured answer |
|---|---|
| storing positions raw vs `encodeRelativePosition` | **143.6 vs 51.3 bytes/mark** — always encode, 2.8x for free |
| growth, array-delete + `gc:true` | **flat** — 10,000 toggles add 0 bytes |
| growth, remove-as-op (the correct shape) | **~128 bytes/toggle, forever** — 10k toggles on a 2 KB doc = 1.28 MB |
| growth, realistic hour (200 actions, 80/20 add/remove) | 20,006 B vs 16,693 B — **the correctness tax is ~20%** |
| adjacent runs merged by anything | **no** — 1000 adjacent bold runs stay 1000 entries |
| round trip, 10k marks over 54k chars | encode 8.3 ms, decode 11.4 ms, resolve 3.0 ms — **22.7 ms** |
| round trip, 50k marks | **106 ms**, 3.76 MB |
| anchors into deleted text | **collapse, never null**: whole range deleted → `5..5`; overlapping delete → `3..6` |
| `null` anchors | two causes: the text update has **not arrived yet** (transient), or the parent block was GC'd |
| does GC break text anchors | **no** — `Item.gc` keeps the Item skeleton unless the parent is GC'd |
| does GC break anchors into a **deleted block** | **yes** — `gc:true` (the production default, `document-store.ts:77`) gives `null`; `gc:false` gives `0` |

### What a naive implementation would get wrong

1. Removing a mark by deleting the array entry (Blocker A).
2. Leaving `followUndoneDeletions` at its default (Blocker B).
3. Storing positions raw — 2.8x for nothing.
4. Assuming the op log is bounded. It is not.
5. **Compacting adjacent runs with a fresh timestamp** — measured: it *resurrects a
   concurrently-removed mark*. Compaction must carry the **maximum** Lamport of the entries
   it merges. Concurrent compaction by two peers is **unmeasured**; safest position is to
   compact on a single designated writer only.
6. Garbage-collecting marks that resolve to `null` — `null` is the normal transient state
   while a peer's text update is in flight. A sweeper doing this deletes live marks during
   ordinary sync.
7. Treating a collapsed (`start === end`) mark as dead — undo of the text deletion brings it
   back.
8. Turning `doc.gc` off to make deleted-block anchors uniform — it converts bounded churn
   into 51 B/toggle unbounded growth.

**The open risk, not closed:** unbounded op-log growth with no measured multi-writer
compaction story.

---

## 5. The editing layer — this is the actual project

### Risk 1 — the DOM is the authority, and third-party tools own it

`types/tools/block-tool.d.ts:42`, the published contract:

```ts
save(block: HTMLElement): BlockToolData;
```

Every tool serializes itself by reading its own DOM back. 45 of the files under `src/tools/`
read `innerHTML`; 39 create their own `contenteditable`. Core *discovers* the editable with a
`querySelectorAll` (`src/components/dom.ts:229-234`) — it does not create it. React, Vue and
Angular block authors render their own contenteditable in their own templates.

A model-first text layer requires **core to own the text DOM** — render runs from the model,
diff them. The contract says the tool owns it. Both cannot be true. So the project is not
"swap the storage format", it is **inverting the ownership of the text region**, which means
a new tool API for "a text field lives here, core renders it", `save(element)` becoming
meaningless for text tools, and a compatibility path for legacy tools kept alive
indefinitely.

**This is the failure mode: the model, the marks and the renderer can all be correct and
still be unshippable, because the editing surface belongs to code we do not control.**

### Risk 2 — caret on re-render, with precedent in-tree

There is **no incremental text rendering anywhere**. Every in-place data application is a
full `innerHTML` blow-away (`data-persistence-manager.ts:152`, `header/index.ts:676`,
`block-insertion.ts:571`; 55 `innerHTML =` write sites in `src/components`).

The one place Blok already re-renders text under a live caret is the remote-edit path, and
the code says what it costs — `yjs-sync.ts:790-793`: *"setData rewrites the tool's content
wholesale, which throws away the local user's caret, so a rewrite that would change nothing
must not happen at all."* The deep-equality guard at `:801` exists **only** to avoid
re-rendering, and the restore (`remote-edit-caret.ts`) is documented best-effort.

In a model-first design this fires **on every keystroke, on the local user's own caret**, and
the guard that makes it survivable disappears by construction. That needs run-level
incremental patching that preserves the text node the caret sits in. None exists.

*(Labelled: this is an architectural argument from the code, not a measurement. The cheap
experiment that would settle it: force the `yjs-sync.ts:801` equality guard to always fail
and type in a long paragraph.)*

### Risk 3 — there is no IME handling at all

```
grep -rn "compositionstart\|compositionupdate\|compositionend" src/   ->  0
```

Zero handlers. The entire composition story is seven defensive `event.isComposing`
early-returns. And that is **correct today**, precisely because Blok never fights the browser
for text insertion — one of those comments says it outright: *"It belongs to the input
method, not to blok."*

A model-first editor must suppress rendering between `compositionstart` and
`compositionend`, keep a shadow of the composing region and reconcile at commit. Chrome,
Safari and Firefox each differ. This is the part of ProseMirror/Slate with the longest bug
tail, and Blok has no composition test coverage to start from.

### Blok is a read-back editor, unambiguously

No `input` listener is ever attached to a contenteditable — `input-manager.ts:175-183`
attaches `'input'` **only** when `$.isNativeInput(input)`. Contenteditable changes are
detected by MutationObserver, then `block.save()` reads the DOM back. The only interception
is structural keys on `keydown`: `KEYS_REQUIRING_CARET_CAPTURE = {Enter, Backspace, Delete,
Tab}` (`uiControllers/constants.ts:6`).

What it would have to become is a full `beforeinput` interpreter covering every `inputType`
the platform emits, plus `getTargetRanges()` mapping DOM ranges back to model offsets. None
of it exists, and the existing 4,532 lines under `blockEvents/composers/` cannot be reused,
because all of it assumes the mutation already happened.

### Size

| area | LOC | fate |
|---|---:|---|
| `blockEvents/` | 5,338 | rewritten (keydown-after-the-fact → beforeinput intent) |
| `caret.ts` + `utils/caret/` | 2,648 | rewritten (Range → model positions) |
| `selection/` | 1,980 | largely rewritten |
| `marks/` | 977 | replaced |
| `inline-tools/` | 4,798 | rewritten |
| `paste/` | 6,214 | ~30-35 call sites; the sanitizer boundary is the blocker |
| `block/` | 2,985 | `save()` contract inverted — public break |
| `blockManager/` | 8,417 | split/merge/insert rewritten |
| `yjs/` | 5,043 | serializer + store need the sequence; `undo-history.ts` mostly survives |
| **new, does not exist** | — | beforeinput interpreter; composition handling; incremental patcher; model-first tool API + legacy shim |

~38,400 lines in scope, of which roughly 15,000 is genuine rewrite, plus three subsystems
from zero. Test surface: 1,375 unit files, 353 e2e specs (208 driving the keyboard).

*(The LOC "fate" column is judgement, not measurement.)*

### One thing that gets better

Undo. `undo-history.ts` contains zero references to `text` or `data`, and
`Y.RelativePosition` would replace the offset-plus-fallback ladder at `:890-925`. This is the
one area that argues **for** the change.

---

## 6. What does NOT break — the surprising part

- `moveBlock`, `applyPlacement`, `deriveOrderedIds`, `hierarchyView`, the cycle-break law,
  the first-occurrence dedupe — **unchanged**. Order still lives in `root[]` + `contentIds`.
- `BlockHierarchy.setBlockParent`, `mountChildBlocks`, the child-holder decoration law,
  `ownsChildren` / `childTools` — **unchanged**. Nesting never touched text.
- Container tools (table, columns, toggle, callout) — unchanged at the hierarchy level.
- **The public `OutputData` surface** — `Saver.doSave` reads `BlockManager.blocks`, the
  in-memory blocks, never the doc (`saver.ts:210-211`). As long as `toJSON` still emits
  `data.text` as an HTML string, nothing outside changes. **No `BREAKING` label for the saved
  data format** — provided the HTML↔marks codec is lossless (assumption, not verified).

The wire format between peers and the .NET server *does* change. That is a collab-protocol
break, not an `OutputData` break.

---

## 7. What it would actually take, in order

**Stage 0 (free, independent, do regardless).** Key the columns in the grid rule
(`serializer.ts:307`) and make the primitive arrays mergeable. Fixes measured losses today,
needs no format change.

**Stage 1.** The format gate becomes a set on both sides, the journal-path hole closes
(`CollabRoom.cs:1238-1249`), and an unreadable format gets a terminal close code instead of
4503's infinite retry. **Before anything else** — with a scalar there is no way back.

**Stage 2.** The HTML↔(characters, marks) codec, as a pure function with round-trip tests.
No storage change yet. This is the piece every later stage needs, and it can be built and
proven in isolation.

**Stage 3.** The model-first tool API — "a text field lives here, core renders it" — plus the
legacy `save(element)` shim. **This is the gate.** If this cannot be made acceptable to
consumers, nothing downstream ships.

**Stage 4.** The incremental run-level DOM patcher and the `beforeinput` interpreter, with
composition handling. The two largest new subsystems. Neither has any existing code to start
from.

**Stage 5.** Storage: the pool with paired markers, and marks as append-only add/remove ops
with Lamport LWW, encoded positions, `followUndoneDeletions: false`.

**Stage 6.** The C# mirror — `YDocConverter.cs` (1891 lines) plus its conformance fixtures,
in lockstep. Two languages, one schema.

Stages 0 and 1 are worth doing whatever is decided about the rest.

---

## 8. The honest summary

The data model is **solved and cheap**: it builds on yjs, it is measurably correct on every
case including the ones yjs itself gets wrong, it does not violate *Everything Is a Block*,
and it resolves 1000 marks in 1 ms. Two silent blockers exist in the naive version and both
have measured fixes.

The editing layer is **a rewrite of the core with a public API break that reaches every
consumer's custom tool**, and it requires two subsystems — a `beforeinput` interpreter with
IME handling, and an incremental caret-preserving patcher — that do not exist in any form
today.

So the decision is not "is the model right". It is whether to invert the ownership of the
text region, break `save(block: HTMLElement)` for everyone, and build a composition-safe
input pipeline from zero — in exchange for ending a class of silent data loss that is real,
reproducible, and happening now.

**The number that should decide it, and which I do not have:** how often two people actually
type in the same paragraph in real documents. Everything above says what it costs. Nothing
above says how much it is worth.
