import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { blocksToMarkdown, blocksToMarkdownWithReport, type SerializableBlock } from '../../../src/markdown/blocks-to-markdown';
import { blocksToMarkdown as viewBlocksToMarkdown } from '../../../src/view/blocks-to-markdown';
import { markdownToBlocks as markdownToSegmentBlocks, markdownToBlocksWithReport } from '../../../src/markdown/index';
import type { MarkdownImportConfig } from '../../../src/markdown/index';
import type { InternalMarkdownImportConfig } from '../../../src/markdown/types';
import { markdownToHtml } from '../../../src/markdown/markdownToHtml';
import type { OutputBlockData } from '../../../types';
import { richTextAsHtml } from '../helpers/rich-text-as-html';

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

/** Rich fields read back as HTML, the shape the exporters above take. */
const reimport = async (markdown: string): Promise<Awaited<ReturnType<typeof markdownToBlocksWithReport>>> => {
  const result = await markdownToBlocksWithReport(markdown);

  return { ...result, blocks: richTextAsHtml(result.blocks) };
};

const markdownToBlocks = async (markdown: string, config?: MarkdownImportConfig): Promise<OutputBlockData[]> =>
  richTextAsHtml(await markdownToSegmentBlocks(markdown, config));

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
    const { blocks, warnings } = await markdownToBlocksWithReport('a<br onclick="x()">b');

    expect(blocks[0].data.text).toEqual([{ text: 'a<br onclick="x()">b' }]);
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

describe('markdown round trip: code block filename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const codeBlock = (data: Record<string, unknown>): SerializableBlock[] => [{ tool: 'code', data: { code: 'x', ...data } }];

  /**
   * Export, re-import, and return the one code block's data.
   * @param data - code block data to round-trip
   */
  const roundTrip = async (data: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { blocks } = await reimport(exportBoth(codeBlock(data)));

    expect(blocks.map((block) => block.type)).toEqual(['code']);

    return blocks[0].data;
  };

  it('puts the filename in the fence info string as a title attribute', () => {
    expect(exportBoth(codeBlock({ language: 'typescript', filename: 'block.ts' })))
      .toBe('```typescript title="block.ts"\nx\n```');
  });

  it('exports a block without a filename exactly as before', () => {
    expect(exportBoth(codeBlock({ language: 'typescript' }))).toBe('```typescript\nx\n```');
    expect(exportBoth(codeBlock({ language: 'plain text' }))).toBe('```\nx\n```');
  });

  it('treats an empty or blank filename as no filename', () => {
    expect(exportBoth(codeBlock({ language: 'typescript', filename: '' }))).toBe('```typescript\nx\n```');
    expect(exportBoth(codeBlock({ language: 'typescript', filename: '   ' }))).toBe('```typescript\nx\n```');
  });

  it('keeps the filename and language through export and import', async () => {
    expect(await roundTrip({ language: 'typescript', filename: 'block.ts' }))
      .toEqual({ code: 'x', language: 'typescript', filename: 'block.ts' });
  });

  it('names plain text "text" when a filename needs a language word, and reads it back as plain text', async () => {
    expect(exportBoth(codeBlock({ language: 'plain text', filename: 'notes.txt' })))
      .toBe('```text title="notes.txt"\nx\n```');
    expect(await roundTrip({ language: 'plain text', filename: 'notes.txt' }))
      .toEqual({ code: 'x', language: 'plain text', filename: 'notes.txt' });
  });

  it('keeps spaces, backslashes and entity-like text in the filename', async () => {
    const filename = 'my file\\v2 &amp; more.ts';

    expect(exportBoth(codeBlock({ language: 'typescript', filename })))
      .toBe('```typescript title="my file\\\\v2 \\&amp; more.ts"\nx\n```');
    expect(await roundTrip({ language: 'typescript', filename }))
      .toEqual({ code: 'x', language: 'typescript', filename });
  });

  it('quotes a filename holding double quotes with single quotes', async () => {
    const filename = 'say "hi" there.ts';

    expect(exportBoth(codeBlock({ language: 'typescript', filename })))
      .toBe('```typescript title=\'say "hi" there.ts\'\nx\n```');
    expect(await roundTrip({ language: 'typescript', filename }))
      .toEqual({ code: 'x', language: 'typescript', filename });
  });

  it('keeps a filename holding both quote kinds when no quote is followed by a space', async () => {
    expect(await roundTrip({ language: 'typescript', filename: 'a"b\'c.ts' }))
      .toEqual({ code: 'x', language: 'typescript', filename: 'a"b\'c.ts' });
  });

  /** Known limit: the parser decodes `\"` before the importer sees it, so this case cannot round-trip. */
  it('cuts a filename holding both quote kinds at a double quote followed by a space', async () => {
    expect(await roundTrip({ language: 'typescript', filename: 'it\'s "x" y.ts' }))
      .toEqual({ code: 'x', language: 'typescript', filename: 'it\'s "x' });
  });

  it('switches to a tilde fence when the filename has a backtick', async () => {
    expect(exportBoth(codeBlock({ language: 'typescript', filename: 'a`b.ts' })))
      .toBe('~~~typescript title="a`b.ts"\nx\n~~~');
    expect(await roundTrip({ language: 'typescript', filename: 'a`b.ts' }))
      .toEqual({ code: 'x', language: 'typescript', filename: 'a`b.ts' });
  });

  it('folds a line break in the filename into a space, since the info string is one line', async () => {
    expect(await roundTrip({ language: 'typescript', filename: 'a\nb.ts' }))
      .toEqual({ code: 'x', language: 'typescript', filename: 'a b.ts' });
  });
});

