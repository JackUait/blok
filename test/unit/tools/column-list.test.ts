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
    const el = list.render();
    list.rendered();

    expect(insert).toHaveBeenCalledTimes(2);
    // Observable: both seeded column holders are mounted, plus one resize
    // separator sitting in the gutter between them (2 columns -> 1 separator).
    const mountedColumns = Array.from(el.children).filter(
      child => !child.hasAttribute('data-blok-column-resizer')
    );
    expect(mountedColumns).toHaveLength(2);
    expect(el.querySelectorAll('[data-blok-column-resizer]')).toHaveLength(1);
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

  it('seeds only the first column with focus, the rest with noFocus', () => {
    let counter = 0;
    const insert = vi.fn().mockImplementation(() => {
      counter += 1;

      return { id: `col-${counter}`, holder: document.createElement('div') };
    });
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insert,
        setBlockParent: vi.fn(),
      },
      caret: { setToBlock: vi.fn() },
    } as unknown as Partial<API>);

    const list = new ColumnList(createColumnListOptions({ columnCount: 3 }, api));
    list.render();
    list.rendered();

    // Columns render asynchronously and each self-focuses its seeded paragraph,
    // so the LAST one would win the focus race. seedColumns defends against that
    // by tagging every column but the first with noFocus, so only the FIRST
    // column claims the caret when it renders.
    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert.mock.calls[0][1]).toEqual({ noFocus: false });
    expect(insert.mock.calls[1][1]).toEqual({ noFocus: true });
    expect(insert.mock.calls[2][1]).toEqual({ noFocus: true });
  });

  it('inserts a resize separator between each pair of mounted columns', () => {
    const h1 = document.createElement('div');
    const h2 = document.createElement('div');
    const h3 = document.createElement('div');
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([
          { id: 'c1', holder: h1 },
          { id: 'c2', holder: h2 },
          { id: 'c3', holder: h3 },
        ]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insert: vi.fn(),
        setBlockParent: vi.fn(),
      },
    } as unknown as Partial<API>);

    const list = new ColumnList(createColumnListOptions({}, api));
    const container = list.render();
    list.rendered();

    const resizers = container.querySelectorAll('[data-blok-column-resizer]');

    // 3 columns -> 2 separators, each sitting between two column holders
    expect(resizers).toHaveLength(2);
    expect(resizers[0].previousElementSibling).toBe(h1);
    expect(resizers[0].nextElementSibling).toBe(h2);
    expect(resizers[1].previousElementSibling).toBe(h2);
    expect(resizers[1].nextElementSibling).toBe(h3);
  });

  it('does not insert resize separators in read-only mode', () => {
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([
          { id: 'c1', holder: document.createElement('div') },
          { id: 'c2', holder: document.createElement('div') },
        ]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insert: vi.fn(),
        setBlockParent: vi.fn(),
      },
    } as unknown as Partial<API>);

    const options = createColumnListOptions({}, api);
    options.readOnly = true;
    const list = new ColumnList(options);
    const container = list.render();
    list.rendered();

    expect(container.querySelectorAll('[data-blok-column-resizer]')).toHaveLength(0);
  });

  it('marks the separator as a vertical separator for assistive tech', () => {
    const api = createMockAPI({
      blocks: {
        getChildren: vi.fn().mockReturnValue([
          { id: 'c1', holder: document.createElement('div') },
          { id: 'c2', holder: document.createElement('div') },
        ]),
        getBlockIndex: vi.fn().mockReturnValue(0),
        insert: vi.fn(),
        setBlockParent: vi.fn(),
      },
    } as unknown as Partial<API>);

    const list = new ColumnList(createColumnListOptions({}, api));
    const container = list.render();
    list.rendered();

    const resizer = container.querySelector('[data-blok-column-resizer]');
    expect(resizer).toHaveAttribute('role', 'separator');
    expect(resizer).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('exposes only the 2–5 column presets — no generic Columns entry', () => {
    const toolbox = ColumnList.toolbox;
    const entries = Array.isArray(toolbox) ? toolbox : [toolbox];

    // Four count presets only (2,3,4,5); the generic "Columns" entry is removed.
    expect(entries).toHaveLength(4);

    // No bare "column_list" entry remains.
    expect(entries.find(e => e.name === 'column_list')).toBeUndefined();

    // Every preset is column_list-2 … column_list-5 with matching columnCount.
    const counts = entries
      .map(e => (e.data as { columnCount?: number } | undefined)?.columnCount)
      .sort((a, b) => (a ?? 0) - (b ?? 0));

    expect(counts).toEqual([2, 3, 4, 5]);
  });

  it('renders an icon that depicts the column count for each preset', () => {
    const toolbox = ColumnList.toolbox;
    const entries = Array.isArray(toolbox) ? toolbox : [toolbox];

    // Each icon is a single rounded frame split by `count - 1` internal
    // dividers, so it reads as a columns container holding exactly `count`
    // columns — and icons differ per count.
    entries.forEach(e => {
      const count = (e.data as { columnCount?: number }).columnCount as number;
      const svg = e.icon ?? '';
      const frameCount = (svg.match(/<rect/g) ?? []).length;
      const dividerCount = (svg.match(/<line/g) ?? []).length;
      expect(frameCount).toBe(1);
      expect(dividerCount).toBe(count - 1);
    });

    const icons = entries.map(e => e.icon);

    expect(new Set(icons).size).toBe(entries.length);
  });

  describe('setReadOnly (in-place read-only toggle)', () => {
    const createMountedList = (): { list: ColumnList; container: HTMLElement } => {
      const api = createMockAPI({
        blocks: {
          getChildren: vi.fn().mockReturnValue([
            { id: 'c1', holder: document.createElement('div') },
            { id: 'c2', holder: document.createElement('div') },
          ]),
          getBlockIndex: vi.fn().mockReturnValue(0),
          insert: vi.fn(),
          setBlockParent: vi.fn(),
        },
      } as unknown as Partial<API>);
      const list = new ColumnList(createColumnListOptions({}, api));
      const container = list.render();

      list.rendered();

      return { list, container };
    };

    it('removes resize separators when entering read-only', () => {
      const { list, container } = createMountedList();

      expect(container.querySelectorAll('[data-blok-column-resizer]')).toHaveLength(1);

      list.setReadOnly(true);

      expect(container.querySelectorAll('[data-blok-column-resizer]')).toHaveLength(0);
    });

    it('rebuilds resize separators when exiting read-only', () => {
      const { list, container } = createMountedList();

      list.setReadOnly(true);
      list.setReadOnly(false);

      expect(container.querySelectorAll('[data-blok-column-resizer]')).toHaveLength(1);
    });
  });
});
