import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { Quote } from '../../../../src/tools/quote';
import { CodeTool } from '../../../../src/tools/code';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * The code block's `code` field is plain text. Moving content between it and
 * a rich-text field must translate: <br> and block ends become "\n", marks
 * drop, entities decode — and back: "<", "&" escape and "\n" becomes <br>.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  destroy: () => void;
  module: {
    blockManager: {
      blocks: Block[];
      mergeBlocks: (target: Block, toMerge: Block) => Promise<void>;
    };
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const SOURCE = 'if (a < b && c) {\n  x = "<b>";\n}';

const createEditor = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      list: ListItem,
      quote: Quote,
      code: CodeTool,
      toggle: ToggleItem,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const dataOf = async (instance: TestEditor, id: string): Promise<Record<string, unknown> | undefined> => {
  const saved = await instance.save();

  return saved.blocks.find((block) => block.id === id)?.data;
};

const blockById = (instance: TestEditor, id: string): Block => {
  const block = instance.module.blockManager.blocks.find((candidate) => candidate.id === id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

describe('code block: plain-text field on convert and merge', () => {
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

  it('turns <br> into a newline and drops marks when a paragraph becomes code', async () => {
    const instance = await createEditor([
      { id: 'p', type: 'paragraph', data: { text: 'Line one<br>Line <b>bold</b>' } },
    ]);

    const code = await instance.blocks.convert('p', 'code');

    expect((await dataOf(instance, code.id))?.code).toBe('Line one\nLine bold');
  }, 30_000);

  it('decodes entities when a paragraph becomes code', async () => {
    const instance = await createEditor([
      { id: 'p', type: 'paragraph', data: { text: 'A &amp; &lt;x&gt;<br>B' } },
    ]);

    const code = await instance.blocks.convert('p', 'code');

    expect((await dataOf(instance, code.id))?.code).toBe('A & <x>\nB');
  }, 30_000);

  it.each([
    ['paragraph', 'text'],
    ['header', 'text'],
    ['quote', 'text'],
    ['list', 'text'],
    ['toggle', 'text'],
  ])('escapes code and turns newlines into <br> when code becomes %s', async (tool, field) => {
    const instance = await createEditor([
      { id: 'c', type: 'code', data: { code: SOURCE, language: 'plain' } },
    ]);

    const converted = await instance.blocks.convert('c', tool);

    expect((await dataOf(instance, converted.id))?.[field])
      .toBe('if (a &lt; b &amp;&amp; c) {<br>  x = "&lt;b&gt;";<br>}');
  }, 30_000);

  it('keeps the source intact on code → paragraph → code', async () => {
    const instance = await createEditor([
      { id: 'c', type: 'code', data: { code: SOURCE, language: 'plain' } },
    ]);

    const paragraph = await instance.blocks.convert('c', 'paragraph');
    const back = await instance.blocks.convert(paragraph.id, 'code');

    expect((await dataOf(instance, back.id))?.code).toBe(SOURCE);
  }, 30_000);

  it('merges a rich paragraph into code as plain text', async () => {
    const instance = await createEditor([
      { id: 'c', type: 'code', data: { code: 'x', language: 'plain' } },
      { id: 'p', type: 'paragraph', data: { text: 'A &amp; <b>b</b><br>c' } },
    ]);

    await instance.module.blockManager.mergeBlocks(blockById(instance, 'c'), blockById(instance, 'p'));

    expect((await dataOf(instance, 'c'))?.code).toBe('x\nA & b\nc');
  }, 30_000);

  it('merges code into a paragraph as escaped text', async () => {
    const instance = await createEditor([
      { id: 'p', type: 'paragraph', data: { text: 'Start ' } },
      { id: 'c', type: 'code', data: { code: SOURCE, language: 'plain' } },
    ]);

    await instance.module.blockManager.mergeBlocks(blockById(instance, 'p'), blockById(instance, 'c'));

    expect((await dataOf(instance, 'p'))?.text)
      .toBe('Start if (a &lt; b &amp;&amp; c) {<br>  x = "&lt;b&gt;";<br>}');
  }, 30_000);

  it('keeps both sources intact when code merges into code', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'code', data: { code: 'a < b', language: 'plain' } },
      { id: 'b', type: 'code', data: { code: SOURCE, language: 'plain' } },
    ]);

    await instance.module.blockManager.mergeBlocks(blockById(instance, 'a'), blockById(instance, 'b'));

    expect((await dataOf(instance, 'a'))?.code).toBe(`a < b\n${SOURCE}`);
  }, 30_000);
});
