# Phase 0 integration notes

Worktree: `~/Packages/.blok-undo/dbp-integ`, detached at `665c077a`. Order applied: A, B, E, C, D, each with `git apply --3way`, one local checkpoint commit per task. Commits are saved in `phase0.bundle` (`665c077a..HEAD`):

| Commit | Task |
|---|---|
| ac740d98 | A: read-only stays read-only |
| bfffc582 | B: grouped-list add row + untitled card rename |
| f0d1ec3a | E: compat and hygiene |
| 7b249a0d | C: grouping correctness |
| 34f741c0 | D: query engine (resolved against C) |

Final diff: `INTEGRATED.diff` (27 files, +2066 / -196).

Vitest was run one process at a time throughout.

---

## Task A (read-only)

- **Conflicts:** none. All 4 files applied cleanly.
- `database-tab-bar.test.ts` + `database.test.ts`: `Test Files 2 passed (2)`, `Tests 184 passed (184)`.
- `test/unit/tools/database`: `Test Files 36 passed (36)`, `Tests 1129 passed (1129)`.

## Task B (list row + rename)

- **Conflicts:** none. Applied cleanly on top of A. B's `handleAddListRow` hunk and A's hunks touch different parts of `index.ts`.
- `database-board-view.test.ts` + `database.test.ts`: `Test Files 2 passed (2)`, `Tests 208 passed (208)`.
- `test/unit/tools/database`: `Test Files 36 passed (36)`, `Tests 1131 passed (1131)`.

## Task E (compat)

- **Conflicts:** none. All files applied cleanly. Git printed "Falling back to direct application" for the new files; that is expected for added files.
- Per-file runs:
  - `database-model.test.ts`: 49 passed
  - `database-card-drawer.test.ts`: 91 passed
  - `database.test.ts`: 135 passed
  - `test/unit/playground/database-fixtures.test.ts`: 17 passed
  - `test/unit/styles/database-reduced-motion.test.ts`: 6 passed
  - `test/unit/styles/css-split-equivalence.test.ts`: 4 passed
  - `test/unit/styles/preflight-layer.test.ts` (the other reader of `main-css-rules.snap.txt`): 8 passed
- `test/unit/tools/database`: `Test Files 36 passed (36)`, `Tests 1140 passed (1140)`.

## Task C (grouping)

- **Textual conflicts:** none. All 12 files applied cleanly on top of A + B + E.
- **Semantic check, B1 × C1:** B1's `handleAddListRow` finds the group's rows list with `[data-option-id="${optionId}"]`. C1 adds a no-value group with id `__blok-no-value-group__`.
  - That id needs no CSS escaping, so the selector stays valid.
  - C's own hunk in the same function skips writing the group value for `NO_VALUE_GROUP_KEY` and writes `[optionId]` for multiSelect.
  - No edit was needed.
- Per-file runs:
  - `database.test.ts`: 149 passed
  - `database-model.test.ts`: 50 passed
  - `database-model.mutants.test.ts`: 24 passed
  - `database-column-drag.test.ts`: 9 passed
  - `database-board-view.test.ts`: 76 passed
  - `database-card-drag.test.ts`: 12 passed
  - `test/unit/components/i18n/lifecycle-coverage.test.ts`: 2 passed
- `test/unit/tools/database`: `Test Files 36 passed (36)`, `Tests 1156 passed (1156)`.

## Task D (query engine): 4 conflicts. Executors applying D after C MUST make these edits.

1. **Silent conflict in `src/tools/database/database-model.ts`. Git reported it as "applied cleanly".**
   - D's `groupKeysOf` calls `this.toGroupKey(...)`. C renamed that helper to `toGroupKeys` (it now returns `string[]`), so `toGroupKey` no longer exists. tsc would fail.
   - Resolution, as D's design intends ("Task C changes only the body of `groupKeysOf`"):
     ```ts
     groupKeysOf(propertyId: string): (row: DatabaseRow) => string[] {
       return (row) => this.toGroupKeys(row.properties[propertyId]);
     }
     ```
   - With this, `queryRows({ group: NO_VALUE_GROUP_KEY })` returns the empty-value rows, and multiSelect rows match every one of their options.

2. **`index.ts`, `renderBoardView`.** C added `groupOptions()` (the no-value option first) and kept `getRowsGroupedBy`. D added `queryGroupRows()` and the `viewConfig` parameter.
   - Resolution: keep both helpers. Options come from C, rows come from D:
     ```ts
     const options = groupByPropId !== undefined ? this.groupOptions(groupByPropId) : [];
     const groups = viewConfig !== undefined && groupByPropId !== undefined
       ? this.queryGroupRows(viewConfig, options.map((o) => o.id))
       : new Map<string, DatabaseRow[]>();
     ```