describe('markdown import: code fence title', () => {
  const importCode = async (markdown: string): Promise<Record<string, unknown>> => {
    const { blocks } = await reimport(markdown);

    expect(blocks.map((block) => block.type)).toEqual(['code']);

    return blocks[0].data;
  };

  it('reads single-quoted and bare titles', async () => {
    expect(await importCode("```ts title='x y.ts'\nx\n```")).toEqual({ code: 'x', language: 'typescript', filename: 'x y.ts' });
    expect(await importCode('```ts title=bare.ts\nx\n```')).toEqual({ code: 'x', language: 'typescript', filename: 'bare.ts' });
  });

  it('reads a title among other fence attributes', async () => {
    expect(await importCode('```ts {1,3} title="a.ts" showLineNumbers\nx\n```'))
      .toEqual({ code: 'x', language: 'typescript', filename: 'a.ts' });
  });

  it('stops a quoted title at its own closing quote, not a later attribute\'s', async () => {
    expect(await importCode('```ts title="a.ts" frame="none"\nx\n```'))
      .toEqual({ code: 'x', language: 'typescript', filename: 'a.ts' });
    expect(await importCode("```ts title='a.ts' frame='none'\nx\n```"))
      .toEqual({ code: 'x', language: 'typescript', filename: 'a.ts' });
  });

  it('adds no filename key when the fence has no title', async () => {
    expect(await importCode('```ts\nx\n```')).toEqual({ code: 'x', language: 'typescript' });
    expect(await importCode('```ts {1,3}\nx\n```')).toEqual({ code: 'x', language: 'typescript' });
    expect(await importCode('```ts title=""\nx\n```')).toEqual({ code: 'x', language: 'typescript' });
  });

  it('keeps a bare text fence as language "text", as before', async () => {
    expect(await importCode('```text\nx\n```')).toEqual({ code: 'x', language: 'text' });
  });
});

