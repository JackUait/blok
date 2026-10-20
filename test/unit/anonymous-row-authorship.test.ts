import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { DatabaseTool } from '../../src/tools/database';
import { DatabaseRowTool } from '../../src/tools/database-row';
import { DocumentStore } from '../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../src/components/modules/yjs/serializer';
import type { DatabaseData, PropertyDefinition } from '../../src/tools/database/types';
import type { API, OutputBlockData, OutputData } from '../../types';

/**
 * An anonymous form answer (research/23 §6) stays anonymous after it is
 * stored: a later edit of the row or of its page body by the same user must
 * not put that user's id on the row or its body.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'who', name: 'Who', type: 'createdBy', position: 'a1' },
  { id: 'note', name: 'Note', type: 'text', position: 'a2' },
];

const docBlocks = (anonymous: boolean): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1'],
    data: {
      schema,
      views: [{ id: 'table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'table',
    } satisfies DatabaseData,
  },
  {
    id: 'r1', type: 'database-row', parent: 'db', content: ['p1'],
    data: { properties: { title: 'Resp' }, position: 'a0', title: 'Resp', ...(anonymous ? { anonymous: true } : {}) },
  },
  { id: 'p1', type: 'paragraph', parent: 'r1', data: { text: 'Body' } },
];

const signed = { createdBy: 'u-bob', createdAt: 1, lastEditedBy: 'u-bob', lastEditedAt: 2 };

// A signed block with a signed child, made elsewhere, outside the answer.
const strayBlocks = (): OutputBlockData[] => [
  { id: 'x', type: 'paragraph', content: ['x1'], data: { text: 'Mine' }, ...signed },
  { id: 'x1', type: 'paragraph', parent: 'x', data: { text: 'Child' }, ...signed },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const mount = async (anonymous: boolean, extra: OutputBlockData[] = []): Promise<TestEditor> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    user: { id: 'u-ada' },
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: [...docBlocks(anonymous), ...extra] },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// Waits out the 400ms settling window after load: an edit inside it counts as the editor's own write.
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 600));
};

const editRowAndBody = async (instance: TestEditor): Promise<string> => {
  await settle();
  const row = instance.blocks.getById('r1');

  row?.call('updateProperties', { note: 'Changed' });
  row?.dispatchChange();
  await instance.blocks.update('p1', { text: 'Edited body' });
  const added = instance.blocks.insertAt('paragraph', { text: 'More' }, { parentId: 'r1', position: 'end' });

  await flush();
  await settle();

  return added.id;
};

describe('anonymous form answer: no author after later edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('puts no user id on the row, its body, or a body block added later', async () => {
    const instance = await mount(true);
    const addedId = await editRowAndBody(instance);
    const saved = await instance.save();
    const byId = (id: string): OutputBlockData | undefined => saved.blocks.find((block) => block.id === id);

    for (const id of ['r1', 'p1', addedId]) {
      expect(byId(id)?.lastEditedBy, id).toBeUndefined();
      expect(byId(id)?.createdBy, id).toBeUndefined();
      expect(instance.blocks.getById(id)?.lastEditedBy, id).toBeUndefined();
      expect(instance.blocks.getById(id)?.createdBy, id).toBeUndefined();
    }
    expect(byId('r1')?.data).toEqual(expect.objectContaining({ properties: expect.objectContaining({ note: 'Changed' }), anonymous: true }));
    expect(byId('r1')?.lastEditedAt).toEqual(expect.any(Number));
  });

  it('still signs the same edits on a row that is not anonymous', async () => {
    const instance = await mount(false);
    const addedId = await editRowAndBody(instance);
    const saved = await instance.save();
    const byId = (id: string): OutputBlockData | undefined => saved.blocks.find((block) => block.id === id);

    expect(byId('r1')?.lastEditedBy).toBe('u-ada');
    expect(byId('p1')?.lastEditedBy).toBe('u-ada');
    expect(byId(addedId)?.createdBy).toBe('u-ada');
  });
});

describe('anonymous form answer: a signed block moved in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  const moves: Array<[string, (instance: TestEditor) => void]> = [
    ['moveTo', (instance) => instance.blocks.moveTo('x', { parentId: 'r1', position: 'end' })],
    ['setBlockParent', (instance) => instance.blocks.setBlockParent('x', 'r1')],
  ];

  it.each(moves)('drops both ids from it and its child after %s', async (_name, move) => {
    const instance = await mount(true, strayBlocks());

    await settle();
    move(instance);
    await flush();
    const saved = await instance.save();

    for (const id of ['x', 'x1']) {
      const block = saved.blocks.find((entry) => entry.id === id);

      expect(block?.createdBy, id).toBeUndefined();
      expect(block?.lastEditedBy, id).toBeUndefined();
      expect(instance.blocks.getById(id)?.createdBy, id).toBeUndefined();
      expect(instance.blocks.getById(id)?.lastEditedBy, id).toBeUndefined();
    }
    expect(saved.blocks.find((entry) => entry.id === 'x')?.parent).toBe('r1');
  });

  it('the editor copy agrees with the document after the block moves back out', async () => {
    const instance = await mount(true, strayBlocks());

    await settle();
    instance.blocks.moveTo('x', { parentId: 'r1', position: 'end' });
    instance.blocks.moveTo('x', { parentId: null, position: 'end' });
    await flush();
    const saved = await instance.save();

    for (const id of ['x', 'x1']) {
      expect(saved.blocks.find((entry) => entry.id === id)?.createdBy, id).toBeUndefined();
      expect(saved.blocks.find((entry) => entry.id === id)?.lastEditedBy, id).toBeUndefined();
    }
  });

  it('stays unsigned after a later edit of the moved block', async () => {
    const instance = await mount(true, strayBlocks());

    await settle();
    instance.blocks.moveTo('x', { parentId: 'r1', position: 'end' });
    await instance.blocks.update('x', { text: 'Edited' });
    await flush();
    await settle();
    const saved = await instance.save();

    expect(saved.blocks.find((entry) => entry.id === 'x')?.createdBy).toBeUndefined();
    expect(saved.blocks.find((entry) => entry.id === 'x')?.lastEditedBy).toBeUndefined();
  });

  it('hides ids an older save left on the body', async () => {
    const legacy = docBlocks(true).map((block) => (block.id === 'p1' ? { ...block, ...signed } : block));

    holder = document.createElement('div');
    document.body.appendChild(holder);
    const instance = new Blok({
      holder,
      dataModel: 'hierarchical',
      user: { id: 'u-ada' },
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: legacy },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    const saved = await instance.save();

    expect(instance.blocks.getById('p1')?.createdBy).toBeUndefined();
    expect(instance.blocks.getById('p1')?.lastEditedBy).toBeUndefined();
    expect(saved.blocks.find((entry) => entry.id === 'p1')?.createdBy).toBeUndefined();
    expect(saved.blocks.find((entry) => entry.id === 'p1')?.lastEditedBy).toBeUndefined();
  });

  it.each(moves)('keeps the ids after %s into a row that is not anonymous', async (_name, move) => {
    const instance = await mount(false, strayBlocks());

    await settle();
    move(instance);
    await flush();
    const saved = await instance.save();

    expect(saved.blocks.find((entry) => entry.id === 'x1')?.createdBy).toBe('u-bob');
    expect(saved.blocks.find((entry) => entry.id === 'x1')?.lastEditedBy).toBe('u-bob');
    expect(instance.blocks.getById('x')?.createdBy).toBe('u-bob');
  });
});

describe('anonymous form answer in the shared document', () => {
  const store = (): DocumentStore => {
    const doc = new DocumentStore(new YBlockSerializer());

    doc.fromJSON(docBlocks(true));

    return doc;
  };

  it('never writes an editor id onto the row or a block under it', () => {
    const doc = store();

    doc.updateBlockMetadata('r1', 10, 'u-ada');
    doc.updateBlockMetadata('p1', 11, 'u-ada');

    expect(doc.getBlockById('r1')?.get('lastEditedBy')).toBeUndefined();
    expect(doc.getBlockById('p1')?.get('lastEditedBy')).toBeUndefined();
    expect(doc.getBlockById('r1')?.get('lastEditedAt')).toBe(10);
    expect(doc.toJSON().find((block) => block.id === 'p1')?.lastEditedAt).toBe(11);
  });

  it('drops both ids from a block and its child moved into the row', () => {
    const doc = new DocumentStore(new YBlockSerializer());

    doc.fromJSON([...docBlocks(true), ...strayBlocks()]);
    doc.moveBlockTo('x', { parentId: 'r1', afterId: 'p1' });

    for (const id of ['x', 'x1']) {
      expect(doc.getBlockById(id)?.get('createdBy'), id).toBeUndefined();
      expect(doc.getBlockById(id)?.get('lastEditedBy'), id).toBeUndefined();
    }
    expect(doc.getBlockById('x')?.get('createdAt')).toBe(1);
  });

  it('keeps the ids of a block moved into a row that is not anonymous', () => {
    const doc = new DocumentStore(new YBlockSerializer());

    doc.fromJSON([...docBlocks(false), ...strayBlocks()]);
    doc.moveBlockTo('x', { parentId: 'r1', afterId: 'p1' });

    expect(doc.getBlockById('x1')?.get('createdBy')).toBe('u-bob');
  });

  it('drops ids an older save left under the row when the document loads', () => {
    const doc = new DocumentStore(new YBlockSerializer());
    const legacy = docBlocks(true).map((block) => (block.id === 'db' ? block : { ...block, ...signed }));

    doc.fromJSON([...legacy, ...strayBlocks()]);

    for (const id of ['r1', 'p1']) {
      expect(doc.getBlockById(id)?.get('createdBy'), id).toBeUndefined();
      expect(doc.getBlockById(id)?.get('lastEditedBy'), id).toBeUndefined();
    }
    expect(doc.getBlockById('x')?.get('createdBy')).toBe('u-bob');
  });

  it('still writes the editor id outside the anonymous row', () => {
    const doc = store();

    doc.updateBlockMetadata('db', 12, 'u-ada');

    expect(doc.getBlockById('db')?.get('lastEditedBy')).toBe('u-ada');
  });
});
