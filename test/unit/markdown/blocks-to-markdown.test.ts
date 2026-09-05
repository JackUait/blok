import { describe, it, expect } from 'vitest';
import { blocksToMarkdown, type SerializableBlock } from '../../../src/markdown/blocks-to-markdown';
import { markdownToBlocks } from '../../../src/markdown/index';

describe('blocksToMarkdown', () => {
  it('serializes a paragraph as plain text', () => {
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: 'Hello world' } }])).toBe('Hello world');
  });

  it('serializes inline bold, italic, code, strikethrough and links as markdown', () => {
    const html = 'a <b>bold</b> <i>italic</i> <code>c</code> <s>gone</s> <a href="https://x.com">link</a>';

    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: html } }])).toBe(
      'a **bold** *italic* `c` ~~gone~~ [link](https://x.com)'
    );
  });

  it('serializes headings with the right number of hashes', () => {
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Title', level: 1 } }])).toBe('# Title');
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Sub', level: 2 } }])).toBe('## Sub');
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Small', level: 3 } }])).toBe('### Small');
  });

  it('serializes unordered, ordered and checklist list items', () => {
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'unordered' } }])).toBe('- a');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'ordered' } }])).toBe('1. a');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'checklist', checked: false } }])).toBe('- [ ] a');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'a', style: 'checklist', checked: true } }])).toBe('- [x] a');
  });

  it('indents nested list items by their depth', () => {
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'child', style: 'unordered', depth: 1 } }])).toBe('    - child');
  });

  it('indents nested list items by their STRUCTURAL indent (parentId chain), not data.depth', () => {
    // A keyboard/drag-nested list item carries its nesting via the structural
    // tree, serialized as `indent` (the parentId-chain depth) — mirroring how
    // Tab-nested text/headers serialize. data.depth is no longer required.
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'child', style: 'unordered' }, indent: 1 }])).toBe('    - child');
    expect(blocksToMarkdown([{ tool: 'list', data: { text: 'deep', style: 'ordered' }, indent: 2 }])).toBe('        1. deep');
  });

  it('indents a non-list block only while a list item owns it', () => {
    // Four spaces continue a list item. With no list above them they would be
    // an indented code block instead, so the nesting is dropped rather than
    // exported as code.
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: 'nested' }, indent: 1 }])).toBe('nested');
    expect(blocksToMarkdown([{ tool: 'header', data: { text: 'Sub', level: 2 }, indent: 1 }])).toBe('## Sub');
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: 'deep' }, indent: 2 }])).toBe('deep');

    expect(blocksToMarkdown([
      { id: 'l', tool: 'list', data: { text: 'item', style: 'unordered' } },
      { tool: 'paragraph', data: { text: 'nested' }, parentId: 'l', indent: 1 },
    ])).toBe('- item\n\n    nested');
  });

  it('serializes quote, divider and code blocks', () => {
    expect(blocksToMarkdown([{ tool: 'quote', data: { text: 'wisdom' } }])).toBe('> wisdom');
    expect(blocksToMarkdown([{ tool: 'divider', data: {} }])).toBe('---');
    expect(blocksToMarkdown([{ tool: 'code', data: { code: 'const a = 1;' } }])).toBe('```\nconst a = 1;\n```');
  });

  it('joins paragraphs with blank lines but consecutive list items with single newlines', () => {
    const md = blocksToMarkdown([
      { tool: 'header', data: { text: 'Title', level: 1 } },
      { tool: 'paragraph', data: { text: 'Intro' } },
      { tool: 'list', data: { text: 'one', style: 'unordered' } },
      { tool: 'list', data: { text: 'two', style: 'unordered' } },
    ]);

    expect(md).toBe('# Title\n\nIntro\n\n- one\n- two');
  });

  it('drops the link syntax when an anchor has no href', () => {
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text: '<a>bare</a>' } }])).toBe('bare');
  });

  it('serializes an image as a Markdown image, not an empty line', () => {
    expect(blocksToMarkdown([{ tool: 'image', data: { url: 'https://x.com/a.png', caption: 'A cat' } }]))
      .toBe('![A cat](https://x.com/a.png)');
    expect(blocksToMarkdown([{ tool: 'image', data: { url: 'https://x.com/a.png' } }]))
      .toBe('![](https://x.com/a.png)');
  });

  it('serializes video, audio and file blocks as links (Markdown has no media syntax)', () => {
    expect(blocksToMarkdown([{ tool: 'video', data: { url: 'https://x.com/a.mp4', caption: 'Clip' } }]))
      .toBe('[Clip](https://x.com/a.mp4)');
    expect(blocksToMarkdown([{ tool: 'audio', data: { url: 'https://x.com/a.mp3', title: 'Song' } }]))
      .toBe('[Song](https://x.com/a.mp3)');
    expect(blocksToMarkdown([{ tool: 'file', data: { url: 'https://x.com/a.pdf', fileName: 'a.pdf' } }]))
      .toBe('[a.pdf](https://x.com/a.pdf)');
    // No label at all falls back to the URL, so the link is never empty.
    expect(blocksToMarkdown([{ tool: 'file', data: { url: 'https://x.com/a.pdf' } }]))
      .toBe('[https://x.com/a.pdf](https://x.com/a.pdf)');
  });

  it('serializes bookmark and embed blocks as links', () => {
    expect(blocksToMarkdown([{ tool: 'bookmark', data: { url: 'https://x.com', title: 'X' } }]))
      .toBe('[X](https://x.com)');
    expect(blocksToMarkdown([{ tool: 'embed', data: { source: 'https://youtu.be/1', service: 'youtube' } }]))
      .toBe('[youtube](https://youtu.be/1)');
  });
});

