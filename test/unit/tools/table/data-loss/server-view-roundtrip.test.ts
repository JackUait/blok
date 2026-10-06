import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksToHtml, blocksToMarkdownWithReport, htmlToBlocksWithReport } from '../../../../../src/view';
import { markdownToBlocks } from '../../../../../src/markdown';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, type Booted } from './roundtrip-harness';

type Cell = Record<string, unknown>;

const tableIn = (blocks: OutputBlockData[]): OutputBlockData => {
  const table = blocks.find(b => b.type === 'table');

  if (table === undefined) {
    throw new Error(`no table: ${JSON.stringify(blocks.map(b => b.type))}`);
  }

  return table;
};

const P = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', parent: 't', data: { text } });

describe('/view + markdown: table data outside the editor', () => {
  let booted: Booted | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
  });

  it('blocksToMarkdown: a code block in a cell keeps its lines on re-import', async () => {
    const doc: OutputData = {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['h'] }], [{ blocks: ['c'] }]] }, content: ['h', 'c'] },
        P('h', 'H'),
        { id: 'c', type: 'code', parent: 't', data: { code: 'first();\nsecond();', language: 'js' } },
      ] as OutputBlockData[],
    };
    const { markdown, warnings } = blocksToMarkdownWithReport(doc);
    const back = await markdownToBlocks(markdown);
    const ids = (tableIn(back).data.content as Cell[][])[1][0].blocks as string[];
    const cellText = ids.map(id => JSON.stringify(back.find(b => b.id === id)?.data)).join(' ');

    // Either the code survives, or the loss is reported.
    if (warnings.some(w => w.construct === 'code')) {
      return;
    }
    expect(cellText, JSON.stringify(warnings)).not.toMatch(/&lt;br&gt;|<br>/);
    expect(cellText).toContain('second();');
  });

  it('blocksToHtml → htmlToBlocks keeps withHeadings false on a heading-column table', () => {
    const doc: OutputData = {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, withHeadingColumn: true, content: [[{ blocks: ['a'] }], [{ blocks: ['b'] }]] }, content: ['a', 'b'] },
        P('a', 'A'),
        P('b', 'B'),
      ] as OutputBlockData[],
    };
    const { blocks, warnings } = htmlToBlocksWithReport(blocksToHtml(doc));

    expect(tableIn(blocks).data, JSON.stringify(warnings)).toMatchObject({ withHeadings: false, withHeadingColumn: true });
  });

  it('blocksToHtml → htmlToBlocks keeps cell colour, text colour and placement, or reports the loss', () => {
    const doc: OutputData = {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'], color: '#fbecdd', textColor: '#d9730d', placement: 'middle-center' }, { blocks: ['b'] }]] }, content: ['a', 'b'] },
        P('a', 'A'),
        P('b', 'B'),
      ] as OutputBlockData[],
    };
    const html = blocksToHtml(doc);
    const { blocks, warnings } = htmlToBlocksWithReport(html);
    const cell = (tableIn(blocks).data.content as Cell[][])[0][0];

    expect(html).toContain('background-color:#fbecdd');
    if (warnings.some(w => w.construct === 'table')) {
      return;
    }
    expect(cell, JSON.stringify(warnings)).toMatchObject({ color: '#fbecdd', textColor: '#d9730d', placement: 'middle-center' });
  });

  it('blocksToHtml carries colWidths and stretched so htmlToBlocks can restore them', () => {
    const doc: OutputData = {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, stretched: true, colWidths: [120, 360], content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] }, content: ['a', 'b'] },
        P('a', 'A'),
        P('b', 'B'),
      ] as OutputBlockData[],
    };
    const { blocks } = htmlToBlocksWithReport(blocksToHtml(doc));

    expect(tableIn(blocks).data).toMatchObject({ stretched: true, colWidths: [120, 360] });
  });

  it('htmlToBlocks: a table wrapped in a div inside a cell is flattened with a warning', () => {
    const { blocks, warnings } = htmlToBlocksWithReport('<table><tr><td><div><table><tr><td>deep</td><td>er</td></tr></table></div></td></tr></table>');

    expect(blocks.filter(b => b.type === 'table')).toHaveLength(1);
    expect(warnings.some(w => w.construct === 'table')).toBe(true);
  });

  it('editor loading htmlToBlocks output with a wrapped nested table keeps every inner cell text', async () => {
    const { blocks } = htmlToBlocksWithReport('<table><tr><td><div><table><tr><td>deep</td><td>er</td></tr></table></div></td><td>x</td></tr></table>');

    booted = await boot({ blocks });
    const saved = await booted.editor.save();
    const texts = (saved?.blocks ?? []).map(b => JSON.stringify(b.data)).join(' ');

    expect(texts).toContain('deep');
    expect(texts).toContain('er');
    expect(texts).toMatch(/deep[\s\S]*er/);
    // Inner cells must not merge into one run of text.
    expect(texts).not.toContain('deeper');
  });
});
