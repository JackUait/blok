/**
 * A tool's rendered() runs one animation frame after render. A block replaced
 * inside that frame must not run it: the replacement keeps the same id, so the
 * dead block would pull the new block's children into its own detached slot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  module: {
    blockManager: {
      blocks: Block[];
      replace: (block: Block, tool: string, data: Record<string, unknown>) => Block;
    };
  };
}

const nextFrame = (): Promise<void> => new Promise(resolve => {
  requestAnimationFrame(() => resolve());
});

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

describe('rendered() of a block replaced before its frame', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    editor = undefined;
    await settle();
    holder.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('leaves the child in the new block', async () => {
    const blocks: OutputBlockData[] = [
      { id: 't', type: 'toggle', data: { text: 'title', isOpen: true }, content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: 'kid' }, parent: 't' },
      { id: 'z', type: 'paragraph', data: { text: 'z' } },
    ];

    // Hold frames so the replace lands before the toggle's rendered() runs.
    const frames: FrameRequestCallback[] = [];

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);

      return frames.length;
    });

    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, header: Header, toggle: ToggleItem },
      data: { blocks },
    }) as unknown as TestEditor;

    await editor.isReady;

    const [toggle] = editor.module.blockManager.blocks;

    editor.module.blockManager.replace(toggle, 'paragraph', { text: 'title' });
    vi.mocked(window.requestAnimationFrame).mockRestore();
    frames.splice(0).forEach(callback => callback(0));
    await nextFrame();
    await settle();

    const child = editor.module.blockManager.blocks.find(block => block.id === 'c');

    expect(child?.holder.isConnected).toBe(true);
    await expect(editor.save()).resolves.toBeDefined();
  });
});
