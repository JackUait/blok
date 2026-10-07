/**
 * Data-loss hunt: GFM tables read by the Markdown importer
 * (`markdownToBlocks` → mdast-to-blocks), then loaded into a real editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import { Image } from '../../../../../src/tools';
import { markdownToBlocksWithReport as markdownToSegmentBlocksWithReport } from '../../../../../src/markdown/index';
import type { MarkdownImportResult } from '../../../../../src/markdown/index';
import { richTextAsHtml } from '../../../helpers/rich-text-as-html';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { settle } from './roundtrip-harness';
import { savedAsHtml } from '../../../helpers/saved-as-html';

/** Rich fields read back as HTML, the shape these grid assertions read. */
const markdownToBlocksWithReport = async (md: string): Promise<MarkdownImportResult> => {
  const result = await markdownToSegmentBlocksWithReport(md);

  return { ...result, blocks: richTextAsHtml(result.blocks) };
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

interface Cell {
  blocks: string[];
  placement?: string;
}

const tableOf = (blocks: OutputBlockData[]): OutputBlockData => {
  const table = blocks.find(block => block.type === 'table');

  if (table === undefined) {
    throw new Error('no table');
  }

  return table;
};

const gridOf = (blocks: OutputBlockData[]): Cell[][] => tableOf(blocks).data.content as Cell[][];

const cellBlocks = (blocks: OutputBlockData[], row: number, col: number): OutputBlockData[] =>
  (gridOf(blocks)[row]?.[col]?.blocks ?? []).map(id => {
    const block = blocks.find(entry => entry.id === id);

    if (block === undefined) {
      throw new Error(`missing ${id}`);
    }

    return block;
  });

const cellText = (blocks: OutputBlockData[], row: number, col: number): string =>
  cellBlocks(blocks, row, col).map(block => str(block.data.text)).join('|');

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const bootAndSave = async (blocks: OutputBlockData[]): Promise<OutputBlockData[]> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: Table, image: Image },
    data: { blocks },
  }) as unknown as TestEditor;

  await editor.isReady;
  await settle();

  const saved = (savedAsHtml(await editor.save())).blocks;

  editor.destroy();

  return saved;
};

describe('markdown import: GFM table data loss', () => {

  it('inline math in a cell keeps its formula', async () => {
    const { blocks } = await markdownToBlocksWithReport('| a | b |\n| --- | --- |\n| $x^2$ | ok |');

    expect(cellText(blocks, 1, 0)).toContain('x^2');
  });

  it('inline math in a cell stays an equation through load and save', async () => {
    const { blocks } = await markdownToBlocksWithReport('| a | b |\n| --- | --- |\n| $x^2$ | ok |');

    expect(cellText(await bootAndSave(blocks), 1, 0)).toBe('<span data-latex="x^2">x^2</span>');
  });

  it('column alignment becomes the cells\' horizontal placement', async () => {
    const { blocks } = await markdownToBlocksWithReport('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    const grid = gridOf(blocks);

    expect(grid[1].map(cell => cell.placement ?? 'top-left')).toEqual(['top-left', 'top-center', 'top-right']);
  });

  const importImageCell = async (): Promise<OutputBlockData[]> => {
    const { blocks } = await markdownToBlocksWithReport('| a |\n| --- |\n| before ![a cat](https://x.test/cat.png) |');

    return cellBlocks(await bootAndSave(blocks), 1, 0);
  };

  it('an image in a cell keeps its alt text', async () => {
    const cell = await importImageCell();

    expect(cell.find(block => block.type === 'image')?.data).toMatchObject({ url: 'https://x.test/cat.png', alt: 'a cat' });
  });

  it('an image in a cell stays after the text written before it', async () => {
    const cell = await importImageCell();

    expect(cell.map(block => block.type)).toEqual(['paragraph', 'image']);
  });
});

describe('markdown import: GFM table paths checked safe', () => {
  it('control: an image block already in a cell keeps its alt text through load and save', async () => {
    const saved = await bootAndSave([
      { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['img'] }]] } },
      { id: 'img', type: 'image', data: { url: 'https://x.test/cat.png', alt: 'a cat' }, parent: 't' },
    ]);

    expect(saved.find(block => block.id === 'img')?.data).toMatchObject({ alt: 'a cat' });
  });

  it('a ragged table loads with every cell, padded to the widest row', async () => {
    const { blocks } = await markdownToBlocksWithReport('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |');
    const saved = await bootAndSave(blocks);

    expect(gridOf(saved).map(row => row.length)).toEqual([4, 4, 4]);
    expect(cellText(saved, 2, 3)).toBe('4');
  });

  it('inline marks, links and escaped pipes arrive in the right cells', async () => {
    const { blocks } = await markdownToBlocksWithReport(
      '| a | b |\n| --- | --- |\n| **B** *I* ~~S~~ x \\| y | `p\\|q` [l](https://e.test/?q=a\\|b) |'
    );

    expect(cellText(blocks, 1, 0)).toBe('<strong>B</strong> <i>I</i> <s>S</s> x | y');
    expect(cellText(blocks, 1, 1)).toContain('<code>p|q</code>');
    expect(cellText(blocks, 1, 1)).toContain('href="https://e.test/?q=a|b"');
  });

  it('a ragged row keeps every cell, including cells past the header width', async () => {
    const { blocks } = await markdownToBlocksWithReport('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |');

    expect(gridOf(blocks).map(row => row.length)).toEqual([2, 1, 4]);
    expect(cellText(blocks, 2, 3)).toBe('4');
  });

  it('a 40-column table keeps every column', async () => {
    const width = 40;
    const row = (prefix: string): string => `| ${Array.from({ length: width }, (_, i) => `${prefix}${i}`).join(' | ')} |`;
    const { blocks } = await markdownToBlocksWithReport(`${row('h')}\n|${' --- |'.repeat(width)}\n${row('v')}`);

    expect(gridOf(blocks)[1]).toHaveLength(width);
    expect(cellText(blocks, 1, width - 1)).toBe(`v${width - 1}`);
  });
});
