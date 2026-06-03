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
});