/**
 * Table cells store their content as CHILD blocks (their ids live in
 * `data.content[row][col].blocks`), and those child blocks also live in the flat
 * block array handed to the serializer. So the table serializer must both emit a
 * GFM pipe table AND suppress the cell blocks so they do not additionally appear
 * as loose lines after the table.
 */
describe('blocksToMarkdown: table', () => {
  /**
   * Build a table block plus its cell child blocks, in the flat, document-order
   * shape the clipboard/export path produces.
   * @param cells - per-row, per-cell descriptors (a cell is a list of child blocks)
   * @param data - extra table data (withHeadings, withHeadingColumn, …)
   * @returns flat block array: the table block followed by every cell child block
   */
  const makeTable = (
    cells: Array<Array<{ blocks: Array<{ tool: string; data: Record<string, unknown> }>; colspan?: number; rowspan?: number; mergedInto?: [number, number] }>>,
    data: Record<string, unknown> = {}
  ): SerializableBlock[] => {
    const children: SerializableBlock[] = [];
    const content = cells.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const ids = cell.blocks.map((child, blockIndex) => {
          const id = `c-${rowIndex}-${colIndex}-${blockIndex}`;

          children.push({ id,
            tool: child.tool,
            data: child.data,
            parentId: 'table-1',
            indent: 1 });

          return id;
        });

        return {
          blocks: ids,
          ...(cell.colspan !== undefined ? { colspan: cell.colspan } : {}),
          ...(cell.rowspan !== undefined ? { rowspan: cell.rowspan } : {}),
          ...(cell.mergedInto !== undefined ? { mergedInto: cell.mergedInto } : {}),
        };
      })
    );

    const table: SerializableBlock = {
      id: 'table-1',
      tool: 'table',
      data: { withHeadings: true,
        withHeadingColumn: false,
        content,
        ...data },
    };

    return [table, ...children];
  };

  /**
   * Shorthand for a cell holding a single paragraph.
   * @param text - the paragraph text (inline HTML allowed)
   * @returns cell descriptor
   */
  const p = (text: string): { blocks: Array<{ tool: string; data: Record<string, unknown> }> } => ({
    blocks: [{ tool: 'paragraph',
      data: { text } }],
  });

  it('serializes a 2x2 table with headings as a GFM pipe table', () => {
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [p('c'), p('d')],
    ]));

    expect(md).toBe('| a | b |\n| --- | --- |\n| c | d |');
  });

  it('does NOT also emit the cell child blocks as loose lines', () => {
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [p('c'), p('d')],
    ]));

    // Exactly three lines: header, delimiter, one body row — no trailing paragraphs.
    expect(md.split('\n')).toHaveLength(3);
    expect(md).not.toContain('\n\na');
  });

  it('keeps surrounding blocks while suppressing only the table cell blocks', () => {
    const md = blocksToMarkdown([
      { tool: 'paragraph',
        data: { text: 'before' },
        id: 'p-before' },
      ...makeTable([[p('a')], [p('c')]]),
      { tool: 'paragraph',
        data: { text: 'after' },
        id: 'p-after' },
    ]);

    expect(md).toBe('before\n\n| a |\n| --- |\n| c |\n\nafter');
  });

  it('emits an empty header row when the table has no heading row (GFM requires a header)', () => {
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [p('c'), p('d')],
    ], { withHeadings: false }));

    expect(md).toBe('|  |  |\n| --- | --- |\n| a | b |\n| c | d |');
  });

  it('degrades a heading COLUMN to a plain column (GFM has no heading-column syntax)', () => {
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [p('c'), p('d')],
    ], { withHeadingColumn: true }));

    expect(md).toBe('| a | b |\n| --- | --- |\n| c | d |');
  });

  it('serializes a cell containing a list, joining its blocks with <br>', () => {
    const md = blocksToMarkdown(makeTable([
      [p('head')],
      [{ blocks: [
        { tool: 'list',
          data: { text: 'one',
            style: 'unordered' } },
        { tool: 'list',
          data: { text: 'two',
            style: 'unordered' } },
      ] }],
    ]));

    expect(md).toBe('| head |\n| --- |\n| - one<br>- two |');
  });

  it('serializes an empty cell as an empty column', () => {
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [p('c'), { blocks: [] }],
    ]));

    expect(md).toBe('| a | b |\n| --- | --- |\n| c |  |');
  });

  it('escapes pipe characters so cell content cannot break the grid', () => {
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [p('c | d'), p('e')],
    ]));

    expect(md).toBe('| a | b |\n| --- | --- |\n| c \\| d | e |');
  });

  it('preserves a backslash before a pipe inside one table cell', async () => {
    const md = blocksToMarkdown(makeTable([
      [p('left'), p('right')],
      [p(String.raw`a\|b`), p('safe')],
    ]));

    expect(md).toBe(String.raw`| left | right |
| --- | --- |
| a\\\|b | safe |`);

    const blocks = await markdownToBlocks(md);
    const table = blocks.find((block) => block.type === 'table');
    const tableData = table?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[1]).toHaveLength(2);
  });

  it('degrades merged cells: spans are dropped, origin content kept, covered cells empty', () => {
    // GFM pipe tables cannot express colspan/rowspan. The documented degradation
    // keeps the grid rectangular: the origin cell's content stays in place and the
    // cells it covered serialize as empty.
    const md = blocksToMarkdown(makeTable([
      [p('a'), p('b')],
      [{ ...p('merged'),
        colspan: 2 }, { blocks: [],
        mergedInto: [1, 0] }],
    ]));

    expect(md).toBe('| a | b |\n| --- | --- |\n| merged |  |');
  });

  it('round-trips: markdownToBlocks(blocksToMarkdown(table)) reproduces the table', async () => {
    const md = blocksToMarkdown(makeTable([
      [p('Name'), p('Role')],
      [p('Ada'), p('Engineer')],
    ]));

    const blocks = await markdownToBlocks(md);
    const table = blocks.find((block) => block.type === 'table');

    expect(table).toBeDefined();

    const tableData = table?.data as { withHeadings: boolean; content: Array<Array<{ blocks: string[] }>> };
    const textById = new Map(
      blocks
        .filter((block) => block.type === 'paragraph')
        .map((block) => [block.id ?? '', (block.data as { text: string }).text])
    );
    const grid = tableData.content.map((row) => row.map((cell) => cell.blocks.map((id) => textById.get(id)).join('')));

    expect(tableData.withHeadings).toBe(true);
    expect(grid).toEqual([
      ['Name', 'Role'],
      ['Ada', 'Engineer'],
    ]);

    // And serializing the imported blocks again is a fixed point.
    const reserialized = blocksToMarkdown(blocks.map((block) => ({
      id: block.id,
      tool: block.type,
      data: block.data,
      parentId: block.parent ?? null,
    })));

    expect(reserialized).toBe(md);
  });
});

