/**
 * A block inserted with a placement must already sit under its parent, in
 * the parent's child slot, when its tool's first rendered() runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { API, BlockToolConstructorOptions, OutputBlockData } from '../../../../../types';

interface Seen {
  parentId: string | null;
  holderIn: string;
}

const seen = new Map<string, Seen>();

/** Records where its holder is and what parentId it has on its first rendered(). */
class Probe {
  private readonly element: HTMLElement;
  private readonly blockId: string;
  private readonly api: API;

  constructor({ data, block, api }: BlockToolConstructorOptions<{ text?: string }>) {
    this.api = api;
    this.blockId = block.id;
    this.element = document.createElement('div');
    this.element.contentEditable = 'true';
    this.element.innerHTML = data.text ?? '';
  }

  public render(): HTMLElement {
    return this.element;
  }

  public rendered(): void {
    if (seen.has(this.blockId)) {
      return;
    }
    const block = this.api.blocks.getById(this.blockId);
    const holder = block?.holder;

    seen.set(this.blockId, {
      parentId: block?.parentId ?? null,
      holderIn: holder?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? '-',
    });
  }

  public save(): { text: string } {
    return { text: this.element.innerHTML };
  }
}

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  caret: API['caret'];
  module: {
    blockManager: {
      blocks: Block[];
      currentBlockIndex: number;
      paste: (tool: string, event: CustomEvent) => Promise<Block>;
      split: () => Block;
    };
    caret: { extractFragmentFromCaretPosition: () => DocumentFragment | void };
  };
}

const P = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'probe',
  data: { text: id },
  ...(parent !== undefined ? { parent } : {}),
});

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    defaultBlock: 'probe',
    tools: { probe: Probe, toggle: ToggleItem },
    data: {
      blocks: [
        { id: 't', type: 'toggle', data: { text: 't', isOpen: true }, content: ['a', 'b'] },
        P('a', 't'),
        P('b', 't'),
        P('z'),
      ],
    },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

describe('placement inserts run rendered() in place', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    seen.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('insertInsideParent into a toggle', async () => {
    const instance = await boot();

    const child = instance.blocks.insertInsideParent('t', 2);

    expect(seen.get(child.id)).toEqual({ parentId: 't', holderIn: 't' });
  }, 30_000);

  it('paste after a toggle child', async () => {
    const instance = await boot();
    const element = document.createElement('div');

    element.innerHTML = 'pasted';
    instance.module.blockManager.currentBlockIndex = 1;

    const pasted = await instance.module.blockManager.paste('probe', new CustomEvent('paste', { detail: { data: element } }));

    expect(seen.get(pasted.id)).toEqual({ parentId: 't', holderIn: 't' });
  }, 30_000);

  it('split inside a toggle', async () => {
    const instance = await boot();

    const fragment = document.createDocumentFragment();

    fragment.append('tail');
    vi.spyOn(instance.module.caret, 'extractFragmentFromCaretPosition').mockReturnValue(fragment);
    instance.module.blockManager.currentBlockIndex = 1;

    const tail = instance.module.blockManager.split();

    expect(tail.parentId).toBe('t');
    expect(seen.get(tail.id)).toEqual({ parentId: 't', holderIn: 't' });
  }, 30_000);
});
