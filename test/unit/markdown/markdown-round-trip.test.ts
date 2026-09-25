import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { blocksToMarkdown, type SerializableBlock } from '../../../src/markdown/blocks-to-markdown';
import { blocksToMarkdown as viewBlocksToMarkdown } from '../../../src/view/blocks-to-markdown';
import { markdownToBlocks, markdownToBlocksWithReport } from '../../../src/markdown/index';
import type { InternalMarkdownImportConfig } from '../../../src/markdown/types';
import { markdownToHtml } from '../../../src/markdown/markdownToHtml';
import type { OutputBlockData } from '../../../types';

/**
 * Export with BOTH inline backends and require they agree.
 * @param blocks - blocks to serialize
 */
const exportBoth = (blocks: SerializableBlock[]): string => {
  const editor = blocksToMarkdown(blocks);
  const view = viewBlocksToMarkdown({
    blocks: blocks.map((block, index): OutputBlockData => ({
      id: block.id ?? `b${index}`,
      type: block.tool,
      data: block.data,
      ...(block.parentId ? { parent: block.parentId } : {}),
    })),
  });

  expect(view).toBe(editor);

  return editor;
};

const reimport = async (markdown: string): Promise<Awaited<ReturnType<typeof markdownToBlocksWithReport>>> =>
  markdownToBlocksWithReport(markdown);

describe('markdown round trip: <br> is a hard break', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a break as two trailing spaces, which a plain-text app does not show', () => {
    expect(exportBoth([{ tool: 'paragraph', data: { text: 'L1<br>L2' } }])).toBe('L1  \nL2');
  });

  it('writes a break-only line as a backslash, since a whitespace line would end the paragraph', async () => {
    const markdown = exportBoth([{ tool: 'paragraph', data: { text: '<br>a<br><br>b' } }]);

    expect(markdown).toBe('\\\na  \n\\\nb');

    const { blocks } = await reimport(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.text).toBe('<br>a<br><br>b');
  });

  it.each(['paragraph', 'quote'])('gives a %s its <br> back', async (tool) => {
    const markdown = exportBoth([{ tool, data: { text: 'L1<br>L2' } }]);
    const { blocks } = await reimport(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: tool, data: { text: 'L1<br>L2' } });
  });

  it('gives a list item its <br> back', async () => {
    const markdown = exportBoth([{ tool: 'list', data: { text: 'L1<br>L2', style: 'unordered' } }]);
    const { blocks } = await reimport(markdown);

    expect(blocks[0]).toMatchObject({ type: 'list', data: { text: 'L1<br>L2' } });
  });

  it('keeps a blank line inside a quote', async () => {
    const markdown = exportBoth([{ tool: 'quote', data: { text: 'a<br><br>b' } }]);
    const { blocks } = await reimport(markdown);

    expect(blocks[0]).toMatchObject({ type: 'quote', data: { text: 'a<br><br>b' } });
  });

  it('drops a trailing filler <br> instead of writing a literal backslash', async () => {
    const markdown = exportBoth([{ tool: 'paragraph', data: { text: 'end<br><br>' } }]);

    expect(markdown).toBe('end');
    expect(exportBoth([{ tool: 'paragraph', data: { text: '<br>' } }])).toBe('');
  });

  it('gives a heading its <br> back as one heading block', async () => {
    const markdown = exportBoth([{ tool: 'header', data: { text: 'L1<br>L2', level: 2 } }]);
    const { blocks, warnings } = await reimport(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'header', data: { text: 'L1<br>L2', level: 2 } });
    expect(warnings).toEqual([]);
  });

  it('gives a table cell its <br> back', async () => {
    const markdown = exportBoth([
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['h'] }], [{ blocks: ['c'] }]] } },
      { id: 'h', tool: 'paragraph', data: { text: 'head' }, parentId: 't' },
      { id: 'c', tool: 'paragraph', data: { text: 'L1<br>L2' }, parentId: 't' },
    ]);

    expect(markdown).toBe('| head |\n| --- |\n| L1<br>L2 |');

    const { blocks, warnings } = await reimport(markdown);

    expect(blocks.map((block) => block.data.text)).toContain('L1<br>L2');
    expect(warnings).toEqual([]);
  });

  it('keeps a table without a heading row headless', async () => {
    const markdown = exportBoth([
      { id: 't', tool: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }], [{ blocks: ['b'] }]] } },
      { id: 'a', tool: 'paragraph', data: { text: 'one' }, parentId: 't' },
      { id: 'b', tool: 'paragraph', data: { text: 'two' }, parentId: 't' },
    ]);
    const { blocks } = await reimport(markdown);
    const table = blocks.find((block) => block.type === 'table');

    expect(table?.data.withHeadings).toBe(false);
    expect(table?.data.content).toHaveLength(2);
    expect(blocks.filter((block) => block.type === 'paragraph').map((block) => block.data.text)).toEqual(['one', 'two']);
  });
});