/**
 * A code block stores LITERAL text — the code tool saves
 * `codeElement.textContent` into `data.code` — so it must reach the fence
 * byte-for-byte. Running it through an HTML text extractor both lost markup
 * (`List<string>` became `List`) and, in the DOM backend, parsed the snippet
 * (`innerHTML` on a detached div still fires an image's `onerror`).
 */
describe('blocksToMarkdown: code', () => {
  /**
   * Serialize one code block from its literal `data.code`.
   * @param code - the snippet, exactly as the code tool saved it
   * @returns the fenced Markdown
   */
  const fence = (code: string): string => blocksToMarkdown([{ tool: 'code',
    data: { code } }]);

  it('keeps a generic type argument instead of parsing it as a tag', () => {
    expect(fence('var x = new List<string>();')).toBe('```\nvar x = new List<string>();\n```');
  });

  it('keeps entity-looking source verbatim (no decoding of literal code)', () => {
    expect(fence('a &amp; b &lt; c')).toBe('```\na &amp; b &lt; c\n```');
    expect(fence('const gt = a > b && c < d;')).toBe('```\nconst gt = a > b && c < d;\n```');
  });

  it('does not parse a snippet containing an image tag with an error handler', () => {
    const sample = '<img src=x onerror="alert(1)">';

    expect(fence(sample)).toBe(`\`\`\`\n${sample}\n\`\`\``);
  });

  it('keeps multi-line code and the language fence', () => {
    expect(blocksToMarkdown([{ tool: 'code',
      data: { code: '<T>(a: T) => a\n// <end>',
        language: 'typescript' } }]))
      .toBe('```typescript\n<T>(a: T) => a\n// <end>\n```');
  });

  /**
   * Legacy documents can carry a code block whose content sits in `data.text`.
   * Every other tool's `data.text` is inline HTML (that is what the default
   * branch feeds to `inlineToMarkdown`), so the escaping is undone — but the
   * tags themselves are NEVER parsed, or the fallback reopens the same sink.
   */
  it('entity-decodes the legacy `data.text` fallback without parsing tags', () => {
    expect(blocksToMarkdown([{ tool: 'code',
      data: { text: 'a &lt; b &amp;&amp; c' } }])).toBe('```\na < b && c\n```');
    expect(blocksToMarkdown([{ tool: 'code',
      data: { text: 'x <b>y</b>' } }])).toBe('```\nx <b>y</b>\n```');
  });

  it('decodes numeric and named references in the legacy fallback exactly once', () => {
    expect(blocksToMarkdown([{ tool: 'code',
      data: { text: '&#39;a&#x27; &quot;b&quot;' } }])).toBe('```\n\'a\' "b"\n```');
    // `&amp;lt;` is an ESCAPED `&lt;`, so it decodes to `&lt;` and stops there.
    expect(blocksToMarkdown([{ tool: 'code',
      data: { text: '&amp;lt;' } }])).toBe('```\n&lt;\n```');
    // An unknown reference is not a reference; it survives as written.
    expect(blocksToMarkdown([{ tool: 'code',
      data: { text: '&nope; 5 &lt 6' } }])).toBe('```\n&nope; 5 &lt 6\n```');
  });

  it('prefers `data.code` over the legacy `data.text`', () => {
    expect(blocksToMarkdown([{ tool: 'code',
      data: { code: 'a < b',
        text: 'ignored' } }])).toBe('```\na < b\n```');
  });
});

