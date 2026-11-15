import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseData, DatabaseRowData } from '../../../../src/tools/database/types';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import { rowReactions } from '../../../../src/tools/database/row-reactions';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const data: DatabaseData = {
  title: 'Posts',
  schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
  views: [{ id: 'v', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'v',
};

const doc = (): OutputBlockData[] => [
  { id: 'db', type: 'database', data, content: ['r1'] },
  { id: 'r1', type: 'database-row', parent: 'db', data: { title: 'Alpha', properties: { t: 'Alpha' }, position: 'a0', 'reactions:ada': { '👍': 1 } } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: { people: { list: () => Promise.resolve([]), me: () => 'me' } } },
      'database-row': DatabaseRowTool,
    },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const row = async (): Promise<DatabaseRowData> =>
  (await editor?.save())?.blocks.find((block) => block.id === 'r1')?.data as DatabaseRowData;

const pill = (emoji: string): HTMLElement | undefined =>
  Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-database-feed-reaction]') ?? []).find((el) => el.getAttribute('data-emoji') === emoji);

describe('feed reactions and undo', () => {
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
    vi.restoreAllMocks();
  });

  it('undo takes back the edit before a reaction and leaves the reaction', async () => {
    await make();
    const before = await row();

    await editor?.blocks.update('r1', { ...before, title: 'Beta', properties: { t: 'Beta' } });
    await quiet();
    pill('👍')?.click();
    await quiet();
    expect(rowReactions(await row())?.me?.['👍']).toEqual(expect.any(Number));

    editor?.history.undo();
    await quiet();

    const undone = await row();

    expect(rowReactions(undone)?.me?.['👍']).toEqual(expect.any(Number));
    expect(undone.properties.t).toBe('Alpha');

    editor?.history.redo();
    await quiet();

    const redone = await row();

    expect(redone.properties.t).toBe('Beta');
    expect(rowReactions(redone)?.me?.['👍']).toEqual(expect.any(Number));
  });

  it('taking back your only reaction leaves no key of yours in the saved row', async () => {
    await make();

    pill('👍')?.click();
    await quiet();
    expect('reactions:me' in (await row())).toBe(true);
    pill('👍')?.click();
    await quiet();

    const saved = await row();

    expect('reactions:me' in saved).toBe(false);
    expect(rowReactions(saved)).toEqual({ ada: { '👍': 1 } });
  });

  it('a reaction is not an undo step of its own, nor an edit of the page', async () => {
    await make();

    pill('👍')?.click();
    await quiet();
    expect((await editor?.save())?.blocks.find((block) => block.id === 'r1')?.lastEditedAt).toBeUndefined();
    editor?.history.undo();
    await quiet();

    expect(rowReactions(await row())).toEqual({ ada: { '👍': 1 }, me: { '👍': expect.any(Number) } });
    expect(pill('👍')?.textContent).toBe('👍2');
  });
});

