/**
 * Every non-drag path that moves blocks must keep the flat block array a
 * depth-first order of the tree, keep each holder inside its parent's holder,
 * and undo in one step. Runs a real editor so Blocks.move, the hierarchy and
 * the undo history are the production ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { isCollapsedToggleBlock } from '../../../../../src/components/modules/drag/utils/toggleState';
import { Callout, Column, ColumnList, Header, List, Toggle } from '../../../../../src/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<{ blocks: OutputBlockData[] }>;
  history: { undo: () => void; redo: () => void };
  blocks: { move: (toIndex: number, fromIndex?: number) => void };
  module: {
    blockManager: {
      blocks: Block[];
      currentBlockIndex: number;
      move: (toIndex: number, fromIndex: number) => void;
      setBlockParent: (block: Block, parentId: string | null) => void;
      moveCurrentBlockUp: () => void;
      moveCurrentBlockDown: () => void;
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

const T = (id: string, content: string[], isOpen = true, parent?: string): OutputBlockData =>
  ({ id, type: 'toggle', data: { text: id, isOpen }, content, ...(parent === undefined ? {} : { parent }) });

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const holders: HTMLElement[] = [];

const boot = async (blocks: OutputBlockData[]): Promise<Runtime> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: Toggle, callout: Callout, header: Header, list: List, column_list: ColumnList, column: Column },
    data: { blocks },
  }) as unknown as Runtime;

  await editor.isReady;
  await settle();
  editor.module.yjsManager.stopCapturing();

  return editor;
};

/** id, parent, and whether the holder is hidden — one entry per block in flat order. */
const flat = (editor: Runtime): string[] => editor.module.blockManager.blocks.map(block =>
  `${block.id}^${block.parentId ?? '-'}${block.holder.classList.contains('hidden') ? ' hidden' : ''}`);

/**
 * Tree-order problems: a child ahead of its parent or split from it by a
 * block outside the parent's subtree, a holder mounted under the wrong block,
 * holders out of flat order, or a hidden flag that disagrees with the
 * collapsed ancestors.
 */
const treeViolations = (editor: Runtime): string[] => {
  const blocks = editor.module.blockManager.blocks;
  const byId = new Map(blocks.map(block => [block.id, block]));
  const isUnder = (block: Block, ancestorId: string): boolean => {
    const parent = block.parentId === null ? undefined : byId.get(block.parentId);

    return parent !== undefined && (parent.id === ancestorId || isUnder(parent, ancestorId));
  };
  const hasCollapsedAncestor = (block: Block): boolean => {
    const parent = block.parentId === null ? undefined : byId.get(block.parentId);

    return parent !== undefined && (isCollapsedToggleBlock(parent) || hasCollapsedAncestor(parent));
  };

  const order = blocks.flatMap((block, index) => {
    if (block.parentId === null) {
      return [];
    }
    const parentIndex = blocks.findIndex(candidate => candidate.id === block.parentId);
    const between = blocks.slice(parentIndex + 1, index);
    const outsider = between.find(candidate => !isUnder(candidate, block.parentId ?? ''));

    return parentIndex < 0 || parentIndex > index || outsider !== undefined
      ? [`${block.id} is not inside ${block.parentId}'s run${outsider === undefined ? '' : ` (${outsider.id} splits it)`}`]
      : [];
  });

  // A slotless parent (a list item) mounts its children in its own ancestor's slot.
  const ownsSlot = (block: Block): boolean =>
    Array.from(block.holder.querySelectorAll('[data-blok-toggle-children], [data-blok-nested-blocks]'))
      .some(slot => slot.closest('[data-blok-element]') === block.holder);
  const slotOwnerOf = (block: Block): string | null => {
    const parent = block.parentId === null ? undefined : byId.get(block.parentId);

    if (parent === undefined) {
      return null;
    }

    return ownsSlot(parent) ? parent.id : slotOwnerOf(parent);
  };

  const mount = blocks.flatMap((block) => {
    const domParent = block.holder.parentElement?.closest('[data-blok-element]')?.getAttribute('data-blok-id') ?? null;
    const expected = slotOwnerOf(block);

    return domParent === expected ? [] : [`${block.id} is mounted under ${domParent ?? 'root'}, expected ${expected ?? 'root'}`];
  });

  const domOrder = blocks.slice(1).flatMap((block, index) => {
    const previous = blocks[index].holder;

    return (previous.compareDocumentPosition(block.holder) & Node.DOCUMENT_POSITION_FOLLOWING) === 0
      ? [`${block.id} is before ${blocks[index].id} on screen`]
      : [];
  });

  // A grandchild is hidden through its hidden parent holder.
  const hidden = blocks.flatMap(block =>
    (block.holder.closest('.hidden') !== null) === hasCollapsedAncestor(block)
      ? []
      : [`${block.id} hidden=${String(block.holder.closest('.hidden') !== null)}`]);

  return [...order, ...mount, ...domOrder, ...hidden];
};

const savedIds = async (editor: Runtime): Promise<string[]> =>
  (await editor.save()).blocks.map(block => `${block.id ?? ''}^${block.parent ?? '-'}`);

