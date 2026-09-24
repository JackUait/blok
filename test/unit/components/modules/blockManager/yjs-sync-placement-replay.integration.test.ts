/**
 * A peer (or this client's undo/redo) replays a structural change from the
 * shared document. The replaying editor must end with the same tree as the
 * author: flat order, parents, each parent's contentIds, holders and saved
 * JSON. Real editors on both sides; updates travel as Yjs binary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Callout, Header, Toggle } from '../../../../../src/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<{ blocks: OutputBlockData[] }>;
  history: { undo: () => void; redo: () => void };
  blocks: {
    moveTo: (id: string, target: { parentId?: string | null; position: unknown }) => void;
    insert: (tool: string, data: Record<string, unknown>, config: Record<string, unknown>, index: number, needToFocus: boolean, replace: boolean, id: string) => void;
  };
  module: {
    blockManager: {
      blocks: Block[];
      getBlockById: (id: string) => Block | undefined;
      move: (toIndex: number, fromIndex: number) => void;
      setBlockParent: (block: Block, parentId: string | null) => void;
    };
    yjsManager: {
      stopCapturing: () => void;
      transactMoves: (fn: () => void, isDrag?: boolean) => void;
      toJSON: () => OutputBlockData[];
      getStateVector: () => Uint8Array;
      encodeStateAsUpdate: (stateVector?: Uint8Array) => Uint8Array;
      applyRemoteUpdate: (update: Uint8Array) => void;
    };
  };
}

const P = (id: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text: id }, ...(parent === undefined ? {} : { parent }) });

const T = (id: string, content: string[], parent?: string): OutputBlockData =>
  ({ id, type: 'toggle', data: { text: id, isOpen: true }, content, ...(parent === undefined ? {} : { parent }) });

const C = (id: string, content: string[]): OutputBlockData =>
  ({ id, type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content });

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

/** Undo/redo rebuilds across an animation frame. */
const settleThroughFrame = async (): Promise<void> => {
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
};

const holders: HTMLElement[] = [];
const editors: Runtime[] = [];

const boot = async (blocks: OutputBlockData[]): Promise<Runtime> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: Toggle, callout: Callout, header: Header },
    data: { blocks },
  }) as unknown as Runtime;

  editors.push(editor);
  await editor.isReady;
  await settle();
  editor.module.yjsManager.stopCapturing();

  return editor;
};

/** Sends everything `from` has that `to` lacks. */
const push = (from: Runtime, to: Runtime): void => {
  to.module.yjsManager.applyRemoteUpdate(from.module.yjsManager.encodeStateAsUpdate(to.module.yjsManager.getStateVector()));
};

/** A peer that joins empty and takes the author's document. */
const pair = async (blocks: OutputBlockData[]): Promise<{ author: Runtime; peer: Runtime }> => {
  const author = await boot(blocks);
  const peer = await boot([]);

  push(author, peer);
  await settleThroughFrame();

  return { author, peer };
};

const KNOWN = /^[a-z]+\d*$/;

/**
 * Everything a replay must agree on, for the blocks the test named (the
 * empty peer's own default paragraph has a random id and is left out).
 */
const tree = (editor: Runtime): { flat: string[]; contentIds: string[]; dom: string } => {
  const blocks = editor.module.blockManager.blocks.filter(block => KNOWN.test(block.id));
  const dom = (element: Element): string => Array.from(element.children).map(child => {
    const id = child.getAttribute('data-blok-id');
    const inner = dom(child);

    if (id === null) {
      return inner;
    }

    return KNOWN.test(id) ? id + (inner === '' ? '' : `(${inner})`) : '';
  }).filter(part => part !== '').join(',');

  return {
    flat: blocks.map(block => `${block.id}^${block.parentId ?? '-'}${block.holder.classList.contains('hidden') ? ' hidden' : ''}`),
    contentIds: blocks.filter(block => block.contentIds.length > 0).map(block => `${block.id}[${block.contentIds.join(',')}]`),
    dom: dom(editor.module.blockManager.blocks[0]?.holder.parentElement ?? document.body),
  };
};

const saved = async (editor: Runtime): Promise<string[]> =>
  (await editor.save()).blocks
    .filter(block => KNOWN.test(block.id ?? ''))
    .map(block => `${block.id ?? ''}^${block.parent ?? '-'}[${(block.content ?? []).join(',')}]`);

const docIds = (editor: Runtime): string[] =>
  editor.module.yjsManager.toJSON()
    .filter(block => KNOWN.test(block.id ?? ''))
    .map(block => `${block.id ?? ''}^${block.parent ?? '-'}[${(block.content ?? []).join(',')}]`);

/** Both editors hold the same tree, and each one's memory matches its doc. */
const expectConverged = async (author: Runtime, peer: Runtime): Promise<void> => {
  expect(tree(peer)).toStrictEqual(tree(author));
  expect(await saved(peer)).toStrictEqual(await saved(author));
  expect(await saved(peer)).toStrictEqual(docIds(peer));
  expect(docIds(peer)).toStrictEqual(docIds(author));
};

