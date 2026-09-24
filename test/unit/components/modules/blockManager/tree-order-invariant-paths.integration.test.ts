/**
 * Public paths that used to leave the flat block array out of depth-first
 * order, or a holder outside its home slot. The save gate
 * (`Saver.assertTreePlacement`) throws under NODE_ENV=test, so `save()`
 * resolving is the placement check; the flat ids pin where the block went.
 * After every test the flat array must also be the contentIds tree walk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { validateTreeOrder } from '../../../../../src/components/utils/hierarchy-invariant';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { ColumnList } from '../../../../../src/tools/column-list';
import { ListItem } from '../../../../../src/tools/list';
import { CalloutTool } from '../../../../../src/tools/callout';
import { Column } from '../../../../../src/tools/column';
import { addColumnToList, wrapInNewColumnList } from '../../../../../src/tools/column-drop';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  caret: API['caret'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: {
      blocks: Block[];
      currentBlockIndex: number;
      replace: (block: Block, tool: string, data: Record<string, unknown>) => Block;
      moveCurrentBlockUp: () => void;
      moveCurrentBlockDown: () => void;
    };
    blockSelection: { selectBlock: (block: Block) => void };
    blockEvents: { keydown: (event: KeyboardEvent) => void };
    dragManager: { duplicateBlocksInPlace: (block: Block) => Promise<Block[]> };
    yjsManager: { stopCapturing: () => void; toJSON: () => OutputBlockData[] };
  };
}

const P = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...(parent !== undefined ? { parent } : {}),
});

const T = (id: string, content: string[], parent?: string, isOpen = true): OutputBlockData => ({
  id,
  type: 'toggle',
  data: { text: id, isOpen },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

/** A slotless container that refuses headers as children. */
class HeaderlessBox {
  public static get childTools(): { deny: string[] } {
    return { deny: ['header'] };
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.contentEditable = 'true';

    return element;
  }

