import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { Quote } from '../../../../src/tools/quote';
import { CodeTool } from '../../../../src/tools/code';
import { ImageTool } from '../../../../src/tools/image';
import { DividerTool } from '../../../../src/tools/divider';
import { ToggleItem } from '../../../../src/tools/toggle';
import { CalloutTool } from '../../../../src/tools/callout';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import { ListItem } from '../../../../src/tools/list';
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
    tools: {
      paragraph: Paragraph,
      header: Header,
      quote: Quote,
      code: CodeTool,
      image: ImageTool,
      divider: DividerTool,
      toggle: ToggleItem,
      callout: CalloutTool,
      tabs: TabsTool,
      tab: TabTool,
      list: ListItem,
    },
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

describe('copy of an image block as text/html', () => {
  const imageSrcs = (html: string): Array<string | null> =>
    Array.from(parse(html).querySelectorAll('img')).map((img) => img.getAttribute('src'));

  it('writes a plain image as an img', async () => {
    const instance = await createEditor([{ id: 'i', type: 'image', data: { url: 'https://x/a.jpg' } }]);

    expect(imageSrcs(await copyAllAsHtml(instance))).toEqual(['https://x/a.jpg']);
  });

  it('writes an image with variants as an img pointing at the compatible url', async () => {
    const instance = await createEditor([{ id: 'i', type: 'image', data: { url: 'https://x/a.jpg', variants: [
      { url: 'https://x/a.avif', mimeType: 'image/avif' },
      { url: 'https://x/a.jpg', mimeType: 'image/jpeg' },
    ] } }]);

    expect(imageSrcs(await copyAllAsHtml(instance))).toEqual(['https://x/a.jpg']);
  });
});


describe('copy of dividers and containers as text/html', () => {
  const shape = (html: string): string[] =>
    Array.from(parse(html).children).map((node) => node.outerHTML);

  it('writes a divider as an hr', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'paragraph', data: { text: 'Before' } },
      { id: 'd', type: 'divider', data: {} },
      { id: 'b', type: 'paragraph', data: { text: 'After' } },
    ]);

    expect(await copyAllAsHtml(instance)).toBe('<p>Before</p><hr><p>After</p>');
  });

  it('writes a toggle as details, with its children inside it', async () => {
    const instance = await createEditor([
      { id: 't', type: 'toggle', data: { text: 'Title <strong>x</strong>' }, content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: 'Child' }, parent: 't' },
      { id: 'z', type: 'paragraph', data: { text: 'After' } },
    ]);

    const root = parse(await copyAllAsHtml(instance));

    expect(root.querySelector(':scope > details > summary')?.innerHTML).toBe('Title <strong>x</strong>');
    expect(Array.from(root.querySelectorAll(':scope > details > p')).map((p) => p.textContent)).toEqual(['Child']);
    expect(Array.from(root.querySelectorAll(':scope > p')).map((p) => p.textContent)).toEqual(['After']);
  });

  it('writes a toggle heading as details holding its heading in the summary', async () => {
    const instance = await createEditor([
      { id: 'h', type: 'header', data: { text: 'Head', level: 2, isToggleable: true }, content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: 'Under' }, parent: 'h' },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<details><summary><h2>Head</h2></summary><p>Under</p></details>',
    ]);
  });

  it('writes a callout as an aside around its children, without its emoji', async () => {
    const instance = await createEditor([
      { id: 'k', type: 'callout', data: { emoji: '💡' }, content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: 'Inside' }, parent: 'k' },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual(['<aside><p>Inside</p></aside>']);
  });

  it('writes a toggle inside a callout inside the aside', async () => {
    const instance = await createEditor([
      { id: 'k', type: 'callout', data: { emoji: '💡' }, content: ['t'] },
      { id: 't', type: 'toggle', data: { text: 'T' }, parent: 'k', content: ['c'] },
      { id: 'c', type: 'paragraph', data: { text: 'Deep' }, parent: 't' },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<aside><details><summary>T</summary><p>Deep</p></details></aside>',
    ]);
  });

  it('does not merge list items inside a toggle with the list items around it', async () => {
    const instance = await createEditor([
      { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 't', type: 'toggle', data: { text: 'T' }, content: ['l2'] },
      { id: 'l2', type: 'list', data: { text: 'two', style: 'unordered' }, parent: 't' },
      { id: 'l3', type: 'list', data: { text: 'three', style: 'unordered' } },
    ]);

    const root = parse(await copyAllAsHtml(instance));

    expect(Array.from(root.children).map((node) => node.tagName)).toEqual(['UL', 'DETAILS', 'UL']);
    expect(root.querySelector(':scope > details > ul')?.textContent).toBe('two');
  });

  it('writes each tab title before its body', async () => {
    const instance = await createEditor([
      { id: 'tb', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tb', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'Alpha body' }, parent: 't1' },
      { id: 't2', type: 'tab', data: { title: 'Beta', icon: '🍎' }, parent: 'tb', content: ['p2'] },
      { id: 'p2', type: 'paragraph', data: { text: 'Beta body' }, parent: 't2' },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><strong>Alpha</strong></p>',
      '<p>Alpha body</p>',
      '<p><strong>🍎 Beta</strong></p>',
      '<p>Beta body</p>',
    ]);
  });
});