const indexOf = (editor: Runtime, id: string): number =>
  editor.module.blockManager.blocks.findIndex(block => block.id === id);

const keyboardMove = (id: string, direction: 'up' | 'down') => (editor: Runtime): void => {
  const manager = editor.module.blockManager;

  manager.currentBlockIndex = indexOf(editor, id);
  if (direction === 'up') {
    manager.moveCurrentBlockUp();
  } else {
    manager.moveCurrentBlockDown();
  }
};

/**
 * Runs a move and checks the tree after it and after one undo.
 * @param blocks - initial document
 * @param act - the move
 * @param expected - flat order after the move
 */
const expectMove = async (
  blocks: OutputBlockData[],
  act: (editor: Runtime) => void,
  expected: string[]
): Promise<void> => {
  const editor = await boot(blocks);
  const before = flat(editor);

  act(editor);
  await settle();

  expect({ flat: flat(editor), problems: treeViolations(editor) }).toStrictEqual({ flat: expected, problems: [] });
  expect(await savedIds(editor)).toStrictEqual(expected.map(entry => entry.replace(' hidden', '')));

  editor.module.yjsManager.stopCapturing();
  editor.history.undo();
  await settle();

  expect({ flat: flat(editor), problems: treeViolations(editor) }, 'one undo').toStrictEqual({ flat: before, problems: [] });

  editor.history.redo();
  await settle();

  expect({ flat: flat(editor), problems: treeViolations(editor) }, 'one redo').toStrictEqual({ flat: expected, problems: [] });
  editor.destroy();
};

const TOGGLE_DOC = [P('a'), T('t', ['tc']), P('tc', 't'), P('b')];

describe('keyboard move (Cmd/Ctrl+Shift+Arrow) keeps tree order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('moves a block down past a toggle with children to after its last child', async () => {
    await expectMove(TOGGLE_DOC, keyboardMove('a', 'down'), ['t^-', 'tc^t', 'a^-', 'b^-']);
  }, 60_000);

  it('moves a toggle with children up past a block, children following it', async () => {
    await expectMove(TOGGLE_DOC, keyboardMove('t', 'up'), ['t^-', 'tc^t', 'a^-', 'b^-']);
  }, 60_000);

  it('moves a block down past a collapsed toggle without hiding it', async () => {
    await expectMove(
      [P('a'), T('t', ['tc'], false), P('tc', 't'), P('b')],
      keyboardMove('a', 'down'),
      ['t^-', 'tc^t hidden', 'a^-', 'b^-']
    );
  }, 60_000);

  it('reorders two children inside a toggle on screen as well as in the array', async () => {
    await expectMove(
      [P('a'), T('t', ['c1', 'c2']), P('c1', 't'), P('c2', 't'), P('b')],
      keyboardMove('c2', 'up'),
      ['a^-', 't^-', 'c2^t', 'c1^t', 'b^-']
    );
  }, 60_000);

  it('moves a nested toggle with content down past its sibling inside the parent toggle', async () => {
    await expectMove(
      [P('a'), T('t', ['n', 'x']), T('n', ['nc'], true, 't'), P('nc', 'n'), P('x', 't'), P('b')],
      keyboardMove('n', 'down'),
      ['a^-', 't^-', 'x^t', 'n^t', 'nc^n', 'b^-']
    );
  }, 60_000);

  it('moves a callout child down past a toggle with children inside the callout', async () => {
    await expectMove(
      [
        P('a'),
        { id: 'co', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
        P('k1', 'co'),
        T('k2', ['kk'], true, 'co'),
        P('kk', 'k2'),
        P('b'),
      ],
      keyboardMove('k1', 'down'),
      ['a^-', 'co^-', 'k2^co', 'kk^k2', 'k1^co', 'b^-']
    );
  }, 60_000);

  it('moves a block up past a toggle heading with a section', async () => {
    await expectMove(
      [
        P('a'),
        { id: 'h', type: 'header', data: { text: 'h', level: 2, isToggleable: true, isOpen: true }, content: ['hc'] },
        P('hc', 'h'),
        P('b'),
      ],
      keyboardMove('b', 'up'),
      ['a^-', 'b^-', 'h^-', 'hc^h']
    );
  }, 60_000);

  it('moves a block up past a toggle holding a nested list item by one sibling', async () => {
    await expectMove(
      [
        P('p0'),
        T('t', ['l']),
        { id: 'l', type: 'list', data: { text: 'item', style: 'unordered', depth: 2 }, parent: 't' },
        P('p1'),
      ],
      keyboardMove('p1', 'up'),
      ['p0^-', 'p1^-', 't^-', 'l^t']
    );
  }, 60_000);

  it('undoes a move past a list item with a nested item in one step', async () => {
    await expectMove(
      [
        P('a'),
        { id: 'x', type: 'list', data: { text: 'L1', style: 'unordered' }, content: ['xc'] },
        { id: 'xc', type: 'list', data: { text: 'L2', style: 'unordered', depth: 1 }, parent: 'x' },
        P('b'),
      ],
      keyboardMove('a', 'down'),
      ['x^-', 'xc^x', 'a^-', 'b^-']
    );
  }, 60_000);
});

