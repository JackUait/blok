# CLAUDE.md

Project guidance for Claude Code (claude.ai/code) working with this repository.

---

## IMMEDIATE COMPLETION CHECKLIST

**STOP! Before saying "done" or "complete", verify ALL of the following:**

```
[ ] 1. Did I write tests FIRST, watch them FAIL, THEN write code? (IRON RULE)
        Bug fixes: also watch the fix PASS, then re-run the full suite.
[ ] 2. `git pull` and `git push` succeeded
[ ] 3. `git status` shows "up to date with origin"
```

**If ANY box is unchecked:** Work is NOT complete. Do it NOW.

**No rationalizations:**
- "Chat is too long" → INVALID. You're reading them right now.
- "User is in a hurry" → INVALID. Half-done work wastes MORE time later.
- "It's just a small change" → INVALID. Small changes break things too.
- "I'll do it in next session" → INVALID. That leaves work stranded.
- "Tests already cover it" → INVALID. Write test FIRST, watch it FAIL.
- "I already manually verified it works" → INVALID. Tests first.
- "The push can wait, user can do it" → INVALID. Push before declaring done.

### Failure Recovery Protocol

**When pre-commit hook, tests, lint, build, or any verification fails:**

1. **Determine session blame FIRST** — Run `git diff --name-only` to get files changed in this session. Check if the failing files overlap with your changed files.
   - **Failures in files you changed** → Your responsibility. Proceed to step 2.
   - **Failures ONLY in files you did NOT change** → Pre-existing. You MAY skip with `--no-verify` for this commit only. Log which failures were skipped and why in the commit message.

2. **Deploy parallel subagents** — For failures you own, launch one `Task` tool agent per failure category (e.g., one for lint fixes, one for test fixes). Do NOT fix failures sequentially in the main context — subagents are faster and preserve context.

3. **Re-run full verification** — After all subagents complete, re-run the failing checks. If new failures appear, repeat from step 1.

**No rationalizations:**
- "I'll fix it manually instead of using subagents" → INVALID. Subagents are faster and preserve main context.
- "All failures are pre-existing" → VERIFY with `git diff`. Don't assume.
- "Subagents are overkill for one error" → Use them anyway. Consistency matters.
- "I'll just use --no-verify" → ONLY allowed after git diff proves failures are pre-existing.

**This checklist is ALWAYS executed. NO MATTER how long the chat is.**

### Stash Discipline

**If you ever run `git stash` (for any reason — isolating a commit, avoiding a pull conflict, trying out a reset), you MUST restore every stashed change before ending the session.**

1. After the operation that required the stash, run `git stash pop` (or `git stash apply` + `git stash drop`).
2. Run `git status` and `git diff` to verify every file the user had modified is back in the working tree.
3. If `git checkout HEAD -- <file>` was used to reset a mixed-WIP file, the WIP hunks in that file are NOT in any stash — you must re-apply them from a saved patch/diff before finishing.
4. Never leave WIP in `git stash list` at end of session. The user's uncommitted work is sacred.

**No rationalizations:**
- "The WIP was breaking a test" → INVALID. Restore it anyway. The user owns it.
- "I'll restore it in the next session" → INVALID. Do it now.
- "Only the files I stashed got back, the rest is fine" → INVALID. `git checkout HEAD -- <file>` wipes WIP silently. Verify with `git diff` against the pre-session baseline.

---

## Landing the Plane (Session Completion)

Before declaring done: run quality gates (`yarn lint`, `yarn test`), push, clean up local state, and hand off context. Run the checklist above.

Scope note: lint and test only the files you changed while iterating. The full-project `yarn lint` and `yarn test` are the FINAL gate before done, and they are not optional here — the scoped run has blind spots.

## Breaking Changes

Blok is a published library. A change that alters a public surface lands on real consumers, and the user decides the version bump and the release notes.

**Tell the user, in the reply, at the moment you make the change.** Say what breaks, who it breaks for, and what the migration is. Do not bury it in a list.

**Label the commit.** Put `BREAKING` in the subject and a `BREAKING CHANGE:` line in the body giving the old behaviour, the new behaviour, and the migration step.

**Counts as breaking:** removing or renaming an exported symbol, a public type in `types/`, a config key, a data attribute, a CSS variable, or a field in a block's saved data; changing a default; changing a tool's saved JSON shape; anything a consumer's `tsc` or runtime would notice.

**Does not count:** internals under `src/` with no published surface, tests, docs wording.

If the break is avoidable, say so and offer the compatible route before committing to it.

