# Character-level carets — research findings and staged plan

Research pass 2026-09-18 against `main` `a5c4e93a`. Five parallel read-only
investigations plus one reproduction. **No implementation decision is taken here** —
this records what is true, what it costs, and what order the work has to happen in.

Supersedes the sizing in `2026-09-01-multiplayer-phase4-plan.md` decision 13, which
named the blocker as "HTML-offset↔DOM mappers per tool, an in-contenteditable overlay
layer". Both halves of that turned out to be wrong, in opposite directions.

---

## 1. The reframing

### What decision 13 got wrong, measured

**There is no HTML-offset↔text-offset mismatch.** `offsetWithin`
(`src/components/modules/collaboration/caret-position.ts:51-58`) computes offsets with
`range.toString().length`, which per spec concatenates character data only — tags
contribute nothing. Measured on `<b>ab</b>cd`: 11 stored characters, 4 text characters,
published offset **4**. The inverse (`Dom.getNodeByOffset`, `src/components/dom.ts:642-651`)
accumulates `textContent.length` and agrees. Every offset producer in the caret path uses
the same idiom (`caret-position.ts:57`, `src/components/utils/caret/selection.ts:89`), and
the one place that genuinely cuts an HTML string — block split,
`src/components/modules/blockManager/block-insertion.ts:455-471` — computes no index at all; it extracts a DOM
fragment and re-reads `innerHTML` from both sides.

So the wire already speaks Y.Text's coordinate system, UTF-16 code units of text content.
The caret payload would not need re-basing.

**The overlay layer already exists and is already character-precise.**
`presence-carets.ts` positions the caret line from `measureLine(input, caret.head)` and the
selection shades from `measureSelection(input, anchor, head)`, both built on a `Range`
resolved at an arbitrary character offset. Y.Text would not change one line of the drawing
code.

### What it under-stated

**Blok has no mark-list data model.** `MarkSpec` (`types/api/marks.d.ts:26-58`) describes a
DOM wrapper; the persistence format is an HTML string; and the identity rules were designed
for DOM surgery, not for data. A Y.Text over `data.text` is a per-character CRDT over a
string whose characters are *tags*.

The rules that have no counterpart in a flat attribute map:

- **Function-valued properties are excluded from identity on purpose.**
  `types/api/marks.d.ts:1-11` and `src/components/marks/mark-engine.ts:86,110`: "only the property's presence
  counts. That is what makes a colour picker one mark that updates in place, rather than N
  mutually-cancelling marks." Y.Text has no "same attribute, new value, update in place".
- **`transparent` counts as unset** (`src/components/marks/mark-engine.ts:32-34`) while the marker tool
  deliberately writes it to defeat the UA's yellow `<mark>` background
  (`inline-tool-marker.ts:510-517`). A value that must exist in the DOM and must be absent
  from identity.
- **Family composition**: `style` is excluded from identity (`matchesMarkFamily`,
  `src/components/marks/mark-engine.ts:98-112`), which is what lets text colour and background colour compose on
  one element instead of nesting.
- **`aliasTags`** (`b`/`strong` are one mark) is canonicalised by a live MutationObserver
  (`inline-tool-bold.ts:266-313`), not by a data rule.
- **The key space is open** — consumers register their own specs, and C# would have to agree.
- **Nested identical marks are prevented, not represented** (`src/components/marks/mark-engine.ts:529-545` plus
  `test/unit/architecture/inline-normalization-law.test.ts`).
- **The stored string is not canonical**: `<b><i>x</i></b>` and `<i><b>x</b></i>` are
  different bytes for identical semantics, and `src/components/utils/inline-normalization.ts:124,151-157` only
  unwraps and absorbs, never reorders. A character CRDT would interleave two peers'
  opposite nesting orders into garbage.

So the work is: invent a canonical mark-list representation, write a lossless
HTML↔mark-list codec, and mirror the identity rules in C# — **before** a caret is drawn.
That is larger than the mappers decision 13 named.

---

## 2. The hop that makes everything else pointless

