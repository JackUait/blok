/**
 * Keyboard and menu paths that replace a block with children, or add a block
 * next to one. The save gate (`Saver.assertTreePlacement`) throws under
 * NODE_ENV=test, so `save()` resolving is the placement check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { CalloutTool } from '../../../../../src/tools/callout';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: {
      blocks: Block[];
      currentBlock: Block | undefined;
      replace: (block: Block, tool: string, data: Record<string, unknown>) => Block;
    };
    yjsManager: { stopCapturing: () => void; toJSON: () => OutputBlockData[] };
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

/** A block that may not hold paragraphs. */
class NoParagraphBox {
  public static childTools = { deny: ['paragraph'] };

  private readonly element = document.createElement('div');

  public render(): HTMLElement {
    this.element.contentEditable = 'true';

    return this.element;
  }

  public save(): { text: string } {
    return { text: this.element.innerHTML };
  }
}

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      toggle: ToggleItem,
      callout: CalloutTool,
      box: NoParagraphBox,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  // Tools run rendered() a frame after render; start from a settled tree.
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

/** `id^parent` for every block, in flat order. */
const flat = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`);

const editableOf = (id: string): HTMLElement => {
  const blockHolder = holder?.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);
  // jsdom does not reflect the contentEditable property to the attribute.
  const editable = Array.from(blockHolder?.querySelectorAll<HTMLElement>('*') ?? [])
    .find((element) => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) {
    throw new Error(`no editable for ${id}`);
  }

  // Browsers reflect it; the toolbox finds the editable by this attribute.
  editable.setAttribute('contenteditable', 'true');

  return editable;
};

const putCaretAtStart = (id: string): HTMLElement => {
  const editable = editableOf(id);
  const range = document.createRange();

  editable.focus();
  range.setStart(editable, 0);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);

  return editable;
};

const press = async (id: string, key: string): Promise<void> => {
  const editable = putCaretAtStart(id);

  editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await settle(50);
};

/** `id^parent` for every block in the shared document, in its order. */
const docFlat = (instance: TestEditor): string[] =>
  instance.module.yjsManager.toJSON().map(block => `${block.id}^${block.parent ?? '-'}`);

/** Undo replays across an animation frame. */
const undo = async (instance: TestEditor): Promise<void> => {
  instance.module.yjsManager.stopCapturing();
  instance.history.undo();
  await settle(50);
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle(50);
};

const redo = async (instance: TestEditor): Promise<void> => {
  instance.module.yjsManager.stopCapturing();
  instance.history.redo();
  await settle(50);
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle(50);
};

/** Click a toolbox entry, the way a pointer picks it. */
const pickFromToolbox = async (itemName: string): Promise<void> => {
  // Popovers of earlier editors stay in the body; the newest one is ours.
  const item = Array.from(document.querySelectorAll<HTMLElement>(
    `[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-item"][data-blok-item-name="${itemName}"]`
  )).at(-1);

  if (item === undefined) {
    throw new Error(`no toolbox item ${itemName}`);
  }

  const before = editor?.module.blockManager.blocks.map(block => block.id).join();

  item.click();
  await vi.waitFor(() => {
    expect(editor?.module.blockManager.blocks.map(block => block.id).join()).not.toBe(before);
  }, { timeout: 3000 });
  await settle(50);
};

