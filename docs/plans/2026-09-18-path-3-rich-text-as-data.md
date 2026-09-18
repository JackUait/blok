# Path 3 — inline formatting as data. What it costs, and what it does not buy.

Research run 2026-09-18. Six parallel investigations plus my own measurements, each
adversarially checked. Everything below is either read in this checkout at the cited
`file:line`, or measured this session on **yjs 13.6.32** / **@automerge/automerge 3.5.0**.
Claims I could not verify are labelled.

Supersedes the framing in `2026-09-18-character-carets-research.md`, and **corrects two of
its claims** (§9).

---

## 0. The one-paragraph answer

The reason to do this is not carets. It is that Blok **silently destroys text** when two
people type in one paragraph — measured, today, in this checkout. Path 3 fixes that. But
path 3 is not one thing: built on yjs's native `Y.Text` formatting it inherits **two
measured defects that yjs will not fix**, and built correctly (Peritext-style) it collides
head-on with Blok's *Everything Is a Block* law. The choice between those two is the
decision this document exists to put in front of you.

---

## 1. The defect, measured

`src/components/modules/yjs/document-store.ts:856` — `updateBlockData` routes a **string**
value to the fallback branch at `:938-950`, `ydata.set(dataKey, plainToYValue(value))`.
`plainToYValue` (`serializer.ts:375-393`) returns the string as a plain leaf. Whole-value
last-writer-wins.

Two `DocumentStore`s, concurrent edits, synced through the binary seam:

| scenario | converged result |
|---|---|
| A types `"Hello world AAA"`, B types `"Hello BBB world"` | `["Hello world AAA"]` — **B's text is gone** |
| A presses Enter after `Hello`; B appends `ZZZ` | `["Hello worldZZZ", " world"]` — **`world` duplicated, split half-applied** |

The second was measured in **both** client-id orderings with the same outcome. The tail
`addBlock` is an independent operation with nothing to conflict against, so it always
survives; only the head truncation is subject to LWW. Either B's typing is discarded or the
head is never truncated and the text duplicates.

---

## 2. The user's instinct was right: this is not the only place

Full survey in §10. The short version — the rule that decides everything is in
`serializer.ts:291` (`isConvertibleArray`) and `:307` (`isGridArray`):

> **Objects and arrays-of-objects merge. Strings, numbers, booleans and arrays-of-primitives
> are opaque leaves at every depth.**

So the same clobber sits under:

- `code.code` — a whole program in one string.
- `cell.blocks: string[]` — an array of primitives, therefore a leaf.
- `colWidths: number[]`, multiSelect `string[]`, `visibleProperties: string[]`.
- Any nested free-text property under `database-row.properties`.
- Captions, alt text, audio title/artist.

**And one structural asymmetry worth fixing on its own merits:** the grid rule keys **rows**
but not **columns** (`serializer.ts:307` decides grid-ness on the outer array only). A
column reorder concurrent with a cell edit discards the cell edit — measured. Rows already
have the fix; columns never got it.

**The good news, measured:** a table with two people in **different cells** is safe today.
A cell holds block IDs (`types/tools/table.d.ts:10-12`), so those are two different blocks'
`data.text`. Same-row/different-cell merges too, through the keyed grid. That machinery
works.

---

## 3. Path 3 is two different projects

The earlier research treated "marks as data" as one thing. The prior-art survey shows it is
two, with different costs and different correctness.

### 3a. Marks as `Y.Text` formatting attributes (yjs native)

`ContentFormat` (yjs `src/structs/ContentFormat.js`) is **a single positional marker**
inserted into the same linked list as the characters — `key → value`, `getLength() === 1`,
`isCountable() === false`. Not a range. The attribute set at a position is "the most recent
`ContentFormat` to the left, per key".

**This is cheap, and it is wrong in a way yjs does not document and has not fixed.**

Measured by me, twice, independently of the agent that first found it:

```
base "The fox jumped."
A: format(0, 7, {bold:true})      // "The fox"
B: format(4, 11, {bold:true})     // "fox jumped"
converged (both peers identical):
  [{"insert":"The ","attributes":{"bold":true}},
   {"insert":"fox", "attributes":{"bold":true}},
   {"insert":" jumped."}]          <-- NOT BOLD
```

