import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { parseNotionBlocksV3 } from '../../../../../src/components/modules/paste/notion-blocks-v3';

/**
 * Exactness suite for the Notion `text/_notion-blocks-v3-production` parser.
 *
 * Every assertion compares the WHOLE produced array with `toStrictEqual`, so a
 * shifted, split, widened or extra field fails. The payloads are deliberately
 * malformed in one place each — this parser reads untrusted clipboard JSON, and
 * its guards and fallback values are the behaviour under test.
 */

type NotionValue = Record<string, unknown>;

/** One Notion record-map block `value` (only the fields the parser reads). */
function value(id: string, type: string, extra: NotionValue = {}): NotionValue {
  return { id, type, ...extra };
}

/** Pack values into one clipboard subtree; the FIRST value is its root. */
function subtree(values: NotionValue[]): unknown {
  const block: Record<string, { value: NotionValue }> = {};

  values.forEach((v) => {
    block[String(v.id)] = { value: v };
  });

  return { blockId: values[0].id, blockSubtree: { __version__: 3, block } };
}

/** A payload whose arguments are subtrees (each array = one selected root). */
function payload(...subtrees: NotionValue[][]): string {
  return JSON.stringify({ blocks: subtrees.map(subtree), action: 'paste', wasContiguousSelection: true });
}

/** A payload of top-level sibling blocks — the common selection shape. */
function siblings(...values: NotionValue[]): string {
  return payload(...values.map((v) => [v]));
}

/** `properties.title` carrying a single plain rich-text segment. */
function titleProps(text: string): NotionValue {
  return { properties: { title: [[text]] } };
}

/** A paragraph whose title is the given raw rich-text segment list. */
function richTextParagraph(id: string, segments: unknown[]): NotionValue {
  return value(id, 'text', { properties: { title: segments } });
}

/** An image block with an http(s) source and the given `format`. */
function imageWithFormat(id: string, format: NotionValue): NotionValue {
  return value(id, 'image', { properties: { source: [['https://example.com/p.png']] }, format });
}

/** The `data.text` of a single-paragraph parse — keeps inline assertions short. */
function paragraphText(segments: unknown[]): unknown {
  const blocks = parseNotionBlocksV3(siblings(richTextParagraph('p', segments)));

  return blocks === null ? null : blocks[0].data.text;
}

describe('parseNotionBlocksV3 — record-map guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when the only map entry carries no value', () => {
    const json = JSON.stringify({ blocks: [{ blockId: 'a', blockSubtree: { block: { a: {} } } }] });

    expect(parseNotionBlocksV3(json)).toBeNull();
  });

  it('returns null when the only map entry has a null value', () => {
    const json = JSON.stringify({ blocks: [{ blockId: 'a', blockSubtree: { block: { a: { value: null } } } }] });

    expect(parseNotionBlocksV3(json)).toBeNull();
  });

  it('returns null when the only map entry has a non-object value', () => {
    const json = JSON.stringify({ blocks: [{ blockId: 'a', blockSubtree: { block: { a: { value: 42 } } } }] });

    expect(parseNotionBlocksV3(json)).toBeNull();
  });

  it('returns null when the block map itself is null', () => {
    const json = JSON.stringify({ blocks: [{ blockId: 'a', blockSubtree: { block: null } }] });

    expect(parseNotionBlocksV3(json)).toBeNull();
  });

  it('returns null when a block map entry is null', () => {
    const json = JSON.stringify({ blocks: [{ blockId: 'a', blockSubtree: { block: { a: null } } }] });

    expect(parseNotionBlocksV3(json)).toBeNull();
  });

  it('returns null when the map resolves no values at all', () => {
    const json = JSON.stringify({ blocks: [{ blockId: 'a', blockSubtree: { block: {} } }] });

    expect(parseNotionBlocksV3(json)).toBeNull();
  });

  it('skips a null entry in the blocks array', () => {
    const json = JSON.stringify({
      blocks: [null, subtree([value('p', 'text', titleProps('Kept'))])],
    });

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'Kept' } }]);
  });

  it('emits nothing for a subtree entry without a blockId', () => {
    const json = JSON.stringify({
      blocks: [{ blockSubtree: { block: { a: { value: value('a', 'text', titleProps('Hidden')) } } } }],
    });

    expect(parseNotionBlocksV3(json)).toStrictEqual([]);
  });

  it('bookmarks a selected id whose subtree carries no value for it', () => {
    const json = JSON.stringify({
      blocks: [subtree([value('kept', 'text', titleProps('Kept'))]), { blockId: 'ghost', blockSubtree: { block: {} } }],
    });

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'kept', tool: 'paragraph', data: { text: 'Kept' } },
      { id: 'ghost', tool: 'bookmark', data: { url: 'https://www.notion.so/ghost' } },
    ]);
  });
});

