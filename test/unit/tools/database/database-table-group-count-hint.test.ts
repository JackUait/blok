import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onHover } from '../../../../src/components/utils/tooltip';
import type * as Tooltip from '../../../../src/components/utils/tooltip';
import type { DatabaseData } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...(await importOriginal<typeof Tooltip>()),
  onHover: vi.fn(),
}));

const data = (groupCalculation?: DatabaseData['views'][number]['groupCalculation']): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'num', name: 'Points', type: 'number', position: 'a1' },
    { id: 'sel', name: 'Select', type: 'select', position: 'a2', config: { options: [
      { id: 'red', label: 'Red', color: 'yellow', position: 'a0' },
    ] } },
  ],
  views: [{
    id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['title', 'num', 'sel'],
    groupBy: 'sel', hideGroupAggregation: false, ...(groupCalculation === undefined ? {} : { groupCalculation }),
  }],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'Alpha', num: 4, sel: 'red' }, position: 'a0' }),
]);

const hintOf = (el: HTMLElement): unknown[] | undefined => {
  const count = el.querySelector('[data-group-key="red"] [data-blok-database-table-group-count]');

  return vi.mocked(onHover).mock.calls.find(([target]) => target === count)?.slice(1);
};

// notion-motion.md Round 12 "Table group count hint": hovering the count shows "Count all", above it.
describe('table group count hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('names Count all above the count', () => {
    const { el } = buildDatabase(seed(), 'db', data());

    expect(hintOf(el)).toEqual(['tools.database.calcCountAll', { placement: 'top', gap: 6 }]);
  });

  it('names a property calculation and its property', () => {
    const { el } = buildDatabase(seed(), 'db', data({ fn: 'sum', id: 'num' }));

    expect(String(hintOf(el)?.[0])).toMatch(/^tools.database.groupCalculationHint/);
  });
});