// notion-motion.md Round 34 §1: a pure reorder stamps no edit (no "(edited)", Last edited time stays); a property edit does.
describe('a move is not an edit', () => {
  const EDITED_AT = Date.UTC(2026, 0, 2, 3, 4);

  const tableData: DatabaseData = {
    title: 'Posts',
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'n', name: 'Notes', type: 'text', position: 'a1' },
      { id: 'le', name: 'Edited', type: 'lastEditedTime', position: 'a2' },
    ],
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'v',
  };

  const rows = (): OutputBlockData[] => [
    { id: 'db', type: 'database', data: tableData, content: ['r1', 'r2', 'r3'] },
    ...['Alpha', 'Beta', 'Gamma'].map((title, i): OutputBlockData => ({
      id: `r${i + 1}`, type: 'database-row', parent: 'db', createdAt: EDITED_AT - 1000, lastEditedAt: EDITED_AT,
      data: { title, properties: { t: title }, position: `a${i}` },
    })),
  ];

  const makeTable = async (): Promise<TestEditor> => {
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
      data: { blocks: rows() },
    } as never) as unknown as TestEditor;
    await editor.isReady;
    await quiet();

    return editor;
  };

  const shownOrder = (): string[] =>
    Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-database-table-row][data-row-id]') ?? []).map((el) => el.getAttribute('data-row-id') ?? '');

  const editedCell = (rowId: string): string =>
    holder?.querySelector(`[data-blok-database-table-row][data-row-id="${rowId}"] [data-property-id="le"]`)?.textContent ?? '';

  /** The cell in a new editor opened on the saved document: the open view does not redraw it when a stamp lands. */
  const reloadedEditedCell = async (rowId: string): Promise<string> => {
    const saved = await editor?.save();

    editor?.destroy();
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
      data: saved,
    } as never) as unknown as TestEditor;
    await editor.isReady;
    await quiet();

    return editedCell(rowId);
  };

  const savedRow = async (id: string): Promise<OutputBlockData | undefined> =>
    (await editor?.save())?.blocks.find((block) => block.id === id);

  /** Drags the last row above the first by its handle, as a person would. */
  const dragLastToTop = (): void => {
    const rowEls = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-database-table-row][data-row-id]') ?? []);

    rowEls.forEach((el, i) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
      { top: i * 37, bottom: i * 37 + 37, left: 0, right: 600, width: 600, height: 37, x: 0, y: i * 37, toJSON: () => ({}) }
    ));
    const handle = rowEls[rowEls.length - 1]?.querySelector<HTMLElement>('[data-blok-database-table-row-handle]');

    if (handle === null || handle === undefined) throw new Error('no row handle');
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 84, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 2 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 2 }));
  };

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
    vi.restoreAllMocks();
  });

  it('a dragged row keeps its Last edited time', async () => {
    await makeTable();
    const cellBefore = editedCell('r3');

    dragLastToTop();
    await quiet();

    expect((await savedRow('r3'))?.lastEditedAt).toBe(EDITED_AT);
    expect(shownOrder()).toEqual(['r3', 'r1', 'r2']);
    expect(cellBefore).not.toBe('');
    expect(await reloadedEditedCell('r3')).toBe(cellBefore);
  });

  it('undo puts a dragged row back', async () => {
    await makeTable();

    dragLastToTop();
    await quiet();
    expect(shownOrder()).toEqual(['r3', 'r1', 'r2']);

    editor?.history.undo();
    await quiet();

    expect(shownOrder()).toEqual(['r1', 'r2', 'r3']);
    expect(((await savedRow('r3'))?.data as DatabaseRowData | undefined)?.position).toBe('a2');
  });

  it('a drop into another group is one undo step that stamps the row', async () => {
    const grouped: DatabaseData = {
      ...tableData,
      schema: [...tableData.schema, {
        id: 's', name: 'Stage', type: 'select', position: 'a3',
        config: { options: [{ id: 'oa', label: 'A', color: 'gray', position: 'a0' }, { id: 'ob', label: 'B', color: 'blue', position: 'a1' }] },
      }],
      views: [{ ...tableData.views[0], groupBy: 's' }],
    };
    const stage = ['oa', 'oa', 'ob'];

    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
      data: { blocks: rows().map((block, i): OutputBlockData => (i === 0 ? { ...block, data: grouped } : {
        ...block, data: { ...(block.data as DatabaseRowData), properties: { ...(block.data as DatabaseRowData).properties, s: stage[i - 1] } },
      })) },
    } as never) as unknown as TestEditor;
    await editor.isReady;
    await quiet();

    dragLastToTop();
    await quiet();

    const moved = await savedRow('r3');

    expect((moved?.data as DatabaseRowData | undefined)?.properties.s).toBe('oa');
    expect(moved?.lastEditedAt).toBeGreaterThan(EDITED_AT);
    expect(shownOrder()).toEqual(['r3', 'r1', 'r2']);

    editor.history.undo();
    await quiet();

    const undone = (await savedRow('r3'))?.data as DatabaseRowData | undefined;

    expect(undone?.properties.s).toBe('ob');
    expect(undone?.position).toBe('a2');
  });

  it('a property edit still stamps the row', async () => {
    await makeTable();
    const block = editor?.blocks.getById('r2');
    const cellBefore = editedCell('r2');

    block?.call('updateProperties', { n: 'note' });
    block?.dispatchChange();
    await quiet();

    expect((await savedRow('r2'))?.lastEditedAt).toBeGreaterThan(EDITED_AT);
    expect(await reloadedEditedCell('r2')).not.toBe(cellBefore);
  });
});
