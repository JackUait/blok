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
  api: API = createMockAPI(),
  readOnly = false
): BlockToolConstructorOptions<ColumnData> => ({
  data: { ...data },
  config: {},
  api,
  readOnly,
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

  it('deletes itself when emptied after being populated (a block dragged out leaves it childless)', async () => {
    // A column is pure layout. Once it has held content and then loses its last
    // block — e.g. the user drags its sole block out, which re-fires rendered()
    // with no children — it must NOT linger as an empty box. It removes itself so
    // the layout collapses cleanly instead of leaving a dead, uninteractable column.
    const insertInsideParent = vi.fn();
    const deleteBlock = vi.fn().mockResolvedValue(undefined);
    const getChildren = vi.fn()
      .mockReturnValueOnce([{ id: 'child', holder: document.createElement('div') }]) // first render: populated
      .mockReturnValue([]); // every later read: emptied
    const api = createMockAPI({
      blocks: {
        getChildren,
        getBlockIndex: vi.fn().mockReturnValue(7),
        insertInsideParent,
        delete: deleteBlock,
      },
      caret: { setToBlock: vi.fn() },
    } as unknown as Partial<API>);

    const column = new Column(createColumnOptions({}, api));
    column.render();

    // First render mounts the existing child — the column is now populated.
    column.rendered();

    // Second render finds it emptied: it schedules its own deletion (deferred to a
    // microtask so it never splices the flat array mid-render).
    column.rendered();
    await new Promise(resolve => setTimeout(resolve, 0));

    // It deletes by its CURRENT flat index, and never re-seeds a paragraph.
    expect(deleteBlock).toHaveBeenCalledWith(7);
    expect(insertInsideParent).not.toHaveBeenCalled();
  });

  it('does NOT delete itself on its first render when never populated — it seeds instead', async () => {
    // Preset columns are created empty and rely on the first render to seed a
    // paragraph. An empty FIRST render is a fresh column, not an emptied one, so
    // it must seed, not self-destruct.
    const insertInsideParent = vi.fn().mockReturnValue({ id: 'p-1', holder: document.createElement('div') });
    const deleteBlock = vi.fn().mockResolvedValue(undefined);
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([]),
        getBlockIndex: vi.fn().mockReturnValue(3),
        insertInsideParent,
        delete: deleteBlock,
      },
      caret: { setToBlock: vi.fn() },
    } as unknown as Partial<API>);

    const column = new Column(createColumnOptions({}, api));
    column.render();
    column.rendered();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(insertInsideParent).toHaveBeenCalledWith('col-1', 4);
    expect(deleteBlock).not.toHaveBeenCalled();
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

  describe('click on the empty space below the column content', () => {
    /**
     * Columns stretch to the height of the tallest one, so a short column has
     * dead space under its last block. Clicking it must behave like the editor's
     * bottom zone: append an empty text block and focus it.
     */
    const createTreeAPI = (
      tree: { [parentId: string]: { id: string; name?: string; isEmpty?: boolean }[] },
      indexes: { [blockId: string]: number },
      inserted: { id: string; holder: HTMLElement } = { id: 'new-p', holder: document.createElement('div') }
    ): { api: API; insertInsideParent: ReturnType<typeof vi.fn>; setToBlock: ReturnType<typeof vi.fn> } => {
      const insertInsideParent = vi.fn().mockReturnValue(inserted);
      const setToBlock = vi.fn();
      const holders: { [blockId: string]: HTMLElement } = {};
      const api = createMockAPI({
        blocks: {
          getChildren: vi.fn((parentId: string) => (tree[parentId] ?? []).map(child => ({
            ...child,
            holder: holders[child.id] ?? (holders[child.id] = document.createElement('div')),
          }))),
          getBlockIndex: vi.fn((blockId: string) => indexes[blockId]),
          insertInsideParent,
        },
        caret: { setToBlock },
      } as unknown as Partial<API>);

      return { api,
        insertInsideParent,
        setToBlock };
    };

    const mountColumn = (
      api: API,
      readOnly = false
    ): { column: Column; options: BlockToolConstructorOptions<ColumnData> } => {
      const options = createColumnOptions({}, api, readOnly);
      const column = new Column(options);

      options.block.holder.appendChild(column.render());
      column.rendered();

      return { column,
        options };
    };

    it('appends a paragraph at the end of the column and focuses it', () => {
      const { api, insertInsideParent, setToBlock } = createTreeAPI(
        { 'col-1': [{ id: 'p-1',
          name: 'paragraph',
          isEmpty: false }] },
        { 'col-1': 3,
          'p-1': 4 }
      );
      const { options } = mountColumn(api);

      options.block.holder.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Inserted right after the column's last descendant, at the end of the column.
      expect(insertInsideParent).toHaveBeenCalledWith('col-1', 5);
      expect(setToBlock).toHaveBeenCalledWith('new-p', 'start');
    });

    it('inserts after the last descendant when the trailing child is itself a container', () => {
      // A toggle at the bottom of the column owns the flat slots after it; the
      // new paragraph must land after the toggle's whole subtree, not inside it.
      const { api, insertInsideParent } = createTreeAPI(
        {
          'col-1': [{ id: 'toggle-1',
            name: 'toggle',
            isEmpty: false }],
          'toggle-1': [{ id: 'nested-1',
            name: 'paragraph',
            isEmpty: false }],
        },
        { 'col-1': 3,
          'toggle-1': 4,
          'nested-1': 5 }
      );
      const { options } = mountColumn(api);

      options.block.holder.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(insertInsideParent).toHaveBeenCalledWith('col-1', 6);
    });

    it('focuses the trailing empty paragraph instead of stacking another one', () => {
      const { api, insertInsideParent, setToBlock } = createTreeAPI(
        { 'col-1': [{ id: 'p-1',
          name: 'paragraph',
          isEmpty: true }] },
        { 'col-1': 3,
          'p-1': 4 }
      );
      const { options } = mountColumn(api);

      options.block.holder.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(insertInsideParent).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith('p-1', 'end');
    });

    it('ignores clicks that land on a child block', () => {
      const { api, insertInsideParent } = createTreeAPI(
        { 'col-1': [{ id: 'p-1',
          name: 'paragraph',
          isEmpty: false }] },
        { 'col-1': 3,
          'p-1': 4 }
      );
      const { options } = mountColumn(api);
      const childBlock = options.block.holder.querySelector('[data-blok-nested-blocks]');

      childBlock?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(insertInsideParent).not.toHaveBeenCalled();
    });

    it('ignores clicks in read-only mode', () => {
      const { api, insertInsideParent } = createTreeAPI(
        { 'col-1': [{ id: 'p-1',
          name: 'paragraph',
          isEmpty: false }] },
        { 'col-1': 3,
          'p-1': 4 }
      );
      const { options } = mountColumn(api, true);

      options.block.holder.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(insertInsideParent).not.toHaveBeenCalled();
    });

    it('ignores the click that ends a text drag-selection', () => {
      // Releasing a selection drag in the dead space fires a click on the holder;
      // creating a block there would blow away the selection the user just made.
      const { api, insertInsideParent } = createTreeAPI(
        { 'col-1': [{ id: 'p-1',
          name: 'paragraph',
          isEmpty: false }] },
        { 'col-1': 3,
          'p-1': 4 }
      );
      const { options } = mountColumn(api);

      vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);

      options.block.holder.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(insertInsideParent).not.toHaveBeenCalled();
    });
  });

  describe('setReadOnly (in-place read-only toggle)', () => {
    it('has setReadOnly method that does not throw', () => {
      const column = new Column(createColumnOptions());

      column.render();

      expect(() => column.setReadOnly(true)).not.toThrow();
      expect(() => column.setReadOnly(false)).not.toThrow();
    });
  });
});
