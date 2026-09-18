# Correction record — what I got wrong, and what survives

Written 2026-09-18 after an adversarial audit of my own claims across
`2026-09-18-path-3-rich-text-as-data.md`,
`2026-09-18-correct-variant-what-it-takes.md` and
`2026-09-18-invisible-migration-diff-write.md`.

Four investigations were told to **refute**, not confirm. They did. Several load-bearing
claims in those documents are wrong, and one of my own recommendations is inverted.
Everything below is measured or read at the cited `file:line`.

---

## 1. WRONG — "a mark model requires inverting the ownership of the text region"

**Core already owns it.** `src/components/block/data-persistence-manager.ts:144-152`: for
**any** tool whose rendered root is `contenteditable="true"` and whose data carries a `text`
key, core runs `pluginsContent.innerHTML = newText`. No tool cooperation, no registration —
discovery is a CSS selector (`dom.ts:229-234`).

And paragraph and quote have **no `setData` at all** — `grep -rln "public setData"
src/tools/*/index.ts` returns only code, header, list, toggle, table. So every remote edit to
a paragraph is *already* applied by core writing the tool's DOM.

Core also already performs surgery inside the tool's editable: `mark-engine.ts:300,325,455-482,527`
(`extractContents` / `replaceChild` / `appendChild` for every bold toggle) and
`caret.ts:1286-1287` (`deleteContents` + `insertNode`).

**The narrower true statement:** a mark model needs core to patch the text DOM
*incrementally* rather than `innerHTML =`. That is one function plus five tool `setData`
bodies — a patcher, not a change of owner.

## 2. WRONG — "it breaks `save(block: HTMLElement)` for every consumer's custom tool"

Counted: of 19 built-in tools, exactly **two** read the element — paragraph
(`index.ts:399`) and quote (`index.ts:133`). The rest declare no parameter or prefix it `_`.

All three first-party framework adapters — the documented path for consumer tools — declare
`save(): BlockToolData` with **no parameter** and return a data mirror:
`packages/react/src/createReactBlock.tsx:411,845`, `packages/vue/src/createVueBlock.ts:327,559`,
`packages/angular/src/createAngularBlock.ts:213,364`. Their doc comments say
*"returns the complete frozen mirror (never the DOM, never partial)"*.

TypeScript bivariance means a zero-arg `save()` already satisfies `save(block: HTMLElement)`.

## 3. WRONG — "no `input` listener is ever attached to a contenteditable"

`src/components/modules/blockManager/event-binder.ts:119` attaches `'input'` to **every block
holder** and dispatches `blockEvents.input(event)`. `emojiTrigger.ts:248` already branches on
`event.inputType`.

I took a fact that is true of `input-manager.ts:175-183` (native inputs only) and stated it as
a fact about the codebase.

## 4. OVERSTATED — "a `beforeinput` interpreter built from zero; none of it exists"

A document-level capture-phase `beforeinput` dispatcher **with `preventDefault`** already
exists: `src/components/inline-tools/services/inline-tool-event-manager.ts:183-205`, hook
declared at `:37`. Zero handlers are registered — it is plumbing without users, not absence.
`uiControllers/controllers/keyboard.ts:186` registers another redactor-wide capture-phase
`beforeinput`.

Also wrong in the same passage: "the 4,532 lines under `blockEvents/composers/` cannot be
reused because all of it assumes the mutation already happened". Measured 4,453 lines, and
`keyboardNavigation.ts` contains 13 `preventDefault` calls — that code is already intent
interception *before* the mutation.

## 5. WRONG — the "~38,400 LOC in scope" figure

It is the sum of eight whole directories, verified by `wc -l`:

```
5338 + 1980 + 977 + 4798 + 6214 + 2985 + 8417 + 5043 = 38400   (exact)
```

Every file in each directory, whether or not it would change. The table refutes itself — it
charges `paste/` 6,214 lines while the same row says *"~30-35 call sites"*. The
"~15,000 genuine rewrite" figure has no derivation anywhere.

The files where the diff-write change actually lives total **2,707 lines**
(`document-store.ts` 1861, `serializer.ts` 504, `data-persistence-manager.ts` 342), and only
parts of them.

## 6. INVERTED — "use a minimal (Myers) diff"

