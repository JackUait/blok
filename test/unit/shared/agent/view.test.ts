// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { planOn, TOOLS, tool } from './fixtures';

import type { AgentCommand, DocumentView, OutputData, ViewArgs } from '../../../../types';

const long = 'x'.repeat(130);
const doc: OutputData = {
  title: 'Launch plan',
  icon: { type: 'emoji', value: 'x' },
  blocks: [
    { id: 'h1', type: 'header', data: { text: [{ text: 'Plan' }], level: 2, private: 'hidden' }, tunes: { alignment: 'center' } },
    { id: 't1', type: 'toggle', data: { text: [{ text: 'Details' }] }, content: ['branch', 'p9'] },
    { id: 'p9', type: 'paragraph', data: { text: [{ text: long, marks: { bold: true } }] }, parent: 't1' },
    { id: 'branch', type: 'toggle', data: { text: [{ text: 'Nested' }] }, parent: 't1', content: ['leaf'] },
    { id: 'leaf', type: 'paragraph', data: { text: [{ text: 'Deploy target' }] }, parent: 'branch' },
    { id: 'x4', type: 'kanban', data: { text: [{ text: 'Secret' }], status: 'ready' } },
    {
      id: 'tbl', type: 'table',
      data: { content: [[{ blocks: ['cell00'] }, { blocks: ['cell01'] }], [{ blocks: [] }, { blocks: ['cell11'] }]] },
      content: ['cell00', 'cell01', 'cell11'],
    },
    { id: 'cell00', type: 'paragraph', data: { text: [{ text: 'cell start' }] }, parent: 'tbl' },
    { id: 'cell01', type: 'paragraph', data: { text: [{ text: 'cell detail' }] }, parent: 'tbl' },
    { id: 'cell11', type: 'paragraph', data: { text: [{ text: 'cell last' }] }, parent: 'tbl' },
    { id: 'tail', type: 'paragraph', data: { text: [{ text: 'Tail details' }] } },
  ],
};

const outline: DocumentView = {
  revision: '', rootId: null,
  page: { title: 'Launch plan', icon: { type: 'emoji', value: 'x' } },
  blocks: [
    { id: 'h1', type: 'header', depth: 0, text: 'Plan', attrs: { level: 2 } },
    { id: 't1', type: 'toggle', depth: 0, text: 'Details' },
    { id: 'branch', type: 'toggle', depth: 1, parentId: 't1', text: 'Nested' },
    { id: 'leaf', type: 'paragraph', depth: 2, parentId: 'branch', text: 'Deploy target' },
    { id: 'p9', type: 'paragraph', depth: 1, parentId: 't1', text: `${'x'.repeat(120)}…`, truncated: true },
    { id: 'x4', type: 'kanban', depth: 0, opaque: true },
    { id: 'tbl', type: 'table', depth: 0 },
    { id: 'cell00', type: 'paragraph', depth: 1, parentId: 'tbl', text: 'cell start', cell: { row: 0, col: 0 } },
    { id: 'cell01', type: 'paragraph', depth: 1, parentId: 'tbl', text: 'cell detail', cell: { row: 0, col: 1 } },
    { id: 'cell11', type: 'paragraph', depth: 1, parentId: 'tbl', text: 'cell last', cell: { row: 1, col: 1 } },
    { id: 'tail', type: 'paragraph', depth: 0, text: 'Tail details' },
  ],
};

const read = (args: ViewArgs = {}, source: OutputData = doc): unknown =>
  planOn(source, [{ name: 'doc.read', args: { ...args } }]).plan.results[0];

const find = (args: Record<string, unknown>, source: OutputData = doc): unknown =>
  planOn(source, [{ name: 'doc.find', args }]).plan.results[0];

