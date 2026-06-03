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
