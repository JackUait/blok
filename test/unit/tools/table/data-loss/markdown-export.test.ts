/**
 * Data-loss hunt: tables written by the Markdown exporter (editor copy and
 * `blocks.toMarkdown` use the DOM backend, the server and /view use parse5)
 * and read back by the importer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToMarkdown, type SerializableBlock } from '../../../../../src/markdown/blocks-to-markdown';
import { blocksToMarkdownWithReport } from '../../../../../src/view/blocks-to-markdown';
import { markdownToBlocksWithReport } from '../../../../../src/markdown/index';
import type { OutputBlockData } from '../../../../../types';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const asOutput = (blocks: SerializableBlock[]): OutputBlockData[] => blocks.map((block, index) => ({
  id: block.id ?? `b${index}`,
  type: block.tool,
  data: block.data,
  ...(block.parentId ? { parent: block.parentId } : {}),
}));

/** Export with both inline backends; they must agree. */
const exportBoth = (blocks: SerializableBlock[]): string => {
  const editor = blocksToMarkdown(blocks);

  expect(blocksToMarkdownWithReport({ blocks: asOutput(blocks) }).markdown).toBe(editor);

  return editor;
};

const warningsOf = (blocks: SerializableBlock[]): string[] =>
  blocksToMarkdownWithReport({ blocks: asOutput(blocks) }).warnings.map(warning => `${warning.construct}: ${warning.detail}`);

const cell = (id: string, tool: string, data: Record<string, unknown>): SerializableBlock => ({ id, tool, data, parentId: 't' });
const para = (id: string, text: string): SerializableBlock => cell(id, 'paragraph', { text });

/** A one-column table: a heading cell, then one body cell holding `body`. */
const oneCellTable = (body: SerializableBlock[]): SerializableBlock[] => [
  { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['h'] }], [{ blocks: body.map(block => block.id ?? '') }]] } },
  para('h', 'H'),
  ...body,
];

interface Grid {
  table: OutputBlockData;
  cells: OutputBlockData[][][];
  blocks: OutputBlockData[];
}

const roundTrip = async (blocks: SerializableBlock[]): Promise<Grid> => {
  const { blocks: back } = await markdownToBlocksWithReport(exportBoth(blocks));
  const table = back.find(block => block.type === 'table');

  if (table === undefined) {
    throw new Error('no table after round trip');
  }

  const content = table.data.content as Array<Array<{ blocks: string[] }>>;
  const cells = content.map(row => row.map(entry => entry.blocks.map(id => back.find(block => block.id === id))
    .filter((block): block is OutputBlockData => block !== undefined)));

  return { table, cells, blocks: back };
};

const CODE = 'const a = 1;\nconst b = a | 2;';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('markdown export: multi-block cells', () => {
  it('a code block in a cell comes back without literal <br> text in the code', async () => {
    const { cells } = await roundTrip(oneCellTable([cell('c', 'code', { code: CODE, language: 'javascript' })]));
    const text = cells[1][0].map(block => str(block.data.text) || str(block.data.code)).join('\n');

    expect(text).not.toContain('&lt;br&gt;');
    expect(text).not.toContain('javascript');
  });

  it('a code block in a cell is reported as degraded', () => {
    expect(warningsOf(oneCellTable([cell('c', 'code', { code: CODE, language: 'javascript' })]))).not.toEqual([]);
  });

  it('list items in a cell are reported as degraded', () => {
    expect(warningsOf(oneCellTable([
      cell('a', 'list', { text: 'x', style: 'unordered' }),
      cell('b', 'list', { text: 'y', style: 'checklist', checked: true }),
    ]))).not.toEqual([]);
  });

  it('a heading and a quote in a cell are reported as degraded', () => {
    expect(warningsOf(oneCellTable([
      cell('a', 'header', { text: 'Title', level: 2 }),
      cell('b', 'quote', { text: 'quoted' }),
    ]))).not.toEqual([]);
  });

  it('a table nested in a cell is reported as degraded', () => {
    const nested: SerializableBlock[] = [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['h'] }], [{ blocks: ['t2'] }]] } },
      para('h', 'H'),
      cell('t2', 'table', { withHeadings: true, content: [[{ blocks: ['x'] }], [{ blocks: ['y'] }]] }),
      { id: 'x', tool: 'paragraph', data: { text: 'X' }, parentId: 't2' },
      { id: 'y', tool: 'paragraph', data: { text: 'Y' }, parentId: 't2' },
    ];

    expect(exportBoth(nested)).toBe('| H |\n| --- |\n| \\| X \\|<br>\\| --- \\|<br>\\| Y \\| |');
    expect(warningsOf(nested)).not.toEqual([]);
  });
});