const failOf = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('doc.read outline and full detail', () => {
  it('reads content order with plain text, declared attrs, opaque blocks and zero-based cell coordinates', () => {
    expect(read()).toEqual(outline);
  });

  it('uses the same outline for explicit detail and a null document root', () => {
    expect(read({ detail: 'outline', rootId: null })).toEqual(outline);
  });

  it('keeps full data and tunes while truncating only the plain preview', () => {
    const source: OutputData = { blocks: [{
      id: 'h', type: 'header',
      data: { text: [{ text: long, marks: { bold: true } }], level: 2, private: 'keep' },
      tunes: { alignment: 'center', custom: { enabled: false } },
    }] };

    expect(read({ detail: 'full' }, source)).toEqual({
      revision: '', rootId: null,
      blocks: [{
        id: 'h', type: 'header', depth: 0,
        text: `${'x'.repeat(120)}…`, truncated: true, attrs: { level: 2 },
        data: { text: [{ text: long, marks: { bold: true } }], level: 2, private: 'keep' },
        tunes: { alignment: 'center', custom: { enabled: false } },
      }],
    });
  });

  it('reads exactly the chosen blocks in full even when detail is outline', () => {
    expect(read({ ids: ['t1', 'p9'], detail: 'outline' })).toEqual({
      revision: '', rootId: null, page: outline.page,
      blocks: [
        { id: 't1', type: 'toggle', depth: 0, text: 'Details', data: { text: [{ text: 'Details' }] } },
        {
          id: 'p9', type: 'paragraph', depth: 1, parentId: 't1',
          text: `${'x'.repeat(120)}…`, truncated: true,
          data: { text: [{ text: long, marks: { bold: true } }] },
        },
      ],
    });
  });

  it('lists chosen IDs in document reading order rather than argument order', () => {
    // 01 §3.11 requires reading order; the brief's ids.map example differs.
    expect(read({ ids: ['p9', 'h1'] })).toEqual({
      revision: '', rootId: null, page: outline.page,
      blocks: [
        {
          id: 'h1', type: 'header', depth: 0, text: 'Plan', attrs: { level: 2 },
          data: { text: [{ text: 'Plan' }], level: 2, private: 'hidden' }, tunes: { alignment: 'center' },
        },
        {
          id: 'p9', type: 'paragraph', depth: 1, parentId: 't1',
          text: `${'x'.repeat(120)}…`, truncated: true,
          data: { text: [{ text: long, marks: { bold: true } }] },
        },
      ],
    });
  });

  it('keeps an opaque block readable in full without guessing its text or attrs', () => {
    expect(read({ ids: ['x4'] })).toEqual({
      revision: '', rootId: null, page: outline.page,
      blocks: [{
        id: 'x4', type: 'kanban', depth: 0, opaque: true,
        data: { text: [{ text: 'Secret' }], status: 'ready' },
      }],
    });
  });

  it('returns no blocks for an empty ID selection', () => {
    expect(read({ ids: [] })).toEqual({ revision: '', rootId: null, page: outline.page, blocks: [] });
  });
});

describe('doc.read subtree and depth', () => {
  it('omits the named root and resets its direct children to depth zero', () => {
    expect(read({ rootId: 't1' })).toEqual({
      revision: '', rootId: 't1', page: outline.page,
      blocks: [
        { id: 'branch', type: 'toggle', depth: 0, parentId: 't1', text: 'Nested' },
        { id: 'leaf', type: 'paragraph', depth: 1, parentId: 'branch', text: 'Deploy target' },
        { id: 'p9', type: 'paragraph', depth: 0, parentId: 't1', text: `${'x'.repeat(120)}…`, truncated: true },
      ],
    });
  });

  it('counts only direct children hidden by a document depth limit', () => {
    expect(read({ depth: 0 })).toEqual({
      revision: '', rootId: null, page: outline.page,
      blocks: [
        { id: 'h1', type: 'header', depth: 0, text: 'Plan', attrs: { level: 2 } },
        { id: 't1', type: 'toggle', depth: 0, text: 'Details', childCount: 2 },
        { id: 'x4', type: 'kanban', depth: 0, opaque: true },
        { id: 'tbl', type: 'table', depth: 0, childCount: 3 },
        { id: 'tail', type: 'paragraph', depth: 0, text: 'Tail details' },
      ],
    });
  });

  it('counts hidden children only at the subtree depth boundary', () => {
    expect(read({ rootId: 't1', depth: 0 })).toEqual({
      revision: '', rootId: 't1', page: outline.page,
      blocks: [
        { id: 'branch', type: 'toggle', depth: 0, parentId: 't1', text: 'Nested', childCount: 1 },
        { id: 'p9', type: 'paragraph', depth: 0, parentId: 't1', text: `${'x'.repeat(120)}…`, truncated: true },
      ],
    });
    expect(read({ rootId: 't1', depth: 1 })).toEqual(read({ rootId: 't1' }));
  });

  it('resets depth for a nested root and returns an empty view for a leaf root', () => {
    expect(read({ rootId: 'branch' })).toEqual({
      revision: '', rootId: 'branch', page: outline.page,
      blocks: [{ id: 'leaf', type: 'paragraph', depth: 0, parentId: 'branch', text: 'Deploy target' }],
    });
    expect(read({ rootId: 'leaf' })).toEqual({ revision: '', rootId: 'leaf', page: outline.page, blocks: [] });
  });

  it('retains cell coordinates when the table is the view root', () => {
    expect(read({ rootId: 'tbl' })).toEqual({
      revision: '', rootId: 'tbl', page: outline.page,
      blocks: [
        { id: 'cell00', type: 'paragraph', depth: 0, parentId: 'tbl', text: 'cell start', cell: { row: 0, col: 0 } },
        { id: 'cell01', type: 'paragraph', depth: 0, parentId: 'tbl', text: 'cell detail', cell: { row: 0, col: 1 } },
        { id: 'cell11', type: 'paragraph', depth: 0, parentId: 'tbl', text: 'cell last', cell: { row: 1, col: 1 } },
      ],
    });
  });
});

