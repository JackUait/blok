import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  collapseToLegacy,
  expandToHierarchical,
  normalizeTableChildParents,
  reclaimDetachedTableCells,
  shouldCollapseToLegacy,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

/** Wire-tolerant fixtures: `null` ids, `null` data and function cells are the
 * shapes an external DTO can carry, and the module accepts them at runtime. */
const blocksOf = (input: unknown[]): OutputBlockData[] => input as OutputBlockData[];

const payloadOf = (block: OutputBlockData | undefined): Record<string, unknown> =>
  block?.data ?? {};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('data-model-transform - transform decision gates', () => {
  describe('shouldExpandToHierarchical', () => {
    it('expands legacy input for every model except the legacy one', () => {
      expect(shouldExpandToHierarchical('auto', 'legacy')).toBe(true);
      expect(shouldExpandToHierarchical('hierarchical', 'legacy')).toBe(true);
      expect(shouldExpandToHierarchical('legacy', 'legacy')).toBe(false);
    });

    it('never expands input that is not legacy', () => {
      expect(shouldExpandToHierarchical('auto', 'flat')).toBe(false);
      expect(shouldExpandToHierarchical('auto', 'hierarchical')).toBe(false);
      expect(shouldExpandToHierarchical('legacy', 'flat')).toBe(false);
      expect(shouldExpandToHierarchical('hierarchical', 'hierarchical')).toBe(false);
    });
  });

  describe('shouldCollapseToLegacy', () => {
    it('always collapses when the legacy model is configured', () => {
      expect(shouldCollapseToLegacy('legacy', 'flat')).toBe(true);
      expect(shouldCollapseToLegacy('legacy', 'hierarchical')).toBe(true);
      expect(shouldCollapseToLegacy('legacy', 'legacy')).toBe(true);
    });

    it('collapses under auto only when the input itself was legacy', () => {
      expect(shouldCollapseToLegacy('auto', 'legacy')).toBe(true);
      expect(shouldCollapseToLegacy('auto', 'flat')).toBe(false);
      expect(shouldCollapseToLegacy('auto', 'hierarchical')).toBe(false);
    });

    it('never collapses for the hierarchical model', () => {
      expect(shouldCollapseToLegacy('hierarchical', 'legacy')).toBe(false);
      expect(shouldCollapseToLegacy('hierarchical', 'flat')).toBe(false);
    });
  });
});

describe('data-model-transform - analyzeDataFormat reference detection', () => {
  it('treats an empty content array as no hierarchy', () => {
    const blocks: OutputBlockData[] = [
      { id: 'p1', type: 'paragraph', data: { text: 'Hello' }, content: [] },
    ];

    expect(analyzeDataFormat(blocks)).toEqual({ format: 'flat', hasHierarchy: false });
  });

  it('reports hierarchy when only some blocks carry a parent ref', () => {
    const blocks: OutputBlockData[] = [
      { id: 'p1', type: 'paragraph', data: { text: 'root' } },
      { id: 'p2', type: 'paragraph', data: { text: 'child' }, parent: 'p1' },
    ];

    expect(analyzeDataFormat(blocks)).toEqual({ format: 'hierarchical', hasHierarchy: true });
  });
});

