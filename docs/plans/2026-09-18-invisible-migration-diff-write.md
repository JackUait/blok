# The invisible migration — fix the data loss without touching the tool contract

Research run 2026-09-18. Follows `2026-09-18-correct-variant-what-it-takes.md`, which
concluded that the correct variant needs a rewrite of the editing core. **That conclusion
stands for the full mark model — and is unnecessary for the thing that actually loses user
text.** Everything here is measured on yjs 13.6.32.

---

## 0. The question and the answer

*Can we convert internally, so consumers do not notice the move?*

**Yes, for the main win.** `save(block: HTMLElement)` stays exactly as it is. Tools keep
owning their DOM. No IME work, no incremental renderer, no mark model, no ownership
inversion. Only the **write path** changes: store `data.text` as an unformatted `Y.Text`
carrying the HTML string verbatim, and apply each whole-string `save()` result as a
**minimal diff** instead of replacing the value.

Three things make this work, and all three were things I expected to break.

---

## 1. What was measured to work

### The merge itself

| scenario | converged result |
|---|---|
| two peers typing in one paragraph | `"Hello BBB world AAA"` — **both survive** |
| a coalesced multi-keystroke burst on each side | both survive |
| one peer formats while the other types | both survive |
| two peers bold **disjoint** ranges | correct |
| two peers bold **overlapping** ranges, naive prefix/suffix diff | `The <b>quick brown</b><b>brown fox</b>` — **a word duplicated, text lost** |
| two peers bold **overlapping** ranges, **minimal diff** | `The <b>quick <b>brown</b> fox</b>` — **all text preserved**, redundant nesting only |
| one peer selects all and retypes | `"BBB Something else entirely"` — garbled, nothing lost outright |

**The choice of diff is load-bearing.** The naive single-region prefix/suffix diff deletes
and re-inserts the whole changed middle, so two peers' middles collide. A minimal diff
inserts only the missing characters — the two tag pairs — and they merge. The redundant
nesting is what `inline-normalization` already cleans up.

### Read compatibility is lossless — both sides

- **Client:** `serializer.ts:466-474` — a `Y.Text` falls through to
  `value instanceof Y.AbstractType → value.toJSON()`. Measured byte-for-byte, including
  entities, quotes and non-ASCII. `isWellFormedBlock` stays `true` (the gate at
  `serializer.ts:205-211` only requires `data` to be a `Y.Map`). Survives the binary seam.
- **Server:** `YDocConverter.cs:1714` `case YText text: JsonValue.Create(text.ToString())`.
  Nothing matches earlier; the `default: throw` at `:1770` is never reached. The existing
  .NET test `ExportReadsAForeignSharedTypeAsItsStringForm` passes.

So an old client and an old server both read the new value correctly, unchanged.

### Three suspicions, all refuted by measurement

- **The block observer.** I named this my main suspicion. It is **written for this exact
  case** — `block-observer.ts:383-387`: *"Any shared type is a legal STARTING node — a
  foreign client can nest a Y.Text under block data, and its delta events target the Y.Text
  itself; rejecting it here silently diverges the doc from the DOM."* `walkToOwningBlock`
  accepts any `Y.AbstractType` and walks `.parent`; the chain data-map → block-map →
  blocksMap resolves. Measured with the real observer: `{type:'update', blockId:'b1',
  origin:'local'}`, and `origin:'undo'`/`'redo'` for history.
- **The caret guard.** `yjs-sync.ts:801` compares `yBlockToOutputData` output — already
  plain — so it is string-vs-string as today. Unaffected.
- **Undo.** `undoScope` (`document-store.ts:129`) is `[blocksMap, rootOrder]` and yjs tracks
  nested types by parent chain. Measured with the real options (`captureTimeout: 500`,
  `trackedOrigins: {'local'}`): three rapid one-char transactions give `undoStack.length ===
  1` for **both** shapes, and one undo restores the same amount of text. No change to undo.

### Diff cost is free where it matters

`diff-match-patch` 1.0.5 (Myers), realistic paragraph HTML:

| n | one-char insert | wrap 10 chars in `<b>` | whole string replaced |
|---|---|---|---|
| 1,000 | 0.044 ms | 0.023 ms | 83 ms |
| 10,000 | 0.007 ms | 0.003 ms | 1,170 ms |
| 100,000 | **0.006 ms** | 0.006 ms | **99,251 ms** |

Myers trims the common prefix and suffix first, so a keystroke in a 100k block is *cheaper*
than in a 1k one. Heap delta never exceeded 16 MB.

**The textbook O(n·m) LCS matrix is unusable** — 411 ms at 10k, and ~40 GB at 100k. Use
Myers, never the DP table.

---

## 2. What blocks it — four things, ranked

### Blocker 1 — the no-op guard destroys the `Y.Text`, silently

`equals` (`src/components/utils/object.ts:84-91`) returns `false` the moment one side is an
object and the other is not. Measured, independently, twice:

```
equals(Y.Text('SAME'), 'SAME')  ->  false      (toString() === 'SAME')
equals('SAME', 'SAME')          ->  true
```

So `document-store.ts:942` never short-circuits and `:947` runs
`ydata.set(dataKey, plainToYValue(value))`, storing the raw string. Measured end to end: with
`data.text` already a `Y.Text('abc')`, `updateBlockData('p1','text','abc')` — an **unchanged**
save — returned `true` and left a plain string behind.

`flushBlockDataWrites` (`blockManager.ts:2083-2089`) writes **every key of the whole save**,
not just changed ones. So the CRDT would work for one keystroke and then evaporate. Nothing
throws, nothing logs.

This is the first line of the change, not an optimisation.

