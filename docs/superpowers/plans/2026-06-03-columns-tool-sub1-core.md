# Columns Tool — Sub-project 1 (Core Blocks + Presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two block tools — `column_list` and `column` — that let users insert a side-by-side multi-column layout (2–5) from the slash menu, with content stored as real nested blocks.

**Architecture:** Follows Blok's flat-with-references hierarchy (`parentId`/`contentIds`) and the existing container-tool pattern (callout/database). A `column_list` block hosts `column` block children; each `column` hosts arbitrary user blocks. Columns render in a flex row. Presets are toolbox entries carrying a transient `columnCount` seed; on first `rendered()` the `column_list` spawns N `column` children, and each `column` seeds an empty paragraph. Reaching 1 column auto-unwraps. Width resize, drag-beside, and arrow-nav are separate sub-projects.

**Tech Stack:** TypeScript, Vitest (jsdom) for unit, Playwright for E2E, Tailwind via `twMerge`.

**Reference precedents (read before starting):**
- `src/tools/callout/index.ts` — container `rendered()` seeding a child via `insertInsideParent`, manual holder append, `mountChildBlocks`.
- `src/tools/database/index.ts:724-733` — typed child creation via `api.blocks.insert(type, data, {}, index, false, false, id)` + `api.blocks.setBlockParent(childId, parentId)`.
- `src/tools/divider/index.ts` — minimal tool shape.
- `src/tools/header/index.ts` toolbox getter — array of toolbox entries with `data` overrides (preset pattern).
- `src/tools/nested-blocks.ts` — `mountChildBlocks`.
- `test/unit/tools/header.test.ts` — mock-API factory + options factory test pattern.

**Relevant API signatures (verified):**
- `api.blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?): BlockAPI`
- `api.blocks.insertInsideParent(parentId, insertIndex, childData?): BlockAPI` (always inserts the default paragraph tool)
- `api.blocks.setBlockParent(blockId, parentId | null): void`
- `api.blocks.getChildren(parentId): BlockAPI[]`
- `api.blocks.getBlockIndex(blockId): number | undefined`
- `api.caret.setToBlock(idOrBlockOrIndex, position?: 'end'|'start'|'default', offset?): boolean`

**Run commands:**
- Single unit file: `yarn test test/unit/tools/column.test.ts`
- Single unit test: `yarn test -t "applies flex from widthRatio"`
- Single e2e: `yarn e2e test/playwright/tests/tools/columns.spec.ts`
- i18n check: `yarn i18n:check`
- Lint: `yarn lint`

---

## File Structure

**New files:**
```
src/tools/column/types.ts            — ColumnData interface
src/tools/column/index.ts            — Column tool (flex item, seeds a paragraph)
src/tools/column-list/types.ts       — ColumnListData interface
src/tools/column-list/index.ts       — ColumnList tool (flex row, seeds N columns, presets)
src/tools/columns-shared.ts          — nesting guard + auto-unwrap helpers, shared constants
test/unit/tools/column.test.ts
test/unit/tools/column-list.test.ts
test/unit/tools/columns-shared.test.ts
test/playwright/tests/tools/columns.spec.ts
```

**Modified files:**
```
src/tools/index.ts                                  — export Column, ColumnList; add to defaultBlockTools
types/tools-entry.d.ts                              — public type exports
src/components/modules/blockManager/operations.ts   — extend newToolCanHostChildren (line ~708)
src/components/icons/index.ts                        — add IconColumns
index.html                                           — import, state checkbox, iconGroups entry
src/components/i18n/locales/en/messages.json          — add keys; sync all locales
```

---

## Shared Constants & Data Attributes

These attribute names are used across tasks. Define them once in `columns-shared.ts` (Task 7) and import where needed:

```typescript
export const COLUMN_LIST_TOOL = 'column_list';
export const COLUMN_TOOL = 'column';
export const COLUMNS_ATTR = 'data-blok-columns';      // column_list flex-row container
export const COLUMN_ATTR = 'data-blok-column';        // a single column flex item
```

The child containers reuse the framework's existing `DATA_ATTR.nestedBlocks`
(`data-blok-nested-blocks`) so `mountChildBlocks` reconciles correctly.

---

## Task 1: Column tool — render + save + widthRatio

