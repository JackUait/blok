import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import type { Block } from '../../../src/components/block';
import type { BlockSelection } from '../../../src/components/modules/blockSelection';
import { Paragraph } from '../../../src/tools/paragraph';
import { ToggleItem } from '../../../src/tools/toggle';
import type { BlockTool, OutputBlockData, OutputData } from '../../../types';

/**
 * Core's side of the "not page content" lever, on a real editor. The tool is
 * a host tool on purpose: core must read the static, never a block name.
 */
class Note implements BlockTool {
  public static isAnnotation = true;
  private readonly text: string;

  constructor({ data }: { data: { text?: string } }) {
    this.text = data.text ?? '';
  }

  public render(): HTMLElement {
    const el = document.createElement('div');

    el.textContent = this.text;

    return el;
  }

  public save(): { text: string } {
    return { text: this.text };
  }
}

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  module: {
    blockManager: { blocks: Block[]; currentBlockIndex: number; nextVisibleBlock: Block | null; getBlockById: (id: string) => Block | undefined };
    blockSelection: BlockSelection;
    dragManager: { duplicateBlocksInPlace: (block: Block) => Promise<Block[]> };
  };
}

const doc = (): OutputBlockData[] => [
  { id: 'p1', type: 'paragraph', data: { text: 'first' } },
  { id: 't1', type: 'toggle', data: { text: 'section' }, content: ['b1', 'n1'] },
  { id: 'b1', type: 'paragraph', parent: 't1', data: { text: 'inside' } },
  { id: 'n1', type: 'note', parent: 't1', data: { text: 'note secret' }, content: ['n2'] },
  { id: 'n2', type: 'note', parent: 'n1', data: { text: 'reply secret' } },
  { id: 'p2', type: 'paragraph', data: { text: 'last' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[] = doc()): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, toggle: ToggleItem, note: Note },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;

  return editor;
};

const holderOf = (id: string): HTMLElement | null =>
  holder?.querySelector<HTMLElement>(`[data-blok-element][data-blok-id="${id}"]`) ?? null;

const recordingEvent = (written: Map<string, string>): ClipboardEvent => ({
  preventDefault: () => undefined,
  clipboardData: {
    setData: (type: string, value: string): void => {
      written.set(type, value);
    },
  },
}) as unknown as ClipboardEvent;

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

describe('isAnnotation: a block that is not page content', () => {
  it('renders the holder hidden and marked', async () => {
    await make();

    expect(holderOf('n1')?.hidden).toBe(true);
    expect(holderOf('n1')?.hasAttribute('data-blok-annotation')).toBe(true);
    expect(holderOf('b1')?.hidden).toBe(false);
  });

  it('skips the annotation and its replies when moving to the next visible block', async () => {
    const { module } = await make([
      { id: 'p1', type: 'paragraph', data: { text: 'first' } },
      { id: 'n1', type: 'note', data: { text: 'note secret' }, content: ['n2'] },
      { id: 'n2', type: 'note', parent: 'n1', data: { text: 'reply secret' } },
      { id: 'p2', type: 'paragraph', data: { text: 'last' } },
    ]);

    expect(module.blockManager.blocks.map((block) => block.id)).toEqual(['p1', 'n1', 'n2', 'p2']);
    module.blockManager.currentBlockIndex = 0;

    expect(module.blockManager.nextVisibleBlock?.id).toBe('p2');
  });

  it('is never selected by select-all', async () => {
    const { module } = await make();

    module.blockSelection.allBlocksSelected = true;

    expect(module.blockManager.getBlockById('n1')?.selected).toBe(false);
    expect(module.blockManager.getBlockById('n2')?.selected).toBe(false);
    expect(module.blockManager.getBlockById('b1')?.selected).toBe(true);
  });

  it('stays out of a copied container', async () => {
    const { module } = await make();
    const written = new Map<string, string>();
    const toggle = module.blockManager.getBlockById('t1');

    if (toggle === undefined) throw new Error('no toggle');
    module.blockSelection.selectBlock(toggle);
    await module.blockSelection.copySelectedBlocks(recordingEvent(written));

    expect(written.get('application/x-blok') ?? '').not.toContain('secret');
    expect(written.get('text/html') ?? '').not.toContain('secret');
    expect(written.get('text/html') ?? '').toContain('inside');
  });

  it('stays out of a duplicated container', async () => {
    const { module, save } = await make();
    const toggle = module.blockManager.getBlockById('t1');

    if (toggle === undefined) throw new Error('no toggle');
    await module.dragManager.duplicateBlocksInPlace(toggle);
    const saved = await save();

    expect(saved.blocks.filter((block) => block.type === 'note')).toHaveLength(2);
    const copy = saved.blocks.find((block) => block.type === 'toggle' && block.id !== 't1');

    expect(copy?.content).toHaveLength(1);
  });

  it('is saved with its replies', async () => {
    const { save } = await make();
    const saved = await save();
    const note = saved.blocks.find((block) => block.id === 'n1');

    expect(note).toMatchObject({ type: 'note', parent: 't1', data: { text: 'note secret' }, content: ['n2'] });
    expect(saved.blocks.find((block) => block.id === 'n2')).toMatchObject({ parent: 'n1' });
    expect(saved.blocks.find((block) => block.id === 't1')?.content).toEqual(['b1', 'n1']);
  });

  it('hides a built-in comment block even where its tool is not registered, and saves it back', async () => {
    const { save } = await make([
      { id: 'p1', type: 'paragraph', data: { text: 'first' } },
      { id: 'k1', type: 'database-comment', data: { text: 'stub secret', createdAt: 1 } },
    ]);

    expect(holderOf('k1')?.hidden).toBe(true);
    expect(holderOf('k1')?.hasAttribute('data-blok-annotation')).toBe(true);
    expect((await save()).blocks.find((block) => block.id === 'k1')).toMatchObject({ type: 'database-comment', data: { text: 'stub secret' } });
  });
});