describe('doc.read page fields and text', () => {
  it.each<{ name: string; source: OutputData; expected: DocumentView }>([
    { name: 'no fields', source: { blocks: [] }, expected: { revision: '', rootId: null, blocks: [] } },
    { name: 'an empty title', source: { title: '', blocks: [] }, expected: { revision: '', rootId: null, blocks: [] } },
    {
      name: 'title only', source: { title: 'Title', blocks: [] },
      expected: { revision: '', rootId: null, page: { title: 'Title' }, blocks: [] },
    },
    {
      name: 'image icon only', source: { icon: { type: 'image', url: 'https://example.com/icon.png' }, blocks: [] },
      expected: { revision: '', rootId: null, page: { icon: { type: 'image', url: 'https://example.com/icon.png' } }, blocks: [] },
    },
  ])('projects flat saved page fields with $name', ({ source, expected }) => {
    expect(read({}, source)).toEqual(expected);
  });

  it.each<{ name: string; textLimit: number; block: DocumentView['blocks'][number] }>([
    { name: 'zero', textLimit: 0, block: { id: 'p', type: 'paragraph', depth: 0, text: '…', truncated: true } },
    { name: 'below the text length', textLimit: 3, block: { id: 'p', type: 'paragraph', depth: 0, text: 'abc…', truncated: true } },
    { name: 'the exact text length', textLimit: 10, block: { id: 'p', type: 'paragraph', depth: 0, text: 'abcdefghij' } },
    { name: 'above the text length', textLimit: 11, block: { id: 'p', type: 'paragraph', depth: 0, text: 'abcdefghij' } },
  ])('truncates only when textLimit is $name', ({ textLimit, block }) => {
    const source: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'abcdefghij' }] } }] };

    expect(read({ textLimit }, source)).toEqual({ revision: '', rootId: null, blocks: [block] });
  });

  it('joins text segments without formatting syntax or interpreting literal markup', () => {
    const source: OutputData = { blocks: [
      { id: 'p', type: 'paragraph', data: { text: [{ text: '<b>Go</b>', marks: { bold: true } }, { text: ' live', marks: { italic: true } }] } },
      { id: 'empty', type: 'paragraph', data: { text: [] } },
    ] };

    expect(read({}, source)).toEqual({
      revision: '', rootId: null,
      blocks: [{ id: 'p', type: 'paragraph', depth: 0, text: '<b>Go</b> live' }, { id: 'empty', type: 'paragraph', depth: 0 }],
    });
  });
});