`" jumped."` was inside B's range and **nowhere near** A's. B's formatting is discarded on a
region the two never contested. Same with values:

```
A: format(0, 7, {color:'red'})    B: format(4, 11, {color:'blue'})
-> "The "=red, "fox"=blue, " jumped."=NO COLOUR
```

Different keys do not interfere (bold ∩ italic composes correctly — measured), and typing
inside a formatted range inherits correctly (measured). The defect is specific to
**concurrent same-key overlapping ranges**.

This is the anomaly the Peritext paper named in 2022, citing yjs by name:

> "This is the approach used by the CRDT library Yjs. Yjs has the most full-featured
> rich-text CRDT available today … **However, it suffers from the anomaly shown in this
> section.**"

Four years later it reproduces on 13.6.32. `docs.yjs.dev/api/shared-types/y.text` contains
the word "concurrent" **zero times**; the Delta Format subsection is a `[todo]`. There is no
documented semantics to appeal to.

A second, structural limit of this shape: a flat `key → value` map per run **cannot hold two
instances of one mark type**. y-prosemirror works around it with an 8-char content-hash key
suffix and then concedes in `CAVEATS.md` that "the relative order of overlapping marks of
the same type … is not guaranteed to be identical across peers." **If Blok will ever have
comments or multiple overlapping highlights, this shape is a dead end — decide that now,
not later.**

### 3b. Marks as range operations anchored to character IDs (Peritext / Automerge)

Marks live **outside** the character sequence, anchored to character opIds, resolved into
spans at read time:

```js
{ action: "addMark", opId: "19@A",
  start: { type: "before", opId: "9@B" },
  end:   { type: "before", opId: "10@B" },
  markType: "bold" }
```

Each mark declares `expand: "both" | "before" | "after" | "none"` — bold expands at its
boundaries, a hyperlink does not. Overlapping same-type marks union; genuinely conflicting
values resolve by opId LWW; multiple instances of one type coexist (that is how comments
work).

Measured on Automerge 3.5.0, the same Peritext Example 3 that yjs fails:

```
[{"type":"text","value":"The fox jumped.","marks":{"bold":true}}]
```

Correct.

**This is the model that is right. It is not available in yjs.**

---

## 4. The split, measured — and the law underneath it

I measured four shapes on the identical scenario: A presses Enter after `Hello`, B
concurrently types inside what becomes the tail.

| shape | peer edits the TAIL | peer edits the HEAD |
|---|---|---|
| today (whole-string LWW) | duplicates the text | duplicates the text |
| per-block `Y.Text`, original keeps the HEAD *(the obvious port)* | `["HelloZZZ", " world"]` — **relocated** | — |
| per-block `Y.Text`, original keeps the TAIL | `["Hello", " worZZZld"]` — **correct** | `["Hello", "ZZZ world"]` — relocated |
| `Y.XmlFragment` *(what y-prosemirror does)* | `["<paragraph>HelloZZZ</paragraph>", "<paragraph> world</paragraph>"]` — **relocated** | — |
| **one document-level `Y.Text`, split = insert a separator** | `["Hello", " worZZZld"]` — **correct** | `["HelZZZlo", " world"]` — **correct** |

The flat shape also survives **both peers pressing Enter at different offsets**:
`["one", " two", " three"]`.

Automerge, measured by the prior-art investigation on the same scenario, matches the flat
shape exactly — because `splitBlock` inserts **one block marker** into a single flat
sequence; the tail characters are never deleted and never copied.

### The law

> **A split preserves concurrent tail edits if and only if the tail characters keep their
> identity through the split.**

Any model where **a block owns its own text container** forces split = delete + re-insert,
which destroys identity. That is not a yjs limitation and not a ProseMirror bug — it is a
property of the shape. y-prosemirror's `CAVEATS.md` says so, names Automerge's flat model as
the way out, and explains why they declined it ("hostile to direct manipulation"), with the
tree-shaped wrapper listed as **planned, not shipped**.