/**
 * A quote's inline `<br>` reaches the serializer as a newline, so a quote is
 * not necessarily one line. Markdown needs the marker on every one of them —
 * a single prefix left line two a plain paragraph, silently dropping it out of
 * the quote.
 */
describe('blocksToMarkdown: quote', () => {
  it('prefixes every line of a multi-line quote', () => {
    expect(blocksToMarkdown([{ tool: 'quote',
      data: { text: 'one<br>two<br>three' } }])).toBe('> one\n> two\n> three');
  });

  it('keeps inline marks on the continuation lines', () => {
    expect(blocksToMarkdown([{ tool: 'quote',
      data: { text: 'plain<br><b>bold</b>' } }])).toBe('> plain\n> **bold**');
  });

  it('emits a bare `>` for a blank line inside the quote', () => {
    expect(blocksToMarkdown([{ tool: 'quote',
      data: { text: 'a<br><br>b' } }])).toBe('> a\n>\n> b');
    expect(blocksToMarkdown([{ tool: 'quote',
      data: { text: '' } }])).toBe('>');
  });

  it('keeps the list indent on every line of a quote inside a list item', () => {
    expect(blocksToMarkdown([
      { id: 'l',
        tool: 'list',
        data: { text: 'item',
          style: 'unordered' } },
      { tool: 'quote',
        data: { text: 'a<br>b' },
        parentId: 'l',
        indent: 1 },
    ])).toBe('- item\n\n    > a\n    > b');
  });

  it('still emits a single-line quote as one marker', () => {
    expect(blocksToMarkdown([{ tool: 'quote',
      data: { text: 'wisdom' } }])).toBe('> wisdom');
  });
});