A remote text update is applied by `BlockYjsSync.handleYjsUpdate`
(`src/components/modules/blockManager/yjs-sync.ts:687`, the call at `:791`) calling `block.setData(data)`. For a tool with no own
`setData` — paragraph has none — `DataPersistenceManager.setData` takes the
contenteditable fast path:

```ts
// src/components/block/data-persistence-manager.ts:152
pluginsContent.innerHTML = newText;
```

The whole subtree is replaced. Replacing `innerHTML` detaches every text node the local
selection anchors into.

**There is no caret protection on this path.** Grepping `yjs-sync.ts` for "caret" returns
one hit and it is a comment (`:100`). Caret snapshots exist only for undo
(`yjs/undo-history.ts:67-105`), keyed per Yjs `StackItem`, and nothing consults them on a
remote event. The echo guard (`src/components/modules/blockManager/blockManager.ts:1827`) stops the rewrite being written *back*
to Yjs; it does not stop the rewrite. The per-block settling window
(`src/components/modules/blockManager/yjs-sync.ts:187-262`) opens only for a remote ADD, never for an update.

**Consequence: character-level merging buys nothing until this hop is replaced.** Letters
would merge in the document while every remote keystroke still rebuilt the paragraph and
threw the local caret out of it.

**This is a defect today, without any Y.Text work**, and it is wider than a reading of the
code suggests. Reproduced in a real browser (A's caret 5 characters into "hello world", B
appends "!!!"): the anchor goes from `#text`/5 to `DIV`/0 and the text node it held is
detached. It is **every** text tool, not only paragraph — `header/index.ts:672`,
`toggle/block-operations.ts:109`, `list/block-operations.ts:147`, `code/index.ts:369`
(`textContent`), `table/index.ts:1065` all rebuild.

And it fires on **every** remote update, not only on a text change: measured, a peer
changing only `textColor` while `text` stayed byte-identical still moved the caret, because
the `equals` dedup at `document-store.ts:942` guards the WRITE side only and
`handleYjsUpdate` calls `setData` unconditionally (`yjs-sync.ts:791`). A remote edit to a
different block does not move it (`reconcilingBlocks` is per-id — measured).

Open, deliberately not asserted: whether a React block survives a real remote edit. Its
`setData` dedups no-ops (`packages/react/src/createReactBlock.tsx:850-857`), but a real
edit re-renders, and whether the caret survives depends on the consumer's component. There
is no collab+React harness to measure it cheaply.

Two traps on the same hop for later: if text became a Y.Text, `typeof textValue === 'string'`
(`:146`) goes false and the block falls through to a full `rematerialize`; and
`equals(currentValue, value)` (`document-store.ts:942`) is a false negative against a
Y.Text, exactly like the Y.Map and Y.Array branches already call out.

---

## 3. LAW — the fallback that saves the room today would destroy data tomorrow

Both sides already tolerate a foreign peer's `Y.Text`, deliberately and correctly:

- `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs:1710-1716` —
  `case YText text: plain = JsonValue.Create(text.ToString());`, with the comment
  "rather than making the room permanently unreadable".
- `src/components/modules/yjs/serializer.ts:471-475` — any `Y.AbstractType` is flattened
  through `toJSON()`.

`Y.Text.toString()` and `Y.Text.toJSON()` both return the **bare string**
(`node_modules/yjs/src/types/YText.js:935-959`): formatting attributes and embeds are
dropped, plain content is not.

**The law is conditional on the text being FORMATTED, and that qualifier is what makes the
cheap path in §10 possible.** For an unformatted `Y.Text` both fallbacks are LOSSLESS — the
complete string comes back. For a formatted one, both sides silently flatten it: no error,
no crash, and on the server `DocEndpointClient` persists the loss to the host's record.

**Any change that starts writing a FORMATTED `Y.Text` must fix both of these in the same
change.** Worse than a crash, because nothing reports it.