3. **`index.ts`, `renderListView` (grouped branch).** Same shape of fix:
   ```ts
   const options = this.groupOptions(groupByPropId);
   const groups = this.queryGroupRows(viewConfig, options.map((o) => o.id));
   ```

4. **`test/unit/tools/database/database.test.ts`.**
   - Both C and D append `describe` blocks at the end of the top-level `describe('DatabaseTool')`. diff3 interleaved them.
   - Resolution: take C's file, then append D's whole hunk (134 added lines) before the final `});`. No text was lost.
   - After that, **2 of D's tests failed against C's behaviour**. They were adapted. D's intent is kept:
     - `hides a card that a saved filter excludes, and keeps every column`: failed with `expected … to have a length of 3 but got 4`. C1 renders the no-value column even when it is empty. The expectation was changed to `toHaveLength(4)`, with a comment "3 options plus the no-value column".
     - `still deletes a row a filter hides when its column is deleted`: failed with `expected "vi.fn()" to be called with arguments: [ 2 ]`, `Number of calls: 0`. C3 changes column delete to keep rows and clear their group value.
       - The test is renamed to `still clears the group of a row a filter hides when its column is deleted`.
       - It now asserts `childBlocks[1].call` was called with `('updateProperties', { 'prop-status': null })` and that `blocks.delete` was not called.
       - The `getBlockIndex` mock was dropped, because nothing is deleted any more.
       - **Mutation check:** I changed `handleOptionDelete` to read `queryRows({ view, group })` (filtered rows) instead of `getRowsGroupedBy`. The adapted test then failed (`1 failed`). I restored the file.
       - **If D9 rejects C3:** restore D's original test (`blocks.delete` called with `2`) together with skipping C3.
- After resolution:
  - `database-query.test.ts`: 68 passed
  - `database.test.ts`: 155 passed
  - `database-model.test.ts`: 50 passed
- `test/unit/tools/database` was run 3 times:
  - Run 1: `1 failed | 1229 passed (1230)`
  - Run 2: `1 failed | 1229 passed (1230)`
  - Run 3: `Test Files 37 passed (37)`, `Tests 1230 passed (1230)`
  - Both failures were `database-card-drawer-tab-sync.test.ts > the nested card editor opens no tab-sync channel`, `5008ms` / `5004ms` timeouts. The file alone: `1 passed`. See the reds section.

Gating reminder: the integrated diff includes C3 (GATED ON D9) and D4 (GATED ON D7), as drafted.

---

## Final gates (on 34f741c0)