/** id^parent per the shared document, in its flat order. */
const docOrder = (editor: Runtime): string[] =>
  editor.module.yjsManager.toJSON().map(block => `${block.id ?? ''}^${block.parent ?? '-'}`);

const apiMove = (id: string, toIndex: number) => (editor: Runtime): void => {
  editor.blocks.move(toIndex, indexOf(editor, id));
};

describe('public blocks.move keeps tree order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('a forward move into a toggle\'s first-child slot makes the block its first child', async () => {
    await expectMove(TOGGLE_DOC, apiMove('a', 1), ['t^-', 'a^t', 'tc^t', 'b^-']);
  }, 60_000);

  it('a backward move into a toggle\'s first-child slot makes the block its first child', async () => {
    await expectMove(TOGGLE_DOC, apiMove('b', 2), ['a^-', 't^-', 'b^t', 'tc^t']);
  }, 60_000);

  it('a forward move to just after a toggle\'s last child makes it the last child', async () => {
    await expectMove(TOGGLE_DOC, apiMove('a', 2), ['t^-', 'tc^t', 'a^t', 'b^-']);
  }, 60_000);

  it('a move out of a toggle to the end of the document leaves it', async () => {
    await expectMove(TOGGLE_DOC, apiMove('tc', 3), ['a^-', 't^-', 'b^-', 'tc^-']);
  }, 60_000);

  it('a move out of a collapsed toggle shows the block again', async () => {
    await expectMove([P('a'), T('t', ['tc'], false), P('tc', 't'), P('b')], apiMove('tc', 3), ['a^-', 't^-', 'b^-', 'tc^-']);
  }, 60_000);

  it('a move of a toggle child to the top of the document shows it first', async () => {
    await expectMove(
      [P('a'), T('t', ['c1', 'tc']), P('c1', 't'), P('tc', 't'), P('b')],
      apiMove('tc', 0),
      ['tc^-', 'a^-', 't^-', 'c1^t', 'b^-']
    );
  }, 60_000);

  it('a move into the block\'s own subtree changes nothing and does not throw', async () => {
    const editor = await boot(TOGGLE_DOC);
    const before = flat(editor);

    expect(() => apiMove('t', 2)(editor)).not.toThrow();
    await settle();

    expect({ flat: flat(editor), problems: treeViolations(editor) }).toStrictEqual({ flat: before, problems: [] });
    editor.destroy();
  }, 60_000);

  it('writes the adopted parent to the shared document', async () => {
    const editor = await boot(TOGGLE_DOC);

    apiMove('b', 2)(editor);
    await settle();

    expect(docOrder(editor)).toStrictEqual(['a^-', 't^-', 'b^t', 'tc^t']);
    editor.destroy();
  }, 60_000);
});

/** Sends everything `from` has that `to` lacks. */
const push = (from: Runtime, to: Runtime): void => {
  to.module.yjsManager.applyRemoteUpdate(from.module.yjsManager.encodeStateAsUpdate(to.module.yjsManager.getStateVector()));
};

describe('a peer replays a move with the same tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  const cases: Array<[string, (editor: Runtime) => void]> = [
    ['keyboard move down past a toggle with a child', keyboardMove('a', 'down')],
    ['keyboard move of a toggle with a child up', keyboardMove('t', 'up')],
    ['api move into a toggle\'s first-child slot', apiMove('a', 1)],
    ['api move out of a toggle', apiMove('tc', 3)],
  ];

  it.each(cases)('%s', async (_name, act) => {
    const author = await boot(TOGGLE_DOC);
    // The peer joins empty and takes the author's document.
    const peer = await boot([]);

    push(author, peer);
    await settle();

    act(author);
    await settle();
    push(author, peer);
    await settle();

    const shared = (editor: Runtime): string[] => flat(editor).filter(entry => /^(a|t|tc|b)\^/.test(entry));

    expect({ flat: shared(peer), problems: treeViolations(peer) }).toStrictEqual({ flat: shared(author), problems: [] });
    author.destroy();
    peer.destroy();
  }, 60_000);
});

/**
 * What DragController's drop does: one drag move group holding the flat move
 * and the reparent.
 */
const dragMove = (id: string, toIndex: number, parentId: string | null) => (editor: Runtime): void => {
  const manager = editor.module.blockManager;
  const block = manager.blocks[indexOf(editor, id)];

  editor.module.yjsManager.transactMoves(() => {
    manager.move(toIndex, indexOf(editor, id));
    manager.setBlockParent(block, parentId);
  }, true);
};

describe('undo of a drag-shaped move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('puts a toggle child dragged into another column back into its toggle', async () => {
    await expectMove(
      [
        P('a'),
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['tog'] },
        T('tog', ['tp'], true, 'c1'),
        P('tp', 'tog'),
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['q'] },
        P('q', 'c2'),
        P('z'),
      ],
      dragMove('tp', 6, 'c2'),
      ['a^-', 'cl^-', 'c1^cl', 'tog^c1', 'c2^cl', 'q^c2', 'tp^c2', 'z^-']
    );
  }, 60_000);
});