describe('data-model-transform - collapseToLegacy list blocks', () => {
  it('collapses a plain flat list with no children', () => {
    const blocks: OutputBlockData[] = [
      { id: 'l1', type: 'list', data: { text: 'Only item', style: 'unordered' } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toStrictEqual([
      {
        id: 'l1',
        type: 'list',
        data: { style: 'unordered', items: [{ content: 'Only item', checked: undefined }] },
      },
    ]);
  });

  it('keeps the declared style and the checked flag of each item', () => {
    const blocks: OutputBlockData[] = [
      { id: 'l1', type: 'list', data: { text: 'Task', style: 'checklist', checked: true } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result[0].data).toEqual({
      style: 'checklist',
      items: [{ content: 'Task', checked: true }],
    });
  });

  it('nests a child list item under its parent item', () => {
    const blocks: OutputBlockData[] = [
      { id: 'l1', type: 'list', data: { text: 'Parent', style: 'unordered' }, content: ['l2'] },
      { id: 'l2', type: 'list', data: { text: 'Child', style: 'unordered' }, parent: 'l1' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toEqual([
      {
        id: 'l1',
        type: 'list',
        data: {
          style: 'unordered',
          items: [
            {
              content: 'Parent',
              checked: undefined,
              items: [{ content: 'Child', checked: undefined }],
            },
          ],
        },
      },
    ]);
  });

  it('keeps a content ref to a non-list child so its nesting survives the save', () => {
    // Legacy items[] cannot hold a quote, so the only way the nesting survives
    // is the list's content[] ref plus the child's own parent ref.
    const blocks: OutputBlockData[] = [
      { id: 'l1', type: 'list', data: { text: 'Item', style: 'unordered' }, content: ['q1'] },
      { id: 'q1', type: 'quote', data: { text: 'Quoted' }, parent: 'l1' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toEqual([
      {
        id: 'l1',
        type: 'list',
        data: { style: 'unordered', items: [{ content: 'Item', checked: undefined }] },
        content: ['q1'],
      },
      { id: 'q1', type: 'quote', data: { text: 'Quoted' }, parent: 'l1' },
    ]);
  });

  it('keeps an ordered list start only when it differs from 1', () => {
    const startAt = (data: Record<string, unknown>): unknown => {
      const [block] = collapseToLegacy([{ id: 'l1', type: 'list', data }]);

      return block.data.start;
    };

    expect(startAt({ text: 'Item', style: 'ordered', start: 3 })).toBe(3);
    expect(startAt({ text: 'Item', style: 'ordered', start: 1 })).toBeUndefined();
    expect(startAt({ text: 'Item', style: 'unordered', start: 3 })).toBeUndefined();
    expect(startAt({ text: 'Item', style: 'ordered' })).toBeUndefined();
  });

  it('falls back to defaults when list fields carry the wrong type', () => {
    const dataOf = (data: Record<string, unknown>): unknown => collapseToLegacy([
      { id: 'l1', type: 'list', data },
    ])[0].data;

    expect(dataOf({ text: 'Item', style: 7, checked: 'yes' })).toEqual({
      style: 'unordered',
      items: [{ content: 'Item', checked: undefined }],
    });
    expect(dataOf({ text: 'Item', style: 'ordered', start: 'three' })).toEqual({
      style: 'ordered',
      items: [{ content: 'Item', checked: undefined }],
    });
  });

  it('carries the list tunes through the collapse', () => {
    const blocks: OutputBlockData[] = [
      {
        id: 'l1',
        type: 'list',
        data: { text: 'Item', style: 'unordered' },
        tunes: { alignment: { alignment: 'center' } },
      },
    ];

    const result = collapseToLegacy(blocks);

    expect(result[0].tunes).toEqual({ alignment: { alignment: 'center' } });
  });

  it('leaves a list that already holds legacy items untouched', () => {
    // data.items marks the block as already-legacy. Re-collapsing it would
    // rebuild items[] from the block text and drop every stored item.
    const blocks: OutputBlockData[] = [
      {
        id: 'l1',
        type: 'list',
        data: { text: 'Item', style: 'unordered', items: [{ content: 'stored' }] },
      },
      { id: 'tog', type: 'toggle', data: { text: 'forces the collapse path' } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result[0].data).toEqual({
      text: 'Item',
      style: 'unordered',
      items: [{ content: 'stored' }],
    });
  });
});

describe('data-model-transform - collapseToLegacy toggle blocks', () => {
  it('writes the toggle title, open state, body and tunes into the legacy shape', () => {
    const blocks: OutputBlockData[] = [
      {
        id: 'tog',
        type: 'toggle',
        data: { text: 'Toggle title', isOpen: false },
        content: ['p1'],
        tunes: { alignment: { alignment: 'left' } },
      },
      { id: 'p1', type: 'paragraph', data: { text: 'body text' }, parent: 'tog' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toEqual([
      {
        id: 'tog',
        type: 'toggleList',
        data: {
          title: 'Toggle title',
          isExpanded: false,
          body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'body text' } }] },
        },
        tunes: { alignment: { alignment: 'left' } },
      },
    ]);
  });

  it('omits isExpanded, body and tunes when the toggle carries none of them', () => {
    // toStrictEqual, not toEqual: an `isExpanded: undefined` key would slip
    // through toEqual and reach consumers as a real field.
    const blocks: OutputBlockData[] = [
      { id: 'tog', type: 'toggle', data: { text: 'Bare toggle' } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toStrictEqual([
      { id: 'tog', type: 'toggleList', data: { title: 'Bare toggle' } },
    ]);
  });
});

describe('data-model-transform - collapseToLegacy toggleable headers', () => {
  it('writes the header level as titleVariant alongside the open state and body', () => {
    const blocks: OutputBlockData[] = [
      {
        id: 'h1',
        type: 'header',
        data: { text: 'Heading', level: 2, isToggleable: true, isOpen: true },
        content: ['p1'],
        tunes: { alignment: { alignment: 'right' } },
      },
      { id: 'p1', type: 'paragraph', data: { text: 'section text' }, parent: 'h1' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toEqual([
      {
        id: 'h1',
        type: 'toggleList',
        data: {
          title: 'Heading',
          titleVariant: 2,
          isExpanded: true,
          body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'section text' } }] },
        },
        tunes: { alignment: { alignment: 'right' } },
      },
    ]);
  });

  it('omits titleVariant, isExpanded, body and tunes when the header carries none of them', () => {
    const blocks: OutputBlockData[] = [
      { id: 'h1', type: 'header', data: { text: 'Heading', isToggleable: true } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toStrictEqual([
      { id: 'h1', type: 'toggleList', data: { title: 'Heading' } },
    ]);
  });

  it('leaves a plain header alone', () => {
    // Only isToggleable === true turns a header into a legacy toggleList.
    const blocks: OutputBlockData[] = [
      { id: 'h1', type: 'header', data: { text: 'Heading', level: 2 } },
      { id: 'tog', type: 'toggle', data: { text: 'forces the collapse path' } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result[0]).toEqual({ id: 'h1', type: 'header', data: { text: 'Heading', level: 2 } });
  });
});

describe('data-model-transform - normalizeTableChildParents', () => {
  const tableWithCellRef = (): OutputBlockData => ({
    id: 't1',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: [] }]] },
  });

  it('adopts a cell child that has no parent ref', () => {
    const blocks: OutputBlockData[] = [
      tableWithCellRef(),
      { id: 'c1', type: 'paragraph', data: { text: 'Cell A' } },
    ];

    const result = normalizeTableChildParents(blocks);

    expect(result[1]).toEqual({ id: 'c1', type: 'paragraph', data: { text: 'Cell A' }, parent: 't1' });
    expect(blocks[1].parent).toBeUndefined();
  });

  it('leaves an existing parent ref alone', () => {
    const blocks: OutputBlockData[] = [
      tableWithCellRef(),
      { id: 'c1', type: 'paragraph', data: { text: 'Cell A' }, parent: 'other' },
    ];

    expect(normalizeTableChildParents(blocks)[1].parent).toBe('other');
  });

  it('returns the same array when no table references any child block', () => {
    const blocks: OutputBlockData[] = [
      { id: 't1', type: 'table', data: { withHeadings: false, content: [['A', 'B']] } },
      { id: 'p1', type: 'paragraph', data: { text: 'loose' } },
    ];

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('ignores cell refs on a block that is not a table', () => {
    const blocks: OutputBlockData[] = [
      { id: 'x1', type: 'quote', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell A' } },
    ];

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('ignores a table whose data carries no cell grid', () => {
    const blocks: OutputBlockData[] = [
      { id: 't1', type: 'table', data: {} },
      { id: 't2', type: 'table', data: { content: 'oops' } },
      { id: 'p1', type: 'paragraph', data: { text: 'loose' } },
    ];

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('gives a child referenced by two tables to the first one', () => {
    const blocks: OutputBlockData[] = [
      tableWithCellRef(),
      {
        id: 't2',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['c1'] }]] },
      },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell A' } },
    ];

    expect(normalizeTableChildParents(blocks)[2].parent).toBe('t1');
  });
});

describe('data-model-transform - collapseToLegacy callout blocks', () => {
  it('maps the background preset to a variant and the emoji to its visibility flag', () => {
    const blocks: OutputBlockData[] = [
      {
        id: 'c1',
        type: 'callout',
        data: { text: 'Note', backgroundColor: 'blue', emoji: '\u{1F4A1}' },
        content: ['p1'],
      },
      { id: 'p1', type: 'paragraph', data: { text: 'inner' }, parent: 'c1' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toEqual([
      {
        id: 'c1',
        type: 'callout',
        data: {
          title: '',
          variant: 'note',
          emoji: '\u{1F4A1}',
          isEmojiVisible: true,
          body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'inner' } }] },
        },
      },
    ]);
  });

  it('falls back to the general variant and a hidden emoji when neither is set', () => {
    const blocks: OutputBlockData[] = [
      { id: 'c1', type: 'callout', data: { text: 'Note' } },
    ];

    const result = collapseToLegacy(blocks);

    // toStrictEqual, not toEqual: a `tunes: undefined` key would slip through
    // toEqual and reach consumers as a real field.
    expect(result).toStrictEqual([
      {
        id: 'c1',
        type: 'callout',
        data: { title: '', variant: 'general', emoji: null, isEmojiVisible: false },
      },
    ]);
  });

  it('leaves a callout that already holds a legacy body untouched', () => {
    // A stored body[] marks the callout as already-legacy. Re-collapsing it
    // would rebuild data from scratch and throw the stored body away.
    const blocks: OutputBlockData[] = [
      {
        id: 'c1',
        type: 'callout',
        data: {
          title: 'Stored',
          variant: 'note',
          body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'kept' } }] },
        },
      },
      { id: 'tog', type: 'toggle', data: { text: 'forces the collapse path' } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result[0].data).toEqual({
      title: 'Stored',
      variant: 'note',
      body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'kept' } }] },
    });
  });
});

