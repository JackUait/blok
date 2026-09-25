/**
 * "Turn into" on a callout (Notion). Its text lives in its first line, a child
 * block: that line becomes the new block's text and the other lines follow as
 * siblings, or stay nested under a toggle. One undo brings the callout back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { CalloutTool } from '../../../../src/tools/callout';
import { DividerTool } from '../../../../src/tools/divider';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Quote } from '../../../../src/tools/quote';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; canUndo: () => boolean };
  blocks: API['blocks'];
  module: { yjsManager: { stopCapturing: () => void } };
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const FIRST = 'One <strong>bold</strong><br>two <a href="https://example.com">link</a>';
const SECOND = 'Second <i>line</i>';

const DEFAULT_BLOCKS: OutputBlockData[] = [
  { id: 'before', type: 'paragraph', data: { text: 'before' } },
  { id: 'C', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: ['c1', 'c2'] },
  { id: 'c1', type: 'paragraph', data: { text: FIRST }, parent: 'C' },
  { id: 'c2', type: 'paragraph', data: { text: SECOND }, parent: 'C' },
  { id: 'after', type: 'paragraph', data: { text: 'after' } },
];

const settleFrame = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await new Promise(resolve => setTimeout(resolve, 0));
};

const boot = async (blocks: OutputBlockData[] = DEFAULT_BLOCKS): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    // preserveBlank as in the browser bundle, so an empty line still saves.
    tools: {
      paragraph: { class: Paragraph, config: { preserveBlank: true } },
      header: Header,
      toggle: ToggleItem,
      quote: Quote,
      list: ListItem,
      divider: DividerTool,
      callout: CalloutTool,
    },
    data: { blocks },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settleFrame();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const convert = async (instance: Runtime, tool: string, data?: Record<string, unknown>): Promise<void> => {
  await instance.blocks.convert('C', tool, data);
  await settleFrame();
};

const tree = async (instance: Runtime): Promise<string[]> =>
  (await instance.save()).blocks.map(block => `${block.id}:${block.type}:${block.parent ?? 'root'}`);

const textOf = async (instance: Runtime, id: string): Promise<unknown> =>
  (await instance.save()).blocks.find(block => block.id === id)?.data.text;

describe('callout: turn into another block', () => {
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

  it('turns into text: the first line becomes the text, the rest follow as siblings', async () => {
    const instance = await boot();

    await convert(instance, 'paragraph');

    expect(await textOf(instance, 'C')).toBe(FIRST);
    expect(await tree(instance)).toEqual([
      'before:paragraph:root',
      'C:paragraph:root',
      'c2:paragraph:root',
      'after:paragraph:root',
    ]);
    expect(await textOf(instance, 'c2')).toBe(SECOND);
  }, 30_000);

  it('turns into a heading with the first line as its text', async () => {
    const instance = await boot();

    await convert(instance, 'header', { level: 2 });

    expect(await textOf(instance, 'C')).toBe(FIRST);
    expect(await tree(instance)).toEqual([
      'before:paragraph:root',
      'C:header:root',
      'c2:paragraph:root',
      'after:paragraph:root',
    ]);
  }, 30_000);

  it('turns into a quote with the first line as its text', async () => {
    const instance = await boot();

    await convert(instance, 'quote');

    expect(await textOf(instance, 'C')).toBe(FIRST);
    expect(await tree(instance)).toContain('c2:paragraph:root');
  }, 30_000);

  it('turns into a list item with the first line as its text', async () => {
    const instance = await boot();

    await convert(instance, 'list', { style: 'unordered' });

    expect(await textOf(instance, 'C')).toBe(FIRST);
    expect(await tree(instance)).toEqual([
      'before:paragraph:root',
      'C:list:root',
      'c2:paragraph:root',
      'after:paragraph:root',
    ]);
  }, 30_000);

  it('turns into a toggle: the first line is the title, the rest stay inside', async () => {
    const instance = await boot();

    await convert(instance, 'toggle');

    expect(await textOf(instance, 'C')).toBe(FIRST);
    expect(await tree(instance)).toEqual([
      'before:paragraph:root',
      'C:toggle:root',
      'c2:paragraph:C',
      'after:paragraph:root',
    ]);
    expect(await textOf(instance, 'c2')).toBe(SECOND);
  }, 30_000);

  it('turns into a toggle heading: the first line is the title, the rest stay inside', async () => {
    const instance = await boot();

    await convert(instance, 'header', { level: 2, isToggleable: true });

    expect(await textOf(instance, 'C')).toBe(FIRST);
    // A new toggle heading also takes in the section after it, as from any block.
    expect(await tree(instance)).toEqual([
      'before:paragraph:root',
      'C:header:root',
      'c2:paragraph:C',
      'after:paragraph:C',
    ]);
  }, 30_000);

  it('keeps every line when the first one has no text to give', async () => {
    const instance = await boot([
      { id: 'C', type: 'callout', data: { emoji: '💡' }, content: ['d', 'c2'] },
      { id: 'd', type: 'divider', data: {}, parent: 'C' },
      { id: 'c2', type: 'paragraph', data: { text: SECOND }, parent: 'C' },
    ]);

    await convert(instance, 'paragraph');

    expect(await tree(instance)).toEqual(['C:paragraph:root', 'd:divider:root', 'c2:paragraph:root']);
    expect(await textOf(instance, 'C')).toBe('');
  }, 30_000);

  it('keeps a first line that holds lines of its own', async () => {
    const instance = await boot([
      { id: 'C', type: 'callout', data: { emoji: '💡' }, content: ['t', 'c2'] },
      { id: 't', type: 'toggle', data: { text: 'toggle' }, parent: 'C', content: ['k'] },
      { id: 'k', type: 'paragraph', data: { text: 'kid' }, parent: 't' },
      { id: 'c2', type: 'paragraph', data: { text: SECOND }, parent: 'C' },
    ]);

    await convert(instance, 'paragraph');

    expect(await tree(instance)).toEqual(['C:paragraph:root', 't:toggle:root', 'k:paragraph:t', 'c2:paragraph:root']);
    expect(await textOf(instance, 'C')).toBe('');
  }, 30_000);

  it('turns an empty callout into an empty block', async () => {
    const instance = await boot([
      { id: 'C', type: 'callout', data: { emoji: '💡' }, content: [] },
      { id: 'after', type: 'paragraph', data: { text: 'after' } },
    ]);

    await convert(instance, 'paragraph');

    expect(await tree(instance)).toEqual(['C:paragraph:root', 'after:paragraph:root']);
    expect(await textOf(instance, 'C')).toBe('');
  }, 30_000);

  const plainCallout = DEFAULT_BLOCKS.map(block =>
    block.id === 'C' ? { ...block, data: { ...block.data, backgroundColor: null } } : block);

  for (const [label, tool, data, blocks] of [
    ['text', 'paragraph', undefined, DEFAULT_BLOCKS],
    ['a heading', 'header', { level: 2 }, DEFAULT_BLOCKS],
    ['a toggle', 'toggle', undefined, plainCallout],
  ] as const) {
    it(`comes back exactly as it was after one undo (${label})`, async () => {
      const instance = await boot([...blocks]);
      const before = JSON.stringify((await instance.save()).blocks);

      await convert(instance, tool, data);
      instance.module.yjsManager.stopCapturing();

      instance.history.undo();
      await settleFrame();

      expect(JSON.stringify((await instance.save()).blocks)).toBe(before);
    }, 30_000);
  }

  // Not callout-specific: a paragraph with a background turned into a toggle
  // loses it on undo too. The toggle's own save drops the colour.
  it.fails('gets its background back after one undo from a toggle', async () => {
    const instance = await boot();
    const before = JSON.stringify((await instance.save()).blocks);

    await convert(instance, 'toggle');
    instance.module.yjsManager.stopCapturing();

    instance.history.undo();
    await settleFrame();

    expect(JSON.stringify((await instance.save()).blocks)).toBe(before);
  }, 30_000);
});