**Files:**
- Create: `src/tools/column/types.ts`
- Create: `src/tools/column/index.ts`
- Test: `test/unit/tools/column.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/tools/column.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Column, type ColumnData } from '../../../src/tools/column';
import type { API, BlockToolConstructorOptions } from '../../../types';

const createMockAPI = (overrides: Partial<API> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (key: string) => key, has: () => false },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    getBlockIndex: vi.fn().mockReturnValue(0),
    insertInsideParent: vi.fn(),
  },
  caret: { setToBlock: vi.fn() },
  ...overrides,
} as unknown as API);

const createColumnOptions = (
  data: Partial<ColumnData> = {},
  api: API = createMockAPI()
): BlockToolConstructorOptions<ColumnData> => ({
  data: { ...data } as ColumnData,
  config: {},
  api,
  readOnly: false,
  block: { id: 'col-1' } as never,
});

describe('Column tool', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders a flex-item container with the column attribute', () => {
    const column = new Column(createColumnOptions());
    const el = column.render();
    expect(el).toHaveAttribute('data-blok-column');
    expect(el.style.flexGrow).toBe('1');
  });

  it('applies flex from widthRatio when set', () => {
    const column = new Column(createColumnOptions({ widthRatio: 0.25 }));
    const el = column.render();
    expect(el.style.flexGrow).toBe('0.25');
  });

  it('saves widthRatio when set, empty object otherwise', () => {
    const withRatio = new Column(createColumnOptions({ widthRatio: 0.4 }));
    withRatio.render();
    expect(withRatio.save()).toEqual({ widthRatio: 0.4 });

    const without = new Column(createColumnOptions());
    without.render();
    expect(without.save()).toEqual({});
  });

  it('supports read-only mode', () => {
    expect(Column.isReadOnlySupported).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column.test.ts`
Expected: FAIL — `Cannot find module '../../../src/tools/column'`.

- [ ] **Step 3: Write the types file**

Create `src/tools/column/types.ts`:

```typescript
import type { BlockToolData } from '../../../types';

export interface ColumnData extends BlockToolData {
  /**
   * Width of this column relative to its siblings, 0–1.
   * Omitted means equal width (flex-grow: 1). Set by the resize sub-project.
   */
  widthRatio?: number;
}
```

- [ ] **Step 4: Write the minimal implementation**

Create `src/tools/column/index.ts`:

```typescript
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
} from '../../../types';
import { COLUMN_ATTR } from '../columns-shared';
import { mountChildBlocks } from '../nested-blocks';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { twMerge } from '../../components/utils/tw';
import type { ColumnData } from './types';

/**
 * Column block — a single vertical column inside a column_list.
 * Hosts arbitrary user blocks as nested children and seeds an empty
 * paragraph when created so it is never empty.
 */
export class Column implements BlockTool {
  private readonly api: API;
  private _data: ColumnData;
  private readonly blockId: string;
  private wrapper: HTMLElement | null = null;
  private childContainer: HTMLElement | null = null;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge('flex', 'flex-col', 'min-w-0', 'basis-0');
    wrapper.setAttribute(COLUMN_ATTR, '');
    wrapper.style.flexGrow = String(this._data.widthRatio ?? 1);

    const childContainer = document.createElement('div');

    childContainer.setAttribute(DATA_ATTR.nestedBlocks, '');
    wrapper.appendChild(childContainer);

    this.wrapper = wrapper;
    this.childContainer = childContainer;

    return wrapper;
  }

  public rendered(): void {
    if (this.childContainer === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    mountChildBlocks(this.childContainer, children);
  }

  public save(): ColumnData {
    return this._data.widthRatio !== undefined
      ? { widthRatio: this._data.widthRatio }
      : {};
  }

  public validate(_data: ColumnData): boolean {
    return true;
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnData };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test test/unit/tools/column.test.ts`
Expected: PASS (4 tests). Note: `columns-shared.ts` does not exist yet — temporarily add `export const COLUMN_ATTR = 'data-blok-column';` to a stub `src/tools/columns-shared.ts` if the import fails; it is fully defined in Task 7. Create the stub now:

```typescript
// src/tools/columns-shared.ts (stub — completed in Task 7)
export const COLUMN_LIST_TOOL = 'column_list';
export const COLUMN_TOOL = 'column';
export const COLUMNS_ATTR = 'data-blok-columns';
export const COLUMN_ATTR = 'data-blok-column';
```

Re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/column test/unit/tools/column.test.ts src/tools/columns-shared.ts
git commit -m "feat(columns): add Column tool render/save with widthRatio"
```

---

## Task 2: Column tool — auto-seed empty paragraph

**Files:**
- Modify: `src/tools/column/index.ts`
- Test: `test/unit/tools/column.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/tools/column.test.ts` inside `describe('Column tool', ...)`:

```typescript
it('seeds an empty paragraph child when it has no children', () => {
  const insertInsideParent = vi.fn().mockReturnValue({ id: 'p-1', holder: document.createElement('div') });
  const setToBlock = vi.fn();
  const api = createMockAPI({
    blocks: {
      getChildren: vi.fn().mockReturnValue([]),
      getBlockIndex: vi.fn().mockReturnValue(3),
      insertInsideParent,
    },
    caret: { setToBlock },
  } as unknown as Partial<API>);

  const column = new Column(createColumnOptions({}, api));
  column.render();
  column.rendered();

  expect(insertInsideParent).toHaveBeenCalledWith('col-1', 4);
  expect(setToBlock).toHaveBeenCalledWith('p-1', 'start');
});

