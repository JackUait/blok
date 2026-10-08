# Page title follow-ups — overview

Status: SHIPPED 2026-10-08 (fd5545dc..f50c9076). Outcome differs from this plan in two places:
- `record: false` does not cancel older undo steps; they return after the next recorded change to the same field. Call `history.clear()` after the write to make it a floor (`types/api/title.d.ts`).
- The collab server write-back now carries `title`/`icon`, labelled BREAKING for hosts (042338ca, `packages/server/README.md`).

Plan 1 (core) shipped in b679a115..ef5eb8bc. See `2026-10-08-page-title-design.md` and `2026-10-08-page-title-core-plan.md`.

Four research passes ran in parallel (server, adapters, playground, exports/docs). The main session re-checked the claims every task depends on. This overview gives the order, the decisions, and the defects found along the way.

## Order

```
1b core levers ──┬──> 2 server ──────────────┐
                 ├──> 3 adapters             ├──> 4 playground + exports + docs
                 └───────────────────────────┘
```

| Plan | File | Depends on |
|---|---|---|
| 1b Core levers | `2026-10-08-page-title-levers-plan.md` | — |
| 2 Server persistence | `2026-10-08-page-title-server-plan.md` | 1b Task 1 (schema) |
| 3 Adapters | `2026-10-08-page-title-adapters-plan.md` | 1b Task 3 |
| 4 Playground, exports, docs | `2026-10-08-page-title-playground-exports-plan.md` | 1b, 2 (collab titles), 3 (docs only) |

Plans 2 and 3 do not touch each other's files and can run in parallel.

## Not breaking

Every surface these plans change shipped after `v1.16.1`, with one exception. Checked:

- `git log v1.16.1 -- types/api/title.d.ts` is empty. Its first commit is 8d86c376, which is after the tag.
- The C# Yjs converters (`YDocConverter`, `CollabDocConverter`) are `internal`. `IBlokDocumentConverter` is NOT: it is public and shipped in v1.16.1, so plan 4 Task 10 extends it only through default interface members (D13).
- `blokDocumentSchema` shipped in v1.16.1, but plan 1b only adds optional properties to it. That is additive.

The exception is the shipped exporters, importers and text helpers (`blocksToHtml`, `blocksToMarkdown`, `blocksToPlainText`, `blocks.exportMarkdown`, `markdownToBlocks`/`htmlToBlocks`, `extractTexts`/`injectTexts`). They shipped before the tag and accept any record. Turning title output on by default would change their output for a host that already stores its own `{ title, blocks }`. That counts as "changing a default", so plan 4 makes all of it opt-in (decisions D1, D2, D12).

## Defects found during research

These are real gaps in what is on `main` today:

1. **The published document schema rejects a document with a title.** `blokDocumentSchema` (`src/view/document-schema.ts`, published in v1.16.1, exported from `src/view/index.ts:24`) has `additionalProperties: false` and no `title` or `icon`. Since 8d86c376 the Saver writes `title`/`icon`, so any saved document with a title fails the published schema. Fixed by plan 1b, Task 1.
2. **A collab document never gets a title from the host record.**
   - `core.ts:508-509` passes only `blocks` to `collaboration.load`.
   - `CollabDocConverter.SeedAsync` reads `blocks` only (`CollabDocConverter.cs:40-48`).
   - `ExportAsync` writes `{time, blocks}` only (`:121-125`).
   - A collab title syncs live and survives compaction. It is lost on seed and reset, and the host never receives it. Fixed by plan 2.
3. **A title host that leaves the page keeps the title "enabled".**
   - `PageTitle.isEnabled` is `dom !== null` (`pageTitle/index.ts:48-50`).
   - Backspace-join (`blockEvents/composers/keyboardNavigation.ts:116-139`, called at `:914-916`) and ArrowUp (`caret.ts:1052`) trust it.
   - After the app removes the holder (any framework unmount), Backspace at the start of the first block would move its text into a title nobody sees.
   - Found by reading code, and confirmed by a second read: `joinIntoTitle` appends the text, dispatches `input` (the Yjs title is written), then removes the block. Not reproduced at runtime. Plan 1b Task 3 reproduces it first.

## Decisions

Each decision has a recommended default. The plan task named in the last column stops and asks the user before it starts, unless the user has already answered.