describe('doc.read paging', () => {
  it('uses the first block of the next page as its exact cursor', () => {
    expect(read({ limit: 2 })).toEqual({ ...outline, blocks: outline.blocks.slice(0, 2), next: 'c:branch' });
    expect(read({ limit: 2, cursor: 'c:branch' })).toEqual({ ...outline, blocks: outline.blocks.slice(2, 4), next: 'c:p9' });
    expect(read({ limit: 2, cursor: 'c:p9' })).toEqual({ ...outline, blocks: outline.blocks.slice(4, 6), next: 'c:tbl' });
  });

  it('omits next on the last page', () => {
    expect(read({ limit: 2, cursor: 'c:tail' })).toEqual({ ...outline, blocks: outline.blocks.slice(-1) });
  });

  it('pages a subtree without changing its relative depths', () => {
    expect(read({ rootId: 't1', limit: 1 })).toEqual({
      revision: '', rootId: 't1', page: outline.page,
      blocks: [{ id: 'branch', type: 'toggle', depth: 0, parentId: 't1', text: 'Nested' }], next: 'c:leaf',
    });
    expect(read({ rootId: 't1', limit: 1, cursor: 'c:leaf' })).toEqual({
      revision: '', rootId: 't1', page: outline.page,
      blocks: [{ id: 'leaf', type: 'paragraph', depth: 1, parentId: 'branch', text: 'Deploy target' }], next: 'c:p9',
    });
  });

  it('defaults to 200 blocks per page', () => {
    const source: OutputData = { blocks: Array.from({ length: 201 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', data: {} })) };

    expect(read({}, source)).toEqual({
      revision: '', rootId: null,
      blocks: Array.from({ length: 200 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', depth: 0 })),
      next: 'c:p200',
    });
    expect(read({ cursor: 'c:p200' }, source)).toEqual({
      revision: '', rootId: null, blocks: [{ id: 'p200', type: 'paragraph', depth: 0 }],
    });
  });

  it('attributes a deleted cursor to the read command and tells the caller to restart', () => {
    const source: OutputData = { ...doc, blocks: doc.blocks.filter(block => block.id !== 'branch' && block.id !== 'leaf') };

    expect(failOf(() => planOn(source, [
      { name: 'block.update', args: { id: 'h1', data: { level: 3 } } },
      { name: 'doc.read', args: { limit: 2, cursor: 'c:branch' } },
    ]))).toEqual({
      code: 'INVALID_ARGS',
      message: 'The cursor is no longer valid: the document changed. Re-read from the start.',
      commandIndex: 1, path: '/commands/1/args/cursor', retryable: false,
    });
  });

  it.each(['branch', 'c:', 'c:h1'])('rejects cursor %s outside the selected reading order', cursor => {
    expect(failOf(() => read({ rootId: 't1', cursor }))).toEqual({
      code: 'INVALID_ARGS',
      message: 'The cursor is no longer valid: the document changed. Re-read from the start.',
      commandIndex: 0, path: '/commands/0/args/cursor', retryable: false,
    });
  });
});

describe('doc.find', () => {
  it('finds text case-insensitively with original-case snippets in reading order', () => {
    expect(find({ text: 'DETAIL' })).toEqual({ matches: [
      { id: 't1', type: 'toggle', snippet: 'Details' },
      { id: 'cell01', type: 'paragraph', snippet: 'cell detail' },
      { id: 'tail', type: 'paragraph', snippet: 'Tail details' },
    ] });
  });

  it('requires both filters when text and type are supplied', () => {
    expect(find({ text: 'DETAIL', type: 'paragraph' })).toEqual({ matches: [
      { id: 'cell01', type: 'paragraph', snippet: 'cell detail' },
      { id: 'tail', type: 'paragraph', snippet: 'Tail details' },
    ] });
    expect(find({ text: 'not present' })).toEqual({ matches: [] });
    expect(find({ type: 'Paragraph' })).toEqual({ matches: [] });
  });

  it('finds only descendants of the named root, including deeper levels', () => {
    expect(find({ type: 'paragraph', rootId: 't1' })).toEqual({ matches: [
      { id: 'leaf', type: 'paragraph', snippet: 'Deploy target' },
      { id: 'p9', type: 'paragraph', snippet: 'x'.repeat(20) },
    ] });
    expect(find({ text: 'DETAIL', rootId: 't1' })).toEqual({ matches: [] });
  });

  it('applies an explicit result limit', () => {
    expect(find({ text: 'DETAIL', limit: 1 })).toEqual({ matches: [{ id: 't1', type: 'toggle', snippet: 'Details' }] });
  });

  it('defaults to at most 20 matches', () => {
    const source: OutputData = { blocks: Array.from({ length: 21 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', data: { text: [{ text: 'Match' }] } })) };

    expect(find({ text: 'match' }, source)).toEqual({
      matches: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, type: 'paragraph', snippet: 'Match' })),
    });
  });

  it('can find an opaque type without treating undeclared data as rich text', () => {
    expect(find({ type: 'kanban' })).toEqual({ matches: [{ id: 'x4', type: 'kanban', snippet: '' }] });
    expect(find({ text: 'Secret' })).toEqual({ matches: [] });
  });

  it('searches every declared rich field but not arbitrary data', () => {
    const source: OutputData = { blocks: [{
      id: 'card', type: 'card',
      data: { heading: [{ text: 'Card' }], caption: [{ text: 'Need' }, { text: 'le caption', marks: { bold: true } }], note: [{ text: 'Hidden' }] },
    }] };
    const tools = new Map(TOOLS);

    tools.set('card', tool('card', { richTextFields: ['heading', 'caption'] }));

    expect(planOn(source, [{ name: 'doc.find', args: { text: 'NEEDLE' } }], { tools }).plan.results[0]).toEqual({
      matches: [{ id: 'card', type: 'card', snippet: 'Card Needle caption' }],
    });
    expect(planOn(source, [{ name: 'doc.find', args: { text: 'Hidden' } }], { tools }).plan.results[0]).toEqual({ matches: [] });
  });

  it.each([
    { name: 'in the middle', text: `${'L'.repeat(30)}Needle${'R'.repeat(30)}Needle`, snippet: `${'L'.repeat(20)}Needle${'R'.repeat(20)}` },
    { name: 'at the beginning', text: `Needle${'R'.repeat(30)}`, snippet: `Needle${'R'.repeat(20)}` },
    { name: 'at the end', text: `${'L'.repeat(30)}Needle`, snippet: `${'L'.repeat(20)}Needle` },
  ])('clips the snippet around the first match $name', ({ text, snippet }) => {
    const source: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text }] } }] };

    expect(find({ text: 'needle' }, source)).toEqual({ matches: [{ id: 'p', type: 'paragraph', snippet }] });
  });
});

