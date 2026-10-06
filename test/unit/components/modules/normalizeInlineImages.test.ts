import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeInlineImages } from '../../../../src/components/modules/normalizeInlineImages';
import { isValidBlockId } from '../../../../src/components/utils/id-generator';
import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { Image } from '../../../../src/tools';
import type { OutputData } from '../../../../types';

/**
 * Shared type for the validated block data that flows through the saver pipeline.
 * Mirrors SaverValidatedData shape from saver.ts.
 */
interface BlockEntry {
  id?: string;
  tool: string;
  data: Record<string, unknown>;
  isValid: boolean;
  parentId?: string | null;
  contentIds?: string[];
  tunes?: Record<string, unknown>;
}

/**
 * Helper: build a table block entry.
 */
const makeTable = (
  id: string,
  content: Array<Array<{ blocks: string[] }>>,
  contentIds: string[]
): BlockEntry => ({
  id,
  tool: 'table',
  data: { withHeadings: false, withHeadingColumn: false, content },
  isValid: true,
  contentIds,
});

/**
 * Helper: build a paragraph block entry (table cell child).
 */
const makeCellParagraph = (
  id: string,
  text: string,
  parentId: string
): BlockEntry => ({
  id,
  tool: 'paragraph',
  data: { text },
  isValid: true,
  parentId,
});

/**
 * Helper: build a root-level paragraph (no parent).
 */
const makeRootParagraph = (id: string, text: string): BlockEntry => ({
  id,
  tool: 'paragraph',
  data: { text },
  isValid: true,
});

/**
 * Ids the normalizer minted: every id in the output that was not in the input.
 */
const mintedIds = (input: BlockEntry[], output: BlockEntry[]): string[] => {
  const before = new Set(input.map((b) => b.id));

  return output.map((b) => b.id ?? '').filter((id) => !before.has(id));
};