describe('parseNotionBlocksV3 — walker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a shared child once, under the first parent that reaches it', () => {
    const json = payload(
      [value('p1', 'text', { ...titleProps('One'), content: ['c'] }), value('c', 'text', titleProps('Shared'))],
      [value('p2', 'text', { ...titleProps('Two'), content: ['c'] })]
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'p1', tool: 'paragraph', data: { text: 'One' } },
      { id: 'c', tool: 'paragraph', data: { text: 'Shared' }, parentId: 'p1' },
      { id: 'p2', tool: 'paragraph', data: { text: 'Two' } },
    ]);
  });

  it('drops a child id that has no value in the map', () => {
    const json = siblings(value('p', 'text', { ...titleProps('Parent'), content: ['nope'] }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'Parent' } }]);
  });

  it('walks no children when a block has no content array', () => {
    // The orphan's id is the literal Stryker replaces an empty array with, so a
    // widened `content` default would walk it and emit an extra block.
    const json = payload([
      value('p', 'text', titleProps('Alone')),
      value('Stryker was here', 'text', titleProps('Orphan')),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'Alone' } }]);
  });
});

describe('parseNotionBlocksV3 — tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expands a table with no rows into an empty grid', () => {
    const json = siblings(
      value('t', 'table', { format: { table_block_row_header: true, table_block_column_header: true } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: true, withHeadingColumn: true, content: [] },
      },
    ]);
  });

  it('ignores a non-string row id in the table content', () => {
    const json = payload([
      value('t', 'table', { content: [123, 'r1'], format: { table_block_column_order: ['c1'] } }),
      value('r1', 'table_row', { properties: { c1: [['A']] } }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r1:c1'] }]] },
      },
      { id: 'r1:c1', tool: 'paragraph', data: { text: 'A' }, parentId: 't' },
    ]);
  });

  it('keeps a row whose value is missing from the map', () => {
    const json = siblings(value('t', 'table', { content: ['ghost'] }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[]] },
      },
    ]);
  });

  it('takes the column order from the first row that has properties', () => {
    const json = payload([
      value('t', 'table', { content: ['rMissing', 'rNull', 'rProps'] }),
      value('rMissing', 'table_row'),
      value('rNull', 'table_row', { properties: null }),
      value('rProps', 'table_row', { properties: { c1: [['x']] } }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: {
          withHeadings: false,
          withHeadingColumn: false,
          content: [
            [{ blocks: ['rMissing:c1'] }],
            [{ blocks: ['rNull:c1'] }],
            [{ blocks: ['rProps:c1'] }],
          ],
        },
      },
      { id: 'rMissing:c1', tool: 'paragraph', data: { text: '' }, parentId: 't' },
      { id: 'rNull:c1', tool: 'paragraph', data: { text: '' }, parentId: 't' },
      { id: 'rProps:c1', tool: 'paragraph', data: { text: 'x' }, parentId: 't' },
    ]);
  });

  it('has no columns when no row carries a property key', () => {
    const json = payload([
      value('t', 'table', { content: ['r1'] }),
      value('r1', 'table_row', { properties: {} }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[]] },
      },
    ]);
  });

  it('falls back to row keys when the explicit column order is empty', () => {
    const json = payload([
      value('t', 'table', { content: ['r1'], format: { table_block_column_order: [] } }),
      value('r1', 'table_row', { properties: { c1: [['A']] } }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r1:c1'] }]] },
      },
      { id: 'r1:c1', tool: 'paragraph', data: { text: 'A' }, parentId: 't' },
    ]);
  });

  it('ignores a non-string column id in the explicit order', () => {
    const json = payload([
      value('t', 'table', { content: ['r1'], format: { table_block_column_order: ['c1', 7] } }),
      value('r1', 'table_row', { properties: { c1: [['A']] } }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r1:c1'] }]] },
      },
      { id: 'r1:c1', tool: 'paragraph', data: { text: 'A' }, parentId: 't' },
    ]);
  });

  it('keeps the parent of a nested table', () => {
    const json = payload([
      value('tg', 'toggle', { ...titleProps('Group'), content: ['tb'] }),
      value('tb', 'table'),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'tg', tool: 'toggle', data: { text: 'Group', isOpen: true } },
      {
        id: 'tb',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [] },
        parentId: 'tg',
      },
    ]);
  });

  it('never re-walks a row the table already consumed', () => {
    const json = payload(
      [
        value('t', 'table', { content: ['r'] }),
        value('r', 'table_row', { properties: { c1: [['A']] }, content: ['x'] }),
        value('x', 'text', titleProps('Row child')),
      ],
      [value('p', 'text', { ...titleProps('After'), content: ['r'] })]
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 't',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r:c1'] }]] },
      },
      { id: 'r:c1', tool: 'paragraph', data: { text: 'A' }, parentId: 't' },
      { id: 'p', tool: 'paragraph', data: { text: 'After' } },
    ]);
  });

  it('drops a table row that no table consumed', () => {
    const json = payload([
      value('p', 'text', { ...titleProps('Parent'), content: ['r'] }),
      value('r', 'table_row', { properties: { c1: [['A']] } }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'Parent' } }]);
  });
});

