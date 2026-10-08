# Database Phase 0: Foundations and Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the shipped database defects, make saves forward-compatible, and apply the saved filters and sorts through an in-memory query engine, so every later Notion-parity view builds on a correct base.

**Architecture:** Fixes stay inside `src/tools/database/`. A new pure module, `database-query.ts`, implements the architecture doc's `queryRows`/`queryGroups` shape over in-memory rows. The board and the list read from it. Grouping lives in the model behind `groupKeysOf(propertyId)`, which now handles empty values (a "No ⟨property⟩" group) and multi-select.

**Tech Stack:** TypeScript, Vitest + jsdom, Playwright (e2e), Yjs (collab), Blok i18n.

**Spec:** `00-spec-and-roadmap.md` in this folder. Read its "Constraints" and "Decisions" sections first.

## How this plan was verified

Every task below was drafted by an agent in its own worktree at `665c077a`. Each agent wrote the test, watched it fail (the failure message is quoted in Step 2), wrote the fix and watched it pass. A separate agent then applied all tasks in the order below in one worktree and recorded every conflict. The results are in `phase-0-artifacts/INTEGRATION-NOTES.md`. The combined result is `phase-0-artifacts/phase0.bundle` (one commit per task) and `INTEGRATED.diff`. D5 and F were drafted on top of that bundle; their diffs are `D5-resort.diff` and `F-final.diff`. D5 applies on the bundle head, F applies after D5, and D + D5 + F together pass `test/unit/tools/database` (1238 tests), ESLint and tsc. The per-task diffs are in the same folder.
- The combined tree passes tsc (0 errors), ESLint on all changed files, `test/unit/tools/database` (1230 tests), `test/unit/styles` (718) and `test/unit/playground` (736).
- The known reds are listed under Review Focus.
- E2E was **not** run, because port 4444 was busy with another session's gates. Task F covers it.

The code in the tasks is real and was run. Line numbers refer to `665c077a`. They shift as earlier tasks land, so match on the quoted code, not the number.

## Step 0: check the base before starting

Everything was proven at `665c077a`, and `main` has moved since. Before Task A, in a fresh worktree on current `origin/main`:
- Fetch `phase-0-artifacts/phase0.bundle`. It holds commits A, B, E, C, D, resolved against each other.
- Cherry-pick those commits onto `origin/main`, then apply `D5-resort.diff` and then `F-final.diff`.
- Don't apply the per-task diffs (`A-…`, `B-…`, `C-…`, `D-…`, `E-…`) one after another. Each was cut against bare `665c077a`, and D conflicts with C.
- If anything fails to apply, resolve it and record the new conflicts in this section before executing.
- This check only tells you where the code lands. Executors still follow each task test-first.

## Execution order

**A → B1 → B2 → E1 → E2 → E3 → E4 → C1 → C2 → C3 → D1 → D2 → D3 → D4 → D5 → F.**

- **D after C.** D3 and D4 conflict with C. The resolutions are in the "Integration: D after C" section right after Task D4, and they are mandatory. One of them is silent: git applies it "cleanly", but it calls a method C renamed.
- **Gates.** C3, D4 and E2 are gated on user decisions D9, D7 and D10 in the spec. If a decision goes the other way, skip that task or step and apply the noted alternative.

## Global Constraints

- **TDD is mandatory** (repo CLAUDE.md): write the failing test, watch it fail, then fix.
- **Scope test and lint runs to the files you changed.** `yarn lint` and `yarn test` run once at the end, as the final gate (Task F).
- **Unit tests:** `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`. No `any`, `@ts-ignore` or `!`.
- **E2E:** no CSS class selectors. Use `data-blok-testid`, `data-option-id` or roles.
- **Comments:** only where they record what silently breaks if the code changes. Short, simple words.
- **No new blue selected states.** Hints show only on hover, after a delay. Reuse icons before drawing new ones.
- **i18n:** every new string goes through `tools.database.*` and the blok-translations skill, covering all locales.
- **Commits:** `git add` explicit paths only. Check `git status` first, because other sessions share this tree; never `commit -a`. Notify any peer session running gates before committing to main.
- **BREAKING:** use a `BREAKING` subject plus a `BREAKING CHANGE:` body (CLAUDE.md format). That applies to C3 (if D9 is accepted) and E2 (if D10 is accepted). Tell the user in the reply when you make the change.
- **No saved-data shape change in Phase 0.** `FilterConfig`, `SortConfig` and `DatabaseViewConfig` stay as shipped.

## Review Focus

These are the five failure modes most likely to bite a user. Each is pinned by a test in the task named:
1. **Re-sort and re-filter after a peer or undo edit.** On a view sorted or filtered by title, a peer rename takes the in-place retitle path, so the order goes stale (measured: `['Z','B']`). Task D introduced this, and Task D5 fixes it with two tests.
2. **A row created in a filtered view drops out on the next redraw.** That redraw can be a peer edit, an undo or a view switch. Task F2 makes new rows inherit the view's `equals` filter values, as Notion does (`research/03` §1.5).
3. **Undo across a column delete.** With C3, deleting a column clears values instead of deleting rows. One undo must restore both the option and every row's value. Task F4 says what to check in W4D-C3 of `w4-database.spec.ts`; run it.
4. **A peer re-sort during a drag on a sorted board.** Task F3 adds a guard test. It passed at once, and it fails when the redraw hold during a drag is removed.
5. **Old clients and the no-value column.** A v1.16.1 client opening a document saved by Phase 0 shows no no-value column, and its column delete still deletes rows. This goes in the release notes; there is no code change.

Known red that is not a Phase 0 regression: `database-card-drawer-tab-sync.test.ts` can time out under load. A cold editor import (~1.7s alone) runs into vitest's default 5s test timeout. In 4 runs each it failed 0 times on HEAD and 0 on base, and the durations overlapped. Task F1 raises that test's timeout.

---

### Task A: Read-only stays read-only after every rerender

**Files:**
- Modify: `src/tools/database/index.ts:1729-1777` (`rerenderView`, its tail; lines 1774-1775 before the change)
- Modify: `src/tools/database/database-tab-bar.ts:151-191` (the `contextmenu`, `dblclick` and `pointerdown` listeners in `render()`)
- Test: `test/unit/tools/database/database.test.ts`: new `describe('read-only after a rerender')`, inserted right before `describe('getToolbarAnchorElement')` (line ~2990 at HEAD 665c077a)
- Test: `test/unit/tools/database/database-tab-bar.test.ts`: new cases appended inside the existing `describe('read-only mode')` (after line ~910)

**Interfaces:**
- Consumes: `DatabaseTool.readOnly`, set by the constructor and by `setReadOnly`. `DatabaseTabBar.readOnly`, set by the constructor and by `setReadOnly` (tab-bar.ts:625-643).
- Produces: no new API. The behaviour contract becomes:
  - **Database.** A read-only database wires none of these: click delegation, card/column/list drags, column controls, the keyboard handler, the card drawer. This now holds on every paint path: `render()`, `switchView()` and now `rerenderView()`.
  - **Tab bar.** A read-only tab bar still switches views (click, keyboard, overflow dropdown). It does not open the rename/duplicate/delete menu, and it does not start a reorder drag.
- No published surface changes. Only `src/` internals change, so there is no BREAKING label.

**Decision: drawer in read-only (left open, follow-up task).**

Current contract, read from the code:
- `render()` (index.ts:171-174) and `switchView()` (index.ts:743-746) skip `attachViewListeners` and `initSubsystems` when read-only.
- So at first paint, a read-only database cannot open the drawer. Only `rerenderView` wired it, and that was the defect.

Signs the drawer was meant to open in read-only:
- The drawer takes a `readOnly` option (card-drawer.ts:24, 259, 588, 813).
- `handleRowClick` has a `!this.readOnly` branch (index.ts:1589).
- Today both are reachable only through the buggy rerender path.

Notion lets viewers open a row page to read it (research/06). Shipping that is a feature, not a fix. It needs three changes:
- Wire it in all three paint paths.
- Split `attachViewListeners` into read listeners (row click → drawer) and write listeners (add/delete/menu).
- Keep drags, column controls and the column-header rename unwired.

Task A makes all three paths agree on "inert". **Proposed follow-up task: "Read-only viewers can open a row page".** Its first failing test is Task A's drawer assertion, reversed.

- [ ] **Step 1: Write the failing test**

`test/unit/tools/database/database.test.ts`, inserted before `describe('getToolbarAnchorElement', ...)`:

```ts
  describe('read-only after a rerender', () => {
    const makeBoardRows = (): BlockAPI[] => [
      createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
    ];

    const getCard = (element: HTMLElement): HTMLElement => {
      const card = queryByData(element, 'data-row-id', 'row-1');

      if (card === null) {
        throw new Error('card missing');
      }

      return card;
    };

    it('entering read-only leaves cards inert: no drag start, no drawer', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { childBlocks: makeBoardRows() }));
      const element = tool.render();

      tool.rendered();
      tool.setReadOnly(true);

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer')).toBeNull();
      expect(notPrevented).toBe(true);

      tool.destroy();
    });

    it('rows that arrive after a read-only boot stay inert: no drag start, no drawer', () => {
      const options = createDatabaseOptions({}, {}, { readOnly: true });

      (options.api.blocks.getChildren as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValue(makeBoardRows());

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer')).toBeNull();
      expect(notPrevented).toBe(true);

      tool.destroy();
    });

    it('leaving read-only wires cards again', () => {
      const tool = new DatabaseTool(createDatabaseOptions({}, {}, { readOnly: true, childBlocks: makeBoardRows() }));
      const element = tool.render();

      tool.rendered();
      tool.setReadOnly(false);

      const notPrevented = fireEvent.pointerDown(getCard(element), { clientX: 0, clientY: 0 });

      getCard(element).click();

      expect(queryByData(element, 'data-blok-database-drawer')).not.toBeNull();
      expect(notPrevented).toBe(false);

      tool.destroy();
    });
  });
```

`test/unit/tools/database/database-tab-bar.test.ts`, appended inside `describe('read-only mode', ...)` after the `setReadOnly(false) shows the + button` case:

```ts

    const twoViews = (): DatabaseViewConfig[] => [
      makeView({ id: 'v1', position: 'a0' }),
      makeView({ id: 'v2', position: 'a1' }),
    ];

    // The tool flips a live bar with setReadOnly, so both ways must hold.
    const readOnlyBars: Array<[string, () => DatabaseTabBar]> = [
      ['constructed read-only', () => new DatabaseTabBar({
        views: twoViews(),
        activeViewId: 'v1',
        onTabClick,
        onAddView,
        onRename,
        onDuplicate,
        onDelete,
        onReorder,
        readOnly: true,
      })],
      ['switched to read-only', () => {
        const bar = createTabBar(twoViews(), 'v1');

        bar.setReadOnly(true);

        return bar;
      }],
    ];

    it.each(readOnlyBars)('%s: right-click opens no tab menu', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')).toBeNull();
      bar.destroy();
      el.remove();
    });

    it.each(readOnlyBars)('%s: double-click opens no tab menu', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')).toBeNull();
      bar.destroy();
      el.remove();
    });

    it.each(readOnlyBars)('%s: dragging a tab does not reorder', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 15 }));
      expect(onReorder).not.toHaveBeenCalled();
      expect(document.querySelector('[data-blok-database-tab-ghost]')).toBeNull();
      bar.destroy();
      el.remove();
    });

    it.each(readOnlyBars)('%s: clicking a tab still switches views', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v2"]') as HTMLElement;
      tab.click();
      expect(onTabClick).toHaveBeenCalledWith('v2');
      bar.destroy();
      el.remove();
    });

    it('leaving read-only brings the tab menu back', () => {
      const bar = createTabBar(twoViews(), 'v1');
      bar.setReadOnly(true);
      bar.setReadOnly(false);
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')).not.toBeNull();
      bar.destroy();
      el.remove();
    });
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
npx vitest run test/unit/tools/database/database.test.ts -t "read-only after a rerender"
```
Observed (HEAD 665c077a, no fix):
```
       × entering read-only leaves cards inert: no drag start, no drawer
       × rows that arrive after a read-only boot stay inert: no drag start, no drawer
AssertionError: expected <div …(3)>…(2)</div> to be null
      Tests  2 failed | 1 passed | 128 skipped (131)
```
- The DOM in the failure output is the drawer: `data-blok-database-drawer-content`, with a `readonly` title textarea. So a read-only database really opened the drawer.
- The drag assertion was checked on its own too. I swapped the two expects and re-ran. Both tests then failed on the drag line with `AssertionError: expected false to be true`. That means the card's `pointerdown` was `preventDefault()`ed: the drag tracker was live.
- `leaving read-only wires cards again` passes before and after the fix. It guards against over-gating.

```bash
npx vitest run test/unit/tools/database/database-tab-bar.test.ts -t "read-only mode"
```
Observed (no fix):
```
 FAIL  ... read-only mode > constructed read-only: right-click opens no tab menu
 FAIL  ... read-only mode > switched to read-only: right-click opens no tab menu
AssertionError: expected <div …(2)>…(3)</div> to be null
 FAIL  ... read-only mode > constructed read-only: double-click opens no tab menu
 FAIL  ... read-only mode > switched to read-only: double-click opens no tab menu
AssertionError: expected <div …(2)>…(3)</div> to be null
 FAIL  ... read-only mode > constructed read-only: dragging a tab does not reorder
 FAIL  ... read-only mode > switched to read-only: dragging a tab does not reorder
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  6 failed | 7 passed | 40 skipped (53)
```
`clicking a tab still switches views` and `leaving read-only brings the tab menu back` pass before and after the fix. They guard against over-gating.

- [ ] **Step 3: Minimal implementation**

```diff
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -1772,6 +1772,10 @@ export class DatabaseTool implements BlockTool {
     }
 
-    this.attachViewListeners(newBoardWrapper);
-    this.initSubsystems(newBoardWrapper);
+    // Same gate as render() and switchView(): rows arriving after boot,
+    // undo/peer reprojection and setReadOnly all rerender through here.
+    if (!this.readOnly) {
+      this.attachViewListeners(newBoardWrapper);
+      this.initSubsystems(newBoardWrapper);
+    }
   }
 }
--- a/src/tools/database/database-tab-bar.ts
+++ b/src/tools/database/database-tab-bar.ts
@@ -149,5 +149,9 @@ export class DatabaseTabBar {
     });
 
+    // Read-only is read at event time: setReadOnly flips a live bar.
     bar.addEventListener('contextmenu', (e: MouseEvent) => {
+      if (this.readOnly) {
+        return;
+      }
       const target = e.target as HTMLElement;
       const tab = target.closest('[data-blok-database-tab]');
@@ -164,4 +168,7 @@ export class DatabaseTabBar {
 
     bar.addEventListener('dblclick', (e: MouseEvent) => {
+      if (this.readOnly) {
+        return;
+      }
       const target = e.target as HTMLElement;
       const tab = target.closest('[data-blok-database-tab]');
@@ -177,4 +184,7 @@ export class DatabaseTabBar {
 
     bar.addEventListener('pointerdown', (e) => {
+      if (this.readOnly) {
+        return;
+      }
       const target = e.target as HTMLElement;
       const tab = target.closest<HTMLElement>('[data-blok-database-tab]');
```
- Gating `pointerdown` is enough to stop the reorder. `handleDragUp` is the only caller of `onReorder`, and it is registered only from that listener.
- `rerenderView` still destroys `cardDrag`, `columnDrag`, `columnControls` and `keyboard` before the new gate. In read-only those fields are left holding destroyed instances, so a later `destroy()` destroys them a second time.
- From reading the code, a second destroy is harmless:
  - card-drag and column-drag `destroy` → `cleanup()`;
  - column-controls `destroy` is a no-op;
  - keyboard `destroy` null-checks `boundKeydown`.
- No exception appeared in any of the runs below.

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run test/unit/tools/database/database.test.ts -t "read-only after a rerender"
#       Tests  3 passed | 128 skipped (131)
npx vitest run test/unit/tools/database/database-tab-bar.test.ts -t "read-only mode"
#       Tests  13 passed | 40 skipped (53)
```
Whole touched files, plus the other tests that build a read-only `DatabaseTool`:
```bash
npx vitest run test/unit/tools/database/database.test.ts                 # Tests  131 passed (131)
npx vitest run test/unit/tools/database/database-tab-bar.test.ts         # Tests  53 passed (53)
npx vitest run test/unit/tools/database/database-tab-bar.mutants.test.ts # Tests  93 passed (93)
npx vitest run test/unit/tools/database/row-page-migration.test.ts       # Tests  34 passed (34)
npx vitest run test/unit/components/block/content-direction.test.ts      # Tests  25 passed (25)
```
- There is no `database.mutants.test.ts` (checked with `ls`).
- I did not run these whole files before the fix as a separate baseline. Nothing is red after the fix.

- [ ] **Step 5: Lint changed files**

```bash
npx eslint src/tools/database/index.ts src/tools/database/database-tab-bar.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-tab-bar.test.ts
# exit 0, no output
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
# exit 0, 0 "error TS" lines
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/database/index.ts src/tools/database/database-tab-bar.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-tab-bar.test.ts
git commit -m "fix(database): keep read-only databases inert after a rerender

render() and switchView() skipped view listeners and subsystems when
read-only, but rerenderView() wired them unconditionally. Rows that
arrive after boot, undo/peer reprojection, backend load and setReadOnly
all rerender, so a read-only database got live card/column/list drags
(whose drops write row blocks) and an openable drawer.

The tab bar hid only the + button in read-only. Right-click and
double-click still opened rename/duplicate/delete, and dragging a tab
still reordered views. Those listeners now stand down while read-only;
tab clicks still switch views.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Evidence**
- **Read:**
  - `index.ts`: `render()` 140-176, `setReadOnly` 317-332, `switchView` 720-748, `attachViewListeners` 966-1050, `initSubsystems` 1196-1405, `handleRowClick` 1581-1594, `rerenderView` 1729-1777.
  - `database-tab-bar.ts` lines 1-645.
  - The `destroy()` methods of card-drag, column-drag, column-controls and keyboard.
  - A grep for `readOnly` in `card-drawer.ts`.
  - The existing read-only tests in both test files.
- **Ran:** the Step 2, 4 and 5 commands, in a detached worktree at HEAD 665c077a. The outputs quoted above are what I saw.
- **Both defects are real.**
  - `rerenderView` wired drags and drawer opening in read-only, on two paths: `setReadOnly(true)`, and a read-only boot where rows arrive in `rendered()`.
  - The tab bar ignored read-only for its menu (right-click and double-click) and for drag-reorder. This held whether the bar was built read-only or switched to it.
- **Not run directly:** the `loadFromBackend` and undo/peer reprojection triggers (index.ts:259, 509, 523). They call the same `rerenderView`, so the same gate covers them. This is code-derived.
- **Unverified, cosmetic, left out:** the overflow dropdown's "+ New view" item (tab-bar.ts ~489-503) still renders in read-only. Reading the code, it looks like a no-op there because the add button is detached. I did not run it.

---

## Section B: grouped-list add row + untitled card rename

Both defects were reproduced with failing tests in a scratch worktree at HEAD `665c077a` (2026-10-09). Full diff: `phase-0-artifacts/B-listrow-rename.diff` (same folder).

### Task B1: Add a row in a grouped list view

**Files:**
- Modify: `src/tools/database/index.ts:1088-1114` (`handleAddListRow`), the `appendRow` call at line 1107
- Read only: `src/tools/database/database-list-view.ts:81-168` (`createGroupElement` puts `[data-blok-database-add-row]` inside each `[data-blok-database-list-group]`; `appendRow` runs `container.insertBefore(rowEl, addRowBtn)`)
- Test: `test/unit/tools/database/database.test.ts`, `describe('list view')`, after `'renders grouped list when view has groupBy'` (new test at line ~2324)

**Interfaces:**
- Consumes: `DatabaseListView.appendRow(container, row)` (unchanged); list group DOM `[data-blok-database-list-group][data-option-id] > [data-blok-database-list-rows]`; `DatabaseBackendSync.syncCreateRow`
- Produces: no new surface. A click on a group's "+ New" now puts the row in that group's rows list and calls `adapter.createRow`. The flat list path is unchanged (`optionId` is `null`, so the row still goes into the wrapper before its add button).

- [ ] Step 1: Write the failing test

```ts
    it('adds a row to the end of the clicked group in a grouped list and syncs it', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, position: 'a0' }),
      ];
      const adapter: DatabaseAdapter = {
        loadDatabase: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        moveRow: vi.fn(),
        deleteRow: vi.fn(),
        createProperty: vi.fn(),
        updateProperty: vi.fn(),
        deleteProperty: vi.fn(),
        createView: vi.fn(),
        updateView: vi.fn(),
        deleteView: vi.fn(),
      };
      const data = makeListData({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
      });
      const options = createDatabaseOptions(data, { adapter }, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();

      const todoGroup = queryByData(element, 'data-option-id', 'opt-todo');

      expect(todoGroup).not.toBeNull();
      if (todoGroup === null) return;

      const addBtn = queryByData(todoGroup, 'data-blok-database-add-row');

      expect(addBtn).not.toBeNull();
      addBtn?.click();

      const rows = queryAllByData(todoGroup, 'data-blok-database-list-row');

      expect(rows).toHaveLength(2);
      expect(rows[1].getAttribute('data-row-id')).not.toBe('row-1');
      expect(rows[1].parentElement?.hasAttribute('data-blok-database-list-rows')).toBe(true);
      await vi.waitFor(() => {
        expect(adapter.createRow).toHaveBeenCalledTimes(1);
      });
      expect(adapter.createRow).toHaveBeenCalledWith(expect.objectContaining({
        properties: expect.objectContaining({ 'prop-status': 'opt-todo' }),
      }));

      element.remove();
    });
```

- [ ] Step 2: Run, expect FAIL

`npx vitest run test/unit/tools/database/database.test.ts -t "adds a row to the end of the clicked group"`

Observed:
```
AssertionError: expected [ <div …(3)>…(2)</div> ] to have a length of 2 but got 1
 ❯ test/unit/tools/database/database.test.ts:2363:20   expect(rows).toHaveLength(2);
Vitest caught 1 unhandled error during the test run.
NotFoundError: The child can not be found in the parent.
Tests  1 failed | 128 skipped (129)
```
This confirms the inventory: `insertBefore` throws inside the click listener after `api.blocks.insertAt` has already run, so no row shows and `syncCreateRow` never runs.

- [ ] Step 3: Minimal implementation

```diff
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -1104,7 +1104,13 @@ export class DatabaseTool implements BlockTool {
       { parentId: this.block.id, position: 'end', id: rowData.id },
     );
     this.syncRowsFromBlocks();
-    this.view.appendRow(viewEl, rowData);
+
+    // A grouped list keeps its "+ New" inside each group, so the row must go into that group's rows list.
+    const groupRows = optionId === null
+      ? null
+      : viewEl.querySelector(`[data-blok-database-list-group][data-option-id="${optionId}"] [data-blok-database-list-rows]`);
+
+    this.view.appendRow(groupRows instanceof HTMLElement ? groupRows : viewEl, rowData);
 
     void this.sync.syncCreateRow({
       id: rowData.id,
```
The group's rows container has no add button, so `appendRow` falls to `appendChild` (end of the group).

- [ ] Step 4: Run, expect PASS

Same command. Observed: `Tests  1 passed | 128 skipped (129)`.

- [ ] Step 5: Lint changed files

`npx eslint src/tools/database/index.ts test/unit/tools/database/database.test.ts`
Observed: no output, exit 0 (run together with the B2 files).

- [ ] Step 6: Commit

```
git add src/tools/database/index.ts test/unit/tools/database/database.test.ts
git commit -m "fix(database): add a grouped list row inside the clicked group"
```

### Task B2: Rename an untitled board card

**Files:**
- Modify: `src/tools/database/database-board-view.ts:330-368` (`startCardTitleEdit`)
- Read only: `src/tools/database/database-board-view.ts:283-291` (untitled card renders `tools.database.cardTitlePlaceholder` as text plus `data-placeholder` / `data-empty`); `src/components/utils/inline-rename.ts:22-27,92-96` (input seeded with `currentValue`; empty commit falls back to `currentValue` unless `allowEmpty`)
- Test: `test/unit/tools/database/database-board-view.test.ts`, `describe('card inline title edit')`, after `'restores original title on Escape without calling onTitleEdit'` (new test at line ~430)

**Interfaces:**
- Consumes: `startInlineRename` (unchanged), `onTitleEdit(rowId, title)` callback
- Produces: no new surface. Untitled card rename input starts empty. After commit, the title div gets back `data-placeholder` and the card keeps `data-empty` when the title is empty; both drop when a title is set.

- [ ] Step 1: Write the failing test

