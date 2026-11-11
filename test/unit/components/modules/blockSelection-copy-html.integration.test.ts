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
import { VideoTool } from '../../../../src/tools/video';
import { AudioTool } from '../../../../src/tools/audio';
import { FileTool } from '../../../../src/tools/file';
import { SpacerTool } from '../../../../src/tools/spacer';
import { TableOfContentsTool } from '../../../../src/tools/table-of-contents';
import { Embed } from '../../../../src/tools/link/embed';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Table } from '../../../../src/tools/table';
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

const createEditor = async (blocks: OutputBlockData[], extraTools: Record<string, unknown> = {}): Promise<TestEditor> => {
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
      video: VideoTool,
      audio: AudioTool,
      file: FileTool,
      spacer: SpacerTool,
      table_of_contents: TableOfContentsTool,
      embed: Embed,
      bookmark: Bookmark,
      table: Table,
      ...extraTools,
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

  it('writes a code block\'s language and filename on the <pre>, and the language class on the <code>', async () => {
    const instance = await createEditor([
      { id: 'c', type: 'code', data: { code: 'const a = 1;', language: 'javascript', filename: 'x.js' } },
    ]);

    const html = await copyAllAsHtml(instance);

    expect(html).toBe('<pre data-blok-code-language="javascript" data-blok-code-filename="x.js"><code class="language-javascript">const a = 1;</code></pre>');
  });

  it('writes no language for a plain text code block', async () => {
    const instance = await createEditor([
      { id: 'c', type: 'code', data: { code: 'x', language: 'plain text' } },
    ]);

    expect(await copyAllAsHtml(instance)).toBe('<pre><code>x</code></pre>');
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

describe('copy of media and layout blocks as text/html', () => {
  const shape = (html: string): string[] =>
    Array.from(parse(html).children).map((node) => node.outerHTML);

  it('writes an image as its img and its caption, without the alt button text', async () => {
    const instance = await createEditor([
      { id: 'i', type: 'image', data: { url: 'https://x/a.png', caption: 'Sunset', alt: 'Alt words' } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><img src="https://x/a.png"></p>',
      '<p>Sunset</p>',
    ]);
  });

  it('leaves a hidden image caption out', async () => {
    const instance = await createEditor([
      { id: 'i', type: 'image', data: { url: 'https://x/a.png', caption: 'hidden one', captionVisible: false } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual(['<p><img src="https://x/a.png"></p>']);
  });

  it('writes a video as a link to its url, without the player controls', async () => {
    const instance = await createEditor([
      { id: 'v', type: 'video', data: { url: 'https://x/bunny.mp4', fileName: 'bunny.mp4', caption: 'Video cap' } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><a href="https://x/bunny.mp4">bunny.mp4</a></p>',
      '<p>Video cap</p>',
    ]);
  });

  it('writes an audio as a link named by its title, without its cover image', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'audio', data: {
        url: 'https://x/song.mp3', title: 'Song', artist: 'Artist', coverUrl: 'https://x/cover.png', caption: 'Audio cap',
      } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><a href="https://x/song.mp3">Song</a></p>',
      '<p>Audio cap</p>',
    ]);
  });

  it('writes a file as a link named by its file name, without its size label', async () => {
    const instance = await createEditor([
      { id: 'f', type: 'file', data: { url: 'https://x/notes.txt', fileName: 'notes.txt', size: 1234, caption: 'File cap' } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><a href="https://x/notes.txt">notes.txt</a></p>',
      '<p>File cap</p>',
    ]);
  });

  it('writes a bookmark as one link named by its title, without its cover or favicon', async () => {
    const instance = await createEditor([
      { id: 'b', type: 'bookmark', data: {
        url: 'https://example.com/article', title: 'Article title', description: 'Article description',
        image: 'https://x/cover.png', favicon: 'https://x/fav.png', domain: 'example.com',
      } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><a href="https://example.com/article">Article title</a></p>',
    ]);
  });

  it('writes an embed as a link to its source, even with no caption', async () => {
    const instance = await createEditor([
      { id: 'e', type: 'embed', data: {
        service: 'youtube', source: 'https://www.youtube.com/watch?v=abc', embed: 'https://www.youtube.com/embed/abc',
      } },
    ]);

    expect(shape(await copyAllAsHtml(instance))).toEqual([
      '<p><a href="https://www.youtube.com/watch?v=abc">https://www.youtube.com/watch?v=abc</a></p>',
    ]);
  });

  it('writes nothing for a spacer or a table of contents', async () => {
    const instance = await createEditor([
      { id: 'a', type: 'paragraph', data: { text: 'Before' } },
      { id: 's', type: 'spacer', data: { height: 96 } },
      { id: 't', type: 'table_of_contents', data: {} },
      { id: 'b', type: 'paragraph', data: { text: 'After' } },
    ]);

    expect(await copyAllAsHtml(instance)).toBe('<p>Before</p><p>After</p>');
  });
});

describe('a tool\'s clipboardHtml hook', () => {
  const makeTool = (hooks: { clipboardHtml?: () => string | null; copyAsLink?: () => { url: string; text: string } | null }): unknown => {
    class Custom {
      public static clipboardHtml = hooks.clipboardHtml;
      public static copyAsLink = hooks.copyAsLink;

      public render(): HTMLElement {
        const element = document.createElement('div');

        element.textContent = 'Rendered UI';

        return element;
      }

      public save(): Record<string, unknown> {
        return {};
      }
    }

    return Custom;
  };

  it('writes the markup the hook returns instead of the rendered block', async () => {
    const instance = await createEditor([{ id: 'c', type: 'custom', data: {} }], {
      custom: makeTool({ clipboardHtml: () => '<p>From hook</p>' }),
    });

    expect(await copyAllAsHtml(instance)).toBe('<p>From hook</p>');
  });

  it('cleans the markup the hook returns', async () => {
    const instance = await createEditor([{ id: 'c', type: 'custom', data: {} }], {
      custom: makeTool({ clipboardHtml: () => '<p><a href="javascript:alert(1)">x</a><script>bad()</script></p>' }),
    });

    const html = await copyAllAsHtml(instance);

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('script');
  });

  it('falls back to the rendered block when the hook returns null or throws', async () => {
    const instance = await createEditor([
      { id: 'n', type: 'nullish', data: {} },
      { id: 't', type: 'throwing', data: {} },
    ], {
      nullish: makeTool({ clipboardHtml: () => null }),
      throwing: makeTool({ clipboardHtml: () => {
        throw new Error('boom');
      } }),
    });

    expect(await copyAllAsHtml(instance)).toBe('<p>Rendered UI</p><p>Rendered UI</p>');
  });

  it('lets copyAsLink win over the hook', async () => {
    const instance = await createEditor([{ id: 'c', type: 'custom', data: {} }], {
      custom: makeTool({ clipboardHtml: () => '<p>From hook</p>', copyAsLink: () => ({ url: 'https://x/page', text: 'Page' }) }),
    });

    expect(await copyAllAsHtml(instance)).toBe('<p><a href="https://x/page">Page</a></p>');
  });
});

describe('copy of a whole table as text/html', () => {
  const table = (): OutputBlockData[] => [
    { id: 't', type: 'table', data: { withHeadings: false, content: [
      [{ blocks: ['l1', 'l2'], color: 'red' }, { blocks: ['p1'] }],
      [{ blocks: ['p2'], colspan: 2 }, { blocks: [], mergedInto: [1, 0] }],
    ] } },
    { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' }, parent: 't' },
    { id: 'l2', type: 'list', data: { text: 'two', style: 'unordered' }, parent: 't' },
    { id: 'p1', type: 'paragraph', data: { text: 'plain' }, parent: 't' },
    { id: 'p2', type: 'paragraph', data: { text: 'wide' }, parent: 't' },
  ];

  it('keeps a list in a cell as a list', async () => {
    const instance = await createEditor(table());
    const root = parse(await copyAllAsHtml(instance));

    expect(Array.from(root.querySelectorAll('table td:first-child > ul > li')).map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('writes one cell per merge, with its span', async () => {
    const instance = await createEditor(table());
    const root = parse(await copyAllAsHtml(instance));
    const rows = Array.from(root.querySelectorAll('table tr'));

    expect(rows.map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent))).toEqual([['onetwo', 'plain'], ['wide']]);
    expect(rows[1].querySelector('td')?.getAttribute('colspan')).toBe('2');
  });

  it('leaves the cell payload out, so a paste in a cell takes the block copy', async () => {
    const instance = await createEditor(table());
    const root = parse(await copyAllAsHtml(instance));

    expect(root.querySelector('table')?.hasAttribute('data-blok-table-cells')).toBe(false);
  });

  it('writes the cell color', async () => {
    const instance = await createEditor(table());
    const root = parse(await copyAllAsHtml(instance));

    expect(root.querySelector('td')?.getAttribute('style')).toContain('background-color');
  });
});
