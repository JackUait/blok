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