| # | Question | Default | Why | Confirm before |
|---|---|---|---|---|
| D1 | Exporters emit the title by default, or only when asked? | Opt-in: `{ title: true }` on `blocksToMarkdown`, `blocksToHtml`, `blocks.exportMarkdown`, `blocksToPlainText` | Changing the default output of a shipped exporter is breaking. Opt-in is the compatible route. | 4, Task 8 |
| D2 | Importers lift a leading H1 / `#` line into `title`? | Opt-in `{ title: true }` on `markdownToBlocks` / `htmlToBlocks` (and `importMarkdown`) returns `title` and drops that block | Export then import otherwise duplicates the title as a header block | 4, Task 9 |
| D3 | Icon in exports? | Emoji icon: `# 🚀 Title` and `<h1><span aria-hidden="true">🚀</span> Title</h1>`. Image icon: left out of Markdown; `<img alt="">` in HTML. | Follows the tab (`blocks-to-markdown-core.ts:1182`) and page-card (`emitters.ts:482-491`) precedents | 4, Task 8 |
| D4 | How does `<BlokTitle>` get the editor? | An explicit `editor` prop, like `BlokContent`. A `BlokEditor` user passes the instance from a state-setter ref (React), `instance` (Vue) or `instance()` (Angular). | No context reaches a sibling of `BlokEditor` in any adapter today (React `BlokContent.tsx:104`, Vue `BlokContent.ts:48`, Angular `block-portal-registry.ts:140`) | 3, Task 3 |
| D5 | Does `<BlokTitle>` switch the title on by itself? | No. `pageTitle` must be set at construction. `<BlokTitle>` only places it. | Core builds the header only in `prepare()` (`pageTitle/index.ts:60-110`) | 3, Task 3 |
| D6 | Where does the header go when `<BlokTitle>` unmounts? | Back to its default spot, through a new `blok.title.mount(null)` | Leaving it detached is a dead title, and Defect 3 shows that is unsafe | 1b, Task 3 |
| D7 | Non-recording set: what does `onChange` report? | `title.set(text, { record: false })` fires `onChange` with source `'api'` and `change.record === false` | The host can tell its own seed from a user action, and the source union stays the same | 1b, Task 2 |
| D8 | Icon morph hard cut | No core change. The playground names the icon element for the transition only when the new page already has an icon when the snapshot is taken. | `icon-control.ts:134-145` replaces the button only when its kind changes (add↔icon). In local mode the icon is in `config.data` at construction, so its kind is fixed before the snapshot. Only a collab icon that arrives late changes the kind. Plan 4 Task 7 tests that case first. Moving to one stable button would change the shipped testids `page-header-add-icon` / `page-header-icon`. | 4, Task 7 |
| D9 | `?host=remote` | Moves onto the built-in title. The host verdict uses `record: false`. | One title system in the playground, not two | 4, Task 4 |
| D10 | Version read shape | Title and icon at the top level only (the export shape). The `page` object stops carrying them. | One place for one fact. `page` was added after the tag (fe33660d), so dropping keys from it is not breaking. | 2, Task 5 |
| D11 | Backspace join from a heading or list | Keep core's rule: it becomes a paragraph first, then joins | Matches how a block joins into the block above it | 4 (note only) |
| D12 | Does translation (`extractTexts`/`injectTexts`) cover the title? | Yes, opt-in: `{ title: true }` in `DocumentTextsOptions` puts the title first in the list | Both functions shipped in v1.16.1 (955c2a5b is in the tag). Adding the title by default would shift every index a consumer stored. `injectTexts` already keeps the envelope. | 4, Task 10 |
| D13 | How does the C# export API get the title option? | New method NAMES (e.g. `ToHtmlWithTitleAsync`), not overloads, as default interface members on the public `IBlokDocumentConverter`. The defaults throw `NotSupportedException`; the built-in converter overrides them. | An abstract member is BREAKING (see 4934b48a). An overload next to `(string, CancellationToken = default)` makes `ToHtmlAsync(json, default)` ambiguous. `net10.0` supports default members. Cost: a third-party implementer fails at runtime, not compile time, when asked for the title. | 4, Task 10 |

## Known limits, recorded rather than fixed

- **Restoring a version made before plan 2 clears the live title.** That point has an empty `page` map. An empty title is stored as an absent key, so "cleared" and "never stored" look the same (`CollabRestorePlanner.cs:56-58`).
- **A collab editor shows no title while offline.** `core.ts:509` loads blocks only for the read-only degrade.
- **A host cannot set the title through the `/edit` endpoint.** Map patches from the wire are refused (`CollabEditOpsTests.cs:126`).
- **Concurrent title typing is last-writer-wins.** This is unchanged from the design.

## Release notes owed (hand-off, not a CHANGELOG task)

`CHANGELOG.md` has no Unreleased section. Entries are written at release time by `/release:release` (`.claude/commands/release/release.md`). One entry covers plans 1–4:

- **Page title** — the open page gets a title and emoji icon that Blok owns, saves and syncs.
  - `pageTitle` in the config, `blok.title` on the instance, and `title`/`icon` in saved data.
  - `<BlokTitle>` places it in React, Vue and Angular.
  - Exporters and importers take `{ title: true }`. Older Blok drops `title`/`icon` on save.
