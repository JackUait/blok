import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, DatabaseRowData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';
import type { Doc } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const popovers = vi.hoisted(() => ({ items: [] as Array<Array<{ name?: string; trailingIcon?: string }>> }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: { items?: Array<{ name?: string; trailingIcon?: string }> } = {}) {
      popovers.items.push(params.items ?? []);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const status = (defaultOptionId?: string): PropertyDefinition => ({
  id: 'st', name: 'Status', type: 'status', position: 'a1',
  status: {
    groups: [
      { id: 'todo', kind: 'todo', name: 'To-do', color: 'gray', position: 'a0' },
      { id: 'inProgress', kind: 'inProgress', name: 'In progress', color: 'blue', position: 'a1' },
      { id: 'complete', kind: 'complete', name: 'Complete', color: 'green', position: 'a2' },
    ],
    ...(defaultOptionId === undefined ? {} : { defaultOptionId }),
  },
  // Campaign Management (research/31 §7a): the DEFAULT is the second To-do option and has no colour.
  config: { options: [
    { id: 'blocked', label: 'Blocked', color: 'red', position: 'a0', groupId: 'todo' },
    { id: 'ns', label: 'Not started', position: 'a1', groupId: 'todo' },
    { id: 'ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
  ] },
});

const data = (type: 'table' | 'board', defaultOptionId?: string): DatabaseData => ({
  schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }, status(defaultOptionId)],
  views: [{ id: 'v', name: 'View', type, position: 'a0', sorts: [], filters: [], visibleProperties: ['st'], ...(type === 'board' ? { groupBy: 'st' } : {}) }],
  activeViewId: 'v',
});

const seed = (): Doc => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'One', st: 'ns' }, position: 'a0' }),
]);

const newRowId = (doc: Doc, before: string[]): string | undefined => doc.childrenOf('db').find((id) => !before.includes(id));

describe('a status property\'s default option (research/30 §10f, research/31 §7a-b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a new row starts with the default option', () => {
    const doc = seed();
    const { tool } = buildDatabase(doc, 'db', data('table', 'ns'));
    const id = tool.newRow();

    expect(doc.row(id ?? '').properties.st).toBe('ns');
  });

  it('without a default a new row has no status, as before', () => {
    const doc = seed();
    const { tool } = buildDatabase(doc, 'db', data('table'));
    const id = tool.newRow();

    expect(doc.row(id ?? '').properties.st).toBeUndefined();
  });

  it('a column\'s add button keeps that column\'s option; the no-value column stays empty', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'One', st: 'ns' }, position: 'a0' }),
      rowSeed('r2', 'db', { properties: { title: 'Two' }, position: 'a1' }),
    ]);
    const { el } = buildDatabase(doc, 'db', data('board', 'ns'));
    const add = (optionId: string): string | undefined => {
      const before = doc.childrenOf('db');

      el.querySelector<HTMLElement>(`[data-blok-database-column][data-option-id="${optionId}"] [data-blok-database-add-card]`)?.click();

      return newRowId(doc, before);
    };
    const inProgress = add('ip');
    const none = add('__blok-no-value-group__');

    expect(doc.row(inProgress ?? '').properties.st).toBe('ip');
    expect(none).toBeDefined();
    expect(doc.row(none ?? '').properties.st ?? null).toBeNull();
  });

  it('a template\'s own status wins over the default', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Bug', st: 'blocked' }, position: 'a0', template: true }),
    ]);
    const { tool } = buildDatabase(doc, 'db', data('table', 'ns'));

    tool.setDefaultTemplate('tpl');
    const id = tool.newRow();

    expect((doc.blocks.get(id ?? '')?.data as DatabaseRowData).properties.st).toBe('blocked');
  });

  it('the column "⋯" menu of a colourless status option checks no colour, as its option menu does', () => {
    const { el } = buildDatabase(seed(), 'db', data('board', 'ns'));
    const checked = (optionId: string): string[] => {
      popovers.items.length = 0;
      el.querySelector<HTMLElement>(`[data-blok-database-column-menu][data-option-id="${optionId}"]`)?.click();

      return (popovers.items.at(-1) ?? []).filter((item) => item.name?.startsWith('color-') === true && item.trailingIcon !== undefined).map((item) => item.name ?? '');
    };

    expect(checked('ns')).toEqual([]);
    expect(checked('ip')).toEqual(['color-blue']);
  });

  it('a colourless status option draws as the gray pill in a cell and as a gray board column', () => {
    const doc = seed();
    const table = buildDatabase(doc, 'db', data('table', 'ns')).el;

    expect(table.querySelector('[data-blok-database-option-pill]')?.getAttribute('data-color')).toBe('gray');
    document.body.innerHTML = '';
    const board = buildDatabase(seed(), 'db', data('board', 'ns')).el;
    const column = board.querySelector<HTMLElement>('[data-blok-database-column][data-option-id="ns"]');

    expect(column?.getAttribute('data-color')).toBe('gray');
    expect(column?.querySelector('[data-blok-database-column-dot]')).not.toBeNull();
  });

  // findings-board B03: Notion's Status board has no "No Status" column while every row has a status.
  describe('the no-value group of a status grouping', () => {
    const noValue = '[data-blok-database-column][data-option-id="__blok-no-value-group__"]';

    it('is left out while every row has a status, in the board and in Edit groups', () => {
      const { el } = buildDatabase(seed(), 'db', data('board', 'ns'));

      popovers.items.length = 0;
      el.querySelector<HTMLElement>('[data-blok-database-column-menu][data-option-id="ns"]')?.click();
      const editGroups = (popovers.items.at(-1) ?? []).find((item) => item.name === 'edit-groups') as { children?: { items: Array<{ name?: string }> } } | undefined;

      expect(el.querySelector(noValue)).toBeNull();
      expect(editGroups?.children?.items.map((item) => item.name)).not.toContain('group-__blok-no-value-group__');
    });

    it('shows once a row has no status', () => {
      const doc = makeDoc([
        { id: 'db', name: 'database', parentId: null, data: {} },
        rowSeed('r1', 'db', { properties: { title: 'One', st: 'ns' }, position: 'a0' }),
        rowSeed('r2', 'db', { properties: { title: 'Two' }, position: 'a1' }),
      ]);
      const { el } = buildDatabase(doc, 'db', data('board', 'ns'));

      expect(el.querySelector(noValue)?.querySelectorAll('[data-blok-database-card]').length).toBe(1);
    });
  });
});