  public save(): Record<string, never> {
    return {};
  }
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      header: Header,
      toggle: ToggleItem,
      column_list: ColumnList,
      column: Column,
      box: HeaderlessBox,
      list: ListItem,
      callout: CalloutTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

/** `id^parent` for every block, in flat order. */
const flat = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`);

const holderOf = (id: string): HTMLElement => {
  const element = holder?.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);

  if (element === null || element === undefined) {
    throw new Error(`no holder for ${id}`);
  }

  return element;
};

describe('tree order on public paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    const blocks = editor?.module.blockManager.blocks ?? [];

    expect(validateTreeOrder(blocks).map(drift => drift.message)).toEqual([]);
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('blocks.insert at a flat index inside a container', () => {
    it('between two toggle children makes the block a toggle child there', async () => {
      const instance = await boot([T('t', ['c1', 'c2']), P('c1', 't'), P('c2', 't'), P('z')]);

      instance.blocks.insert('paragraph', { text: 'new' }, undefined, 2, false, false, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'new^t', 'c2^t', 'z^-']);
      expect(instance.blocks.getBlockIndex('new')).toBe(2);
    }, 30_000);

    it('right after a toggle with children makes the block its first child', async () => {
      const instance = await boot([T('t', ['c1']), P('c1', 't'), P('z')]);

      instance.blocks.insert('paragraph', { text: 'new' }, undefined, 1, false, false, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'new^t', 'c1^t', 'z^-']);
    }, 30_000);

    it('after the last child of a toggle that ends the document lands at the root', async () => {
      const instance = await boot([P('a'), T('t', ['c1']), P('c1', 't')]);

      instance.blocks.insert('paragraph', { text: 'new' }, undefined, 3, false, false, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t', 'new^-']);
      expect(holderOf('new').parentElement?.hasAttribute('data-blok-toggle-children')).toBe(false);
    }, 30_000);

    it('after a collapsed toggle heading at the end of the document stays visible at the root', async () => {
      const instance = await boot([
        P('a'),
        { id: 'h', type: 'header', data: { text: 'h', level: 2, isToggleable: true, isOpen: false }, content: ['hc'] },
        P('hc', 'h'),
      ]);

      instance.blocks.insert('paragraph', { text: 'new' }, undefined, 3, false, false, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['a^-', 'h^-', 'hc^h', 'new^-']);
      expect(holderOf('new').classList.contains('hidden')).toBe(false);
    }, 30_000);

    it('right after a collapsed toggle goes after its hidden children, still visible', async () => {
      const instance = await boot([T('t', ['c1'], undefined, false), P('c1', 't'), P('z')]);

      instance.blocks.insert('paragraph', { text: 'new' }, undefined, 1, false, false, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(holderOf('new').classList.contains('hidden')).toBe(false);
      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'new^-', 'z^-']);
    }, 30_000);

    it('after a toggle child inside a column joins the column, never the column row', async () => {
      const instance = await boot([
        { id: 'cl', type: 'column_list', data: {}, content: ['col1', 'col2'] },
        { id: 'col1', type: 'column', data: {}, parent: 'cl', content: ['t'] },
        T('t', ['c1'], 'col1'),
        P('c1', 't'),
        { id: 'col2', type: 'column', data: {}, parent: 'cl', content: ['c2p'] },
        P('c2p', 'col2'),
        P('z'),
      ]);

      instance.blocks.insert('paragraph', { text: 'new' }, undefined, 4, false, false, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['cl^-', 'col1^cl', 't^col1', 'c1^t', 'new^col1', 'col2^cl', 'c2p^col2', 'z^-']);
    }, 30_000);
  });

  describe('blocks.insert and child tool restrictions', () => {
    it('still demotes a denied tool appended at the end of a container that the caller then nests', async () => {
      const instance = await boot([{ id: 'box', type: 'box', data: {}, content: ['c1'] }, P('c1', 'box'), P('z')]);

      const inserted = instance.blocks.insert('header', { text: 'h', level: 2 }, undefined, 2, false, false, 'new');

      instance.blocks.setBlockParent(inserted.id, 'box');

      expect(instance.blocks.getById('new')?.name).toBe('paragraph');
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('blocks.move to index 0', () => {
    it('puts a grandchild at the root, not in its grandparent slot', async () => {
      const instance = await boot([T('t', ['u']), T('u', ['u1'], 't'), P('u1', 'u'), P('z')]);

      instance.blocks.move(0, 2);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['u1^-', 't^-', 'u^t', 'z^-']);
    }, 30_000);
  });

  describe('blocks.setBlockParent', () => {
    it('moves a block that sits before the new parent to the end of its subtree', async () => {
      const instance = await boot([P('b'), T('t', ['c1']), P('c1', 't'), P('z')]);

      instance.blocks.setBlockParent('b', 't');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'b^t', 'z^-']);
    }, 30_000);

    it('keeps the current block current when the move shifts its index', async () => {
      const instance = await boot([P('b'), T('t', ['c1']), P('c1', 't'), P('z')]);

      instance.caret.setToBlock('c1', 'end');
      expect(instance.blocks.getCurrentBlockIndex()).toBe(2);

      instance.blocks.setBlockParent('b', 't');

      expect(instance.blocks.getBlockByIndex(instance.blocks.getCurrentBlockIndex())?.id).toBe('c1');
    }, 30_000);

    it('carries the moved block\'s own children along', async () => {
      const instance = await boot([T('b', ['bc']), P('bc', 'b'), P('mid'), T('t', ['c1']), P('c1', 't'), P('z')]);

      instance.blocks.setBlockParent('b', 't');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['mid^-', 't^-', 'c1^t', 'b^t', 'bc^b', 'z^-']);
    }, 30_000);

    it('is undone in one step back to the original order', async () => {
      const instance = await boot([P('b'), T('t', ['c1']), P('c1', 't'), P('z')]);

      instance.blocks.setBlockParent('b', 't');
      instance.history.undo();
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['b^-', 't^-', 'c1^t', 'z^-']);
    }, 30_000);

    it('moves a first child sent to the root to right after its old parent\'s subtree', async () => {
      const instance = await boot([T('t', ['c1', 'c2']), P('c1', 't'), P('c2', 't'), P('z')]);

      instance.blocks.setBlockParent('c1', null);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c2^t', 'c1^-', 'z^-']);
      expect(instance.module.yjsManager.toJSON().map(block => block.id)).toEqual(['t', 'c2', 'c1', 'z']);
    }, 30_000);

    it('moves a grandchild sent to its grandparent to after its old parent\'s subtree, with its children', async () => {
      const instance = await boot([
        T('t', ['u', 'w']),
        T('u', ['g', 'h'], 't'),
        T('g', ['gc'], 'u'),
        P('gc', 'g'),
        P('h', 'u'),
        P('w', 't'),
        P('z'),
      ]);

      instance.blocks.setBlockParent('g', 't');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'u^t', 'h^u', 'g^t', 'gc^g', 'w^t', 'z^-']);
    }, 30_000);

    it('leaves a last child sent to the root where it is', async () => {
      const instance = await boot([T('t', ['c1', 'c2']), P('c1', 't'), P('c2', 't'), P('z')]);

      instance.blocks.setBlockParent('c2', null);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'c2^-', 'z^-']);
    }, 30_000);

    it('undoes a move to the root in one step back to the original order', async () => {
      const instance = await boot([T('t', ['c1', 'c2']), P('c1', 't'), P('c2', 't'), P('z')]);

      instance.blocks.setBlockParent('c1', null);
      instance.history.undo();
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'c2^t', 'z^-']);
    }, 30_000);
  });

  describe('several siblings leaving a container keep their order', () => {
    const toggleHeading = (id: string, content: string[]): OutputBlockData => ({
      id,
      type: 'header',
      data: { text: id, level: 2, isToggleable: true, isOpen: true },
      content,
    });

    it('turning a toggle heading into a paragraph releases its children in order', async () => {
      const instance = await boot([toggleHeading('h', ['c1', 'c2', 'c3']), P('c1', 'h'), P('c2', 'h'), P('c3', 'h'), P('z')]);

      await instance.blocks.convert('h', 'paragraph');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance).slice(1)).toEqual(['c1^-', 'c2^-', 'c3^-', 'z^-']);
    }, 30_000);

    it('replacing a toggle heading with a paragraph releases its children in order', async () => {
      const instance = await boot([toggleHeading('h', ['c1', 'c2', 'c3']), P('c1', 'h'), P('c2', 'h'), P('c3', 'h'), P('z')]);

      instance.blocks.insert('paragraph', { text: 'h' }, undefined, 0, false, true, 'new');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['new^-', 'c1^-', 'c2^-', 'c3^-', 'z^-']);
    }, 30_000);

    it('a markdown-style replace of a toggle heading releases its children in order', async () => {
      const instance = await boot([toggleHeading('h', ['c1', 'c2', 'c3']), P('c1', 'h'), P('c2', 'h'), P('c3', 'h'), P('z')]);
      const heading = instance.module.blockManager.blocks[0];

      instance.module.blockManager.replace(heading, 'paragraph', { text: 'h' });

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance).slice(1)).toEqual(['c1^-', 'c2^-', 'c3^-', 'z^-']);
    }, 30_000);

    it('Shift+Tab on two selected toggle children outdents them in order', async () => {
      const instance = await boot([T('t', ['c1', 'c2', 'c3']), P('c1', 't'), P('c2', 't'), P('c3', 't'), P('z')]);
      const [, c1, c2] = instance.module.blockManager.blocks;

      instance.module.blockSelection.selectBlock(c1);
      instance.module.blockSelection.selectBlock(c2);
      instance.module.blockEvents.keydown(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, shiftKey: true, bubbles: true }));

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c1^-', 'c2^-', 'c3^c2', 'z^-']);
    }, 30_000);

    it('Shift+Tab on two selected nested list items outdents them in order', async () => {
      const L = (id: string, content: string[], parent?: string): OutputBlockData => ({
        id,
        type: 'list',
        data: { text: id, style: 'unordered' },
        ...(content.length > 0 ? { content } : {}),
        ...(parent !== undefined ? { parent } : {}),
      });
      const instance = await boot([L('l', ['l1', 'l2', 'l3']), L('l1', [], 'l'), L('l2', [], 'l'), L('l3', [], 'l'), P('z')]);
      const [, l1, l2] = instance.module.blockManager.blocks;

      instance.module.blockSelection.selectBlock(l1);
      instance.module.blockSelection.selectBlock(l2);
      instance.module.blockEvents.keydown(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, shiftKey: true, bubbles: true }));

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['l^-', 'l3^l', 'l1^-', 'l2^-', 'z^-']);
    }, 30_000);

    it('deleting a column unwraps the surviving column\'s blocks in order', async () => {
      const instance = await boot([
        { id: 'cl', type: 'column_list', data: {}, content: ['col1', 'col2'] },
        { id: 'col1', type: 'column', data: {}, parent: 'cl', content: ['x1', 'x2', 'x3'] },
        P('x1', 'col1'),
        P('x2', 'col1'),
        P('x3', 'col1'),
        { id: 'col2', type: 'column', data: {}, parent: 'cl', content: ['y'] },
        P('y', 'col2'),
        P('z'),
      ]);

      await instance.blocks.delete(instance.blocks.getBlockIndex('col2'), false);
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['x1^-', 'x2^-', 'x3^-', 'z^-']);
    }, 30_000);
  });

  describe('duplicating a container copies exactly its children', () => {
    const frame = (): Promise<void> => new Promise(resolve => {
      requestAnimationFrame(() => resolve());
    });

    const containers: Array<[string, OutputBlockData]> = [
      ['toggle', T('box', ['c1', 'c2'])],
      ['callout', { id: 'box', type: 'callout', data: { emoji: '' }, content: ['c1', 'c2'] }],
    ];

    it.each(containers)('a %s with two children', async (_name, container) => {
      const instance = await boot([container, P('c1', 'box'), P('c2', 'box'), P('z')]);
      const [box] = instance.module.blockManager.blocks;

      const copies = await instance.module.dragManager.duplicateBlocksInPlace(box);

      await settle();
      await frame();
      await frame();

      expect(copies).toHaveLength(3);
      expect(instance.module.blockManager.blocks).toHaveLength(7);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('column side-drop', () => {
    it('wrapping a block beside another keeps the block between them outside the columns', async () => {
      const instance = await boot([P('a'), P('m'), P('b')]);

      const listId = wrapInNewColumnList(instance as unknown as API, 'a', ['b'], 'right');

      await expect(instance.save()).resolves.toBeDefined();
      const [first, second] = instance.blocks.getChildren(String(listId)).map(column => column.id);

      expect(flat(instance)).toEqual([
        `${String(listId)}^-`, `${first}^${String(listId)}`, `a^${first}`, `${second}^${String(listId)}`, `b^${second}`, 'm^-',
      ]);
    }, 30_000);

    it('undoes the wrap in one step back to the original order', async () => {
      const instance = await boot([P('a'), P('m'), P('b')]);

      wrapInNewColumnList(instance as unknown as API, 'a', ['b'], 'right');
      instance.history.undo();
      await settle();

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['a^-', 'm^-', 'b^-']);
    }, 30_000);

    it('adding a column beside an existing one moves the dragged block into it', async () => {
      const instance = await boot([
        { id: 'cl', type: 'column_list', data: {}, content: ['col1', 'col2'] },
        { id: 'col1', type: 'column', data: {}, parent: 'cl', content: ['p1'] },
        P('p1', 'col1'),
        { id: 'col2', type: 'column', data: {}, parent: 'cl', content: ['p2'] },
        P('p2', 'col2'),
        P('m'),
        P('x'),
      ]);

      const columnId = addColumnToList(instance as unknown as API, 'col1', ['x'], 'right');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual([
        'cl^-', 'col1^cl', 'p1^col1', `${String(columnId)}^cl`, `x^${String(columnId)}`, 'col2^cl', 'p2^col2', 'm^-',
      ]);
    }, 30_000);
  });

  describe('loading a document that is not depth-first', () => {
    it('puts a child listed before its parent right after the parent', async () => {
      const instance = await boot([P('c1', 't'), T('t', ['c1']), P('z')]);

      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'z^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('pulls a child split from its parent back under it', async () => {
      const instance = await boot([T('t', ['c1', 'c2']), P('z'), P('c2', 't'), P('c1', 't')]);

      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'c2^t', 'z^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('keeps children missing from content in input order after the listed ones', async () => {
      const instance = await boot([T('t', ['c2']), P('z'), P('c1', 't'), P('c2', 't')]);

      expect(flat(instance)).toEqual(['t^-', 'c2^t', 'c1^t', 'z^-']);
      expect(instance.module.yjsManager.toJSON().map(block => block.id)).toEqual(['t', 'c2', 'c1', 'z']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('blocks.insertInsideParent with an index outside the parent subtree', () => {
    it('puts the child after its parent when given the parent index', async () => {
      const instance = await boot([P('a'), T('t', ['c1']), P('c1', 't'), P('z')]);

      instance.blocks.insertInsideParent('t', 1, { text: 'new' }, undefined, { id: 'new' });

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['a^-', 't^-', 'new^t', 'c1^t', 'z^-']);
    }, 30_000);

    it('puts the child at the end of the subtree when given an index past it', async () => {
      const instance = await boot([T('t', ['c1']), P('c1', 't'), P('z'), P('y')]);

      instance.blocks.insertInsideParent('t', 4, { text: 'new' }, undefined, { id: 'new' });

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c1^t', 'new^t', 'z^-', 'y^-']);
    }, 30_000);
  });
  describe('a same-parent reorder keeps the public contentIds in step with getChildren', () => {
    const publicOrder = (instance: TestEditor, parentId: string): { contentIds: string[]; children: string[] } => ({
      contentIds: [...(instance.blocks.getById(parentId)?.contentIds ?? [])],
      children: instance.blocks.getChildren(parentId).map(child => child.id),
    });
    const threeChildren = (): OutputBlockData[] => [T('t', ['c1', 'c2', 'c3']), P('c1', 't'), P('c2', 't'), P('c3', 't'), P('z')];

    it('keyboard move up of the last child', async () => {
      const instance = await boot(threeChildren());

      instance.module.blockManager.currentBlockIndex = 3;
      instance.module.blockManager.moveCurrentBlockUp();

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c1', 'c3', 'c2'], children: ['c1', 'c3', 'c2'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('keyboard move down of the first child', async () => {
      const instance = await boot(threeChildren());

      instance.module.blockManager.currentBlockIndex = 1;
      instance.module.blockManager.moveCurrentBlockDown();

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c2', 'c1', 'c3'], children: ['c2', 'c1', 'c3'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('blocks.move of the last child to the first child index', async () => {
      const instance = await boot(threeChildren());

      instance.blocks.move(1, 3);

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c3', 'c1', 'c2'], children: ['c3', 'c1', 'c2'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('blocks.moveTo the start of the same parent', async () => {
      const instance = await boot(threeChildren());

      instance.blocks.moveTo('c3', { parentId: 't', position: 'start' });

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c3', 'c1', 'c2'], children: ['c3', 'c1', 'c2'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('undo and redo of a keyboard move up', async () => {
      const instance = await boot(threeChildren());

      instance.module.blockManager.currentBlockIndex = 3;
      instance.module.blockManager.moveCurrentBlockUp();
      instance.module.yjsManager.stopCapturing();
      instance.history.undo();
      await settle();

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c1', 'c2', 'c3'], children: ['c1', 'c2', 'c3'] });

      instance.history.redo();
      await settle();

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c1', 'c3', 'c2'], children: ['c1', 'c3', 'c2'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('keyboard move up of two selected children', async () => {
      const instance = await boot(threeChildren());
      const [, , c2, c3] = instance.module.blockManager.blocks;

      instance.module.blockSelection.selectBlock(c2);
      instance.module.blockSelection.selectBlock(c3);
      instance.module.blockManager.currentBlockIndex = 2;
      instance.module.blockManager.moveCurrentBlockUp();

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c2', 'c3', 'c1'], children: ['c2', 'c3', 'c1'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('keyboard move up of a callout child that has its own children', async () => {
      const instance = await boot([
        { id: 'k', type: 'callout', data: { emoji: '' }, content: ['k1', 'k2'] },
        P('k1', 'k'),
        T('k2', ['g'], 'k'),
        P('g', 'k2'),
        P('z'),
      ]);

      instance.module.blockManager.currentBlockIndex = 2;
      instance.module.blockManager.moveCurrentBlockUp();

      expect(publicOrder(instance, 'k')).toEqual({ contentIds: ['k2', 'k1'], children: ['k2', 'k1'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('blocks.moveTo after a sibling in the same parent', async () => {
      const instance = await boot(threeChildren());

      instance.blocks.moveTo('c1', { position: { after: 'c2' } });

      expect(publicOrder(instance, 't')).toEqual({ contentIds: ['c2', 'c1', 'c3'], children: ['c2', 'c1', 'c3'] });
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });
});
