/**
 * A local change must reach the shared document at the place the editor's
 * tree holds: the doc (order, parents, contentIds) equals save(), after undo
 * and redo too, and a peer taking the update ends with the same document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Header, Toggle } from '../../../../../src/tools';
import { Column } from '../../../../../src/tools/column';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData, PasteEvent } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<{ blocks: OutputBlockData[] }>;
  history: { undo: () => void; redo: () => void };
  blocks: API['blocks'];
  module: {
    blockManager: {
      blocks: Block[];
      getBlockById: (id: string) => Block | undefined;
      currentBlockIndex: number;
      move: (toIndex: number, fromIndex: number) => void;
      setBlockParent: (block: Block, parentId: string | null) => void;
      deleteSelectedBlocksAndInsertReplacement: (forceReplacement?: boolean) => Block | undefined;
      paste: (toolName: string, pasteEvent: PasteEvent, replace?: boolean) => Promise<Block>;
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

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

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
    tools: { paragraph: Paragraph, toggle: Toggle, header: Header, column_list: ColumnList, column: Column },
    data: { blocks },
  }) as unknown as Runtime;

  editors.push(editor);
  await editor.isReady;
  await settle();
  editor.module.yjsManager.stopCapturing();

  return editor;
};

const push = (from: Runtime, to: Runtime): void => {
  to.module.yjsManager.applyRemoteUpdate(from.module.yjsManager.encodeStateAsUpdate(to.module.yjsManager.getStateVector()));
};

const shape = (blocks: OutputBlockData[], keep: (id: string) => boolean = () => true): string[] =>
  blocks
    .filter(block => keep(block.id ?? ''))
    .map(block => `${block.id ?? ''}^${block.parent ?? '-'}[${(block.content ?? []).join(',')}]`);

const saved = async (editor: Runtime): Promise<string[]> => shape((await editor.save()).blocks);

const doc = (editor: Runtime): string[] => shape(editor.module.yjsManager.toJSON());

const memory = (editor: Runtime): string[] =>
  editor.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}[${block.contentIds.join(',')}]`);

/** The doc says what the editor's tree says, and what save() says (save leaves out empty blocks). */
const expectDocMatchesSave = async (editor: Runtime): Promise<void> => {
  const savedShape = await saved(editor);
  const savedIds = new Set(savedShape.map(entry => entry.split('^')[0]));

  expect(doc(editor)).toStrictEqual(memory(editor));
  expect(shape(editor.module.yjsManager.toJSON(), id => savedIds.has(id))).toStrictEqual(savedShape);
};

/** A peer that joined before the change takes it and ends with the author's document. */
const expectPeerConverges = async (author: Runtime, peer: Runtime): Promise<void> => {
  push(author, peer);
  await settleThroughFrame();

  const authorIds = new Set(doc(author).map(entry => entry.split('^')[0]));
  const keep = (id: string): boolean => authorIds.has(id);

  expect(shape(peer.module.yjsManager.toJSON(), keep)).toStrictEqual(doc(author));
  expect(shape((await peer.save()).blocks, keep)).toStrictEqual(await saved(author));
};

const pair = async (blocks: OutputBlockData[]): Promise<{ author: Runtime; peer: Runtime }> => {
  const author = await boot(blocks);
  const peer = await boot([]);

  push(author, peer);
  await settleThroughFrame();
  peer.module.yjsManager.stopCapturing();

  return { author, peer };
};

/** Change, then check doc = save through undo and redo, then the peer. */
const expectEverywhere = async (author: Runtime, peer: Runtime, after: string[]): Promise<void> => {
  expect(await saved(author)).toStrictEqual(after);
  await expectDocMatchesSave(author);

  const peerCopy = await boot([]);

  push(author, peerCopy);
  await settleThroughFrame();
  await expectPeerConverges(author, peer);

  author.history.undo();
  await settleThroughFrame();
  await expectDocMatchesSave(author);

  author.history.redo();
  await settleThroughFrame();
  expect(await saved(author)).toStrictEqual(after);
  await expectDocMatchesSave(author);
};