**This lands squarely on Blok's `Everything Is a Block` law.** Per-block text containers are
exactly what that law prescribes. The only known fix for the split problem is to give them
up. That tension is real and it is architectural, not incidental.

Two corrections to the earlier research, both from measurement:

- "the tail's edits are **lost**" is wrong. They are **relocated** — they survive, glued to
  the end of the head, in the wrong block. Worse than lost in one way (silently wrong text
  rather than absent), better in another (recoverable by eye).
- "a block's `Y.Text` must never be re-`set` into another map — yjs **crashes** inside
  `YText._integrate`" is wrong for 13.6.32. It does **not** throw. It aliases — both maps
  read the same text — and **the document becomes undecodable for every other peer**:
  `TypeError: Cannot read properties of undefined (reading 'id')` on
  `Y.applyUpdate` in a fresh doc. Silent local success, everyone else's session dies. This
  closes the obvious workaround of transferring the tail's container into the new block.

---

## 5. What the mark model must capture — and what it cannot

Full inventory from reading all 977 lines of `src/components/marks/mark-engine.ts`,
`types/api/marks.d.ts`, and every shipped inline tool.

A `MarkSpec` has exactly five fields (`types/api/marks.d.ts:26-58`): `tag`, `aliasTags?`,
`className?`, `attributes?`, `style?`. Only the values inside `attributes`/`style` may be
functions (`MarkValue<State> = string | ((state) => string)`), resolved to a string at write
time by `resolveMarkValue` (`mark-engine.ts:63-65`).

### A flat `{from, to, type, attrs}` list is strictly BETTER for

- All six shipped marks (bold, italic, underline, strike, sup, sub) and the marker's two
  colour specs. That is the complete set in `src/`.
- **Nesting order, which is non-canonical today.** Measured under jsdom on the real engine:
  `bold(0-4)` then `italic(2-6)` gives `<strong>ab</strong><i><strong>cd</strong>ef</i>`;
  the reverse order gives `<strong>ab<i>cd</i></strong><i>ef</i>`. *Identical logical
  formatting, different DOM.* A flat list canonicalises this for free.
- **Boundary splitting** (`splitFamilyAtBoundaries`, `:344-371`) and the empty-shell sweeping
  around it exist only because ranges live in a tree. A flat list deletes them.
- **`aliasTags` normalisation, which does not exist today** (see §9). Becomes an import-time
  rule, and deletes bold's `MutationObserver` on `document.body`
  (`inline-tool-bold.ts:281-330`).
- Coverage semantics, the sanitizer derivation, and the `transparent`-as-unset rule — all
  become trivial.

### NOT expressible — this is the real bill

1. **`MarkSnapshot.element: HTMLElement`** (`types/api/marks.d.ts:67`), `find → HTMLElement |
   null` (`:106`), `apply`/`remove → HTMLElement[]` (`:126`, `:136`). Shipped tools reach
   into the returned DOM — `MarkerInlineTool.applyColor` walks
   `mark.parentElement.querySelectorAll('mark')` (`inline-tool-marker.ts:306-314`). A data
   model has no element to return. **Hard BREAKING change**, re-exported verbatim by the
   React adapter (`packages/react/src/createReactInlineTool.tsx:43-54`).
2. **The ZWSP pending-format protocol.** `toggleMarkAtCaret` (`mark-engine.ts:881-912`)
   inserts a real `​` text node wrapped in a real element and parks the caret inside
   it. A flat range list cannot express "a zero-length mark the next insertion should join",
   and the ZWSPs already sitting in saved documents become junk text.
3. **The browser's own native pending format.** Bold and italic deliberately do *not* handle
   the collapsed-caret shortcut — they let the browser do it
   (`inline-tool-bold.ts:38-42`, `:99-105`), because WebKit only applies pending format via
   its own default handler. The browser then writes `<b>` the model knows nothing about.
4. **Function-valued properties as an open escape hatch** — a capability removal for
   consumers, probably correct, but it is a removal.
