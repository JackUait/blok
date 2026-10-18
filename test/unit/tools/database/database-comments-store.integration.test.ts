import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import { BuiltInComments } from '../../../../src/tools/database/database-comments-store';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  tools: API['tools'];
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

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

/** A database that does not bring the comment tool along. */
class DatabaseWithoutComments extends DatabaseTool {
  public static companionTools = { 'database-row': DatabaseRowTool };
}

const make = async (withComments = true): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: withComments ? DatabaseTool : DatabaseWithoutComments,
      'database-row': DatabaseRowTool,
      ...(withComments ? { 'database-comment': DatabaseCommentTool } : {}),
    },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const clock = { at: 1000 };
const storeOf = (blok: TestEditor): BuiltInComments =>
  new BuiltInComments(blok, () => ({ authorName: 'Ann' }), () => clock.at);

const commentsIn = async (blok: TestEditor): Promise<OutputBlockData[]> =>
  (await blok.save()).blocks.filter((block) => block.type === 'database-comment');

describe('built-in comment storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clock.at = 1000;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('is available only where the comment tool is registered', async () => {
    expect(storeOf(await make(false)).available()).toBe(false);
    editor?.destroy();
    expect(storeOf(await make()).available()).toBe(true);
  });

  it('keeps a thread under its row and a reply under its thread, with author and time', async () => {
    const blok = await make();
    const store = storeOf(blok);
    const thread = store.add('r1', '  First  ', 't');

    clock.at = 2000;
    const reply = store.reply(thread ?? '', 'Second');

    await quiet();

    expect(store.threads('r1')).toEqual([{
      id: thread,
      data: { text: 'First', createdAt: 1000, authorName: 'Ann', propertyId: 't' },
      replies: [{ id: reply, data: { text: 'Second', createdAt: 2000, authorName: 'Ann' } }],
    }]);
    const saved = await commentsIn(blok);

    expect(saved.map((block) => block.parent)).toEqual(['r1', thread]);
  });

  it('never writes an empty comment', async () => {
    const store = storeOf(await make());

    expect(store.add('r1', '   ')).toBeUndefined();
    expect(store.threads('r1')).toEqual([]);
  });

  it('counts the comments of open threads only', async () => {
    const store = storeOf(await make());
    const thread = store.add('r1', 'a') ?? '';

    store.reply(thread, 'b');
    store.add('r1', 'c');

    expect(store.count('r1')).toBe(3);
    store.resolve(thread, true);
    expect(store.count('r1')).toBe(1);
    store.resolve(thread, false);
    expect(store.count('r1')).toBe(3);
  });

  it('edits text and stamps the edit time', async () => {
    const blok = await make();
    const store = storeOf(blok);
    const thread = store.add('r1', 'typo') ?? '';

    clock.at = 5000;
    store.edit(thread, 'fixed');
    await quiet();

    expect((await commentsIn(blok))[0]?.data).toMatchObject({ text: 'fixed', editedAt: 5000, createdAt: 1000 });
  });

  it('deletes a reply alone, and a thread with its replies', async () => {
    const blok = await make();
    const store = storeOf(blok);
    const thread = store.add('r1', 'a') ?? '';
    const reply = store.reply(thread, 'b') ?? '';

    store.reply(thread, 'c');
    store.remove(reply);
    await quiet();
    expect(store.threads('r1')[0]?.replies.map((comment) => comment.data.text)).toEqual(['c']);

    store.remove(thread);
    await quiet();
    expect(await commentsIn(blok)).toEqual([]);
  });

  it('adds no undo step for any comment write', async () => {
    const blok = await make();
    const store = storeOf(blok);

    blok.blocks.insertAt('paragraph', { text: 'body' }, { parentId: 'r1', position: 'end', id: 'b1' });
    await quiet();
    const thread = store.add('r1', 'a') ?? '';
    const gone = store.reply(thread, 'b') ?? '';

    store.reply(thread, 'c');
    await quiet();
    store.edit(thread, 'a2');
    store.resolve(thread, true);
    await quiet();
    store.remove(gone);
    await quiet();
    blok.history.undo();
    await quiet();

    const saved = await blok.save();

    expect(saved.blocks.some((block) => block.id === 'b1')).toBe(false);
    expect(saved.blocks.filter((block) => block.type === 'database-comment').map((block) => block.data)).toEqual([
      expect.objectContaining({ text: 'a2', resolved: true }),
      expect.objectContaining({ text: 'c' }),
    ]);
  });
});
