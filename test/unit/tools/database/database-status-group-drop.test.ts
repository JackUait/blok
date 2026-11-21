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

// The playground's Status: one option in each status group, each at 'a0' of its own group.
const data = (extra: Partial<DatabaseViewConfig> = {}): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'st', name: 'Status', type: 'status', position: 'a1', config: { options: [
      { id: 'ns', label: 'Not started', position: 'a0', groupId: 'todo' },
      { id: 'ns2', label: 'Blocked', position: 'a1', groupId: 'todo' },
      { id: 'ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
      { id: 'dn', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
    ] } },
  ],
  views: [{ id: 'v', name: 'Board', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: ['st'], groupBy: 'st', ...extra }],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'One', st: 'ip' }, position: 'a0' }),
]);

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

  it('a drop into another status group changes nothing: no write, and the column stays in its group', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data());
    const before = boardColumns(el);
    const saved = JSON.stringify(tool.save(document.createElement('div')).schema);

    drop(tool, 'dn', 'ns', null);

    expect(JSON.stringify(tool.save(document.createElement('div')).schema)).toBe(saved);
    expect(boardColumns(el)).toEqual(before);
    expect(doc.transact).not.toHaveBeenCalled();
  });

  it('a drop inside its own group moves it, even when the next column is in another group', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data());

    expect(boardColumns(el).slice(0, 4)).toEqual(['ns', 'ns2', 'ip', 'dn']);
    drop(tool, 'ns', 'ip', 'ns2');

    expect(boardColumns(el).slice(0, 4)).toEqual(['ns2', 'ns', 'ip', 'dn']);
    const options = tool.save(document.createElement('div')).schema[1].config?.options ?? [];
    const todo = options.filter((o) => o.groupId === 'todo').sort((a, b) => (a.position < b.position ? -1 : 1));

    expect(todo.map((o) => o.id)).toEqual(['ns2', 'ns']);
  });

  it('a descending board keeps its drawn order: a drop there writes nothing that the reversed draw would undo', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data({ groupSettings: { sort: 'descending' } }));
    const before = boardColumns(el);
    const saved = JSON.stringify(tool.save(document.createElement('div')).schema);

    expect(before.slice(0, 4)).toEqual(['dn', 'ip', 'ns2', 'ns']);
    drop(tool, 'ns', 'ns2', 'ip');

    expect(JSON.stringify(tool.save(document.createElement('div')).schema)).toBe(saved);
    expect(boardColumns(el)).toEqual(before);
  });
});