describe('markdown round trip: literal text is escaped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const roundTripText = async (text: string, tool = 'paragraph'): Promise<string> => {
    const { blocks } = await reimport(exportBoth([{ tool, data: { text } }]));

    expect(blocks).toHaveLength(1);

    return String(blocks[0].data.text);
  };

  it.each([
    ['*not italic*'],
    ['_not italic_ either'],
    ['**not bold**'],
    ['~~not struck~~ and ~one~'],
    ['a `tick` b'],
    ['[not a link](x)'],
    ['![not an image](x.png)'],
    ['a &lt;br&gt; b'],
    ['a &lt;b&gt;bold?&lt;/b&gt; b'],
    ['&lt;span&gt; and &lt;/p&gt;'],
    ['the &amp;copy; entity, &amp;#169; too'],
    ['back\\slash \\* and C:\\path\\'],
    ['# not a heading'],
    ['&gt; not a quote'],
    ['- not a list'],
    ['+ not a list'],
    ['1. not ordered'],
    ['2) not ordered'],
    ['---'],
    ['==='],
    ['line<br># not a heading<br>- not a list<br>---'],
    ['$x$ is not math'],
    ['from $5 to $10'],
  ])('keeps %s literal', async (text) => {
    expect(await roundTripText(text)).toBe(text);
  });

  it('keeps literal markup in a heading, a quote and a list item', async () => {
    expect(await roundTripText('*a* [b]', 'header')).toBe('*a* [b]');
    expect(await roundTripText('*a* [b]', 'quote')).toBe('*a* [b]');
    expect(await roundTripText('*a* [b]', 'list')).toBe('*a* [b]');
  });

  it('keeps a heading that ends in a hash', async () => {
    expect(await roundTripText('Issue #', 'header')).toBe('Issue #');
    expect(await roundTripText('C# and F##', 'header')).toBe('C# and F##');
  });

  it('does not carry a legacy cached page title into Markdown or its import', async () => {
    const markdown = exportBoth([
      { tool: 'page', data: { pageId: 'p1', cache: { title: '*restricted* [title]' } } },
    ]);

    expect(markdown).toBe('Page');

    const { blocks } = await reimport(markdown);

    expect(blocks[0].data.text).toBe('Page');
  });

  it('keeps literal markup in a file name used as a link label', async () => {
    const markdown = exportBoth([
      { tool: 'file', data: { url: 'https://e.test/f.pdf', fileName: 'a]b *c*.pdf' } },
    ]);
    const { blocks } = await reimport(markdown);

    expect(blocks[0].data.text).toContain('>a]b *c*.pdf</a>');
  });

  it('trims spaces around an equation source so it still reads as math', () => {
    expect(exportBoth([{ tool: 'paragraph', data: { text: 'E <span data-latex=" x^2 "></span>' } }])).toBe('E $x^2$');
  });

  it('leaves text that carries no Markdown meaning unescaped', () => {
    const plain = 'snake_case_name, 2 * 3 = 6, AT&T, a < b, costs $5, 3.14 and -5 and https://e.test/a_b_c~d?x=1&y=2';

    expect(exportBoth([{ tool: 'paragraph', data: { text: plain.replace(/&/g, '&amp;').replace(/</g, '&lt;') } }])).toBe(plain);
  });

  it('keeps the characters of a bare URL in text, which GFM still links', async () => {
    const text = 'see https://e.test/_a_/b~c~d?x=1&amp;y=*2* now';
    const back = await roundTripText(text);

    expect(back.replace(/<[^>]*>/g, '')).toBe(text);
  });

  it('does not escape inside inline code or a link target', async () => {
    const text = '<code>*a* [b] &lt;c&gt;</code> <a href="https://e.test/?q=*a*_b_">*l*</a>';
    const markdown = exportBoth([{ tool: 'paragraph', data: { text } }]);

    expect(markdown).toBe('`*a* [b] <c>` [\\*l\\*](https://e.test/?q=*a*_b_)');

    const back = await roundTripText(text);

    expect(back).toContain('<code>*a* [b] &lt;c&gt;</code>');
    expect(back).toContain('href="https://e.test/?q=*a*_b_"');
    expect(back).toContain('>*l*</a>');
  });

  it('writes inline code holding a backtick with a longer fence', async () => {
    expect(await roundTripText('<code>a`b</code>')).toBe('<code>a`b</code>');
  });

  it('exports an inline equation in $ delimiters', () => {
    expect(exportBoth([{ tool: 'paragraph', data: { text: 'E <span data-latex="x^2"></span> end' } }])).toBe('E $x^2$ end');
  });

  it('keeps a price range next to an equation as text', async () => {
    const markdown = exportBoth([{ tool: 'paragraph', data: { text: 'E <span data-latex="x"></span> costs $5-$10 or $3' } }]);
    const { blocks } = await reimport(markdown);
    const texts = blocks.map((block) => String(block.data.text ?? block.data.code));

    expect(texts.join('|')).toContain('costs $5-$10 or $3');
    expect(blocks.some((block) => block.data.code === 'x')).toBe(true);
  });
});

