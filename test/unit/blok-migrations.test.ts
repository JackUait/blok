import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import type { OutputData } from '../../types';

/**
 * End-to-end proof that the editor-config `migrations` map reshapes a block's
 * stored `data` through the full load path — not just at the factory seam. A
 * host declares an "old shape → new shape" rule for a block type from the
 * OUTSIDE (here paragraph's legacy `{ body }` → current `{ text }`), and the
 * migrated data is what the tool renders and saves. See the user-block-migrations
 * design doc.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('editor config migrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('upgrades stored block data via a host rule before the tool renders it', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      migrations: {
        // Legacy shape wrote the text under `body`; the current tool reads `text`.
        paragraph: (data) => ('body' in data ? { text: (data as { body: string }).body } : data),
      },
      data: {
        blocks: [{ type: 'paragraph', data: { body: 'migrated text' } }],
      },
    }) as unknown as TestEditor;

    editor = instance;

    await instance.isReady;

    const saved = await instance.save();

    expect(saved.blocks[0].data).toEqual({ text: 'migrated text' });
  }, 60_000);
});