describe('data-model-transform - collapseToLegacy nested bodies', () => {
  it('ignores a content ref that resolves to no block', () => {
    const blocks: OutputBlockData[] = [
      { id: 'tog', type: 'toggle', data: { text: 'Toggle' }, content: ['ghost'] },
    ];

    expect(collapseToLegacy(blocks)).toEqual([
      { id: 'tog', type: 'toggleList', data: { title: 'Toggle' } },
    ]);
  });

  it('collapses a callout nested in a toggle body instead of flattening it', () => {
    const blocks: OutputBlockData[] = [
      { id: 'tog', type: 'toggle', data: { text: 'Toggle' }, content: ['c1'] },
      { id: 'c1', type: 'callout', data: { text: 'Note' }, parent: 'tog', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'deep' }, parent: 'c1' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result).toEqual([
      {
        id: 'tog',
        type: 'toggleList',
        data: {
          title: 'Toggle',
          body: {
            blocks: [
              {
                id: 'c1',
                type: 'callout',
                data: {
                  title: '',
                  variant: 'general',
                  emoji: null,
                  isEmojiVisible: false,
                  body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'deep' } }] },
                },
              },
            ],
          },
        },
      },
    ]);
  });
});

describe('data-model-transform - collapseToLegacy preserved containers', () => {
  it('keeps every leaf child of a column, not just the first', () => {
    const blocks: OutputBlockData[] = [
      { id: 'tog', type: 'toggle', data: { text: 'forces the collapse path' } },
      { id: 'col', type: 'column', data: {}, content: ['a', 'b'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
      { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'col' },
    ];

    const result = collapseToLegacy(blocks);

    expect(result.find(block => block.id === 'a')?.parent).toBe('col');
    expect(result.find(block => block.id === 'b')?.parent).toBe('col');
  });

  it('keeps a table whose cells reference children that carry no parent ref', () => {
    // The cell refs in data.content are the only evidence of the containment
    // here. Lose them and the table's content[] is stripped AND the cell block
    // is re-read as a document-root list, rewriting its data.
    const blocks: OutputBlockData[] = [
      {
        id: 't1',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['c1'] }]] },
        content: ['c1'],
      },
      { id: 'c1', type: 'list', data: { text: 'Cell list', style: 'unordered' } },
    ];

    const result = collapseToLegacy(blocks);

    expect(result.find(block => block.id === 't1')?.content).toEqual(['c1']);
    expect(result.find(block => block.id === 'c1')?.data).toEqual({
      text: 'Cell list',
      style: 'unordered',
    });
  });

  it('does not read cell refs from a block that is not a table', () => {
    // Only a table stores its children as data.content[row][col].blocks. Any
    // other block carrying that shape is ordinary data, so its hierarchy refs
    // must still be stripped.
    const blocks: OutputBlockData[] = [
      { id: 'q1', type: 'quote', data: { content: [[{ blocks: ['c1'] }]] }, content: ['c1'] },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell A' } },
    ];

    expect(collapseToLegacy(blocks)[0].content).toBeUndefined();
  });

  it('strips a stale content ref from a string-cell table', () => {
    // No cell references a block id, so the table is plain legacy data and
    // must not be mistaken for a block-ref table.
    const blocks: OutputBlockData[] = [
      { id: 'tog', type: 'toggle', data: { text: 'forces the collapse path' } },
      {
        id: 't1',
        type: 'table',
        data: { withHeadings: false, content: [['A', 'B']] },
        content: ['gone'],
      },
    ];

    const result = collapseToLegacy(blocks);

    expect(result.find(block => block.id === 't1')?.content).toBeUndefined();
  });

  it('survives a table whose content is not a grid', () => {
    const blocks: OutputBlockData[] = [
      { id: 'tog', type: 'toggle', data: { text: 'forces the collapse path' } },
      { id: 't1', type: 'table', data: { content: 'oops' } },
    ];

    expect(collapseToLegacy(blocks).find(block => block.id === 't1')?.data).toEqual({ content: 'oops' });
  });
});

