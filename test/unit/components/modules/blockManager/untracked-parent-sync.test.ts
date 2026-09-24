import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, BlockAPI } from '../../../../../types';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; history: { canUndo: () => boolean } }

/**
 * A container that, a frame after it renders, gives itself a child as an
 * untracked repair. Its save() lists its children, so the new child changes
 * the container's own data too.
 */
class RepairingBox {
  public static isReadOnlySupported = true;
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly kids: string[] = [];

  constructor({ api, block }: { api: API; block: BlockAPI }) {
    this.api = api;
    this.block = block;
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public rendered(): void {
    requestAnimationFrame(() => {
      const blocks = this.api.blocks;

      if (blocks.transactWithoutCapture === undefined) {
        throw new Error('blocks.transactWithoutCapture is missing');
      }

      blocks.transactWithoutCapture(() => {
        const child = this.api.blocks.insert('paragraph', { text: '' }, {}, this.api.blocks.getBlocksCount(), false);

        this.api.blocks.setBlockParent(child.id, this.block.id);
        this.kids.push(child.id);
      });
    });
  }

  public save(): { kids: string[] } {
    return { kids: [...this.kids] };
  }
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};
const frame = async (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const settle = async (): Promise<void> => {
  await drain();
  await frame();
  await frame();
  await drain();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await drain();
};

describe('a parent sync caused by an untracked write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not an undo step', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, box: RepairingBox },
      data: { blocks: [{ id: 'box', type: 'box', data: { kids: [] } }] },
    }) as unknown as TestEditor;

    await editor.isReady;
    await settle();

    const canUndo = editor.history.canUndo();

    editor.destroy();
    await frame();
    await drain();
    holder.remove();

    expect(canUndo).toBe(false);
  });
});