/**
 * An ordered list can start at any number: the list tool stores it as
 * `data.start` on the FIRST item of a group and omits it when it is 1.
 * CommonMark reads a list's numbering from its first item alone, so only that
 * item carries the real number — the ones after it stay `1.` and still render
 * 6, 7, 8 …
 */
describe('blocksToMarkdown: ordered list start', () => {
  it('emits the saved start number instead of always 1', () => {
    expect(blocksToMarkdown([{ tool: 'list',
      data: { text: 'a',
        style: 'ordered',
        start: 5 } }])).toBe('5. a');
  });

  it('numbers a run from the item that carries the start', () => {
    expect(blocksToMarkdown([
      { tool: 'list',
        data: { text: 'a',
          style: 'ordered',
          start: 5 } },
      { tool: 'list',
        data: { text: 'b',
          style: 'ordered' } },
      { tool: 'list',
        data: { text: 'c',
          style: 'ordered' } },
    ])).toBe('5. a\n1. b\n1. c');
  });

  it('keeps the start on a nested ordered item', () => {
    expect(blocksToMarkdown([{ tool: 'list',
      data: { text: 'x',
        style: 'ordered',
        start: 3 },
      indent: 1 }])).toBe('    3. x');
  });

  it('falls back to 1 for a start that is not a usable list number', () => {
    // CommonMark accepts 0-999999999; anything else is not an ordered marker
    // at all, and emitting it would turn the item into a paragraph.
    for (const start of [-3, 1.5, '5', Number.NaN, 1_000_000_000]) {
      expect(blocksToMarkdown([{ tool: 'list',
        data: { text: 'a',
          style: 'ordered',
          start } }])).toBe('1. a');
    }

    expect(blocksToMarkdown([{ tool: 'list',
      data: { text: 'a',
        style: 'ordered',
        start: 0 } }])).toBe('0. a');
  });

  it('ignores a start on unordered and checklist items', () => {
    expect(blocksToMarkdown([{ tool: 'list',
      data: { text: 'a',
        style: 'unordered',
        start: 5 } }])).toBe('- a');
    expect(blocksToMarkdown([{ tool: 'list',
      data: { text: 'a',
        style: 'checklist',
        checked: true,
        start: 5 } }])).toBe('- [x] a');
  });

  it('keeps a mixed ordered/unordered run intact', () => {
    expect(blocksToMarkdown([
      { tool: 'list',
        data: { text: 'a',
          style: 'ordered',
          start: 2 } },
      { tool: 'list',
        data: { text: 'b',
          style: 'unordered' } },
      { tool: 'list',
        data: { text: 'c',
          style: 'ordered' } },
    ])).toBe('2. a\n- b\n1. c');
  });
});
