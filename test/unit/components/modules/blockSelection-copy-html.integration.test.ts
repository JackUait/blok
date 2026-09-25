import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { Quote } from '../../../../src/tools/quote';
import { CodeTool } from '../../../../src/tools/code';
import type { OutputBlockData } from '../../../../types';
import type { Block } from '../../../../src/components/block';
import type { CrossBlockSubRange } from '../../../../src/components/selection/cross-block-range';

/**
 * What a copy of whole blocks puts on the clipboard for OTHER apps (Word,
 * Google Docs, mail). Runs the real copy handler on a real editor, so the
 * rendered DOM is what the tools actually build.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  module: { blockManager: { blocks: Block[] }; blockSelection: BlockSelection };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, quote: Quote, code: CodeTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const recordingEvent = (written: Map<string, string>): ClipboardEvent => ({
  preventDefault: () => undefined,
  clipboardData: {
    setData: (type: string, value: string): void => {
      written.set(type, value);
    },
  },
}) as unknown as ClipboardEvent;

const copyAllAsHtml = async (instance: TestEditor): Promise<string> => {
  const written = new Map<string, string>();

  const { blockSelection } = instance.module;

  blockSelection.allBlocksSelected = true;
  await blockSelection.copySelectedBlocks(recordingEvent(written));

  return written.get('text/html') ?? '';
};

const parse = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

beforeEach(() => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

describe('copy of whole blocks as text/html', () => {
  it('keeps every inline mark a paragraph stores', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'paragraph', data: { text: '<strong>b</strong> <em>i</em> <s>s</s> <code>c</code> <u>u</u>' } },
    ]);

    const html = await copyAllAsHtml(instance);

    expect(html).toBe('<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code> <u>u</u></p>');
  });

  it('writes every block as its own element, so marked blocks do not run together', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'paragraph', data: { text: 'one <i>x</i>' } },
      { id: 'b', type: 'paragraph', data: { text: 'two' } },
      { id: 'q', type: 'quote', data: { text: 'q <i>y</i>' } },
      { id: 'h', type: 'header', data: { text: 'H', level: 2 } },
    ]);

    const root = parse(await copyAllAsHtml(instance));

    expect(Array.from(root.childNodes).map((node) => (node as Element).outerHTML ?? node.textContent)).toEqual([
      '<p>one <i>x</i></p>',
      '<p>two</p>',
      '<blockquote>q <i>y</i></blockquote>',
      '<h2>H</h2>',
    ]);
  });

  it('writes a code block as <pre><code> with its text escaped', async () => {
    const instance = await createEditor([
      { id: 'c', type: 'code', data: { code: 'line1\nline2\n  <b>&', language: 'plain' } },
    ]);

    const html = await copyAllAsHtml(instance);

    expect(html).toBe('<pre><code>line1\nline2\n  &lt;b&gt;&amp;</code></pre>');
  });

  it('writes marker colors as literal values other apps can read', async () => {
    const instance = await createEditor([
      {
        id: 'm',
        type: 'paragraph',
        data: { text: '<mark style="color: var(--blok-color-red-text); background-color: var(--blok-color-blue-bg);">hot</mark>' },
      },
    ]);

    const html = await copyAllAsHtml(instance);

    expect(html).not.toContain('var(');
    expect(parse(html).querySelector('mark')?.getAttribute('style')).toBe('color: #d44c47; background-color: #e7f3f8;');
  });
});

describe('copy of a text selection across blocks as text/plain', () => {
  it('turns a <br> line break into a newline', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'paragraph', data: { text: 'line1<br>line2' } },
      { id: 'b', type: 'paragraph', data: { text: 'next' } },
    ]);
    const [first, second] = instance.module.blockManager.blocks;
    const subRange = (block: Block): CrossBlockSubRange => {
      const input = block.holder.querySelector<HTMLElement>('[contenteditable]') ?? block.holder;
      const range = document.createRange();

      range.selectNodeContents(input);

      return { block, input, range, coversWholeInput: false };
    };
    const subRanges = [subRange(first), subRange(second)];
    const written = new Map<string, string>();

    instance.module.blockSelection.copyCrossBlockTextSelection(recordingEvent(written), {
      range: subRanges[0].range,
      subRanges,
      startBlock: first,
      endBlock: second,
    });

    expect(written.get('text/plain')).toBe('line1\nline2\n\nnext');
  });
});