describe('parseNotionBlocksV3 — block type mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to a paragraph for an unmapped block type', () => {
    const json = siblings(value('u', 'wibble', titleProps('Fallback')));

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'u', tool: 'paragraph', data: { text: 'Fallback' } }]);
  });

  it('omits widthRatio for a column without a usable ratio', () => {
    const json = payload([
      value('cl', 'column_list', { content: ['c0', 'c1', 'c2'] }),
      value('c0', 'column'),
      value('c1', 'column', { format: { column_ratio: '0.5' } }),
      value('c2', 'column', { format: { column_ratio: 1 } }),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'cl', tool: 'column_list', data: {} },
      { id: 'c0', tool: 'column', data: {}, parentId: 'cl' },
      { id: 'c1', tool: 'column', data: {}, parentId: 'cl' },
      { id: 'c2', tool: 'column', data: {}, parentId: 'cl' },
    ]);
  });

  it('maps every service embed type through the embed/bookmark path', () => {
    const types = ['gist', 'codepen', 'maps', 'miro', 'loom', 'typeform', 'invision', 'framer', 'whimsical', 'abstract'];
    const url = 'https://intranet.acme-corp.example/page';
    const json = siblings(...types.map((type) => value(type, type, { properties: { source: [[url]] } })));

    expect(parseNotionBlocksV3(json)).toStrictEqual(
      types.map((type) => ({ id: type, tool: 'bookmark', data: { url } }))
    );
  });

  it('uses the default emoji when a callout carries an empty icon', () => {
    const json = siblings(
      value('co', 'callout', { ...titleProps('Note'), format: { page_icon: '', block_color: 'gray_background' } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'co', tool: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'gray' } },
      { id: 'co:callout-body', tool: 'paragraph', data: { text: 'Note' }, parentId: 'co' },
    ]);
  });

  it('omits the title of an untitled sub-page reference', () => {
    const json = siblings(value('pg', 'page'));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'pg', tool: 'bookmark', data: { url: 'https://www.notion.so/pg' } },
    ]);
  });

  it('drops a tab wrapper and promotes its child to the top level', () => {
    const json = payload([
      value('tb', 'tab', { ...titleProps('Tab one'), content: ['ch'] }),
      value('ch', 'text', titleProps('Inside')),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'ch', tool: 'paragraph', data: { text: 'Inside' } }]);
  });

  it('keeps a checklist item unchecked for a No property', () => {
    const json = siblings(value('td', 'to_do', { ...titleProps('Task'), properties: { title: [['Task']], checked: [['No']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'td', tool: 'list', data: { text: 'Task', style: 'checklist', checked: false } },
    ]);
  });
});

describe('parseNotionBlocksV3 — bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to a paragraph when a bookmark has no link', () => {
    const json = siblings(value('bm', 'bookmark', titleProps('Bare')));

    expect(parseNotionBlocksV3(json)).toStrictEqual([{ id: 'bm', tool: 'paragraph', data: { text: 'Bare' } }]);
  });

  it('omits image and favicon when the bookmark format carries neither', () => {
    const json = siblings(
      value('bm', 'bookmark', { properties: { link: [['https://example.com/a']], title: [['T']] } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'bm', tool: 'bookmark', data: { url: 'https://example.com/a', title: 'T' } },
    ]);
  });
});