5. **The open key space with open *semantics*** — `style: {color: …}` works because `color`
   is CSS, interpreted by the browser. A data model must re-implement the mapping per key or
   ship a closed vocabulary.
6. **`normalizeNbspIn`** (`simple-mark-tool.ts:80-96`) — a *text* mutation triggered by a
   *formatting* operation. Needs its own answer.
7. **`extendRangeToTrailingWhitespace`** (`mark-engine.ts:500`, `:662`) — Chromium/WebKit
   exclude trailing spaces from Ctrl+A. Moves to the Range→offset mapper; does not vanish.
8. **Link, equation and inline code are not marks today.** Link edits whole anchors and
   rewrites their text content (`inline-tool-link.ts:1070-1072`); equation's DOM is derived
   from `data-latex` and re-hydrated (`inline-tool-equation.ts:69-73`) — arguably an *atom*,
   not a mark. Whether the model has one kind of inline node or two is **not optional**.
9. **Clear Format's hard-coded tag list** (`inline-tool-clear-format.ts:14-16`) becomes
   "remove all marks in range" — strictly better, but a behaviour change (it currently
   preserves `<a>` and `<span data-latex>` by omission).

---

## 6. Blast radius — smaller than feared in the core, larger in the contract

**The CRDT layer is fully generic.** `grep -rn "'text'" src/components/modules/yjs/*.ts` →
**0 hits**. Nothing in the storage layer knows the field is called `text`. It needs a *new
value kind*, not a rewrite. `grep -rn "Y\.Text" src` → 3 hits, all comments.

**Only 4 places in `src/components` hard-code the `'text'` data key:**
`block-insertion.ts:462`, `:472`, `:480` (the Enter-split), `:571`, and
`data-persistence-manager.ts:143-157` (the `innerHTML = newData.text` fallback) plus
`:339-340`.

**The server needs no C# change for the HTML seam.** `BlokDocumentConverter.cs:159-163`
delegates `blocksToHtml` / `htmlToBlocks` / markdown to an embedded JS bundle under Jint
(`Generated/blok-server-runtime.js`). Regenerate the bundle, done. *(The collab engine is a
separate story — §7.)*

**The `/view` renderer touches no DOM at all** — `grep -rn innerHTML src/view` → 0. Pure
string pipeline through one gate, `blocks-to-html.ts:281-286`.

**What is genuinely PUBLIC, i.e. breaking:**

| surface | evidence |
|---|---|
| `data.text: string` on paragraph / header / quote / toggle / list item | `types/tools/paragraph.d.ts:10-11` — *"Can include HTML tags"*, and siblings |
| `ConversionConfig` | `types/configs/conversion-config.ts:6-26` — **string in, string out**. Every consumer tool with a `conversionConfig` breaks. |
| `SanitizerConfig` | `types/configs/sanitizer-config.d.ts:5-84` — a tag→attribute table, i.e. an HTML model |
| `MarkSpec` / `MarkSnapshot` / the `marks` API | `types/api/marks.d.ts` — returns `HTMLElement` |
| `OutputData` / `OutputBlockData` | every `{"text":"<b>hi</b>"}` already on a consumer's disk |

**Migration machinery exists and is already published**: `BlockMigration` /
`migrateOutputData` (`types/migrate.d.ts:21-54`, applied at `renderer.ts:148-149`) and
tool-owned `upgradeData` (`types/tools/block-tool.d.ts:305`). There is a precedent for
exactly this kind of change: table cells `string` → `{blocks}`
(`table-cell-blocks.ts:739-749`). `OutputData.version` is written on save
(`saver.ts:225`) but **nothing reads it** — all migration is shape-sniffing, which is fine
here since `text: string` vs `text: object` is trivially discriminable.

**Test surface, measured** — and this corrects an overstated figure: not 608 files. Files
with an HTML tag inside a `text:` field:

```
test:  78 files, 257 occurrences
src:    4 files
```

---

## 7. The C# engine — bounded, with one sharp decision

`packages/server/dotnet/Blok.Server/Yjs/YText.cs` states its own scope at `:3-16`: *"insert,
delete and the string. There is no formatting, no embed and no attribute argument."*