describe('data-model-transform - reclaimDetachedTableCells', () => {
  it('reattaches a detached migrated cell paragraph to its empty cell', () => {
    const blocks: OutputBlockData[] = [
      {
        id: 't1',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: [] }, { blocks: [] }], 'not a row'] },
      },
      { id: 'cell-1-2', type: 'paragraph', data: { text: 'Recovered' } },
    ];

    const result = reclaimDetachedTableCells(blocks);

    expect(result[0]).toEqual({
      id: 't1',
      type: 'table',
      data: { withHeadings: false, content: [[{ blocks: [] }, { blocks: ['cell-1-2'] }], 'not a row'] },
    });
    expect(result[1]).toEqual({ id: 'cell-1-2', type: 'paragraph', data: { text: 'Recovered' }, parent: 't1' });
  });

  it('leaves a block alone when some cell already references it', () => {
    // The id says row 1 / column 1, but the block already lives in another
    // cell. Reclaiming it would put the same block in two cells at once.
    const blocks: OutputBlockData[] = [
      {
        id: 't1',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: [] }], [{ blocks: ['cell-1-1'] }], 'not a row'] },
      },
      { id: 'cell-1-1', type: 'paragraph', data: { text: 'Already placed' } },
    ];

    expect(reclaimDetachedTableCells(blocks)).toBe(blocks);
  });
});

describe('data-model-transform - expandToHierarchical lossy-field warnings', () => {
  it('warns once per distinct dropped field and once per repeated one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expandToHierarchical(blocksOf([
      { type: 'list', data: { style: 'ordered', items: [{ content: 'a' }], meta: { counterType: 'numeric' } } },
      { type: 'list', data: { style: 'ordered', items: [{ content: 'b' }], meta: { counterType: 'numeric' } } },
      { type: 'quote', data: { caption: 'q', alignment: 'center' } },
    ]));

    expect(warn.mock.calls.map((call) => call[0] as unknown)).toStrictEqual([
      '[Blok migration] list block dropped unsupported field "meta.counterType" (no Blok equivalent)',
      '[Blok migration] quote block ignored unsupported field "alignment" (no Blok equivalent)',
    ]);
  });
});