Corrected during review: an earlier draft claimed a format-2 document on an old server
"fails loudly" because the converter's value switch has no `YText` case. False. There is one
switch (`TryToPlain`, `YDocConverter.cs:1656`) and it holds **both** the `case YText` at
`:1714` and the `default: throw` at `:1776` — a `YText` never reaches the default arm. An
old server flattens silently. This makes the law stronger, not weaker.

---

## 4. The C# engine is not ready, and the gap is measured

`packages/server/dotnet/Blok.Server/Yjs/YText.cs` documents its own scope: "the minimal
write API of Locked Decision 8: insert, delete and the string. There is no formatting, no
embed and no attribute argument."

Absent: `format`, `insertEmbed`, `applyDelta`, `toDelta` (a port exists only in the test
project, `Blok.Server.Tests/Yjs/JsonRenderer.cs:182-215`), type-level observers,
`cleanupYTextAfterTransaction`, `_searchMarker`, `_hasFormatting`.

**`StickyIndex`/`RelativePosition` is absent entirely** — zero matches across the repo.
Implementing it needs a relative-position type, `createRelativePositionFromTypeIndex`,
`createAbsolutePositionFromRelativePosition` with a followUndoneDeletions walk, a wire
codec, and a comparison. The pieces it builds on (`YId`, `StructStore.GetItemCleanStart`/
`GetItemCleanEnd`/`Split`, `Lib0Writer`/`Lib0Reader`) all exist.

**But it is NOT a caret blocker, and an earlier draft wrongly charged it to this feature.**
The server never resolves a caret: `CollabRoom.cs:1865` dispatches an awareness frame to
`RelayAwarenessLocked` (`:1896`), which validates structure and ownership and relays the
bytes. The caret payload is opaque to it. C# `StickyIndex` is needed only if something
server-side ever has to resolve a position — nothing does today.

**Measured divergence from real yjs on formatted text: 40% of documents.** A differential
over 300 documents × 5 ops (1500 ops total): text content never disagreed; `toDelta`
disagreed in 119/300. Root-caused to `_searchMarker` — yjs's `findPosition` builds the
position with an *empty* `currentAttributes` map when a marker is used (`YText.js:130`),
which changes how far an insert forwards past format items. Proof: disabling the marker on
the yjs side and rerunning the identical 1500 ops gives **0 mismatches**. The comment at
`YText.cs:89-92` claims the marker is only a cache that lands on the same item — true for
the index, false for the attributes.

A twist: which behaviour "real yjs" has depends on call ordering. `getText()` before the
formatted update arrives leaves `_searchMarker: null`, matching our engine exactly; after,
it is `[]` and 289/1500 ops differ. So this is a decision to take, not only a bug to fix.

**Why it went unnoticed**: the fixture corpus exercises Y.Text formatting with the engine as
*reader* in exactly two hand-picked cases, and the fuzzer excludes formatting outright
(`scripts/generate-yjs-engine-fixtures.mjs:1737-1741`). Op census over 16 scenarios and 50
fuzz seeds: `text.format` 1, `text.embed` 1, `text.insert` with attributes 0. Note the
manifest's stated reason for the exclusion (per-transaction cleanup) is *not* what the
measurement found; across 1500 ops yjs never emitted a second cleanup transaction.

---

## 5. The format bump costs, traced

- **`CollabRoom.cs:1255` compares format with `!=` against one scalar.** Bumping it makes
  every existing format-1 working-copy blob unopenable: `InvalidDataException` →
  `SeedFailed` → close **4503**, which is not in `TERMINAL_CLOSE_CODES`
  (`provider.ts:130-132`), so the client reconnects forever and never surfaces an error.
- **The journal path has no format gate at all** (`CollabRoom.cs:772-777`) — whatever the
  manifest says is adopted and announced.
- **Both directions brick clients permanently.** `provider.ts:1165` →
  `terminate('unsupported-format')` → `phase = 'terminal'`, no reconnect, latched into
  `this.terminal`, editor non-editable. No read-only degrade. Old client meeting a new
  room, and new client meeting an old room, are the same code path.