it('does NOT seed when it already has children', () => {
  const insertInsideParent = vi.fn();
  const existingChild = { id: 'p-existing', holder: document.createElement('div') };
  const api = createMockAPI({
    blocks: {
      getChildren: vi.fn().mockReturnValue([existingChild]),
      getBlockIndex: vi.fn().mockReturnValue(3),
      insertInsideParent,
    },
    caret: { setToBlock: vi.fn() },
  } as unknown as Partial<API>);

  const column = new Column(createColumnOptions({}, api));
  column.render();
  column.rendered();

  expect(insertInsideParent).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column.test.ts -t "seeds an empty paragraph"`
Expected: FAIL — `insertInsideParent` not called (current `rendered()` only mounts).

- [ ] **Step 3: Write the implementation**

Replace the `rendered()` method in `src/tools/column/index.ts` with:

```typescript
  public rendered(): void {
    if (this.childContainer === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

      if (blockIndex !== undefined) {
        const paragraph = this.api.blocks.insertInsideParent(this.blockId, blockIndex + 1);

        this.childContainer.appendChild(paragraph.holder);
        this.api.caret.setToBlock(paragraph.id, 'start');
      }

      return;
    }

    mountChildBlocks(this.childContainer, children);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/column.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/column/index.ts test/unit/tools/column.test.ts
git commit -m "feat(columns): Column seeds an empty paragraph when created"
```

---

## Task 3: ColumnList tool — render flex-row container

**Files:**
- Create: `src/tools/column-list/types.ts`
- Create: `src/tools/column-list/index.ts`
- Test: `test/unit/tools/column-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/tools/column-list.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColumnList, type ColumnListData } from '../../../src/tools/column-list';
import type { API, BlockToolConstructorOptions } from '../../../types';

const createMockAPI = (overrides: Partial<API> = {}): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (key: string) => key, has: () => false },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    getBlockIndex: vi.fn().mockReturnValue(0),
    insert: vi.fn(),
    setBlockParent: vi.fn(),
  },
  caret: { setToBlock: vi.fn() },
  ...overrides,
} as unknown as API);

const createColumnListOptions = (
  data: Partial<ColumnListData> = {},
  api: API = createMockAPI()
): BlockToolConstructorOptions<ColumnListData> => ({
  data: { ...data } as ColumnListData,
  config: {},
  api,
  readOnly: false,
  block: { id: 'cl-1' } as never,
});