describe('data-model-transform - analyzeDataFormat content-only refs', () => {
  it('treats a non-empty content array as hierarchy on its own', () => {
    // The parent ref is absent; only content[] carries the relationship.
    expect(analyzeDataFormat(blocksOf([
      { id: 'p1', type: 'paragraph', data: { text: 'root' }, content: ['p2'] },
    ]))).toStrictEqual({ format: 'hierarchical', hasHierarchy: true });
  });
});

describe('data-model-transform - list item data guards', () => {
  const nestedChildItem = (childData: unknown): unknown => {
    const result = collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { text: 'Parent', style: 'unordered' }, content: ['l2'] },
      { id: 'l2', type: 'list', data: childData, parent: 'l1' },
    ]));

    const items = payloadOf(result[0]).items as Array<{ items?: unknown[] }>;

    return items[0].items?.[0];
  };

  it('reads no text or checked flag from a non-object item payload', () => {
    const expected = { content: '', checked: undefined };

    expect(nestedChildItem(null)).toStrictEqual(expected);
    expect(nestedChildItem('not an object')).toStrictEqual(expected);
    expect(nestedChildItem({})).toStrictEqual(expected);
  });

  it('ignores a text field that is not a string', () => {
    expect(nestedChildItem({ text: 5 })).toStrictEqual({ content: '', checked: undefined });
  });

  it('ignores a checked field that is not a boolean', () => {
    expect(nestedChildItem({ text: 'Task', checked: 'yes' })).toStrictEqual({
      content: 'Task',
      checked: undefined,
    });
  });

  it('drops a content ref that resolves to no block', () => {
    // Without the undefined guard the filter dereferences the missing block.
    const result = collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { text: 'Item', style: 'unordered' }, content: ['ghost'] },
    ]));

    expect(result).toStrictEqual([
      {
        id: 'l1',
        type: 'list',
        data: { style: 'unordered', items: [{ content: 'Item', checked: undefined }] },
      },
    ]);
  });

  it('omits the start key entirely for an ordered list of one', () => {
    // toStrictEqual, not toEqual: an `start: undefined` key reaches consumers.
    expect(collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { text: 'Item', style: 'ordered' } },
    ]))).toStrictEqual([
      {
        id: 'l1',
        type: 'list',
        data: { style: 'ordered', items: [{ content: 'Item', checked: undefined }] },
      },
    ]);
  });

  it('consumes a referenced child list exactly once', () => {
    // The parent ref is absent, so only the processed-id set stops the flat
    // model from emitting the child a second time at the document root.
    const result = collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { text: 'P', style: 'unordered' }, content: ['l2'] },
      { id: 'l2', type: 'list', data: { text: 'C', style: 'unordered' } },
    ]));

    expect(result).toHaveLength(1);
  });
});

describe('data-model-transform - collapseToLegacy toggle payload guards', () => {
  it('keeps an empty title when the toggle carries no text', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: {} },
    ]))).toStrictEqual([
      { id: 'tog', type: 'toggleList', data: { title: '' } },
    ]);
  });

  it('ignores an isOpen that is not a boolean', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T', isOpen: 'yes' } },
    ]))).toStrictEqual([
      { id: 'tog', type: 'toggleList', data: { title: 'T' } },
    ]);
  });

  it('survives a toggle whose data is null', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: null },
    ]))).toStrictEqual([
      { id: 'tog', type: 'toggleList', data: { title: '' } },
    ]);
  });
});

describe('data-model-transform - collapseToLegacy toggleable header payload guards', () => {
  it('keeps an empty title when the header carries no text', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'h1', type: 'header', data: { isToggleable: true } },
    ]))).toStrictEqual([
      { id: 'h1', type: 'toggleList', data: { title: '' } },
    ]);
  });

  it('ignores a level that is not a number and an isOpen that is not a boolean', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'h1', type: 'header', data: { text: 'H', isToggleable: true, level: '2', isOpen: 'yes' } },
    ]))).toStrictEqual([
      { id: 'h1', type: 'toggleList', data: { title: 'H' } },
    ]);
  });

  it('leaves a non-header block alone even when its data says isToggleable', () => {
    // Only `type === 'header'` may enter the toggleable-header path.
    const result = collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { text: 'Item', style: 'unordered', isToggleable: true } },
    ]));

    expect(result).toHaveLength(1);
  });
});

describe('data-model-transform - collapseToLegacy callout data guards', () => {
  it('survives a callout whose data is null', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'c1', type: 'callout', data: null },
    ]))).toStrictEqual([
      { id: 'tog', type: 'toggleList', data: { title: 'T' } },
      { id: 'c1', type: 'callout', data: null },
    ]);
  });

  it('survives a callout whose data is a primitive', () => {
    expect(collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'c1', type: 'callout', data: 'oops' },
    ]))).toHaveLength(2);
  });
});