describe('markdown export: table structure and alignment', () => {
  it('a column whose cells are all centred exports a centred delimiter', () => {
    const markdown = exportBoth([
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'], placement: 'top-center' }], [{ blocks: ['b'], placement: 'top-center' }]] } },
      para('a', 'A'),
      para('b', 'B'),
    ]);

    expect(markdown.split('\n')[1]).toBe('| :---: |');
  });

  it('a blank heading row survives the round trip', async () => {
    const { table, cells } = await roundTrip([
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'] }, { blocks: ['b'] }], [{ blocks: ['c'] }, { blocks: ['d'] }]] } },
      para('a', ''),
      para('b', ''),
      para('c', 'C'),
      para('d', 'D'),
    ]);

    expect(cells).toHaveLength(2);
    expect(table.data.withHeadings).toBe(true);
    expect(cells[0].map(entry => entry[0]?.data.text)).toEqual(['', '']);
    expect(cells[1].map(entry => entry[0]?.data.text)).toEqual(['C', 'D']);
  });

  it('a column whose cells are all right-aligned exports a right delimiter, and loses nothing', () => {
    const blocks: SerializableBlock[] = [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'], placement: 'top-right' }, { blocks: ['b'] }], [{ blocks: ['c'], placement: 'top-right' }, { blocks: ['d'] }]] } },
      para('a', 'A'),
      para('b', 'B'),
      para('c', 'C'),
      para('d', 'D'),
    ];

    expect(exportBoth(blocks).split('\n')[1]).toBe('| ---: | --- |');
    expect(warningsOf(blocks)).toEqual([]);
  });

  it('a column with mixed alignment keeps a plain delimiter and reports the placement loss', () => {
    const blocks: SerializableBlock[] = [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'], placement: 'top-center' }], [{ blocks: ['b'] }]] } },
      para('a', 'A'),
      para('b', 'B'),
    ];

    expect(exportBoth(blocks).split('\n')[1]).toBe('| --- |');
    expect(warningsOf(blocks).join('\n')).toContain('cell placement');
  });

  it('a uniformly centred column still reports a vertical placement it cannot carry', () => {
    const blocks: SerializableBlock[] = [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'], placement: 'middle-center' }], [{ blocks: ['b'], placement: 'middle-center' }]] } },
      para('a', 'A'),
      para('b', 'B'),
    ];

    expect(exportBoth(blocks).split('\n')[1]).toBe('| :---: |');
    expect(warningsOf(blocks).join('\n')).toContain('cell placement');
  });

  it('a headless table keeps its empty header row', () => {
    expect(exportBoth([
      { id: 't', tool: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }]] } },
      para('a', 'A'),
    ])).toBe('|  |\n| --- |\n| A |');
  });
});

describe('markdown export: inline text in cells (shared inline backend)', () => {
  it('an inline equation in a cell exports with its $ delimiters', () => {
    const markdown = blocksToMarkdown(oneCellTable([para('a', 'E <span data-latex="x^2"></span> end')]));

    expect(markdown).toContain('$x^2$');
  });

  it('literal asterisks in a cell stay literal text', async () => {
    const { cells } = await roundTrip(oneCellTable([para('a', '*not italic*')]));

    expect(cells[1][0][0]?.data.text).toBe('*not italic*');
  });

  it('literal "<br>" text in a cell stays text, not a line break', async () => {
    const { cells } = await roundTrip(oneCellTable([para('a', 'a &lt;br&gt; b')]));

    expect(cells[1][0][0]?.data.text).toBe('a &lt;br&gt; b');
  });
});