const byId = (editor: Runtime, id: string): Block => {
  const block = editor.module.blockManager.getBlockById(id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

describe('local writers place blocks in the doc where the editor tree has them', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('index insert between root blocks', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x']), P('x', 't'), P('b')]);

    author.blocks.insert('paragraph', { text: 'n' }, {}, 1, false, false, 'n');
    await settle();

    await expectEverywhere(author, peer, ['a^-[]', 'n^-[]', 't^-[x]', 'x^t[]', 'b^-[]']);
  }, 60_000);

  it('index insert that replaces a toggle child', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.blocks.insert('header', { text: 'h', level: 2 }, {}, 3, false, true, 'h');
    await settle();

    await expectEverywhere(author, peer, ['a^-[]', 't^-[x,h]', 'x^t[]', 'h^t[]', 'b^-[]']);
  }, 60_000);

  it('index insert that replaces a toggle with children', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.blocks.insert('header', { text: 'h', level: 2 }, {}, 1, false, true, 'h');
    await settle();

    await expectEverywhere(author, peer, (await saved(author)));
  }, 60_000);

  it('paste after a toggle child', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    author.module.blockManager.currentBlockIndex = 2;

    const element = document.createElement('p');

    element.innerHTML = 'pasted';
    const pasted = await author.module.blockManager.paste('paragraph', new CustomEvent('paste', { detail: { data: element } }));

    await settleThroughFrame();

    await expectEverywhere(author, peer, ['a^-[]', `t^-[x,${pasted.id},y]`, 'x^t[]', `${pasted.id}^t[]`, 'y^t[]', 'b^-[]']);
  }, 60_000);

  it('replacement block after deleting a toggle\'s selected children', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

    byId(author, 'x').selected = true;
    byId(author, 'y').selected = true;
    author.module.blockManager.deleteSelectedBlocksAndInsertReplacement(true);
    await settleThroughFrame();

    await expectEverywhere(author, peer, await saved(author));
  }, 60_000);

  it('clear', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x']), P('x', 't'), P('b')]);

    await author.blocks.clear();
    await settleThroughFrame();

    await expectEverywhere(author, peer, await saved(author));
  }, 60_000);

  it('a drag reorder inside a toggle (flat move in a move group)', async () => {
    const { author, peer } = await pair([P('a'), T('t', ['x', 'y', 'z']), P('x', 't'), P('y', 't'), P('z', 't'), P('b')]);

    author.module.yjsManager.transactMoves(() => {
      author.module.blockManager.move(2, 4);
      author.module.blockManager.setBlockParent(byId(author, 'z'), 't');
    }, true);
    await settleThroughFrame();

    await expectEverywhere(author, peer, ['a^-[]', 't^-[z,x,y]', 'z^t[]', 'x^t[]', 'y^t[]', 'b^-[]']);
  }, 60_000);

  describe('index insert in a column list', () => {
    const columns = (): OutputBlockData[] => [
      { id: 'cl', type: 'column_list', data: {}, content: ['ka', 'kb'] },
      { id: 'ka', type: 'column', data: {}, parent: 'cl', content: ['x'] },
      P('x', 'ka'),
      { id: 'kb', type: 'column', data: {}, parent: 'cl', content: ['y'] },
      P('y', 'kb'),
    ];

    for (const index of [0, 1, 2, 3, 4, 5]) {
      it(`at flat index ${index}`, async () => {
        const { author, peer } = await pair(columns());

        author.blocks.insert('paragraph', { text: 'n' }, {}, index, false, false, 'n');
        await settle();

        expect(doc(author)).toStrictEqual(memory(author));
        await expectPeerConverges(author, peer);
      }, 60_000);
    }
  });

  describe('the block that replaces a deleted selection', () => {
    const replaceSelection = async (author: Runtime, ids: string[]): Promise<string> => {
      ids.forEach(id => {
        byId(author, id).selected = true;
      });

      const replacement = author.module.blockManager.deleteSelectedBlocksAndInsertReplacement(true);

      await settleThroughFrame();

      if (replacement === undefined) {
        throw new Error('no replacement block');
      }

      return replacement.id;
    };

    it('goes to the root after the toggle when the selection starts at its first child', async () => {
      const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);
      const replacement = await replaceSelection(author, ['x']);

      expect(memory(author)).toStrictEqual(['a^-[]', 't^-[y]', 'y^t[]', `${replacement}^-[]`, 'b^-[]']);
      await expectEverywhere(author, peer, ['a^-[]', 't^-[y]', 'y^t[]', 'b^-[]']);
    }, 60_000);

    it('goes to the root after the toggle when the selection runs from its last child to the root', async () => {
      const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);
      const replacement = await replaceSelection(author, ['y', 'b']);

      expect(memory(author)).toStrictEqual(['a^-[]', 't^-[x]', 'x^t[]', `${replacement}^-[]`]);
      await expectEverywhere(author, peer, ['a^-[]', 't^-[x]', 'x^t[]']);
    }, 60_000);

    for (const ids of [['y'], ['t', 'x', 'y'], ['a', 't', 'x']]) {
      it(`keeps the doc equal to the tree for ${ids.join('+')}`, async () => {
        const { author, peer } = await pair([P('a'), T('t', ['x', 'y']), P('x', 't'), P('y', 't'), P('b')]);

        await replaceSelection(author, ids);

        await expectEverywhere(author, peer, await saved(author));
      }, 60_000);
    }
  });
});