This was my own recommendation and it is wrong for the hot path. Measured myself, lib0's
`simpleDiffString` versus an O(ND) Myers:

| n | edit | naive | Myers |
|---|---|---|---|
| 1,000 | small insert | 0.09 ms | 0.07 ms |
| 1,000 | **whole-string rewrite** | **0.004 ms** | **64 ms** |
| 5,000 | small insert | 0.26 ms | 0.10 ms |
| 5,000 | **whole-string rewrite** | **0.014 ms** | **2,671 ms** |
| 5,000 | 1-in-10 changes | 0.008 ms | 33.5 ms |

Myers is O(ND) and blows up exactly where D is large — **and a whole-string rewrite is what a
paste, a sanitizer pass or a turn-into produces**, then the 400 ms coalescer merges more
change into one diff input. Naive is fastest precisely where Myers is worst, because zero
common affix means it returns immediately.

What Myers buys is one case: two peers formatting **overlapping** ranges of the same
paragraph inside one 400 ms window. Naive garbles that (`The <b>quick brown</b><b>brown
fox</b>` — a word duplicated); Myers keeps the text. Everything ordinary — typing at two
ends, disjoint format ranges, both typing inside one word — is **byte-identical** between the
two.

**And the option I never mentioned exists and is already paid for:** `lib0/diff` exports
`simpleDiffStringWithCursor` (`node_modules/lib0/diff.js:106`), a caret-biased diff that
resolves exactly the ambiguity naive gets wrong. lib0 already ships inside the bundle.

## 7. WRONG — "a whole-string replace costs 99 seconds at 100k, so a length cap is not optional"

Could not be reproduced in any shape. A **single** whole-string replace is flat and free at
every size: ~0.002 ms at 100k. `Y.Map.set` is O(1) and yjs GC drops the tombstoned content.
The only thing in the measurement space near that number is **61 s for the minimal-diff
approach** over a 100,000-keystroke run — i.e. the cost belongs to the fix, not to the thing
it replaces.

**And a 100,000-character `data.text` is a fantasy in this product.** Measured: median `text:`
literal in the whole test suite is **6 characters**, p95 is 24, the largest literal anywhere
in `test/` is 400, the largest e2e paragraph is 2,400, and the largest paragraph in the
shipped demo document is 267. There is no perf or large-document spec in the repo at all.

The argument that *does* survive is **wire bytes, not CPU**: 48.9 KB per coalesced write at
100k, versus a diff's few bytes.

## 8. INFLATED — "in a mixed room the benefit is zero, because an old writer clobbers continuously"

Both halves are wrong, in opposite directions.

**Mixed rooms are MORE real than I implied.** There is no Blok-version signalling on the wire
at all — `VERSION` exists (`vite.config.mjs:101`) but is never sent. The README's CDN snippet
floats unpinned (`README.md:124-125`), and jsDelivr serves `max-age=604800`, so a returning
visitor keeps a week-old bundle beside a fresh one with no deploy at all. The provider is
explicitly engineered for it: `provider.ts:219` names "a rolling deploy closing with 1001",
answered by `SHORT_RECONNECT_MS = 250` (`:83`). The repo already assumes version skew — the
activity frames shipped with "an old server ignores frame 106 … no protocol version bump".

**But "zero" and "continuously" are too strong.** An old writer clobbers only a block it is
*concurrently* editing. One old tab on block 3 does not degrade co-editing on block 40.
Degradation is per-block-and-concurrent.

## 9. TRUE AND UNDERSTATED — "the server writes plain strings, so client-only is incoherent"

Right, and I undersold it. The same plain-string writer
(`YDocConverter.PlainToYValue:1023-1041`, string case `:1110-1112`) is used by
`YDocConverter.Seed` (`:94`), which `CollabRoom.cs:1491, :1530, :1589` calls on **every room
open and every reset** — not only on the maybe-unused `/edit` HTTP route. Real-time typing
never touches the converter (`CollabRoom.ApplyRemoteLocked:1646` applies opaque updates).

## 10. WRONG in the other direction — "it works for one keystroke then evaporates"

Measured with a real `BlockManager` and a real `DocumentStore`: a `Y.Text` in `data.text` is
destroyed by the **first flush that touches the key, including one that changes nothing**.
Not after one keystroke — before any.