- **Lineage is the only PER-OPERATION barrier, but it is not the first one.** `runDrain`
  (`provider.ts:826`) checks `row.lineage !== state.lineage` and never checks format, and
  `CollabOperationCandidate` (`CollabOperation.cs:142`) carries no format field, so the
  server has none either. But `handleControl` (`provider.ts:1165`) terminates on a format
  mismatch at the FIRST frame, before the connection opens for business — a well-behaved
  client facing a converted room never reaches `runDrain`. `CollabRoom.cs:1255` is a third
  gate on the stored-blob load path.
  The residual risk needs a client that already passed the handshake against a room that
  then converts without closing the socket and without minting a new lineage — which the
  reset lever below does not do.
  **The sharper problem is that the corruption mode is semantic, not byte-level.** A
  format-1 operation is not distinguishable from a format-2 one anywhere in this codebase;
  `UpdateInspector.Inspect` returns `Ok | Malformed | TooDeep` and is schema-blind. No cheap
  gate could catch a cleanly-applying update that writes wrong-shaped structure.
- **The reset lever works.** `ResetJournalLocked` (`CollabRoom.cs:1516-1543`) rebuilds the
  baseline from the host's JSON via `converter.Seed` and mints `Epoch + 1` **and a new
  lineage** — which is exactly what the barrier above requires. A format-2-aware `Seed`
  converts with no CRDT migration code. Two lines stand in the way: `CollabRoom.cs:1535`
  passes `current.Format`, and `ResetEndpoint` has no parameter for a target.
  What it spends: the CRDT history — undo, per-character causality, authorship — re-derived
  from the host's last accepted JSON, and every unsent offline edit quarantined and never
  replayed.
- **`yrs-compat.json` cannot be regenerated** (`YrsCompatCorpusTests.cs:11-20`; the yrs
  binding is gone). It pins the exporter against format-1 Blok bytes, permanently.
- **Nothing enforces "servers upgrade before clients"** — format is server→client only and
  the client never sends one. The law is operational discipline backed by an outage. The
  mitigation the protocol's own decision 3 implies (accept a *set* of formats, not a scalar)
  is implemented on neither side.

---

## 6. Blast radius on the client

**Six distinct text-bearing shapes**, not one: rich HTML in `data.text` (paragraph, header,
quote, list item, toggle — one mapper covers all five); plain-text caption/meta divs
(image/video/audio/file/embed captions, audio title+artist, database title — several per
block); native `<input>`/`<textarea>` (image `alt`, database labels — no DOM Range at all,
and `isMeasurable` at `caret-position.ts:38-39` already refuses to publish a caret there);
`plaintext-only` code; block-ID indirection in table cells; and a nested `OutputData`
document inside a database property.

**`inputIndex` is not a safe address.** `Block.inputs` is `Dom.findAllInputs(this.holder)`
(`src/components/block/input-manager.ts:36`) with no filtering of nested child blocks, and `findAllInputs`
returns the deepest block elements (`dom.ts:250-256`), so one logical field can be several
"inputs" and the index shifts when structure changes. The address would have to become
`{blockId, dataKey}`.

**31 consumers assume `data.text` is a string.** The dangerous ones fail *silently*:
`convertBlockDataToString` (`utils/blocks.ts`, unchecked `as string`), `view/emitters.ts`
(no guard at all, 5 sites), `src/view/document-texts.ts:108` (skips the slot, so a document
becomes untranslatable with no error and `injectTexts` then throws a count mismatch),
`blockSelection.ts:688` (falls back to empty on copy).

**Adapters are insulated.** No adapter in `packages/{react,vue,angular}` reads a `text`
field by name; each keeps a plain-JS mirror. They break only if a live Y.Text escapes
`yValueToPlain` into the object handed to `setData`.

**Undo granularity survives.** `Y.UndoManager` merges by time (`captureTimeout` 500 ms,
`undo-history.ts:172-179`), not by op count, so one Ctrl+Z still reverts one burst of
typing. But undo becomes *selective* rather than destructive — today undoing a block edit
restores a whole string and therefore also reverts a peer's concurrent edit; with Y.Text it
would leave the peer's characters standing. A visible behaviour change that nothing pins.