describe('markdown import: raw <br>', () => {
  it('reads a bare <br> or <br/> as a line break without a warning', async () => {
    const { blocks, warnings } = await reimport('a<br/>b<BR>c');

    expect(blocks[0].data.text).toBe('a<br>b<br>c');
    expect(warnings).toEqual([]);
  });

  it('reads a <br> alone on its line as an empty paragraph, not escaped text', async () => {
    const { blocks, warnings } = await reimport('a\n\n<br>\n\nb');

    expect(blocks.map((block) => block.data.text)).toEqual(['a', '', 'b']);
    expect(warnings).toEqual([]);
  });

  it('still escapes a <br> that carries attributes', async () => {
    const { blocks, warnings } = await reimport('a<br onclick="x()">b');

    expect(blocks[0].data.text).toBe('a&lt;br onclick=&quot;x()&quot;&gt;b');
    expect(warnings).toHaveLength(1);
  });

  it('renders a bare <br> as a break in the preview', async () => {
    expect(await markdownToHtml('## L1<br>L2')).toContain('L1<br>L2');
    expect(await markdownToHtml('a<br onclick="x()">b')).toContain('&lt;br onclick');
  });
});

describe('markdown import: blockquote content never vanishes', () => {
  it('keeps a code block inside a quote as a code block, and warns', async () => {
    const { blocks, warnings } = await reimport('> intro\n>\n> ```js\n> let a = 1;\n> ```');

    expect(blocks.map((block) => block.type)).toEqual(['quote', 'code']);
    expect(blocks[0].data.text).toBe('intro');
    expect(blocks[1].data).toMatchObject({ code: 'let a = 1;' });
    expect(warnings).toEqual([expect.objectContaining({ construct: 'blockquote', action: 'degraded' })]);
  });

  it('keeps a list inside a quote as list blocks', async () => {
    const { blocks, warnings } = await reimport('> - one\n> - two');

    expect(blocks.map((block) => `${block.type}:${String(block.data.text)}`)).toEqual(['list:one', 'list:two']);
    expect(warnings).toHaveLength(1);
  });

  it('keeps a nested quote and the text after it, in order', async () => {
    const { blocks } = await reimport('> outer\n>\n> > inner\n>\n> after');

    expect(blocks.map((block) => `${block.type}:${String(block.data.text)}`))
      .toEqual(['quote:outer', 'quote:inner', 'quote:after']);
  });
});

describe('markdown import: GitHub alerts become callouts', () => {
  it('maps > [!NOTE] to a callout that owns its body', async () => {
    const { blocks, warnings } = await reimport('> [!NOTE]\n> n');
    const [callout, ...children] = blocks;

    expect(callout).toMatchObject({ type: 'callout', data: { emoji: 'ℹ️', textColor: null, backgroundColor: 'blue' } });
    expect(children.map((block) => block.data.text)).toEqual(['n']);
    expect(children.every((block) => block.parent === callout.id)).toBe(true);
    expect(callout.content).toEqual(children.map((block) => block.id));
    expect(warnings).toEqual([]);
  });

  it.each([
    ['TIP', '💡', 'green'],
    ['IMPORTANT', '❗', 'purple'],
    ['WARNING', '⚠️', 'orange'],
    ['CAUTION', '🛑', 'red'],
  ])('gives [!%s] its own emoji and colour', async (kind, emoji, backgroundColor) => {
    const { blocks } = await reimport(`> [!${kind}]\n> body`);

    expect(blocks[0]).toMatchObject({ type: 'callout', data: { emoji, backgroundColor } });
  });

  it('keeps the line breaks in an alert body', async () => {
    const { blocks } = await reimport('> [!NOTE]\n> a  \n> b');

    expect(blocks[1].data.text).toBe('a<br>b');
    expect(await markdownToHtml('> [!NOTE]\n> a  \n> b')).toContain('a<br>b');
  });

  it('keeps soft breaks in an alert body when the paste path asks for them', async () => {
    const config: InternalMarkdownImportConfig = { softBreaks: true };
    const blocks = await markdownToBlocks('> [!NOTE]\n> a\n> b', config);

    expect(blocks[1].data.text).toBe('a<br>b');
  });

  it('gives a bodyless alert one empty paragraph to type in', async () => {
    const { blocks } = await reimport('> [!NOTE]');
    const [callout, ...children] = blocks;

    expect(children).toEqual([expect.objectContaining({ type: 'paragraph', data: { text: '' }, parent: callout.id })]);
    expect(callout.content).toEqual([children[0].id]);
  });

  it('keeps a list in an alert body as child blocks', async () => {
    const { blocks } = await reimport('> [!TIP]\n> - a\n> - b');
    const [callout, ...children] = blocks;

    expect(children.map((block) => `${block.type}:${String(block.data.text)}`)).toEqual(['list:a', 'list:b']);
    expect(children.every((block) => block.parent === callout.id)).toBe(true);
  });
});
