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

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const mount = async (anonymous: boolean): Promise<TestEditor> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    user: { id: 'u-ada' },
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: docBlocks(anonymous) },
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

  it('still writes the editor id outside the anonymous row', () => {
    const doc = store();

    doc.updateBlockMetadata('db', 12, 'u-ada');

    expect(doc.getBlockById('db')?.get('lastEditedBy')).toBe('u-ada');
  });
});
