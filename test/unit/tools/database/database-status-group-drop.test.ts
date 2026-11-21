import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, DatabaseViewConfig } from '../../../../src/tools/database/types';
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

// notion-motion.md Round 94 §1 #1: a Status column dropped anywhere reorders the view's columns only.
// The playground's Status: one option in each status group, each at 'a0' of its own group.
const data = (extra: Partial<DatabaseViewConfig> = {}, second: Partial<DatabaseViewConfig> = {}): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'st', name: 'Status', type: 'status', position: 'a1', config: { options: [
      { id: 'ns', label: 'Not started', position: 'a0', groupId: 'todo' },
      { id: 'ns2', label: 'Blocked', position: 'a1', groupId: 'todo' },
      { id: 'ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
      { id: 'dn', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
    ] } },
  ],
  views: [
    { id: 'v', name: 'Board', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: ['st'], groupBy: 'st', ...extra },
    { id: 'v2', name: 'Board 2', type: 'board', position: 'a1', sorts: [], filters: [], visibleProperties: ['st'], groupBy: 'st', ...second },
  ],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'One', st: 'ip' }, position: 'a0' }),
]);

const NO_VALUE = '__blok-no-value-group__';

const boardColumns = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-column][data-option-id]')].map((c) => c.getAttribute('data-option-id') ?? '');

type Drop = (r: { optionId: string; beforeOptionId: string | null; afterOptionId: string | null }) => void;

const drop = (tool: unknown, optionId: string, beforeOptionId: string | null, afterOptionId: string | null): void => {
  (tool as { handleGroupDrop: Drop }).handleGroupDrop({ optionId, beforeOptionId, afterOptionId });
};

describe('a Status board column dropped among its status groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const save = (tool: { save: (el: HTMLElement) => DatabaseData }): DatabaseData => tool.save(document.createElement('div'));

  it('a drop into another status group reorders the columns and leaves the options alone', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data());
    const schema = JSON.stringify(save(tool).schema);

    drop(tool, 'dn', 'ns', null);

    expect(boardColumns(el).slice(0, 4)).toEqual(['dn', 'ns', 'ns2', 'ip']);
    expect(JSON.stringify(save(tool).schema)).toBe(schema);
  });

  it('the new order survives a reload, and the other board keeps the workflow order', () => {
    const { tool } = buildDatabase(seed(), 'db', data());

    drop(tool, 'dn', 'ns', null);
    const saved = save(tool);

    document.body.innerHTML = '';
    const reloaded = buildDatabase(seed(), 'db', saved);

    expect(boardColumns(reloaded.el).slice(0, 4)).toEqual(['dn', 'ns', 'ns2', 'ip']);
    document.body.innerHTML = '';
    const other = buildDatabase(seed(), 'db', { ...saved, activeViewId: 'v2' });

    expect(boardColumns(other.el).slice(0, 4)).toEqual(['ns', 'ns2', 'ip', 'dn']);
  });

  it('a drop inside its own group also moves only this view\'s column', () => {
    const { tool, el } = buildDatabase(seed(), 'db', data());
    const schema = JSON.stringify(save(tool).schema);

    drop(tool, 'ns', 'ip', 'ns2');

    expect(boardColumns(el).slice(0, 4)).toEqual(['ns2', 'ns', 'ip', 'dn']);
    expect(JSON.stringify(save(tool).schema)).toBe(schema);
  });

  it('an option the view has no place for follows the option before it in the workflow', () => {
    const { el } = buildDatabase(seed(), 'db', data({ groupOrder: { dn: 'a0', ns: 'a1', ip: 'a2' } }));

    expect(boardColumns(el).slice(0, 4)).toEqual(['dn', 'ns', 'ns2', 'ip']);
  });

  it('the no-value group keeps its place when the view first saves an order', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'One', st: null }, position: 'a0' }),
    ]);
    const { tool, el } = buildDatabase(doc, 'db', data({ noValueGroupPosition: 'a1V' }));

    expect(boardColumns(el)).toEqual(['ns', 'ns2', 'ip', 'dn', NO_VALUE]);
    drop(tool, 'dn', 'ns', null);
    document.body.innerHTML = '';

    expect(boardColumns(buildDatabase(doc, 'db', save(tool)).el)).toEqual(['dn', 'ns', 'ns2', 'ip', NO_VALUE]);
  });

  it('a descending board keeps its drawn order: a drop there writes nothing that the reversed draw would undo', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data({ groupSettings: { sort: 'descending' } }));
    const before = boardColumns(el);
    const saved = JSON.stringify(save(tool));

    expect(before.slice(0, 4)).toEqual(['dn', 'ip', 'ns2', 'ns']);
    drop(tool, 'ns', 'ns2', 'ip');

    expect(JSON.stringify(save(tool))).toBe(saved);
    expect(boardColumns(el)).toEqual(before);
  });
});