```ts
    it('starts an untitled card rename empty and keeps the card untitled on an empty commit', () => {
      const onTitleEdit = vi.fn();
      const options = [makeOption({ id: 'opt-1' })];
      const rows = [makeRow({ id: 'row-1', properties: { title: '' } })];
      const view = new DatabaseBoardView({ readOnly: false, i18n, options, getRows: () => rows, titlePropertyId: 'title', onTitleEdit });
      const board = view.createView();
      const cardEl = board.querySelector('[data-blok-database-card]') as HTMLElement;
      const editBtn = cardEl.querySelector('[data-blok-database-edit-card]') as HTMLElement;

      editBtn.click();

      const input = cardEl.querySelector<HTMLInputElement>('[data-blok-database-card-title-input]');

      expect(input?.value).toBe('');
      if (input === null) return;

      simulateKeydown(input, 'Enter');

      expect(onTitleEdit).not.toHaveBeenCalled();

      const titleDiv = cardEl.querySelector('[data-blok-database-card-title]');

      expect(titleDiv?.textContent).toBe('tools.database.cardTitlePlaceholder');
      expect(titleDiv?.hasAttribute('data-placeholder')).toBe(true);
      expect(cardEl.hasAttribute('data-empty')).toBe(true);
    });
```
(The file's mock i18n returns the key, so the placeholder text is the key.)

- [ ] Step 2: Run, expect FAIL

`npx vitest run test/unit/tools/database/database-board-view.test.ts -t "starts an untitled card rename empty"`

Observed:
```
AssertionError: expected 'tools.database.cardTitlePlaceholder' to be '' // Object.is equality
 ❯ test/unit/tools/database/database-board-view.test.ts:443:28   expect(input?.value).toBe('');
Tests  1 failed | 75 skipped (76)
```

- [ ] Step 3: Minimal implementation

```diff
--- a/src/tools/database/database-board-view.ts
+++ b/src/tools/database/database-board-view.ts
@@ -334,13 +334,20 @@ export class DatabaseBoardView implements DatabaseViewRenderer {
       return;
     }
 
-    const originalTitle = titleEl.textContent ?? '';
+    // An untitled card shows placeholder text; it must not seed the input or count as the old title.
+    const originalTitle = titleEl.hasAttribute('data-placeholder') ? '' : titleEl.textContent ?? '';
 
     const buildTitleDiv = (title: string): HTMLElement => {
       const div = document.createElement('div');
 
       div.setAttribute('data-blok-database-card-title', '');
-      div.textContent = title;
+
+      if (title) {
+        div.textContent = title;
+      } else {
+        div.textContent = this.i18n.t('tools.database.cardTitlePlaceholder');
+        div.setAttribute('data-placeholder', '');
+      }
 
       return div;
     };
@@ -360,9 +367,7 @@ export class DatabaseBoardView implements DatabaseViewRenderer {
           this.onTitleEdit?.(rowId, newTitle);
         }
 
-        if (newTitle) {
-          cardEl.removeAttribute('data-empty');
-        }
+        cardEl.toggleAttribute('data-empty', newTitle === '');
       },
     });
   }
```
`allowEmpty` stays off on purpose: clearing a titled card still keeps its old title, as before.

- [ ] Step 4: Run, expect PASS

Same command. Observed: `Tests  1 passed | 75 skipped (76)`.

- [ ] Step 5: Lint changed files

`npx eslint src/tools/database/index.ts src/tools/database/database-board-view.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-board-view.test.ts`
Observed: no output, `eslint exit: 0`.

- [ ] Step 6: Commit

```
git add src/tools/database/database-board-view.ts test/unit/tools/database/database-board-view.test.ts
git commit -m "fix(database): keep an untitled card untitled after an empty rename"
```

### Evidence

- **B1 is real.** The failing run printed `NotFoundError: The child can not be found in the parent.` as an unhandled error, and the group still had 1 row. After the fix the test passes. That includes `adapter.createRow` being called with `prop-status: 'opt-todo'`.
- **B2 is real, but narrower than the inventory says.** A probe test at HEAD, run before the fix, covered two commits on an untitled card: Enter as-is, and Enter after clearing the input. Both gave `{"calls":[],"text":"tools.database.cardTitlePlaceholder","ph":false,"empty":false}`.
  - `onTitleEdit` was **not** called, so the placeholder is **not** saved as a real title in the data. That part of the inventory's claim was not reproduced.
  - What does break is only in the DOM. The input starts with the placeholder text. After commit, the card shows the placeholder as if it were a real title: `data-placeholder` is gone, and `data-empty` is removed too, because the `if (newTitle)` branch sees the truthy placeholder.
  - Nothing is saved, but a later rename with the old code would treat the placeholder as `originalTitle` (from reading the code; not tested).
- **Full touched files after both fixes** (summary lines):
  - `database.test.ts`: 129 passed
  - `database-board-view.test.ts`: 76 passed
  - `database-board-view.mutants.test.ts`: 29 passed
  - `database-list-view.test.ts`: 41 passed
  - `database-list-view.mutants.test.ts`: 23 passed
  - `database-view.test.ts`: 55 passed
  - `database-view.mutants.test.ts`: 12 passed
  - There is no `database.mutants.test.ts`.
- **Whole `test/unit/tools/database` + `test/unit/tools/database-row`:**
  - First run: 1 failed / 1118 passed. The failure was `database-card-drawer-tab-sync.test.ts > the nested card editor opens no tab-sync channel`.
  - That file passed alone both with and without these changes (checked via stash in the scratch worktree).
  - Second full run: 36 files / 1119 tests passed. So it is a flaky test, not caused by this change.
- **Follow-up, from reading the code (not tested here):** `createGroupElement` sets `[data-blok-database-list-group-count]` only once, and `DatabaseListView.appendRow` never updates it. So the group count stays stale after B1 adds a row. The board view's `appendRow` does update its count (`updateColumnCount`). This is out of scope for B1 and should be decided separately.

---

## Phase 0 — Compatibility and hygiene (Tasks E1–E4)

All four tasks were run test-first in a worktree at `665c077a`. The full patch is in `phase-0-artifacts/E-compat.diff`, next to this file. Every hunk below is copied from that patch.

Evidence for the whole section, from the final runs after all four tasks:
- `npx vitest run test/unit/tools/database/`: 35 files, 1087 tests passed. An earlier run had one red: `database-card-drawer-tab-sync.test.ts › the nested card editor opens no tab-sync channel`. It passed alone and on the next directory run, so it is a load flake, not caused by this work.
- `npx vitest run test/unit/playground/`: 32 files, 736 tests passed.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`: exit 0, 0 errors. This compiles the new `*-typecheck.ts` file too.
- ESLint on every changed `.ts` file: exit 0. `types/tools/database.d.ts` is ignored by the ESLint config.
- `npx vitest run test/unit/styles/`: 54 files, 716 passed. This includes `database-content-max-width`, `database-table-radius`, `notifier-card-motion`, `selected-state-neutral` and `css-split-equivalence`.
- Every other unit file that reads `database.css` / `main.css` / `src/styles` (`grep -rl … test/unit | grep -v test/unit/styles/`, 15 files) was run one at a time:
  - 14 are green.
  - `test/unit/build/bundle-outputs.test.ts` reports "no tests". I did not check why; a missing build is a guess.
- `css-logical-properties-law`: 3 passed.

---

### Task E1: Forward-compatible database save

**Files:**
- `src/tools/database/index.ts`:
  - module scope after `INTERACTION_END_EVENTS` (~:47)
  - field list (~:73)
  - constructor (~:109)
  - `save()` (~:274-282)
- `src/tools/database/database-model.ts`: `updateProperty` (~:68-74)
- `test/unit/tools/database/database.test.ts`: `describe('save()')` (~:476-580)
- `test/unit/tools/database/database-model.test.ts`: `describe('Schema')`, after `updateProperty merges partial changes` (~:125-158)

**Interfaces:**
- Consumes: the `DatabaseData` the tool is built with (`BlockToolConstructorOptions<DatabaseData>.data`), and the `{ config: { options } }` changes from the five option paths in `index.ts`. Those paths are add column ~:1196, rename ~:1556, rename-commit ~:1254, reorder ~:1502, delete ~:1589.
- Produces:
  - `save()` returns `{ ...unknownTopLevelKeys, ...model.snapshot(), title, activeViewId }`.
  - `DatabaseModel.updateProperty` merges `config` (`{ ...prop.config, ...changes.config }`) instead of replacing it.
  - No public type changes.

Why both halves are needed:
- `save()` used to spread only `model.snapshot()`, which is `schema / views / activeViewId`.
- `updateProperty` used to replace `config` whole, so any column add, rename, delete or reorder dropped a key that sat beside `options`.
- The row tool already keeps unknown keys (`src/tools/database-row/index.ts:7-15, 54-75`). E1 copies that pattern.
- The database tool has no `setData`. `grep -n "setData" src/tools/database/index.ts` finds nothing, so an undo/peer change recreates the block and the constructor is the only intake path.
- The unknown keys live on the tool, not the model, so `hydrate()` cannot touch them.
- `DatabaseBackendSync.syncLoadDatabase` is typed to return only `{ schema, views }` (`database-backend-sync.ts:32`). A backend snapshot therefore brings no top-level keys of its own.

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/test/unit/tools/database/database-model.test.ts b/test/unit/tools/database/database-model.test.ts
index 77025d89..9a1c6f4d 100644
--- a/test/unit/tools/database/database-model.test.ts
+++ b/test/unit/tools/database/database-model.test.ts
@@ -134,6 +134,28 @@ describe('DatabaseModel', () => {
       expect(model.getProperty('p1')?.config?.options).toHaveLength(1);
     });
 
+    describe('a config key written by a newer client', () => {
+      const todo = makeSelectOption({ id: 'o1', label: 'Todo', position: 'a0' });
+      const done = makeSelectOption({ id: 'o2', label: 'Done', position: 'a1' });
+
+      it.each([
+        { action: 'option add', options: [todo, done, makeSelectOption({ id: 'o3', label: 'New', position: 'a2' })] },
+        { action: 'option rename', options: [{ ...todo, label: 'Later' }, done] },
+        { action: 'option delete', options: [done] },
+        { action: 'option reorder', options: [{ ...done, position: 'Zz' }, todo] },
+      ])('survives an $action', ({ options }) => {
+        const config = { options: [todo, done], futureConfigKey: { limit: 3 } };
+        const model = new DatabaseModel(makeData({
+          schema: [makeProperty({ id: 'p1', name: 'Status', type: 'select', config })],
+        }));
+
+        model.updateProperty('p1', { config: { options } });
+
+        expect(model.getProperty('p1')?.config).toHaveProperty('futureConfigKey', { limit: 3 });
+        expect(model.getProperty('p1')?.config?.options).toEqual(options);
+      });
+    });
+
     it('deleteProperty removes from schema', () => {
       const prop = makeProperty({ id: 'p1', name: 'Notes', type: 'text' });
       const titleProp = makeProperty({ id: 'pt', name: 'Title', type: 'title', position: 'a0' });
diff --git a/test/unit/tools/database/database.test.ts b/test/unit/tools/database/database.test.ts
index 225944fa..d08c450a 100644
--- a/test/unit/tools/database/database.test.ts
+++ b/test/unit/tools/database/database.test.ts
@@ -522,6 +522,61 @@ describe('DatabaseTool', () => {
 
       expect(saved.title).toBe('Updated title');
     });
+
+    it('keeps a top-level key written by a newer client', () => {
+      const futureKey = { layout: 'timeline', nested: { since: 'v2' } };
+      const tool = new DatabaseTool(createDatabaseOptions({ futureKey }));
+
+      tool.render();
+
+      const saved = tool.save(document.createElement('div'));
+
+      expect(saved.futureKey).toEqual(futureKey);
+    });
+
+    it('lets its own known keys win over a stale value of the same name', () => {
+      const tool = new DatabaseTool(createDatabaseOptions({ title: 'Stored', futureKey: 1 }));
+      const element = tool.render();
+      const titleEl = queryByData(element, 'data-blok-database-title');
+
+      if (titleEl === null) {
+        throw new Error('title element missing');
+      }
+      titleEl.textContent = 'Typed';
+
+      const saved = tool.save(document.createElement('div'));
+
+      expect(saved.title).toBe('Typed');
+      expect(saved.futureKey).toBe(1);
+      expect(Object.keys(saved).sort()).toEqual(['activeViewId', 'futureKey', 'schema', 'title', 'views']);
+    });
+
+    it('keeps a newer client key after the backend snapshot hydrates the model', async () => {
+      const mockAdapter = {
+        loadDatabase: vi.fn().mockResolvedValue({
+          schema: [{ id: 'p-backend', name: 'Backend Title', type: 'title', position: 'a0' }],
+          views: [{ id: 'v-backend', name: 'Backend Board', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
+        }),
+        createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
+        createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
+        createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn(),
+      };
+      const tool = new DatabaseTool(createDatabaseOptions({ futureKey: 'kept' }, { adapter: mockAdapter }));
+      const container = document.createElement('div');
+
+      container.appendChild(tool.render());
+      document.body.appendChild(container);
+      tool.rendered();
+
+      await vi.waitFor(() => {
+        expect(tool.save(document.createElement('div')).schema[0].id).toBe('p-backend');
+      });
+
+      expect(tool.save(document.createElement('div')).futureKey).toBe('kept');
+
+      tool.destroy();
+      container.remove();
+    });
   });
 
   describe('validate()', () => {
```

- [ ] **Step 2: Run, expect FAIL**

`npx vitest run test/unit/tools/database/database.test.ts -t "newer client|known keys win"`, observed:
```
× keeps a top-level key written by a newer client
  AssertionError: expected undefined to deeply equal { layout: 'timeline', …(1) }
× lets its own known keys win over a stale value of the same name
  AssertionError: expected undefined to be 1
× keeps a newer client key after the backend snapshot hydrates the model
  AssertionError: expected undefined to be 'kept'
Tests  3 failed | 128 skipped (131)
```
`npx vitest run test/unit/tools/database/database-model.test.ts -t "newer client"`, observed:
```
× survives an 'option add' / 'option rename' / 'option delete' / 'option reorder'
  AssertionError: expected { options: [ …(3) ] } to have property "futureConfigKey" with value { limit: 3 }
Tests  4 failed | 45 skipped (49)
```

- [ ] **Step 3: Minimal implementation**

```diff
diff --git a/src/tools/database/database-model.ts b/src/tools/database/database-model.ts
index 2c1c9aa8..ff2486bb 100644
--- a/src/tools/database/database-model.ts
+++ b/src/tools/database/database-model.ts
@@ -69,7 +69,8 @@ export class DatabaseModel {
     const prop = this.schema.find((p) => p.id === propertyId);
     if (prop === undefined) return;
     if (changes.name !== undefined) prop.name = changes.name;
-    if (changes.config !== undefined) prop.config = changes.config;
+    // Merge, not replace: a newer client's key beside `options` must outlive every option edit.
+    if (changes.config !== undefined) prop.config = { ...prop.config, ...changes.config };
   }
 
   deleteProperty(propertyId: string): void {
diff --git a/src/tools/database/index.ts b/src/tools/database/index.ts
index 85caf741..ad9be16a 100644
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -46,6 +46,16 @@ const changedBlock = (payload: unknown): ChangedBlock | undefined =>
 /** Events that can end an inline edit or a drag. */
 const INTERACTION_END_EVENTS = ['focusout', 'pointerup', 'pointercancel', 'keyup'] as const;
 
+const KNOWN_KEYS: ReadonlySet<string> = new Set(['title', 'schema', 'views', 'activeViewId']);
+
+/**
+ * Top-level keys this version does not know, kept as they came. A full save
+ * prunes every key it leaves out from the shared document, so dropping a
+ * newer version's key here would delete it for every client.
+ */
+const unknownKeys = (data: DatabaseData | undefined): Record<string, unknown> =>
+  Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => !KNOWN_KEYS.has(key)));
+
 /**
  * DatabaseTool — a multi-view Kanban board block tool for Blok.
  *
@@ -61,6 +71,7 @@ export class DatabaseTool implements BlockTool {
   private readonly config: DatabaseConfig;
 
   private title: string;
+  private readonly unknown: Record<string, unknown>;
   private activeViewId: string;
   private model: DatabaseModel;
   private view!: DatabaseViewRenderer;
@@ -96,6 +107,7 @@ export class DatabaseTool implements BlockTool {
     this.config = config ?? {};
 
     this.title = (data as DatabaseData | undefined)?.title ?? '';
+    this.unknown = unknownKeys(data);
     this.model = new DatabaseModel(data);
     const views = this.model.getViews();
     this.activeViewId = (data as DatabaseData | undefined)?.activeViewId ?? (views.length > 0 ? views[0].id : '');
@@ -263,6 +275,7 @@ export class DatabaseTool implements BlockTool {
     const currentTitle = this.titleElement?.textContent ?? this.title;
 
     return {
+      ...structuredClone(this.unknown),
       ...this.model.snapshot(),
       title: currentTitle,
       activeViewId: this.activeViewId,
```

- [ ] **Step 4: Run, expect PASS**
- The same two commands: `Tests 3 passed | 128 skipped`, then `Tests 4 passed | 45 skipped`.
- Touched and related files: `database.test.ts`, `concurrent-database-loss.test.ts`, `concurrent-database-loss-wave2.test.ts`, `concurrent-row-body.test.ts`, `row-page-migration.test.ts`. Result: 5 files, 201 passed.
- Files that reference `DatabaseTool` from outside the folder:
  - `column-database-placement.characterization.integration.test.ts`: 9 passed
  - `container-blocks.test.ts`: 34 passed
  - `sanitize-blocks.test.ts`: 31 passed
  - `tab-sync-dispatch-paths.test.ts`: 2 passed

- [ ] **Step 5: Lint**

`npx eslint src/tools/database/index.ts src/tools/database/database-model.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-model.test.ts`: clean.

The first draft wrote `unknownKeys(data as DatabaseData | undefined)` and drew `@typescript-eslint/no-unnecessary-type-assertion`. The hunk above already passes `data` directly.

- [ ] **Step 6: Commit**
```
git add src/tools/database/index.ts src/tools/database/database-model.ts \
  test/unit/tools/database/database.test.ts test/unit/tools/database/database-model.test.ts
git commit -m "fix(database): keep keys a newer client wrote on save

Top-level DatabaseData keys this version does not know, and keys beside
options inside a property config, now survive save and every column edit.
A full save prunes keys it leaves out, so dropping them deleted a newer
client's state for everyone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Not BREAKING. No published type, key or default changes. The saved JSON only keeps keys it used to drop.

**Evidence:**
- `database-model.ts:216-222` (snapshot) and `index.ts:262-270` (save) at HEAD, read before the change.
- `updateProperty` replaced `config` at `database-model.ts:72`.
- All five option paths pass `{ config: { options } }` and nothing else. I read the code at the line numbers listed above.
- Option objects themselves are spread (`{ ...o, label }`), so unknown fields **on an option** already survived.

**Unverified:**
- Whether any shipped version wrote some other top-level key that should be pruned rather than kept. `ceb2633b` removed `rows` from the **adapter** return type only, not from `DatabaseData`. I did not audit older saved documents.
- The published `blokDocumentSchema` is strict (`additionalProperties: false`). A document that carries a newer client's key fails *this* version's schema whether or not this version keeps the key. E1 does not change that.
- The backend adapter path still sends `config: { options }` (`syncUpdateProperty`). Whether a host adapter replaces or merges `config` is host code, out of scope.

---

### Task E2: Published `DatabaseData` lacks `title`

**Files:**
- `types/tools/database.d.ts:90-94` (`DatabaseData`)
- new `test/unit/types/database-data-drift-typecheck.ts`

**Interfaces:**
- Consumes: `src/tools/database/types.ts` `DatabaseData` (it has `title?: string`, ~:87-92).
- Produces: published `DatabaseData.title?: string`.

The type-test pattern that exists in the repo:
- `test/unit/types/*-typecheck.ts` files that only need to compile.
- The `Equal` helper from `image-failure-typecheck.ts`.
- Root `tsconfig.json` includes `**/*.ts`, so `yarn lint` (`tsc --noEmit`) compiles them.

There is no harness that compares published types to `src`. `published-types-no-src-refs.test.ts` only checks for `../src` specifiers and for DATA_ATTR / icon drift. It has no database case, and it passed (122) both before and after.

A plain `keyof` comparison would pass today and hide the drift:
- Both interfaces extend `BlockToolData` = `Record<string, unknown>` (`types/tools/block-tool-data.d.ts:5`).
- So `keyof` is `string | number` on both sides.
- The test therefore strips the index signature first.

- [ ] **Step 1: Write the failing type test**

```ts
/**
 * The published DatabaseData must carry every key the tool saves.
 * Run with: tsc --noEmit --strict --skipLibCheck --ignoreConfig test/unit/types/database-data-drift-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 */

import type { DatabaseData as PublishedDatabaseData } from '../../../types/tools/database';
import type { DatabaseData as SourceDatabaseData } from '../../../src/tools/database/types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assert = <T extends true>(): T | undefined => undefined;

// Both extend Record<string, unknown>, so `keyof` is `string | number` on both sides and hides drift.
type Known<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };

assert<Equal<keyof Known<PublishedDatabaseData>, keyof Known<SourceDatabaseData>>>();
assert<Equal<PublishedDatabaseData['title'], SourceDatabaseData['title']>>();
```

- [ ] **Step 2: Run, expect FAIL**

The run command needs `--ignoreConfig`. TypeScript 6.0.3 refuses a file argument while `tsconfig.json` exists (TS5112).

`npx tsc --noEmit --strict --skipLibCheck --ignoreConfig test/unit/types/database-data-drift-typecheck.ts`, observed:
```
(17,8): error TS2344: Type 'false' does not satisfy the constraint 'true'.
(18,8): error TS2344: Type 'false' does not satisfy the constraint 'true'.
```

- [ ] **Step 3: Minimal implementation**

```diff
diff --git a/types/tools/database.d.ts b/types/tools/database.d.ts
index f2262c4f..445a1f69 100644
--- a/types/tools/database.d.ts
+++ b/types/tools/database.d.ts
@@ -88,6 +88,7 @@ export interface DatabaseViewConfig {
  * Schema and views only — rows are child blocks (database-row type).
  */
 export interface DatabaseData extends BlockToolData {
+  title?: string;
   schema: PropertyDefinition[];
   views: DatabaseViewConfig[];
   activeViewId: string;
```

- [ ] **Step 4: Run, expect PASS**
- The same command exits 0.
- `tool-subclassing-typecheck.ts`, which subclasses `Database` and returns `DatabaseData`, also exits 0.
- Full `tsc --noEmit -p tsconfig.json`: exit 0.

- [ ] **Step 5: Lint**
- `npx eslint test/unit/types/database-data-drift-typecheck.ts`: clean.
- `types/tools/database.d.ts` is ignored by the ESLint config.

- [ ] **Step 6: Commit (BREAKING, see the analysis below)**
```
git add types/tools/database.d.ts test/unit/types/database-data-drift-typecheck.ts
git commit -m "fix(types)!: BREAKING add title to published DatabaseData

The database tool has saved a string title since before v1.16.1, and the
published document schema lists it, but the published type did not.

BREAKING CHANGE: DatabaseData.title was typed unknown (via the
Record<string, unknown> base) and is now string | undefined. Old: any value
compiled, e.g. { title: 42 } or interface X extends DatabaseData
{ title: number }. New: title must be a string; under
exactOptionalPropertyTypes an explicit title: undefined is also rejected.
Migration: store the title as a string (the runtime already only reads and
writes strings), or omit the key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**BREAKING analysis (measured, judgement stated):**

I compiled a consumer probe against HEAD types and against the edited types, with `tsc --strict --skipLibCheck --ignoreConfig`:

| Consumer code | HEAD | edited |
|---|---|---|
| build `DatabaseData` without `title` | ok | ok |
| build with `title: 'x'` | ok | ok |
| read `typeof d.title === 'string' ? d.title : ''` | ok | ok |
| `{ ..., title: 42 }` | ok | **TS2322** |
| `interface X extends DatabaseData { title: number }` | ok | **TS2430** |
| `{ ..., title: undefined }` with `--exactOptionalPropertyTypes` | ok | **TS2375** |
| `const s: string = d.title ?? ''` | **TS2322** | ok (this is a fix) |

The CLAUDE.md test is "anything a consumer's `tsc` would notice". Three shapes that compiled before now fail, so by the literal rule this is **BREAKING**. Label it, and tell the user.

The break is narrow:
- It only hits code that types a non-string title, or that writes an explicit `undefined` under `exactOptionalPropertyTypes`.
- The shipped runtime already contradicts such code. v1.16.1 `save()` wrote `title: currentTitle`, a string from `textContent` (`git show v1.16.1:src/tools/database/index.ts:269`).
- The v1.16.1 published schema had `title: { type: 'string' }` (`git show v1.16.1:src/view/document-schema.ts`).

The surface predates the last tag. `git tag --sort=-v:refname | head -1` gives `v1.16.1`. `git log v1.16.1..HEAD --oneline -- types/tools/database.d.ts` printed nothing, so the file is unchanged since the release. The "never shipped" exemption does not apply.

A compatible route exists if the user prefers it: `title?: unknown` keeps every probe green but documents nothing. I do not recommend it, and the user decides.

**Unverified:** none for the probe. I did not check whether `docs/` mirrors this type.

---

### Task E3: `prefers-reduced-motion` for database.css

**Files:**
- `src/styles/database.css`: append at the end (~:1200)
- `src/tools/database/database-card-drawer.ts`:
  - module scope before `interface BlokInstance` (~:15)
  - `open()` rAF (~:316-326)
  - `close()` (~:440-446)
- `test/unit/tools/database/database-card-drawer.test.ts`: `auto-focus on empty title` (~:875) and `close animation` (~:1626)
- new `test/unit/styles/database-reduced-motion.test.ts`
- `test/unit/styles/css-split-equivalence.test.ts` (~:734, ~:790)
- `test/unit/styles/__snapshots__/main-css-rules.snap.txt`

**Interfaces:**
- Consumes: the motion rules at `database.css`:
  - :104, :108: card displacement during drag
  - :119, :123: column-reorder gap
  - :357: drawer width
  - :1133: `blok-prop-popover-in`
- Produces:
  - a reduced-motion block that sets `transition: none` on the drawer and the four displacement selectors, and `animation: none` on the property popover
  - a drawer helper that calls its callback on `transitionend` OR after a 300ms fallback, whichever comes first

**Why the drawer JS changes too (found while planning, not in the original brief):**
- `database-card-drawer.ts` waits for `transitionend` in two places:
  - `open()` focuses an empty title and auto-resizes it.
  - `close()` calls `drawer.remove()`.
- With `transition: width` removed, `transitionend` never fires. Every close would leave a 0-width fixed drawer in the DOM, and an untitled card would never get focus.
- The repo's precedent for this is a timeout fallback:
  - `src/components/utils/notifier/draw.ts:456`: "Reduced motion has no transition, so transitionend never comes."
  - `popover-abstract.ts:343` (`EXIT_ANIMATION_TIMEOUT_MS = 400`).
- The fallback keeps `{ once: true }` on the listener, because `database-card-drawer.mutants.test.ts:338-379` asserts that exact registration.

Other reduced-motion CSS in Blok uses `@media (prefers-reduced-motion: reduce) { … transition: none; }`, as in `tabs.css:286`, `popover-animation.css:254` and `main.css:144`.

There is no global rule that already stops these. `main.css`, `preflight.css` and `popover-animation.css` scope their blocks to their own selectors.

The test style copies `test/unit/styles/notifier-card-motion.test.ts`, which reads the CSS source and parses the reduced-motion block.

- [ ] **Step 1a: Failing drawer tests (the transitionend never comes)**

```diff
diff --git a/test/unit/tools/database/database-card-drawer.test.ts b/test/unit/tools/database/database-card-drawer.test.ts
index 788d8525..bac07a09 100644
--- a/test/unit/tools/database/database-card-drawer.test.ts
+++ b/test/unit/tools/database/database-card-drawer.test.ts
@@ -871,6 +871,36 @@ describe('DatabaseCardDrawer', () => {
       expect(titleInput.value).toBe('');
     });
 
+    it('focuses an empty title when no transitionend ever comes (reduced motion)', () => {
+      vi.useFakeTimers();
+
+      try {
+        const rafCallbacks: FrameRequestCallback[] = [];
+
+        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
+          rafCallbacks.push(cb);
+
+          return 0;
+        });
+
+        const options = createOptions();
+        const drawer = new DatabaseCardDrawer(options);
+
+        drawer.open(makeRow({ id: 'row-1', properties: { 'prop-title': '' } }));
+
+        const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLTextAreaElement;
+        const focusSpy = vi.spyOn(titleInput, 'focus');
+
+        rafCallbacks.forEach((cb) => cb(0));
+        vi.advanceTimersByTime(1000);
+
+        expect(focusSpy).toHaveBeenCalledTimes(1);
+        drawer.destroy();
+      } finally {
+        vi.useRealTimers();
+      }
+    });
+
     it('does not call focus() on title input when card has a title', () => {
       const rafCallbacks: FrameRequestCallback[] = [];
 
@@ -1593,6 +1623,23 @@ describe('DatabaseCardDrawer', () => {
       expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
     });
 
+    it('removes the closed drawer when no transitionend ever comes (reduced motion)', () => {
+      vi.useFakeTimers();
+
+      try {
+        const options = createOptions();
+        const drawer = new DatabaseCardDrawer(options);
+
+        drawer.open(makeRow());
+        drawer.close();
+        vi.advanceTimersByTime(1000);
+
+        expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
+      } finally {
+        vi.useRealTimers();
+      }
+    });
+
     it('isOpen returns false immediately before animation ends', () => {
       const options = createOptions();
       const drawer = new DatabaseCardDrawer(options);
```

- [ ] **Step 1b: Failing CSS test**

```ts
/**
 * Database motion must stand down under prefers-reduced-motion.
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** The inner text of every reduced-motion block. Its rules hold no nested braces. */
const reducedMotionBlocks = (): string[] =>
  [ ...source.matchAll(/@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ]
    .map((match) => match[1]);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The last value of `name` across rules whose selector list contains `selector`. */
const reducedProp = (selector: string, name: string): string | null => {
  const values = reducedMotionBlocks()
    .flatMap((block) => [ ...block.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ])
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2].match(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`)))
    .filter((match) => match !== null)
    .map((match) => match[1].trim());

  return values.at(-1) ?? null;
};

