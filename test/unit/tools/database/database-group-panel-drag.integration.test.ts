import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseData, DatabaseViewConfig } from '../../../../src/tools/database/types';

/**
 * notion-motion.md Round 92 §1 #4: View settings › Group lists each group with a drag handle, and the groups reorder
 * there. The move writes what a board column drag writes, as one undo step.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save(): Promise<OutputData>;
  destroy(): void;
  history: API['history'];
}

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const NO_VALUE = '__blok-no-value-group__';

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const doc = (view: Partial<DatabaseViewConfig> = {}): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1'],
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'st', name: 'Stage', type: 'select', position: 'a1', config: { options: [
          { id: 'a', label: 'Alpha', color: 'blue', position: 'a0' },
          { id: 'b', label: 'Beta', color: 'green', position: 'a1' },
          { id: 'c', label: 'Gamma', color: 'red', position: 'a2' },
        ] } },
      ],
      views: [{
        id: 'v', name: 'Board', type: 'board', position: 'a0', filters: [], sorts: [], visibleProperties: [],
        groupBy: 'st', groupSettings: { sort: 'manual' }, ...view,
      }],
      activeViewId: 'v',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', st: 'b' }, position: 'a0' } },
];

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
    onReady: (api) => { ready = api; },
  });
  await editor.isReady;
  await quiet();
  if (ready === undefined) throw new Error('editor did not expose its ready API');

  return ready;
};

const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

const stopCapturing = (): void => {
  (editor as unknown as { module: { yjsManager: { stopCapturing: () => void } } }).module.yjsManager.stopCapturing();
};

const columns = (): string[] => [...(holder?.querySelectorAll('[data-blok-database-column][data-option-id]') ?? [])]
  .map((column) => column.getAttribute('data-option-id') ?? '');

const panelGroups = (): string[] => [...document.querySelectorAll('[data-blok-database-group-visibility-row]')]
  .map((row) => row.closest('[data-item-id]')?.getAttribute('data-item-id') ?? '');

const openGroupPage = async (): Promise<void> => {
  holder?.querySelector<HTMLElement>('[data-blok-testid="database-toolbar-settings"]')?.click();
  await quiet();
  byTestId('database-settings-group')?.click();
  await quiet();
};

const altArrow = (key: string, arrow: 'ArrowUp' | 'ArrowDown'): void => {
  byTestId(`database-group-list-handle-${key}`)?.dispatchEvent(new KeyboardEvent('keydown', { key: arrow, altKey: true, bubbles: true, cancelable: true }));
};

const viewOf = async (api: TestEditor): Promise<DatabaseViewConfig | undefined> =>
  ((await api.save()).blocks.find((b) => b.id === 'db')?.data as DatabaseData | undefined)?.views[0];

describe('View settings › Group: reorder groups by their handle (notion-motion.md Round 92 §1 #4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  it('moves a group down on the board and in the list, and one undo puts it back', async () => {
    const api = await make(doc());

    expect(columns()).toEqual(['a', 'b', 'c', NO_VALUE]);
    await openGroupPage();
    stopCapturing();

    altArrow('a', 'ArrowDown');
    await quiet();

    expect(columns()).toEqual(['b', 'a', 'c', NO_VALUE]);
    expect(panelGroups()).toEqual(['b', 'a', 'c', NO_VALUE]);

    stopCapturing();
    api.history.undo();
    await quiet();

    expect(columns()).toEqual(['a', 'b', 'c', NO_VALUE]);
  });

  it('moves a group in the view\'s own order when it has one, and one undo puts it back', async () => {
    const api = await make(doc({ groupOrder: { c: 'a0V' } }));

    expect(columns()).toEqual(['a', 'c', 'b', NO_VALUE]);
    await openGroupPage();
    stopCapturing();

    altArrow('b', 'ArrowUp');
    await quiet();

    expect(columns()).toEqual(['a', 'b', 'c', NO_VALUE]);
    expect(Object.keys((await viewOf(api))?.groupOrder ?? {}).sort()).toEqual(['b', 'c']);

    stopCapturing();
    api.history.undo();
    await quiet();

    expect(columns()).toEqual(['a', 'c', 'b', NO_VALUE]);
  });

  it('moves a group past the no-value group, which has no handle of its own', async () => {
    await make(doc());
    await openGroupPage();

    expect(byTestId(`database-group-list-handle-${NO_VALUE}`)?.hasAttribute('data-fixed')).toBe(true);
    altArrow('c', 'ArrowDown');
    await quiet();

    expect(columns()).toEqual(['a', 'b', NO_VALUE, 'c']);
  });

  it('has no handles while the groups are sorted', async () => {
    await make(doc({ groupSettings: { sort: 'ascending' } }));
    await openGroupPage();

    expect(panelGroups().length).toBe(4);
    expect(byTestId('database-group-list-handle-a')).toBeNull();
  });

  it('a Status group moved into another status group writes nothing and adds no undo step', async () => {
    const status = doc();
    const db = status[0].data as DatabaseData;

    db.schema[1] = { id: 'st', name: 'Status', type: 'status', position: 'a1', config: { options: [
      { id: 'ns', label: 'Not started', position: 'a0', groupId: 'todo' },
      { id: 'ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
      { id: 'dn', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
    ] } };
    db.views[0].groupSettings = undefined;
    status[1].data = { properties: { t: 'One', st: 'ip' }, position: 'a0' };
    const api = await make(status);
    const saved = JSON.stringify((await api.save()).blocks.find((b) => b.id === 'db')?.data);
    const shown = columns();

    await openGroupPage();
    stopCapturing();

    expect(api.history.canUndo()).toBe(false);
    altArrow('ns', 'ArrowDown');
    await quiet();

    expect(JSON.stringify((await api.save()).blocks.find((b) => b.id === 'db')?.data)).toBe(saved);
    expect(api.history.canUndo()).toBe(false);
    expect(columns()).toEqual(shown);
    expect(panelGroups().filter((key) => key !== NO_VALUE)).toEqual(['ns', 'ip', 'dn']);
  });
});
