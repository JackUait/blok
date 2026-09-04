import { describe, it, expect } from 'vitest';
import {
  analyzeDataFormat,
  collapseToLegacy,
  normalizeTableChildParents,
  reclaimDetachedTableCells,
  shouldCollapseToLegacy,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

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
