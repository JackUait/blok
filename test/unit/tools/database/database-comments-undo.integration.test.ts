import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * Comment writes are not document undo. The open risk from the design
 * (18-comments-design §4): a comment written, uncaptured, inside a row that an
 * undoable step created. These pin what undo and redo do to it.
 */
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

const make = async (): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool, 'database-comment': DatabaseCommentTool },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const comment = (blok: TestEditor, parentId: string, text: string): void => {
  blok.blocks.transactWithoutCapture?.(() => {
    blok.blocks.insertAt('database-comment', { text, createdAt: 1 }, { parentId, position: 'end' });
  });
};

const ids = (saved: OutputData): string[] => saved.blocks.map((block) => block.id ?? '');

/** Every id a block names in `content` exists, and every parent exists. */
const consistent = (saved: OutputData): boolean => {
  const all = new Set(ids(saved));

  return saved.blocks.every((block) =>
    (block.content ?? []).every((id) => all.has(id)) && (block.parent === undefined || all.has(block.parent)));
};

describe('comment writes stay out of document undo', () => {
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

  it('adds no undo step: undo after a comment undoes the edit before it', async () => {
    const blok = await make();

    blok.blocks.insertAt('paragraph', { text: 'body' }, { parentId: 'r1', position: 'end', id: 'b1' });
    await quiet();
    comment(blok, 'r1', 'hello');
    await quiet();
    blok.history.undo();
    await quiet();

    const saved = await blok.save();

    expect(ids(saved)).not.toContain('b1');
    expect(saved.blocks.filter((block) => block.type === 'database-comment').map((block) => block.data.text)).toEqual(['hello']);
    expect(consistent(saved)).toBe(true);
  });

  it('spares a row an undoable step created once a comment is on it; the press undoes the step before', async () => {
    const blok = await make();

    blok.blocks.insertAt('paragraph', { text: 'earlier' }, { position: 'end', id: 'p1' });
    await quiet();
    blok.blocks.insertAt('database-row', { properties: { t: 'Two' }, position: 'a1' }, { parentId: 'db', position: 'end', id: 'r2' });
    await quiet();
    comment(blok, 'r2', 'on the new row');
    await quiet();
    blok.history.undo();
    await quiet();

    const saved = await blok.save();
    const thread = saved.blocks.find((block) => block.type === 'database-comment');

    expect(thread?.parent).toBe('r2');
    expect(saved.blocks.find((block) => block.id === 'r2')?.content).toEqual([thread?.id]);
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toEqual(['r1', 'r2']);
    expect(ids(saved)).not.toContain('p1');
    expect(consistent(saved)).toBe(true);

    blok.history.redo();
    await quiet();

    const redone = await blok.save();

    expect(ids(redone)).toContain('p1');
    expect(redone.blocks.find((block) => block.type === 'database-comment')?.parent).toBe('r2');
    expect(consistent(redone)).toBe(true);
  });

  it('brings a deleted row back with its thread on undo', async () => {
    const blok = await make();

    comment(blok, 'r1', 'kept');
    await quiet();
    const at = blok.blocks.getBlockIndex('r1');

    if (at === undefined) throw new Error('no row');
    await blok.blocks.delete(at);
    await quiet();

    expect((await blok.save()).blocks.some((block) => block.type === 'database-comment')).toBe(false);

    blok.history.undo();
    await quiet();

    const saved = await blok.save();
    const thread = saved.blocks.find((block) => block.type === 'database-comment');

    expect(thread?.parent).toBe('r1');
    expect(thread?.data.text).toBe('kept');
    expect(saved.blocks.find((block) => block.id === 'r1')?.content).toEqual([thread?.id]);
    expect(consistent(saved)).toBe(true);
  });
});
