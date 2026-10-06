import { describe, expect, it } from 'vitest';

import { blocksToMarkdown, type SerializableBlock } from '../../../src/markdown/blocks-to-markdown';
import { blocksToMarkdownWithReport } from '../../../src/view/blocks-to-markdown';
import type { OutputBlockData } from '../../../types';

const asOutput = (blocks: SerializableBlock[]): OutputBlockData[] => blocks.map((block, index) => ({
  id: block.id ?? `b${index}`,
  type: block.tool,
  data: block.data,
  ...(block.parentId ? { parent: block.parentId } : {}),
}));

/** A one-cell table whose body cell is a paragraph holding `text`. */
const cellTable = (text: string): SerializableBlock[] => [
  { id: 't', tool: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }]] } },
  { id: 'a', tool: 'paragraph', data: { text }, parentId: 't' },
];

/** The empty heading row a table without headings exports. */
const HEAD = '|  |\n| --- |\n';

const timed = (run: () => string): { ms: number; markdown: string } => {
  const start = performance.now();
  const markdown = run();

  return { ms: performance.now() - start, markdown };
};

describe('table cell pipe escaping', () => {
  it('stays linear on a long backslash run with no pipe after it', () => {
    const text = `${'\\'.repeat(200_000)}x`;
    const editor = timed(() => blocksToMarkdown(cellTable(text)));
    const view = timed(() => blocksToMarkdownWithReport({ blocks: asOutput(cellTable(text)) }).markdown);

    expect(editor.ms).toBeLessThan(200);
    expect(view.ms).toBeLessThan(200);
    expect(view.markdown).toBe(editor.markdown);
    // The escaper leaves the last backslash alone: it sits before a letter.
    expect(editor.markdown).toBe(`${HEAD}| ${'\\'.repeat(399_999)}x |`);
  });

  it('adds one backslash to a pipe behind an even run', () => {
    const blocks = cellTable('a|b \\|c');

    expect(blocksToMarkdown(blocks)).toBe(`${HEAD}| a\\|b \\\\\\|c |`);
    expect(blocksToMarkdownWithReport({ blocks: asOutput(blocks) }).markdown).toBe(`${HEAD}| a\\|b \\\\\\|c |`);
  });

  it('adds two backslashes to a pipe behind an odd raw run and reports it', () => {
    const blocks = cellTable('<code>a\\|b</code> c|d');
    const report = blocksToMarkdownWithReport({ blocks: asOutput(blocks) });

    expect(report.markdown).toBe(`${HEAD}| \`a\\\\\\|b\` c\\|d |`);
    expect(blocksToMarkdown(blocks)).toBe(report.markdown);
    expect(report.warnings.map(warning => warning.construct)).toContain('table');
  });

  it('leaves a cell that ends in a backslash run alone', () => {
    const blocks = cellTable('<code>a\\\\\\</code>');

    expect(blocksToMarkdown(blocks)).toBe(`${HEAD}| \`a\\\\\\\` |`);
  });
});

describe('trailing hard breaks', () => {
  it('stays linear on many breaks followed by text', () => {
    const text = `a${'<br>'.repeat(20_000)}b`;
    const editor = timed(() => blocksToMarkdown([{ tool: 'paragraph', data: { text } }]));
    const view = timed(() => blocksToMarkdownWithReport({ blocks: asOutput([{ tool: 'paragraph', data: { text } }]) }).markdown);

    expect(editor.ms).toBeLessThan(2000);
    expect(view.ms).toBeLessThan(2000);
    expect(view.markdown).toBe(editor.markdown);
    expect(editor.markdown.endsWith('\\\nb')).toBe(true);
  });

  it.each([
    ['a<br>', 'a'],
    ['a<br><br><br>', 'a'],
    ['a<br>b<br>', 'a  \nb'],
    ['a<br>b', 'a  \nb'],
  ])('writes %s as %j', (text, expected) => {
    expect(blocksToMarkdown([{ tool: 'paragraph', data: { text } }])).toBe(expected);
    expect(blocksToMarkdownWithReport({ blocks: asOutput([{ tool: 'paragraph', data: { text } }]) }).markdown).toBe(expected);
  });
});