const H = (id: string, content: string[], text = id, isOpen = true, parent?: string): OutputBlockData => ({
  id,
  type: 'header',
  data: { text, level: 2, isToggleable: true, isOpen },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const T = (id: string, content: string[], text = id, isOpen = true, parent?: string): OutputBlockData => ({
  id,
  type: 'toggle',
  data: { text, isOpen },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

// Data as the callout saves it: other data makes undo rebuild the callout.
const CALLOUT = (content: string[]): OutputBlockData => ({
  id: 'C',
  type: 'callout',
  data: { emoji: '💡', textColor: null, backgroundColor: null },
  content,
});

const P = (id: string, parent?: string, text = id): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text },
  ...(parent !== undefined ? { parent } : {}),
});

describe('container replace and Enter paths keep the tree in order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    await settle();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('slash menu on an empty toggle title with a child', () => {
    it('keeps the child nested under the new block', async () => {
      const instance = await boot([T('t', ['c'], ''), P('c', 't', ''), P('z')]);

      await press('t', '/');
      await pickFromToolbox('header-2');

      await expect(instance.save()).resolves.toBeDefined();
      const [first] = instance.module.blockManager.blocks;

      expect(first.name).toBe('header');
      expect(flat(instance)).toEqual([`${first.id}^-`, `c^${first.id}`, 'z^-']);
      expect(docFlat(instance)).toEqual(flat(instance));

      await undo(instance);

      expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);
      expect(instance.module.blockManager.blocks[0].name).toBe('toggle');
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('slash menu on an empty toggle heading title with a child', () => {
    it('a plain heading moves the child up beside it, like Turn into does', async () => {
      const instance = await boot([H('h', ['c'], ''), P('c', 'h'), P('z')]);

      await press('h', '/');
      await pickFromToolbox('header-2');

      await expect(instance.save()).resolves.toBeDefined();
      const [first] = instance.module.blockManager.blocks;

      expect(flat(instance)).toEqual([`${first.id}^-`, 'c^-', 'z^-']);
      expect(docFlat(instance)).toEqual(flat(instance));

      await undo(instance);

      expect(flat(instance)).toEqual(['h^-', 'c^h', 'z^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('inside a callout moves the child up into the callout', async () => {
      const instance = await boot([
        CALLOUT(['h', 'Q']),
        H('h', ['c'], '', true, 'C'),
        P('c', 'h'),
        P('Q', 'C'),
      ]);

      await press('h', '/');
      await pickFromToolbox('header-2');

      await expect(instance.save()).resolves.toBeDefined();
      const second = instance.module.blockManager.blocks[1];

      expect(flat(instance)).toEqual(['C^-', `${second.id}^C`, 'c^C', 'Q^C']);
      expect(docFlat(instance)).toEqual(flat(instance));

      await undo(instance);

      expect(flat(instance)).toEqual(['C^-', 'h^C', 'c^h', 'Q^C']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('slash menu picks a container for an empty toggle title with a child', () => {
    // The callout's rendered() adds its first line to the doc before
    // block-insertion adds the callout itself, so the line gets no order slot.
    it('a callout on an empty root line puts its own first line after it in the shared document', async () => {
      const instance = await boot([P('a', undefined, ''), P('z')]);

      await press('a', '/');
      await pickFromToolbox('callout');

      await expect(instance.save()).resolves.toBeDefined();
      const [callout, seeded] = instance.module.blockManager.blocks;

      expect(flat(instance)).toEqual([`${callout.id}^-`, `${seeded.id}^${callout.id}`, 'z^-']);
      expect(docFlat(instance)).toEqual(flat(instance));
    }, 30_000);

    it('a callout takes the child after its own first line', async () => {
      const instance = await boot([T('t', ['c'], ''), P('c', 't'), P('z')]);

      await press('t', '/');
      await pickFromToolbox('callout');

      await expect(instance.save()).resolves.toBeDefined();
      const [callout, seeded] = instance.module.blockManager.blocks;

      expect(callout.name).toBe('callout');
      expect(flat(instance)).toEqual([`${callout.id}^-`, `${seeded.id}^${callout.id}`, `c^${callout.id}`, 'z^-']);
      // Doc order is not checked: a slash-made callout's own first line already lands last there.
      expect([...docFlat(instance)].sort()).toEqual([...flat(instance)].sort());

      await undo(instance);

      expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('Backspace on an empty toggle title with a child', () => {
    it('toggle list turns into text and keeps the child nested', async () => {
      const instance = await boot([T('t', ['c'], ''), P('c', 't'), P('z')]);

      await press('t', 'Backspace');
      await vi.waitFor(() => {
        expect(instance.module.blockManager.blocks[0].name).toBe('paragraph');
      });

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);

      await undo(instance);

      expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);
      expect(instance.module.blockManager.blocks[0].name).toBe('toggle');
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('toggle heading inside a callout releases the child into the callout', async () => {
      const instance = await boot([
        CALLOUT(['S', 'Q']),
        H('S', ['K'], '', true, 'C'),
        P('K', 'S', 'kid'),
        P('Q', 'C'),
      ]);

      await press('S', 'Backspace');

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['C^-', 'S^C', 'K^C', 'Q^C']);
      expect(docFlat(instance)).toEqual(flat(instance));

      await undo(instance);

      expect(flat(instance)).toEqual(['C^-', 'S^C', 'K^S', 'Q^C']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  describe('Enter at the start of a toggle title with a child', () => {
    for (const [kind, make] of [['toggle list', T], ['toggle heading', H]] as const) {
      for (const isOpen of [true, false]) {
        it(`${kind}, ${isOpen ? 'open' : 'collapsed'}: adds an empty block above and keeps the caret in the title`, async () => {
          const instance = await boot([P('a'), make('t', ['c'], 'title', isOpen), P('c', 't'), P('z')]);

          await press('t', 'Enter');

          await expect(instance.save()).resolves.toBeDefined();
          const ids = flat(instance);

          expect(ids.slice(2)).toEqual(['t^-', 'c^t', 'z^-']);
          expect(ids[0]).toBe('a^-');
          expect(ids[1]).toMatch(/\^-$/);
          expect(editableOf('t').contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
          expect(editableOf('t').textContent).toBe('title');

          await undo(instance);

          expect(flat(instance)).toEqual(['a^-', 't^-', 'c^t', 'z^-']);
        }, 30_000);
      }
    }
  });

  describe('BlockManager.replace (markdown shortcuts, heading Backspace, multi-block Turn into) on a block with a child', () => {
    it('a toggle heading turned into text moves the child up beside it, like Turn into does', async () => {
      const instance = await boot([H('h', ['c'], 'title'), P('c', 'h'), P('z')]);
      const [heading] = instance.module.blockManager.blocks;

      instance.module.blockManager.replace(heading, 'paragraph', { text: 'title' });
      await settle(50);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['h^-', 'c^-', 'z^-']);
      expect(docFlat(instance)).toEqual(flat(instance));

      await undo(instance);

      expect(flat(instance)).toEqual(['h^-', 'c^h', 'z^-']);
      expect(instance.module.blockManager.blocks[0].name).toBe('header');
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);

    it('a child the new block may not hold moves up beside it', async () => {
      const instance = await boot([{ ...P('p'), content: ['c'] }, P('c', 'p'), P('z')]);
      const [paragraph] = instance.module.blockManager.blocks;

      instance.module.blockManager.replace(paragraph, 'box', { text: 'p' });
      await settle(50);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['p^-', 'c^-', 'z^-']);
      expect(docFlat(instance)).toEqual(flat(instance));
    }, 30_000);

    it('a toggle list turned into text keeps the child nested', async () => {
      const instance = await boot([T('t', ['c'], 'title'), P('c', 't'), P('z')]);
      const [toggle] = instance.module.blockManager.blocks;

      instance.module.blockManager.replace(toggle, 'paragraph', { text: 'title' });
      await settle(50);

      await expect(instance.save()).resolves.toBeDefined();
      expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);
      expect(docFlat(instance)).toEqual(flat(instance));

      await undo(instance);

      expect(instance.module.blockManager.blocks[0].name).toBe('toggle');
      expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });

  it('Enter at the start of a toggle title inside a callout adds the empty block inside the callout', async () => {
    const instance = await boot([CALLOUT(['t', 'Q']), T('t', ['c'], 'title', true, 'C'), P('c', 't'), P('Q', 'C')]);

    await press('t', 'Enter');

    await expect(instance.save()).resolves.toBeDefined();
    const added = instance.module.blockManager.blocks[1];

    expect(flat(instance)).toEqual(['C^-', `${added.id}^C`, 't^C', 'c^t', 'Q^C']);
  }, 30_000);

  it('undo and redo of a toggle list turned into a toggle heading keep the child on screen', async () => {
    const instance = await boot([T('t', ['c'], 'title'), P('c', 't'), P('z')]);

    await instance.blocks.convert('t', 'header', { text: 'title', level: 2, isToggleable: true });
    await settle(50);
    instance.module.yjsManager.stopCapturing();
    await expect(instance.save()).resolves.toBeDefined();

    await undo(instance);

    await expect(instance.save()).resolves.toBeDefined();
    expect(instance.module.blockManager.blocks[0].name).toBe('toggle');
    expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);

    await redo(instance);

    await expect(instance.save()).resolves.toBeDefined();
    expect(instance.module.blockManager.blocks[0].name).toBe('header');
    expect(flat(instance)).toEqual(['t^-', 'c^t', 'z^-']);
  }, 30_000);

  describe('known defects outside the replace paths', () => {
    it('deleting a toggle heading keeps a grandchild under a plain heading on screen', async () => {
      const instance = await boot([
        H('h', ['p']),
        { id: 'p', type: 'header', data: { text: 'plain', level: 3 }, parent: 'h', content: ['k'] },
        P('k', 'p'),
        P('z'),
      ]);

      await instance.blocks.delete(0, false);
      await settle(50);

      expect(flat(instance)).toEqual(['p^-', 'k^p', 'z^-']);
      await expect(instance.save()).resolves.toBeDefined();
    }, 30_000);
  });
});

