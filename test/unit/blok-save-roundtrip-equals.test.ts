import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { equalsOutputData } from '../../src/shared/output-data';
import type { OutputData } from '../../types';

/**
 * `equalsOutputData` promises that a document round-tripped through `save()`
 * compares equal to its echo — the whole point of the published dirty-check
 * helper, of the caret-preserving `blocks.render()` guard and of the adapters'
 * echo window. The Block constructor broke that promise by minting
 * `lastEditedAt = Date.now()` for every block that arrived without one: a
 * document that was merely LOADED came back from `save()` carrying a key it
 * never had, so "did the user change anything?" answered yes for an untouched
 * document.
 *
 * A load is not an edit.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = (blocks: OutputData['blocks']): TestEditor => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;

  return instance;
};

describe('save() round-trips a loaded document', () => {
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

  it('does not stamp edit metadata onto a block that was merely loaded', async () => {
    const loaded: OutputData = {
      blocks: [{ id: 'a1', type: 'paragraph', data: { text: 'Hello' } }],
    };

    const instance = createEditor(loaded.blocks);

    await instance.isReady;

    const saved = await instance.save();

    expect('lastEditedAt' in saved.blocks[0]).toBe(false);
    expect(equalsOutputData(loaded, saved)).toBe(true);
  }, 60_000);

  it('keeps a stamp the stored document already carried', async () => {
    const loaded: OutputData = {
      blocks: [
        { id: 'a1', type: 'paragraph', data: { text: 'Hello' }, lastEditedAt: 1712880000000 },
      ],
    };

    const instance = createEditor(loaded.blocks);

    await instance.isReady;

    const saved = await instance.save();

    expect(saved.blocks[0].lastEditedAt).toBe(1712880000000);
    expect(equalsOutputData(loaded, saved)).toBe(true);
  }, 60_000);
});