describe('database.css under prefers-reduced-motion', () => {
  it('drops the drawer width slide', () => {
    expect(reducedProp('[data-blok-database-drawer]', 'transition')).toBe('none');
  });

  it.each([
    '[data-blok-database-dragging] [data-blok-database-card]',
    '[data-blok-database-dragging] [data-blok-database-cards]',
    '[data-blok-database-column-reordering] [data-blok-database-column]',
    '[data-blok-database-column-reordering] [data-blok-database-board]',
  ])('drops the drag displacement glide on %s', (selector) => {
    expect(reducedProp(selector, 'transition')).toBe('none');
  });

  it('drops the property popover entrance animation', () => {
    expect(reducedProp('[data-blok-database-property-type-popover]', 'animation')).toBe('none');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**
- `npx vitest run test/unit/tools/database/database-card-drawer.test.ts -t "reduced motion"`:
  ```
  × focuses an empty title when no transitionend ever comes (reduced motion)
    AssertionError: expected "focus" to be called 1 times, but got 0 times
  × removes the closed drawer when no transitionend ever comes (reduced motion)
    AssertionError: expected <div …(4)>…(2)</div> to be null
  ```
- `npx vitest run test/unit/styles/database-reduced-motion.test.ts`: all 6 fail (`Tests 6 failed (6)`).

- [ ] **Step 3: Minimal implementation**

```diff
diff --git a/src/styles/database.css b/src/styles/database.css
index 3a801002..1897101c 100644
--- a/src/styles/database.css
+++ b/src/styles/database.css
@@ -1197,3 +1197,18 @@
   width: 14px;
   height: 14px;
 }
+
+/* The drawer has a timeout fallback for the transitionend this removes (database-card-drawer.ts). */
+@media (prefers-reduced-motion: reduce) {
+  [data-blok-database-drawer],
+  [data-blok-database-dragging] [data-blok-database-card],
+  [data-blok-database-dragging] [data-blok-database-cards],
+  [data-blok-database-column-reordering] [data-blok-database-column],
+  [data-blok-database-column-reordering] [data-blok-database-board] {
+    transition: none;
+  }
+
+  [data-blok-database-property-type-popover] {
+    animation: none;
+  }
+}
diff --git a/src/tools/database/database-card-drawer.ts b/src/tools/database/database-card-drawer.ts
index 6f1c4637..754dd984 100644
--- a/src/tools/database/database-card-drawer.ts
+++ b/src/tools/database/database-card-drawer.ts
@@ -12,6 +12,27 @@ import type { FieldsResolver } from '../../shared/rich-text/block-data';
 import { htmlToSegmentsDom } from '../../components/utils/rich-text-dom';
 import { declaredRichTextFields } from '../../components/tools/base';
 
+/** Must stay longer than the drawer's `transition: width` in database.css. */
+const DRAWER_TRANSITION_FALLBACK_MS = 300;
+
+/**
+ * Runs `done` once, when the drawer's width transition ends. Reduced motion
+ * turns that transition off, and then no transitionend ever comes.
+ */
+const afterWidthTransition = (drawer: HTMLElement, done: () => void): void => {
+  const state = { finished: false };
+  const finish = (): void => {
+    if (state.finished) {
+      return;
+    }
+    state.finished = true;
+    done();
+  };
+
+  drawer.addEventListener('transitionend', finish, { once: true });
+  window.setTimeout(finish, DRAWER_TRANSITION_FALLBACK_MS);
+};
+
 interface BlokInstance {
   save(): Promise<OutputData>;
   destroy(): void;
@@ -295,13 +316,13 @@ export class DatabaseCardDrawer {
 
     requestAnimationFrame(() => {
       drawer.style.width = '45%';
-      drawer.addEventListener('transitionend', () => {
+      afterWidthTransition(drawer, () => {
         this.autoResizeTitle(titleInput);
 
         if (!title) {
           titleInput.focus();
         }
-      }, { once: true });
+      });
     });
 
     this.initNestedEditor(editorHolder, row);
@@ -419,9 +440,9 @@ export class DatabaseCardDrawer {
 
       this.drawer = null;
       drawer.style.width = '0px';
-      drawer.addEventListener('transitionend', () => {
+      afterWidthTransition(drawer, () => {
         drawer.remove();
-      }, { once: true });
+      });
     }
 
     this.currentRowId = null;
```

- [ ] **Step 3b: Update the CSS budget ledger and golden snapshot.** This step is required: the new block reddens `css-split-equivalence.test.ts`.

Before this step, observed:
- `rule set + source order matches the golden snapshot`: Snapshot mismatched.
- `total local CSS byte size stays within the measured budget`: `expected 981979 to be less than or equal to 981579`.

Stashing only `database.css` made the same file pass 4/4, so the red comes from this change alone.

Then run `npx vitest run test/unit/styles/css-split-equivalence.test.ts -u`. The snapshot diff is exactly the two new rules, +8 lines.

```diff
diff --git a/test/unit/styles/__snapshots__/main-css-rules.snap.txt b/test/unit/styles/__snapshots__/main-css-rules.snap.txt
index a2fc95c9..87786d1f 100644
--- a/test/unit/styles/__snapshots__/main-css-rules.snap.txt
+++ b/test/unit/styles/__snapshots__/main-css-rules.snap.txt
@@ -4936,6 +4936,14 @@ span[data-blok-slash-search] {
   height: 14px;
 }
 
+[@media (prefers-reduced-motion: reduce)] [data-blok-database-drawer], [data-blok-database-dragging] [data-blok-database-card], [data-blok-database-dragging] [data-blok-database-cards], [data-blok-database-column-reordering] [data-blok-database-column], [data-blok-database-column-reordering] [data-blok-database-board] {
+  transition: none;
+}
+
+[@media (prefers-reduced-motion: reduce)] [data-blok-database-property-type-popover] {
+  animation: none;
+}
+
 .blok-media-empty {
   display: flex;
   flex-direction: column;
diff --git a/test/unit/styles/css-split-equivalence.test.ts b/test/unit/styles/css-split-equivalence.test.ts
index b8b79431..422e9d01 100644
--- a/test/unit/styles/css-split-equivalence.test.ts
+++ b/test/unit/styles/css-split-equivalence.test.ts
@@ -732,6 +732,8 @@ describe('main.css split — cascade-preserving equivalence', () => {
     const AGENT_MARKER_BYTES = 633;
     // find.css: the field's grid-column pin and its comment (read-only find field gap).
     const FIND_FIELD_COLUMN_BYTES = 140;
+    // database.css: the prefers-reduced-motion block and its drawer-fallback comment.
+    const DATABASE_REDUCED_MOTION_BYTES = 536;
     const CEILING = Math.floor(PRE_SPLIT_BYTES * 1.4805) + 1_162 + 2_854 + 9_383 + 3_437 + 952
       + CONVERSION_TYPOGRAPHY_PICKER_BYTES + REMOTE_SELECTION_SHADE_BYTES + EQUATION_EDITING_CHIP_BYTES + INLINE_MENU_MOTION_BYTES
       + SLASH_PILL_SPAN_BYTES
@@ -785,7 +787,8 @@ describe('main.css split — cascade-preserving equivalence', () => {
       + TABS_EMPTY_HINT_BYTES
       + PAGE_TITLE_HEADER_BYTES
       + AGENT_MARKER_BYTES
-      + FIND_FIELD_COLUMN_BYTES;
+      + FIND_FIELD_COLUMN_BYTES
+      + DATABASE_REDUCED_MOTION_BYTES;
     const actual = localImportedByteBudget(ENTRY);
 
     expect(actual).toBeLessThanOrEqual(CEILING);
```

- [ ] **Step 4: Run, expect PASS**
- `database-reduced-motion.test.ts`: 6 passed.
- `-t "reduced motion"` on the drawer test: 2 passed.
- Full drawer files:
  - `database-card-drawer.test.ts`: 91 passed
  - `database-card-drawer.mutants.test.ts`: 62 passed
  - `-rich-text`: 7 passed
  - `-tab-sync`: 1 passed
- `css-split-equivalence.test.ts`: 4 passed.
- `npx vitest run test/unit/styles/`: 54 files, 716 passed. The 14 non-styles CSS readers, run one at a time, are green. `bundle-outputs.test.ts` reports "no tests", for a reason I did not check.

A first draft of the helper used `addEventListener(…)` without `{ once: true }` plus `removeEventListener`. It turned 2 mutant tests red (`registers the open/close transition listener as a one-shot`). The hunk above keeps `{ once: true }`.

- [ ] **Step 5: Lint**

`npx eslint src/tools/database/database-card-drawer.ts test/unit/tools/database/database-card-drawer.test.ts test/unit/styles/database-reduced-motion.test.ts test/unit/styles/css-split-equivalence.test.ts`: clean.

A first draft of the CSS test used a nested ternary for brace matching and drew `no-nested-ternary`. The final version uses one regex, because the block holds no nested braces.

- [ ] **Step 6: Commit**
```
git add src/styles/database.css src/tools/database/database-card-drawer.ts \
  test/unit/tools/database/database-card-drawer.test.ts test/unit/styles/database-reduced-motion.test.ts \
  test/unit/styles/css-split-equivalence.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "fix(database): honour prefers-reduced-motion

Drops the drawer slide, the card and column drag glides and the property
popover entrance under reduced motion. The drawer no longer waits forever
for a transitionend that reduced motion never sends: a fallback timer
removes a closed drawer and focuses an empty title.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Not BREAKING. No token, attribute or default changes.

**Evidence:**
- `grep -n "transition\|animation" src/styles/database.css` gave the motion list above.
- `transitionend` uses at `database-card-drawer.ts:298, :422` (HEAD).
- No database e2e test uses the fixtures or the drawer timing: `grep -rn "db-board|db-list|'Board view'" test/playwright` returned nothing.

**Unverified:**
- I did not run it in a real browser with reduced motion emulated. Ruled-out regressions rest on jsdom with fake timers.
- The 300ms fallback is longer than the 200ms drawer transition. In normal motion, `transitionend` still wins.
- `open()` has a gap under reduced motion. Its 300ms fallback can still fire after a fast close (within 300ms of opening). It would then call `autoResizeTitle` and focus the title inside a drawer that is closing or already gone. A `this.drawer === drawer` guard in the open callback would close this. The `transitionend` path at HEAD has the same gap, and I did not add or test the guard.
- Card hover/color fades (database.css:73, button/tab fades) are deliberately kept. They are color changes, not movement. Say so if the user wants them off too.
- Drag ghost transforms are inline in TS (`database-card-drag.ts:157-164`, `database-column-drag.ts:150-157`, `database-tab-bar.ts:553-556`). CSS cannot reach them, and E3 does not touch them.

---

### Task E4: Playground database fixtures

**Files:**
- `index.html`:
  - nested-list state `lnb-db` (~:3335-3346)
  - database states `db-list` / `db-board` / `db-empty` (~:3586-3625)
- new `test/unit/playground/database-fixtures.test.ts`

**Interfaces:**
- Consumes:
  - `BLOCK_STATES_RAW` inside `index.html`, evaluated with `node:vm` the way `test/unit/playground/block-states-spec.test.ts` already does
  - `validateAgainst` (`src/shared/schema/validate.ts:392`)
  - `DATABASE_DATA` / `DATABASE_ROW_DATA` (`src/shared/tool-descriptions/database*.ts`)
  - `DatabaseTool#validate`
- Produces: four valid database fixtures. Each has:
  - a `title`-type property with `position`
  - select options under `config.options[]` with `label` and `position`
  - views with `position`
  - rows with `position`
  - `visibleProperties` that no longer list the title, because the list view draws every listed id as a badge (`database-list-view.ts:239-250`)

A test already validates playground fixtures: `block-states-spec.test.ts`, which string-matches sections. E4 adds a sibling file instead of growing that one. The sibling imports `DatabaseTool`, which the spec file never imported. It imports nothing *from* index.html; it reads the file as text.

**A trap found while writing the test:**
- Objects evaluated in a `vm` context have the other realm's `Object.prototype`.
- `validateAgainst`'s `isRecord` (`validate.ts:22-24`) compares prototypes by identity, so a vm-born object is never treated as a record.
- On that first run, the two schema checks **passed on the malformed fixtures**. Only `validate()` and the option check failed (7 of 17).
- The JSON round-trip in the loader fixes it. With it, 14 of 17 fail as they should.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { API, BlockAPI } from '../../../types';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { DATABASE_DATA } from '../../../src/shared/tool-descriptions/database';
import { DATABASE_ROW_DATA } from '../../../src/shared/tool-descriptions/database-row';
import { DatabaseTool } from '../../../src/tools/database';
import type { DatabaseData, DatabaseRowData } from '../../../src/tools/database/types';

interface FixtureBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
}

interface BlockStatesEntry {
  tool: string;
  states: Array<{ label: string; blocks: FixtureBlock[] }>;
}

/** BLOCK_STATES_RAW is a plain literal inside index.html, evaluated the way block-states-spec.test.ts does. */
const loadBlockStates = (): BlockStatesEntry[] => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
  const start = html.indexOf('const BLOCK_STATES_RAW = [');
  const end = html.indexOf('const BLOCK_STATES_SPEC');

  // Round-trip into this realm: the schema validator only treats objects with THIS realm's
  // Object.prototype as records, so vm-born objects would pass every check unexamined.
  return JSON.parse(JSON.stringify(runInNewContext(`${html.slice(start, end)}; BLOCK_STATES_RAW`))) as BlockStatesEntry[];
};

const databaseFixtures = loadBlockStates().flatMap((entry) => entry.states.flatMap((state) =>
  state.blocks
    .filter((block) => block.type === 'database')
    .map((database) => ({
      name: `${entry.tool} / ${state.label} / ${database.id}`,
      data: database.data as DatabaseData,
      rows: state.blocks.filter((block) => block.parent === database.id && block.type === 'database-row'),
    }))
));

const makeTool = (data: DatabaseData): DatabaseTool => new DatabaseTool({
  data,
  config: {},
  api: { events: { on: vi.fn(), off: vi.fn() } } as unknown as API,
  block: { id: 'fixture', dispatchChange: vi.fn() } as unknown as BlockAPI,
  readOnly: false,
});

describe('playground database fixtures (index.html)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds the database fixtures', () => {
    expect(databaseFixtures.length).toBeGreaterThan(0);
  });

  it.each(databaseFixtures)('$name: matches the saved database shape', ({ data }) => {
    expect(validateAgainst(DATABASE_DATA, data)).toEqual([]);
  });

  it.each(databaseFixtures)('$name: passes the tool\'s own validate()', ({ data }) => {
    expect(makeTool(data).validate(data)).toBe(true);
  });

  it.each(databaseFixtures)('$name: every row matches the saved row shape', ({ rows }) => {
    for (const row of rows) {
      expect(validateAgainst(DATABASE_ROW_DATA, row.data), row.id).toEqual([]);
    }
  });

  it.each(databaseFixtures)('$name: every select value names an option, so no labelless column appears', ({ data, rows }) => {
    const selects = data.schema.filter((p) => p.type === 'select');
    const pairs = selects.flatMap((property) => rows.map((row) => ({
      at: `${row.id}.${property.id}`,
      value: (row.data as DatabaseRowData).properties[property.id],
      optionIds: (property.config?.options ?? []).map((option) => option.id),
    })));

    for (const { at, value, optionIds } of pairs.filter((pair) => pair.value !== undefined && pair.value !== null)) {
      expect(optionIds, at).toContain(value);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

`npx vitest run test/unit/playground/database-fixtures.test.ts`, observed:
```
× lnb-db / db-list / db-board / db-empty: matches the saved database shape
  AssertionError: expected [ { path: '/schema/0', …(1) }, …(3) ] to deeply equal []
× all four: passes the tool's own validate()      AssertionError: expected false to be true
× lnb-db / db-list / db-board: every row matches the saved row shape
  AssertionError: lnb-db-r1: expected [ { path: '', …(1) } ] to deeply equal []
× lnb-db / db-list / db-board: every select value names an option
  AssertionError: db-bd-r1.status: expected [] to include 'todo'
Tests  14 failed | 3 passed (17)
```
I re-checked after the final refactor of the test: stashing only `index.html` gives `14 failed | 3 passed` again.

- [ ] **Step 3: Minimal implementation (corrected fixture JSON)**

```diff
diff --git a/index.html b/index.html
index 77577b54..31cd1d50 100644
--- a/index.html
+++ b/index.html
@@ -3334,16 +3334,16 @@
             { id: 'lnb-col-b-p', type: 'paragraph', data: { text: 'Column B' }, parent: 'lnb-col-b' },
             { id: 'lnb-db', type: 'database', data: {
               schema: [
-                { id: 'title', name: 'Title', type: 'text' },
-                { id: 'status', name: 'Status', type: 'select', options: [
-                  { id: 'todo', name: 'Todo', color: 'gray' },
-                  { id: 'done', name: 'Done', color: 'green' },
-                ] },
+                { id: 'title', name: 'Title', type: 'title', position: 'a0' },
+                { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [
+                  { id: 'todo', label: 'Todo', color: 'gray', position: 'a0' },
+                  { id: 'done', label: 'Done', color: 'green', position: 'a1' },
+                ] } },
               ],
-              views: [{ id: 'v1', type: 'list', name: 'All', sorts: [], filters: [], visibleProperties: ['title', 'status'] }],
+              views: [{ id: 'v1', type: 'list', name: 'All', position: 'a0', sorts: [], filters: [], visibleProperties: ['status'] }],
               activeViewId: 'v1',
             }, content: ['lnb-db-r1'], indent: 1 },
-            { id: 'lnb-db-r1', type: 'database-row', data: { properties: { title: 'Nested row', status: 'done' } }, parent: 'lnb-db' },
+            { id: 'lnb-db-r1', type: 'database-row', data: { properties: { title: 'Nested row', status: 'done' }, position: 'a0' }, parent: 'lnb-db' },
           ] },
           { label: 'Empty', blocks: [{ id: 'ul-empty', type: 'list', data: { style: 'unordered', text: '' } }] },
         ],
@@ -3585,40 +3585,40 @@
           { label: 'List view', blocks: [
             { id: 'db-list', type: 'database', data: {
               schema: [
-                { id: 'title', name: 'Title', type: 'text' },
-                { id: 'status', name: 'Status', type: 'select', options: [
-                  { id: 'todo', name: 'Todo', color: 'gray' },
-                  { id: 'doing', name: 'Doing', color: 'yellow' },
-                  { id: 'done', name: 'Done', color: 'green' },
-                ] },
+                { id: 'title', name: 'Title', type: 'title', position: 'a0' },
+                { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [
+                  { id: 'todo', label: 'Todo', color: 'gray', position: 'a0' },
+                  { id: 'doing', label: 'Doing', color: 'yellow', position: 'a1' },
+                  { id: 'done', label: 'Done', color: 'green', position: 'a2' },
+                ] } },
               ],
-              views: [{ id: 'v1', type: 'list', name: 'All', sorts: [], filters: [], visibleProperties: ['title', 'status'] }],
+              views: [{ id: 'v1', type: 'list', name: 'All', position: 'a0', sorts: [], filters: [], visibleProperties: ['status'] }],
               activeViewId: 'v1',
             }, content: ['db-list-r1', 'db-list-r2'] },
-            { id: 'db-list-r1', type: 'database-row', data: { properties: { title: 'Write tests', status: 'done' } }, parent: 'db-list' },
-            { id: 'db-list-r2', type: 'database-row', data: { properties: { title: 'Build feature', status: 'doing' } }, parent: 'db-list' },
+            { id: 'db-list-r1', type: 'database-row', data: { properties: { title: 'Write tests', status: 'done' }, position: 'a0' }, parent: 'db-list' },
+            { id: 'db-list-r2', type: 'database-row', data: { properties: { title: 'Build feature', status: 'doing' }, position: 'a1' }, parent: 'db-list' },
           ] },
           { label: 'Board view', blocks: [
             { id: 'db-board', type: 'database', data: {
               schema: [
-                { id: 'title', name: 'Title', type: 'text' },
-                { id: 'status', name: 'Status', type: 'select', options: [
-                  { id: 'todo', name: 'Todo', color: 'gray' },
-                  { id: 'doing', name: 'Doing', color: 'yellow' },
-                  { id: 'done', name: 'Done', color: 'green' },
-                ] },
+                { id: 'title', name: 'Title', type: 'title', position: 'a0' },
+                { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [
+                  { id: 'todo', label: 'Todo', color: 'gray', position: 'a0' },
+                  { id: 'doing', label: 'Doing', color: 'yellow', position: 'a1' },
+                  { id: 'done', label: 'Done', color: 'green', position: 'a2' },
+                ] } },
               ],
-              views: [{ id: 'v1', type: 'board', name: 'Board', groupBy: 'status', sorts: [], filters: [], visibleProperties: ['title', 'status'] }],
+              views: [{ id: 'v1', type: 'board', name: 'Board', position: 'a0', groupBy: 'status', sorts: [], filters: [], visibleProperties: [] }],
               activeViewId: 'v1',
             }, content: ['db-bd-r1', 'db-bd-r2', 'db-bd-r3'] },
-            { id: 'db-bd-r1', type: 'database-row', data: { properties: { title: 'Plan', status: 'todo' } }, parent: 'db-board' },
-            { id: 'db-bd-r2', type: 'database-row', data: { properties: { title: 'Design', status: 'doing' } }, parent: 'db-board' },
-            { id: 'db-bd-r3', type: 'database-row', data: { properties: { title: 'Ship', status: 'done' } }, parent: 'db-board' },
+            { id: 'db-bd-r1', type: 'database-row', data: { properties: { title: 'Plan', status: 'todo' }, position: 'a0' }, parent: 'db-board' },
+            { id: 'db-bd-r2', type: 'database-row', data: { properties: { title: 'Design', status: 'doing' }, position: 'a1' }, parent: 'db-board' },
+            { id: 'db-bd-r3', type: 'database-row', data: { properties: { title: 'Ship', status: 'done' }, position: 'a2' }, parent: 'db-board' },
           ] },
           { label: 'Empty database', blocks: [
             { id: 'db-empty', type: 'database', data: {
-              schema: [{ id: 'title', name: 'Title', type: 'text' }],
-              views: [{ id: 'v1', type: 'list', name: 'All', sorts: [], filters: [], visibleProperties: ['title'] }],
+              schema: [{ id: 'title', name: 'Title', type: 'title', position: 'a0' }],
+              views: [{ id: 'v1', type: 'list', name: 'All', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
               activeViewId: 'v1',
             } },
           ] },
```

- [ ] **Step 4: Run, expect PASS**
- `database-fixtures.test.ts`: 17 passed.
- `block-states-spec.test.ts`: 103 passed.
- All of `test/unit/playground/`: 32 files, 736 passed.

- [ ] **Step 5: Lint**

`npx eslint test/unit/playground/database-fixtures.test.ts`: clean. A first draft nested three loops and drew `max-depth`; the final version flattens it into pairs. `index.html` is not linted as TS.

- [ ] **Step 6: Commit**
```
git add index.html test/unit/playground/database-fixtures.test.ts
git commit -m "fix(playground): make the database fixtures valid saved data

The fixtures had no title-type property, kept select options at options[]
with name instead of config.options[] with label, and gave no positions, so
validate() rejected all four and the board drew labelless columns.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Not BREAKING. These are playground-only fixtures.

**Unverified:**
- I did not open the playground in a browser to look at the rendered board and list.
- The claim that the old fixtures drew three labelless columns comes from research/01 §10 and the failing option check. I did not see it on screen.
- Rows carry the title only in `properties.title`, not a top-level `title`. Per `DatabaseRowData` docs, such rows keep reading it from `properties`. I did not render it to confirm.

---

# Section C: grouping correctness (C1, C2, C3)

I drafted this in a scratch worktree at HEAD `665c077a`. Every test below was written and run there: first FAIL, then PASS. The full diff is `phase-0-artifacts/C-grouping.diff`. Line numbers refer to HEAD (`665c077a`) unless marked "after".

**Order.** C1, then C2, then C3. C2 and C3 need C1's `NO_VALUE_GROUP_KEY` and its no-value column.

**C3 is GATED ON USER DECISION D9.** If D9 goes another way, skip C3 entirely. C1 and C2 do not depend on it.

**Baseline before any change (all green):**

| Suite | Tests |
|---|---|
| database-model | 45 |
| database-model.mutants | 24 |
| database | 128 |
| database-board-view | 75 |
| database-board-view.mutants | 29 |
| database-card-drag | 12 |
| database-card-drag.mutants | 38 |
| database-column-drag | 8 |
| database-column-drag.mutants | 31 |
| database-list-view | 41 |
| database-list-view.mutants | 23 |
| concurrent-database-loss | 26 |
| concurrent-database-loss-wave2 | 8 |
| `test/unit/components/i18n/` | 7367 (15 files) |

**HEAD failure record for the final test code.** All 15 new `database.test.ts` tests (C1 + C2 + C3) were run against the HEAD versions of the five touched `src/tools/database/*.ts` files. Each file was copied aside, reset with `git show HEAD:<file> > <file>`, and restored afterwards.
- Command: `npx vitest run test/unit/tools/database/database.test.ts -t "no-value group|grouping by a multiSelect|deleting a board column"`.
- Result: `Tests 15 failed | 127 skipped`. The per-test messages are quoted in each Step 2.

**Pre-existing / environment reds.** `test/unit/architecture/react-fixture-import-map-law.test.ts` had 3 failures in the worktree, with `packages/react/dist/index.mjs is missing — run yarn build first`.
- The cause is the environment: the scratch worktree has no build. It is unrelated to this change.
- It was not run before the change, so this is not a measured baseline.

---

### Task C1: "No ⟨property⟩" group for rows with an empty group value

**Defect (proven by a failing test).** A row whose group value is `null`, `undefined` or `''` never shows on a board or in a grouped list.
- The model files these rows under the key `''` (`database-model.ts:226-231`).
- Nothing draws a `''` group:
  - `renderBoardView` and `renderListView` draw only `getSelectOptions` (`index.ts:903-950`).
  - `orphanGroupOptions` skips `''` (`database-model.ts:141`).

**Files:**
- `src/tools/database/database-model.ts`:
  - new export after line 17
  - orphan filter at 141
  - `toGroupKey` at 226-231
- `src/tools/database/index.ts`:
  - import at 5
  - new `groupOptions()` before `renderBoardView` (903)
  - board options at 904-906
  - list options at 929-932
  - `handleAddListRow` at 1096-1098
  - `handleAddRow` at 1126-1129
  - column-drag pointerdown guard at 1368
  - `makeColumnHeadersEditable` guard at 1418
  - `handleRowDrop` write at 1451 and 1455
- `src/tools/database/database-board-view.ts`: import after 3; marker attribute in `createColumnElement` after 158.
- `src/tools/database/database-column-drag.ts`: candidate filter at 236.
- `src/components/i18n/locales/en.json`: new key after 285 (`tools.database.columnTitlePlaceholder`).
- `types/message-keys.d.ts`: regenerated.
- Tests:
  - `test/unit/tools/database/database.test.ts`: new describe at the end, plus pin updates at 256-262, ~391, 646/658, 804 and 2322.
  - `test/unit/tools/database/database-model.test.ts`: 221-235 and 247-260.
  - `test/unit/tools/database/database-model.mutants.test.ts`: import, plus 216-230.
  - `test/unit/tools/database/database-column-drag.test.ts`: new test after 64.
  - `test/unit/components/i18n/lifecycle-coverage.test.ts`: 268, 282 and 324.

**Interfaces:**
- **Produces** `export const NO_VALUE_GROUP_KEY = '__blok-no-value-group__'` from `src/tools/database/database-model.ts`. The same key is used in three places:
  - It is the group key `getRowsGroupedBy` uses for empty values. It replaces `''`.
  - It is the `data-option-id` of the no-value column and list group.
  - It is the `toOptionId` a drop into that column reports.
- **Why not `''`:** `database-card-drag.ts:299` reads a missing `data-option-id` as `''`. Also, the tests' `queryByData(el, attr)` treats `''` as "has the attribute".
- **Produces** the DOM marker `data-blok-database-no-value-group` on the no-value board column.
- **Produces** the i18n key `tools.database.noValueGroup` = `"No {property}"`. It is called with `{ property: <localized property name> }`.
- **Produces** `private groupOptions(groupByPropId: string): SelectOption[]` in `DatabaseTool`. It returns `[{ id: NO_VALUE_GROUP_KEY, label, position: '' }, ...localized getSelectOptions]`.
- **Behaviour of the no-value column:**
  - It is always the first column, even when empty.
  - It has no rename and no delete button.
  - It cannot be dragged, and no column can be dropped before it.
  - "+ New" in it creates a row without the group key.
  - Dropping a card into it writes `null`.

- [ ] **Step 1: failing tests.** Append this inside the outer `describe('DatabaseTool')` of `test/unit/tools/database/database.test.ts`:

```ts
  describe('no-value group', () => {
    const interpolatingT = (key: string, vars?: Record<string, string | number>): string => {
      if (key === 'tools.database.noValueGroup') return `No ${String(vars?.property)}`;

      return key === 'tools.database.defaultStatusProperty' ? 'Status' : key;
    };

    const renderBoard = (rows: Array<{ id: string; properties: Record<string, unknown> }>): {
      tool: DatabaseTool;
      element: HTMLElement;
      options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
    } => {
      const childBlocks = rows.map((r, i) => createMockRowBlock({ id: r.id, properties: r.properties, position: `a${i}` }));
      const options = createDatabaseOptions({}, {}, { childBlocks });

      options.api.i18n.t = interpolatingT;

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      return { tool, element, options };
    };

    const noValueColumn = (element: HTMLElement): HTMLElement | null =>
      queryByData(element, 'data-blok-database-no-value-group');

    it('shows a row with no group value on the board, in a first "No <property>" column', () => {
      const { tool, element } = renderBoard([
        { id: 'row-empty', properties: { 'prop-title': 'Loose', 'prop-status': null } },
        { id: 'row-todo', properties: { 'prop-title': 'Todo', 'prop-status': 'opt-todo' } },
      ]);

      const card = queryAllByData(element, 'data-row-id', 'row-empty').find((el) => el.hasAttribute('data-blok-database-card'));

      expect(card).toBeDefined();

      const column = noValueColumn(element);

      expect(column).not.toBeNull();
      expect(column?.contains(card ?? null)).toBe(true);
      expect(queryAllByData(element, 'data-blok-database-column')[0]).toBe(column);
      expect(queryByData(column ?? element, 'data-blok-database-column-title')?.textContent).toBe('No Status');

      tool.destroy();
    });

    it('keeps the no-value column on an empty board so a card can be dropped into it', () => {
      const { tool, element } = renderBoard([]);

      expect(noValueColumn(element)).not.toBeNull();

      tool.destroy();
    });

    it('gives the no-value column no delete button and no rename', () => {
      const { tool, element } = renderBoard([]);
      const column = noValueColumn(element);

      expect(column).not.toBeNull();
      expect(queryByData(column ?? element, 'data-blok-database-delete-column')).toBeNull();

      const title = queryByData(column ?? element, 'data-blok-database-column-title');

      title?.click();

      expect(queryByData(column ?? element, 'data-blok-database-column-title-input')).toBeNull();

      tool.destroy();
    });

    it('creates a row with no group value from "+ New" in the no-value column', () => {
      const { tool, element, options } = renderBoard([]);
      const column = noValueColumn(element);
      const addCard = queryByData(column ?? element, 'data-blok-database-add-card');

      expect(addCard).not.toBeNull();
      addCard?.click();

      const insertAt = vi.mocked(options.api.blocks.insertAt);

      expect(insertAt).toHaveBeenCalledTimes(1);

      const data = insertAt.mock.calls[0][1] as DatabaseRowData;

      expect(data.properties).not.toHaveProperty('prop-status');

      tool.destroy();
    });

    it('clears the group value when a card is dropped into the no-value column', () => {
      const { tool, element, options } = renderBoard([
        { id: 'row-todo', properties: { 'prop-title': 'Todo', 'prop-status': 'opt-todo' } },
      ]);
      const column = noValueColumn(element);
      const toOptionId = column?.getAttribute('data-option-id') ?? 'missing';
      const cardDrag = (tool as unknown as { cardDrag: { onDrop: (r: CardDragResult) => void } }).cardDrag;
      const rowBlock = vi.mocked(options.api.blocks.getChildren).mock.results[0]?.value as BlockAPI[];

      cardDrag.onDrop({ rowId: 'row-todo', toOptionId, beforeRowId: null, afterRowId: null });

      expect(rowBlock[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });

      tool.destroy();
    });

    it('never starts a column drag from the no-value column header', () => {
      const { tool, element } = renderBoard([]);
      const header = queryByData(noValueColumn(element) ?? element, 'data-blok-database-column-header');
      const columnDrag = (tool as unknown as { columnDrag: DatabaseColumnDrag }).columnDrag;
      const begin = vi.spyOn(columnDrag, 'beginTracking');

      expect(header).not.toBeNull();
      fireEvent.pointerDown(header ?? element, { clientX: 0, clientY: 0 });

      expect(begin).not.toHaveBeenCalled();

      tool.destroy();
    });

    it('shows a row with no group value in a grouped list', () => {
      const childBlocks = [createMockRowBlock({ id: 'row-empty', properties: { 'prop-title': 'Loose' }, position: 'a0' })];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'List', type: 'list', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
      }, {}, { childBlocks });

      options.api.i18n.t = interpolatingT;

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      const row = queryAllByData(element, 'data-row-id', 'row-empty').find((el) => el.hasAttribute('data-blok-database-list-row'));

      expect(row).toBeDefined();

      tool.destroy();
    });
  });

```

Also add this to `test/unit/tools/database/database-column-drag.test.ts`, before `it('does not start drag below 10px horizontal threshold'`:

```ts
  it('never drops a column before the no-value column', () => {
    wrapper.querySelector('[data-option-id="opt-0"]')?.setAttribute('data-blok-database-no-value-group', '');

    drag.beginTracking('opt-2', 450, 50);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 50 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 50 }));

    expect(onDrop).toHaveBeenCalledWith({ optionId: 'opt-2', beforeOptionId: 'opt-1', afterOptionId: null });
  });

```

- [ ] **Step 2: run, expect FAIL.**
  - Final test code against HEAD source (see the record at the top). The 7 C1 tests failed with, in order:
    1. `expected undefined to be defined`
    2. `expected null not to be null`
    3. `expected null not to be null`
    4. `expected { 'prop-title': '', …(1) } to not have property "prop-status"`
    5. `expected "vi.fn()" to be called with arguments: [ 'updateProperties', …(1) ]`
    6. `expected "beginTracking" to not be called at all, but actually been called 1 times`
    7. `expected undefined to be defined`
  - The notes below come from the first run. In that run `interpolatingT` did not yet map `defaultStatusProperty`; adding the mapping is the only test change made since.
  - Command: `npx vitest run test/unit/tools/database/database.test.ts -t "no-value group"`. Observed: `Tests 7 failed | 128 skipped`.
  - The first failure proves the defect is real. `shows a row with no group value on the board…` fails with `AssertionError: expected undefined to be defined`, because the card for `row-empty` is not in the DOM.
  - The other six fail because the column is missing. Some fall back to `element` and hit the wrong column. They report:
    - `expected null not to be null`
    - `expected { 'prop-title': '', …(1) } to not have property "prop-status"`
    - `expected "beginTracking" to not be called at all, but actually been called 1 times`
  - Column-drag test, run against the HEAD `database-column-drag.ts`: `npx vitest run test/unit/tools/database/database-column-drag.test.ts -t "no-value column"`. Observed: 1 failed, with `- "beforeOptionId": "opt-1"  + "beforeOptionId": "opt-0"`.

- [ ] **Step 3: minimal implementation.**

`src/tools/database/database-model.ts`:
```diff
@@ after line 17 (ORPHAN_GROUP_POSITION)
+/**
+ * Group key for rows with no value. Not '' because card drag reads a missing
+ * data-option-id as ''. 23 chars, so a default 21-char nanoid option id never equals it.
+ */
+export const NO_VALUE_GROUP_KEY = '__blok-no-value-group__';
@@ orphanGroupOptions (141)
-      .filter((key) => key !== '' && !knownIds.has(key))
+      .filter((key) => key !== NO_VALUE_GROUP_KEY && !knownIds.has(key))
@@ toGroupKey (226-231)
-    if (value === undefined || value === null) return '';
+    if (value === undefined || value === null || value === '') return NO_VALUE_GROUP_KEY;
     if (typeof value === 'string') return value;
     if (typeof value === 'boolean' || typeof value === 'number') return String(value);
-    return '';
+    return NO_VALUE_GROUP_KEY;
```

`src/tools/database/index.ts`:
```diff
-import { DatabaseModel } from './database-model';
+import { DatabaseModel, NO_VALUE_GROUP_KEY } from './database-model';
@@ before renderBoardView (903)
+  /**
+   * The no-value option must stay first: column drag never drops before it,
+   * and handleGroupDrop reads a missing left neighbour as "first real option".
+   */
+  private groupOptions(groupByPropId: string): SelectOption[] {
+    const property = localizeDatabaseSchema(this.model.getSchema(), this.api.i18n).find((p) => p.id === groupByPropId);
+    const noValue: SelectOption = {
+      id: NO_VALUE_GROUP_KEY,
+      label: this.api.i18n.t('tools.database.noValueGroup', { property: property?.name ?? '' }),
+      position: '',
+    };
+
+    return [noValue, ...localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId), this.api.i18n)];
+  }
@@ renderBoardView (904-906)
-    const options = groupByPropId !== undefined
-      ? localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId), this.api.i18n)
-      : [];
+    const options = groupByPropId !== undefined ? this.groupOptions(groupByPropId) : [];
@@ renderListView (929-932)
-      const options = localizeDatabaseSelectOptions(
-        this.model.getSelectOptions(groupByPropId),
-        this.api.i18n
-      );
+      const options = this.groupOptions(groupByPropId);
@@ handleAddListRow (1096)
-    if (groupByPropId !== undefined && optionId !== null) {
+    if (groupByPropId !== undefined && optionId !== null && optionId !== NO_VALUE_GROUP_KEY) {
@@ handleAddRow (1126-1129)
-    const rowData = this.model.createRowData({
-      [titlePropId]: '',
-      [groupByPropId]: optionId,
-    });
+    const rowData = this.model.createRowData(optionId === NO_VALUE_GROUP_KEY
+      ? { [titlePropId]: '' }
+      : { [titlePropId]: '', [groupByPropId]: optionId });
@@ pointerdown column-header branch (1368)
-        if (optId !== null) {
+        if (optId !== null && optId !== NO_VALUE_GROUP_KEY) {
@@ makeColumnHeadersEditable (1418)
-      if (optId !== null && optId !== undefined) {
+      if (optId !== null && optId !== undefined && optId !== NO_VALUE_GROUP_KEY) {
@@ handleRowDrop (1451, 1455)
-    this.updateRowBlock(rowId, { [groupByPropId]: toOptionId });
+    const value = toOptionId === NO_VALUE_GROUP_KEY ? null : toOptionId;
+
+    this.updateRowBlock(rowId, { [groupByPropId]: value });
 ...
-    this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: toOptionId } });
+    this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: value } });
```

`src/tools/database/database-board-view.ts`:
```diff
 import type { DatabaseViewRenderer } from './database-view-renderer';
+import { NO_VALUE_GROUP_KEY } from './database-model';
@@ createColumnElement, after setAttribute('data-option-id', option.id)
+
+    if (option.id === NO_VALUE_GROUP_KEY) {
+      columnEl.setAttribute('data-blok-database-no-value-group', '');
+    }
+
```

`src/tools/database/database-column-drag.ts` (236):
```diff
-    ).filter((col) => col.getAttribute('data-option-id') !== this.optionId);
+    ).filter((col) => col.getAttribute('data-option-id') !== this.optionId && !col.hasAttribute('data-blok-database-no-value-group'));
```

`src/components/i18n/locales/en.json`, after `"tools.database.columnTitlePlaceholder": "Column",`:
```diff
+  "tools.database.noValueGroup": "No {property}",
```
Then run `node scripts/generate-message-keys-dts.mjs`. Observed: "Wrote 783 message-key declarations", and one line was added to `types/message-keys.d.ts`.

**Expected pin updates.** These existing tests pinned "no no-value group" or the `''` key. They change on purpose:
- `database.test.ts`:
  - 256-262: rename the test to `renders the no-value column plus 3 columns for default data with 3 select options`, and change `toHaveLength(3)` to `4`.
  - "localizes canonical defaults…" (~391): the column titles get a leading `'tools.database.noValueGroup'`.
  - "clicking add-column button adds column to model and DOM" (646/658): the DOM counts change from 3 to 4 and from 4 to 5. The saved-options count stays at 4.
  - "column delete cascades…" (804): `remainingColumns` changes from 2 to 3. If C3 runs, this test is deleted anyway.
  - "renders grouped list when view has groupBy" (2322): the `list-group` count changes from 2 to 3.
- `database-model.test.ts`:
  - Import `NO_VALUE_GROUP_KEY`.
  - Rename `puts rows with no value under empty string key` to `puts rows with no value under the no-value group key`, and assert `groups.get(NO_VALUE_GROUP_KEY)?.map((r) => r.id)` equals `['r2']`.
  - In the checkbox test, change `groups.get('')` to `groups.get(NO_VALUE_GROUP_KEY)`.
- `database-model.mutants.test.ts`:
  - Import `NO_VALUE_GROUP_KEY`.
  - In "stringifies numbers…", change `['', [list, missing]]` to `[NO_VALUE_GROUP_KEY, [list, missing]]`. C2 rewrites this test again.
  - Keep the equivalent-mutant comment, with `''` replaced by `NO_VALUE_GROUP_KEY`.

**i18n step.**

With only the en key added, `npx vitest run test/unit/components/i18n/` went red: 140 failed tests across 4 files.

| File | Failing tests |
|---|---|
| `untranslated-strings` | 68 locale-completeness cases |
| `translation-guidelines` | 68 "<loc> satisfies structural translation rules", plus "keeps locale progress and retention evidence internally consistent" |
| `taiwan-traditional-chinese` | 2 |
| `lifecycle-coverage` | 1 (`expected 783 to be 782`) |

`test/unit/architecture/published-types-no-src-refs.test.ts` ("types/message-keys.d.ts stays in sync") was also red until the regenerate. It is green after.

Lifecycle pins in `lifecycle-coverage.test.ts`, verified green after this change:
- Title `600 + 117 + 61 + 4 closure for all 782 keys` becomes `601 + 117 + 61 + 4 closure for all 783 keys`.
- `toBe(782)` becomes `toBe(783)`.
- `'executable-literal': 600` becomes `601`, because the key is a string literal in `index.ts`.

**The translation step was NOT done here.** It follows the memory note `i18n-new-key-checklist.md`. The `blok-translations` skill's `messages.json` layout is out of date: locales are flat files at `src/components/i18n/locales/<code>.json`. The step requires:
1. Add `tools.database.noValueGroup` to all 69 non-English locale files, at the same position as in en (after `tools.database.columnTitlePlaceholder`).
   - Keep the `{property}` placeholder exactly. The `taiwan-traditional-chinese` test "preserves every interpolation placeholder exactly" checks it.
   - Script the edit.
   - Reuse each locale's existing word for "No"/"none" where one exists.
2. Rewrite both digest columns for each locale in `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md` ("Reviewed Dictionary Digests").
3. For any value identical to English, add a `COGNATE_RETENTIONS` entry in `untranslated-strings.test.ts` and a ledger `R-<locale>-NNN` retention row.
4. Rerun `npx vitest run test/unit/components/i18n/` (all 15 files must be green) and `yarn i18n:check`.

- [ ] **Step 4: run, expect PASS.**
  - `npx vitest run test/unit/tools/database/database.test.ts -t "no-value group"`: 7 passed, 128 skipped.
  - Column-drag test: `database-column-drag.test.ts` + `.mutants` gave 40 passed.
  - After the pin updates, all green:

| Suite | Tests |
|---|---|
| database | 135/135 |
| database-model | 45/45 |
| database-model.mutants | 24/24 |
| database-board-view | 75 |
| database-board-view.mutants | 29 |
| database-column-drag | 9 |
| database-column-drag.mutants | 31 |
| database-list-view | 41 |
| concurrent-database-loss | 26 |
| concurrent-database-loss-wave2 | 8 |

- [ ] **Step 5: lint.** Ran `npx eslint src/tools/database/database-model.ts src/tools/database/index.ts src/tools/database/database-board-view.ts src/tools/database/database-column-drag.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-model.test.ts test/unit/tools/database/database-model.mutants.test.ts test/unit/components/i18n/lifecycle-coverage.test.ts`. It printed nothing (clean).
- [ ] **Step 6: commit**, after the translation step is green:
```
git add src/tools/database/database-model.ts src/tools/database/index.ts src/tools/database/database-board-view.ts src/tools/database/database-column-drag.ts src/components/i18n/locales/*.json types/message-keys.d.ts docs/plans/2026-07-19-all-locales-translation-audit-ledger.md test/unit/tools/database/database.test.ts test/unit/tools/database/database-model.test.ts test/unit/tools/database/database-model.mutants.test.ts test/unit/tools/database/database-column-drag.test.ts test/unit/components/i18n/lifecycle-coverage.test.ts test/unit/components/i18n/untranslated-strings.test.ts
git commit -m "fix(database): show rows with no group value in a No <property> group"
```

**Evidence:**
- The FAIL and PASS runs above.
- `database-model.test.ts` already pinned the model's `''` key ("puts rows with no value under empty string key"). So the loss was at the view layer.
- `database-row` `updateProperties` is `Object.assign(this._data.properties, changes)` (`src/tools/database-row/index.ts:103-105`). Writing `null` stores `null`; it does not delete the key.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` on the full C1+C2+C3 tree: exit 0, 0 errors.

**Unverified:**
- Notion's exact label ("No Status"-style) and its position (first column) were not measured. Settle them in Task M.
- Whether Notion shows an EMPTY no-value group by default was not measured. It is inferred from Notion offering "Hide empty groups" (research/03 §1.5).
- The e2e specs were NOT run. These likely assume the first or nth column is a real option:
  - `test/playwright/tests/undo-audit/gestures.spec.ts:445`: GES-7 uses `nth(1)` as the drop target.
  - `gestures.spec.ts:282`, `containers.spec.ts:257` and `w4-database.spec.ts:114`: their per-column snapshots now gain a leading column.
  - `ui/rtl-math-and-widgets.spec.ts:244`: geometry of the `first()` column. Probably still fine.
  - Run them and update any literal expectations.
- The grouped-list "+ New" `NotFoundError` from inventory §1.3 still applies (code-derived, not run), and now covers the no-value list group too. The "+ New" test here covers the board only.
- No CSS was added for the no-value column. It renders as an uncolored column with a plain pill. The visual design is unverified.
- **Not breaking** under the CLAUDE.md list. The change adds one data attribute and one i18n key. The saved-data shape is unchanged, and `null` was already a legal `PropertyValue`.

---

### Task C2: grouping by a multiSelect property

**Defect (proven by a failing test).** `toGroupKey` returns `''` for arrays (`database-model.ts:230`). A board grouped by a multiSelect therefore puts every row in the undrawn `''` group, and the board shows no cards. `getSelectOptions` does accept multiSelect (`database-model.ts:123`).

**Depends on:** C1 (`NO_VALUE_GROUP_KEY` and the no-value column).

**Files:**
- `src/tools/database/database-model.ts`:
  - `getRowsGroupedBy` loop at 108-118
  - `toGroupKey` at 226-231 becomes `toGroupKeys`
- `src/tools/database/database-card-drag.ts`: `beginTracking` at 52-61.
- `src/tools/database/index.ts`:
  - new field after 75
  - `handleAddListRow` at 1096-1098
  - new `groupValueFor` before `handleAddRow` (1116)
  - `handleAddRow` at 1126-1129
  - card pointerdown at 1378-1386
  - `handleRowDrop` at 1451
  - new `droppedGroupValue` before `handleGroupDrop` (1460)
- Tests:
  - `database-model.test.ts`: new describe before `describe('getSelectOptions'`.
  - `database-model.mutants.test.ts`: "stringifies numbers…".
  - `database.test.ts`: new describe at the end.

**Interfaces:**
- `DatabaseModel.getRowsGroupedBy(propertyId)` keeps its signature.
  - A row whose value is a non-empty array goes into EVERY key in that array.
  - A row with `[]` goes to `NO_VALUE_GROUP_KEY`.
- `private toGroupKeys(value: PropertyValue | undefined): string[]` replaces `toGroupKey`.
- `DatabaseCardDrag.beginTracking(rowId: string, startX: number, startY: number, sourceCard?: HTMLElement): void`.
  - The optional 4th argument is the card that was pressed.
  - It is needed because a multiSelect row has one card per option, and `querySelector('[data-row-id=…]')` grabs the first copy.
- New private members of `DatabaseTool`:
  - `cardDragFromOptionId: string | null`, set at card pointerdown from the pressed card's column.
  - `groupValueFor(groupByPropId, optionId): PropertyValue` returns `[optionId]` for multiSelect and `optionId` otherwise.
  - `droppedGroupValue(groupByPropId, rowId, toOptionId): PropertyValue`.
- Drop rules on a multiSelect board:
  - From X to Y: X is replaced by Y in place, and the other options stay. If the row already had Y, X is just removed (deduped).
  - From X to the no-value group: X is removed.
  - From the no-value group to Y: Y is appended.
- "+ New" in group X writes `[X]`. In the no-value group it writes nothing.
- `CardDragResult` is unchanged. Adding `fromOptionId` would break 11 `toHaveBeenCalledWith` pins in the card-drag tests.

- [ ] **Step 1: failing tests.** In `test/unit/tools/database/database-model.test.ts`, add before `describe('getSelectOptions'`:

```ts
  describe('getRowsGroupedBy on a multiSelect property', () => {
    it('puts a row in every option group it carries, and an empty list in the no-value group', () => {
      const optA = makeSelectOption({ id: 'a', label: 'A', position: 'a0' });
      const optB = makeSelectOption({ id: 'b', label: 'B', position: 'a1' });
      const prop = makeProperty({ id: 'tags', type: 'multiSelect', config: { options: [optA, optB] } });
      const model = new DatabaseModel(makeData({ schema: [prop] }));

      model.setRows([
        makeRow({ id: 'r1', position: 'a0', properties: { tags: ['a', 'b'] } }),
        makeRow({ id: 'r2', position: 'a1', properties: { tags: ['b'] } }),
        makeRow({ id: 'r3', position: 'a2', properties: { tags: [] } }),
      ]);

      const groups = model.getRowsGroupedBy('tags');

      expect(groups.get('a')?.map((r) => r.id)).toEqual(['r1']);
      expect(groups.get('b')?.map((r) => r.id)).toEqual(['r1', 'r2']);
      expect(groups.get(NO_VALUE_GROUP_KEY)?.map((r) => r.id)).toEqual(['r3']);
    });
  });

```

Then append this inside the outer `describe('DatabaseTool')` of `database.test.ts`:

```ts
  describe('grouping by a multiSelect property', () => {
    const tagsData = (): Partial<DatabaseData> => ({
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: {
          options: [
            { id: 'opt-a', label: 'A', position: 'a0' },
            { id: 'opt-b', label: 'B', position: 'a1' },
            { id: 'opt-c', label: 'C', position: 'a2' },
          ],
        }},
      ],
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-tags', sorts: [], filters: [], visibleProperties: [] }],
    });

    const renderTagsBoard = (tags: string[]): {
      tool: DatabaseTool;
      element: HTMLElement;
      options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;
      rowBlock: BlockAPI;
    } => {
      const rowBlock = createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Task', 'prop-tags': tags }, position: 'a0' });
      const options = createDatabaseOptions(tagsData(), {}, { childBlocks: [rowBlock] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();

      return { tool, element, options, rowBlock };
    };

    const cardsIn = (element: HTMLElement, optionId: string): HTMLElement[] => {
      const column = queryAllByData(element, 'data-option-id', optionId).find((el) => el.hasAttribute('data-blok-database-column'));

      return column === undefined ? [] : queryAllByData(column, 'data-blok-database-card');
    };

    const dropCard = (tool: DatabaseTool, result: CardDragResult): void => {
      (tool as unknown as { cardDrag: { onDrop: (r: CardDragResult) => void } }).cardDrag.onDrop(result);
    };

    it('shows a row in every option group it carries', () => {
      const { tool, element } = renderTagsBoard(['opt-a', 'opt-b']);

      expect(cardsIn(element, 'opt-a').map((c) => c.getAttribute('data-row-id'))).toEqual(['row-1']);
      expect(cardsIn(element, 'opt-b').map((c) => c.getAttribute('data-row-id'))).toEqual(['row-1']);
      expect(cardsIn(element, 'opt-c')).toHaveLength(0);

      tool.destroy();
    });

    it('replaces only the dragged-from option when a card moves to another group', () => {
      const { tool, element, rowBlock } = renderTagsBoard(['opt-a', 'opt-b']);
      const cardInA = cardsIn(element, 'opt-a')[0];

      fireEvent.pointerDown(cardInA, { clientX: 0, clientY: 0 });
      dropCard(tool, { rowId: 'row-1', toOptionId: 'opt-c', beforeRowId: null, afterRowId: null });

      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-c', 'opt-b'] });

      tool.destroy();
    });

    it('drops the dragged-from option when a card moves to a group the row already has', () => {
      const { tool, element, rowBlock } = renderTagsBoard(['opt-a', 'opt-b']);

      fireEvent.pointerDown(cardsIn(element, 'opt-a')[0], { clientX: 0, clientY: 0 });
      dropCard(tool, { rowId: 'row-1', toOptionId: 'opt-b', beforeRowId: null, afterRowId: null });

      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-b'] });

      tool.destroy();
    });

    it('removes the dragged-from option when a card moves to the no-value group', () => {
      const { tool, element, rowBlock } = renderTagsBoard(['opt-a', 'opt-b']);
      const noValueId = queryByData(element, 'data-blok-database-no-value-group')?.getAttribute('data-option-id') ?? 'missing';

      fireEvent.pointerDown(cardsIn(element, 'opt-b')[0], { clientX: 0, clientY: 0 });
      dropCard(tool, { rowId: 'row-1', toOptionId: noValueId, beforeRowId: null, afterRowId: null });

      expect(rowBlock.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-a'] });

      tool.destroy();
    });

    it('fades the pressed copy of a multi-group card, not the first copy', () => {
      const { tool, element } = renderTagsBoard(['opt-a', 'opt-b']);
      const cardInB = cardsIn(element, 'opt-b')[0];
      const cardInA = cardsIn(element, 'opt-a')[0];

      fireEvent.pointerDown(cardInB, { clientX: 0, clientY: 0 });
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 40 }));

      expect(cardInB.style.opacity).toBe('0.4');
      expect(cardInA.style.opacity).toBe('');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      tool.destroy();
    });

    it('creates a row carrying the option as a list from "+ New" in a multiSelect group', () => {
      const { tool, element, options } = renderTagsBoard([]);
      const column = queryAllByData(element, 'data-option-id', 'opt-a').find((el) => el.hasAttribute('data-blok-database-column'));
      const addCard = queryByData(column ?? element, 'data-blok-database-add-card');

      addCard?.click();

      const data = vi.mocked(options.api.blocks.insertAt).mock.calls[0][1] as DatabaseRowData;

      expect(data.properties['prop-tags']).toEqual(['opt-a']);

      tool.destroy();
    });
  });

```

- [ ] **Step 2: run, expect FAIL.**
  - `npx vitest run test/unit/tools/database/database-model.test.ts -t "multiSelect property"`: 1 failed, with `AssertionError: expected undefined to deeply equal [ 'r1' ]`. The defect is real.
  - `npx vitest run test/unit/tools/database/database.test.ts -t "grouping by a multiSelect property"`, with C1 applied and C2 not: 5 failed.
    - `expected "vi.fn()" to be called with arguments: [ 'updateProperties', …(1) ]` (3 times): the drop wrote a plain string.
    - `expected '' to be '0.4'`: the wrong copy faded.
    - `expected 'opt-a' to deeply equal [ 'opt-a' ]`: "+ New" wrote a string.
  - Against HEAD source (record at the top):
    - `shows a row in every option group it carries` failed with `expected [] to deeply equal [ 'row-1' ]`.
    - The three drop tests and the fade test failed with `Unable to fire a "pointerdown" event - please provide a DOM element`: at HEAD no card is drawn in `opt-a`/`opt-b` at all.
    - "+ New" failed with `expected 'opt-a' to deeply equal [ 'opt-a' ]`.
  - `shows a row in every option group it carries` already passed in the C1-applied run, because the model fix was in place. With only the array line of `toGroupKeys` removed, it fails with `expected [] to deeply equal [ 'row-1' ]`.

- [ ] **Step 3: minimal implementation.**

`src/tools/database/database-model.ts`:
```diff
@@ getRowsGroupedBy (108-118)
     for (const row of ordered) {
-      const rawValue = row.properties[propertyId];
-      const key = this.toGroupKey(rawValue);
-      const existing = groups.get(key);
-      if (existing !== undefined) {
-        existing.push(row);
-      } else {
-        groups.set(key, [row]);
+      for (const key of this.toGroupKeys(row.properties[propertyId])) {
+        const group = groups.get(key) ?? [];
+
+        group.push(row);
+        groups.set(key, group);
       }
     }
@@ toGroupKey (after C1)
-  private toGroupKey(value: PropertyValue | undefined): string {
-    if (value === undefined || value === null || value === '') return NO_VALUE_GROUP_KEY;
-    if (typeof value === 'string') return value;
-    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
-    return NO_VALUE_GROUP_KEY;
+  private toGroupKeys(value: PropertyValue | undefined): string[] {
+    if (Array.isArray(value)) return value.length > 0 ? value : [NO_VALUE_GROUP_KEY];
+    if (value === undefined || value === null || value === '') return [NO_VALUE_GROUP_KEY];
+    if (typeof value === 'string') return [value];
+    if (typeof value === 'boolean' || typeof value === 'number') return [String(value)];
+    return [NO_VALUE_GROUP_KEY];
   }
```
The inner loop uses `?? []`, then `push`, then `set`. Keeping the original `if/else` inside the new inner loop failed `max-depth` with `117:9 error Blocks are nested too deeply (3)`.

`src/tools/database/database-card-drag.ts`:
```diff
   /**
    * Start tracking pointer after a pointerdown on a card.
+   * A multiSelect board draws one card per option, so pass the pressed card.
    */