describe('data-model-transform - collapseToLegacy derived-content reconciliation', () => {
  it('groups a child under a parent that never listed it', () => {
    // The parent carries no content[]; only the child's parent ref says where
    // it belongs, and losing it drops the child from the toggle body.
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'p1', type: 'paragraph', data: { text: 'X' }, parent: 'tog' },
    ]));

    expect(result).toEqual([
      { id: 'tog', type: 'toggleList', data: { title: 'T', body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'X' } }] } } },
    ]);
  });

  it('never groups a child that carries no id', () => {
    // An id-less block cannot be named in any content[], so it must not be
    // appended to its parent's list of children.
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
      { type: 'paragraph', data: { text: 'NoId' }, parent: 'col' },
    ]));

    expect(result.find((block) => block.id === 'col')?.content).toStrictEqual(['a']);
  });
});

describe('data-model-transform - collapseToLegacy preserved-container subtree walk', () => {
  it('keeps a grandchild that hangs off an absorbing child of a column', () => {
    // The list child is legacy-absorbing, so the outer scan skips it and only
    // the recursion keeps its own children with their refs.
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'col', type: 'column', data: {}, content: ['a'] },
      { id: 'a', type: 'list', data: { text: 'A', style: 'unordered' }, parent: 'col', content: ['b'] },
      { id: 'b', type: 'list', data: { text: 'B', style: 'unordered' }, parent: 'a' },
    ]));

    expect(result.map((block) => block.id)).toStrictEqual(['tog', 'col', 'a', 'b']);
  });

  it('walks the whole descendant chain of a preserved container', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' }, content: ['col'] },
      { id: 'col', type: 'column', data: {}, parent: 'tog', content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col', content: ['b'] },
      { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'a' },
      { id: 'orph', type: 'paragraph', data: { text: 'Orphan' } },
    ]));

    const body = payloadOf(result[0]).body as { blocks: Array<{ id?: string }> };

    expect(body.blocks.map((block) => block.id)).toStrictEqual(['col', 'a', 'b']);
  });

  it('emits a container listed twice in one body only once', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' }, content: ['col', 'col'] },
      { id: 'col', type: 'column', data: {}, parent: 'tog', content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
    ]));

    const body = payloadOf(result[0]).body as { blocks: Array<{ id?: string }> };

    expect(body.blocks.map((block) => block.id)).toStrictEqual(['col', 'a']);
  });

  it('collapses a toggleable header that sits directly in a body', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' }, content: ['h1'] },
      { id: 'h1', type: 'header', data: { text: 'H', level: 2, isToggleable: true }, parent: 'tog', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'P' }, parent: 'h1' },
    ]));

    const body = payloadOf(result[0]).body as { blocks: Array<{ type: string }> };

    expect(body.blocks.map((block) => block.type)).toStrictEqual(['toggleList']);
  });

  it('terminates when two blocks name each other as parent', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, parent: 'a', content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
    ]));

    expect(result.map((block) => block.id)).toStrictEqual(['col', 'a']);
  });

  it('keeps hierarchy refs only on a parent that can absorb them', () => {
    // The no-id child's parent is a legacy list, but a legacy list folds only
    // list children into items[], so the child keeps its refs as a flat block.
    const result = collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { items: [{ content: 'A' }] }, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'P' }, parent: 'l1' },
      { type: 'paragraph', data: { text: 'NoId' }, parent: 'l1' },
    ]));

    expect(result[2].parent).toBeUndefined();
  });

  it('strips refs of a non-list child whose parent is a container', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'col', type: 'column', data: {}, content: ['x'] },
      { type: 'paragraph', data: { text: 'NoId' }, parent: 'col' },
    ]));

    expect(result[2].parent).toBeUndefined();
  });

  it('takes the collapse path when a plain header pair needs no rewriting', () => {
    // No flat list/toggle/callout exists, so the early strip path is taken and
    // the list-parented child must not keep its ref.
    const result = collapseToLegacy(blocksOf([
      { id: 'l1', type: 'list', data: { items: [{ content: 'A' }] }, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'P' }, parent: 'l1' },
      { type: 'paragraph', data: { text: 'NoId' }, parent: 'l1' },
    ]));

    expect(result).toHaveLength(3);
  });
});

describe('data-model-transform - collapseToLegacy table cell refs', () => {
  it('does not read a blocks field that is not an array as a cell ref', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 't1', type: 'table', data: { content: [[{ blocks: 'oops' }]] }, content: ['gone'] },
    ]));

    expect(result.find((block) => block.id === 't1')?.content).toBeUndefined();
  });

  it('does not read string entries of a cell as block refs', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 't1', type: 'table', data: { content: [[{ blocks: [5] }]] }, content: ['gone'] },
    ]));

    expect(result.find((block) => block.id === 't1')?.content).toBeUndefined();
  });

  it('survives a row that is not an array', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 't1', type: 'table', data: { content: [[{ blocks: ['c1'] }], 'not a row'] } },
      { id: 'c1', type: 'paragraph', data: { text: 'X' }, parent: 't1' },
    ]));

    expect(result.find((block) => block.id === 'c1')?.parent).toBe('t1');
  });

  it('does not read cell refs from a table that carries no id', () => {
    // An id-less table cannot be named as a parent, so it is not a block-ref
    // table and its children must not be held back from the strip path.
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { type: 'table', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'X' }, parent: 't0' },
    ]));

    expect(result.find((block) => block.id === 'c1')?.parent).toBeUndefined();
  });

  it('does not read cell refs from a table whose id is null', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: null, type: 'table', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'X' }, parent: 't0' },
    ]));

    expect(result.find((block) => block.id === 'c1')?.parent).toBeUndefined();
  });
});