## Project Overview

Blok is a headless, block-based rich text editor (similar to Notion). Content is JSON blocks, not HTML.

## Everything Is a Block (Architectural Law)

**Every content entity in Blok MUST be a block.** This is not a guideline — it is the foundational architectural constraint. Blocks are the universal primitive.

### The Rules

1. **A database is a block.** It implements `BlockTool`, lives in the block tree, and stores schema + view configs in its `data`.
2. **A database row is a block.** Each row is a `database-row` block that is a child of the database block (via `parentId`/`contentIds`). Its `data.properties` stores column values conforming to the parent database's schema.
3. **A page is a block with children.** Any block with `contentIds` can act as a "page." Opening a database row means navigating into that block's children.
4. **Properties are NOT blocks.** Structured column values (status, priority, dates) are metadata stored in the block's `data` field — never as separate blocks.
5. **Page body IS blocks.** Rich content inside a row/page is stored as child blocks via `contentIds`.

### When Adding New Features

Before designing any new feature, ask: **"Is this a block?"** If it represents content, data, or a container — it MUST be a block. Examples:

- Adding a calendar view? The calendar is a view config on a database block. Rows are still row blocks.
- Adding comments? Each comment thread could be a block.
- Adding a table of contents? It's a block that reads sibling blocks.
- Adding embeds? Each embed is a block.

### What This Means in Practice

- **No internal data models that shadow the block tree.** If something looks like it should be a block (has an ID, stores data, can be nested), make it a block.
- **Use `parentId`/`contentIds` for containment.** Don't reinvent hierarchy inside a tool's data blob.
- **The Saver/Renderer pipeline handles serialization.** Don't build custom save/load for entities that should be blocks.
- **Block operations (insert, move, delete) are the API.** Don't build parallel CRUD for non-block entities.

## Commands

Scripts live in `package.json`. Two things it does not tell you:

- `yarn serve` starts the collaboration backend alongside the playground. Pass `--no-server` for the playground alone.
- Single test: `yarn test [file]`, `yarn test -t "pattern"`, or `yarn e2e [file] -g "pattern"`

## Releasing

Run `yarn release <version>`. Publish happens **before** git push. Full workflow and the release-notes rules: `/release:release`.

## Architecture

DOM nesting per block: `holder` → `contentElement` → `toolRenderedElement`

## Tools

**Toolbox**: Triggered by "/" in empty paragraph or clicking + button. Uses Popover component.

**Container contracts are DECLARED, not re-implemented per tool.** Before adding tool-side defensive code, check whether core already has the lever — and if it does not, add the generic lever rather than the workaround:

- `static childTools = { allow?, deny? }` — which tools may be DIRECT children. Core demotes a disallowed tool on insert (to `allow[0]`, so Enter-at-the-end-of-a-child makes another child), refuses a cross-boundary move that would carry one in, and hides them in the toolbox. This is the selective, insert-aware counterpart to `ownsChildren` (all-or-nothing, move-only), and the generic form of the Table tool's `restrictedTools` (whose enforcement is hard-wired to `isInsideTableCell`). A container that declares it does NOT need to filter `child.name` in render, style around a foreign child, or migrate strays. Enforcement lives in `src/components/utils/child-tools.ts`.
- `data-blok-keyboard-owner` — marks a subtree whose keyboard belongs to the tool. Blok's block-level AND editor-level keydown/input handling stand down entirely inside it. Core's native-`<input>` exemption is only the STRUCTURAL keys (Enter/Backspace/Delete and "/"); Escape/Tab/arrows deliberately stay Blok's ("how a user leaves a field"), which is right for a one-line title and wrong for a field with its own keyboard semantics. Use the attribute instead of per-key `stopPropagation` handlers.

**Paste attribute law**: before a tool's `onPaste` receives `event.detail.data`, the Paste module sanitizes it with html-janitor using ONLY the attribute whitelist from the tool's `pasteConfig` tags (e.g. `{ TD: { style: true, colspan: true, rowspan: true } }`). Every attribute that `onPaste` (or any helper it calls) reads from the pasted element or its descendants MUST be whitelisted there — a missing entry means the sanitizer silently strips it and data is lost with no error (this is how pasted merged table cells were flattened for months). When adding an attribute read to any paste handler, add it to `pasteConfig` in the same change AND add a test that pastes HTML carrying that attribute through the real sanitizer.

The law applies to **tags and downstream parsing too**, not just attributes:

- **Descendant tags a paste handler reads must survive sanitization.** But NEVER whitelist them by adding extra tags to `pasteConfig.tags` — that map doubles as the tag→tool substitution registry, so adding `P`/`UL`/`LI` to the table's `pasteConfig` would make standalone pasted paragraphs/lists substitute into table blocks. Instead: structural tags (`ul`/`ol`/`li`, table tags…) survive via `SAFE_STRUCTURAL_TAGS`; their meaningful attributes via `STRUCTURAL_TAG_ATTRIBUTES` (`src/components/modules/paste/constants.ts`); table-cell-specific extras (img, checkbox input) via `sanitizeTable` in `sanitizer-config.ts`.
- **Stamps must survive too (the write side).** Paste pre-passes stamp metadata onto pasted DOM (`preprocessNestedLists` stamps `aria-level`/`data-list-style` on `li`); any stamped attribute outside `STRUCTURAL_TAG_ATTRIBUTES` / some tool's `pasteConfig` is silently stripped before onPaste — core code destroying what core code just wrote. Mechanically enforced by `test/unit/architecture/paste-stamp-law.test.ts` (scans every `setAttribute` in the paste module; exemptions need reasons).
- **Sanitizer survival is not enough — the consumer must parse the structure.** Table cells store content as an HTML string; anything that turns that string into blocks MUST go through `parseCellContentToBlocks` (`src/tools/table/table-cell-paste.ts`), and anything serializing cell blocks back into that string MUST use `serializeCellBlocksToHtml` (same file). Ad-hoc `<br>`-splitting or `.join(' ')` of block texts silently destroys lists in cells — that exact pattern existed in FIVE places (initializeCells, buildCellPayloadFromTd, buildCellContent, insertSingleCellPayloadInline, buildClipboardHtml) and each one flattened lists on a different copy/paste path — including the COPY direction (Blok → external apps), not just paste. If you add a new cell-content path, reuse those two functions and add a paste test carrying a nested list through it. This rule is mechanically enforced by `test/unit/architecture/table-cell-content-law.test.ts` (static scan for `<br>`-split / `<br>`-join / space-join fingerprints across all table + cell-handler files, exemptions require reasons, mutation-verified).

**Drag & Drop**: Pointer-based (not HTML5 drag API) from ☰ icon. See `src/components/modules/dragManager.ts`.

**Child-holder decoration law**: a container block MAY write attributes/classes/styles onto a child's **holder** and onto the child's `[data-blok-element-content]` wrapper. It MUST NOT write at or below the child's **tool root**, and it MUST NOT wrap a child holder in an element of its own.

- *Why the writes are inert* (two independent gates, at two different layers): for the CHILD block, `isMutationBelongsToElement` (`src/components/utils/mutations.ts`) drops an `attributes` record whose target is the holder — the holder is the child tool element's ANCESTOR, and the childList escape hatch does not apply — so `MutationHandler.watch()` never even calls `onMutation`. For the CONTAINER, the record does pass that filter, but `shouldFireUpdate` (`src/components/block/mutation-handler.ts`) finds the container's own `data-blok-mutation-free` host as the nearest such ancestor and `contains(self)` is true, so it is scored mutation-free. Core relies on this itself: `reindentSubtree` writes `style.marginLeft` + `data-blok-depth` on every nested holder on every reparent. Pinned by `test/unit/components/block/mutation-handler.test.ts` → `MutationHandler — parent writes on a child holder`, which drives the event bus for the child (the filter) and `handleMutation` for the container (the suppression) — calling `handleMutation` for BOTH would "prove" the opposite, because the child-side guarantee does not live in `shouldFireUpdate`.
- *Why no wrappers*: `hierarchy.setBlockParent` finds a holder's next sibling with `b.holder.parentElement === newContainer` and otherwise appends at the container's end, `mountChildBlocks` assumes the same, and `caret.ts` decides "same DOM container" by comparing sibling `holder.parentElement` by identity. A per-child wrapper corrupts reparent ordering and makes every sibling pair look cross-container.
- This is what the framework adapters' declarative per-child channel is built on — `<BlockChildren childAttributes>` (React/Vue) and `ctx.mountChildren(host, childAttributes)` (Angular).

## Code Conventions

### Avoid Over-Engineering
- Don't add features beyond what's asked
- Don't create helpers for one-time operations
- Three similar lines > premature abstraction
- Only comment where logic isn't self-evident


## Testing

### Critical Rules (Violations = Wrong Work)