-  public beginTracking(rowId: string, startX: number, startY: number): void {
+  public beginTracking(rowId: string, startX: number, startY: number, sourceCard?: HTMLElement): void {
 ...
-    this.sourceCard = this.wrapper.querySelector(`[data-row-id="${rowId}"]`);
+    this.sourceCard = sourceCard ?? this.wrapper.querySelector(`[data-row-id="${rowId}"]`);
```

`src/tools/database/index.ts`:
```diff
   private cardDrag: DatabaseCardDrag | null = null;
+  /** Group of the card the pointer pressed; a multiSelect drop replaces this option. */
+  private cardDragFromOptionId: string | null = null;
@@ handleAddListRow
-      properties[groupByPropId] = optionId;
+      properties[groupByPropId] = this.groupValueFor(groupByPropId, optionId);
@@ before handleAddRow
+  private groupValueFor(groupByPropId: string, optionId: string): PropertyValue {
+    return this.model.getProperty(groupByPropId)?.type === 'multiSelect' ? [optionId] : optionId;
+  }
+
@@ handleAddRow
-      : { [titlePropId]: '', [groupByPropId]: optionId });
+      : { [titlePropId]: '', [groupByPropId]: this.groupValueFor(groupByPropId, optionId) });
@@ pointerdown, card branch
-      const cardEl = target.closest('[data-blok-database-card]');
+      const cardEl = target.closest<HTMLElement>('[data-blok-database-card]');
 ...
-          this.cardDrag?.beginTracking(rowId, e.clientX, e.clientY);
+          this.cardDragFromOptionId = cardEl.closest('[data-blok-database-column]')?.getAttribute('data-option-id') ?? null;
+          this.cardDrag?.beginTracking(rowId, e.clientX, e.clientY, cardEl);
@@ handleRowDrop
-    const value = toOptionId === NO_VALUE_GROUP_KEY ? null : toOptionId;
+    const value = this.droppedGroupValue(groupByPropId, rowId, toOptionId);
@@ before handleGroupDrop
+  private droppedGroupValue(groupByPropId: string, rowId: string, toOptionId: string): PropertyValue {
+    const target = toOptionId === NO_VALUE_GROUP_KEY ? null : toOptionId;
+
+    if (this.model.getProperty(groupByPropId)?.type !== 'multiSelect') {
+      return target;
+    }
+
+    const current = this.model.getRow(rowId)?.properties[groupByPropId];
+    const list = Array.isArray(current) ? current : [];
+    const from = this.cardDragFromOptionId;
+    const next = list.some((id) => id === from)
+      ? list.map((id) => (id === from ? target : id))
+      : [...list, target];
+
+    return [...new Set(next.filter((id): id is string => id !== null))];
+  }
+
```

**Expected pin update.** In `database-model.mutants.test.ts`, the test "stringifies numbers and drops list values into the no-value group" pinned the defect itself (arrays landed in the empty group).
- Rename it to `stringifies numbers and puts a list row in each of its values' groups`.
- Its expected map becomes `['5', [numeric]], ['x', [list]], ['y', [list]], [NO_VALUE_GROUP_KEY, [missing]]`.

- [ ] **Step 4: run, expect PASS.**
  - `-t "grouping by a multiSelect property"`: 6 passed.
  - Full files, all green:

| Suite | Tests |
|---|---|
| database | 141/141 |
| database-model | 46/46 |
| database-model.mutants | 24/24 |
| database-card-drag | 12 |
| database-card-drag.mutants | 38 |
| database-board-view | 75 |
| database-board-view.mutants | 29 |
| database-column-drag | 9 |
| database-column-drag.mutants | 31 |
| database-list-view | 41 |
| database-list-view.mutants | 23 |
| concurrent-database-loss | 26 |
| concurrent-database-loss-wave2 | 8 |

- [ ] **Step 5: lint.** Ran `npx eslint src/tools/database/database-model.ts src/tools/database/index.ts src/tools/database/database-card-drag.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-model.test.ts test/unit/tools/database/database-model.mutants.test.ts`.
  - The first run hit the `max-depth` error above. I fixed it as shown.
  - The rerun was clean.
- [ ] **Step 6: commit.**
```
git add src/tools/database/database-model.ts src/tools/database/index.ts src/tools/database/database-card-drag.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-model.test.ts test/unit/tools/database/database-model.mutants.test.ts
git commit -m "fix(database): group multi-select rows under every option they carry"
```

**Evidence:** the FAIL and PASS runs above.

**Unverified, and known gaps left out on purpose (not fixed):**
- Notion's multi-select board behaviour was not measured: does a card show in every option column, and does a drag replace or add the option? Settle this in Task M.
- `position` is per row, not per group. Reordering a multi-option card inside column Y also moves its copy in column X.
- `DatabaseBoardView.updateRowTitle` and `removeRow` (`database-board-view.ts:91-124`) each use a single `querySelector`. An inline retitle or "Delete card" updates only the first copy until the next rerender. Not tested.
- `commitDrop` (`database-card-drag.ts:301-302`) leaves out every card with the dragged row id from the target column's neighbours. That includes the row's own copy when the row already has that option.
- A value array with duplicate ids (`['a','a']`) would draw two copies in one column. This is not deduped and not tested.
- The list view's drag between groups still never changes the group value (inventory §1.3). Out of scope here.
- Grouping by a non-select property, such as checkbox, now draws only the no-value column, because `getSelectOptions` returns `[]`. This is not new: those groups were never drawn before either.