describe('data-model-transform - normalizeTableChildParents guards', () => {
  it('ignores a cell entry that is not a block id string', () => {
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: { content: [[{ blocks: [5] }]] } },
      { id: 'p1', type: 'paragraph', data: { text: 'loose' } },
    ]);

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('ignores a table that carries no id', () => {
    const blocks = blocksOf([
      { type: 'table', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell' } },
    ]);

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('ignores a table whose data is null', () => {
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: null },
      { id: 'p1', type: 'paragraph', data: { text: 'loose' } },
    ]);

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('leaves no parent key behind on a block no table references', () => {
    const result = normalizeTableChildParents(blocksOf([
      { id: 't1', type: 'table', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'p1', type: 'paragraph', data: { text: 'loose' } },
    ]));

    expect(result[1]).toStrictEqual({ id: 'p1', type: 'paragraph', data: { text: 'loose' } });
  });

  it('adopts a cell child whose parent ref is null', () => {
    const result = normalizeTableChildParents(blocksOf([
      { id: 't1', type: 'table', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell' }, parent: null },
    ]));

    expect(result[1].parent).toBe('t1');
  });
});

describe('data-model-transform - reclaimDetachedTableCells guards', () => {
  it('ignores a table whose data carries no cell grid', () => {
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: {} },
      { id: 'cell-1-1', type: 'paragraph', data: { text: 'x' } },
    ]);

    expect(reclaimDetachedTableCells(blocks)).toBe(blocks);
  });

  it('ignores a null cell when looking for an empty cell', () => {
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: { content: [[null]] } },
      { id: 'cell-1-1', type: 'paragraph', data: { text: 'x' } },
    ]);

    expect(reclaimDetachedTableCells(blocks)).toBe(blocks);
  });

  it('does not treat a cell ref on a non-table block as a reference', () => {
    const result = reclaimDetachedTableCells(blocksOf([
      { id: 't1', type: 'table', data: { content: [[{ blocks: [] }]] } },
      { id: 'q1', type: 'quote', data: { content: [[{ blocks: ['cell-1-1'] }]] } },
      { id: 'cell-1-1', type: 'paragraph', data: { text: 'x' } },
    ]));

    expect(result[2].parent).toBe('t1');
  });

  it('counts only tables that carry an id as candidate owners', () => {
    // Two id-less/impossible tables would make the owner ambiguous; only the
    // real table may take part in the reclamation.
    const result = reclaimDetachedTableCells(blocksOf([
      { type: 'table', data: { content: [[{ blocks: [] }]] } },
      { id: null, type: 'table', data: { content: [[{ blocks: [] }]] } },
      { id: 't1', type: 'table', data: { content: [[{ blocks: [] }, { blocks: [] }]] } },
      { id: 'cell-1-2', type: 'paragraph', data: { text: 'x' } },
    ]));

    expect(result[3].parent).toBe('t1');
  });

  it('reclaims a detached cell whose parent ref is null', () => {
    const result = reclaimDetachedTableCells(blocksOf([
      { id: 't1', type: 'table', data: { content: [[{ blocks: [] }]] } },
      { id: 'cell-1-1', type: 'paragraph', data: { text: 'x' }, parent: null },
    ]));

    expect(result[1].parent).toBe('t1');
  });
});

describe('data-model-transform - preserved ids for id-less children', () => {
  it('drops a stale content ref when the only child carries no id', () => {
    // An id-less child cannot be named by any parent ref, so it never turns its
    // container into a preserved subtree — the stale ref must be stripped.
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: ['a'] },
      { type: 'paragraph', data: { text: 'NoId' }, parent: 'col' },
    ]));

    expect(result[0].content).toBeUndefined();
  });

  it('drops a stale content ref when the only child has a null id', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: ['a'] },
      { id: null, type: 'paragraph', data: { text: 'NoId' }, parent: 'col' },
    ]));

    expect(result[0].content).toBeUndefined();
  });

  it('keeps a container that has a named child', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
    ]));

    expect(result[0].content).toStrictEqual(['a']);
  });
});

describe('data-model-transform - toggleable header data guards', () => {
  it('survives a header whose data is null', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'h1', type: 'header', data: null },
    ]));

    expect(result).toHaveLength(2);
  });
});

