import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseData, DatabaseViewConfig } from '../../../../src/tools/database/types';

/** H50: a deleted property waits in deletedProperties until a restore or a permanent delete. */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: { yjsManager: { stopCapturing: () => void } };
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const board: DatabaseViewConfig = {
  id: 'v',
  name: 'Board',
  type: 'board',
  position: 'a0',
  groupBy: 's',
  sorts: [{ propertyId: 'n', direction: 'desc' }],
  filters: [{ propertyId: 'n', operator: 'greater_than', value: 6 }],
  visibleProperties: ['n'],
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Stage', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Open', position: 'a0' }] } },
        { id: 'n', name: 'Amount', type: 'number', position: 'a2' },
      ],
      views: [board],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', s: 'o1', n: 5 }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two', n: 7 }, position: 'a1' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[] = doc()): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

/** Calls a database tool method the way a host does, as a gesture of its own. */
const call = (blok: TestEditor, id: string, method: string, param: unknown): void => {
  blok.blocks.getById(id)?.call(method, param as Record<string, unknown>);
  // Two calls inside the capture window would otherwise share one undo step.
  blok.module.yjsManager.stopCapturing();
};

const dataOf = (saved: OutputData, id: string): Record<string, unknown> =>
  saved.blocks.find((block) => block.id === id)?.data as Record<string, unknown>;

const databaseOf = (saved: OutputData, id = 'db'): DatabaseData => dataOf(saved, id) as unknown as DatabaseData;

const deletedIds = (saved: OutputData, id = 'db'): string[] | undefined => databaseOf(saved, id).deletedProperties?.map((p) => p.id);

const schemaIds = (saved: OutputData, id = 'db'): string[] => databaseOf(saved, id).schema.map((p) => p.id);

const rowValues = (saved: OutputData, id: string): Record<string, unknown> => dataOf(saved, id).properties as Record<string, unknown>;