describe('ColumnList tool', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders a flex-row container with the columns attribute', () => {
    const list = new ColumnList(createColumnListOptions());
    const el = list.render();
    expect(el).toHaveAttribute('data-blok-columns');
    expect(el).toHaveAttribute('data-blok-testid', 'column-list');
    expect(el.className).toContain('flex');
  });

  it('saves an empty object', () => {
    const list = new ColumnList(createColumnListOptions({ columnCount: 3 }));
    list.render();
    expect(list.save()).toEqual({});
  });

  it('supports read-only mode', () => {
    expect(ColumnList.isReadOnlySupported).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column-list.test.ts`
Expected: FAIL — `Cannot find module '../../../src/tools/column-list'`.

- [ ] **Step 3: Write the types file**

Create `src/tools/column-list/types.ts`:

```typescript
import type { BlockToolData } from '../../../types';

export interface ColumnListData extends BlockToolData {
  /**
   * Transient seed hint: how many columns to create on first render.
   * Set only by toolbox presets; never persisted. The real structure
   * lives in the block's contentIds (the column children).
   */
  columnCount?: number;
}
```

- [ ] **Step 4: Write the minimal implementation**

Create `src/tools/column-list/index.ts`:

```typescript
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import { COLUMNS_ATTR } from '../columns-shared';
import { mountChildBlocks } from '../nested-blocks';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconColumns } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import type { ColumnListData } from './types';

/**
 * ColumnList block — horizontal container that hosts column children.
 * Created via slash-menu presets carrying a transient `columnCount` seed.
 */
export class ColumnList implements BlockTool {
  private readonly api: API;
  private _data: ColumnListData;
  private readonly blockId: string;
  private container: HTMLElement | null = null;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnListData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
  }

  public render(): HTMLElement {
    const container = document.createElement('div');

    container.className = twMerge('flex', 'flex-row', 'flex-wrap', 'gap-4', 'w-full');
    container.setAttribute(COLUMNS_ATTR, '');
    container.setAttribute('data-blok-testid', 'column-list');
    container.setAttribute(DATA_ATTR.nestedBlocks, '');

    this.container = container;

    return container;
  }

  public rendered(): void {
    if (this.container === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    mountChildBlocks(this.container, children);
  }

  public save(): ColumnListData {
    return {};
  }

  public validate(_data: ColumnListData): boolean {
    return true;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconColumns,
      titleKey: 'columns',
      name: 'column_list',
      searchTerms: ['columns', 'cols', 'layout', 'grid'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnListData };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test test/unit/tools/column-list.test.ts`
Expected: FAIL — `IconColumns` not exported yet. Add a temporary placeholder export to the END of `src/components/icons/index.ts`:

```typescript
export const IconColumns = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>`;
```

Re-run: `yarn test test/unit/tools/column-list.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/column-list test/unit/tools/column-list.test.ts src/components/icons/index.ts
git commit -m "feat(columns): add ColumnList tool render/save + IconColumns"
```

---

## Task 4: ColumnList — seed N columns from columnCount

**Files:**
- Modify: `src/tools/column-list/index.ts`
- Test: `test/unit/tools/column-list.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('ColumnList tool', ...)`:

```typescript
it('seeds N typed column children on first render from columnCount', () => {
  let counter = 0;
  const insert = vi.fn().mockImplementation(() => {
    counter += 1;

    return { id: `col-${counter}`, holder: document.createElement('div') };
  });
  const setBlockParent = vi.fn();
  const api = createMockAPI({
    blocks: {
      getChildren: vi.fn().mockReturnValue([]),
      getBlockIndex: vi.fn().mockReturnValue(5),
      insert,
      setBlockParent,
    },
    caret: { setToBlock: vi.fn() },
  } as unknown as Partial<API>);

  const list = new ColumnList(createColumnListOptions({ columnCount: 3 }, api));
  list.render();
  list.rendered();

  // Three column blocks inserted, each of type 'column'
  expect(insert).toHaveBeenCalledTimes(3);
  expect(insert.mock.calls[0][0]).toBe('column');
  // Each reparented under the column_list
  expect(setBlockParent).toHaveBeenCalledTimes(3);
  expect(setBlockParent).toHaveBeenCalledWith('col-1', 'cl-1');
});

it('defaults to 2 columns when columnCount is absent', () => {
  const insert = vi.fn().mockImplementation(() => ({ id: 'c', holder: document.createElement('div') }));
  const api = createMockAPI({
    blocks: {
      getChildren: vi.fn().mockReturnValue([]),
      getBlockIndex: vi.fn().mockReturnValue(0),
      insert,
      setBlockParent: vi.fn(),
    },
    caret: { setToBlock: vi.fn() },
  } as unknown as Partial<API>);

  const list = new ColumnList(createColumnListOptions({}, api));
  list.render();
  list.rendered();

  expect(insert).toHaveBeenCalledTimes(2);
});

it('does NOT seed columns when children already exist', () => {
  const insert = vi.fn();
  const api = createMockAPI({
    blocks: {
      getChildren: vi.fn().mockReturnValue([{ id: 'c1', holder: document.createElement('div') }]),
      getBlockIndex: vi.fn().mockReturnValue(0),
      insert,
      setBlockParent: vi.fn(),
    },
  } as unknown as Partial<API>);

  const list = new ColumnList(createColumnListOptions({ columnCount: 4 }, api));
  list.render();
  list.rendered();

  expect(insert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column-list.test.ts -t "seeds N typed column"`
Expected: FAIL — `insert` not called.

- [ ] **Step 3: Write the implementation**

Replace `rendered()` in `src/tools/column-list/index.ts` with:

```typescript
  public rendered(): void {
    if (this.container === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      this.seedColumns();

      return;
    }

    mountChildBlocks(this.container, children);
  }

  private seedColumns(): void {
    if (this.container === null) {
      return;
    }

    const count = this._data.columnCount ?? 2;
    const baseIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (baseIndex === undefined) {
      return;
    }

    // Clear the transient seed so a later re-render never re-seeds.
    this._data = { ...this._data, columnCount: undefined };

    for (let i = 0; i < count; i += 1) {
      const column = this.api.blocks.insert(
        'column',
        {},
        {},
        baseIndex + 1 + i,
        false,
        false
      );

      this.api.blocks.setBlockParent(column.id, this.blockId);
      this.container.appendChild(column.holder);
    }
  }
```

Add the `COLUMN_TOOL` import if you prefer the constant over the `'column'` literal; the literal is fine and matches the registered tool name.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/column-list.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/column-list/index.ts test/unit/tools/column-list.test.ts
git commit -m "feat(columns): ColumnList seeds N column children on first render"
```

---

## Task 5: Toolbox presets (2–5 columns)

**Files:**
- Modify: `src/tools/column-list/index.ts`
- Test: `test/unit/tools/column-list.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('ColumnList tool', ...)`:

```typescript
it('exposes toolbox presets for 2–5 columns with columnCount data overrides', () => {
  const toolbox = ColumnList.toolbox;
  const entries = Array.isArray(toolbox) ? toolbox : [toolbox];

  // One generic entry + four presets (2,3,4,5)
  const counts = entries
    .map(e => (e.data as { columnCount?: number } | undefined)?.columnCount)
    .filter((c): c is number => typeof c === 'number')
    .sort((a, b) => a - b);

  expect(counts).toEqual([2, 3, 4, 5]);
  entries.forEach(e => expect(typeof e.icon).toBe('string'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column-list.test.ts -t "toolbox presets"`
Expected: FAIL — current toolbox is a single entry with no `columnCount`.

- [ ] **Step 3: Write the implementation**

Replace the `toolbox` getter in `src/tools/column-list/index.ts` with:

```typescript
  public static get toolbox(): ToolboxConfig {
    const base = {
      icon: IconColumns,
      searchTerms: ['columns', 'cols', 'layout', 'grid'],
    };

    return [
      {
        ...base,
        titleKey: 'columns',
        name: 'column_list',
      },
      ...[2, 3, 4, 5].map(count => ({
        ...base,
        titleKey: `tools.columns.col${count}`,
        name: `column_list-${count}`,
        data: { columnCount: count },
        searchTerms: [...base.searchTerms, `${count}c`, `c${count}`],
      })),
    ];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/column-list.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/column-list/index.ts test/unit/tools/column-list.test.ts
git commit -m "feat(columns): add 2–5 column toolbox presets"
```

---

## Task 6: Nesting guard helper

**Files:**
- Modify: `src/tools/columns-shared.ts`
- Test: `test/unit/tools/columns-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/tools/columns-shared.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isInsideColumn, COLUMN_TOOL } from '../../../src/tools/columns-shared';

interface FakeBlock {
  id: string;
  name: string;
  parentId: string | null;
}

const makeTree = (blocks: FakeBlock[]) => {
  const byId = new Map(blocks.map(b => [b.id, b]));

  return (id: string): { name: string; parentId: string | null } | undefined => {
    const b = byId.get(id);

    return b ? { name: b.name, parentId: b.parentId } : undefined;
  };
};

describe('isInsideColumn', () => {
  it('returns true when an ancestor is a column block', () => {
    const lookup = makeTree([
      { id: 'cl', name: 'column_list', parentId: null },
      { id: 'c1', name: COLUMN_TOOL, parentId: 'cl' },
      { id: 'p1', name: 'paragraph', parentId: 'c1' },
    ]);
    expect(isInsideColumn('p1', lookup)).toBe(true);
  });

  it('returns false for a root-level block', () => {
    const lookup = makeTree([
      { id: 'p1', name: 'paragraph', parentId: null },
    ]);
    expect(isInsideColumn('p1', lookup)).toBe(false);
  });

  it('is cycle-safe', () => {
    const lookup = makeTree([
      { id: 'a', name: 'paragraph', parentId: 'b' },
      { id: 'b', name: 'paragraph', parentId: 'a' },
    ]);
    expect(isInsideColumn('a', lookup)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/columns-shared.test.ts`
Expected: FAIL — `isInsideColumn` is not exported.

- [ ] **Step 3: Write the implementation**

Replace the stub `src/tools/columns-shared.ts` with:

```typescript
export const COLUMN_LIST_TOOL = 'column_list';
export const COLUMN_TOOL = 'column';
export const COLUMNS_ATTR = 'data-blok-columns';
export const COLUMN_ATTR = 'data-blok-column';

/**
 * Minimal block view the helpers need — kept structural so callers can pass
 * either real Blocks or test fakes.
 */
export interface BlockNode {
  name: string;
  parentId: string | null;
}

/**
 * Walk the parentId chain from `blockId` upward; return true if any ancestor
 * is a `column` block. Cycle-safe via a visited set.
 *
 * Used to reject placing a column_list inside a column (no nested columns).
 */
export const isInsideColumn = (
  blockId: string,
  lookup: (id: string) => BlockNode | undefined
): boolean => {
  const visited = new Set<string>();
  let current = lookup(blockId)?.parentId ?? null;

  while (current !== null && !visited.has(current)) {
    visited.add(current);

    const node = lookup(current);

    if (node === undefined) {
      return false;
    }

    if (node.name === COLUMN_TOOL) {
      return true;
    }

    current = node.parentId;
  }

  return false;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/columns-shared.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/columns-shared.ts test/unit/tools/columns-shared.test.ts
git commit -m "feat(columns): add isInsideColumn nesting-guard helper"
```

> Note: full enforcement (rejecting drag/convert that would nest a column_list inside a column) is wired in Sub-project 3 (drag-beside), which is the only path that can produce such a move. This task delivers and tests the pure predicate.

---

## Task 7: Auto-unwrap helper

**Files:**
- Modify: `src/tools/columns-shared.ts`
- Test: `test/unit/tools/columns-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/tools/columns-shared.test.ts`:

```typescript
import { vi } from 'vitest';
import { unwrapColumnListIfCollapsed } from '../../../src/tools/columns-shared';
import type { API } from '../../../types';

describe('unwrapColumnListIfCollapsed', () => {
  it('promotes the surviving column blocks and deletes both wrappers when 1 column remains', async () => {
    const survivingChild = { id: 'p1' };
    const remainingColumn = { id: 'colA' };

    const getChildren = vi.fn()
      .mockReturnValueOnce([remainingColumn])        // column_list has 1 column
      .mockReturnValueOnce([survivingChild]);        // that column has 1 paragraph
    // delete() is index-based; resolve ids to indices on demand
    const indexById: Record<string, number> = { colA: 8, 'cl-1': 7 };
    const getBlockIndex = vi.fn().mockImplementation((id: string) => indexById[id]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);

    const api = {
      blocks: { getChildren, getBlockIndex, setBlockParent, delete: remove },
    } as unknown as API;

    const didUnwrap = await unwrapColumnListIfCollapsed(api, 'cl-1');

    expect(didUnwrap).toBe(true);
    // surviving paragraph promoted to root (null parent)
    expect(setBlockParent).toHaveBeenCalledWith('p1', null);
    // both wrappers deleted by index (column first, then list)
    expect(remove).toHaveBeenCalledWith(8);
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('does nothing when 2+ columns remain', async () => {
    const getChildren = vi.fn().mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    const setBlockParent = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    const api = {
      blocks: { getChildren, getBlockIndex: vi.fn(), setBlockParent, delete: remove },
    } as unknown as API;

    expect(await unwrapColumnListIfCollapsed(api, 'cl-1')).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
```

> Note: `api.blocks.delete(index?: number)` is **index-based and async** (verified in `types/api/blocks.d.ts`; database does `getBlockIndex(id)` then `delete(index)` at `src/tools/database/index.ts:290`). The helper resolves ids to indices and deletes the column before the list (re-reading the list's index after the column delete shifts positions).

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/columns-shared.test.ts -t "unwrap"`
Expected: FAIL — `unwrapColumnListIfCollapsed` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/tools/columns-shared.ts`:

```typescript
import type { API } from '../../types';

/**
 * If a column_list has collapsed to a single column, dissolve it:
 * promote the surviving column's child blocks to root level and delete
 * both the column and the column_list.
 *
 * `api.blocks.delete` is index-based and async, so ids are resolved to
 * indices on demand; the column is deleted before the list, and the list's
 * index is re-read afterwards because the earlier delete shifts positions.
 *
 * Returns true when an unwrap occurred.
 */
export const unwrapColumnListIfCollapsed = async (
  api: API,
  columnListId: string
): Promise<boolean> => {
  const columns = api.blocks.getChildren(columnListId);

  if (columns.length !== 1) {
    return false;
  }

  const [survivingColumn] = columns;
  const survivingBlocks = api.blocks.getChildren(survivingColumn.id);

  for (const child of survivingBlocks) {
    api.blocks.setBlockParent(child.id, null);
  }

  const columnIndex = api.blocks.getBlockIndex(survivingColumn.id);

  if (columnIndex !== undefined) {
    await api.blocks.delete(columnIndex);
  }

  const listIndex = api.blocks.getBlockIndex(columnListId);

  if (listIndex !== undefined) {
    await api.blocks.delete(listIndex);
  }

  return true;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/columns-shared.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/columns-shared.ts test/unit/tools/columns-shared.test.ts
git commit -m "feat(columns): add auto-unwrap helper for collapsed column_list"
```

---

## Task 8: Wire auto-unwrap into Column.removed()

**Files:**
- Modify: `src/tools/column/index.ts`
- Test: `test/unit/tools/column.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('Column tool', ...)`:

```typescript
it('attempts to unwrap its parent column_list when removed', async () => {
  const getChildren = vi.fn()
    .mockReturnValueOnce([{ id: 'colA' }])  // column_list now has 1 column
    .mockReturnValueOnce([{ id: 'p1' }]);   // surviving column's child
  const setBlockParent = vi.fn();
  const remove = vi.fn().mockResolvedValue(undefined);
  const indexById: Record<string, number> = { colA: 2, 'cl-1': 1 };
  const api = createMockAPI({
    blocks: {
      getChildren,
      getBlockIndex: vi.fn().mockImplementation((id: string) => indexById[id] ?? 0),
      setBlockParent,
      delete: remove,
      insertInsideParent: vi.fn(),
    },
    caret: { setToBlock: vi.fn() },
  } as unknown as Partial<API>);

  // parentId is needed so removed() knows which column_list to check
  const options = createColumnOptions({}, api);
  (options.block as unknown as { parentId: string }).parentId = 'cl-1';

  const column = new Column(options);
  column.render();
  column.removed();

  // removed() fires the async unwrap without awaiting; let microtasks drain
  await Promise.resolve();
  await Promise.resolve();

  expect(remove).toHaveBeenCalledWith(1); // column_list index
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/column.test.ts -t "unwrap its parent"`
Expected: FAIL — `Column` has no `removed()` calling the helper.

- [ ] **Step 3: Write the implementation**

In `src/tools/column/index.ts`:
1. Import the helper: add `import { unwrapColumnListIfCollapsed } from '../columns-shared';`
2. Capture the parent id in the constructor. Change the constructor to also read `block.parentId`:

```typescript
  private readonly parentId: string | null;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
    this.parentId = (block as unknown as { parentId?: string | null }).parentId ?? null;
  }
```

3. Add the lifecycle method:

```typescript
  public removed(): void {
    if (this.parentId !== null) {
      // Fire-and-forget: the lifecycle hook is synchronous, the unwrap is not.
      void unwrapColumnListIfCollapsed(this.api, this.parentId);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/column.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/column/index.ts test/unit/tools/column.test.ts
git commit -m "feat(columns): auto-unwrap parent column_list when a column is removed"
```

---

## Task 9: Register tools (exports, defaults, host-children, public types)

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `src/components/modules/blockManager/operations.ts:708`
- Modify: `types/tools-entry.d.ts`

- [ ] **Step 1: Extend `newToolCanHostChildren`**

In `src/components/modules/blockManager/operations.ts`, change the condition (currently at ~line 708) to:

```typescript
    const newToolCanHostChildren = newTool === 'toggle' ||
      newTool === 'callout' ||
      newTool === 'column_list' ||
      newTool === 'column' ||
      (newTool === 'header' && (data as { isToggleable?: boolean }).isToggleable === true);
```

- [ ] **Step 2: Export tools and register defaults**

In `src/tools/index.ts`, add after the `image` export (line 34):

```typescript
export { ColumnList } from './column-list';
export { Column } from './column';
```

And in `defaultBlockTools` (after `image: {}`):

```typescript
  column_list: {},
  column: {},
```

- [ ] **Step 3: Add public type exports**

In `types/tools-entry.d.ts`, mirror the existing tool export style (check the file for the exact `BlockToolConstructable` pattern used by `Divider`) and add:

```typescript
export const ColumnList: import('./tools/tool-settings').BlockToolConstructable;
export const Column: import('./tools/tool-settings').BlockToolConstructable;
export type { ColumnListData } from '../src/tools/column-list/types';
export type { ColumnData } from '../src/tools/column/types';
```

> Open `types/tools-entry.d.ts` first and copy the precise import path / declaration form used for `Divider`/`Image`; match it exactly rather than the approximation above.

- [ ] **Step 4: Verify nothing broke**

Run: `yarn lint && yarn test test/unit/tools/column.test.ts test/unit/tools/column-list.test.ts test/unit/tools/columns-shared.test.ts`
Expected: lint clean; all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/index.ts src/components/modules/blockManager/operations.ts types/tools-entry.d.ts
git commit -m "feat(columns): register column_list/column tools and allow child hosting"
```

---

## Task 10: i18n keys + icon gallery + playground wiring

**Files:**
- Modify: `src/components/i18n/locales/en/messages.json`
- Modify: `index.html`

- [ ] **Step 1: Add English i18n keys**

In `src/components/i18n/locales/en/messages.json`, add the tool-name and preset keys. Match the existing JSON shape (find `"toolNames"` and `"tools"` objects):

```jsonc
// under toolNames
"columns": "Columns",
// under tools (new "columns" object)
"columns": {
  "col2": "2 columns",
  "col3": "3 columns",
  "col4": "4 columns",
  "col5": "5 columns"
}
```

- [ ] **Step 2: Sync all locales and validate**

Use the translation workflow (the `blok-translations` skill / repo i18n tooling) to propagate the new keys to all locales, then:

Run: `yarn i18n:check`
Expected: PASS — every locale has the new keys, none missing/extra.

- [ ] **Step 3: Wire the playground**

In `index.html`:
1. Add `ColumnList, Column` to the tools import (around line 747).
2. Register them in the tools state/instantiation block (mirror how `callout`/`divider` are added): add `column_list` and `column` so they load.
3. Add `'IconColumns'` to the `iconGroups` object's `'Block Tools'` array (around line 909 / 1811 — search for `iconGroups`).

- [ ] **Step 4: Verify build + lint**

Run: `yarn lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/i18n/locales index.html
git commit -m "feat(columns): i18n keys, icon gallery entry, playground wiring"
```

---

## Task 11: E2E — create, edit, save, teardown, responsive

**Files:**
- Create: `test/playwright/tests/tools/columns.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `test/playwright/tests/tools/columns.spec.ts`. Follow the existing helper pattern in `test/playwright/tests/modules/Saver.spec.ts` for `createBlok`/`saveBlok` imports (copy the exact import path used there). The build runs automatically.

```typescript
import { test, expect } from '@playwright/test';
import { createBlok, saveBlok } from '../helpers';  // match the real helper path used by sibling specs

test.describe('Columns tool', () => {
  test('@smoke inserts a 2-column layout and persists the nested tree', async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
          { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
          { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
          { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
          { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
        ],
      },
    });

    const list = page.getByTestId('column-list');
    await expect(list).toBeVisible();

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // Side by side: second column starts to the right of the first
    const boxA = await columns.nth(0).boundingBox();
    const boxB = await columns.nth(1).boundingBox();
    expect(boxB!.x).toBeGreaterThan(boxA!.x);

    const saved = await saveBlok(page);
    const types = saved.blocks.map(b => b.type);
    expect(types).toContain('column_list');
    expect(types.filter(t => t === 'column')).toHaveLength(2);
  });

  test('collapsing to one column auto-unwraps to root', async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
          { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
          { id: 'p1', type: 'paragraph', data: { text: 'Keep me' }, parent: 'c1' },
          { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
          { id: 'p2', type: 'paragraph', data: { text: 'Remove me' }, parent: 'c2' },
        ],
      },
    });

    await page.evaluate(async () => {
      // delete() is index-based: resolve the column's flat index first
      const index = window.blokInstance!.blocks.getBlockIndex('c2');
      await window.blokInstance!.blocks.delete(index);
    });

    const saved = await saveBlok(page);
    const types = saved.blocks.map(b => b.type);
    expect(types).not.toContain('column_list');
    expect(types).not.toContain('column');
    expect(saved.blocks.find(b => (b.data as { text?: string }).text === 'Keep me')?.parent).toBeUndefined();
  });

  test('stacks vertically on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await createBlok(page, {
      data: {
        blocks: [
          { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
          { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
          { id: 'p1', type: 'paragraph', data: { text: 'Top' }, parent: 'c1' },
          { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
          { id: 'p2', type: 'paragraph', data: { text: 'Bottom' }, parent: 'c2' },
        ],
      },
    });

    const columns = page.locator('[data-blok-column]');
    const boxA = await columns.nth(0).boundingBox();
    const boxB = await columns.nth(1).boundingBox();
    // Stacked: second column sits below the first
    expect(boxB!.y).toBeGreaterThan(boxA!.y + boxA!.height - 1);
  });
});
```

- [ ] **Step 2: Run E2E to verify it fails / then passes**

Run: `yarn e2e test/playwright/tests/tools/columns.spec.ts`
Expected initially: the responsive test FAILS until Task 12 adds the breakpoint CSS; the first two should pass once tools are registered. If the first two fail, fix registration before continuing.

- [ ] **Step 3: Commit**

```bash
git add test/playwright/tests/tools/columns.spec.ts
git commit -m "test(columns): e2e for create, persist, auto-unwrap, responsive"
```

---

## Task 12: Responsive vertical stacking

**Files:**
- Modify: `src/tools/column/index.ts` (and/or `src/tools/column-list/index.ts`)

- [ ] **Step 1: Add the breakpoint behavior**

The container already uses `flex-wrap`. Make each column take a full row below a breakpoint by giving columns a responsive min-width / basis. In `src/tools/column/index.ts`, update the wrapper className to force wrapping on narrow screens:

```typescript
    wrapper.className = twMerge(
      'flex', 'flex-col', 'min-w-0', 'basis-full', 'md:basis-0'
    );
```

`basis-full` makes each column claim a full row by default (stacked); `md:basis-0` restores side-by-side flex distribution at the `md` breakpoint and up. Confirm `md:` is available in the project's Tailwind config; if the project uses a custom breakpoint utility, use that instead.

- [ ] **Step 2: Run the responsive E2E**

Run: `yarn e2e test/playwright/tests/tools/columns.spec.ts -g "stacks vertically"`
Expected: PASS. Then run the full spec file: `yarn e2e test/playwright/tests/tools/columns.spec.ts` — all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tools/column/index.ts
git commit -m "feat(columns): stack columns vertically on narrow viewports"
```

---

## Task 13: Full verification & landing

- [ ] **Step 1: Run the whole gate**

```bash
yarn lint
yarn test
yarn i18n:check
yarn e2e test/playwright/tests/tools/columns.spec.ts
```
Expected: all green.

- [ ] **Step 2: Manual smoke in the playground**

Run `yarn serve`, open the editor, type `/columns`, confirm presets 2–5 appear, insert a 3-column layout, type in each, reload (save/restore), delete a column down to one → auto-unwrap.

- [ ] **Step 3: Commit any fixes, then push the branch**

```bash
git push -u origin feat/columns-tool
```

---

## Self-Review Notes (coverage against spec)

- Block model (column_list + column, parent/content) → Tasks 1,3,4 + E2E persistence assert (11).
- Slash presets 2–5 → Task 5; generic `/columns` entry defaults to 2 (Task 4).
- Auto-seed empty paragraph per column → Task 2.
- Block-nesting guard predicate → Task 6 (full enforcement deferred to SP3, noted).
- Auto-unwrap at 1 column → Tasks 7,8 + E2E (11).
- Responsive vertical stack → Task 12 + E2E (11).
- Registration/host-children/public types → Task 9.
- i18n + icon + playground → Task 10.
- Out of scope (resize, drag-beside, arrow-nav) → not in this plan, per spec.

**Open items to confirm during execution (don't block planning):**
- Reentrancy/timing of `removed()` → async `unwrap`: confirm `getChildren(parentId)` already excludes the block being removed at hook time (Task 8 + E2E 11). If it still counts the removed column, adjust the collapse threshold from `=== 1` accordingly.
- Exact `types/tools-entry.d.ts` declaration form — match `Divider`/`Image` (Task 9).
- Real `createBlok`/`saveBlok` helper import path for E2E (Task 11).
- Project Tailwind breakpoint prefix (`md:`) availability (Task 12).