---

### Task C3: deleting a board column keeps its rows (GATED ON USER DECISION D9)

> **Skip this whole task if D9 is decided differently.** C1 and C2 do not depend on it. If you skip it, the old test `describe('column delete cascades block deletions for rows')` stays as is, with only C1's `remainingColumns` change from 2 to 3.

**Defect (proven by a failing test).** `handleOptionDelete` deletes every row in the column, with no confirm (`index.ts:1565-1572`). D9 recommends that the rows lose the value and move to the "No ⟨property⟩" group instead.

**Depends on:** C1, so the rows land somewhere visible. Also C2, if the board may be grouped by a multiSelect.

**Files:**
- `src/tools/database/index.ts`: `onDelete` wiring at 1228; `handleOptionDelete` at 1547-1578.
- `test/unit/tools/database/database.test.ts`:
  - Delete `describe('column delete cascades block deletions for rows')`, which runs from line 728 to just before `describe('add column uses correct i18n key')`.
  - Add a new describe at the end.

**Interfaces:**
- The signature becomes `private handleOptionDelete(optionId: string): void`. The `boardEl` parameter is dropped because it is no longer used (lint `no-unused-vars`).
- Each row in the group gets a new value through `updateRowBlock` + `sync.syncUpdateRow`:
  - On a select property, the value becomes `null`.
  - On a multiSelect property, the value becomes the array without `optionId`.
- After that, the option is removed and the view is redrawn with `rerenderView()` instead of `view.removeGroup`. This is what makes the rows appear in the no-value column.
- Adapter calls change: one `syncUpdateRow` per row replaces one `syncDeleteRow` per row.
- The last-option guard (`options.length <= 1`) is kept.

- [ ] **Step 1: failing tests.** Append this inside the outer `describe('DatabaseTool')`:

```ts
  // GATED ON USER DECISION D9: rows keep existing when their column is deleted.
  describe('deleting a board column', () => {
    const liveRowBlock = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
      });

      return block;
    };

    const clickDelete = (element: HTMLElement, optionId: string): void => {
      queryAllByData(element, 'data-blok-database-delete-column')
        .find((el) => el.getAttribute('data-option-id') === optionId)
        ?.click();
    };

    it('keeps the rows and moves them to the no-value group', () => {
      const childBlocks = [
        liveRowBlock('row-1', { 'prop-title': 'Task 1', 'prop-status': 'opt-todo' }, 'a0'),
        liveRowBlock('row-2', { 'prop-title': 'Task 2', 'prop-status': 'opt-todo' }, 'a1'),
      ];
      const options = createDatabaseOptions({}, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      clickDelete(element, 'opt-todo');

      expect(options.api.blocks.delete).not.toHaveBeenCalled();
      expect(childBlocks[0].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });
      expect(childBlocks[1].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });

      const noValue = queryByData(element, 'data-blok-database-no-value-group');
      const cardIds = queryAllByData(noValue ?? element, 'data-blok-database-card').map((c) => c.getAttribute('data-row-id'));

      expect(cardIds).toEqual(['row-1', 'row-2']);
      expect(queryAllByData(element, 'data-option-id', 'opt-todo')).toHaveLength(0);

      tool.destroy();
    });

    it('removes only the deleted option from a multiSelect row', () => {
      const row = liveRowBlock('row-1', { 'prop-title': 'Task', 'prop-tags': ['opt-a', 'opt-b'] }, 'a0');
      const options = createDatabaseOptions({
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          { id: 'prop-tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: {
            options: [
              { id: 'opt-a', label: 'A', position: 'a0' },
              { id: 'opt-b', label: 'B', position: 'a1' },
            ],
          }},
        ],
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-tags', sorts: [], filters: [], visibleProperties: [] }],
      }, {}, { childBlocks: [row] });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      clickDelete(element, 'opt-a');

      expect(options.api.blocks.delete).not.toHaveBeenCalled();
      expect(row.call).toHaveBeenCalledWith('updateProperties', { 'prop-tags': ['opt-b'] });

      tool.destroy();
    });
  });
```

- [ ] **Step 2: run, expect FAIL.** `npx vitest run test/unit/tools/database/database.test.ts -t "deleting a board column"` gave 2 failures. The defect is real. The same two failures show against HEAD source (record at the top).
  - `expected "vi.fn()" to not be called at all, but actually been called 2 times` (`blocks.delete`)
  - `… been called 1 times` (the multiSelect case)
- [ ] **Step 3: minimal implementation** (`src/tools/database/index.ts`):
```diff
-        onDelete: (optionId) => this.handleOptionDelete(optionId, boardEl),
+        onDelete: (optionId) => this.handleOptionDelete(optionId),
@@
-  private handleOptionDelete(optionId: string, boardEl: HTMLDivElement): void {
+  private handleOptionDelete(optionId: string): void {
@@
-    // Delete rows in this group
-    const groups = this.model.getRowsGroupedBy(groupByPropId);
-    const rowsInGroup = groups.get(optionId) ?? [];
+    const rowsInGroup = this.model.getRowsGroupedBy(groupByPropId).get(optionId) ?? [];

     for (const row of rowsInGroup) {
-      this.deleteRowBlock(row.id);
-      void this.sync.syncDeleteRow({ rowId: row.id });
+      const current = row.properties[groupByPropId];
+      const value = Array.isArray(current) ? current.filter((id) => id !== optionId) : null;
+
+      this.updateRowBlock(row.id, { [groupByPropId]: value });
+      this.sync.syncUpdateRow({ rowId: row.id, properties: { [groupByPropId]: value } });
     }

-    // Remove the option
     const filteredOptions = prop.config.options.filter((o) => o.id !== optionId);
     this.model.updateProperty(groupByPropId, { config: { options: filteredOptions } });
-    this.view.removeGroup?.(boardEl, optionId);
+    this.rerenderView();
     void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: filteredOptions } } });
```
Then delete the old test that pinned row deletion. It begins:
```ts
  describe('column delete cascades block deletions for rows', () => {
    it('calls api.blocks.delete for each row then adapter.updateProperty when option is deleted', async () => {
      const deleteRowCalls: string[] = [];
      const updatePropertyCalls: Array<{ propertyId: string }> = [];

      const mockAdapter = {
        loadDatabase: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        mo...
```

- [ ] **Step 4: run, expect PASS.**
  - `-t "deleting a board column"`: 2 passed.
  - After removing the old test, all green:

| Suite | Tests |
|---|---|
| database | 142/142 |
| database-model | 46 |
| database-model.mutants | 24 |
| database-card-drag | 12 |
| database-card-drag.mutants | 38 |
| database-board-view | 75 |
| database-board-view.mutants | 29 |
| database-column-drag | 9 |
| database-column-drag.mutants | 31 |
| database-column-controls | 14 |
| database-column-controls.mutants | 12 |
| database-list-view | 41 |
| database-list-view.mutants | 23 |
| database-view | 55 |
| database-view.mutants | 12 |
| concurrent-database-loss | 26 |
| concurrent-database-loss-wave2 | 8 |

- [ ] **Step 5: lint.** Ran `npx eslint src/tools/database/index.ts test/unit/tools/database/database.test.ts`.
  - The first run gave `1585:48 error 'boardEl' is defined but never used`. I fixed it by dropping the parameter.
  - The rerun was clean.
- [ ] **Step 6: commit.** Whether to label it is the user's call; see Evidence.
```
git add src/tools/database/index.ts test/unit/tools/database/database.test.ts
git commit -m "fix(database)!: BREAKING keep rows when their board column is deleted" -m "BREAKING CHANGE: deleting a board column used to delete every row in it and call adapter.deleteRow for each. It now clears the group value (null, or the option removed from a multi-select list), calls adapter.updateRow, and the rows show in the No <property> group. Hosts that relied on deleteRow firing must listen for updateRow instead."
```

**Evidence:**
- **Breaking check.** The last tag is `v1.16.1`. The delete-with-rows code ("Delete rows in this group") is in `git show v1.16.1:src/tools/database/index.ts` at line 1567, and its origin commit `7f372a16` is an ancestor of `v1.16.1`. So this behaviour has shipped.
- Adapter consumers see the change at runtime: `deleteRow` no longer fires, and `updateRow` fires instead. That is why the commit carries the BREAKING label. Tell the user when making the change.

**Unverified:**
- Notion's real behaviour when a select option or group is deleted was not measured. D9 says to re-check it in Task M.
- No confirm dialog was added. D9 says "never delete rows without a confirm", and this path no longer deletes rows.
- **A compatible route exists**, as the CLAUDE.md breaking-change rule asks to state: keep deleting rows, but only behind a confirm. That avoids the adapter-call break. D9 picks between the two routes.
- `adapter.updateRow` is debounced in `DatabaseBackendSync.syncUpdateRow` (`database-backend-sync.ts:42-48`). The new tests check only the row-block writes, not the adapter call.
- Undo of a column delete, which is now a multi-row update plus a schema change, is not tested.

---

## Workstream D: in-memory query engine (filters, sorts, query shape)

Saved `view.filters` and `view.sorts` exist in data today but nothing reads them (inventory §3). This workstream adds a pure engine, `src/tools/database/database-query.ts`. It gives the model the query shape from `docs/plans/2026-08-22-database-block-architecture.md` (`queryRows` / `queryGroups`), and points the board and list renderers at it.

**No saved-data change.** `FilterConfig` stays `{propertyId, operator: string, value}`. Filters combine with AND. `SortConfig` is unchanged.

**Coordination with Task C (grouping):** the engine never groups by itself. It calls `groupKeysOf(row): string[]`, which the model supplies (`DatabaseModel.groupKeysOf(propertyId)`). Task C changes only the body of `groupKeysOf` (empty group, one key per multiSelect option). The engine and every caller stay the same. Grouping runs after filtering, because `queryRows` and `queryGroups` filter first and then ask for keys.

**Evidence base:** every code block below is the exact code run in a scratch worktree (`~/Packages/.blok-undo/dbp-query`, detached at `665c077a`). The full diff is in `phase-0-artifacts/D-query.diff`. In this session the D1-D3 tests ran as **one** file, not one task at a time. The per-task FAIL output for D2 and D3 is therefore expected, not observed (see Unverified).

---

### Task D1: filter operators and row matching

**Files:**
- Create: `src/tools/database/database-query.ts`
- Create: `test/unit/tools/database/database-query.test.ts`

**Interfaces:**
- Consumes: `DatabaseRow`, `FilterConfig`, `PropertyDefinition`, `PropertyType`, `PropertyValue` from `src/tools/database/types.ts` (unchanged).
- Produces:
  - `export const FILTER_OPERATORS: Readonly<Record<PropertyType, readonly string[]>>`
  - `export const rowMatchesFilters: (row: DatabaseRow, filters: FilterConfig[], schema: PropertyDefinition[]) => boolean`

Rules this task fixes:
- Operator names are Notion API names (research/04 §2), limited to Blok's current types.
- Text matching (`title`, `text`, `url`, `richText` string values) is case-insensitive.
- **A filter the engine cannot read lets the row through.** That covers an unknown operator, an operator that does not fit the type, a deleted property, and a missing or blank value. Hiding rows on a filter that a newer client wrote would look like data loss.
- `''`, `null`, `undefined` and `[]` count as empty. `Number('')` is 0, so number parsing treats a blank string as empty on purpose.
- Checkbox: missing counts as unchecked.
- Date: compares the calendar day (`YYYY-MM-DD` prefix of an ISO string).
- `richText` holding an OutputData body: `is_empty` means `blocks.length === 0`. Text operators let it through, because no plain-text extractor is wired yet.