describe('data-model-transform - collapseToLegacy processes each container once', () => {
  it('emits a content-referenced toggle only once', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog1', type: 'toggle', data: { text: 'T1' }, content: ['tog2'] },
      { id: 'tog2', type: 'toggle', data: { text: 'T2' }, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'P' }, parent: 'tog2' },
    ]));

    expect(result).toHaveLength(1);
  });

  it('emits a content-referenced toggleable header only once', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' }, content: ['h1'] },
      { id: 'h1', type: 'header', data: { text: 'H', isToggleable: true }, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'P' }, parent: 'h1' },
    ]));

    expect(result).toHaveLength(1);
  });

  it('emits a content-referenced callout only once', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' }, content: ['c1'] },
      { id: 'c1', type: 'callout', data: { text: 'C' }, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'P' }, parent: 'c1' },
    ]));

    expect(result).toHaveLength(1);
  });
});

describe('data-model-transform - mergeContentIds', () => {
  it('drops existing ids that resolve to no block', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: ['ghost'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
    ]));

    expect(result[0].content).toStrictEqual(['a']);
  });

  it('keeps an existing id that resolves to a block without a parent ref', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: ['a', 'b'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
      { id: 'b', type: 'paragraph', data: { text: 'B' } },
    ]));

    expect(result[0].content).toStrictEqual(['a', 'b']);
  });
});

describe('data-model-transform - table ref scanning guards', () => {
  it('ignores a table whose rows are all non-arrays', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 't1', type: 'table', data: { content: ['not a row'] }, content: ['gone'] },
    ]));

    expect(result.find((block) => block.id === 't1')?.content).toBeUndefined();
  });

  it('ignores a table row that is not an array', () => {
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: { content: ['not a row'] } },
      { id: 'p1', type: 'paragraph', data: { text: 'loose' } },
    ]);

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });

  it('ignores a table whose id is null', () => {
    const blocks = blocksOf([
      { id: null, type: 'table', data: { content: [[{ blocks: ['c1'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell' } },
    ]);

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });
});

describe('data-model-transform - reclaimDetachedTableCells leaves foreign blocks alone', () => {
  it('returns the same block object for a non-table that owns a content grid', () => {
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: { content: [[{ blocks: [] }]] } },
      { id: 'q1', type: 'quote', data: { content: [[{ blocks: [] }]] } },
      { id: 'cell-1-1', type: 'paragraph', data: { text: 'x' } },
    ]);

    expect(reclaimDetachedTableCells(blocks)[1]).toBe(blocks[1]);
  });
});

describe('data-model-transform - normalizeTableChildParents cell shape', () => {
  it('does not treat a callable carrying a blocks array as a table cell', () => {
    // isCellWithBlockRefs accepts only plain objects. A function that happens to
    // carry a blocks array must not be adopted as a cell owner.
    const callableCell = Object.assign(() => undefined, { blocks: ['c1'] });
    const blocks = blocksOf([
      { id: 't1', type: 'table', data: { content: [[callableCell]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'Cell' } },
    ]);

    expect(normalizeTableChildParents(blocks)).toBe(blocks);
  });
});

describe('data-model-transform - an omitted child list means no children', () => {
  it('invents no child id for a block that lists no children', () => {
    // `?? []` defaults must not resolve to a real block: a document carrying a
    // block under that literal id would otherwise gain refs and bodies.
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'h1', type: 'header', data: { text: 'H', isToggleable: true } },
      { id: 'c1', type: 'callout', data: { text: 'C' } },
      { id: 'l1', type: 'list', data: { text: 'L', style: 'unordered' } },
      { id: 'col', type: 'column', data: {}, content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
      { id: 'q1', type: 'quote', data: { text: 'Q' }, content: 'oops' },
      { id: 'qchild', type: 'paragraph', data: { text: 'QC' }, parent: 'q1' },
      { id: 'Stryker was here', type: 'paragraph', data: { text: 'S' }, content: ['ghost'] },
    ]));

    const blockById = (id: string): OutputBlockData | undefined =>
      result.find((block) => block.id === id);

    expect(blockById('Stryker was here')?.content).toBeUndefined();
    expect(blockById('l1')?.content).toBeUndefined();
    expect(blockById('q1')?.content).toStrictEqual(['qchild']);
    expect(payloadOf(blockById('tog')).body).toBeUndefined();
    expect(payloadOf(blockById('h1')).body).toBeUndefined();
    expect(payloadOf(blockById('c1')).body).toBeUndefined();
  });
});

describe('data-model-transform - an id-less block is never addressable', () => {
  it('drops a dead entry from a content list', () => {
    // The undefined entry names no block, so it must not survive into the saved
    // content[] — not even when an id-less block is present in the document.
    const result = collapseToLegacy(blocksOf([
      { id: 'col', type: 'column', data: {}, content: [undefined] },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'col' },
      { type: 'paragraph', data: { text: 'NoId' } },
    ]));

    expect(result.find((block) => block.id === 'col')?.content).toStrictEqual(['a']);
  });

  it('does not resolve an undefined child id to an id-less block', () => {
    const result = collapseToLegacy(blocksOf([
      { id: 'tog', type: 'toggle', data: { text: 'T' } },
      { id: 'l1', type: 'list', data: { text: 'Item', style: 'unordered' }, content: [undefined] },
      { type: 'paragraph', data: { text: 'NoId' } },
    ]));

    expect(result.find((block) => block.id === 'l1')?.content).toBeUndefined();
  });
});