const byId = (editor: Runtime, id: string): Block => {
  const block = editor.module.blockManager.getBlockById(id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

describe('a peer replays a structural change by the document tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('reorders a toggle\'s children', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y', 'z']), P('x', 't'), P('y', 't'), P('z', 't'), P('b')]);

    author.blocks.moveTo('z', { position: { before: 'x' } });
    await settle();
    push(author, peer);
    await settleThroughFrame();

    expect(tree(peer).flat).toStrictEqual(['a^-', 't^-', 'z^t', 'x^t', 'y^t', 'b^-']);
    await expectConverged(author, peer);
  }, 60_000);

  it('reorders root blocks around a toggle with children', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x']), P('x', 't'), P('b')]);

    author.blocks.moveTo('t', { position: { after: 'b' } });
    await settle();
    push(author, peer);
    await settleThroughFrame();

    expect(tree(peer).flat).toStrictEqual(['a^-', 'b^-', 't^-', 'x^t']);
    await expectConverged(author, peer);
  }, 60_000);

  it('reparents a root block into the middle of a toggle', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.blocks.moveTo('b', { position: { after: 'x' } });
    await settle();
    push(author, peer);
    await settleThroughFrame();

    expect(tree(peer).flat).toStrictEqual(['a^-', 't^-', 'x^t', 'b^t', 'y^t']);
    await expectConverged(author, peer);
  }, 60_000);

  it('knows the reparented block\'s slot as soon as the update lands', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.blocks.moveTo('b', { position: { after: 'x' } });
    await settle();
    push(author, peer);

    // Before any microtask: the parent-change handler placed the block itself.
    expect(byId(peer, 't').contentIds).toStrictEqual(['x', 'b', 'y']);
    expect(tree(peer).flat).toStrictEqual(['a^-', 't^-', 'x^t', 'b^t', 'y^t']);
    await settleThroughFrame();
  }, 60_000);

  it('reparents a toggle child out to the root', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.blocks.moveTo('x', { position: { after: 'a' } });
    await settle();
    push(author, peer);
    await settleThroughFrame();

    expect(tree(peer).flat).toStrictEqual(['a^-', 'x^-', 't^-', 'y^t', 'b^-']);
    await expectConverged(author, peer);
  }, 60_000);

  it('moves a toggle with its children into a callout', async () => {
    const { author, peer } = await pair([
      P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), C('c', ['q']), P('q', 'c'), P('b'),
    ]);

    author.blocks.moveTo('t', { parentId: 'c', position: 'end' });
    await settle();
    push(author, peer);
    await settleThroughFrame();

    expect(tree(peer).flat).toStrictEqual(['a^-', 'c^-', 'q^c', 't^c', 'x^t', 'y^t', 'b^-']);
    await expectConverged(author, peer);
  }, 60_000);

  it('adds a peer\'s new block inside a toggle after the right sibling', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.blocks.insert('paragraph', { text: 'n' }, {}, 3, false, false, 'n1');
    await settle();
    push(author, peer);
    await settleThroughFrame();

    expect(tree(author).flat).toStrictEqual(['a^-', 't^-', 'x^t', 'n1^t', 'y^t', 'b^-']);
    await expectConverged(author, peer);
  }, 60_000);

  it('converges when both peers move blocks at the same time', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b'), P('c')]);

    author.blocks.moveTo('b', { position: { after: 'x' } });
    peer.blocks.moveTo('y', { position: { after: 'c' } });
    peer.blocks.moveTo('a', { parentId: 't', position: 'start' });
    await settle();
    push(author, peer);
    push(peer, author);
    await settleThroughFrame();

    await expectConverged(author, peer);
  }, 60_000);
});

describe('undo and redo replay a move group by the document tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  /** DragController's drop: one group with the flat moves and the reparents. */
  const dragInto = (editor: Runtime, ids: string[], toIndex: number, parentId: string | null): void => {
    const manager = editor.module.blockManager;

    editor.module.yjsManager.transactMoves(() => {
      ids.forEach((id, offset) => {
        manager.move(toIndex + offset, manager.blocks.findIndex(block => block.id === id));
      });
      ids.forEach(id => manager.setBlockParent(byId(editor, id), parentId));
    }, true);
  };

  it('undoes and redoes a two-block drag into a toggle exactly, and the peer follows', async () => {
    const { author, peer } = await pair([P('a'), P('b'), T('t', ['x']), P('x', 't'), P('c')]);
    const before = tree(author);

    dragInto(author, ['a', 'b'], 3, 't');
    await settleThroughFrame();
    const after = tree(author);

    expect(after.flat).toStrictEqual(['t^-', 'x^t', 'a^t', 'b^t', 'c^-']);

    author.module.yjsManager.stopCapturing();
    author.history.undo();
    await settleThroughFrame();
    expect(tree(author)).toStrictEqual(before);
    push(author, peer);
    await settleThroughFrame();
    await expectConverged(author, peer);

    author.history.redo();
    await settleThroughFrame();
    expect(tree(author)).toStrictEqual(after);
    push(author, peer);
    await settleThroughFrame();
    await expectConverged(author, peer);
  }, 60_000);

  it('redoes a move after a peer inserted a block before it', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x']), P('x', 't'), P('b')]);

    author.blocks.moveTo('b', { parentId: 't', position: 'end' });
    await settle();
    author.module.yjsManager.stopCapturing();
    author.history.undo();
    await settleThroughFrame();
    push(author, peer);
    await settleThroughFrame();

    peer.blocks.insert('paragraph', { text: 'n' }, {}, 0, false, false, 'n1');
    await settle();
    push(peer, author);
    await settleThroughFrame();

    author.history.redo();
    await settleThroughFrame();

    expect(tree(author).flat).toStrictEqual(['n1^-', 'a^-', 't^-', 'x^t', 'b^t']);
    push(author, peer);
    await settleThroughFrame();
    await expectConverged(author, peer);
  }, 60_000);
});