**The 400 ms write buffer becomes harmful.** Its justification is that a whole-string LWW
write is expensive and clobbering; a splice is neither. Keeping it means the splice is
computed against a 400 ms-stale DOM snapshot — precisely the window in which a remote edit
arrives and makes the diff wrong.

---

## 7. Prior art — what the ecosystem has and has not solved

**The closest structural precedent is BlockSuite, and Blok is already ahead of it on the
one thing that matters most.** BlockSuite uses a flat `Y.Map('blocks')`, a per-block Y.Map
with `sys:id`/`sys:flavour`/`sys:children`, and `prop:text` as a real `Y.Text` — nearly
identical to Blok's layout. But BlockSuite must `clone()` a `Y.Text` on any move, because an
attached one cannot be re-parented; that mints a new CRDT identity and loses concurrent
edits. Blok moves blocks by splicing ids between order arrays, and `document-store.ts`
states the invariant directly: "A block's Y.Map is NEVER deleted-and-recreated by a move."
So a `Y.Text` inside a Blok block would never need re-parenting.

**That invariant needs a test before it is relied on.** Re-attaching a live `Y.Text` to
another `Y.Map` does not throw a clean guard — it crashes inside yjs's own integration path
(`YText._integrate`, "Cannot read properties of null") and leaves the document half-written
with both blocks reporting the text.

**BlockNote is not an independent data point** — it is four lines wrapping y-prosemirror's
`ySyncPlugin` over a single `Y.XmlFragment`.

**Split and merge are an unsolved problem in the ecosystem's most-used binding, by its own
admission.** y-prosemirror's `CAVEATS.md`: splitting a paragraph at offset n is implemented
as "delete everything after n, insert a new node containing the deleted content", and
"absolute ProseMirror positions produced on one peer do not necessarily point at the same
semantic content on another peer once concurrent edits have been merged in." The same
document describes a cascade Blok should expect: two peers each deleting one of two
paragraphs inside a container with a `paragraph+` constraint yields a schema-invalid
container whose only valid resolution is deleting the whole thing — "a small remote edit
has cascaded into the implicit deletion of a much larger structure on the other peer."
Blok's container tools carry `childTools` constraints; this is the same shape.

**Two orphan modes that only Map-keyed designs produce**, both measured: a block inserted
into a concurrently-deleted parent's children stays alive and unreachable from root forever
(BlockSuite), and AppFlowy's `get_or_init_text` *resurrects* a text entry for a deleted
block on the next keystroke, growing the document permanently. Neither project has a cleanup
pass, and neither documents the hazard. slate-yjs avoids the class entirely by embedding
structure and text in one sequence CRDT per node.

**Undo of a block deletion mints a NEW `Y.Text` identity.** Kevin Jahns, primary: "when you
undo the deletion of a shared type, the `Y.UndoManager` creates a new object that looks
exactly like the old one. However, it is technically a new object with a new reference." So
every remote caret anchored in that text is dead and any cached handle is stale — carets
must be re-resolved after an undo, never assumed valid. Also primary, on writes into deleted
types: "Once a type is deleted, you are not supposed to insert content. That should be a
no-op… I don't throw errors when an action is performed that doesn't lead to inconsistencies."

**Two caret-measurement techniques that apply to Blok TODAY, with no Y.Text involved:**

- **Never measure a collapsed range.** Quill measures a one-character range instead, citing
  w3c/csswg-drafts#2514. A collapsed cursor at a soft-wrap boundary returns `[0,0,0,0]` from
  `getBoundingClientRect()` in Chrome (crbug 426017) and `getClientRects()` returns two
  rects, one on the wrong line; Safari returns nothing valid. Blok's `measureLine`
  (`caret-position.ts:184-199`) measures a collapsed range and falls back to the input's own
  box when the height is 0 — which catches the empty paragraph but would put a caret at a
  wrap point in the paragraph's top-left corner.