**E2E:**
- Build runs automatically before tests - no manual step needed
- NEVER use CSS class selectors → use semantic locators or `data-blok-testid`
- NEVER forget async/await → Playwright is async
- NEVER assume immediate availability → use waitFor or auto-waiting

**Unit:**
- NEVER use `@ts-ignore`, `any`, or `!` → use proper type guards
- ALWAYS call `vi.clearAllMocks()` in beforeEach
- NEVER mock what you're testing → mock dependencies only
- ALWAYS restore mocks in afterEach (`vi.restoreAllMocks()`)

**Architecture:**
- Test behavior through public APIs, NOT private methods
- Test event emissions with proper data
- NEVER bypass the module system

**Bugs:**
- ALWAYS write regression test BEFORE fixing
- Test MUST fail first (otherwise it's not a regression)
- NEVER fix without test coverage

### Patterns

**Mocking modules**: copy the pattern in `test/unit/blok.test.ts`.

**Factory fixtures**: copy the pattern in `test/unit/components/modules/blockManager.test.ts`.

**E2E locators** (priority order):
1. Role-based: `page.getByRole('button', { name: 'Submit' })`
2. Text-based: `page.getByText('Hello World')`
3. Test ID: `page.getByTestId('block-settings')` (uses `data-blok-testid`)
4. NEVER: CSS class selectors

**Custom tools** in E2E: inject the class source as a string via `classCode`, not as a module import.

## Accessibility

Accessibility checks run via `@axe-core/playwright`.

## Documentation

The docs are a separate React app in `docs/` (own `package.json`, Vitest + React Testing Library).

### Plans Directory

`docs/plans/` contains design documents for refactoring work. These are architectural plans, not implementation tasks.

## Configuration

**DO NOT modify** without explicit request: `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json`, `.env`

## Types

**Published-types law**: `types/*.d.ts` is the hand-authored public type surface (the build emits only JS bundles — no `.d.ts` generation), so `exports` points every subpath's `types` at a file under `types/`. NO file under `types/` may re-export/import from a module that resolves into `src/`. A consumer's `tsc` follows the declaration graph from `types/`, and a `../src/...` specifier drags raw implementation `.ts` into their program — which then needs packages blok never declares as runtime `dependencies` (transitive type-only deps like `micromark-util-types`/`@types/mdast`), exploding their build with TS2307/TS7006 (this is what shipped in 0.24.0 via `react.d.ts` → `markdown.d.ts` → `../src/markdown`). To expose a value implemented in `src/`, hand-author its signature in `types/` (see `types/markdown.d.ts`) or generate a self-contained declaration (see `types/icons.d.ts` + `scripts/generate-icons-dts.mjs`) — never re-export from `../src/`. Mechanically enforced by `test/unit/architecture/published-types-no-src-refs.test.ts`.

**Hand-transcription drifts — generate instead**: every published declaration that MIRRORS a `src/` value (rather than describing a hand-authored API) must be generated + drift-tested, because transcription silently rots. `types/data-attributes.d.ts` proved it: 17 of DATA_ATTR's ~110 attributes were missing from the published type — including `nestedBlocks` (`data-blok-nested-blocks`), the container slot every nesting tool's stylesheet targets — plus one phantom key the runtime never had. Consumers typing `DATA_ATTR.nestedBlocks` got TS2339 and hard-coded the raw string. **Rule: after adding/renaming/removing a data attribute in `src/components/constants/data-attributes.ts`, run `node scripts/generate-data-attributes-dts.mjs`.** `test/unit/architecture/published-types-no-src-refs.test.ts` fails on any key/value drift.

## Icons

All icons live in `src/components/icons/index.ts` as exported SVG string constants.

The dev playground (`index.html`) has a `iconGroups` object (around line 909) that groups icons into named categories for the `/icons` gallery tab. **This list is manually maintained.**

**Rule: whenever you add a new icon to `src/components/icons/index.ts`, you MUST also add its export name to the appropriate group in `iconGroups` in `index.html`. Place it in the most fitting existing category, or create a new named category if none fits.**

**Rule: after adding/renaming/removing an icon, run `node scripts/generate-icons-dts.mjs` to regenerate the published `types/icons.d.ts` (self-contained declaration; see the Published-types law under Types). `test/unit/architecture/published-types-no-src-refs.test.ts` fails until it's in sync.**

## Important Patterns

1. **Event-Driven**: Custom EventsDispatcher for typed events (`src/components/events/`)
2. **JSON Format**: Clean structured output, each block: `{ id, type, data, tunes }`