- [ ] **Step 1: write the failing test** (`test/unit/tools/database/database-query.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FILTER_OPERATORS, rowMatchesFilters } from '../../../../src/tools/database/database-query';
import type { DatabaseRow, FilterConfig, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'text', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'num', name: 'Score', type: 'number', position: 'a2' },
  {
    id: 'status', name: 'Status', type: 'select', position: 'a3', config: {
      options: [
        { id: 'opt-late', label: 'Late', position: 'a2' },
        { id: 'opt-early', label: 'Early', position: 'a0' },
        { id: 'opt-mid', label: 'Mid', position: 'a1' },
      ],
    },
  },
  {
    id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a4', config: {
      options: [
        { id: 'tag-b', label: 'B', position: 'a1' },
        { id: 'tag-a', label: 'A', position: 'a0' },
      ],
    },
  },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a5' },
  { id: 'due', name: 'Due', type: 'date', position: 'a6' },
  { id: 'link', name: 'Link', type: 'url', position: 'a7' },
  { id: 'body', name: 'Body', type: 'richText', position: 'a8' },
];

const row = (id: string, position: string, properties: Record<string, PropertyValue> = {}): DatabaseRow => ({
  id,
  position,
  properties,
});

const matches = (r: DatabaseRow, filter: FilterConfig): boolean => rowMatchesFilters(r, [filter], schema);

describe('database-query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FILTER_OPERATORS', () => {
    it('lists the Notion API operator names per property type', () => {
      expect(FILTER_OPERATORS.text).toEqual([
        'equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
      ]);
      expect(FILTER_OPERATORS.title).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.url).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.richText).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.number).toEqual([
        'equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'is_empty', 'is_not_empty',
      ]);
      expect(FILTER_OPERATORS.select).toEqual(['equals', 'does_not_equal', 'is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.multiSelect).toEqual(['contains', 'does_not_contain', 'is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.checkbox).toEqual(['equals', 'does_not_equal']);
      expect(FILTER_OPERATORS.date).toEqual(['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty']);
    });
  });

  describe('rowMatchesFilters — text', () => {
    const r = row('r', 'a0', { text: 'Hello World' });

    it.each([
      ['equals', 'hello world', true],
      ['equals', 'hello', false],
      ['does_not_equal', 'hello', true],
      ['does_not_equal', 'HELLO WORLD', false],
      ['contains', 'LO wo', true],
      ['contains', 'xyz', false],
      ['does_not_contain', 'xyz', true],
      ['does_not_contain', 'world', false],
      ['starts_with', 'hel', true],
      ['starts_with', 'world', false],
      ['ends_with', 'WORLD', true],
      ['ends_with', 'hello', false],
    ])('%s %s → %s (case-insensitive)', (operator, value, expected) => {
      expect(matches(r, { propertyId: 'text', operator, value })).toBe(expected);
    });

    it('treats a missing or blank value as empty', () => {
      const blank = row('b', 'a0', { text: '' });
      const missing = row('m', 'a0');

      expect(matches(blank, { propertyId: 'text', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(missing, { propertyId: 'text', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'text', operator: 'is_empty', value: null })).toBe(false);
      expect(matches(r, { propertyId: 'text', operator: 'is_not_empty', value: null })).toBe(true);
      expect(matches(missing, { propertyId: 'text', operator: 'is_not_empty', value: null })).toBe(false);
    });

    it('applies text operators to title and url', () => {
      const r2 = row('r2', 'a0', { title: 'Launch plan', link: 'https://example.com' });

      expect(matches(r2, { propertyId: 'title', operator: 'contains', value: 'PLAN' })).toBe(true);
      expect(matches(r2, { propertyId: 'link', operator: 'ends_with', value: '.com' })).toBe(true);
    });

    it('lets a text filter with no value through, so a half-built filter hides nothing', () => {
      expect(matches(r, { propertyId: 'text', operator: 'contains', value: '' })).toBe(true);
      expect(matches(r, { propertyId: 'text', operator: 'equals', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — richText', () => {
    it('matches a string value as text', () => {
      expect(matches(row('r', 'a0', { body: 'Some notes' }), { propertyId: 'body', operator: 'contains', value: 'notes' })).toBe(true);
    });

    it('counts a body document with no blocks as empty and one with blocks as not empty', () => {
      const emptyDoc = row('e', 'a0', { body: { blocks: [] } });
      const fullDoc = row('f', 'a0', { body: { blocks: [{ type: 'paragraph', data: { text: 'x' } }] } });

      expect(matches(emptyDoc, { propertyId: 'body', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(fullDoc, { propertyId: 'body', operator: 'is_empty', value: null })).toBe(false);
      expect(matches(fullDoc, { propertyId: 'body', operator: 'is_not_empty', value: null })).toBe(true);
    });

    it('lets text operators through on a body document, which has no plain text yet', () => {
      const fullDoc = row('f', 'a0', { body: { blocks: [{ type: 'paragraph', data: { text: 'x' } }] } });

      expect(matches(fullDoc, { propertyId: 'body', operator: 'contains', value: 'zzz' })).toBe(true);
    });
  });

  describe('rowMatchesFilters — number', () => {
    const r = row('r', 'a0', { num: 5 });

    it.each([
      ['equals', 5, true],
      ['equals', '5', true],
      ['equals', 4, false],
      ['does_not_equal', 4, true],
      ['greater_than', 4, true],
      ['greater_than', 5, false],
      ['greater_than_or_equal_to', 5, true],
      ['less_than', 6, true],
      ['less_than', 5, false],
      ['less_than_or_equal_to', 5, true],
      ['less_than_or_equal_to', 4, false],
    ])('%s %s → %s', (operator, value, expected) => {
      expect(matches(r, { propertyId: 'num', operator, value })).toBe(expected);
    });

    it('treats a blank string as empty, not as 0', () => {
      const blank = row('b', 'a0', { num: '' });

      expect(matches(blank, { propertyId: 'num', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(blank, { propertyId: 'num', operator: 'equals', value: 0 })).toBe(false);
      expect(matches(row('z', 'a0', { num: 0 }), { propertyId: 'num', operator: 'is_empty', value: null })).toBe(false);
    });

    it('lets a number filter with a blank or non-numeric value through', () => {
      expect(matches(r, { propertyId: 'num', operator: 'equals', value: '' })).toBe(true);
      expect(matches(r, { propertyId: 'num', operator: 'greater_than', value: 'abc' })).toBe(true);
    });
  });

  describe('rowMatchesFilters — select', () => {
    const r = row('r', 'a0', { status: 'opt-mid' });

    it('equals and does_not_equal compare the option id', () => {
      expect(matches(r, { propertyId: 'status', operator: 'equals', value: 'opt-mid' })).toBe(true);
      expect(matches(r, { propertyId: 'status', operator: 'equals', value: 'opt-late' })).toBe(false);
      expect(matches(r, { propertyId: 'status', operator: 'does_not_equal', value: 'opt-late' })).toBe(true);
    });

    it('accepts a list of option ids as any-match', () => {
      expect(matches(r, { propertyId: 'status', operator: 'equals', value: ['opt-late', 'opt-mid'] })).toBe(true);
      expect(matches(r, { propertyId: 'status', operator: 'does_not_equal', value: ['opt-late', 'opt-mid'] })).toBe(false);
    });

    it('is_empty matches a row with no option', () => {
      expect(matches(row('e', 'a0'), { propertyId: 'status', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'status', operator: 'is_not_empty', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — multiSelect', () => {
    const r = row('r', 'a0', { tags: ['tag-a'] });

    it('contains and does_not_contain take one id or a list (any-match)', () => {
      expect(matches(r, { propertyId: 'tags', operator: 'contains', value: 'tag-a' })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'contains', value: ['tag-b', 'tag-a'] })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'contains', value: 'tag-b' })).toBe(false);
      expect(matches(r, { propertyId: 'tags', operator: 'does_not_contain', value: 'tag-b' })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'does_not_contain', value: 'tag-a' })).toBe(false);
    });

    it('is_empty matches an empty or missing list', () => {
      expect(matches(row('e', 'a0', { tags: [] }), { propertyId: 'tags', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(row('m', 'a0'), { propertyId: 'tags', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'is_not_empty', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — checkbox', () => {
    it('reads a missing value as unchecked', () => {
      expect(matches(row('m', 'a0'), { propertyId: 'done', operator: 'equals', value: false })).toBe(true);
      expect(matches(row('t', 'a0', { done: true }), { propertyId: 'done', operator: 'equals', value: true })).toBe(true);
      expect(matches(row('t', 'a0', { done: true }), { propertyId: 'done', operator: 'does_not_equal', value: true })).toBe(false);
    });
  });

  describe('rowMatchesFilters — date', () => {
    const r = row('r', 'a0', { due: '2026-10-09T15:00:00.000Z' });

    it.each([
      ['equals', '2026-10-09', true],
      ['equals', '2026-10-10', false],
      ['before', '2026-10-10', true],
      ['before', '2026-10-09', false],
      ['after', '2026-10-08', true],
      ['after', '2026-10-09', false],
      ['on_or_before', '2026-10-09', true],
      ['on_or_after', '2026-10-09', true],
      ['on_or_after', '2026-10-10', false],
    ])('%s %s → %s (compares the calendar day)', (operator, value, expected) => {
      expect(matches(r, { propertyId: 'due', operator, value })).toBe(expected);
    });

    it('is_empty matches a row with no date', () => {
      expect(matches(row('e', 'a0'), { propertyId: 'due', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'due', operator: 'is_not_empty', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — forward compatibility', () => {
    const r = row('r', 'a0', { text: 'abc', status: 'opt-mid' });

    it('lets a row through an operator it does not know', () => {
      expect(matches(r, { propertyId: 'text', operator: 'matches_regex', value: 'zzz' })).toBe(true);
    });

    it('lets a row through an operator that does not fit the property type', () => {
      expect(matches(r, { propertyId: 'status', operator: 'greater_than', value: 'zzz' })).toBe(true);
    });

    it('lets a row through a filter on a deleted property', () => {
      expect(matches(r, { propertyId: 'gone', operator: 'equals', value: 'zzz' })).toBe(true);
    });

    it('combines filters with AND', () => {
      const filters: FilterConfig[] = [
        { propertyId: 'text', operator: 'contains', value: 'a' },
        { propertyId: 'status', operator: 'equals', value: 'opt-late' },
      ];

      expect(rowMatchesFilters(r, filters, schema)).toBe(false);
      expect(rowMatchesFilters(r, [filters[0]], schema)).toBe(true);
    });
  });

});
```

- [ ] **Step 2: run it, watch it FAIL**

`npx vitest run test/unit/tools/database/database-query.test.ts`

Observed (whole-file run in this session): `Error: Failed to resolve import "../../../../src/tools/database/database-query" ... Does the file exist?` and `Test Files 1 failed (1)`.

- [ ] **Step 3: minimal implementation** (`src/tools/database/database-query.ts`)

```ts
import type { DatabaseRow, FilterConfig, PropertyDefinition, PropertyType, PropertyValue } from './types';

const TEXT_OPERATORS = ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'] as const;

/** Operator names follow the Notion API, so saved filters stay portable. */
export const FILTER_OPERATORS: Readonly<Record<PropertyType, readonly string[]>> = {
  title: TEXT_OPERATORS,
  text: TEXT_OPERATORS,
  url: TEXT_OPERATORS,
  richText: TEXT_OPERATORS,
  number: ['equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'is_empty', 'is_not_empty'],
  select: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  multiSelect: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  checkbox: ['equals', 'does_not_equal'],
  date: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'],
};

const isBlank = (value: PropertyValue | undefined): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

const toNumber = (value: PropertyValue | undefined): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The calendar day of an ISO string; time and zone are ignored. */
const toDay = (value: PropertyValue | undefined): string | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;

const toIdList = (value: PropertyValue): string[] => {
  if (Array.isArray(value)) return value;

  return typeof value === 'string' && value !== '' ? [value] : [];
};

/** `undefined` means "this filter does not apply", so the row passes. */
const matchText = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const isDocument = typeof value === 'object' && value !== null && !Array.isArray(value);

  if (operator === 'is_empty' || operator === 'is_not_empty') {
    const empty = isDocument ? value.blocks.length === 0 : isBlank(value);

    return operator === 'is_empty' ? empty : !empty;
  }
  if (isDocument || typeof target !== 'string' || target === '') return undefined;

  const text = (typeof value === 'string' || typeof value === 'number' ? String(value) : '').toLowerCase();
  const needle = target.toLowerCase();

  switch (operator) {
    case 'equals': return text === needle;
    case 'does_not_equal': return text !== needle;
    case 'contains': return text.includes(needle);
    case 'does_not_contain': return !text.includes(needle);
    case 'starts_with': return text.startsWith(needle);
    case 'ends_with': return text.endsWith(needle);
    default: return undefined;
  }
};

const matchNumber = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const n = toNumber(value);

  if (operator === 'is_empty') return n === undefined;
  if (operator === 'is_not_empty') return n !== undefined;

  const t = toNumber(target);

  if (t === undefined) return undefined;
  if (n === undefined) return operator === 'does_not_equal';

  switch (operator) {
    case 'equals': return n === t;
    case 'does_not_equal': return n !== t;
    case 'greater_than': return n > t;
    case 'greater_than_or_equal_to': return n >= t;
    case 'less_than': return n < t;
    case 'less_than_or_equal_to': return n <= t;
    default: return undefined;
  }
};

const matchSelect = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const current = typeof value === 'string' ? value : '';

  if (operator === 'is_empty') return current === '';
  if (operator === 'is_not_empty') return current !== '';

  const wanted = toIdList(target);

  if (wanted.length === 0) return undefined;
  if (operator === 'equals') return wanted.includes(current);
  if (operator === 'does_not_equal') return !wanted.includes(current);

  return undefined;
};

const matchMultiSelect = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const current = Array.isArray(value) ? value : [];

  if (operator === 'is_empty') return current.length === 0;
  if (operator === 'is_not_empty') return current.length > 0;

  const wanted = toIdList(target);

  if (wanted.length === 0) return undefined;

  const hit = wanted.some((id) => current.includes(id));

  if (operator === 'contains') return hit;
  if (operator === 'does_not_contain') return !hit;

  return undefined;
};

const matchCheckbox = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  if (typeof target !== 'boolean') return undefined;
  const checked = value === true;

  if (operator === 'equals') return checked === target;
  if (operator === 'does_not_equal') return checked !== target;

  return undefined;
};

const matchDate = (value: PropertyValue | undefined, operator: string, target: PropertyValue): boolean | undefined => {
  const day = toDay(value);

  if (operator === 'is_empty') return day === undefined;
  if (operator === 'is_not_empty') return day !== undefined;

  const t = toDay(target);

  if (t === undefined) return undefined;
  if (day === undefined) return false;

  switch (operator) {
    case 'equals': return day === t;
    case 'before': return day < t;
    case 'after': return day > t;
    case 'on_or_before': return day <= t;
    case 'on_or_after': return day >= t;
    default: return undefined;
  }
};

const MATCHERS: Record<PropertyType, (value: PropertyValue | undefined, operator: string, target: PropertyValue) => boolean | undefined> = {
  title: matchText,
  text: matchText,
  url: matchText,
  richText: matchText,
  number: matchNumber,
  select: matchSelect,
  multiSelect: matchMultiSelect,
  checkbox: matchCheckbox,
  date: matchDate,
};

/**
 * AND of every filter. A filter the engine cannot read (unknown operator,
 * wrong type, deleted property, missing value) lets the row through: hiding
 * rows on a filter written by a newer client would look like data loss.
 */
export const rowMatchesFilters = (row: DatabaseRow, filters: FilterConfig[], schema: PropertyDefinition[]): boolean =>
  filters.every((filter) => {
    const property = schema.find((p) => p.id === filter.propertyId);

    if (property === undefined || !FILTER_OPERATORS[property.type].includes(filter.operator)) return true;

    return MATCHERS[property.type](row.properties[filter.propertyId], filter.operator, filter.value) ?? true;
  });
```

- [ ] **Step 4: run it, watch it PASS**

Same command. Observed for the combined file (D1+D2+D3): `Tests 68 passed (68)`.

- [ ] **Step 5: lint**

`npx eslint src/tools/database/database-query.ts test/unit/tools/database/database-query.test.ts`

Observed: the first draft failed with 5 errors (`no-nested-ternary` x2, `no-restricted-syntax` on a `let` loop counter, `switch-exhaustiveness-check` on a `default:` branch in `sortKeyOf`, `max-depth`). The code in this plan is the fixed version. After the fix, eslint printed nothing (clean).

- [ ] **Step 6: commit**

```bash
git add src/tools/database/database-query.ts test/unit/tools/database/database-query.test.ts
git commit -m "feat(database): match rows against saved view filters"
```

---

### Task D2: sorting

**Files:**
- Modify: `src/tools/database/database-query.ts` (append; add `SortConfig` to the type import)
- Modify: `test/unit/tools/database/database-query.test.ts`

**Interfaces:**
- Consumes: `SortConfig` from `types.ts` (unchanged); `DatabaseModel.getOrderedRows()` (test only, as the parity oracle).
- Produces: `export const sortRows: (rows: DatabaseRow[], sorts: SortConfig[], schema: PropertyDefinition[]) => DatabaseRow[]` (returns a new array; the input is not reordered).

Rules this task fixes:
- Multiple sorts apply in list order. A sort on a deleted property is skipped.
- **Tie-break is row `position` with `localeCompare`**, the same comparison as `DatabaseModel.getOrderedRows()`. Keys mix letter case, and `<` orders case differently from `localeCompare` (`database-model.ts` `randomKeySuffix` doc). A test pins parity on the keys `a0`, `a1`, `Zz`.
- Select and multiSelect sort by option `position`, compared with `<`, like `getSelectOptions`. So sort order matches column order. MultiSelect compares the row's option positions, sorted, as a list.
- Number sorts numerically. Text sorts with `localeCompare`. Checkbox sorts unchecked first when ascending. Date sorts by day string.
- **Empties go last in both directions (D8, gated, unverified in Notion).** The empty check runs before the direction sign is applied.

- [ ] **Step 1: write the failing test**

Add to the test file's imports: `sortRows` from `database-query`, `DatabaseModel` from `../../../../src/tools/database/database-model`, and `SortConfig` from types. Add this helper next to `row`:

```ts
const ids = (rows: DatabaseRow[]): string[] => rows.map((r) => r.id);
```

Add inside `describe('database-query')`:

```ts
  describe('sortRows', () => {
    const sort = (rows: DatabaseRow[], sorts: SortConfig[]): string[] => ids(sortRows(rows, sorts, schema));

    it('keeps position order when there are no sorts, comparing like getOrderedRows', () => {
      const rows = [row('b', 'a1'), row('c', 'Zz'), row('a', 'a0')];
      const model = new DatabaseModel({ schema });

      model.setRows(rows);

      expect(sort(rows, [])).toEqual(ids(model.getOrderedRows()));
    });

    it('sorts numbers numerically in both directions', () => {
      const rows = [row('ten', 'a0', { num: 10 }), row('two', 'a1', { num: 2 }), row('five', 'a2', { num: 5 })];

      expect(sort(rows, [{ propertyId: 'num', direction: 'asc' }])).toEqual(['two', 'five', 'ten']);
      expect(sort(rows, [{ propertyId: 'num', direction: 'desc' }])).toEqual(['ten', 'five', 'two']);
    });

    it('puts empty values last in both directions', () => {
      const rows = [row('empty', 'a0', { num: '' }), row('two', 'a1', { num: 2 }), row('none', 'a2'), row('five', 'a3', { num: 5 })];

      expect(sort(rows, [{ propertyId: 'num', direction: 'asc' }])).toEqual(['two', 'five', 'empty', 'none']);
      expect(sort(rows, [{ propertyId: 'num', direction: 'desc' }])).toEqual(['five', 'two', 'empty', 'none']);
    });

    it('sorts text alphabetically', () => {
      const rows = [row('b', 'a0', { title: 'banana' }), row('a', 'a1', { title: 'Apple' }), row('c', 'a2', { title: 'cherry' })];

      expect(sort(rows, [{ propertyId: 'title', direction: 'asc' }])).toEqual(['a', 'b', 'c']);
    });

    it('sorts select by option order, not by label or id', () => {
      const rows = [row('late', 'a0', { status: 'opt-late' }), row('early', 'a1', { status: 'opt-early' }), row('mid', 'a2', { status: 'opt-mid' })];

      expect(sort(rows, [{ propertyId: 'status', direction: 'asc' }])).toEqual(['early', 'mid', 'late']);
      expect(sort(rows, [{ propertyId: 'status', direction: 'desc' }])).toEqual(['late', 'mid', 'early']);
    });

    it('sorts multiSelect by its options in option order', () => {
      const rows = [row('b', 'a0', { tags: ['tag-b'] }), row('ab', 'a1', { tags: ['tag-b', 'tag-a'] }), row('a', 'a2', { tags: ['tag-a'] })];

      expect(sort(rows, [{ propertyId: 'tags', direction: 'asc' }])).toEqual(['a', 'ab', 'b']);
    });

    it('sorts checkbox unchecked first when ascending', () => {
      const rows = [row('on', 'a0', { done: true }), row('off', 'a1', { done: false })];

      expect(sort(rows, [{ propertyId: 'done', direction: 'asc' }])).toEqual(['off', 'on']);
    });

    it('applies sorts in list order and breaks ties on position', () => {
      const rows = [
        row('x', 'a3', { status: 'opt-mid', num: 1 }),
        row('y', 'a2', { status: 'opt-early', num: 9 }),
        row('z', 'a1', { status: 'opt-mid', num: 1 }),
        row('w', 'a0', { status: 'opt-mid', num: 7 }),
      ];

      expect(sort(rows, [
        { propertyId: 'status', direction: 'asc' },
        { propertyId: 'num', direction: 'desc' },
      ])).toEqual(['y', 'w', 'z', 'x']);
    });

    it('ignores a sort on a deleted property', () => {
      const rows = [row('b', 'a1'), row('a', 'a0')];

      expect(sort(rows, [{ propertyId: 'gone', direction: 'desc' }])).toEqual(['a', 'b']);
    });

    it('does not reorder the input array', () => {
      const rows = [row('b', 'a1'), row('a', 'a0')];

      sortRows(rows, [], schema);

      expect(ids(rows)).toEqual(['b', 'a']);
    });
  });

```

- [ ] **Step 2: run, watch it FAIL**

`npx vitest run test/unit/tools/database/database-query.test.ts`

Expected (not observed per task; see the evidence note above): the `sortRows` cases fail because `sortRows` is not exported yet.

- [ ] **Step 3: minimal implementation.** Add `SortConfig` to the `./types` import, then append:

```ts
/** Must match getOrderedRows: keys mix letter case, and `<` orders case differently. */
const comparePosition = (a: DatabaseRow, b: DatabaseRow): number => a.position.localeCompare(b.position);

/** Options compare with `<`, like getSelectOptions, so sort order matches column order. */
const compareKeys = (a: string, b: string): number => {
  if (a === b) return 0;

  return a < b ? -1 : 1;
};

const compareKeyLists = (a: string[], b: string[]): number => {
  const diff = a.map((key, i) => (i < b.length ? compareKeys(key, b[i]) : 0)).find((d) => d !== 0);

  return diff ?? a.length - b.length;
};

/** Returns a comparable key, or `undefined` for an empty value. */
const sortKeyOf = (property: PropertyDefinition, value: PropertyValue | undefined): string | number | string[] | undefined => {
  const optionPosition = (id: string): string | undefined => property.config?.options.find((o) => o.id === id)?.position;

  switch (property.type) {
    case 'number': return toNumber(value);
    case 'checkbox': return value === true ? 1 : 0;
    case 'date': return toDay(value);
    case 'select': return typeof value === 'string' && value !== '' ? optionPosition(value) ?? value : undefined;
    case 'multiSelect': {
      const keys = toIdList(value ?? null).map((id) => optionPosition(id) ?? id).sort(compareKeys);

      return keys.length > 0 ? keys : undefined;
    }
    case 'title':
    case 'text':
    case 'url':
    case 'richText':
      return typeof value === 'string' && value !== '' ? value : undefined;
  }
};

const compareSortKeys = (a: string | number | string[], b: string | number | string[]): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (Array.isArray(a) && Array.isArray(b)) return compareKeyLists(a, b);
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);

  return 0;
};

/** Stable: rows equal on every sort keep position order. Empties go last in both directions. */
export const sortRows = (rows: DatabaseRow[], sorts: SortConfig[], schema: PropertyDefinition[]): DatabaseRow[] => {
  const active = sorts.flatMap((sort) => {
    const property = schema.find((p) => p.id === sort.propertyId);

    return property === undefined ? [] : [{ property, sign: sort.direction === 'desc' ? -1 : 1 }];
  });

  const compareBy = (property: PropertyDefinition, sign: number, a: DatabaseRow, b: DatabaseRow): number => {
    const ka = sortKeyOf(property, a.properties[property.id]);
    const kb = sortKeyOf(property, b.properties[property.id]);

    // Empty check runs before the sign, or descending would put empties first.
    if (ka === undefined && kb === undefined) return 0;
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;

    return compareSortKeys(ka, kb) * sign;
  };

  return [...rows].sort((a, b) => {
    const diff = active.map(({ property, sign }) => compareBy(property, sign, a, b)).find((d) => d !== 0);

    return diff ?? comparePosition(a, b);
  });
};
```

- [ ] **Step 4: run, PASS.** Same command; observed `Tests 68 passed (68)` for the combined file.
- [ ] **Step 5: lint.** Same eslint command as D1; observed clean.
- [ ] **Step 6: commit**

```bash
git add src/tools/database/database-query.ts test/unit/tools/database/database-query.test.ts
git commit -m "feat(database): sort rows by saved view sorts"
```

---

### Task D3: the query shape (`queryRows` / `queryGroups`) on the model

> **C has landed before this task (execution order). Read this first.** The code blocks below were drafted against bare HEAD and call `toGroupKey`, which Task C renamed to `toGroupKeys` (it now returns `string[]`). Git applies D's hunk "cleanly", and then tsc fails. Write `groupKeysOf` as the integrated run did (from `git diff 7b249a0d 34f741c0`, `phase-0-artifacts/phase0.bundle`):
>
```diff
diff --git a/src/tools/database/database-model.ts b/src/tools/database/database-model.ts
index 16d07ea1..1a7185e3 100644
--- a/src/tools/database/database-model.ts
+++ b/src/tools/database/database-model.ts
@@ -12,6 +12,8 @@ import type {
   ViewType,
 } from './types';
 import { DATABASE_DEFAULT_TEXT } from './database-localization';
+import { queryGroups, queryRows } from './database-query';
+import type { GroupCount, QueryRowsRequest, QueryRowsResult, QuerySource } from './database-query';
 
 /** Sorts after every real fractional key: 'z' is the last digit of the base62 alphabet. */
 const ORPHAN_GROUP_POSITION = 'zzzzzzzz';
@@ -123,6 +125,27 @@ export class DatabaseModel {
     return groups;
   }
 
+  /** The groups a row belongs to under `propertyId`. The query engine groups only through this. */
+  groupKeysOf(propertyId: string): (row: DatabaseRow) => string[] {
+    return (row) => this.toGroupKeys(row.properties[propertyId]);
+  }
+
+  queryRows(request: QueryRowsRequest): QueryRowsResult {
+    return queryRows(this.querySource(request.view), request);
+  }
+
+  queryGroups(view: DatabaseViewConfig): GroupCount[] {
+    return queryGroups(this.querySource(view), view);
+  }
+
+  private querySource(view: DatabaseViewConfig): QuerySource {
+    return {
+      schema: this.schema,
+      rows: this.rows,
+      ...(view.groupBy !== undefined ? { groupKeysOf: this.groupKeysOf(view.groupBy) } : {}),
+    };
+  }
+
   getSelectOptions(propertyId: string): SelectOption[] {
     const prop = this.getProperty(propertyId);
     if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) return [];
```


**Files:**
- Modify: `src/tools/database/database-query.ts` (add `DatabaseViewConfig` to the type import; insert the interfaces after `FILTER_OPERATORS`; append the two functions)
- Modify: `src/tools/database/database-model.ts` (one import line plus four small members, placed after `getRowsGroupedBy`)
- Modify: `test/unit/tools/database/database-query.test.ts`

**Interfaces:**
- Consumes: `rowMatchesFilters`, `sortRows` (D1, D2). `DatabaseModel.toGroupKey` (private, existing).
- Produces, in `database-query.ts`:

```ts
export interface QuerySource {
  schema: PropertyDefinition[];
  rows: DatabaseRow[];
  /** Keys of the groups a row belongs to. The model owns grouping; the engine only asks. */
  groupKeysOf?: (row: DatabaseRow) => string[];
}

export interface QueryRowsRequest {
  view: DatabaseViewConfig;
  group?: string;
  cursor?: string;
  limit?: number;
}

export interface QueryRowsResult {
  rows: DatabaseRow[];
  nextCursor?: string;
  total?: number;
}

export interface GroupCount {
  key: string;
  count: number;
}

export const queryRows: (source: QuerySource, request: QueryRowsRequest) => QueryRowsResult;
export const queryGroups: (source: QuerySource, view: DatabaseViewConfig) => GroupCount[];
```

- Produces, on `DatabaseModel`:
  - `groupKeysOf(propertyId: string): (row: DatabaseRow) => string[]`. **This is the grouping seam for Task C.** Today it returns `[toGroupKey(value)]`, the same key `getRowsGroupedBy` uses. Task C may return `[]`, several keys, or `''` for an empty group, and nothing else changes.
  - `queryRows(request: QueryRowsRequest): QueryRowsResult`
  - `queryGroups(view: DatabaseViewConfig): GroupCount[]`

Behaviour:
- `queryRows`: filter (AND), then keep rows whose `groupKeysOf(row)` includes `group` (when `group` is given), then sort, then page.
- `cursor` is an opaque string, an offset today. `limit` is undefined by default, which means "all in one page". `total` is always set in memory. `nextCursor` is set only when more rows remain.
- `queryGroups`: counts after filtering, without returning rows, in the order each key first appears in position order. A row counts under every key it reports.
- With `group` set but no `groupKeysOf` (view has no `groupBy`), no rows match.
- **Planned divergence from the architecture doc:** the doc's signatures return `Promise`s. These are synchronous, because the board and list renderers are synchronous. Field names are identical. A remote source (regime 2) will wrap them.

- [ ] **Step 1: failing test.** Add `queryRows`, `queryGroups`, `type QuerySource` to the import, plus `DatabaseViewConfig` from types. Add the helper:

```ts
const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v',
  name: 'V',
  type: 'list',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});
```

and inside `describe('database-query')`:

```ts
  describe('queryRows / queryGroups', () => {
    const rows = [
      row('r1', 'a0', { status: 'opt-early', num: 3 }),
      row('r2', 'a1', { status: 'opt-late', num: 1 }),
      row('r3', 'a2', { status: 'opt-early', num: 2 }),
      row('r4', 'a3', { num: 9 }),
    ];
    const source: QuerySource = {
      schema,
      rows,
      groupKeysOf: (r) => [typeof r.properties.status === 'string' ? r.properties.status : ''],
    };

    it('returns every row in position order for a plain view, with a total', () => {
      const result = queryRows(source, { view: view() });

      expect(ids(result.rows)).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect(result.total).toBe(4);
      expect(result.nextCursor).toBeUndefined();
    });

    it('filters, then sorts', () => {
      const result = queryRows(source, {
        view: view({
          filters: [{ propertyId: 'num', operator: 'less_than', value: 5 }],
          sorts: [{ propertyId: 'num', direction: 'asc' }],
        }),
      });

      expect(ids(result.rows)).toEqual(['r2', 'r3', 'r1']);
      expect(result.total).toBe(3);
    });

    it('returns one group after filtering', () => {
      const result = queryRows(source, {
        view: view({ filters: [{ propertyId: 'num', operator: 'greater_than', value: 2 }] }),
        group: 'opt-early',
      });

      expect(ids(result.rows)).toEqual(['r1']);
    });

    it('pages with limit and cursor', () => {
      const first = queryRows(source, { view: view(), limit: 3 });

      expect(ids(first.rows)).toEqual(['r1', 'r2', 'r3']);
      expect(first.nextCursor).toBeDefined();

      const second = queryRows(source, { view: view(), limit: 3, cursor: first.nextCursor });

      expect(ids(second.rows)).toEqual(['r4']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('counts groups after filtering, without returning rows', () => {
      const groups = queryGroups(source, view({ filters: [{ propertyId: 'num', operator: 'less_than', value: 3 }] }));

      expect(groups).toEqual([
        { key: 'opt-late', count: 1 },
        { key: 'opt-early', count: 1 },
      ]);
    });

    it('counts a row under every key it reports', () => {
      const multi: QuerySource = { ...source, groupKeysOf: () => ['k1', 'k2'] };

      expect(queryGroups(multi, view())).toEqual([
        { key: 'k1', count: 4 },
        { key: 'k2', count: 4 },
      ]);
    });
  });
```

- [ ] **Step 2: run, FAIL.** `npx vitest run test/unit/tools/database/database-query.test.ts`. Expected (not observed per task): the new cases fail because `queryRows` and `queryGroups` are missing.

- [ ] **Step 3: implementation.** Insert the interfaces shown above after `FILTER_OPERATORS`, then append:

```ts
const filteredRows = (source: QuerySource, view: DatabaseViewConfig): DatabaseRow[] =>
  source.rows.filter((row) => rowMatchesFilters(row, view.filters, source.schema));

/**
 * In-memory answer to the view query. Synchronous for now; a remote source
 * will need the same fields behind a Promise.
 */
export const queryRows = (source: QuerySource, request: QueryRowsRequest): QueryRowsResult => {
  const { view, group } = request;
  const groupKeysOf = source.groupKeysOf;
  const inGroup = group === undefined
    ? filteredRows(source, view)
    : filteredRows(source, view).filter((row) => groupKeysOf?.(row).includes(group) ?? false);
  const sorted = sortRows(inGroup, view.sorts, source.schema);
  const start = request.cursor === undefined ? 0 : Number(request.cursor);
  const end = request.limit === undefined ? sorted.length : start + request.limit;

  return {
    rows: sorted.slice(start, end),
    total: sorted.length,
    ...(end < sorted.length ? { nextCursor: String(end) } : {}),
  };
};

/** Group counts after filtering, in the order each key first shows up in position order. */
export const queryGroups = (source: QuerySource, view: DatabaseViewConfig): GroupCount[] => {
  const counts = new Map<string, number>();

  for (const row of sortRows(filteredRows(source, view), [], source.schema)) {
    for (const key of source.groupKeysOf?.(row) ?? []) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts].map(([key, count]) => ({ key, count }));
};
```

Model diff, exactly as run:

```diff
diff --git a/src/tools/database/database-model.ts b/src/tools/database/database-model.ts
index 2c1c9aa8..8967cc4f 100644
--- a/src/tools/database/database-model.ts
+++ b/src/tools/database/database-model.ts
@@ -12,6 +12,8 @@ import type {
   ViewType,
 } from './types';
 import { DATABASE_DEFAULT_TEXT } from './database-localization';
+import { queryGroups, queryRows } from './database-query';
+import type { GroupCount, QueryRowsRequest, QueryRowsResult, QuerySource } from './database-query';
 
 /** Sorts after every real fractional key: 'z' is the last digit of the base62 alphabet. */
 const ORPHAN_GROUP_POSITION = 'zzzzzzzz';
@@ -118,6 +120,27 @@ export class DatabaseModel {
     return groups;
   }
 
+  /** The groups a row belongs to under `propertyId`. The query engine groups only through this. */
+  groupKeysOf(propertyId: string): (row: DatabaseRow) => string[] {
+    return (row) => [this.toGroupKey(row.properties[propertyId])];
+  }
+
+  queryRows(request: QueryRowsRequest): QueryRowsResult {
+    return queryRows(this.querySource(request.view), request);
+  }
+
+  queryGroups(view: DatabaseViewConfig): GroupCount[] {
+    return queryGroups(this.querySource(view), view);
+  }
+
+  private querySource(view: DatabaseViewConfig): QuerySource {
+    return {
+      schema: this.schema,
+      rows: this.rows,
+      ...(view.groupBy !== undefined ? { groupKeysOf: this.groupKeysOf(view.groupBy) } : {}),
+    };
+  }
+
   getSelectOptions(propertyId: string): SelectOption[] {
     const prop = this.getProperty(propertyId);
     if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) return [];
```

- [ ] **Step 4: PASS.** Observed `Tests 68 passed (68)`. Also run `npx vitest run test/unit/tools/database/database-model.test.ts`. It was covered by the folder run below, which was green.
- [ ] **Step 5: lint.** `npx eslint src/tools/database/database-query.ts src/tools/database/database-model.ts test/unit/tools/database/database-query.test.ts`. Observed clean.
- [ ] **Step 6: commit**

```bash
git add src/tools/database/database-query.ts src/tools/database/database-model.ts test/unit/tools/database/database-query.test.ts
git commit -m "feat(database): answer queryRows and queryGroups from memory"
```

---

### Task D4: board and list read from the engine, plus the sorted-drag gate (GATED ON D7)

> **C has landed before this task (execution order). Read this first.** Use the integrated versions below instead of the pre-C code in the steps. The board's column list comes from C's `groupOptions()` (the no-value column first), and its rows come from D's `queryGroupRows()`. Two tests change to match C: "keeps every column" expects **4** columns, because the no-value column always shows. And with C3 (D9), a deleted column **clears** the group of a row a filter hides instead of deleting the row. If D9 is rejected and C3 skipped, restore D's original "deletes a hidden row" test from the steps below. The source of these diffs is `git diff 7b249a0d 34f741c0` in `phase-0-artifacts/phase0.bundle`.

Integrated source (model + index):
```diff
diff --git a/src/tools/database/database-model.ts b/src/tools/database/database-model.ts
index 16d07ea1..1a7185e3 100644
--- a/src/tools/database/database-model.ts
+++ b/src/tools/database/database-model.ts
@@ -12,6 +12,8 @@ import type {
   ViewType,
 } from './types';
 import { DATABASE_DEFAULT_TEXT } from './database-localization';
+import { queryGroups, queryRows } from './database-query';
+import type { GroupCount, QueryRowsRequest, QueryRowsResult, QuerySource } from './database-query';
 
 /** Sorts after every real fractional key: 'z' is the last digit of the base62 alphabet. */
 const ORPHAN_GROUP_POSITION = 'zzzzzzzz';
@@ -123,6 +125,27 @@ export class DatabaseModel {
     return groups;
   }
 
+  /** The groups a row belongs to under `propertyId`. The query engine groups only through this. */
+  groupKeysOf(propertyId: string): (row: DatabaseRow) => string[] {
+    return (row) => this.toGroupKeys(row.properties[propertyId]);
+  }
+
+  queryRows(request: QueryRowsRequest): QueryRowsResult {
+    return queryRows(this.querySource(request.view), request);
+  }
+
+  queryGroups(view: DatabaseViewConfig): GroupCount[] {
+    return queryGroups(this.querySource(view), view);
+  }
+
+  private querySource(view: DatabaseViewConfig): QuerySource {
+    return {
+      schema: this.schema,
+      rows: this.rows,
+      ...(view.groupBy !== undefined ? { groupKeysOf: this.groupKeysOf(view.groupBy) } : {}),
+    };
+  }
+
   getSelectOptions(propertyId: string): SelectOption[] {
     const prop = this.getProperty(propertyId);
     if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) return [];
diff --git a/src/tools/database/index.ts b/src/tools/database/index.ts
index d0bce937..7cb6919e 100644
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -912,7 +912,7 @@ export class DatabaseTool implements BlockTool {
       return this.renderListView(titlePropId, groupByPropId, viewConfig);
     }
 
-    return this.renderBoardView(titlePropId, groupByPropId);
+    return this.renderBoardView(titlePropId, groupByPropId, viewConfig);
   }
 
   /**
@@ -930,9 +930,16 @@ export class DatabaseTool implements BlockTool {
     return [noValue, ...localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId), this.api.i18n)];
   }
 
-  private renderBoardView(titlePropId: string, groupByPropId: string | undefined): HTMLDivElement {
+  /** Each group's rows, queried once per render. */
+  private queryGroupRows(viewConfig: DatabaseViewConfig, optionIds: string[]): Map<string, DatabaseRow[]> {
+    return new Map(optionIds.map((id) => [id, this.model.queryRows({ view: viewConfig, group: id }).rows]));
+  }
+
+  private renderBoardView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig | undefined): HTMLDivElement {
     const options = groupByPropId !== undefined ? this.groupOptions(groupByPropId) : [];
-    const groups: Map<string, DatabaseRow[]> = groupByPropId !== undefined ? this.model.getRowsGroupedBy(groupByPropId) : new Map<string, DatabaseRow[]>();
+    const groups = viewConfig !== undefined && groupByPropId !== undefined
+      ? this.queryGroupRows(viewConfig, options.map((o) => o.id))
+      : new Map<string, DatabaseRow[]>();
 
     this.view = new DatabaseBoardView({
       readOnly: this.readOnly,
@@ -955,7 +962,7 @@ export class DatabaseTool implements BlockTool {
 
     if (groupByPropId !== undefined) {
       const options = this.groupOptions(groupByPropId);
-      const groups = this.model.getRowsGroupedBy(groupByPropId);
+      const groups = this.queryGroupRows(viewConfig, options.map((o) => o.id));
 
       this.view = new DatabaseListView({
         readOnly: this.readOnly,
@@ -971,7 +978,7 @@ export class DatabaseTool implements BlockTool {
       this.view = new DatabaseListView({
         readOnly: this.readOnly,
         i18n: this.api.i18n,
-        rows: this.model.getOrderedRows(),
+        rows: this.model.queryRows({ view: viewConfig }).rows,
         titlePropertyId: titlePropId,
         schema,
         visiblePropertyIds: viewConfig.visibleProperties,
@@ -1240,12 +1247,13 @@ export class DatabaseTool implements BlockTool {
     const descriptionProp = this.model.getSchema().find((p) => p.type === 'richText');
     const descriptionPropId = descriptionProp?.id;
 
-    if (isList) {
+    // GATED ON D7: a sorted view has no manual order to drag into.
+    if (isList && (viewConfig?.sorts.length ?? 0) === 0) {
       this.listRowDrag = new DatabaseListRowDrag({
         wrapper: boardEl,
         onDrop: (result) => this.handleListRowDrop(result),
       });
-    } else {
+    } else if (!isList) {
       this.cardDrag = new DatabaseCardDrag({
         wrapper: boardEl,
         onDrop: (result) => this.handleRowDrop(result),
@@ -1479,6 +1487,18 @@ export class DatabaseTool implements BlockTool {
       return;
     }
 
+    // GATED ON D7: neighbours arrive in sort order, not key order, so
+    // positionBetween would throw. Only the group value may change.
+    if (viewConfig !== undefined && viewConfig.sorts.length > 0) {
+      if (this.model.getRow(rowId)?.properties[groupByPropId] !== toOptionId) {
+        this.updateRowBlock(rowId, { [groupByPropId]: toOptionId });
+        this.rerenderView();
+        this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: toOptionId } });
+      }
+
+      return;
+    }
+
     const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
     const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
     const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);
```

Integrated tests (`database.test.ts`):
```diff
diff --git a/test/unit/tools/database/database.test.ts b/test/unit/tools/database/database.test.ts
index f31fb489..85c31e62 100644
--- a/test/unit/tools/database/database.test.ts
+++ b/test/unit/tools/database/database.test.ts
@@ -3571,4 +3571,137 @@ describe('DatabaseTool', () => {
       tool.destroy();
     });
   });
+
+  describe('saved filters and sorts apply to the rendered view', () => {
+    const titlesIn = (element: HTMLElement, attr: string): string[] =>
+      queryAllByData(element, attr).map((el) => el.textContent ?? '');
+
+    it('hides a card that a saved filter excludes, and keeps every column', () => {
+      const childBlocks = [
+        createMockRowBlock({ id: 'row-keep', properties: { 'prop-title': 'Keep me', 'prop-status': 'opt-todo' }, position: 'a0' }),
+        createMockRowBlock({ id: 'row-drop', properties: { 'prop-title': 'Drop me', 'prop-status': 'opt-todo' }, position: 'a1' }),
+      ];
+      const data = makeDefaultData({
+        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
+          filters: [{ propertyId: 'prop-title', operator: 'contains', value: 'keep' }] }],
+      });
+      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
+      const element = tool.render();
+
+      tool.rendered();
+
+      expect(queryByData(element, 'data-row-id', 'row-drop')).toBeNull();
+      expect(queryByData(element, 'data-row-id', 'row-keep')).not.toBeNull();
+      // 3 options plus the no-value column.
+      expect(queryAllByData(element, 'data-blok-database-column')).toHaveLength(4);
+    });
+
+    it('orders list rows by a saved sort instead of by position', () => {
+      const childBlocks = [
+        createMockRowBlock({ id: 'row-c', properties: { 'prop-title': 'Cherry' }, position: 'a0' }),
+        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'Apple' }, position: 'a1' }),
+        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'Banana' }, position: 'a2' }),
+      ];
+      const data = makeDefaultData({
+        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', filters: [], visibleProperties: [],
+          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
+        activeViewId: 'view-list',
+      });
+      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
+      const element = tool.render();
+
+      tool.rendered();
+
+      expect(titlesIn(element, 'data-blok-database-list-row-title')).toEqual(['Apple', 'Banana', 'Cherry']);
+    });
+
+    it('still clears the group of a row a filter hides when its column is deleted', () => {
+      const childBlocks = [
+        createMockRowBlock({ id: 'row-shown', properties: { 'prop-title': 'Shown', 'prop-status': 'opt-todo' }, position: 'a0' }),
+        createMockRowBlock({ id: 'row-hidden', properties: { 'prop-title': 'Hidden', 'prop-status': 'opt-todo' }, position: 'a1' }),
+      ];
+      const data = makeDefaultData({
+        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
+          filters: [{ propertyId: 'prop-title', operator: 'equals', value: 'shown' }] }],
+      });
+      const options = createDatabaseOptions(data, {}, { childBlocks });
+      const tool = new DatabaseTool(options);
+      const element = tool.render();
+
+      tool.rendered();
+      queryAllByData(element, 'data-blok-database-delete-column')
+        .find((el) => el.getAttribute('data-option-id') === 'opt-todo')!
+        .click();
+
+      expect(childBlocks[1].call).toHaveBeenCalledWith('updateProperties', { 'prop-status': null });
+      expect(options.api.blocks.delete).not.toHaveBeenCalled();
+    });
+  });
+
+  describe('drag in a sorted view (GATED ON D7)', () => {
+    const sortedBoard = (): { tool: DatabaseTool; childBlocks: BlockAPI[] } => {
+      // Sort order (A, B) is the reverse of position order (B at a0, A at a1).
+      const childBlocks = [
+        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a0' }),
+        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a1' }),
+        createMockRowBlock({ id: 'row-x', properties: { 'prop-title': 'X', 'prop-status': 'opt-todo' }, position: 'a2' }),
+      ];
+      const data = makeDefaultData({
+        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
+          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
+      });
+      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
+
+      tool.render();
+      tool.rendered();
+
+      return { tool, childBlocks };
+    };
+
+    const dropCard = (tool: DatabaseTool, result: CardDragResult): void => {
+      const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;
+
+      (cardDrag as unknown as { onDrop: (r: CardDragResult) => void }).onDrop(result);
+    };
+
+    const callsNamed = (block: BlockAPI, name: string): unknown[][] =>
+      (block.call as ReturnType<typeof vi.fn>).mock.calls.filter((args) => args[0] === name);
+
+    it('ignores a reorder inside the same column', () => {
+      const { tool, childBlocks } = sortedBoard();
+      const rowX = childBlocks[2];
+
+      // Neighbours arrive in sort order (A then B), so their keys are out of order.
+      expect(() => dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' })).not.toThrow();
+      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);
+    });
+
+    it('moves a card to another column by its group value only', () => {
+      const { tool, childBlocks } = sortedBoard();
+      const rowX = childBlocks[2];
+
+      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-doing', beforeRowId: null, afterRowId: null });
+
+      expect(callsNamed(rowX, 'updateProperties')).toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
+      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);
+    });
+
+    it('turns list row drag off while the list is sorted', () => {
+      const childBlocks = [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One' }, position: 'a0' })];
+      const listView = (sorts: DatabaseViewConfig['sorts']): Partial<DatabaseData> => ({
+        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', filters: [], visibleProperties: [], sorts }],
+        activeViewId: 'view-list',
+      });
+      const sorted = new DatabaseTool(createDatabaseOptions(listView([{ propertyId: 'prop-title', direction: 'asc' }]), {}, { childBlocks }));
+      const unsorted = new DatabaseTool(createDatabaseOptions(listView([]), {}, { childBlocks }));
+
+      sorted.render();
+      sorted.rendered();
+      unsorted.render();
+      unsorted.rendered();
+
+      expect((sorted as unknown as { listRowDrag: unknown }).listRowDrag).toBeNull();
+      expect((unsorted as unknown as { listRowDrag: unknown }).listRowDrag).not.toBeNull();
+    });
+  });
 });
```


**Files:**
- Modify: `src/tools/database/index.ts` (`renderActiveView`, `renderBoardView`, `renderListView`, `initSubsystems`, `handleRowDrop`)
- Modify: `test/unit/tools/database/database.test.ts` (two new `describe` blocks at the end of `describe('DatabaseTool')`)

**Interfaces:**
- Consumes: `DatabaseModel.queryRows` (D3).
- Produces: no new public surface. One new private helper: `DatabaseTool.queryGroupRows(viewConfig: DatabaseViewConfig, optionIds: string[]): Map<string, DatabaseRow[]>`. It queries each group once per render, the same lifetime as the old `getRowsGroupedBy` map.

Which call sites move to the engine, and which **must not**:

| Site | Change |
|---|---|
| `renderBoardView` groups (old `:907`) | engine, via `queryGroupRows` |
| `renderListView` grouped (old `:933`) | engine, via `queryGroupRows` |
| `renderListView` flat (old `:949`) | `model.queryRows({ view }).rows` |
| `handleOptionDelete` (old `:1566`) | **stays `getRowsGroupedBy`.** Deleting a column must delete rows a filter hides too. A test pins it. |
| `hadRows` (`:232/236`), `resolveMovedRows` (`:422/426`), `createRowData` | stay on `getOrderedRows`. They are about the document, not the view. |
| orphan columns in `getSelectOptions` | stay unfiltered. A filter empties a column; it does not remove it. |

D7 gate (decision D7, unverified in Notion, re-check in Task M):
- **List, sorted:** `DatabaseListRowDrag` is not created, so rows cannot be dragged. The pointerdown site already uses `this.listRowDrag?.`.
- **Board, sorted, same column:** the drop is ignored. No `updatePosition`, no rerender. Without the gate this **throws**: the drop neighbours arrive in sort order, so `positionBetween(after, before)` gets keys out of order. Observed: `Error: DatabaseModel.positionBetween: keys out of order (a1 >= a0)`.
- **Board, sorted, other column:** only the group value changes (`updateProperties` plus `syncUpdateRow`). Position is not rewritten, and no `syncMoveRow` is sent.
- Hiding the ⋮⋮ affordance visually is out of scope (renderer work). The card drag still starts; a same-column drop is a no-op.

- [ ] **Step 1: failing tests.** Append inside `describe('DatabaseTool')` in `database.test.ts`:

```ts

  describe('saved filters and sorts apply to the rendered view', () => {
    const titlesIn = (element: HTMLElement, attr: string): string[] =>
      queryAllByData(element, attr).map((el) => el.textContent ?? '');

    it('hides a card that a saved filter excludes, and keeps every column', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-keep', properties: { 'prop-title': 'Keep me', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-drop', properties: { 'prop-title': 'Drop me', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-title', operator: 'contains', value: 'keep' }] }],
      });
      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();

      expect(queryByData(element, 'data-row-id', 'row-drop')).toBeNull();
      expect(queryByData(element, 'data-row-id', 'row-keep')).not.toBeNull();
      expect(queryAllByData(element, 'data-blok-database-column')).toHaveLength(3);
    });

    it('orders list rows by a saved sort instead of by position', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-c', properties: { 'prop-title': 'Cherry' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'Apple' }, position: 'a1' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'Banana' }, position: 'a2' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
        activeViewId: 'view-list',
      });
      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();

      expect(titlesIn(element, 'data-blok-database-list-row-title')).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('still deletes a row a filter hides when its column is deleted', () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-shown', properties: { 'prop-title': 'Shown', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-hidden', properties: { 'prop-title': 'Hidden', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-title', operator: 'equals', value: 'shown' }] }],
      });
      const options = createDatabaseOptions(data, {}, { childBlocks });

      (options.api.blocks.getBlockIndex as ReturnType<typeof vi.fn>).mockImplementation((blockId: string) => (blockId === 'row-hidden' ? 2 : 1));

      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryAllByData(element, 'data-blok-database-delete-column')
        .find((el) => el.getAttribute('data-option-id') === 'opt-todo')!
        .click();

      expect(options.api.blocks.delete).toHaveBeenCalledWith(2);
    });
  });

  describe('drag in a sorted view (GATED ON D7)', () => {
    const sortedBoard = (): { tool: DatabaseTool; childBlocks: BlockAPI[] } => {
      // Sort order (A, B) is the reverse of position order (B at a0, A at a1).
      const childBlocks = [
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a1' }),
        createMockRowBlock({ id: 'row-x', properties: { 'prop-title': 'X', 'prop-status': 'opt-todo' }, position: 'a2' }),
      ];
      const data = makeDefaultData({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      });
      const tool = new DatabaseTool(createDatabaseOptions(data, {}, { childBlocks }));

      tool.render();
      tool.rendered();

      return { tool, childBlocks };
    };

    const dropCard = (tool: DatabaseTool, result: CardDragResult): void => {
      const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;

      (cardDrag as unknown as { onDrop: (r: CardDragResult) => void }).onDrop(result);
    };

    const callsNamed = (block: BlockAPI, name: string): unknown[][] =>
      (block.call as ReturnType<typeof vi.fn>).mock.calls.filter((args) => args[0] === name);

    it('ignores a reorder inside the same column', () => {
      const { tool, childBlocks } = sortedBoard();
      const rowX = childBlocks[2];

      // Neighbours arrive in sort order (A then B), so their keys are out of order.
      expect(() => dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-todo', beforeRowId: 'row-b', afterRowId: 'row-a' })).not.toThrow();
      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);
    });

    it('moves a card to another column by its group value only', () => {
      const { tool, childBlocks } = sortedBoard();
      const rowX = childBlocks[2];

      dropCard(tool, { rowId: 'row-x', toOptionId: 'opt-doing', beforeRowId: null, afterRowId: null });

      expect(callsNamed(rowX, 'updateProperties')).toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(callsNamed(rowX, 'updatePosition')).toHaveLength(0);
    });

    it('turns list row drag off while the list is sorted', () => {
      const childBlocks = [createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'One' }, position: 'a0' })];
      const listView = (sorts: DatabaseViewConfig['sorts']): Partial<DatabaseData> => ({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', filters: [], visibleProperties: [], sorts }],
        activeViewId: 'view-list',
      });
      const sorted = new DatabaseTool(createDatabaseOptions(listView([{ propertyId: 'prop-title', direction: 'asc' }]), {}, { childBlocks }));
      const unsorted = new DatabaseTool(createDatabaseOptions(listView([]), {}, { childBlocks }));

      sorted.render();
      sorted.rendered();
      unsorted.render();
      unsorted.rendered();

      expect((sorted as unknown as { listRowDrag: unknown }).listRowDrag).toBeNull();
      expect((unsorted as unknown as { listRowDrag: unknown }).listRowDrag).not.toBeNull();
    });
  });
```

- [ ] **Step 2: run, FAIL**

`npx vitest run test/unit/tools/database/database.test.ts -t "saved filters and sorts|sorted view"`

Observed: `Tests 5 failed | 1 passed | 128 skipped (134)`:
- filter: `expected <div data-blok-database-card …> to be null`
- sort: `expected [ 'Cherry', 'Apple', 'Banana' ] to deeply equal [ 'Apple', 'Banana', 'Cherry' ]`
- same column: `'Error: DatabaseModel.positionBetween: keys out of order (a1 >= a0)' was thrown`
- other column: `expected [ [ 'updatePosition', …(1) ] ] to have a length of +0 but got 1`
- list drag: `expected DatabaseListRowDrag{ …(14) } to be null`
- The one that passed is "still deletes a row a filter hides when its column is deleted". That is intended. It is a guard that the wiring must not break, and it stays green after Step 3.

- [ ] **Step 3: implementation** (exact diff as run):

```diff
diff --git a/src/tools/database/index.ts b/src/tools/database/index.ts
index 85caf741..40ddf071 100644
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -897,14 +897,21 @@ export class DatabaseTool implements BlockTool {
       return this.renderListView(titlePropId, groupByPropId, viewConfig);
     }
 
-    return this.renderBoardView(titlePropId, groupByPropId);
+    return this.renderBoardView(titlePropId, groupByPropId, viewConfig);
   }
 
-  private renderBoardView(titlePropId: string, groupByPropId: string | undefined): HTMLDivElement {
+  /** Each group's rows, queried once per render. */
+  private queryGroupRows(viewConfig: DatabaseViewConfig, optionIds: string[]): Map<string, DatabaseRow[]> {
+    return new Map(optionIds.map((id) => [id, this.model.queryRows({ view: viewConfig, group: id }).rows]));
+  }
+
+  private renderBoardView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig | undefined): HTMLDivElement {
     const options = groupByPropId !== undefined
       ? localizeDatabaseSelectOptions(this.model.getSelectOptions(groupByPropId), this.api.i18n)
       : [];
-    const groups: Map<string, DatabaseRow[]> = groupByPropId !== undefined ? this.model.getRowsGroupedBy(groupByPropId) : new Map<string, DatabaseRow[]>();
+    const groups = viewConfig !== undefined && groupByPropId !== undefined
+      ? this.queryGroupRows(viewConfig, options.map((o) => o.id))
+      : new Map<string, DatabaseRow[]>();
 
     this.view = new DatabaseBoardView({
       readOnly: this.readOnly,
@@ -930,7 +937,7 @@ export class DatabaseTool implements BlockTool {
         this.model.getSelectOptions(groupByPropId),
         this.api.i18n
       );
-      const groups = this.model.getRowsGroupedBy(groupByPropId);
+      const groups = this.queryGroupRows(viewConfig, options.map((o) => o.id));
 
       this.view = new DatabaseListView({
         readOnly: this.readOnly,
@@ -946,7 +953,7 @@ export class DatabaseTool implements BlockTool {
       this.view = new DatabaseListView({
         readOnly: this.readOnly,
         i18n: this.api.i18n,
-        rows: this.model.getOrderedRows(),
+        rows: this.model.queryRows({ view: viewConfig }).rows,
         titlePropertyId: titlePropId,
         schema,
         visiblePropertyIds: viewConfig.visibleProperties,
@@ -1206,12 +1213,13 @@ export class DatabaseTool implements BlockTool {
     const descriptionProp = this.model.getSchema().find((p) => p.type === 'richText');
     const descriptionPropId = descriptionProp?.id;
 
-    if (isList) {
+    // GATED ON D7: a sorted view has no manual order to drag into.
+    if (isList && (viewConfig?.sorts.length ?? 0) === 0) {
       this.listRowDrag = new DatabaseListRowDrag({
         wrapper: boardEl,
         onDrop: (result) => this.handleListRowDrop(result),
       });
-    } else {
+    } else if (!isList) {
       this.cardDrag = new DatabaseCardDrag({
         wrapper: boardEl,
         onDrop: (result) => this.handleRowDrop(result),
@@ -1444,6 +1452,18 @@ export class DatabaseTool implements BlockTool {
       return;
     }
 
+    // GATED ON D7: neighbours arrive in sort order, not key order, so
+    // positionBetween would throw. Only the group value may change.
+    if (viewConfig !== undefined && viewConfig.sorts.length > 0) {
+      if (this.model.getRow(rowId)?.properties[groupByPropId] !== toOptionId) {
+        this.updateRowBlock(rowId, { [groupByPropId]: toOptionId });
+        this.rerenderView();
+        this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: toOptionId } });
+      }
+
+      return;
+    }
+
     const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
     const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
     const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);
```

- [ ] **Step 4: PASS.** Same command; observed `Tests 6 passed | 128 skipped (134)`. Full file: `npx vitest run test/unit/tools/database/database.test.ts` → `Tests 134 passed (134)`.
- [ ] **Step 5: lint.** `npx eslint src/tools/database/index.ts test/unit/tools/database/database.test.ts`. Observed clean, together with the D1-D3 files.
- [ ] **Step 6: commit**

```bash
git add src/tools/database/index.ts test/unit/tools/database/database.test.ts
git commit -m "feat(database): apply saved filters and sorts to board and list"
```

---

### Evidence (all run in the scratch worktree at `665c077a` plus this diff)

- `npx vitest run test/unit/tools/database/database-query.test.ts`: FAIL before the module existed (unresolved import), then `68 passed (68)`.
- `npx vitest run test/unit/tools/database/database.test.ts -t "saved filters and sorts|sorted view"`: `5 failed | 1 passed` before Step 3, `6 passed` after.
- `npx vitest run test/unit/tools/database` (whole folder, run 3 times):
  - With the change, 1st run: `1 failed | 1190 passed`. The failure was `database-card-drawer-tab-sync.test.ts > the nested card editor opens no tab-sync channel`, a `Test timed out in 5000ms`.
  - On clean HEAD (change stashed in the scratch worktree): the **same test failed the same way**, `1 failed | 1116 passed`.
  - The same file run alone: `1 passed`.
  - With the change, 2nd run: `Test Files 37 passed (37)`, `Tests 1191 passed (1191)`.
  - Verdict: a pre-existing, load-dependent timeout, not caused by this change.
- `npx eslint` on the 5 changed files: clean, after fixing the 5 first-draft errors listed in D1 Step 5.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`: finished in about 40 s with **0** `error TS` lines.
- Board `getRows` is called once per option in `createView()` (`database-board-view.ts:61`), so per-render precompute keeps the old lifetime.
- `DatabaseCardDrag.commitDrop` does not move DOM before `onDrop` (`database-card-drag.ts:292-313`, it uses a ghost), so a no-op drop needs no rerender.

### Unverified / open

- **Notion's text-filter case rule** is unverified. The engine is case-insensitive by choice.
- **D8 (empties last in both directions)** and **D7 (no manual reorder while sorted)** are gated decisions and unverified in Notion. Re-check in Task M.
- **"A filter with no value hides nothing"** is a forward-compat choice. Notion's UI behaviour for a half-built filter is not verified.
- **Dates:** no Blok editor writes `date` values today (`grep "'date'" src/tools/database*` only hits the type list, the type popover and the preview). The ISO `YYYY-MM-DD…` shape is an assumption. Time zones are ignored. Notion's relative date operators (`past_week`, …) are left out.
- **Rich text bodies (OutputData)** only support `is_empty` / `is_not_empty`. Text operators let them through until a plain-text extractor is chosen. Do not parse with detached `innerHTML`.
- **multiSelect sort semantics** (compare the sorted option-position lists) are a choice. Notion's rule for multi-value sort is not sourced.
- **A card added in a filtered view can vanish at once** if its defaults fail the filter. Notion's filter auto-fill on create is not verified and not built here.
- Per-task FAIL output for D2 and D3 was not observed separately, because the three tasks' tests ran as one file.
- `queryGroups` has no caller yet. Column counts still come from `getRows(option).length`, which now reflects filtering.
- Cost: `queryGroupRows` filters every row once per group per render, O(rows × groups). Fine for the in-memory regime (low thousands); not measured.

---

## Integration: D after C (mandatory edits)

Recorded by the integration run (`phase-0-artifacts/INTEGRATION-NOTES.md`). Apply these edits while landing D3 and D4 on top of C. Without them, tsc fails or tests go red.


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


---

### Task D5: re-sort and re-filter when a peer or undo changes a title the view queries

**Order:** lands after D4 and before F. D4 makes board and list read sorts and filters from the engine. That is what makes this defect reachable. F3 step 5 ("Gap found, NOT fixed") is superseded by this task.

**The defect.** A view sorted or filtered by title. A peer (or undo) changes only a row's title. `reprojectRows` sees a title-only change (`retitledRows` returns rows), so it patches the title in place with `view.updateRowTitle` and never redraws. The sort and filter are not re-applied. Observed on a title-sorted board: order `['row-a','row-b']` after A became `Z`, where the sort says B first. On a list filtered by `contains 'keep'`, the row retitled `Gone` stays visible.

**Files:**
- Modify: `src/tools/database/index.ts` (`reprojectRows`, plus a new private helper next to `isInteracting`)
- Modify: `test/unit/tools/database/database.test.ts` (one new `describe` inside `describe('DatabaseTool')`, placed after D4's `describe('saved filters and sorts apply to the rendered view')` and before D4's `describe('drag in a sorted view (GATED ON D7)')`)

**Interfaces:**
- Produces: no public surface, nothing BREAKING. One private helper: `DatabaseTool.activeViewQueries(propertyId: string): boolean`. True when the active view has a sort or a filter on that property.
- Scope of the rule: any non-title change already makes `retitledRows` return `null`, which redraws. So the new guard only acts on title-only changes. It redraws when the active view sorts or filters by the title property.
- `retitled.length > 0` keeps the old no-op: the tool's own synced writes compare equal and must not redraw.
- Deferral: the new branch calls the existing `redrawWhenIdle()`. That already waits while an inline input in the board has focus or a card, column or list-row drag is active. Test 3 pins this.

- [ ] **Step 1: failing tests.** Insert in `database.test.ts`, between D4's two `describe` blocks named above:

```ts
  describe('a peer retitle in a view that sorts or filters by title', () => {
    /** Sets a row's title the way a peer or undo does, then lets the redraw run. */
    const peerRetitle = async (tool: DatabaseTool, block: BlockAPI, title: string): Promise<void> => {
      const api = (tool as unknown as { api: API }).api;
      const listener = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed')?.[1] as (payload: unknown) => void;

      const row = block.preservedData as DatabaseRowData;

      row.properties['prop-title'] = title;
      listener({ event: { type: 'block-changed', detail: { target: block } } });
      await Promise.resolve();
    };

    const cardIds = (element: HTMLElement): string[] =>
      queryAllByData(element, 'data-blok-database-card').map((el) => el.getAttribute('data-row-id') ?? '');

    it('re-sorts the board when a peer changes a title the view sorts by', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      }, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();
      await peerRetitle(tool, childBlocks[0], 'Z');

      expect(cardIds(element)).toEqual(['row-b', 'row-a']);

      tool.destroy();
    });

    it('hides a list row when a peer retitles it out of a title filter', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-1', properties: { 'prop-title': 'Keep one' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-2', properties: { 'prop-title': 'Keep two' }, position: 'a1' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-title', operator: 'contains', value: 'keep' }] }],
        activeViewId: 'view-list',
      }, {}, { childBlocks }));
      const element = tool.render();

      tool.rendered();
      await peerRetitle(tool, childBlocks[0], 'Gone');

      expect(queryAllByData(element, 'data-blok-database-list-row-title').map((el) => el.textContent)).toEqual(['Keep two']);

      tool.destroy();
    });

    it('waits for an open card title edit to end before re-sorting', async () => {
      const childBlocks = [
        createMockRowBlock({ id: 'row-a', properties: { 'prop-title': 'A', 'prop-status': 'opt-todo' }, position: 'a0' }),
        createMockRowBlock({ id: 'row-b', properties: { 'prop-title': 'B', 'prop-status': 'opt-todo' }, position: 'a1' }),
      ];
      const tool = new DatabaseTool(createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      }, {}, { childBlocks }));
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      queryAllByData(element, 'data-row-id', 'row-b').find((el) => el.hasAttribute('data-blok-database-edit-card'))?.click();
      const input = queryByData(element, 'data-blok-database-card-title-input') as HTMLInputElement;

      await peerRetitle(tool, childBlocks[0], 'Z');

      expect(element.contains(input)).toBe(true);
      expect(cardIds(element)).toEqual(['row-a', 'row-b']);

      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyUp(document.body, { key: 'Enter' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(cardIds(element)).toEqual(['row-b', 'row-a']);

      tool.destroy();
      document.body.innerHTML = '';
    });
  });