- **ESLint** on all 21 changed `.ts` files (excluding `.d.ts`): exit 0, no output. The two `.d.ts` files (`types/message-keys.d.ts`, `types/tools/database.d.ts`) are on the config's ignore list ("File ignored because of a matching ignore pattern"), 0 errors.
- **tsc** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`: exit 0, 0 `error TS` lines. This includes `test/unit/types/database-data-drift-typecheck.ts`.
- **Test set:**

| Suite | Result |
|---|---|
| `test/unit/tools/database` | 37 files, 1230 passed (3rd run; see the flake below) |
| `test/unit/styles` | 54 files, 718 passed |
| `test/unit/playground` | 32 files, 736 passed |
| `test/unit/architecture` | 1 failed / 80 passed files; 3 failed / 1300 passed tests |
| `test/unit/components/i18n` | 3 failed / 12 passed files; **139 failed** / 7228 passed (7367) tests |

## Reds and whether they are pre-existing

1. **`architecture/react-fixture-import-map-law.test.ts`: 3 failed.**
   - Message: `packages/react/dist/index.mjs is missing — run yarn build first`.
   - **Pre-existing.** The same file fails the same 3 tests in a clean worktree at `665c077a` (`dbp-base`), with the same message. The cause is that there is no build in the worktree.
2. **`tools/database/database-card-drawer-tab-sync.test.ts`: 5 s timeout. UNRESOLVED.**
   - Integrated tree: it failed in 2 of 3 folder runs (`5008ms`, `5004ms`).
   - Base `665c077a`: 0 failures in 2 folder runs.
   - Run alone, the test takes about the same time in both trees:
     - integrated: 1326 ms and 1366 ms
     - base: 1358 ms and 1452 ms
     - Both are far below the 5000 ms limit.
   - Task E modifies `database-card-drawer.ts`, which is the class under test.
   - The B, D and E agents report the same timeout on clean HEAD under load. That is secondhand evidence.
   - Another session was running gates on this machine at the same time.
   - Verdict: not reproduced on base by me. I have no evidence that the change slows the test itself. Whether the folder-run timeout comes from load or from the change is unresolved.
3. **i18n: 139 failures, all traced to the one new key `tools.database.noValueGroup`.**
   - `git diff 665c077a -- en.json` shows only that one added line.
   - Breakdown:
     - `untranslated-strings.test.ts`: 68 failures, "<loc> contains every English key". Each says `missing 1 key(s): expected [ 'tools.database.noValueGroup' ]` (68 matches).
     - `translation-guidelines.test.ts`: 68 failures, "<loc> satisfies structural translation rules". Their diffs list only `"tools.database.noValueGroup"`.
     - `translation-guidelines.test.ts`: 1 failure, "en locale progress and retention evidence internally consistent". It reports `en: first-pass digest does not match current dictionary` / `second-pass evidence does not match`. The en dictionary digest changed because of that one en.json line.
     - `taiwan-traditional-chinese.test.ts`: 2 failures, the key list and `tools.database.noValueGroup: expected {property}, received {}`.
   - Every `-`/`+` diff line in the output names `tools.database.noValueGroup` (69 `-` lines, 68 `+` lines), apart from the 2 en-digest lines and the zh-TW placeholder line.
   - **Measured proof:** I reset only `en.json` to `665c077a` in the integrated tree and ran the 3 failing files serially:
     - `untranslated-strings`: 183 passed
     - `translation-guidelines`: 6545 passed
     - `taiwan-traditional-chinese`: 8 passed
     - That is 0 failures. Then I restored `en.json`, and `git status` was clean. So all 139 failures trace to the one en.json line.
   - Not translated, as instructed. The en review digest must also be refreshed when the translations land.

`dbp-base` was removed with `git worktree remove --force` + `git worktree prune`.

---

## E2E risk (not run)

Specs that reference `database` (`grep -rl database test/playwright`, 25 files plus `fixtures/test.html`):
- accessibility/semantic-contracts, accessibility/tools-axe
- tools/columns-blocks/column-list-rejects-rogue-child, database-drop-lifecycle-in-column, database-in-column, table-drop-lifecycle-in-column, table-in-column
- tools/container-undo-redo-orphan-matrix
- ui/content-max-width-honored, database-board-pill-width, database-card-hover-actions, database-pill-title-edit, database-property-type-menu-anchor, database-single-view-tab-bar, rtl-math-and-widgets, rtl-portal-flip, rtl-tool-chrome, toolbar-stretched-block-position, toolbox-preview
- undo-audit/containers, gestures, redo-loss, w4-database, w4-menu, xbrowser

C1 renders the no-value column first, even when it is empty. The D test above proves this in the unit suite: 4 columns with no empty rows.

The flagged specs:

- **undo-audit/gestures.spec.ts, GES-7: WILL BREAK.**
  - The drop target is `locator('[data-blok-database-column]').nth(1)`, intended as "Done". Now `nth(1)` is "Todo", the card's own column.
  - The expectations are 2-column arrays (`[[], ['row-2…','row-1…']]`, `[['row-1…'], ['row-2…']]`) built by `boardCards` (line 282). That helper maps every column, so it now returns 3 arrays.
  - It asserts that the 2nd column is a real option, and implicitly that the first one is too.
  - Fix: target `[data-option-id="opt-done"]` and expect a leading `[]`.
- **undo-audit/containers.spec.ts (`boardCards` at 257): CON-9 and CON-10 WILL BREAK. CON-11 goes vacuous.**
  - CON-9: `(await boardCards(page))[0]` is expected to be `['row-1:Card one']` ("Todo column"). Index 0 is now the empty no-value column.
  - CON-10: `afterAdd[0]` is expected to have length 2. Same cause.
  - CON-11: `[0]` is expected to equal `[]`. The empty no-value column makes it pass without checking Todo.
  - Fix: index `[1]`, or select by `data-option-id`.
- **undo-audit/w4-database.spec.ts (`screen().columns` at 114): does NOT assert that the first column is a real option.**
  - It compares the snapshot before and after undo/redo (`s0`/`s1`), and every gesture finds columns by `data-option-id`. The extra leading column appears in both snapshots.
  - Behaviour risk, unverified: W4D-C3 "deleting a board column with its card" now exercises C3 (row kept and moved to no-value, then a rerender), not row deletion. Its undo must restore the row's property and the option in one step. W4D-C4 drags Done before Todo, which is now after the no-value column.
- **ui/rtl-math-and-widgets.spec.ts:244: does NOT assert that the column is a real option.**
  - It measures only where the `first()` column starts against the board's inline-start inset. That column is now the no-value column.
  - It passes as long as the no-value column uses the same column layout (unverified, not run).

Other positional column locators: `grep` over test/playwright/tests for `first()/nth(/last()/[0]/[1]` on database column selectors finds only the two above (rtl-math:244, gestures:445). `database-pill-title-edit` finds pills by text.