### Blocker 2 — the lazy upgrade is itself a race

`fromJSON` → `outputDataToYBlock` → `objectToYMap` → `plainToYValue` (`serializer.ts:375`)
stores a plain string, and so do `replaceBlockContent` (`document-store.ts:529`, turn-into)
and `addBlock`. So the upgrade to `Y.Text` happens lazily, on first edit, **independently on
each peer**. Two peers both minting a `Y.Text` for the same block is a whole-key map-set
race — one side's characters vanish, exactly when two people start typing together.

This is verbatim the bug class the eager-`contentIds` comment already documents at
`serializer.ts:169-181`.

Minting it in the load path instead gives a single creator, but changes `fromJSON`, which
changes the byte-for-byte collab fixtures (`scripts/generate-collab-fixtures.mjs:505-512`,
pinned by `collab-fixtures.freshness.test.ts`) — and the C# `PlainToYValue` would still write
a string.

### Blocker 3 — the server writes plain strings too

`YDocConverter.cs` has a `YText` branch for **reading** (`:1714`) and none for writing:
`EditStep.ReplaceData` (`:826`) and `PlainToYValue` (`:1023`) write plain values. Any
server-side document-API edit downgrades the key. **A client-only rollout is incoherent** —
client and server change together.

### Blocker 4 — mixed rooms give zero benefit, and the fallback re-arms the race

Measured: a `Y.Text` versus a concurrent plain-string write converges by ordinary clientID
LWW. Nothing corrupts, a third fresh peer agrees, the doc stays decodable — so a mixed room
behaves **exactly as today**, no regression and no improvement. But because of Blocker 1 the
clobber is continuous, not occasional: *every* flush from a string-writing peer replaces it.

And the oversized-string fallback (below) writes a plain string by design, re-entering
Blocker 2 on the next edit.

---

## 3. The honest limits

- **This buys nothing on the render path.** `yjs-sync.ts:822-829` still calls
  `block.setData(data)` with the whole string and rewrites `innerHTML`, and
  `captureCaretAcrossRewrite` is still a best-effort prefix/suffix guess
  (`remote-edit-caret.ts:85-95` says so itself). **Characters merge; the caret experience
  does not improve.**
- **No length cap exists on `data.text` anywhere.** The only cap in the paste module is
  `PATTERN_PROCESSING_MAX_LENGTH = 450` (`paste/index.ts:34`), unrelated. A paste-replace or
  turn-into on a 100k string is 99 seconds of frozen main thread. The fallback must be
  explicit — a length threshold plus a wall-clock budget, falling back to the whole-value
  `set`, which is today's behaviour for that one write.
- **No runtime dependencies exist.** `package.json` has neither a `dependencies` nor a
  `peerDependencies` key. `lib0/diff` offers only `simpleDiffString` — the prefix/suffix
  variant, i.e. the corrupting one. So this is hand-rolled Myers (~60 lines) or
  `diff-match-patch` bundled into `dist`: a bundle-weight decision, not a dependency-graph
  one.
- **`describeTextEdit` is not the primitive** (`remote-edit-caret.ts:71`). It is the naive
  single-region diff, and its two consumers (`remote-edit-caret.ts:101`,
  `presence-carets.ts:409`) want a *caret mapping over a DOM-read string*, not a CRDT write.
  Upgrading it would change caret parking for no benefit. Write the minimal diff separately.
- **The key name is not unique.** `table-cell-clipboard.ts:242` and `table-cell-paste.ts:104`
  read `data.text` off *cell* blocks. The gate must be a `(toolType, key)` set or a
  serializer predicate, never a bare `key === 'text'`.

---

## 4. Coverage

`data.text` is the save key of paragraph (`src/tools/paragraph/index.ts:399`), header
(`header/index.ts:705`), quote (`quote/index.ts:133`), toggle (`toggle/index.ts:154`) and
list (`list/index.ts:675`) — all HTML strings.

`code.code` (`code/index.ts:358-360`) is `textContent`, declared `PLAINTEXT`
(`:914-922`). The same treatment applies and is **strictly safer** there — no tag structure
to interleave, so the overlapping-format corruption class cannot arise at all. It is also the
key most likely to be large, so it needs the length cap most.

Not covered: table cell content, `list.items`, captions, and anything else a tool stores as a
long string.

---

## 5. The order of work

1. **Fix `equals` against a shared type**, or add the `Y.Text` branch ahead of the generic
   guard at `document-store.ts:942` — alongside the existing grid / `Y.Map` / `Y.Array`
   special cases, which exist for precisely this false-negative reason (see the comments at
   `:899` and `:917`). Nothing works before this.
2. **Decide who mints the `Y.Text`.** Lazily in `updateBlockData` keeps the fixtures green
   and keeps Blocker 2; in the load path removes the race and moves the fixtures.
3. **The minimal diff**, as its own function, with an explicit length and time cap and a
   documented whole-value fallback.
4. **The server write path**, in lockstep.
5. **The format gate as a set** — this is what turns "mixed rooms get nothing" into a
   rollout. It is the only version lever the protocol has.

Steps 1-3 are contained. Step 4 is two languages, one schema. Step 5 is the long pole and was
already the long pole before this design existed.

---

## 6. What this does and does not settle

It settles the loss that is happening now: two people typing in one paragraph stop destroying
each other's text, and it costs no consumer any change.

It does not deliver the mark model, character-level carets, comments, or a correct split — all
of which still need what the previous document describes. And it does not improve the caret
at all.

The open question is unchanged and still unanswered: **how often two people actually type in
the same paragraph in real documents.** This design lowers the price of finding out to
something a small team could ship.
