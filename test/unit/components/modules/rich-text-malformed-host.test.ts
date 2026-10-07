/**
 * One malformed mark or embed in host data must not blank the editor: the
 * bad value is dropped and every other block still boots and saves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import type { OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: {
    insert: (type?: string, data?: Record<string, unknown>) => { id: string };
  };
}

const MALFORMED: Array<[string, unknown]> = [
  ['embed page null', [{ text: 'a' }, { embed: { page: null } }, { text: 'b' }]],
  ['embed equation string', [{ text: 'a' }, { embed: { equation: 'x' } }, { text: 'b' }]],
  ['embed equation expression number', [{ text: 'a' }, { embed: { equation: { expression: 5 } } }, { text: 'b' }]],
  ['tag attr number', [{ text: 'ab', marks: { 'tag:span': { a: 5 } } }]],
  ['tag attr null', [{ text: 'ab', marks: { 'tag:span': { a: null } } }]],
];

let holder: HTMLDivElement | undefined;
let editor: TestEditor | undefined;

const requireHolder = (): HTMLDivElement => {
  if (holder === undefined) {
    throw new Error('no holder');
  }

  return holder;
};

const textOf = (id: string): string =>
  requireHolder().querySelector(`[data-blok-id="${id}"]`)?.textContent ?? '';

const boot = async (data: OutputData): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, header: Header }, data }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

describe('malformed rich text from the host', () => {
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

  it.each(MALFORMED)('%s: the editor boots and shows every block', async (_label, text) => {
    const instance = await boot({
      blocks: [
        { id: 'one', type: 'paragraph', data: { text: 'first' } },
        { id: 'bad', type: 'paragraph', data: { text } },
        { id: 'two', type: 'header', data: { text: [{ text: 'second' }], level: 2 } },
      ],
    });

    expect(textOf('one')).toBe('first');
    expect(textOf('bad')).toBe('ab');
    expect(textOf('two')).toBe('second');

    const saved = await instance.save();

    expect(saved.blocks.map(block => block.id)).toEqual(['one', 'bad', 'two']);
    expect(saved.blocks[1].data.text).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'ab' })])
    );
  });

  it.each(MALFORMED)('%s: blocks.insert inserts the block without the bad value', async (_label, text) => {
    const instance = await boot({ blocks: [{ id: 'one', type: 'paragraph', data: { text: 'first' } }] });

    const inserted = instance.blocks.insert('paragraph', { text });

    expect(textOf(inserted.id)).toBe('ab');
    expect(textOf('one')).toBe('first');
  });
});
