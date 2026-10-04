import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeInlineImages as normalize } from '../../../../src/components/modules/normalizeInlineImages';

/**
 * Block shape the normalizer accepts. `id`, `data` and `contentIds` stay
 * optional: the degenerate documents below are what reach the defensive paths.
 */
interface BlockEntry {
  id?: string;
  tool: string;
  data?: Record<string, unknown>;
  isValid: boolean;
  parentId?: string | null;
  contentIds?: string[];
}

/**
 * One table cell as stored in the table block's `data.content`.
 */
interface Cell {
  blocks: string[];
}

/**
 * Helper: a table block with the given cell grid.
 */
const makeTable = (content: Cell[][], contentIds: string[]): BlockEntry => ({
  id: 't',
  tool: 'table',
  data: { withHeadings: false, content },
  isValid: true,
  contentIds,
});

/**
 * Helper: a paragraph that lives inside a table cell.
 */
const makeCellParagraph = (id: string, text: string, parentId = 't'): BlockEntry => ({
  id,
  tool: 'paragraph',
  data: { text },
  isValid: true,
  parentId,
});

/*
 * The list of equivalent mutants was measured against the old regex version.
 * The splitter was rewritten on a DOM Range; re-run `yarn mutate` on this
 * module before marking any new live mutant equivalent.
 */
/**
 * Runs the normalizer and renames each minted id to `img-N` in output order,
 * so whole-array assertions can name the new blocks. Minted ids are hashes.
 */
const normalizeInlineImages = (input: BlockEntry[]): BlockEntry[] => {
  const result = normalize(input);

  if (result === input) {
    return result;
  }

  const before = new Set(input.map((b) => b.id));
  const names = new Map<string, string>();

  for (const { id } of result) {
    if (id !== undefined && !before.has(id)) {
      names.set(id, `img-${names.size + 1}`);
    }
  }

  const rename = (id: string): string => names.get(id) ?? id;
  const content = (data: Record<string, unknown> | undefined): Cell[][] | undefined =>
    Array.isArray(data?.content) ? (data.content as Cell[][]) : undefined;

  return result.map((block) => {
    const grid = content(block.data);

    return {
      ...block,
      ...(block.id !== undefined ? { id: rename(block.id) } : {}),
      ...(block.contentIds !== undefined ? { contentIds: block.contentIds.map(rename) } : {}),
      ...(grid !== undefined
        ? { data: { ...block.data, content: grid.map((row) => row.map((cell) => ({ ...cell, blocks: cell.blocks.map(rename) }))) } }
        : {}),
    };
  });
};

