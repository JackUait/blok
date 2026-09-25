import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../src/blok';
import { Paragraph } from '../../src/tools/paragraph';
import { ListItem } from '../../src/tools/list';
import { Table } from '../../src/tools/table';
import { CalloutTool } from '../../src/tools/callout';
import type { OutputBlockData, OutputData } from '../../types';

/**
 * Legacy content a real editor must carry through load + save: a callout's
 * `title` and a list inside a string table cell.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (dataModel: 'auto' | 'legacy', blocks: OutputBlockData[]): Promise<OutputData> => {
  const instance = new Blok({
    holder,
    dataModel,
    tools: { paragraph: Paragraph, list: ListItem, table: Table, callout: CalloutTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance.save();
};

const LIST_CELL = 'x<ul><li>one</li><li>two</li></ul>';

describe('legacy content survives a load + save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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

  it('keeps a legacy callout title as the first body paragraph', async () => {
    const saved = await boot('auto', [{
      id: 'c1',
      type: 'callout',
      data: {
        title: '<b>Heads</b><br>up',
        variant: 'note',
        emoji: '💡',
        isEmojiVisible: true,
        body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'body' } }] },
      },
    }]);

    const callout = saved.blocks.find((block) => block.type === 'callout');
    const body = (callout?.data.body as { blocks: OutputBlockData[] } | undefined)?.blocks ?? [];

    expect(body.map((block) => block.data.text)).toEqual(['<strong>Heads</strong><br>up', 'body']);
  }, 60_000);

  it.each(['legacy', 'auto'] as const)('keeps a list inside a string table cell (dataModel: %s)', async (dataModel) => {
    const saved = await boot(dataModel, [{
      id: 't1',
      type: 'table',
      data: { withHeadings: false, content: [[LIST_CELL, 'plain']] },
    }]);

    const cellBlocks = saved.blocks.filter((block) => block.parent === 't1');

    expect(cellBlocks.map((block) => [block.type, block.data.text])).toEqual([
      ['paragraph', 'x'],
      ['list', 'one'],
      ['list', 'two'],
      ['paragraph', 'plain'],
    ]);
  }, 60_000);

  it.each(['legacy', 'auto'] as const)('keeps inline marks inside a string table cell (dataModel: %s)', async (dataModel) => {
    const saved = await boot(dataModel, [{
      id: 't1',
      type: 'table',
      data: { withHeadings: false, content: [['<u>u</u><s>s</s><del>d</del><code>c</code>']] },
    }]);

    const cellText = saved.blocks.find((block) => block.parent === 't1')?.data.text;

    expect(cellText).toContain('<u>u</u>');
    expect(cellText).toMatch(/<(s|del)>s<\/\1>/);
    expect(cellText).toMatch(/<(s|del)>d<\/\1>/);
    expect(cellText).toContain('<code>c</code>');
  }, 60_000);
});