Counts from that instrumentation, 3-key save: one keystroke → 3 calls to `updateBlockData`,
2 carrying an unchanged value; a ten-keystroke burst → 30 calls, 20 unchanged; a no-op save →
3 of 3 unchanged. There is **no upstream dirty-key filter anywhere** — the only "did it
change?" gate in the whole path is the `equals` guard inside `updateBlockData`.

## 11. OVERSTATED — "the `equals` false negative is the blocker"

The equality half is genuinely a one-liner: compare `yValueToPlain(currentValue)`, which
`assignYMapEntry` already does at `document-store.ts:1050-1057`, and whose
`Y.AbstractType → toJSON()` fallback (`serializer.ts:471-475`) covers `Y.Text` unchanged.

But that only buys "the `Y.Text` survives while nobody edits it". The fall-through at
`:946-953` still does `ydata.set(dataKey, plainToYValue(value))`, so the first flush that
*does* change the text replaces it anyway. The real work is the missing **in-place text-delta
assign** — the `Y.Text` counterpart of `deepAssignYMap` / `deepAssignYArray` /
`deepAssignYGrid` (`document-store.ts:1005, :1080, :1164`). Two of those three reuse helpers
that already existed; there is nothing to reuse here. **No `Y.Text` is ever constructed
anywhere in `src/`** — the only three mentions are comments.

---

## What survives, and is worse than I said

**The premise.** Verified end to end in a real browser, two pages, two real editors — not the
storage API I originally measured. Both clients converge, silently, on text missing
characters the user typed and watched appear on their own screen:

| run | final text on BOTH clients |
|---|---|
| alpha types 10 `A`, beta types 10 `B`, 80 ms apart | `seed BBBBBBBBBBAAAA` — 6 of alpha's gone |
| same again | `seed AAAAAAAAAA` — **all 10 of beta's gone** |
| 20 chars each, 50 ms apart | `seed AAAAAAAAAAAAAAAAAAAA` — **all 20 of beta's gone** |

It is not "one person's text" — it is the whole burst, up to and including everything.

**The window, and the number I should have given first.** A gap sweep between the two
typists:

| gap | lost |
|---|---|
| 0 ms | 2 chars |
| 200 ms | 1 char |
| **400 ms** | **none** |
| 600 / 1000 ms | none |

The boundary matches `modificationsObserverBatchTimeout = 400` (`src/components/constants.ts:21`),
wired at `yjs/index.ts:52`, and `write-buffer.ts:15` says the window **never extends** on
further enqueues. So the collision window is 400 ms + transport RTT, and outside it there is
no loss at all.

**Everything I measured myself still stands:** the split law across four shapes; yjs's
`ContentFormat` dropping a peer's mark on same-key overlap; Peritext marks working on yjs via
relative positions; the pool shape; `equals(Y.Text, string) === false`; read-compat being
byte-exact through the binary seam.

---

## The revised picture

The problem is real, reproducible in a browser, and worse than I described. **The fix is much
smaller than I described.** No ownership inversion, no IME work, no `beforeinput` interpreter
from zero, no 38,000 lines. The honest shape:

1. Compare via `yValueToPlain` in `updateBlockData` — one line, existing helper.
2. Write the missing in-place text-delta assign. **Use lib0's `simpleDiffString` or
   `simpleDiffStringWithCursor`** — already in the bundle, 231 B gzip — not Myers, which is
   catastrophic on exactly the input the coalescer manufactures.
3. Decide who mints the `Y.Text`; the lazy path is a whole-key race between two peers.
4. Change the server's seed path in lockstep — it runs on every room open.
5. The format gate as a set, if the guarantee is wanted; it is a hard stop today, not a
   rollout.

No cap is needed for CPU. If a guard is wanted, it is for wire bytes.

## One more thing worth knowing

**No committed test has two peers edit the same block's `text` concurrently.** Every text
case in `test/playwright/tests/modules/collaboration.spec.ts` is sequential. The closest
thing, `yjs-grid-convergence.integration.test.ts:95`, is about table cells and **asserts that
losing one side's edit is acceptable**. The scenario this whole line of work is about has
never been exercised in either direction.