describe('normalizeInlineImages — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces the exact document, whatever the attribute order inside the tag', () => {
    const table = makeTable([[{ blocks: ['p-1'] }, { blocks: ['p-2'] }]], ['p-1', 'p-2']);
    const withImages = makeCellParagraph(
      'p-1',
      'Before <img src="a.png" alt="q"> mid <img alt="q" src="b.png"> after'
    );
    const plain = makeCellParagraph('p-2', 'plain');
    const root: BlockEntry = { id: 'p-root', tool: 'paragraph', data: { text: 'root' }, isValid: true };

    const result = normalizeInlineImages([table, withImages, plain, root]);

    expect(result).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: {
          withHeadings: false,
          content: [[{ blocks: ['p-1', 'img-1', 'img-2', 'img-3', 'img-4'] }, { blocks: ['p-2'] }]],
        },
        isValid: true,
        contentIds: ['p-1', 'img-1', 'img-2', 'img-3', 'img-4', 'p-2'],
      },
      { id: 'p-1', tool: 'paragraph', data: { text: 'Before ' }, isValid: true, parentId: 't' },
      { id: 'img-1', tool: 'image', data: { url: 'a.png', alt: 'q' }, isValid: true, parentId: 't' },
      { id: 'img-2', tool: 'paragraph', data: { text: ' mid ' }, isValid: true, parentId: 't' },
      { id: 'img-3', tool: 'image', data: { url: 'b.png', alt: 'q' }, isValid: true, parentId: 't' },
      { id: 'img-4', tool: 'paragraph', data: { text: ' after' }, isValid: true, parentId: 't' },
      { id: 'p-2', tool: 'paragraph', data: { text: 'plain' }, isValid: true, parentId: 't' },
      { id: 'p-root', tool: 'paragraph', data: { text: 'root' }, isValid: true },
    ]);
  });

  it('leaves the caller\'s table data untouched', () => {
    const table = makeTable([[{ blocks: ['p-1'] }]], ['p-1']);
    const paragraph = makeCellParagraph('p-1', '<img src="a.png">');

    normalizeInlineImages([table, paragraph]);

    expect(table.data).toStrictEqual({
      withHeadings: false,
      content: [[{ blocks: ['p-1'] }]],
    });
  });

  it('returns the very same array when a table cell paragraph holds no image', () => {
    const input = [makeTable([[{ blocks: ['p-1'] }]], ['p-1']), makeCellParagraph('p-1', 'no images')];

    expect(normalizeInlineImages(input)).toBe(input);
  });

  it('ignores a non-paragraph child of a table', () => {
    const header: BlockEntry = {
      id: 'h-1',
      tool: 'header',
      data: { text: '<img src="a.png">', level: 2 },
      isValid: true,
      parentId: 't',
    };
    const input = [makeTable([[{ blocks: ['h-1'] }]], ['h-1']), header];

    expect(normalizeInlineImages(input)).toBe(input);
  });

  it('ignores a paragraph whose parent is not a table', () => {
    const list: BlockEntry = {
      id: 'list-1',
      tool: 'list',
      data: { items: [] },
      isValid: true,
      contentIds: ['p-1'],
    };
    const input = [
      makeTable([[{ blocks: [] }]], []),
      list,
      makeCellParagraph('p-1', '<img src="a.png">', 'list-1'),
    ];

    expect(normalizeInlineImages(input)).toBe(input);
  });

  it('ignores a paragraph whose parentId names a block outside the document', () => {
    const input = [
      makeTable([[{ blocks: [] }]], []),
      makeCellParagraph('p-1', '<img src="a.png">', 'ghost'),
    ];
    const run = (): BlockEntry[] => normalizeInlineImages(input);

    expect(run).not.toThrow();
    expect(run()).toBe(input);
  });

  it('ignores a table paragraph that carries no data', () => {
    const paragraph: BlockEntry = { id: 'p-1', tool: 'paragraph', isValid: true, parentId: 't' };
    const input = [makeTable([[{ blocks: ['p-1'] }]], ['p-1']), paragraph];
    const run = (): BlockEntry[] => normalizeInlineImages(input);

    expect(run).not.toThrow();
    expect(run()).toBe(input);
  });

  it('ignores a table paragraph whose text is not a string', () => {
    const paragraph: BlockEntry = {
      id: 'p-1',
      tool: 'paragraph',
      data: { text: 42 },
      isValid: true,
      parentId: 't',
    };
    const input = [makeTable([[{ blocks: ['p-1'] }]], ['p-1']), paragraph];
    const run = (): BlockEntry[] => normalizeInlineImages(input);

    expect(run).not.toThrow();
    expect(run()).toBe(input);
  });

  it('ignores a table cell paragraph that has no id', () => {
    const paragraph: BlockEntry = {
      tool: 'paragraph',
      data: { text: '<img src="a.png">' },
      isValid: true,
      parentId: 't',
    };
    const table = makeTable([[{ blocks: [] }]], []);
    const input = [table, paragraph];

    expect(normalizeInlineImages(input)).toBe(input);
    expect(table.contentIds).toStrictEqual([]);
  });

  it('gives a table with no contentIds a fresh list holding only the new image ids', () => {
    const table: BlockEntry = {
      id: 't',
      tool: 'table',
      data: { content: [[{ blocks: ['p-1'] }]] },
      isValid: true,
    };
    let result: BlockEntry[] | undefined;

    expect(() => {
      result = normalizeInlineImages([table, makeCellParagraph('p-1', '<img src="a.png">')]);
    }).not.toThrow();

    expect(result).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { content: [[{ blocks: ['img-1', 'p-1'] }]] },
        isValid: true,
        contentIds: ['img-1'],
      },
      { id: 'img-1', tool: 'image', data: { url: 'a.png' }, isValid: true, parentId: 't' },
      { id: 'p-1', tool: 'paragraph', data: { text: '' }, isValid: true, parentId: 't' },
    ]);
  });

  it('keeps a table whose data has no content grid', () => {
    const table: BlockEntry = {
      id: 't',
      tool: 'table',
      data: { withHeadings: false },
      isValid: true,
      contentIds: ['p-1'],
    };
    let result: BlockEntry[] | undefined;

    expect(() => {
      result = normalizeInlineImages([table, makeCellParagraph('p-1', '<img src="a.png">')]);
    }).not.toThrow();

    expect(result).toStrictEqual([
      { id: 't', tool: 'table', data: { withHeadings: false }, isValid: true, contentIds: ['p-1'] },
      { id: 'img-1', tool: 'image', data: { url: 'a.png' }, isValid: true, parentId: 't' },
      { id: 'p-1', tool: 'paragraph', data: { text: '' }, isValid: true, parentId: 't' },
    ]);
  });

  it('keeps a table block that has no data at all', () => {
    const table: BlockEntry = { id: 't', tool: 'table', isValid: true, contentIds: ['p-1'] };
    let result: BlockEntry[] | undefined;

    expect(() => {
      result = normalizeInlineImages([table, makeCellParagraph('p-1', '<img src="a.png">')]);
    }).not.toThrow();

    expect(result).toStrictEqual([
      { id: 't', tool: 'table', isValid: true, contentIds: ['p-1'] },
      { id: 'img-1', tool: 'image', data: { url: 'a.png' }, isValid: true, parentId: 't' },
      { id: 'p-1', tool: 'paragraph', data: { text: '' }, isValid: true, parentId: 't' },
    ]);
  });

  it('reads the src attribute, not a data-src written after it', () => {
    const table = makeTable([[{ blocks: ['p-1'] }]], ['p-1']);
    const result = normalizeInlineImages([
      table,
      makeCellParagraph('p-1', '<img src="real.png" data-src="lazy.png">'),
    ]);

    expect(result).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['img-1', 'p-1'] }]] },
        isValid: true,
        contentIds: ['img-1', 'p-1'],
      },
      { id: 'img-1', tool: 'image', data: { url: 'real.png' }, isValid: true, parentId: 't' },
      { id: 'p-1', tool: 'paragraph', data: { text: '' }, isValid: true, parentId: 't' },
    ]);
  });

  it('extracts one image per row of a table, single and double quotes alike', () => {
    const table = makeTable([[{ blocks: ['p-1'] }], [{ blocks: ['p-2'] }]], ['p-1', 'p-2']);
    const result = normalizeInlineImages([
      table,
      makeCellParagraph('p-1', "x<img src='a.png'>"),
      makeCellParagraph('p-2', '<img src="b.png">y'),
    ]);

    expect(result).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: {
          withHeadings: false,
          content: [[{ blocks: ['p-1', 'img-1'] }], [{ blocks: ['img-2', 'p-2'] }]],
        },
        isValid: true,
        contentIds: ['p-1', 'img-1', 'img-2', 'p-2'],
      },
      { id: 'p-1', tool: 'paragraph', data: { text: 'x' }, isValid: true, parentId: 't' },
      { id: 'img-1', tool: 'image', data: { url: 'a.png' }, isValid: true, parentId: 't' },
      { id: 'img-2', tool: 'image', data: { url: 'b.png' }, isValid: true, parentId: 't' },
      { id: 'p-2', tool: 'paragraph', data: { text: 'y' }, isValid: true, parentId: 't' },
    ]);
  });

  it('returns the input unchanged when no table can parent the image paragraph', () => {
    /**
     * Neither a paragraph naming a non-table parent nor a paragraph with no
     * parent at all can reach extraction, so the `hasTable` pre-filter and the
     * parent-resolution guard decide the same question and the early return is
     * never the only thing keeping the input intact.
     */
    const list: BlockEntry = {
      id: 'list-1',
      tool: 'list',
      data: { items: [] },
      isValid: true,
      contentIds: ['p-1'],
    };
    const orphan: BlockEntry = {
      id: 'p-2',
      tool: 'paragraph',
      data: { text: '<img src="b.png">' },
      isValid: true,
      parentId: null,
    };
    const input = [list, orphan, makeCellParagraph('p-1', '<img src="a.png">', 'list-1')];

    expect(normalizeInlineImages(input)).toBe(input);
  });
});