describe('parseNotionBlocksV3 — media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits fileName for a file block with no title', () => {
    const json = siblings(value('f', 'file', { properties: { source: [['https://example.com/doc.pdf']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'f', tool: 'file', data: { url: 'https://example.com/doc.pdf' } },
    ]);
  });

  it('ignores null crop metadata', () => {
    const json = siblings(imageWithFormat('i', { image_edit_metadata: null }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('ignores a null crop region', () => {
    const json = siblings(imageWithFormat('i', { image_edit_metadata: { crop: null } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('ignores a crop region measured in pixels', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: 0, width: 50, height: 50, unit: 'px' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('ignores a crop region whose x is not a number', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: '0', y: 0, width: 50, height: 50, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('ignores a crop region whose y is not a number', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: '0', width: 50, height: 50, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('ignores a crop region whose width is not a number', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: 0, width: '50', height: 50, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('ignores a crop region whose height is not a number', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: 0, width: 50, height: '50', unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('keeps a crop that only shifts x', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 10, y: 0, width: 100, height: 100, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 'i',
        tool: 'image',
        data: { url: 'https://example.com/p.png', crop: { x: 10, y: 0, w: 100, h: 100 } },
      },
    ]);
  });

  it('keeps a crop that only shifts y', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: 10, width: 100, height: 100, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 'i',
        tool: 'image',
        data: { url: 'https://example.com/p.png', crop: { x: 0, y: 10, w: 100, h: 100 } },
      },
    ]);
  });

  it('keeps a crop that only narrows the width', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: 0, width: 50, height: 100, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 'i',
        tool: 'image',
        data: { url: 'https://example.com/p.png', crop: { x: 0, y: 0, w: 50, h: 100 } },
      },
    ]);
  });

  it('keeps a crop that only shortens the height', () => {
    const json = siblings(
      imageWithFormat('i', { image_edit_metadata: { crop: { x: 0, y: 0, width: 100, height: 50, unit: '%' } } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 'i',
        tool: 'image',
        data: { url: 'https://example.com/p.png', crop: { x: 0, y: 0, w: 100, h: 50 } },
      },
    ]);
  });

  it('carries an ellipse mask through as the crop shape', () => {
    const json = siblings(
      imageWithFormat('i', {
        image_edit_metadata: { crop: { x: 10, y: 0, width: 100, height: 100, unit: '%' }, mask: 'ellipse' },
      })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 'i',
        tool: 'image',
        data: { url: 'https://example.com/p.png', crop: { x: 10, y: 0, w: 100, h: 100, shape: 'ellipse' } },
      },
    ]);
  });

  it('bookmarks a video whose binary is an attachment', () => {
    const json = siblings(value('v', 'video', { properties: { source: [['attachment:abc:clip.mp4']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'v', tool: 'bookmark', data: { url: 'https://www.notion.so/v', title: 'clip.mp4' } },
    ]);
  });

  it('trims a padded media source before matching it', () => {
    const json = siblings(value('i', 'image', { properties: { source: [['  https://example.com/p.png  ']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'https://example.com/p.png' } },
    ]);
  });

  it('rejects a source whose http(s) prefix is not at the start', () => {
    const json = siblings(value('i', 'image', { properties: { source: [['see https://example.com/p.png']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'bookmark', data: { url: 'https://www.notion.so/i' } },
    ]);
  });

  it('accepts a plain http source', () => {
    const json = siblings(value('i', 'image', { properties: { source: [['http://example.com/p.png']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'i', tool: 'image', data: { url: 'http://example.com/p.png' } },
    ]);
  });
});

describe('parseNotionBlocksV3 — attachment fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the block title over the attachment filename', () => {
    const json = siblings(
      value('a', 'image', { properties: { source: [['attachment:abc:photo.png']], title: [['Vacation']] } })
    );

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'a', tool: 'bookmark', data: { url: 'https://www.notion.so/a', title: 'Vacation' } },
    ]);
  });

  it('omits the title when neither the block nor the source names the file', () => {
    const json = siblings(value('a', 'image', { properties: { source: [['attachment-broken']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'a', tool: 'bookmark', data: { url: 'https://www.notion.so/a' } },
    ]);
  });

  it('ignores an attachment source nested one level too deep', () => {
    // `source` is `[[text]]`; the extra array makes the first segment's head a
    // non-string, which must not be coerced back into a filename.
    const json = siblings(value('a', 'image', { properties: { source: [[['attachment:abc:nested.png']]] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'a', tool: 'bookmark', data: { url: 'https://www.notion.so/a' } },
    ]);
  });

  it('ignores an attachment reference that does not start the source', () => {
    const json = siblings(value('a', 'image', { properties: { source: [['photo attachment:abc:name.png']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'a', tool: 'bookmark', data: { url: 'https://www.notion.so/a' } },
    ]);
  });

  it('ignores an attachment filename broken by a newline', () => {
    const json = siblings(value('a', 'image', { properties: { source: [['attachment:abc:na\nme.png']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'a', tool: 'bookmark', data: { url: 'https://www.notion.so/a' } },
    ]);
  });

  it('keeps an undecodable attachment filename verbatim', () => {
    const json = siblings(value('a', 'image', { properties: { source: [['attachment:abc:100%.png']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'a', tool: 'bookmark', data: { url: 'https://www.notion.so/a', title: '100%.png' } },
    ]);
  });
});

describe('parseNotionBlocksV3 — code blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults the language when the property is absent', () => {
    const json = siblings(value('cd', 'code', titleProps('x = 1')));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'cd', tool: 'code', data: { code: 'x = 1', language: 'plain text', lineNumbers: false } },
    ]);
  });

  it('defaults the language when the property holds a non-string', () => {
    const json = siblings(value('cd', 'code', { properties: { title: [['x = 1']], language: [[42]] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'cd', tool: 'code', data: { code: 'x = 1', language: 'plain text', lineNumbers: false } },
    ]);
  });

  it('reads only well-formed plain-text segments', () => {
    const json = siblings(value('cd', 'code', { properties: { title: ['loose', [42], ['real']] } }));

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      { id: 'cd', tool: 'code', data: { code: 'real', language: 'plain text', lineNumbers: false } },
    ]);
  });
});

describe('parseNotionBlocksV3 — inline rich text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a segment that is not an array', () => {
    expect(paragraphText(['plain'])).toBe('');
  });

  it('drops a segment whose text is not a string', () => {
    expect(paragraphText([[42]])).toBe('');
  });

  it('turns every line-break flavour into a br', () => {
    expect(paragraphText([['a\rb\nc\r\nd']])).toBe('a<br>b<br>c<br>d');
  });

  it('escapes quotes inside a link href', () => {
    expect(paragraphText([['link', [['a', 'https://example.com/?q="x"']]]])).toBe(
      '<a href="https://example.com/?q=&quot;x&quot;">link</a>'
    );
  });

  it('drops a link whose href is not a string', () => {
    expect(paragraphText([['x', [['a', 42]]]])).toBe('x');
  });

  it('trims a padded link href', () => {
    expect(paragraphText([['x', [['a', '  https://example.com/a']]]])).toBe('<a href="https://example.com/a">x</a>');
  });

  it('keeps a plain http link href', () => {
    expect(paragraphText([['x', [['a', 'http://example.com/a']]]])).toBe('<a href="http://example.com/a">x</a>');
  });

  it('ignores an annotation that is not an array', () => {
    expect(paragraphText([['x', ['b']]])).toBe('x');
  });

  it('ignores an equation flag with no latex argument', () => {
    expect(paragraphText([['⁍', [['e']]]])).toBe('⁍');
  });

  it('ignores an object argument on a non-date flag', () => {
    expect(paragraphText([['x', [['a', { start_date: '2026-01-01' }]]]])).toBe('x');
  });

  it('keeps scanning past a date flag with a null argument', () => {
    expect(paragraphText([['x', [['d', null], ['d', { start_date: '2026-01-02' }]]]])).toBe('2026-01-02');
  });

  it('drops a date half that has a time but no day', () => {
    expect(paragraphText([['x', [['d', { start_date: '2026-01-01', end_time: '10:00' }]]]])).toBe('2026-01-01');
  });

  it('ignores an empty colour token', () => {
    expect(paragraphText([['x', [['h', '']]]])).toBe('x');
  });

  it('labels a page mention whose target has no properties', () => {
    const json = payload([
      richTextParagraph('p', [['‣', [['p', 'pageref']]]]),
      value('pageref', 'page'),
    ]);

    expect(parseNotionBlocksV3(json)).toStrictEqual([
      {
        id: 'p',
        tool: 'paragraph',
        data: { text: '<a href="https://www.notion.so/pageref">Untitled</a>' },
      },
    ]);
  });
});
