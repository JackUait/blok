import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { ListItem } from '../../src/tools/list';
import type { OutputData } from '../../types';

/**
 * The grammar claimed Editor.js list coverage but read only the v1 dialect
 * (`data.start`, `item.checked`). The nested-list / list-v2 tool — what current
 * Editor.js installs actually write — stores `data.meta.start` and
 * `item.meta.checked`, so checked state and list start numbering were silently
 * lost on load: no warning, no error, just gone.
 *
 * This is the end-to-end proof through a real editor, in both directions: the
 * v2 shape loads with its state intact, and saving preserves it.
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
    tools: { paragraph: Paragraph, list: ListItem },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;

  return instance;
};

describe('Editor.js list v2 (`meta`) round-trip', () => {
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

  it('keeps `item.meta.checked` state through load and save', async () => {
    const instance = createEditor([
      {
        type: 'list',
        data: {
          style: 'checklist',
          meta: {},
          items: [
            { content: 'Done', meta: { checked: true }, items: [] },
            { content: 'Todo', meta: { checked: false }, items: [] },
          ],
        },
      },
    ]);

    await instance.isReady;

    const saved = await instance.save();
    const checkedStates = saved.blocks
      .filter((block) => block.type === 'list')
      .flatMap((block) => {
        const items = block.data.items as Array<{ checked?: boolean }> | undefined;

        return items !== undefined ? items.map((item) => item.checked) : [block.data.checked];
      });

    expect(checkedStates).toEqual([true, false]);
  }, 60_000);

  it('keeps `data.meta.start` numbering through load and save', async () => {
    const instance = createEditor([
      {
        type: 'list',
        data: {
          style: 'ordered',
          meta: { start: 7 },
          items: [{ content: 'seven', items: [] }, { content: 'eight', items: [] }],
        },
      },
    ]);

    await instance.isReady;

    const saved = await instance.save();
    const listBlock = saved.blocks.find((block) => block.type === 'list');
    const start = listBlock?.data.start ?? (listBlock?.data.meta as { start?: number } | undefined)?.start;

    expect(start).toBe(7);
  }, 60_000);
});
