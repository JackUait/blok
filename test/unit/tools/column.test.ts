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
  block: { id: 'col-1', holder: document.createElement('div') } as never,
});

describe('Column tool', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders a flex-item container with the column attribute', () => {
    const column = new Column(createColumnOptions());
    const el = column.render();
    expect(el).toHaveAttribute('data-blok-column');
  });

  it('grows the holder evenly by default so columns split space equally', () => {
    // The flex item is the block holder, not the rendered wrapper. flex-grow
    // must land on the holder or columns collapse to their content width. The
    // holder only exists post-compose, so grow is applied in rendered().
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([{ id: 'p', holder: document.createElement('div') }]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insertInsideParent: vi.fn(),
      },
    } as unknown as Partial<API>);
    const options = createColumnOptions({}, api);
    const column = new Column(options);
    column.render();
    column.rendered();
    expect(options.block.holder.style.flexGrow).toBe('1');
  });

  it('grows the holder by widthRatio when set', () => {
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([{ id: 'p', holder: document.createElement('div') }]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insertInsideParent: vi.fn(),
      },
    } as unknown as Partial<API>);
    const options = createColumnOptions({ widthRatio: 2 }, api);
    const column = new Column(options);
    column.render();
    column.rendered();
    expect(options.block.holder.style.flexGrow).toBe('2');
  });

  it('saves widthRatio when set, empty object otherwise', () => {
    const withRatio = new Column(createColumnOptions({ widthRatio: 0.4 }));
    withRatio.render();
    expect(withRatio.save()).toEqual({ widthRatio: 0.4 });

    const without = new Column(createColumnOptions());
    without.render();
    expect(without.save()).toEqual({});
  });

  it('saves the live resized flex-grow from the holder', () => {
    // The resizer mutates the holder's flex-grow directly; save() must read it
    // back so a drag persists into the output without an api.blocks.update.
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([{ id: 'p', holder: document.createElement('div') }]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insertInsideParent: vi.fn(),
      },
    } as unknown as Partial<API>);
    const options = createColumnOptions({}, api);
    const column = new Column(options);
    column.render();
    column.rendered();

    // simulate a resize handle setting the grow
    options.block.holder.style.flexGrow = '1.6';

    expect(column.save()).toEqual({ widthRatio: 1.6 });
  });

  it('saves an empty object when the holder grow is the default even split', () => {
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([{ id: 'p', holder: document.createElement('div') }]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insertInsideParent: vi.fn(),
      },
    } as unknown as Partial<API>);
    const options = createColumnOptions({}, api);
    const column = new Column(options);
    column.render();
    column.rendered(); // sets holder flex-grow to the default '1'

    expect(column.save()).toEqual({});
  });

  it('supports read-only mode', () => {
    expect(Column.isReadOnlySupported).toBe(true);
  });

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

  it('seeds the paragraph but does NOT claim the caret when data.noFocus is true', () => {
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

    const column = new Column(createColumnOptions({ noFocus: true }, api));
    column.render();
    column.rendered();

    // The paragraph is still seeded so the column is never empty...
    expect(insertInsideParent).toHaveBeenCalledWith('col-1', 4);
    // ...but the caret is NOT moved here: a non-first seeded column must not win
    // the focus race over the first column.
    expect(setToBlock).not.toHaveBeenCalled();
  });

  it('does NOT seed a paragraph when data.noSeed is true', () => {
    const insertInsideParent = vi.fn();
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([]),
        getBlockIndex: vi.fn().mockReturnValue(3),
        insertInsideParent,
      },
      caret: { setToBlock: vi.fn() },
    } as unknown as Partial<API>);

    const column = new Column(createColumnOptions({ noSeed: true }, api));
    column.render();
    column.rendered();

    expect(insertInsideParent).not.toHaveBeenCalled();
  });

  it('treats noSeed as a one-shot creation hint: re-seeds when emptied after the first render', () => {
    // noSeed suppresses the seed ONLY for the initial mount (the wrap fills the
    // column explicitly right after). It must NOT persist: once the column has
    // rendered once, a later emptying (e.g. dragging its sole block out, which
    // re-fires rendered()) has to re-seed an empty paragraph so the column never
    // becomes a dead, zero-height, uninteractable box.
    const insertInsideParent = vi.fn().mockReturnValue({ id: 'p-1', holder: document.createElement('div') });
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([]),
        getBlockIndex: vi.fn().mockReturnValue(3),
        insertInsideParent,
      },
      caret: { setToBlock: vi.fn() },
    } as unknown as Partial<API>);

    const column = new Column(createColumnOptions({ noSeed: true }, api));
    column.render();

    // First render: noSeed suppresses the seed (the wrap is about to fill it).
    column.rendered();
    expect(insertInsideParent).not.toHaveBeenCalled();

    // Second render after being emptied: noSeed is spent, so the column re-seeds.
    column.rendered();
    expect(insertInsideParent).toHaveBeenCalledWith('col-1', 4);
  });

  it('never emits noSeed from save()', () => {
    const column = new Column(createColumnOptions({ noSeed: true }));
    column.render();

    expect(column.save()).not.toHaveProperty('noSeed');
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
        // Top-level list: its own parent is root, so survivors promote to null.
        getById: vi.fn().mockReturnValue({ parentId: null }),
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

    // removed() defers the unwrap to a microtask, which then awaits two chained
    // id-based deletes (the surviving column, then the column_list). A single
    // macrotask tick flushes the whole microtask chain so both deletes resolve,
    // regardless of how many ticks the defer + awaits add.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remove).toHaveBeenCalledWith(1); // column_list index
  });
});
