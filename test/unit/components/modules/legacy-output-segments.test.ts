import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Callout, Header, List, Paragraph, Quote, Toggle } from '../../../../src/tools';
import { richTextToPlainText } from '../../../../src/migrate';
import { blocksToHtml, blocksToMarkdown, blocksToPlainText, extractTexts } from '../../../../src/view';
import { isRichText } from '../../../../src/shared/rich-text/guards';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../../types';
import type { BlockToolConstructable } from '../../../../types/tools';
import type { RichText } from '../../../../types/rich-text';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: { exportMarkdown: () => Promise<string> };
}

const editors: TestEditor[] = [];
const holders: HTMLElement[] = [];

const createEditor = async (config: Partial<BlokConfig>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header as unknown as BlockToolConstructable,
      list: List as unknown as BlockToolConstructable,
      toggle: Toggle as unknown as BlockToolConstructable,
      quote: Quote as unknown as BlockToolConstructable,
      callout: Callout as unknown as BlockToolConstructable,
    },
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const TRICKY = 'a < b && <script>y';

/** Every rich value in a legacy document, as plain text, in document order. */
const legacyTexts = (blocks: OutputBlockData[]): string[] => {
  const texts: string[] = [];
  const push = (value: unknown): void => {
    if (isRichText(value)) {
      texts.push(richTextToPlainText(value));
    } else if (typeof value === 'string' && value !== '') {
      texts.push(`HTML:${value}`);
    }
  };
  const walkItems = (items: unknown[]): void => items.forEach((item) => {
    const record = item as { content?: unknown; items?: unknown[] };

    push(record.content);
    walkItems(record.items ?? []);
  });

  for (const block of blocks) {
    const data = block.data;

    push(data.text);
    push(data.title);
    if (Array.isArray(data.items)) {
      walkItems(data.items);
    }
    const body = data.body as { blocks?: OutputBlockData[] } | undefined;

    texts.push(...legacyTexts(body?.blocks ?? []));
  }

  return texts;
};

const flatDocument: OutputData = {
  blocks: [
    { id: 'l1', type: 'list', data: { text: '<b>one</b> &amp; &lt;x&gt;', style: 'unordered' } },
    { id: 'l2', type: 'list', data: { text: 'two', style: 'unordered' }, content: ['l3'] },
    { id: 'l3', type: 'list', data: { text: 'nested &lt;n&gt;', style: 'unordered', depth: 1 }, parent: 'l2' },
    { id: 'h1', type: 'header', data: { text: '<b>heading</b>', level: 2, isToggleable: true }, content: ['h1c'] },
    { id: 'h1c', type: 'paragraph', data: { text: 'under heading' }, parent: 'h1' },
    { id: 't1', type: 'toggle', data: { text: '<i>title</i>' }, content: ['t1c'] },
    { id: 't1c', type: 'paragraph', data: { text: 'inside' }, parent: 't1' },
    { id: 'q1', type: 'quote', data: { text: 'quoted &amp; said' } },
    { id: 'c1', type: 'callout', data: { emoji: '' }, content: ['c1c'] },
    { id: 'c1c', type: 'paragraph', data: { text: 'called' }, parent: 'c1' },
  ],
};

describe('legacy output carries segments', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('saves list, toggle, quote and callout in legacy shapes holding segments, losing no text', async () => {
    const editor = await createEditor({ dataModel: 'legacy', data: flatDocument });

    const saved = await editor.save();
    const list = saved.blocks.find(block => block.type === 'list');
    const toggle = saved.blocks.find(block => block.id === 't1');
    const headingToggle = saved.blocks.find(block => block.id === 'h1');

    expect(legacyTexts(saved.blocks)).toEqual([
      'one & <x>', 'two', 'nested <n>', 'heading', 'under heading', 'title', 'inside', 'quoted & said', 'called',
    ]);
    expect(list?.data.items).toEqual([{ content: [{ text: 'one', marks: { bold: true } }, { text: ' & <x>' }] }]);
    expect(toggle?.data.title).toEqual([{ text: 'title', marks: { italic: true } }]);
    expect(headingToggle?.data).toMatchObject({ title: [{ text: 'heading', marks: { bold: true } }], titleVariant: 2 });
  });

  it('reloads its own legacy output with every character, markup characters included', async () => {
    const source: OutputData = {
      blocks: [
        { id: 'l1', type: 'list', data: { style: 'unordered', items: [{ content: [{ text: TRICKY }], items: [] }] } },
        {
          id: 't1',
          type: 'toggleList',
          data: { title: [{ text: TRICKY, marks: { bold: true } }], body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: TRICKY }] } }] } },
        },
        { id: 'p2', type: 'paragraph', data: { text: [{ text: TRICKY }] } },
      ],
    };
    const editor = await createEditor({ dataModel: 'legacy', data: source });

    const saved = await editor.save();

    expect(legacyTexts(saved.blocks)).toEqual([TRICKY, TRICKY, TRICKY, TRICKY]);
    expect(saved.blocks[1].data.title).toEqual([{ text: TRICKY, marks: { bold: true } }]);
  });

  it('the view reads its own legacy output without losing text', async () => {
    const saved = await (await createEditor({ dataModel: 'legacy', data: flatDocument })).save();
    const texts = ['one', 'two', 'nested', 'heading', 'under heading', 'title', 'inside', 'quoted', 'called'];

    const html = blocksToHtml(saved);
    const plain = blocksToPlainText(saved);
    const markdown = blocksToMarkdown(saved);
    const extracted = extractTexts(saved).join('\n');

    for (const text of texts) {
      expect(html).toContain(text);
      expect(plain).toContain(text);
      expect(markdown).toContain(text);
      expect(extracted).toContain(text);
    }
    expect(plain).toContain('one & <x>');
    expect(plain).toContain('nested <n>');
  });

  it('a legacy save survives a second editor round trip unchanged', async () => {
    const first = await (await createEditor({ dataModel: 'legacy', data: flatDocument })).save();
    const second = await (await createEditor({ dataModel: 'legacy', data: first })).save();

    expect(legacyTexts(second.blocks)).toEqual(legacyTexts(first.blocks));
    expect((second.blocks[0].data.items as Array<{ content: RichText }>)[0].content)
      .toEqual((first.blocks[0].data.items as Array<{ content: RichText }>)[0].content);
  });

  it('exportMarkdown under legacy output keeps lists and toggles', async () => {
    const editor = await createEditor({ dataModel: 'legacy', data: flatDocument });

    const markdown = await editor.blocks.exportMarkdown();

    expect(markdown).toContain('two');
    expect(markdown).toContain('title');
    expect(markdown).toContain('inside');
  });
});
