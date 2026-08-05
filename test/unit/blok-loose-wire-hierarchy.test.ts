import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { equalsOutputData } from '../../src/shared/output-data';
import type { LooseOutputBlockData, OutputData } from '../../types';

/**
 * `LooseOutputBlockData` exists because backend DTOs serialize absent values as
 * `null` rather than omitting them. It normalized `id: null` and `data: null`
 * but let `parent: null` / `content: null` through verbatim — and those are not
 * a cosmetic mismatch: `content: null` reaches the Block constructor and is
 * spread (`[ ...null ]`), so the editor never finishes rendering.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = (blocks: LooseOutputBlockData[]): TestEditor => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;

  return instance;
};

describe('loose wire hierarchy fields', () => {
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

  it('renders a DTO whose absent parent/content serialize as null', async () => {
    const loaded = {
      blocks: [{ id: 'a1', type: 'paragraph', data: { text: 'Hello' }, parent: null, content: null }],
    };

    const instance = createEditor(loaded.blocks);

    await expect(instance.isReady).resolves.toBeDefined();

    const saved = await instance.save();

    expect(saved.blocks).toEqual([{ id: 'a1', type: 'paragraph', data: { text: 'Hello' } }]);
    expect(equalsOutputData(loaded, saved)).toBe(true);
  }, 60_000);

  it('renders a DTO carrying a null content with no parent key at all', async () => {
    const instance = createEditor([
      { id: 'a1', type: 'paragraph', data: { text: 'Hello' }, content: null },
    ]);

    await expect(instance.isReady).resolves.toBeDefined();

    const saved = await instance.save();

    expect(saved.blocks).toEqual([{ id: 'a1', type: 'paragraph', data: { text: 'Hello' } }]);
  }, 60_000);
});
