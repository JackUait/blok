import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { DocumentStore } from '../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../src/components/modules/yjs/serializer';
import { equalsOutputData } from '../../src/shared/output-data';
import type { API, BlockAPI, OutputData } from '../../types';

/**
 * A block records when and by whom it was created. Stamped ONCE, by the peer
 * that creates it, inside the same transaction that adds the block, so it is
 * never an undo step of its own and never re-minted on load or on a peer.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: API['history'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const NOW = Date.UTC(2026, 9, 9, 12);

const createEditor = async (blocks: OutputData['blocks'], user?: { id: string }): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks },
    ...(user !== undefined ? { user } : {}),
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('block creation metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stamps createdAt and createdBy on a block inserted in this editor and saves them', async () => {
    const instance = await createEditor([{ id: 'a1', type: 'paragraph', data: { text: 'Hello' } }], { id: 'u-ada' });
    const inserted = instance.blocks.insert('paragraph', { text: 'New' });

    await flush();
    const saved = (await instance.save()).blocks.find((block) => block.id === inserted.id);

    expect(saved?.createdAt).toBe(NOW);
    expect(saved?.createdBy).toBe('u-ada');
    expect(inserted.createdAt).toBe(NOW);
    expect(inserted.createdBy).toBe('u-ada');
  });

  it('leaves createdBy out without a configured user', async () => {
    const instance = await createEditor([{ id: 'a1', type: 'paragraph', data: { text: 'Hello' } }]);
    const inserted = instance.blocks.insert('paragraph', { text: 'New' });

    await flush();
    const saved = (await instance.save()).blocks.find((block) => block.id === inserted.id);

    expect(saved?.createdAt).toBe(NOW);
    expect(saved !== undefined && 'createdBy' in saved).toBe(false);
  });

  it('keeps a loaded block\'s stamp and invents none for a block saved before stamps existed', async () => {
    const loaded: OutputData['blocks'] = [
      { id: 'old', type: 'paragraph', data: { text: [{ text: 'Legacy' }] } },
      { id: 'stamped', type: 'paragraph', data: { text: [{ text: 'Kept' }] }, createdAt: 1000, createdBy: 'u-grace' },
    ];
    const instance = await createEditor(loaded);

    await flush();
    const saved = await instance.save();

    expect(saved.blocks.find((b) => b.id === 'old')).not.toHaveProperty('createdAt');
    expect(saved.blocks.find((b) => b.id === 'stamped')).toMatchObject({ createdAt: 1000, createdBy: 'u-grace' });
    expect(equalsOutputData({ blocks: loaded }, saved)).toBe(true);
  });

  it('does not count a creation stamp as a content change', () => {
    const plain: OutputData = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] };
    const stamped: OutputData = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' }, createdAt: 1, createdBy: 'u' }] };

    expect(equalsOutputData(plain, stamped)).toBe(true);
  });

  it('reads the stamps and the edit metadata through the block API', async () => {
    const instance = await createEditor([{ id: 'b', type: 'paragraph', data: { text: 'x' }, createdAt: 5, createdBy: 'u1', lastEditedAt: 9, lastEditedBy: 'u2' }]);
    const block = instance.blocks.getById('b') as BlockAPI;

    expect([block.createdAt, block.createdBy, block.lastEditedAt, block.lastEditedBy]).toEqual([5, 'u1', 9, 'u2']);
  });

  it('is not an undo step of its own: one undo removes the inserted block, stamp and all', async () => {
    const instance = await createEditor([{ id: 'a1', type: 'paragraph', data: { text: 'Hello' } }], { id: 'u-ada' });
    const inserted = instance.blocks.insert('paragraph', { text: 'New' });

    await flush();
    instance.history.undo();
    await flush();

    const saved = await instance.save();

    expect(saved.blocks.map((b) => b.id)).toEqual(['a1']);
    expect(saved.blocks.some((b) => b.id === inserted.id)).toBe(false);
    expect(instance.history.canUndo()).toBe(false);
  });
});

describe('block creation metadata in the shared document', () => {
  it('reaches a peer unchanged and is never re-minted there', () => {
    const a = new DocumentStore(new YBlockSerializer());
    const b = new DocumentStore(new YBlockSerializer());

    a.fromJSON([]);
    a.addBlock({ id: 'n', type: 'paragraph', data: { text: 'hi' }, createdAt: 77, createdBy: 'u1' });
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    expect(b.toJSON().find((block) => block.id === 'n')).toMatchObject({ createdAt: 77, createdBy: 'u1' });
  });

  it('round-trips through the serializer', () => {
    const serializer = new YBlockSerializer();
    const doc = new Y.Doc();
    const map = doc.getMap<Y.Map<unknown>>('blocks');

    map.set('x', serializer.outputDataToYBlock({ id: 'x', type: 'paragraph', data: {}, createdAt: 3, createdBy: 'u9' }));

    expect(serializer.yBlockToOutputData(map.get('x') as Y.Map<unknown>)).toMatchObject({ createdAt: 3, createdBy: 'u9' });
  });
});