describe('markdown round trip: a callout is a GitHub alert', () => {
  const callout = (data: Record<string, unknown>, children: SerializableBlock[]): SerializableBlock[] => [
    { id: 'cal', tool: 'callout', data, contentIds: children.map((child) => child.id ?? '') },
    ...children.map((child) => ({ ...child, parentId: 'cal' })),
  ];

  /** Type, text and parent tool of every block, the shape a round trip must keep. */
  const shape = (blocks: OutputBlockData[]): string[] => blocks.map((block) => {
    const parent = blocks.find((other) => other.id === block.parent);

    return `${block.type}:${typeof block.data.text === 'string' ? block.data.text : ''}<${parent?.type ?? '-'}`;
  });

  it('writes a default callout as an alert marker line, then its children as separate blocks', async () => {
    const markdown = exportBoth(callout({ emoji: '💡', textColor: null, backgroundColor: null }, [
      { id: 'p', tool: 'paragraph', data: { text: 'Body' } },
      { id: 'l', tool: 'list', data: { text: 'Item', style: 'unordered' } },
    ]));

    expect(markdown).toBe('> [!CALLOUT]\n> \n> Body\n> \n> - Item');

    const { blocks, warnings } = await reimport(markdown);

    expect(blocks[0].data).toEqual({ emoji: '💡', textColor: null, backgroundColor: null });
    expect(shape(blocks)).toEqual(['callout:<-', 'paragraph:Body<callout', 'list:Item<callout']);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['NOTE', 'ℹ️', 'blue'],
    ['TIP', '💡', 'green'],
    ['IMPORTANT', '❗', 'purple'],
    ['WARNING', '⚠️', 'orange'],
    ['CAUTION', '🛑', 'red'],
  ])('writes a callout styled like a GitHub [!%s] as that alert, and it comes back the same', async (kind, emoji, backgroundColor) => {
    const markdown = exportBoth(callout({ emoji, textColor: null, backgroundColor }, [{ id: 'p', tool: 'paragraph', data: { text: 'Body' } }]));

    expect(markdown).toBe(`> [!${kind}]\n> \n> Body`);
    expect((await reimport(markdown)).blocks[0].data).toEqual({ emoji, textColor: null, backgroundColor });
  });

  it.each<[string, SerializableBlock[], string[]]>([
    ['a paragraph', [{ id: 'c', tool: 'paragraph', data: { text: 'Para' } }], ['paragraph:Para<callout']],
    ['a list', [{ id: 'c', tool: 'list', data: { text: 'One', style: 'unordered' } }], ['list:One<callout']],
    ['a code block', [{ id: 'c', tool: 'code', data: { code: 'x = 1', language: 'plain text' } }], ['code:<callout']],
    ['a heading', [{ id: 'c', tool: 'header', data: { text: 'Head', level: 2 } }], ['header:Head<callout']],
    ['a quote', [{ id: 'c', tool: 'quote', data: { text: 'Said', size: 'default' } }], ['quote:Said<callout']],
    ['nothing', [], ['paragraph:<callout']],
  ])('keeps %s as the first child inside the callout', async (_name, children, expected) => {
    const { blocks } = await reimport(exportBoth(callout({ emoji: '💡' }, children)));

    expect(shape(blocks)).toEqual(['callout:<-', ...expected]);
  });

  it('keeps a table as a child of the callout', async () => {
    const markdown = exportBoth(callout({ emoji: '💡' }, [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [['A', 'B'], ['1', '2']] } },
    ]));
    const { blocks } = await reimport(markdown);

    expect(blocks.find((block) => block.type === 'table')?.parent).toBe(blocks[0].id);
  });

  it('keeps a callout inside a callout', async () => {
    const markdown = exportBoth([
      { id: 'outer', tool: 'callout', data: { emoji: '💡' }, contentIds: ['inner'] },
      { id: 'inner', tool: 'callout', data: { emoji: '⚠️', backgroundColor: 'orange' }, parentId: 'outer', contentIds: ['p'] },
      { id: 'p', tool: 'paragraph', data: { text: 'Deep' }, parentId: 'inner' },
    ]);
    const { blocks } = await reimport(markdown);

    expect(shape(blocks)).toEqual(['callout:<-', 'callout:<callout', 'paragraph:Deep<callout']);
    expect(blocks[1].data).toMatchObject({ emoji: '⚠️', backgroundColor: 'orange' });
  });

  it('reports the emoji and colours a custom callout loses', () => {
    const { markdown, warnings } = blocksToMarkdownWithReport(callout({ emoji: '🔥', textColor: 'red', backgroundColor: 'red' }, [
      { id: 'p', tool: 'paragraph', data: { text: 'Hot' } },
    ]));

    expect(markdown).toBe('> [!CALLOUT]\n> \n> Hot');
    expect(warnings).toEqual([{ construct: 'callout', action: 'degraded', detail: expect.stringContaining('emoji') }]);
  });

  it('reports nothing for a callout that comes back the same', () => {
    expect(blocksToMarkdownWithReport(callout({ emoji: '💡' }, [{ id: 'p', tool: 'paragraph', data: { text: 'x' } }])).warnings).toEqual([]);
    expect(blocksToMarkdownWithReport(callout({ emoji: '⚠️', backgroundColor: 'orange' }, [{ id: 'p', tool: 'paragraph', data: { text: 'x' } }])).warnings).toEqual([]);
  });

  it('still reads a real GitHub [!TIP] as the green tip callout', async () => {
    expect((await reimport('> [!TIP]\n> Use it')).blocks[0].data).toEqual({ emoji: '💡', textColor: null, backgroundColor: 'green' });
  });
});