**`ContentFormat` is fully implemented** (`Content/ContentFormat.cs`, dispatched at
`Content/YContent.cs:103`). An update carrying formatting **decodes, round-trips and
re-encodes correctly** — 300 documents with embeds and format calls applied cleanly,
`threw=0`. This is not the risk.

**The silent loss is at export.** `Collab/YDocConverter.cs:1714` matches `case YText text:`
and flattens to `text.ToString()`, which by design omits `ContentFormat` and `ContentEmbed`.
Formatted text exported through this path **loses its marks with no throw and no log**. The
`default: throw` is at `:1776` and a `YText` never reaches it — so the earlier note about
"one good cell" was right to be corrected.

**Already present** and reusable: attribute-carrying position walk (`YText.cs:107-136`),
item splitting (`StructStore.Split`), `MinimizeAttributeChanges` (`:144`),
`cleanupFormattingGap` (`:202-258`), `toDelta` (written, but in the *test* project —
`Blok.Server.Tests/Yjs/JsonRenderer.cs:181-218`).

**Must be written:** `insertAttributes` + `insertNegatedAttributes` (explicitly cut at
`YText.cs:13-15`), `formatText`, `insertEmbed`, `cleanupYTextAfterTransaction` (needs a
transaction hook the 40-line `YTransaction.cs` does not have), optionally `applyDelta`.
**Not a rewrite** — a contained piece of work on machinery that already exists and is
already fuzz-tested.

**The sharp decision is `_searchMarker`.** The 40% divergence figure was **reproduced
exactly** this session: `119/300` documents differ on `toDelta`, `289/1500` ops differ on
emitted bytes, and against a marker-disabled yjs the engine matches `0/1500`. Root cause
confirmed in `node_modules/yjs/dist/yjs.cjs:6364-6374` — when a marker is used,
`findPosition` starts at `marker.index` **with a fresh empty attribute map**, so every mark
in force to the left is invisible. The C# engine walks from the start and accumulates
correctly.

> **The C# engine is currently MORE correct than stock yjs, and that is exactly why it
> disagrees with it.** Matching bytes means deliberately reproducing yjs's bug. Not matching
> means server and browser mint different item chains for the same edit on formatted text —
> a divergence *between peers* once formatting is on the wire, not merely a test-oracle
> disagreement.

**The conformance corpus has a hole shaped exactly like this.** The fuzzer excludes
formatting by design (`scripts/generate-yjs-engine-fixtures.mjs:1511`, `:1737-1741`), and
the whole shipped corpus contains **two** hand-picked formatting cases, with the engine as
pure reader. It never *writes* a format anywhere.

---

## 8. The format bump — a flag day, in both directions

- **Client gate:** `provider.ts:1165`, `tag.format !== SUPPORTED_FORMAT` (`= 1`, `:63`) →
  `terminate` → `phase = 'terminal'`, and `connect()` early-returns on terminal
  (`:1554-1557`). **Never reconnects for the life of that editor instance.** A degrade view
  does run (`index.ts:1234-1236`, `renderLastKnown`) but it renders the host's `config.data`
  snapshot, *not* the server's document — the Yjs bytes are dropped unread at `:1167`,
  before the frame drain at `:1202`. With empty `config.data`, the user gets an empty
  read-only editor.
- **Server gate:** `CollabRoom.cs:1255`, `!=` against the single scalar
  `CollabWorkingSetTag.SchemaV2` (`= 1`).
- **A hole:** the journal (v2 operation-store) path at `CollabRoom.cs:1238-1249` **returns
  before any format check**, taking `Head.Format` verbatim. A journal-backed server will
  serve a format-2 document to a format-1 client.
- **A second hole:** an unreadable stored format throws → close **4503**, which is *not* in
  the client's `TERMINAL_CLOSE_CODES` (`provider.ts:131-134` — only 4400, 4403). The client
  reconnects forever. Verified.
- **Ordering:** format fires *before* lineage (`:1165` vs `:1174`) and is terminal; lineage
  is recoverable. So lineage is **not** the first cross-format barrier — a correction to the
  earlier research.
