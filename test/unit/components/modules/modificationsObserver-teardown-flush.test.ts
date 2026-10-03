import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * A real editor torn down inside the last batch window: the edit must still
 * reach the host.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

const BLOCKS: OutputBlockData[] = [
  { id: 'p1', type: 'paragraph', data: { text: 'before' } },
  { id: 'tbl', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }]] } },
  { id: 'c00', type: 'paragraph', data: { text: 'a' }, parent: 'tbl' },
  { id: 'c01', type: 'paragraph', data: { text: 'b' }, parent: 'tbl' },
];

let holder: HTMLDivElement;
let editor: TestEditor | undefined;

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const typeInto = (blockId: string, text: string): void => {
  const editable = holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-tool="paragraph"]`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }

  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
};

const textOf = (doc: OutputData, id: string): unknown => doc.blocks.find((block) => block.id === id)?.data.text;

describe('ModificationsObserver — final flush on teardown (real editor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('delivers an edit made right before destroy() to onSave', async () => {
    const onSave = vi.fn<(data: OutputData) => void>();
    const onError = vi.fn();
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      data: { blocks: structuredClone(BLOCKS) },
      onSave,
      onError,
    });

    await editor.isReady;
    await wait(600);

    typeInto('p1', 'last words');
    typeInto('c01', 'b-last');
    await wait(50);
    editor.destroy();
    editor = undefined;
    await wait(600);

    const saved = onSave.mock.calls.map(([data]) => data);

    expect(saved.map((doc) => textOf(doc, 'p1'))).toContain('last words');
    expect(saved.map((doc) => textOf(doc, 'c01'))).toContain('b-last');
    expect(onError).not.toHaveBeenCalled();
  }, 60_000);

  it('delivers an edit made right before destroy() to persistence.save', async () => {
    const save = vi.fn<(data: OutputData) => Promise<void>>(() => Promise.resolve());
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      persistence: {
        load: () => Promise.resolve({ blocks: structuredClone(BLOCKS) }),
        save,
      },
    });

    await editor.isReady;
    await wait(600);

    typeInto('c01', 'b-last');
    await wait(50);
    editor.destroy();
    editor = undefined;
    await wait(600);

    expect(save.mock.calls.map(([data]) => textOf(data, 'c01'))).toContain('b-last');
  }, 60_000);

  it('does not call onSave on destroy() when nothing changed', async () => {
    const onSave = vi.fn();
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      data: { blocks: structuredClone(BLOCKS) },
      onSave,
    });

    await editor.isReady;
    await wait(600);
    editor.destroy();
    editor = undefined;
    await wait(600);

    expect(onSave).not.toHaveBeenCalled();
  }, 60_000);
});
