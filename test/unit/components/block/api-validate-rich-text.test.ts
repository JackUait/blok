/**
 * `BlockAPI.save()` hands the host segments; its sibling `validate()` must
 * accept them, or a host that gates persistence on it drops valid blocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';

interface TestBlockAPI {
  save: () => Promise<{ data: Record<string, unknown> } | undefined>;
  validate: (data: Record<string, unknown>) => Promise<boolean>;
}

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: {
    getById: (id: string) => TestBlockAPI | null;
  };
}

let holder: HTMLDivElement | undefined;
let editor: TestEditor | undefined;

const blockOf = (instance: TestEditor, id: string): TestBlockAPI => {
  const block = instance.blocks.getById(id);

  if (block === null) {
    throw new Error(`no block «${id}»`);
  }

  return block;
};

describe('BlockAPI.validate with segment data', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, header: Header },
      data: {
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: 'a <b>b</b>' } },
          { id: 'h', type: 'header', data: { text: 'Title', level: 2 } },
        ],
      },
    }) as unknown as TestEditor;
    await editor.isReady;
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it.each(['p', 'h'])('accepts what save() returned (%s)', async (id) => {
    const instance = editor as TestEditor;
    const block = blockOf(instance, id);
    const saved = await block.save();

    expect(Array.isArray(saved?.data.text)).toBe(true);
    await expect(block.validate(saved?.data ?? {})).resolves.toBe(true);
  });

  it('accepts hand-written segments for a header', async () => {
    const block = blockOf(editor as TestEditor, 'h');

    await expect(block.validate({ text: [{ text: 'H' }], level: 2 })).resolves.toBe(true);
  });

  it('still rejects an empty paragraph given as segments', async () => {
    const block = blockOf(editor as TestEditor, 'p');

    await expect(block.validate({ text: [] })).resolves.toBe(false);
  });
});