describe('markdown export: table paths checked safe', () => {
  it('marks, inline code, links and pipes round-trip in place', async () => {
    const { cells } = await roundTrip([
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'] }, { blocks: ['b'] }], [{ blocks: ['c'] }, { blocks: ['d'] }]] } },
      para('a', '<strong>B</strong> <i>I</i> <s>S</s>'),
      para('b', '<code>a|b</code> x|y'),
      para('c', '<a href="https://e.test/?q=a|b">l|nk</a>'),
      para('d', 'back\\|slash'),
    ]);

    expect(cells[0][0][0]?.data.text).toBe('<strong>B</strong> <i>I</i> <s>S</s>');
    expect(cells[0][1][0]?.data.text).toBe('<code>a|b</code> x|y');
    expect(cells[1][0][0]?.data.text).toContain('href="https://e.test/?q=a|b"');
    expect(cells[1][0][0]?.data.text).toContain('>l|nk</a>');
    expect(cells[1][1][0]?.data.text).toBe('back\\|slash');
  });

  it('a backslash run before a pipe survives in text', async () => {
    const { cells } = await roundTrip(oneCellTable([para('a', 'x\\|y <code>a|b</code> c\\\\|d')]));

    expect(cells[1][0][0]?.data.text).toBe('x\\|y <code>a|b</code> c\\\\|d');
  });

  it.each([
    ['inline code', '<code>a\\|b</code>'],
    ['an equation', '<span data-latex="\\|x\\|"></span>'],
    ['a link target', '<a href="https://e.test/a\\|b">l</a>'],
  ])('a raw backslash before a pipe in %s keeps the grid and is reported', async (_name, text) => {
    const blocks = [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['h'] }, { blocks: ['h2'] }], [{ blocks: ['a'] }, { blocks: ['b'] }]] } },
      para('h', 'H'),
      para('h2', 'H2'),
      para('a', text),
      para('b', 'B'),
    ];
    const { cells } = await roundTrip(blocks);

    expect(cells.map(row => row.length)).toEqual([2, 2]);
    expect(cells[1][1][0]?.data.text).toBe('B');
    expect(warningsOf(blocks).join('\n')).toContain('backslash');
  });

  it('a code block in a cell keeps each line, backticks and pipes included', async () => {
    const { cells } = await roundTrip(oneCellTable([cell('c', 'code', { code: 'a`b | c\\d\n\n  e', language: 'plain text' })]));

    expect(cells[1][0][0]?.data.text).toBe('<code>a`b | c\\d</code><br><br><code>  e</code>');
  });

  it('two paragraphs in a cell come back as one paragraph with a line break, text intact', async () => {
    const { cells } = await roundTrip(oneCellTable([para('a', 'one'), para('b', 'two')]));

    expect(cells[1][0].map(block => block.data.text)).toEqual(['one<br>two']);
  });

  it('merged cells keep the origin text and are reported', async () => {
    const blocks: SerializableBlock[] = [
      { id: 't', tool: 'table', data: { withHeadings: true, content: [[{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }], [{ blocks: ['c'] }, { blocks: ['d'] }]] } },
      para('a', 'A'),
      para('c', 'C'),
      para('d', 'D'),
    ];
    const { cells } = await roundTrip(blocks);

    expect(cells.flat(2).map(block => block.data.text)).toEqual(['A', '', 'C', 'D']);
    expect(warningsOf(blocks).join('\n')).toContain('merged cells');
  });

  it('cell colours, heading column and placement are reported', () => {
    const warnings = warningsOf([
      { id: 't', tool: 'table', data: { withHeadings: true, withHeadingColumn: true, content: [[{ blocks: ['a'], color: 'red', placement: 'middle-left' }], [{ blocks: ['b'] }]] } },
      para('a', 'A'),
      para('b', 'B'),
    ]).join('\n');

    expect(warnings).toContain('heading column');
    expect(warnings).toContain('cell colours');
    expect(warnings).toContain('cell placement');
  });
});