describe('markdown export: a database is a GFM table', () => {
  const schema = [
    { id: 'name', name: 'Name', type: 'title', position: 'a0' },
    { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Doing', position: 'a0' }] } },
    { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a2', config: { options: [{ id: 't1', label: 'red', position: 'a0' }, { id: 't2', label: 'a|b', position: 'a1' }] } },
    { id: 'points', name: 'Points', type: 'number', position: 'a3' },
    { id: 'done', name: 'Done', type: 'checkbox', position: 'a4' },
    { id: 'due', name: 'Due', type: 'date', position: 'a5' },
    { id: 'note', name: 'Note', type: 'text', position: 'a6' },
    { id: 'link', name: 'Link', type: 'relation', position: 'a7' },
  ];
  const database: SerializableBlock[] = [
    { id: 'db', tool: 'database', data: { title: 'Tasks', schema }, contentIds: ['r1', 'r2'] },
    {
      id: 'r1', tool: 'database-row', parentId: 'db', contentIds: ['body'],
      data: { position: 'a0', title: 'First', properties: { status: 'o1', tags: ['t1', 't2'], points: 3, done: true, due: '2026-01-02', note: 'a *b*' } },
    },
    { id: 'r2', tool: 'database-row', parentId: 'db', data: { position: 'a1', properties: { name: 'Second', link: [{ id: 'r1' }, { id: 'gone' }] } } },
    { id: 'body', tool: 'paragraph', parentId: 'r1', data: { text: 'Row body' } },
  ];

  it('writes the title, a table of row titles and property values, then each row body', () => {
    expect(exportBoth(database)).toBe([
      '**Tasks**',
      '',
      '| Name | Status | Tags | Points | Done | Due | Note | Link |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| First | Doing | red, a\\|b | 3 | Yes | 2026-01-02 | a \\*b\\* |  |',
      '| Second |  |  |  | No |  |  | First, gone |',
      '',
      '**First**',
      '',
      'Row body',
    ].join('\n'));
  });

  it('writes a unique id with its prefix, the way the grid shows it', () => {
    const markdown = exportBoth([
      { id: 'db', tool: 'database', data: { schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }, { id: 'n', name: 'ID', type: 'uniqueId', position: 'a1', uniqueId: { prefix: 'TASK' } }] }, contentIds: ['r'] },
      { id: 'r', tool: 'database-row', parentId: 'db', data: { title: 'One', properties: { n: 3 } } },
    ]);

    expect(markdown).toBe('| Name | ID |\n| --- | --- |\n| One | TASK-3 |');
  });

  it('pastes back as a table carrying every value', async () => {
    const { blocks } = await reimport(exportBoth(database));
    const table = blocks.find((block) => block.type === 'table');
    const texts = blocks.filter((block) => block.parent === table?.id).map((block) => String(block.data.text));

    expect(table?.data.withHeadings).toBe(true);
    expect(texts).toEqual(expect.arrayContaining(['Name', 'Status', 'First', 'Doing', 'red, a|b', '3', 'Yes', '2026-01-02', 'a *b*', 'Second', 'No']));
    expect(blocks.some((block) => block.data.text === 'Row body' && block.parent === undefined)).toBe(true);
  });
});