- **Last rect wins at a wrap point.** BlockSuite takes `rangeRects[rangeRects.length - 1]`;
  slate-yjs takes `length - 1` going forward and `0` going backward. Blok takes the bounding
  box, which merges both rects.
- **Nobody in the field re-measures after web-font load** (zero `document.fonts` hits across
  quill-cursors and slate-yjs). Every measured caret is wrong until the font swaps. Blok
  repositions on a `ResizeObserver` and on local caret moves — neither is a font signal.

**BlockSuite transports `{blockId, index, length}` over awareness** rather than a
`RelativePosition` — the same shortcut Blok takes today, and it does not survive concurrent
remote edits.

---

## 8. Blockers that apply to ANY Y.Text path

Recorded in §7 from prior art, and they are not stage-shaped — they are reasons the feature
may not be worth doing at all. Both bite the cheap path in §10 exactly as hard as the
expensive one.

**Split and merge lose concurrent edits, on every Enter.** Blok's split already has the
shape y-prosemirror admits is unsolved: `blockManager/block-insertion.ts:455-471` extracts a
DOM fragment, writes the truncated head, and creates a new block with the tail — two writes,
one transaction. With a `Y.Text`, "creates a new block with the tail" means **minting a
fresh `Y.Text` whose characters are new identities**. Every concurrent remote edit in that
tail is lost, and every remote caret in it is dead. `Block.mergeWith`
(`src/components/block/index.ts:507-513`) is the same in reverse. This is a per-keystroke
class of data loss with no known solution in the ecosystem.

**Undo of a block deletion mints a new `Y.Text` identity.** Primary source, Kevin Jahns:
the `Y.UndoManager` "creates a new object that looks exactly like the old one. However, it is
technically a new object with a new reference." Every caret anchored in it is dead and every
cached handle is stale. Carets must be re-resolved after an undo, never assumed valid.

**A block's `Y.Text` must never be re-`set` into another map.** Blok's move path is already
safe — `document-store.ts:57` states the invariant that a block's Y.Map is never
deleted-and-recreated by a move, which is exactly the trap BlockSuite has to `clone()`
around. But the invariant is unguarded, and violating it does not raise a clean error: it
crashes inside `YText._integrate` and leaves the document half-written with both blocks
reporting the text. **A test pinning this is cheap and belongs in stage 0.**

---

## 9. Ordering

Corrected during review: this is NOT a chain. Only the last step depends on the rest.

**Stage 0 — wrong today, independent of every path.** No format change, no Y.Text, no mark
model. Testable on the two-client browser harness from `a5c4e93a`.

- 0a. Apply a remote update without destroying the local caret (§2). **Note it is throwaway
  work**: a save/restore wrapper around an `innerHTML` replacement is deleted the moment the
  hop becomes a delta application. Worth doing on its own merits, not reused.
- 0b. Measure the caret with a one-character range and take the wrap-correct rect; decide the
  font-load re-measure (§7). A defect in code shipped 2026-09-18.
- 0c. Pin the never-re-`set` invariant (§8).

**Then three INDEPENDENT tracks, not a sequence:**

- **Format machinery.** Widen the scalar gates to sets on both sides so a bump is a rollout
  rather than an outage; give `ResetEndpoint` a target format. **Arguably first of the
  three** — §5 says a bump without it is a permanent outage in both directions, so the
  machinery has to exist before anything wants a bump.
- **Engine parity for formatted text.** Only needed on the formatting-aware path. Decide the
  `_searchMarker` question, close the 40% divergence, add the format write API and
  `toDelta`, extend the fuzzer to format — the exclusion is what hid the divergence.
  Attribute keys are opaque strings to the CRDT, so this does NOT depend on the mark model.
- **The mark model.** Only needed on the formatting-aware path (§10 skips it entirely).
  Canonical mark-list representation, lossless HTML↔marks codec, identity rules mirrored in
  C#.

**Last — `Y.Text` for block text and carets that stick to characters.** The only step that
depends on the others, and the one §8's blockers apply to.

Unassigned to any track, and they need an owner: removing the 400 ms write buffer (§6 says
it becomes harmful), and the 31 string-assuming consumers whose failures are silent (§6).