describe('normalizeInlineImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts a single <img> from a table cell paragraph', () => {
    const table = makeTable(
      'table-1',
      [[{ blocks: ['p-1'] }]],
      ['p-1']
    );
    const paragraph = makeCellParagraph('p-1', '<img src="https://example.com/photo.jpg">', 'table-1');

    const result = normalizeInlineImages([table, paragraph]);
    const [imageId] = mintedIds([table, paragraph], result);

    // New image block should be created
    const imageBlock = result.find((b) => b.tool === 'image');

    expect(imageBlock).toEqual({
      id: imageId,
      tool: 'image',
      data: { url: 'https://example.com/photo.jpg' },
      isValid: true,
      parentId: 'table-1',
    });

    // Paragraph text should have the <img> removed (empty string remains)
    const updatedParagraph = result.find((b) => b.id === 'p-1');

    expect(updatedParagraph?.data.text).toBe('');

    // Table contentIds should include the new image block ID
    const updatedTable = result.find((b) => b.id === 'table-1');

    expect(updatedTable?.contentIds).toContain(imageId);

    // The cell's blocks array in table data should include the image block ID before the paragraph
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual([imageId, 'p-1']);
  });

  it('extracts multiple <img> tags from one paragraph', () => {
    const table = makeTable(
      'table-1',
      [[{ blocks: ['p-1'] }]],
      ['p-1']
    );
    const paragraph = makeCellParagraph(
      'p-1',
      '<img src="https://example.com/a.jpg"><img src="https://example.com/b.png">',
      'table-1'
    );

    const result = normalizeInlineImages([table, paragraph]);
    const [firstId, secondId] = mintedIds([table, paragraph], result);

    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(2);

    expect(imageBlocks[0]).toEqual(expect.objectContaining({
      id: firstId,
      data: { url: 'https://example.com/a.jpg' },
      parentId: 'table-1',
    }));

    expect(imageBlocks[1]).toEqual(expect.objectContaining({
      id: secondId,
      data: { url: 'https://example.com/b.png' },
      parentId: 'table-1',
    }));

    // Paragraph text should be empty after both images are extracted
    const updatedParagraph = result.find((b) => b.id === 'p-1');

    expect(updatedParagraph?.data.text).toBe('');

    // Cell blocks array should have both image IDs before the paragraph
    const updatedTable = result.find((b) => b.id === 'table-1');
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual([firstId, secondId, 'p-1']);
  });

  it('preserves remaining text when extracting an image', () => {
    const table = makeTable(
      'table-1',
      [[{ blocks: ['p-1'] }]],
      ['p-1']
    );
    const paragraph = makeCellParagraph(
      'p-1',
      'Hello <img src="https://example.com/photo.jpg"> World',
      'table-1'
    );

    const result = normalizeInlineImages([table, paragraph]);

    // Image extracted
    const imageBlock = result.find((b) => b.tool === 'image');

    expect(imageBlock).toBeDefined();
    expect(imageBlock?.data.url).toBe('https://example.com/photo.jpg');

    // Text on each side of the image stays on that side
    expect(result.slice(1).map((b) => b.tool === 'image' ? b.data.url : b.data.text)).toEqual(
      ['Hello ', 'https://example.com/photo.jpg', ' World']
    );
    expect(result[1].id).toBe('p-1');
  });

  it('does not modify a paragraph with no <img> tags', () => {
    const table = makeTable(
      'table-1',
      [[{ blocks: ['p-1'] }]],
      ['p-1']
    );
    const paragraph = makeCellParagraph('p-1', 'Just plain text', 'table-1');

    const result = normalizeInlineImages([table, paragraph]);

    // No image blocks created
    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(0);

    // Paragraph unchanged
    const updatedParagraph = result.find((b) => b.id === 'p-1');

    expect(updatedParagraph?.data.text).toBe('Just plain text');

    // Table data unchanged
    const updatedTable = result.find((b) => b.id === 'table-1');
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual(['p-1']);
  });

  it('does not modify a root-level paragraph (no parentId)', () => {
    const paragraph = makeRootParagraph('p-root', '<img src="https://example.com/photo.jpg">');

    const result = normalizeInlineImages([paragraph]);

    // No image blocks created
    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(0);

    // Paragraph text unchanged — root paragraphs are not processed
    const updatedParagraph = result.find((b) => b.id === 'p-root');

    expect(updatedParagraph?.data.text).toBe('<img src="https://example.com/photo.jpg">');
  });

  it('does not modify a paragraph whose parent is not a table block', () => {
    const listBlock: BlockEntry = {
      id: 'list-1',
      tool: 'list',
      data: { items: [] },
      isValid: true,
      contentIds: ['p-child'],
    };
    const paragraph = makeCellParagraph('p-child', '<img src="https://example.com/photo.jpg">', 'list-1');

    const result = normalizeInlineImages([listBlock, paragraph]);

    // No image blocks created
    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(0);

    // Paragraph text unchanged — parent is not a table
    const updatedParagraph = result.find((b) => b.id === 'p-child');

    expect(updatedParagraph?.data.text).toBe('<img src="https://example.com/photo.jpg">');
  });

  it('extracts images independently from multiple cells in a table', () => {
    const table = makeTable(
      'table-1',
      [[{ blocks: ['p-1'] }, { blocks: ['p-2'] }]],
      ['p-1', 'p-2']
    );
    const paragraph1 = makeCellParagraph(
      'p-1',
      '<img src="https://example.com/a.jpg">',
      'table-1'
    );
    const paragraph2 = makeCellParagraph(
      'p-2',
      '<img src="https://example.com/b.jpg">',
      'table-1'
    );

    const result = normalizeInlineImages([table, paragraph1, paragraph2]);
    const [firstId, secondId] = mintedIds([table, paragraph1, paragraph2], result);

    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(2);

    // First cell image
    expect(imageBlocks[0]).toEqual(expect.objectContaining({
      id: firstId,
      data: { url: 'https://example.com/a.jpg' },
    }));

    // Second cell image
    expect(imageBlocks[1]).toEqual(expect.objectContaining({
      id: secondId,
      data: { url: 'https://example.com/b.jpg' },
    }));

    // Each cell's blocks array should have its own image ID inserted before the paragraph
    const updatedTable = result.find((b) => b.id === 'table-1');
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual([firstId, 'p-1']);
    expect(tableData.content[0][1].blocks).toEqual([secondId, 'p-2']);

    // Table contentIds should include all new image block IDs
    expect(updatedTable?.contentIds).toEqual(
      expect.arrayContaining([firstId, secondId, 'p-1', 'p-2'])
    );
  });

  it('keeps the alt text of an extracted image', () => {
    const table = makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']);
    const paragraph = makeCellParagraph('p-1', '<img src="https://example.com/cat.png" alt="a &amp; cat">', 'table-1');

    const result = normalizeInlineImages([table, paragraph]);

    expect(result.find((b) => b.tool === 'image')?.data).toEqual({ url: 'https://example.com/cat.png', alt: 'a & cat' });
  });

  it('keeps text written before an image ahead of it, and text after it behind it', () => {
    const table = makeTable('table-1', [[{ blocks: ['p-0', 'p-1', 'p-9'] }]], ['p-0', 'p-1', 'p-9']);
    const paragraph: BlockEntry = {
      ...makeCellParagraph('p-1', 'one <img src="a.png"> two <img src="b.png"> three', 'table-1'),
      data: { text: 'one <img src="a.png"> two <img src="b.png"> three', textColor: 'red' },
      tunes: { align: 'center' },
    };

    const input = [
      table,
      makeCellParagraph('p-0', 'first', 'table-1'),
      paragraph,
      makeCellParagraph('p-9', 'last', 'table-1'),
    ];
    const result = normalizeInlineImages(input);
    const minted = mintedIds(input, result);

    const order = ['p-0', 'p-1', ...minted, 'p-9'];
    const updatedTable = result.find((b) => b.id === 'table-1');
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual(order);
    expect(updatedTable?.contentIds).toEqual(order);
    expect(result.slice(1).map((b) => b.id)).toEqual(order);
    expect(result.slice(1).map((b) => b.tool === 'image' ? b.data.url : b.data.text)).toEqual(
      ['first', 'one ', 'a.png', ' two ', 'b.png', ' three', 'last']
    );
    expect(minted).toHaveLength(4);
    expect(result.find((b) => b.id === minted[3])).toEqual({
      id: minted[3],
      tool: 'paragraph',
      data: { text: ' three', textColor: 'red' },
      tunes: { align: 'center' },
      isValid: true,
      parentId: 'table-1',
    });
  });

  it('keeps inline marks whole on both sides of an image they wrap', () => {
    const table = makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']);
    const paragraph = makeCellParagraph('p-1', '<b>bold <img src="a.png"> still bold</b>', 'table-1');

    const result = normalizeInlineImages([table, paragraph]);

    expect(result.slice(1).map((b) => b.tool === 'image' ? b.data.url : b.data.text)).toEqual(
      ['<b>bold </b>', 'a.png', '<b> still bold</b>']
    );
  });

  it('drops the empty mark left at the edge of an image', () => {
    const table = makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']);
    const paragraph = makeCellParagraph('p-1', '<b><img src="a.png">after</b>', 'table-1');

    const result = normalizeInlineImages([table, paragraph]);

    expect(result.slice(1).map((b) => b.tool === 'image' ? b.data.url : b.data.text)).toEqual(['a.png', '<b>after</b>']);
    expect(result.slice(1).map((b) => b.id)).toEqual([...mintedIds([table, paragraph], result), 'p-1']);
  });

  it('extracts nothing on a second pass over its own output', () => {
    const table = makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']);
    const once = normalizeInlineImages([table, makeCellParagraph('p-1', 'a <img src="a.png" alt="x"> b', 'table-1')]);

    expect(normalizeInlineImages(once)).toBe(once);
  });

  it('returns input unchanged when there are no table blocks', () => {
    const paragraph1 = makeRootParagraph('p-1', 'Hello');
    const paragraph2 = makeRootParagraph('p-2', 'World');

    const input = [paragraph1, paragraph2];
    const result = normalizeInlineImages(input);

    expect(result).toEqual(input);
  });

  it('mints the same ids every time it runs over the same document', () => {
    const input = [
      makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']),
      makeCellParagraph('p-1', 'one <img src="a.png"> two <img src="b.png"> three', 'table-1'),
    ];

    const first = normalizeInlineImages(input);
    const second = normalizeInlineImages(input);

    expect(second).toEqual(first);
    expect(mintedIds(input, first)).toHaveLength(4);
  });

  it('mints ids in the editor block id format', () => {
    const input = [
      makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']),
      makeCellParagraph('p-1', 'one <img src="a.png"> two', 'table-1'),
    ];

    expect(mintedIds(input, normalizeInlineImages(input)).every(isValidBlockId)).toBe(true);
  });

  it('never mints an id another block already uses', () => {
    const table = makeTable('table-1', [[{ blocks: ['p-1'] }]], ['p-1']);
    const paragraph = makeCellParagraph('p-1', 'one <img src="a.png"> two', 'table-1');
    const minted = mintedIds([table, paragraph], normalizeInlineImages([table, paragraph]));
    const squatters = minted.map((id) => makeRootParagraph(id, 'already here'));
    const input = [...squatters, table, paragraph];

    const result = normalizeInlineImages(input);
    const ids = result.map((b) => b.id);

    expect(mintedIds(input, result)).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeInlineImages in a live editor', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('two saves of an unchanged document are identical, ids included', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table, image: Image },
      data: {
        blocks: [
          { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['p'] }]] } },
          { id: 'p', type: 'paragraph', data: { text: 'before <img src="https://x.test/cat.png" alt="cat"> after' }, parent: 't' },
        ],
      },
    }) as unknown as { isReady: Promise<unknown>; save: () => Promise<OutputData>; destroy: () => void };

    await editor.isReady;

    const first = await editor.save();
    const second = await editor.save();

    editor.destroy();

    expect(first.blocks.some((b) => b.type === 'image')).toBe(true);
    expect(second.blocks).toEqual(first.blocks);
  });
});
