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
    // Observable: both seeded column holders are mounted into the container
    expect(el.children).toHaveLength(2);
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

  it('places the caret in the first column after seeding', () => {
    let counter = 0;
    const insert = vi.fn().mockImplementation(() => {
      counter += 1;

      return { id: `col-${counter}`, holder: document.createElement('div') };
    });
    const setToBlock = vi.fn();
    const getChildren = vi.fn().mockImplementation((id: string) => {
      if (id === 'col-1') {
        // first column's seeded paragraph (created by its own rendered() hook)
        return [{ id: 'p-first', holder: document.createElement('div') }];
      }

      return []; // column_list starts empty; other columns irrelevant here
    });
    const api = createMockAPI({
      blocks: {
        getChildren,
        getBlockIndex: vi.fn().mockReturnValue(0),
        insert,
        setBlockParent: vi.fn(),
      },
      caret: { setToBlock },
    } as unknown as Partial<API>);

    const list = new ColumnList(createColumnListOptions({ columnCount: 3 }, api));
    list.render();
    list.rendered();

    // Caret goes to the FIRST column's first paragraph, not the last column's
    expect(setToBlock).toHaveBeenCalledWith('p-first', 'start');
  });

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
});