- **Precedent: none.** `git log -S` shows both constants introduced at `1` and never
  changed. The one adjacent migration, `BKWS` → `BKW2`, documents itself as a non-migration:
  *"That is the migration — the format never shipped."* That escape hatch is not available
  here.

**Scalar vs set is therefore not a detail.** With a scalar, a new client breaks on old
documents *and* an old client breaks on new ones — every already-open tab dies the instant a
document is bumped, and does not heal without a reload on a new build. A set
(`SUPPORTED_FORMATS.has(...)`) turns it into "ship readers everywhere → flip writers → drop
the old format". **The set is necessary but not sufficient** — it has to be backed by a
dual-read of the block-text model, and no such hook exists today.

---

## 9. Corrections to the earlier research

1. **"`aliasTags` are canonicalised by a live MutationObserver" — FALSE.** `aliasTags`
   appears in exactly six places (`grep -rn aliasTags src/ types/`): the matcher
   (`mark-engine.ts:42`), the sanitizer whitelist (`simple-mark-tool.ts:121`), three tool
   declarations and the type. **There is no canonicalisation anywhere.** The only live
   MutationObserver is bold's (`inline-tool-bold.ts:281-330`), hard-coded to `B`/`STRONG` via
   `isBoldElement` (`utils/bold-dom-utils.ts:5-9`); it never reads a `MarkSpec`, and it
   exists to clean up after the *browser's native* bold command. Italic's `em` and
   strikethrough's `del`/`strike` are never rewritten — an `<em>` stays `<em>` forever.
   **This flips the argument:** alias normalisation is not machinery to preserve, it is
   unsolved work already on the books, and the mark model is the first thing that would fix
   it.
2. **"family composition excludes `style`" — true, but conditional.** Composition requires a
   single wrapper containing *both* range boundaries (`mark-engine.ts:268`, `:504-509`).
   Partial overlap nests two same-family `<mark>`s inside each other instead.
3. **"`transparent` counts as unset" — true only of the *function* form.** A *static*
   `transparent` is identity, because the static branch compares `current === value`
   (`:86`).
4. **"the tail's concurrent edits are lost on split" — imprecise.** They are relocated (§4).
5. **"re-setting a `Y.Text` crashes in `_integrate`" — false for 13.6.32.** It corrupts
   silently instead (§4).
6. **"lineage is the only cross-format barrier" — false.** Format fires first (§8).

---

## 10. The full clobber survey

Measured unless marked *(inferred)*.

| surface | shape | branch | result |
|---|---|---|---|
| paragraph/header/list/quote/toggle `.text` | `string` | leaf | **CLOBBER** |
| `code.code` | `string` (whole program) | leaf | **CLOBBER** |
| table grid, different rows | keyed grid | 1 | merges |
| table grid, same row different cells | `Y.Array` of `Y.Map` | 1→3→2 | merges |
| **table cell text, two people, different cells** | separate child blocks | n/a | **SAFE** |
| table, same cell | `cell.blocks: string[]` | leaf | **CLOBBER** |
| **column reorder vs concurrent cell edit** | positional splice | 3 | **CLOBBER** |
| row reorder / row delete / column delete vs cell edit | keyed grid | 1 | merges |
| `colWidths: number[]` | primitive array | leaf | **CLOBBER** |
| `database-row.properties`, different properties | `Y.Map` | 2 | merges |
| `properties.<text>`, same property | nested `string` | leaf | **CLOBBER** |
| `properties.<multiSelect>: string[]` | primitive array | leaf | **CLOBBER** |
| `database.schema[]`, `views[]`, select options | arrays of objects | 3 | merges |
| rich-text property (`OutputData`) | nested object | 2→3 | merges |
| captions / alt / audio title+artist | `string` | leaf | **CLOBBER** |

**What a block-text CRDT would NOT fix:** `code.code`, every primitive array
(`cell.blocks`, `colWidths`, multiSelect, `visibleProperties`), nested strings under
`properties`, and the column-reorder asymmetry. Those are independent work items.

---

## 11. The staged plan

Each stage is independently shippable and independently valuable. Stages 1 and 2 need no
format bump at all.