describe('deleted database properties (H50)', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('delete keeps the row values; undo brings the property back, redo deletes it again', async () => {
    const blok = await make();

    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();
    let saved = await blok.save();

    expect(schemaIds(saved)).toEqual(['t', 's']);
    expect(deletedIds(saved)).toEqual(['n']);
    expect(rowValues(saved, 'r1').n).toBe(5);

    blok.history.undo();
    await quiet();
    saved = await blok.save();
    expect(schemaIds(saved)).toEqual(['t', 's', 'n']);
    expect(deletedIds(saved)).toBeUndefined();

    blok.history.redo();
    await quiet();
    saved = await blok.save();
    expect(schemaIds(saved)).toEqual(['t', 's']);
    expect(deletedIds(saved)).toEqual(['n']);
  });

  it('restore shows the values again; undo and redo cross it', async () => {
    const blok = await make();

    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();
    call(blok, 'db', 'restoreProperty', 'n');
    await quiet();
    let saved = await blok.save();

    expect(schemaIds(saved)).toEqual(['t', 's', 'n']);
    expect(deletedIds(saved)).toBeUndefined();
    expect(holder?.textContent).toContain('Amount');

    blok.history.undo();
    await quiet();
    saved = await blok.save();
    expect(schemaIds(saved)).toEqual(['t', 's']);
    expect(deletedIds(saved)).toEqual(['n']);

    blok.history.redo();
    await quiet();
    saved = await blok.save();
    expect(schemaIds(saved)).toEqual(['t', 's', 'n']);
    expect(deletedIds(saved)).toBeUndefined();
  });

  it('a permanent delete strips every row in one undo step', async () => {
    const blok = await make();

    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();
    call(blok, 'db', 'deletePropertyPermanently', 'n');
    await quiet();
    let saved = await blok.save();

    expect(deletedIds(saved)).toBeUndefined();
    expect(rowValues(saved, 'r1')).toEqual({ t: 'One', s: 'o1' });
    expect(rowValues(saved, 'r2')).toEqual({ t: 'Two' });

    blok.history.undo();
    await quiet();
    saved = await blok.save();
    expect(deletedIds(saved)).toEqual(['n']);
    expect(rowValues(saved, 'r1').n).toBe(5);
    expect(rowValues(saved, 'r2').n).toBe(7);

    blok.history.redo();
    await quiet();
    saved = await blok.save();
    expect(deletedIds(saved)).toBeUndefined();
    expect(rowValues(saved, 'r1')).toEqual({ t: 'One', s: 'o1' });
  });

  it('the deleted list survives a save and a load', async () => {
    const first = await make();

    call(first, 'db', 'deleteProperty', 'n');
    await quiet();
    const saved = await first.save();

    first.destroy();
    editor = undefined;
    const second = await make(saved.blocks);
    const again = await second.save();

    expect(databaseOf(again).deletedProperties).toEqual(databaseOf(saved).deletedProperties);
    call(second, 'db', 'restoreProperty', 'n');
    await quiet();
    expect(schemaIds(await second.save())).toEqual(['t', 's', 'n']);
  });

  it('views keep their references while the property is deleted, and use them again after a restore', async () => {
    const blok = await make();
    const before = holder?.textContent;

    call(blok, 'db', 'deleteProperty', 's');
    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();

    expect(databaseOf(await blok.save()).views).toEqual([board]);

    call(blok, 'db', 'restoreProperty', 's');
    call(blok, 'db', 'restoreProperty', 'n');
    await quiet();
    const restored = await blok.save();

    expect(databaseOf(restored).views).toEqual([board]);
    expect(schemaIds(restored)).toEqual(['t', 's', 'n']);
    expect(holder?.textContent).toBe(before);
  });

  it('a board shows the same while its group-by property is deleted as after a drop with no trace', async () => {
    const soft = await make();

    call(soft, 'db', 'deleteProperty', 's');
    await quiet();
    const deleted = holder?.textContent;

    soft.destroy();
    editor = undefined;
    holder?.replaceChildren();
    const hard = await make();

    // The hard drop is what a delete did before deleted properties existed.
    call(hard, 'db', 'deleteMirrorProperty', { propertyId: 's' });
    await quiet();

    expect(deleted).toBe(holder?.textContent);
  });

  it('a filter and a sort on a deleted property are ignored, so every row shows', async () => {
    const table = { ...board, type: 'table' as const, groupBy: undefined };
    const blocks = doc();

    (blocks[0].data as { views: DatabaseViewConfig[] }).views = [table];
    const blok = await make(blocks);

    expect(holder?.textContent).toContain('Two');
    expect(holder?.textContent).not.toContain('One');
    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();

    expect(holder?.textContent).toContain('One');
    expect(holder?.textContent).toContain('Two');
  });

  it('a host reaches restore and permanent delete through block.call with { propertyId }', async () => {
    const blok = await make();

    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();
    call(blok, 'db', 'restoreProperty', { propertyId: 'n' });
    await quiet();
    expect(schemaIds(await blok.save())).toEqual(['t', 's', 'n']);

    call(blok, 'db', 'deleteProperty', 'n');
    await quiet();
    call(blok, 'db', 'deletePropertyPermanently', { propertyId: 'n' });
    await quiet();
    const saved = await blok.save();

    expect(deletedIds(saved)).toBeUndefined();
    expect(rowValues(saved, 'r1')).toEqual({ t: 'One', s: 'o1' });
  });

  it('a read-only linked view changes nothing on its source', async () => {
    const linked: OutputBlockData = {
      id: 'link',
      type: 'database',
      data: {
        source: { databaseId: 'db' },
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'lv', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'lv',
      },
    };
    const blok = await make([...doc(), linked]);

    call(blok, 'db', 'deleteProperty', 's');
    await quiet();
    blok.blocks.getById('link')?.call('setReadOnly', true as never);
    call(blok, 'link', 'deleteProperty', 'n');
    call(blok, 'link', 'restoreProperty', 's');
    call(blok, 'link', 'deletePropertyPermanently', 's');
    await quiet();
    const saved = await blok.save();

    expect(schemaIds(saved)).toEqual(['t', 'n']);
    expect(deletedIds(saved)).toEqual(['s']);
    expect(rowValues(saved, 'r1').s).toBe('o1');
  });

  it('a linked view deletes, restores and purges on its source, and never saves a deleted list itself', async () => {
    const linked: OutputBlockData = {
      id: 'link',
      type: 'database',
      data: {
        source: { databaseId: 'db' },
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'lv', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'lv',
      },
    };
    const blok = await make([...doc(), linked]);

    call(blok, 'link', 'deleteProperty', 'n');
    await quiet();
    let saved = await blok.save();

    expect(deletedIds(saved)).toEqual(['n']);
    expect(schemaIds(saved)).toEqual(['t', 's']);
    expect(databaseOf(saved, 'link')).not.toHaveProperty('deletedProperties');

    call(blok, 'link', 'restoreProperty', 'n');
    await quiet();
    saved = await blok.save();
    expect(schemaIds(saved)).toEqual(['t', 's', 'n']);
    expect(deletedIds(saved)).toBeUndefined();

    call(blok, 'link', 'deleteProperty', 'n');
    await quiet();
    call(blok, 'link', 'deletePropertyPermanently', 'n');
    await quiet();
    saved = await blok.save();
    expect(deletedIds(saved)).toBeUndefined();
    expect(rowValues(saved, 'r1')).toEqual({ t: 'One', s: 'o1' });
    expect(databaseOf(saved, 'link')).not.toHaveProperty('deletedProperties');
  });
});