describe('doc command failures', () => {
  it.each<{ name: string; command: AgentCommand; path: string; details: Record<string, unknown> }>([
    { name: 'read root', command: { name: 'doc.read', args: { rootId: 'missing' } }, path: '/rootId', details: { id: 'missing' } },
    { name: 'find root', command: { name: 'doc.find', args: { text: 'DETAIL', rootId: 'missing' } }, path: '/rootId', details: { id: 'missing' } },
    { name: 'chosen ID', command: { name: 'doc.read', args: { ids: ['h1', 'missing'] } }, path: '/ids/1', details: { id: 'missing' } },
    { name: 'root ref', command: { name: 'doc.read', args: { rootId: '$missing' } }, path: '/rootId', details: { ref: 'missing' } },
    { name: 'chosen ID ref', command: { name: 'doc.read', args: { ids: ['h1', '$missing'] } }, path: '/ids/1', details: { ref: 'missing' } },
  ])('attributes a missing $name to its exact command argument', ({ command, path, details }) => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h1', data: { level: 3 } } },
      command,
    ]))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 1, path: `/commands/1/args${path}`, retryable: false, details,
    });
  });

  it('attributes a pure find failure to args at a nonzero command index', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h1', data: { level: 3 } } },
      { name: 'doc.find', args: {} },
    ]))).toEqual({
      code: 'INVALID_ARGS', message: 'Give text, type, or both.',
      commandIndex: 1, path: '/commands/1/args', retryable: false,
    });
  });
});