**Stage 1 — key the columns.** Extend the grid rule so columns are keyed like rows
(`serializer.ts:307`). Fixes the measured column-reorder clobber. No format change, no
public surface, no migration. *Smallest complete fix on the board.*

**Stage 2 — make the primitive arrays mergeable.** `cell.blocks`, `colWidths`,
multiSelect, `visibleProperties`. Either an element-keyed representation or set-semantics
writes. No format change. Independent of everything else here.

**Stage 3 — the format gate becomes a set, and the two holes close.** `SUPPORTED_FORMATS`
on the client (`provider.ts:1165`), the same on the server (`CollabRoom.cs:1255`) **and on
the journal path** (`:1238-1249`), plus a terminal close code for "unreadable format" so the
client stops retrying 4503 forever. Ship this **before** anything that would bump the
format; with a scalar, the bump is an unrecoverable flag day. *Pure infrastructure, no user-
visible change, and it is the long pole for everything after it.*

**Stage 4 — decide the mark model (3a or 3b).** This is a decision, not code. See §12.

**Stage 5 — block text becomes a CRDT sequence.** The write, the read, the offset mapper,
the `upgradeData`/`BlockMigration` pair, the split. Gated on stages 3 and 4. This is where
the measured text loss actually stops.

**Stage 6 — the C# engine's write side**, if and only if the chosen model puts formatting on
the wire: `insertAttributes` / `insertNegatedAttributes` / `formatText` / `insertEmbed`,
the transaction hook for `cleanupYTextAfterTransaction`, `toDelta` promoted out of the test
project, and `YDocConverter.cs:1714` stops flattening. Plus the `_searchMarker` decision and
formatting cases in the conformance fuzzer, which today has none.

---

## 12. The decisions only you can make

**D1 — 3a or 3b?** `Y.Text` formatting attributes are cheap, native, and **measurably lose a
peer's formatting on concurrent same-key overlapping ranges** (§3a), with no fix inside yjs
and no path to multiple instances of one mark type (comments, overlapping highlights). The
Peritext model is correct, and is not available in yjs. Choosing 3a means accepting a known,
reproducible defect as the ceiling. Choosing 3b means a much larger project and probably a
second CRDT.

**D2 — does `Everything Is a Block` bend for text?** The only known fix for the split
problem is that the tail keeps its character identity, which requires giving up per-block
text containers (§4). Automerge does exactly that; y-prosemirror declined and documented why.
If the law holds, the split stays permanently imperfect — text relocated, not lost. That may
well be the right trade. It should be an explicit decision, not a discovered consequence.

**D3 — one kind of inline node, or two?** Link and equation are not marks today (§5, item
8). Equation is arguably an atom. This shapes the schema and cannot be deferred.

**D4 — `_searchMarker`: match yjs's bug, or stay correct?** (§7.) Matching means
deliberately reproducing wrong behaviour so the bytes agree. Staying correct means peers
diverge once formatting is on the wire. There is no third option that keeps both.

**D5 — is the `MarkSnapshot.element` break acceptable?** It is unavoidable under any data
model (§5, item 1) and it lands on every consumer with a custom inline tool, through the
React adapter too.

---

## Sources

Measured this session: yjs 13.6.32 (`node_modules/yjs`), `@automerge/automerge` 3.5.0.
Primary documents fetched: yjs `ContentFormat.js` / `YText.js` / README / docs.yjs.dev,
Quill Delta README, ProseMirror `mark.ts` / `schema.ts` / reference docs, y-prosemirror
`CAVEATS.md`, Lexical `LexicalConstants.ts` / `LexicalTextNode.ts` / `lexical-yjs`,
Peritext (inkandswitch.com/peritext), Automerge rich-text docs and blog.

**Not verified:** Lexical's concurrent-format merge *outcome* (storage shape verified from
source; behaviour derived). Whether yjs v14 — already a rewrite on `main` — changes the
overlap behaviour. Whether the 300-document corpus behind the 40% figure is representative
of real Blok documents; it proves the divergence is systematic and easy to hit, not that 40%
of production documents would diverge.
