import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock generateBlockId to produce deterministic IDs for assertions.
 */
let idCounter = 0;

vi.mock('../../../../src/components/utils/id-generator', () => ({
  generateBlockId: (): string => {
    idCounter += 1;

    return `img-generated-${idCounter}`;
  },
}));

/**
 * Import after mock registration so the mock is in place.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic import after mock
type NormalizeModule = typeof import('../../../../src/components/modules/normalizeInlineImages');

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

describe('normalizeInlineImages', () => {
  let normalizeInlineImages: NormalizeModule['normalizeInlineImages'];

  beforeEach(async () => {
    idCounter = 0;

    const mod = await import('../../../../src/components/modules/normalizeInlineImages');

    normalizeInlineImages = mod.normalizeInlineImages;
  });

  it('extracts a single <img> from a table cell paragraph', () => {
    const table = makeTable(
      'table-1',
      [[{ blocks: ['p-1'] }]],
      ['p-1']
    );
    const paragraph = makeCellParagraph('p-1', '<img src="https://example.com/photo.jpg">', 'table-1');

    const result = normalizeInlineImages([table, paragraph]);

    // New image block should be created
    const imageBlock = result.find((b) => b.tool === 'image');

    expect(imageBlock).toEqual({
      id: 'img-generated-1',
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

    expect(updatedTable?.contentIds).toContain('img-generated-1');

    // The cell's blocks array in table data should include the image block ID before the paragraph
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual(['img-generated-1', 'p-1']);
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

    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(2);

    expect(imageBlocks[0]).toEqual(expect.objectContaining({
      id: 'img-generated-1',
      data: { url: 'https://example.com/a.jpg' },
      parentId: 'table-1',
    }));

    expect(imageBlocks[1]).toEqual(expect.objectContaining({
      id: 'img-generated-2',
      data: { url: 'https://example.com/b.png' },
      parentId: 'table-1',
    }));

    // Paragraph text should be empty after both images are extracted
    const updatedParagraph = result.find((b) => b.id === 'p-1');

    expect(updatedParagraph?.data.text).toBe('');

    // Cell blocks array should have both image IDs before the paragraph
    const updatedTable = result.find((b) => b.id === 'table-1');
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual(['img-generated-1', 'img-generated-2', 'p-1']);
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

    // Paragraph text preserves surrounding text with img tag removed
    const updatedParagraph = result.find((b) => b.id === 'p-1');

    expect(updatedParagraph?.data.text).toBe('Hello  World');
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

    const imageBlocks = result.filter((b) => b.tool === 'image');

    expect(imageBlocks).toHaveLength(2);

    // First cell image
    expect(imageBlocks[0]).toEqual(expect.objectContaining({
      id: 'img-generated-1',
      data: { url: 'https://example.com/a.jpg' },
    }));

    // Second cell image
    expect(imageBlocks[1]).toEqual(expect.objectContaining({
      id: 'img-generated-2',
      data: { url: 'https://example.com/b.jpg' },
    }));

    // Each cell's blocks array should have its own image ID inserted before the paragraph
    const updatedTable = result.find((b) => b.id === 'table-1');
    const tableData = updatedTable?.data as { content: Array<Array<{ blocks: string[] }>> };

    expect(tableData.content[0][0].blocks).toEqual(['img-generated-1', 'p-1']);
    expect(tableData.content[0][1].blocks).toEqual(['img-generated-2', 'p-2']);

    // Table contentIds should include all new image block IDs
    expect(updatedTable?.contentIds).toEqual(
      expect.arrayContaining(['img-generated-1', 'img-generated-2', 'p-1', 'p-2'])
    );
  });

  it('returns input unchanged when there are no table blocks', () => {
    const paragraph1 = makeRootParagraph('p-1', 'Hello');
    const paragraph2 = makeRootParagraph('p-2', 'World');

    const input = [paragraph1, paragraph2];
    const result = normalizeInlineImages(input);

    expect(result).toEqual(input);
  });
});
