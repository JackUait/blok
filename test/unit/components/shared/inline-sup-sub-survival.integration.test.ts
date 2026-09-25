import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { Quote } from '../../../../src/tools/quote';
import { ToggleItem } from '../../../../src/tools/toggle';
import { Table } from '../../../../src/tools/table';
import { SupSubInlineTool } from '../../../../src/components/inline-tools/inline-tool-sup-sub';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  destroy: () => void;
}

const TEXT = 'x<sup>2</sup> H<sub>2</sub>O';

const TEXT_TOOLS: Array<[string, OutputBlockData['data']]> = [
  ['paragraph', { text: TEXT }],
  ['header', { text: TEXT, level: 2 }],
  ['quote', { text: TEXT }],
  ['list', { text: TEXT, style: 'unordered' }],
  ['toggle', { text: TEXT }],
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (inlineToolbar: boolean | string[], withSupSub: boolean, block: OutputBlockData): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: { class: Paragraph, inlineToolbar },
      header: { class: Header, inlineToolbar },
      quote: { class: Quote, inlineToolbar },
      list: { class: ListItem, inlineToolbar },
      toggle: { class: ToggleItem, inlineToolbar },
      table: { class: Table, inlineToolbar },
      ...(withSupSub ? { supSub: { class: SupSubInlineTool } } : {}),
    },
    data: { blocks: [block] },
  } as never) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

// Each case boots a real editor; the first pays the cold import.
describe('stored <sup>/<sub> survive load → save whatever the inline config', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  const configs: Array<[string, boolean | string[], boolean]> = [
    ['sup/sub tool registered + enabled', true, true],
    ['sup/sub tool not registered', true, false],
    ['inline toolbar off', false, true],
    ['narrow inline list without sup/sub', ['bold'], true],
  ];

  for (const [label, inlineToolbar, withSupSub] of configs) {
    for (const [type, data] of TEXT_TOOLS) {
      it(`${type}: ${label}`, async () => {
        const instance = await boot(inlineToolbar, withSupSub, { id: 'b1', type, data });
        const saved = await instance.save();
        const text = saved.blocks.find((b) => b.id === 'b1')?.data.text;

        expect(text).toBe(TEXT);
      });
    }
  }

  it('paragraph → header convert keeps sup/sub when the sup/sub tool is not registered', async () => {
    const instance = await boot(true, false, { id: 'b1', type: 'paragraph', data: { text: TEXT } });

    await instance.blocks.convert('b1', 'header', { level: 2 });
    const saved = await instance.save();

    expect(saved.blocks[0]?.type).toBe('header');
    expect(saved.blocks[0]?.data.text).toBe(TEXT);
  });

  it('table legacy string cell keeps sup/sub when the sup/sub tool is not registered', async () => {
    const instance = await boot(true, false, {
      id: 't1',
      type: 'table',
      data: { withHeadings: false, content: [[TEXT]] },
    });
    const saved = await instance.save();
    const texts = saved.blocks.filter((b) => b.id !== 't1').map((b) => b.data.text);

    expect(texts).toContain(TEXT);
  });
});