---

## 10. The cheaper path — an unformatted `Y.Text` over the HTML string

Surfaced by review; an earlier draft dismissed it in one clause without pricing it. It
should be decided BEFORE the mark model is funded, because it changes what the decision is.

Store `data.text` as a `Y.Text` whose characters are the HTML string **verbatim, with no
formatting attributes at all**.

**What it buys** — exactly the win open question 1 puts to the user: two people typing in
different parts of one paragraph merge per character instead of clobbering each other.

**What it skips**

- The mark model, entirely. The identity rules never have to become data, because HTML stays
  the storage format.
- Most of engine parity. No `format`, no `insertEmbed`, no `toDelta`, and the 40%
  divergence is irrelevant — it is `toDelta`-only, i.e. formatting-only, and the same
  measurement found text content never disagreed across 1500 ops. `YText.cs`'s declared
  scope — "insert, delete and the string" — is exactly what this needs.
- The §3 law. `toString()` of an unformatted `Y.Text` returns the complete HTML string, so
  both fallbacks become LOSSLESS. An old server and an old client both read the document
  correctly with no changes.

**What it costs, honestly**

- **It reintroduces the offset mapper §1 celebrates not needing.** The CRDT index counts tag
  characters; the caret wire counts text characters. But this is one DOM walk in one place
  (the caret path), not a mapper per tool.
- **Concurrent formatting of overlapping ranges can interleave tag characters into malformed
  HTML.** An earlier draft treated this as disqualifying; that overreaches twice. It needs
  two peers formatting OVERLAPPING ranges at the same instant, not the disjoint-typing case
  that is the actual win. And it is RECOVERABLE — parse, `inline-normalization`, sanitize on
  read, all machinery Blok already owns — whereas what it replaces, whole-string LWW,
  silently loses one peer's edit entirely and is not recoverable. It is a trade, not a
  strict regression.
- **Write-compat, not read-compat, is the hazard.** An old client doing
  `ydata.set('text', string)` replaces the live `Y.Text` wholesale. That argues for some of
  the format machinery — but not for the mark model or engine parity.
- §8's blockers bite identically. They are not a reason to prefer the expensive path.

---

## 11. Open questions for the user

0. **Cheap path or full path?** (§10.) The unformatted-`Y.Text` route buys the merging win
   while skipping the mark model, most of engine parity, and the §3 law. It costs one offset
   mapper and a recoverable formatting-collision mode. This decides what question 1 is even
   asking, so it comes first.
1. **Is the feature worth it at all?** The visible win is two people typing in one paragraph
   without losing each other's letters, plus remote cursors that do not drift. Notion does
   not do this either. §8's blockers — split/merge losing the tail's concurrent edits on
   every Enter, and undo minting a new identity — apply to every path and have no known
   ecosystem solution. Stage 0 alone removes the most user-visible symptom (your caret
   jumping when a colleague edits the same block).
2. **Which `_searchMarker` behaviour is canonical?** Real yjs produces both depending on
   call ordering. This is a decision, not a bug to look up.
3. **Scalar or set for the format gate?** This is the single choice that decides whether a
   bump is an outage or a rollout.

---

## Sources

**Locally checkable** (every file:line in §1-§6 and §8-§10 was verified against this
checkout during an adversarial review pass). **External and NOT reproducible from this
checkout**, presented here in the same register but worth marking: the y-prosemirror
`CAVEATS.md` quotes (the package is not installed), the BlockSuite / BlockNote / AppFlowy /
slate-yjs claims, the Kevin Jahns quotes, "Notion does not do this either", the
300-document engine differential and its 40% / 119 / 289 figures, and the "31 consumers"
count. None is contradicted by anything found locally.

Five parallel read-only investigations, 2026-09-18: inline representation and offset
mapping; format-bump machinery and the compatibility matrix; C# engine Y.Text readiness
(with a 300-document differential against real yjs); the client write/read path; and prior
art in the yjs ecosystem. Plus one reproduction pass on the stage-0 defect.