describe('doc commands on the batch draft', () => {
  it('reads earlier inserts and updates through refs in both rootId and ids', () => {
    const { plan } = planOn(doc, [
      {
        name: 'block.insert', ref: 'section',
        args: {
          id: 'new-section', type: 'toggle', position: 'start', data: { text: 'Section' },
          children: [{ id: 'new-child', type: 'paragraph', data: { text: 'Needle child' } }],
        },
      },
      { name: 'block.update', args: { id: '$section', data: { text: 'Renamed section' } } },
      { name: 'doc.read', args: { rootId: '$section', detail: 'full' } },
      { name: 'doc.read', args: { ids: ['$section', 'new-child'] } },
      { name: 'doc.find', args: { rootId: '$section', text: 'NEEDLE' } },
    ]);

    expect(plan.results.slice(2)).toEqual([
      {
        revision: '', rootId: 'new-section', page: outline.page,
        blocks: [{ id: 'new-child', type: 'paragraph', depth: 0, parentId: 'new-section', text: 'Needle child', data: { text: [{ text: 'Needle child' }] } }],
      },
      {
        revision: '', rootId: null, page: outline.page,
        blocks: [
          { id: 'new-section', type: 'toggle', depth: 0, text: 'Renamed section', data: { text: [{ text: 'Renamed section' }] } },
          { id: 'new-child', type: 'paragraph', depth: 1, parentId: 'new-section', text: 'Needle child', data: { text: [{ text: 'Needle child' }] } },
        ],
      },
      { matches: [{ id: 'new-child', type: 'paragraph', snippet: 'Needle child' }] },
    ]);
    expect(plan.refs).toEqual({ section: 'new-section' });
  });

  it('does not read or find deleted data and finds an earlier update', () => {
    const source: OutputData = { blocks: [
      { id: 'gone', type: 'paragraph', data: { text: [{ text: 'Needle removed' }] } },
      { id: 'stay', type: 'paragraph', data: { text: [{ text: 'Before' }] } },
    ] };
    const { plan } = planOn(source, [
      { name: 'block.delete', args: { id: 'gone' } },
      { name: 'block.update', args: { id: 'stay', data: { text: 'Needle updated' } } },
      { name: 'doc.read', args: {} },
      { name: 'doc.find', args: { text: 'NEEDLE' } },
    ]);

    expect(plan.results.slice(2)).toEqual([
      { revision: '', rootId: null, blocks: [{ id: 'stay', type: 'paragraph', depth: 0, text: 'Needle updated' }] },
      { matches: [{ id: 'stay', type: 'paragraph', snippet: 'Needle updated' }] },
    ]);
  });

  it('emits no writes and leaves the normalized snapshot unchanged for read commands', () => {
    const baseline = DocSnapshot.fromOutput(doc).toOutput();
    const { plan, draft } = planOn(doc, [
      { name: 'doc.read', args: { detail: 'full' } },
      { name: 'doc.find', args: { text: 'DETAIL' } },
    ]);

    expect(plan.edits).toEqual([]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(draft.toOutput()).toEqual(baseline);
  });
});

describe('doc.read point-in-batch consistency', () => {
  it.each<{ name: string; readArgs: ViewArgs; write: AgentCommand; level: number }>([
    {
      name: 'full detail before block.update', readArgs: { detail: 'full' },
      write: { name: 'block.update', args: { id: 'h', data: { text: 'After', level: 3 } } }, level: 3,
    },
    {
      name: 'chosen IDs before block.update', readArgs: { ids: ['h'] },
      write: { name: 'block.update', args: { id: 'h', data: { text: 'After', level: 3 } } }, level: 3,
    },
    {
      name: 'full detail before text.replace', readArgs: { detail: 'full' },
      write: { name: 'text.replace', args: { id: 'h', with: 'After' } }, level: 2,
    },
    {
      name: 'chosen IDs before text.replace', readArgs: { ids: ['h'] },
      write: { name: 'text.replace', args: { id: 'h', with: 'After' } }, level: 2,
    },
  ])('keeps earlier read data consistent with its preview: $name', ({ readArgs, write, level }) => {
    const source: OutputData = { blocks: [{
      id: 'h', type: 'header', data: { text: [{ text: 'Before' }], level: 2 },
    }] };
    const { plan } = planOn(source, [
      { name: 'doc.read', args: { ...readArgs } },
      write,
      { name: 'doc.read', args: { detail: 'full' } },
    ]);

    expect(plan.results[0]).toEqual({
      revision: '', rootId: null,
      blocks: [{
        id: 'h', type: 'header', depth: 0, text: 'Before', attrs: { level: 2 },
        data: { text: [{ text: 'Before' }], level: 2 },
      }],
    });
    expect(plan.results[2]).toEqual({
      revision: '', rootId: null,
      blocks: [{
        id: 'h', type: 'header', depth: 0, text: 'After', attrs: { level },
        data: { text: [{ text: 'After' }], level },
      }],
    });
  });
});
