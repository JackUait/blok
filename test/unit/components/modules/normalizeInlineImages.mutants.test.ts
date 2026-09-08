import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deterministic ids so whole-array assertions can name the generated blocks.
 */
let idCounter = 0;

/**
 * The mocked generator, held in a variable so one test can make it yield
 * nothing — the only route to the `?? ''` id fallback in the source.
 */
let nextGeneratedId: () => string | undefined;

vi.mock('../../../../src/components/utils/id-generator', () => ({
  generateBlockId: () => nextGeneratedId(),
}));

/**
 * Imported after the mock is registered, so the type is taken, not the value.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic import after mock
type NormalizeModule = typeof import('../../../../src/components/modules/normalizeInlineImages');

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
 * Mutants left alive on purpose, each unobservable through the public function:
 *
 * - `\s+` -> `\s` in IMG_TAG_REGEX: the following `[^>]*` absorbs whitespace, so
 *   both forms accept exactly the same strings.
 * - `block.id !== undefined` -> `true` when filling `blockById`: the extra entry
 *   is keyed `undefined`, and every later `.get()` is passed a string
 *   (`block.parentId` past its undefined/null guard, or a `parentTableId`).
 * - `hasTable` (both the `===` -> `!==` flip and the `true` literal) and the
 *   `if (!hasTable) return blocks` early exit: a paragraph can only be extracted
 *   when `blockById.get(parentId).tool === 'table'`, which is exactly what makes
 *   `hasTable` true, so with no table the loop always falls through, the
 *   extraction map stays empty and line 118 returns the same array reference.
 * - `block.parentId === undefined` -> `false` and `block.parentId === null` ->
 *   `false` in the skip guard: `blockById` can hold neither key (it is only ever
 *   written with an `id` that passed `!== undefined`), so the lookup returns
 *   undefined and the next guard performs the same `continue`. Killable only by
 *   smuggling in a `null` id, which the published type forbids.
 * - `original === undefined` and its block (line 160): `parentTableId` is copied
 *   from a `parentId` that already resolved to a table in this same map.
 * - `info === undefined` (187) and `clonedTable === undefined` (193) and their
 *   blocks: `newImageBlocksPerParagraph` is built by iterating `extractionMap`,
 *   and `clonedTables` by iterating the same infos; nothing deletes from either.
 * - `clonedTable.contentIds !== undefined` -> `true` (220): line 178 assigns an
 *   array to every cloned table unconditionally.
 * - `block.id !== undefined` -> `true` at 237 and 246: the surviving
 *   `clonedTables.has(...)` / `extractionMap.has(...)` returns false for an
 *   undefined key, so the branch is not entered either way.
 * - `?? []` at 247 and `?? ''` at 252 plus `info?.cleanedText` -> `info.cleanedText`:
 *   both maps are keyed by the very id whose `has()` just returned true.
 */
describe('normalizeInlineImages — mutation coverage', () => {
  let normalizeInlineImages: NormalizeModule['normalizeInlineImages'];

  beforeEach(async () => {
    vi.clearAllMocks();
    idCounter = 0;
    nextGeneratedId = (): string => {
      idCounter += 1;

      return `img-${idCounter}`;
    };

    const mod = await import('../../../../src/components/modules/normalizeInlineImages');

    normalizeInlineImages = mod.normalizeInlineImages;
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
          content: [[{ blocks: ['img-1', 'img-2', 'p-1'] }, { blocks: ['p-2'] }]],
        },
        isValid: true,
        contentIds: ['p-1', 'p-2', 'img-1', 'img-2'],
      },
      { id: 'img-1', tool: 'image', data: { url: 'a.png' }, isValid: true, parentId: 't' },
      { id: 'img-2', tool: 'image', data: { url: 'b.png' }, isValid: true, parentId: 't' },
      { id: 'p-1', tool: 'paragraph', data: { text: 'Before  mid  after' }, isValid: true, parentId: 't' },
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

  it('references an image with an empty id when the generator yields none', () => {
    nextGeneratedId = (): undefined => undefined;

    const table = makeTable([[{ blocks: ['p-1'] }]], ['p-1']);
    const result = normalizeInlineImages([table, makeCellParagraph('p-1', '<img src="a.png">')]);

    expect(result).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['', 'p-1'] }]] },
        isValid: true,
        contentIds: ['p-1', ''],
      },
      { id: undefined, tool: 'image', data: { url: 'a.png' }, isValid: true, parentId: 't' },
      { id: 'p-1', tool: 'paragraph', data: { text: '' }, isValid: true, parentId: 't' },
    ]);
  });
});