```

- [ ] **Step 2: run, watch it FAIL.**

```bash
npx vitest run test/unit/tools/database/database.test.ts -t "a peer retitle in a view"
```

Observed, with the production code before this task (tests 1 and 2 were written first; test 3 was added after the fix and checked by reverting it):
```
× re-sorts the board when a peer changes a title the view sorts by
× hides a list row when a peer retitles it out of a title filter
× waits for an open card title edit to end before re-sorting
AssertionError: expected [ 'row-a', 'row-b' ] to deeply equal [ 'row-b', 'row-a' ]
AssertionError: expected [ 'Gone', 'Keep two' ] to deeply equal [ 'Keep two' ]
AssertionError: expected [ 'row-a', 'row-b' ] to deeply equal [ 'row-b', 'row-a' ]
Tests  3 failed | 158 skipped (161)
```
The second failure shows `'Gone'`, so the listener ran and the title was patched in place. The tests fail on the missing redraw, not on setup.

- [ ] **Step 3: minimal fix.** Apply:

```diff
diff --git a/src/tools/database/index.ts b/src/tools/database/index.ts
index 5be4afd0..2e035164 100644
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -454,7 +454,7 @@ export class DatabaseTool implements BlockTool {
       }
     }
 
-    if (retitled === null) {
+    if (retitled === null || (retitled.length > 0 && this.activeViewQueries(this.titlePropertyId()))) {
       this.redrawWhenIdle();
 
       return;
@@ -505,6 +505,13 @@ export class DatabaseTool implements BlockTool {
     return retitled;
   }
 
+  /** True when the active view sorts or filters by the property, so a new value can move or hide a row. */
+  private activeViewQueries(propertyId: string): boolean {
+    const view = this.model.getView(this.activeViewId);
+
+    return view !== undefined && [...view.sorts, ...view.filters].some((rule) => rule.propertyId === propertyId);
+  }
+
   /** True while an inline rename in the board or a drag is in progress. */
   private isInteracting(): boolean {
     const focused = document.activeElement;
```

Proof that test 3 guards the deferral: with the fix in place, swap `this.redrawWhenIdle()` on that branch for `this.rerenderView({ keepDrawer: true })`. Observed: test 3 alone fails with `AssertionError: expected false to be true` at `element.contains(input)`. Tests 1 and 2 still pass. Then restore the code.

- [ ] **Step 4: run, watch it PASS.**

```bash
npx vitest run test/unit/tools/database/database.test.ts -t "a peer retitle in a view"
```
Observed: `Tests  3 passed | 158 skipped (161)` on D+F+D5, and `Tests  3 passed | 155 skipped (158)` on D+D5 (the `34f741c0` bundle head with only this diff applied).

Then the database suite, serially:
```bash
npx vitest run test/unit/tools/database --no-file-parallelism
```
Observed on D+F+D5: `Test Files  37 passed (37)`, `Tests  1238 passed (1238)`. The full suite was not run on D+D5 alone.

- [ ] **Step 5: lint and types.**

```bash
npx eslint src/tools/database/index.ts test/unit/tools/database/database.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
```
Observed on D+F+D5: eslint exit 0; tsc exit 0, no output. The first eslint run flagged `no-param-reassign` on `block.preservedData...= title` in the helper. The `const row = ...` form above is the fix.

Ordering check: `git apply` of this diff onto `34f741c0` succeeded, then `git apply --check F-final.diff` on top of it exited 0.

- [ ] **Step 6: commit.**

```bash
git add src/tools/database/index.ts test/unit/tools/database/database.test.ts
git commit -m "fix(database): redraw when a peer retitle changes sort or filter order" -m "A title-only change took the in-place retitle path, so a view sorted or filtered by title kept a stale order or showed a row the filter excludes. Redraw (deferred while an edit or drag is open) when the active view sorts or filters by the title."
```
Not BREAKING: private code only.

---

### Task F: integration fallout and final gates

> F was drafted on the A–D tree before D5 existed. The D5 run confirmed F applies cleanly after D5.

This task runs after D4, on the integrated tree, which has the five Phase 0 commits:
- `ac740d98` A
- `bfffc582` B
- `f0d1ec3a` E
- `7b249a0d` C
- `34f741c0` D

The code below was run in a scratch worktree (`~/Packages/.blok-undo/dbp-f`) at `34f741c0`. The complete diff is `phase-0-artifacts/F-final.diff`: 7 files, +236/-22, uncommitted, no new files (`git add -N` had nothing to add). `git apply --check` of it on a clean `34f741c0` is recorded at the end of this section.

Vitest ran one process at a time. No Playwright e2e was run, because port 4444 belonged to another session. Everything marked "unverified" below was not run.

**Files:**
- Modify: `test/unit/tools/database/database-card-drawer-tab-sync.test.ts` (F1)
- Modify: `src/tools/database/database-query.ts` (F2, adds `newRowValues`)
- Modify: `src/tools/database/index.ts` (F2, adds `newRowProperties`, used by `handleAddRow` and `handleAddListRow`)
- Modify: `test/unit/tools/database/database-query.test.ts` (F2)
- Modify: `test/unit/tools/database/database.test.ts` (F2 and F3, two new `describe` blocks at the end)
- Modify: `test/playwright/tests/undo-audit/gestures.spec.ts`, `test/playwright/tests/undo-audit/containers.spec.ts` (F4, not run)
- Modify (F5, not drafted here): 69 locale files under `src/components/i18n/locales/` and `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Interfaces:**
- Produces: `export const newRowValues: (filters: FilterConfig[], schema: PropertyDefinition[]) => Record<string, PropertyValue>`, from `database-query.ts`.
  - It takes values from `equals` filters only.
  - For `select`, it takes the first id; the target may be an id or a list of ids.
  - For `checkbox`, it takes a boolean.
  - For `text`, it takes a non-empty string.
  - For `number`, it takes the parsed number, so `'3'` becomes `3`.
  - It returns nothing for `title`, `url`, `richText`, `multiSelect`, `date`, a deleted property, or an unusable target.
- Produces (private): `DatabaseTool.newRowProperties(titlePropId, groupByPropId | undefined, optionId): Record<string, PropertyValue>`.
  - The filter values come first. The title is always `''`.
  - The clicked group's value wins over any filter on the group-by property. A filter on that property is ignored.
- No saved-data shape change. No public type change. No new i18n key.

---

- [ ] **Step F1: root-cause the drawer tab-sync timeout**

What was measured, on this machine, while other sessions were running:

| Sample | Tree | Result | 1-min load |
|---|---|---|---|
| `npx vitest run test/unit/tools/database` ×4 | `34f741c0` (HEAD) | 4/4 green, 1230 passed, 0 tab-sync failures | 4.2–8.1 |
| same ×4 | `665c077a` (base) | 4/4 green, 1117 passed, 0 tab-sync failures | 8.1–10.5 |
| same with `--reporter=json`, ×3 per tree, alternating | HEAD | test duration **3641 / 2990 / 3624 ms** | 5.6–6.7 |
| | base | test duration **3256 / 3749 / 3946 ms** | 5.9–9.0 |

INTEGRATION-NOTES records the earlier timeouts (2 of 3 runs) while another session was running gates on the machine. It records no load figure. When this session started, my own `uptime` reading showed a 15-minute load average of 13.05.

**Verdict: not caused by Phase 0. The test sits close to its timeout on both trees.**
- In a folder run, the test takes 3.0–3.9 s on both HEAD and base. The two ranges overlap, and base is not faster.
- The default per-test timeout is 5000 ms. Neither `vitest.config.ts` nor `test/unit/vitest.setup.ts` sets `testTimeout`. I grepped both.
- Because 0 of 8 samples failed on either tree, a bisect would have no signal, so I did not run one.
- Neither suspect explains a 1.3 s→5 s jump: E3's 300 ms fallback timer, or the D re-projection work. In-run time is the same with and without them.

**Mechanism (measured).**
- `drawer.open()` calls `initNestedEditor`, which runs `import('../../blok')` (`database-card-drawer.ts`, `initNestedEditor`). That is a cold import of the whole editor, inside the test's timed window.
- A probe `beforeAll` that pre-imported `src/blok` logged `IMPORT_MS 1731`. The test body then took **96 ms**.
- So almost all of the test's time is the module import. That cost grows with CPU contention, and the full folder runs 37 files in parallel.
- The test's own `vi.waitFor(..., { timeout: 20000 })` can never use its budget, because the 5 s test timeout fires first.

TDD:

1. Reproduce without adding load. Run the file with a test timeout below its solo runtime:
   ```bash
   npx vitest run test/unit/tools/database/database-card-drawer-tab-sync.test.ts --testTimeout=1000
   ```
   Observed: `× the nested card editor opens no tab-sync channel 1004ms` and `Error: Test timed out in 1000ms.`
2. Fix: give the test the same budget as its `waitFor`. Edit `test/unit/tools/database/database-card-drawer-tab-sync.test.ts`:
   ```diff
      // The card body is part of the host's document, not a document of its own.
   +  // The timeout covers the drawer's cold import of the whole editor (~1.7s alone,
   +  // 3.0-3.9s in a full folder run); the default 5s cut it off under load.
      it('the nested card editor opens no tab-sync channel', async () => {
   @@
        drawer.destroy();
   -  });
   +  }, 20000);
    });
   ```
3. Run the same command again (`--testTimeout=1000`). Observed: `Tests  1 passed (1)`. So the per-test timeout overrides the CLI value.
4. Lint: the scoped eslint run in F2 step 7 includes this file, and it exited 0.
5. Commit:
   ```bash
   git status --short
   git add test/unit/tools/database/database-card-drawer-tab-sync.test.ts
   git commit -m "test(database): give the drawer tab-sync test the budget of its cold editor import"
   ```
6. Label: this makes the test tolerate load. It fixes a known mechanism, and no product code changes. It does not prove the earlier timeouts were caused only by load, but the duration comparison shows Phase 0 does not slow the test.

---

- [ ] **Step F2: a row added in a filtered view must stay visible (Review Focus 3)**

The plan header says such a row vanishes "at once". It does not.
- "+ New" appends the card or row straight into the DOM (`view.appendRow`). The row's own write re-syncs the model, so `reprojectRows` finds no change and does not redraw.
- The row disappears on the **next redraw**: a peer edit, undo, a view switch or reload.

A probe showed this: the new row had 2 elements right after the click, the redraw rebuilt the list, and then it had 0, while the other row was still shown. Fix the Review Focus wording to "vanishes on the next redraw".

Rule, per Notion (research/03 §1.5): a new row takes the values of the view's `equals` filters on select, checkbox, text and number.

On a grouped view, the clicked column wins. The group-by property always comes from the column, and a filter on it is ignored.
- Consequence (decided, not a Notion claim): in a board filtered to `Status = Done`, "+ New" in the **No Status** column makes a row with no status. That row disappears on the next redraw.
- The other choice was to send the row to Done. That would contradict the column the user clicked.

1. Write the failing tests. Append to the end of the top-level `describe('DatabaseTool')` in `test/unit/tools/database/database.test.ts`:
```ts
  describe('a row added in a filtered view', () => {
    /** Makes insertAt add the child the way the editor does, so later reads see it. */
    const insertingChildren = (options: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>, childBlocks: BlockAPI[]): void => {
      vi.mocked(options.api.blocks.insertAt).mockImplementation((_type, data, placement) => {
        const row = data as DatabaseRowData;
        const id = (placement as { id: string }).id;

        childBlocks.push(createMockRowBlock({ id, properties: row.properties, position: row.position }));

        return { id } as BlockAPI;
      });
    };

    /** Redraws the view the way a peer edit to another row does. */
    const redrawForPeerMove = async (tool: DatabaseTool, block: BlockAPI): Promise<void> => {
      const api = (tool as unknown as { api: API }).api;
      const call = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed');

      Object.assign(block.preservedData as DatabaseRowData, { position: 'a9' });
      (call?.[1] as (payload: unknown) => void)({ event: { type: 'block-changed', detail: { target: block } } });
      await Promise.resolve();
    };

    it('keeps the new list row visible after a redraw by taking the filter value', async () => {
      const childBlocks = [createMockRowBlock({ id: 'row-done', properties: { 'prop-title': 'Done one', 'prop-status': 'opt-done' }, position: 'a0' })];
      const options = createDatabaseOptions({
        views: [{ id: 'view-list', name: 'List', type: 'list', position: 'a0', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-status', operator: 'equals', value: 'opt-done' }] }],
        activeViewId: 'view-list',
      }, {}, { childBlocks });

      insertingChildren(options, childBlocks);
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryByData(element, 'data-blok-database-add-row')?.click();
      const newId = (vi.mocked(options.api.blocks.insertAt).mock.calls[0][2] as { id: string }).id;

      await redrawForPeerMove(tool, childBlocks[0]);

      expect(queryAllByData(element, 'data-row-id', newId)).not.toHaveLength(0);
      expect(vi.mocked(options.api.blocks.insertAt).mock.calls[0][1]).toMatchObject({ properties: { 'prop-status': 'opt-done' } });

      tool.destroy();
    });

    it('lets the column a card is added to win over a filter on another value', () => {
      const childBlocks: BlockAPI[] = [];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], visibleProperties: [],
          filters: [{ propertyId: 'prop-status', operator: 'equals', value: 'opt-done' }] }],
      }, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      tool.rendered();
      queryAllByData(element, 'data-blok-database-add-card')
        .find((el) => el.getAttribute('data-option-id') === 'opt-todo')
        ?.click();

      expect(vi.mocked(options.api.blocks.insertAt).mock.calls[0][1]).toMatchObject({ properties: { 'prop-status': 'opt-todo' } });

      tool.destroy();
    });
  });
```
   And in `test/unit/tools/database/database-query.test.ts`, add `newRowValues` to the import from `database-query`, then append inside `describe('database-query')`:
```ts
  describe('newRowValues', () => {
    it('gives a new row the value of each equals filter it can hold, and the row then passes', () => {
      const filters: FilterConfig[] = [
        { propertyId: 'status', operator: 'equals', value: ['opt-mid', 'opt-late'] },
        { propertyId: 'done', operator: 'equals', value: true },
        { propertyId: 'text', operator: 'equals', value: 'Draft' },
        { propertyId: 'num', operator: 'equals', value: '3' },
      ];
      const values = newRowValues(filters, schema);

      expect(values).toEqual({ status: 'opt-mid', done: true, text: 'Draft', num: 3 });
      expect(rowMatchesFilters(row('new', 'a0', values), filters, schema)).toBe(true);
    });

    it('takes nothing from other operators, the title, or a filter with no usable value', () => {
      expect(newRowValues([
        { propertyId: 'status', operator: 'does_not_equal', value: 'opt-mid' },
        { propertyId: 'title', operator: 'equals', value: 'Name' },
        { propertyId: 'num', operator: 'equals', value: 'abc' },
        { propertyId: 'text', operator: 'equals', value: '' },
        { propertyId: 'gone', operator: 'equals', value: 'x' },
      ], schema)).toEqual({});
    });
  });
```
2. Run them:
   ```bash
   npx vitest run test/unit/tools/database/database.test.ts -t "a row added in a filtered view"
   npx vitest run test/unit/tools/database/database-query.test.ts
   ```
   Observed failures:
   - `× keeps the new list row visible after a redraw by taking the filter value` with `AssertionError: expected [] to not have a length of +0` (database.test.ts:3749).
   - With `database-query.ts` at HEAD: `TypeError: newRowValues is not a function`, ×2.
   - `lets the column a card is added to win over a filter on another value` **passed before the fix**. It is a guard.
3. Implement. In `src/tools/database/database-query.ts`, add these above `filteredRows`:
```ts
/** The value an `equals` filter asks for, or `undefined` when a new row cannot take it. */
const filterTargetValue = (type: PropertyType | undefined, target: PropertyValue): PropertyValue | undefined => {
  switch (type) {
    case 'select': return toIdList(target)[0];
    case 'checkbox': return typeof target === 'boolean' ? target : undefined;
    case 'text': return typeof target === 'string' && target !== '' ? target : undefined;
    case 'number': return toNumber(target);
    case 'title':
    case 'url':
    case 'richText':
    case 'multiSelect':
    case 'date':
    case undefined:
      return undefined;
  }
};

/**
 * Values a new row takes from the view's `equals` filters, as Notion does,
 * so the filter does not hide the row on the next redraw.
 */
export const newRowValues = (filters: FilterConfig[], schema: PropertyDefinition[]): Record<string, PropertyValue> =>
  Object.fromEntries(filters.flatMap((filter) => {
    const value = filter.operator === 'equals'
      ? filterTargetValue(schema.find((p) => p.id === filter.propertyId)?.type, filter.value)
      : undefined;

    return value === undefined ? [] : [[filter.propertyId, value]];
  }));
```
   In `src/tools/database/index.ts`:
```diff
diff --git a/src/tools/database/index.ts b/src/tools/database/index.ts
index 7cb6919e..5be4afd0 100644
--- a/src/tools/database/index.ts
+++ b/src/tools/database/index.ts
@@ -3,6 +3,7 @@ import { databaseSanitize } from '../../shared/tool-descriptions/sanitize/blocks
 import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig, SanitizerConfig } from '../../../types';
 import type { DatabaseData, DatabaseConfig, DatabaseRow, DatabaseRowData, ViewType, SelectOption, DatabaseViewConfig, PropertyValue } from './types';
 import { DatabaseModel, NO_VALUE_GROUP_KEY } from './database-model';
+import { newRowValues } from './database-query';
 import { DatabaseBoardView } from './database-board-view';
 import { DatabaseListView } from './database-list-view';
 import { getPlaceholderClasses, setupPlaceholder } from '../../components/utils/placeholder';
@@ -1123,13 +1124,8 @@ export class DatabaseTool implements BlockTool {
     const viewConfig = this.model.getView(this.activeViewId);
     const groupByPropId = viewConfig?.groupBy;
 
-    const properties: Record<string, PropertyValue> = { [titlePropId]: '' };
-
-    if (groupByPropId !== undefined && optionId !== null && optionId !== NO_VALUE_GROUP_KEY) {
-      properties[groupByPropId] = this.groupValueFor(groupByPropId, optionId);
-    }
-
-    const rowData = this.model.createRowData(properties);
+    const groupProp = optionId === null ? undefined : groupByPropId;
+    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupProp, optionId ?? NO_VALUE_GROUP_KEY));
     this.api.blocks.insertAt(
       'database-row',
       { properties: rowData.properties, position: rowData.position, title: '' },
@@ -1151,6 +1147,16 @@ export class DatabaseTool implements BlockTool {
     });
   }
 
+  /** The clicked group's value wins over a filter on the same property. */
+  private newRowProperties(titlePropId: string, groupByPropId: string | undefined, optionId: string): Record<string, PropertyValue> {
+    const filters = (this.model.getView(this.activeViewId)?.filters ?? []).filter((f) => f.propertyId !== groupByPropId);
+    const properties: Record<string, PropertyValue> = { ...newRowValues(filters, this.model.getSchema()), [titlePropId]: '' };
+
+    return groupByPropId === undefined || optionId === NO_VALUE_GROUP_KEY
+      ? properties
+      : { ...properties, [groupByPropId]: this.groupValueFor(groupByPropId, optionId) };
+  }
+
   private groupValueFor(groupByPropId: string, optionId: string): PropertyValue {
     return this.model.getProperty(groupByPropId)?.type === 'multiSelect' ? [optionId] : optionId;
   }
@@ -1165,9 +1171,7 @@ export class DatabaseTool implements BlockTool {
 
     const titleProp = this.model.getSchema().find((p) => p.type === 'title');
     const titlePropId = titleProp?.id ?? '';
-    const rowData = this.model.createRowData(optionId === NO_VALUE_GROUP_KEY
-      ? { [titlePropId]: '' }
-      : { [titlePropId]: '', [groupByPropId]: this.groupValueFor(groupByPropId, optionId) });
+    const rowData = this.model.createRowData(this.newRowProperties(titlePropId, groupByPropId, optionId));
 
     this.api.blocks.insertAt(
       'database-row',
```
4. Run the same two commands. Observed: `Tests  3 passed | 155 skipped (158)` (F2 and F3 together) and `Tests  70 passed (70)`.
5. Guard check: I swapped the precedence to `{ [groupByPropId]: …, ...properties }` and dropped the group-by filter exclusion. The guard then failed with `× lets the column a card is added to win over a filter on another value`. I restored the code.
6. Folder run: `npx vitest run test/unit/tools/database` gave `Test Files  37 passed (37)`, `Tests  1235 passed (1235)`.
7. Lint and types:
   ```bash
   npx eslint src/tools/database/database-query.ts src/tools/database/index.ts test/unit/tools/database/database.test.ts test/unit/tools/database/database-query.test.ts test/unit/tools/database/database-card-drawer-tab-sync.test.ts test/playwright/tests/undo-audit/containers.spec.ts test/playwright/tests/undo-audit/gestures.spec.ts
   NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
   ```
   Observed: eslint exit 0 (after two fixes: an exhaustive `switch`, and `Object.assign`/`vi.spyOn` instead of assigning to a parameter's property). tsc printed 0 `error TS` lines.
8. Commit. F3's guard test is in the same file, so it goes in this commit too:
   ```bash
   git status --short
   git add src/tools/database/database-query.ts src/tools/database/index.ts test/unit/tools/database/database-query.test.ts test/unit/tools/database/database.test.ts
   git commit -m "fix(database): new rows take the values of the view's equals filters"
   ```
   Only the two `insertAt('database-row', …)` sites exist in `src/tools/database/` (`handleAddListRow` and `handleAddRow`, checked with grep). Both now go through `newRowProperties`.

---

- [ ] **Step F3: a peer change mid-drag on a sorted board (Review Focus 4). This is a guard, not a fix.**

`index.ts` already defers the redraw. `handleBlockChanged` → `reprojectRows` → `redrawWhenIdle`, and `isInteracting()` returns true while `this.cardDrag?.active` is set. The redraw then waits for `pointerup`/`pointercancel`/`keyup`/`focusout` plus `setTimeout(0)`.

1. Write the test. Append after F2's block in `database.test.ts`:
```ts
  describe('a peer change during a drag on a sorted board', () => {
    /** A row whose saved data follows its updateProperties/updatePosition calls. */
    const writableRow = (id: string, properties: Record<string, PropertyValue>, position: string): BlockAPI => {
      const block = createMockRowBlock({ id, properties, position });
      const data = block.preservedData as DatabaseRowData;

      vi.mocked(block.call).mockImplementation((method: string, params?: unknown) => {
        if (method === 'updateProperties') Object.assign(data.properties, params);
      });

      return block;
    };

    /** jsdom has no layout: give column i the x range [i*100, i*100+99]. */
    const layOutColumns = (element: HTMLElement): void => {
      queryAllByData(element, 'data-blok-database-column').forEach((column, i) => {
        vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(new DOMRect(i * 100, 0, 99, 500));
      });
    };

    const columnCards = (element: HTMLElement, optionId: string): string[] => {
      const column = queryAllByData(element, 'data-option-id', optionId).find((el) => el.hasAttribute('data-blok-database-column'));

      return column === undefined ? [] : queryAllByData(column, 'data-blok-database-card').map((el) => el.getAttribute('data-row-id') ?? '');
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('keeps the dragged card in place until the drop, then writes the drop column', async () => {
      const childBlocks = [
        writableRow('row-a', { 'prop-title': 'A', 'prop-status': 'opt-todo' }, 'a0'),
        writableRow('row-b', { 'prop-title': 'B', 'prop-status': 'opt-todo' }, 'a1'),
        writableRow('row-x', { 'prop-title': 'X', 'prop-status': 'opt-todo' }, 'a2'),
      ];
      const options = createDatabaseOptions({
        views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', filters: [], visibleProperties: [],
          sorts: [{ propertyId: 'prop-title', direction: 'asc' }] }],
      }, {}, { childBlocks });
      const tool = new DatabaseTool(options);
      const element = tool.render();

      document.body.appendChild(element);
      tool.rendered();
      layOutColumns(element);

      const cardDrag = (tool as unknown as { cardDrag: DatabaseCardDrag }).cardDrag;
      const sourceCard = queryAllByData(element, 'data-row-id', 'row-x').find((el) => el.hasAttribute('data-blok-database-card'));

      cardDrag.beginTracking('row-x', 0, 0);
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 50 }));

      // A peer renames A to Z and moves it: the sort now puts it after X.
      const rowA = childBlocks[0].preservedData as DatabaseRowData;

      rowA.properties['prop-title'] = 'Z';
      rowA.position = 'a3';
      const api = (tool as unknown as { api: API }).api;
      const listener = vi.mocked(api.events.on).mock.calls.find(([name]) => name === 'block changed')?.[1] as (payload: unknown) => void;

      listener({ event: { type: 'block-changed', detail: { target: childBlocks[0] } } });
      await Promise.resolve();

      expect(sourceCard?.isConnected).toBe(true);
      expect(columnCards(element, 'opt-todo')).toEqual(['row-a', 'row-b', 'row-x']);

      // Doing is the third column: no-value, Todo, Doing.
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 250, clientY: 50 }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(childBlocks[2].call).mock.calls.filter(([method]) => method === 'updateProperties'))
        .toEqual([['updateProperties', { 'prop-status': 'opt-doing' }]]);
      expect(columnCards(element, 'opt-doing')).toEqual(['row-x']);
      expect(columnCards(element, 'opt-todo')).toEqual(['row-b', 'row-a']);

      tool.destroy();
    });
  });
```
2. Run `npx vitest run test/unit/tools/database/database.test.ts -t "a peer change during a drag"`. Observed: **passed on the first run.** No production change is needed.
3. Proof that the guard works: I removed `this.cardDrag?.active === true ||` from `isInteracting()`. The test then failed with `AssertionError: expected false to be true` at the `sourceCard?.isConnected` assertion. I restored the code (`git checkout src/tools/database/index.ts`).
4. Lint: covered by the F2 step 7 eslint run (exit 0). Commit: this test is part of the F2 commit.
5. **Gap found, NOT fixed: D introduced it.** A peer change to a title alone on a title-sorted board leaves the cards in the wrong order.
   - Probe, run and then removed. It was in this `describe`, with `writableRow` and `columnCards`:
     - board sorted by title ascending, rows A (`a0`) and B (`a1`)
     - the peer sets A's title to `Z`
     - fire the `block changed` listener, then await a microtask and `setTimeout(0)`
   - Result: `AssertionError: expected [ 'Z', 'B' ] to deeply equal [ 'B', 'Z' ]`.
   - Cause: `retitledRows` sees a change to the title alone and updates it in place (`view.updateRowTitle`). It never redraws, so the sort is not re-applied.
   - Before D, nothing applied a sort, so position order was right. This is a D regression, on the path Review Focus 4 names.
   - Minimal fix (unverified, not drafted): in `reprojectRows`, when the active view has a sort on the title property, take the `redrawWhenIdle()` path instead of the in-place retitle. `redrawWhenIdle` already waits out a drag or an open input.
   - Add this to Review Focus 4, or as an extra step before F6.

---

- [ ] **Step F4: e2e fallout from the no-value column. Written, NOT run.**

C1 always renders the no-value column first. Positional column reads in two specs move by one. Apply this diff:
```diff
diff --git a/test/playwright/tests/undo-audit/containers.spec.ts b/test/playwright/tests/undo-audit/containers.spec.ts
index 03a587b6..48eb3478 100644
--- a/test/playwright/tests/undo-audit/containers.spec.ts
+++ b/test/playwright/tests/undo-audit/containers.spec.ts
@@ -252,11 +252,16 @@ const DB_DOC: OutputData = {
   ],
 };
 
-/** Card ids and titles the board shows, per column, in DOM order. */
-const boardCards = async (page: Page): Promise<string[][]> => page.evaluate(() =>
-  Array.from(document.querySelectorAll('[data-blok-database-column]')).map(col =>
+/**
+ * Card ids and titles per column, keyed by the column's option id, in DOM order.
+ * Keyed, not positional: the no-value column renders first, even when empty.
+ */
+const boardCards = async (page: Page): Promise<Record<string, string[]>> => page.evaluate(() =>
+  Object.fromEntries(Array.from(document.querySelectorAll('[data-blok-database-column]')).map(col => [
+    col.getAttribute('data-option-id') ?? '',
     Array.from(col.querySelectorAll('[data-blok-database-card]')).map(c =>
-      `${c.getAttribute('data-row-id') ?? ''}:${(c.querySelector('[data-blok-database-card-title]')?.textContent ?? '').trim()}`)));
+      `${c.getAttribute('data-row-id') ?? ''}:${(c.querySelector('[data-blok-database-card-title]')?.textContent ?? '').trim()}`),
+  ])));
 
 test.describe.configure({ retries: 0 });
 
@@ -504,7 +509,7 @@ test.describe('CON database', () => {
 
     await undo(page);
 
-    await expect.poll(async () => (await boardCards(page))[0], { message: 'Todo column after undo', timeout: 2000 }).toEqual(['row-1:Card one']);
+    await expect.poll(async () => (await boardCards(page))['opt-todo'], { message: 'Todo column after undo', timeout: 2000 }).toEqual(['row-1:Card one']);
     expect((await save(page)).find(b => b.id === 'row-1')?.data.properties).toEqual({ 'prop-title': 'Card one', 'prop-status': 'opt-todo' });
   });
 
@@ -516,7 +521,7 @@ test.describe('CON database', () => {
     await gap(page);
     const afterAdd = await boardCards(page);
 
-    expect(afterAdd[0]).toHaveLength(2);
+    expect(afterAdd['opt-todo']).toHaveLength(2);
 
     await undo(page);
     await redo(page);
@@ -540,6 +545,6 @@ test.describe('CON database', () => {
     await redo(page);
 
     expect((await save(page)).some(b => b.id === 'row-1')).toBe(false);
-    await expect.poll(async () => (await boardCards(page))[0], { message: 'Todo column after redo', timeout: 2000 }).toEqual([]);
+    await expect.poll(async () => (await boardCards(page))['opt-todo'], { message: 'Todo column after redo', timeout: 2000 }).toEqual([]);
   });
 });
diff --git a/test/playwright/tests/undo-audit/gestures.spec.ts b/test/playwright/tests/undo-audit/gestures.spec.ts
index 18619d15..e0a46682 100644
--- a/test/playwright/tests/undo-audit/gestures.spec.ts
+++ b/test/playwright/tests/undo-audit/gestures.spec.ts
@@ -442,7 +442,7 @@ test.describe('GES database board', () => {
     await createBlok(page, DB_BOARD);
     await gap(page);
     const s = await page.locator('[data-blok-database-card][data-row-id="row-1"]').boundingBox();
-    const t = await page.locator('[data-blok-database-column]').nth(1).boundingBox();
+    const t = await page.locator('[data-blok-database-column][data-option-id="opt-done"]').boundingBox();
 
     if (s === null || t === null) {
       throw new Error('no box');
@@ -454,12 +454,12 @@ test.describe('GES database board', () => {
     await gap(page);
     const cardsAfter = await boardCards(page);
 
-    // Dropped below row-2, so row-1 gets a position after row-2's.
-    expect(cardsAfter).toEqual([[], ['row-2:Card two', 'row-1:Card one']]);
+    // Columns: no-value (always first), Todo, Done. Dropped below row-2, so row-1 sorts after it.
+    expect(cardsAfter).toEqual([[], [], ['row-2:Card two', 'row-1:Card one']]);
 
     await park(page);
     await undo(page);
-    await expect.poll(async () => boardCards(page)).toEqual([['row-1:Card one'], ['row-2:Card two']]);
+    await expect.poll(async () => boardCards(page)).toEqual([[], ['row-1:Card one'], ['row-2:Card two']]);
     await redo(page);
 
     await expect.poll(async () => boardCards(page), { message: 'board after redo', timeout: 2000 }).toEqual(cardsAfter);
```
- GES-7 still compares whole boards positionally, as the task asked. Its arrays now start with the empty no-value column.
- `containers.spec.ts`: `boardCards` is now keyed by `data-option-id`.
  - CON-9, CON-10 and CON-11 read `['opt-todo']`.
  - CON-11 is no longer vacuous. Before, `[0]` was the always-empty no-value column. Now, if the Todo column is missing, `undefined` fails `toEqual([])`.
  - CON-10's whole-board `toEqual(afterAdd)` compares records, which works the same way.

**W4D-C3 (`w4-database.spec.ts`, "deleting a board column with its card"): no edit. The executor must check these points.**
The spec compares `s0`/`s1` snapshots of the saved data plus `screen()`, so it never asserts what the delete did. With C3, run it and confirm:
1. It passes. Undo gives back exactly `s0` and redo gives back exactly `s1`.
2. Read `s1` and confirm it is C3's behaviour, not row deletion. In `s1.data`:
   - `row-2` still exists, with `prop-status` cleared.
   - `opt-done` is gone from `db-1`'s schema.
   - In `s1.view.columns`, `row-2:Card two` is under `__blok-no-value-group__`.

   Add `expect(s1.data.some(b => b.id === 'row-2')).toBe(true)` locally, or log `s1`, to see this.
3. **One** undo brings back both the option and `row-2`'s `prop-status: 'opt-done'`, with the card back in the Done column, and `canRedo` is true. If one undo restores only part of it, the C3 write is split across undo steps. That is Review Focus 2.
4. W4D-C4 (Done dragged before Todo) now drops after the no-value column. Its `toEqual(s0)`/`toEqual(s1)` still apply. Confirm it passes.

Also run, unverified for this column change: `ui/rtl-math-and-widgets.spec.ts:244`, which measures `first()` column, now the no-value column.

Commit after the specs pass:
```bash
git status --short
git add test/playwright/tests/undo-audit/gestures.spec.ts test/playwright/tests/undo-audit/containers.spec.ts
git commit -m "test(e2e): read board columns by option id after the no-value column"
```

Run (executor, on a free e2e port):
```bash
yarn e2e test/playwright/tests/undo-audit/gestures.spec.ts -g "GES-7"
yarn e2e test/playwright/tests/undo-audit/containers.spec.ts -g "CON-9|CON-10|CON-11"
yarn e2e test/playwright/tests/undo-audit/w4-database.spec.ts -g "W4D-C3|W4D-C4"
yarn e2e test/playwright/tests/ui/rtl-math-and-widgets.spec.ts
```

---

- [ ] **Step F5: translate `tools.database.noValueGroup` ("No {property}") into all 68 non-English locales**

Sources: the `blok-translations` skill and its referenced checklist, memory `i18n-new-key-checklist.md`.
- The skill's `<code>/messages.json` layout is stale. Locales are flat: `src/components/i18n/locales/<code>.json`.
- Measured baseline (INTEGRATION-NOTES): this one en.json line causes all **139** i18n failures:
  - 68 in untranslated-strings
  - 68 + 1 (the en digest) in translation-guidelines
  - 2 in taiwan-traditional-chinese

Procedure:
1. Draft the values per locale into scratch JSON, never directly into the 69 files. Use parallel subagents by locale group.
   - Keep `{property}` exactly as written. zh-TW fails with `expected {property}, received {}` if it is dropped.
   - Reuse each locale's existing word for "No" / "None" from neighbouring database keys. Run a node script that prints the per-locale values first.
2. Insert the key into every `src/components/i18n/locales/<code>.json` at en's position, right after the key before it in `en.json`. Do this with one script, never by hand.
3. Any value identical to English needs **both** of these, with exact parity:
   - an entry in `COGNATE_RETENTIONS` (`test/unit/components/i18n/untranslated-strings.test.ts`)
   - a ledger retention row `R-<locale>-NNN` in `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`
4. Rewrite **both** sha256 columns in the ledger's "Reviewed Dictionary Digests" table for every changed locale **and for `en`**. The en row currently fails with `en: first-pass digest does not match current dictionary`. Each digest is `sha256:` + the hex of the raw file bytes, as `translation-guidelines.test.ts` computes it.
5. `types/message-keys.d.ts` and the `lifecycle-coverage.test.ts` pins are already updated by C. Re-run `node scripts/generate-message-keys-dts.mjs` and confirm `git diff types/message-keys.d.ts` is empty.

Proof of completion: all three commands exit 0, with **0 failures** in the 3 files that had the 139.
```bash
npx vitest run test/unit/components/i18n/untranslated-strings.test.ts
npx vitest run test/unit/components/i18n/translation-guidelines.test.ts
npx vitest run test/unit/components/i18n/taiwan-traditional-chinese.test.ts
yarn i18n:check
npx vitest run test/unit/components/i18n
```
Commit: `git add src/components/i18n/locales/*.json docs/plans/2026-07-19-all-locales-translation-audit-ledger.md` (add `test/unit/components/i18n/untranslated-strings.test.ts` only if retentions changed).

---

- [ ] **Step F6: final gates, in order**

1. Confirm the F1, F2 and F4 commits landed (`git log --oneline -4`). End each commit message with the repo's `Co-Authored-By` trailer.
2. `yarn lint` is the full-project gate. The memory note "full ESLint unrunnable" says it may not complete locally; if so, record that and fall back to CI's lint job. Unverified here.
3. `yarn test` is the full unit suite. Known reds:
   - `architecture/react-fixture-import-map-law.test.ts` (3 tests) needs `yarn build` first. It fails the same way on base.
   - i18n is clean only after F5.
4. Scoped e2e: the commands in F4, plus the Phase 0 database specs listed in INTEGRATION-NOTES "E2E risk". Run them when port 4444 is free.
5. `/verify` (`.claude/skills/verify/SKILL.md`):
   - Build: `node scripts/generate-fonts.mjs && npx vite build --mode test`.
   - Serve the repo root on **4446**: `npx serve . -l 4446 --no-clipboard`.
   - Drive a throwaway fixture page with `playwright-cli`. Make a filtered board, click "+ New" and confirm the row survives a view switch. Delete a column with a card, undo once, and confirm the card is back.
   - Clean up: close, kill the server, delete the fixture.
6. Completion checklist (repo CLAUDE.md):
   - [ ] Tests were written first and watched failing (F1 repro, F2). Bug fixes were watched passing, then the full suite was re-run.
   - [ ] `git pull` and `git push` succeeded. Notify peer sessions that are running gates before pushing to main.
   - [ ] `git status` shows "up to date with origin".
   - [ ] No `git stash` left behind. No `BREAKING` label from F: no public surface changed.

**Unverified in this task:** every e2e spec, `yarn lint`, the full `yarn test`, `/verify`, and the F5 translations.

**Diff check:** `git apply --check phase-0-artifacts/F-final.diff` on a clean worktree at `34f741c0` exited 0.
