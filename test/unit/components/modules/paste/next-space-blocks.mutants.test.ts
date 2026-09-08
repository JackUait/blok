import { describe, it, expect, beforeEach, vi } from 'vitest';

import { parseNextSpaceBlocks } from '../../../../../src/components/modules/paste/next-space-blocks';

/**
 * Edge-path coverage for the buildin.ai clipboard parser: malformed envelopes,
 * repeated ids, non-string ids, missing nodes and every branch of the media /
 * colour / URL mapping. Whole-value `toStrictEqual` assertions throughout — a
 * containment check cannot see a widened, shifted or extra field.
 */

/** Page-root id: roots point `parentId` at it, and it is never in the payload. */
const PAGE = '00000000-0000-4000-8000-000000000001';

type Node = Record<string, unknown>;

/** One buildin node with the defaults a real payload carries. */
function node(uuid: string, type: number, extra: Node = {}): Node {
  return {
    uuid,
    parentId: PAGE,
    type,
    title: '',
    backgroundColor: '',
    textColor: '',
    data: { segments: [] },
    subNodes: [],
    ...extra,
  };
}

/** A `data.segments` array carrying plain-text segments. */
function segments(...texts: string[]): { segments: unknown[] } {
  return { segments: texts.map((text) => ({ text, type: 0, enhancer: {} })) };
}

/** Multi-block envelope: every node becomes its own top-level `blocks` entry. */
function envelope(...nodes: Node[]): string {
  return JSON.stringify({
    blocks: nodes.map((n) => ({ id: n.uuid, subTree: { [`raw-${String(n.uuid)}`]: n } })),
    pageId: PAGE,
    fromType: 'copy',
  });
}

/** One `blocks` entry whose subTree packs `nodes[0]` plus its descendants. */
function tree(...nodes: Node[]): string {
  const subTree: Record<string, Node> = {};

  nodes.forEach((n) => {
    subTree[`raw-${String(n.uuid)}`] = n;
  });

  return JSON.stringify({ blocks: [{ id: nodes[0].uuid, subTree }], pageId: PAGE, fromType: 'copy' });
}

describe('parseNextSpaceBlocks — envelope decoding edges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when a non-empty blocks array carries no buildin nodes', () => {
    const json = JSON.stringify({
      blocks: [{ id: 'a', subTree: { 'raw-a': { notANode: true } } }],
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toBeNull();
  });

  it('falls through to the subTree envelope when blocks is an empty array', () => {
    const json = JSON.stringify({
      blocks: [],
      subTree: { 'raw-p': node('p', 1, { data: segments('kept') }) },
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'kept' } }]);
  });

  it('skips a null blocks entry instead of reading through it', () => {
    const json = JSON.stringify({
      blocks: [null, { id: 'p', subTree: { 'raw-p': node('p', 1, { data: segments('after a hole') }) } }],
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toStrictEqual([
      { id: 'p', tool: 'paragraph', data: { text: 'after a hole' } },
    ]);
  });

  it('returns null for a subTree that is not an object', () => {
    expect(parseNextSpaceBlocks(JSON.stringify({ subTree: null, pageId: PAGE }))).toBeNull();
  });

  it('indexes only values carrying BOTH a string uuid and a numeric type', () => {
    const json = JSON.stringify({
      subTree: {
        'no-uuid': { type: 1, data: { segments: [] } },
        'text-type': { uuid: 'b', type: 'paragraph', data: { segments: [] } },
      },
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toBeNull();
  });

  it('treats a node whose parent is inside the copied set as a non-root', () => {
    const json = JSON.stringify({
      subTree: {
        'raw-a': node('a', 1, { data: segments('root') }),
        'raw-b': node('b', 1, { parentId: 'a', data: segments('claimed by a') }),
      },
      pageId: PAGE,
    });

    // `a` does not list `b` in subNodes, so a `b` that stays in `topLevelOrder`
    // is the only way it can reach the output.
    expect(parseNextSpaceBlocks(json)).toStrictEqual([{ id: 'a', tool: 'paragraph', data: { text: 'root' } }]);
  });
});

describe('parseNextSpaceBlocks — walker guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a node once when it is both a listed root and a child', () => {
    const parent = node('p', 1, { data: segments('parent'), subNodes: ['c'] });
    const child = node('c', 1, { parentId: 'p', data: segments('child') });
    const json = JSON.stringify({
      blocks: [
        { id: 'p', subTree: { 'raw-p': parent, 'raw-c': child } },
        { id: 'c', subTree: { 'raw-c': child } },
      ],
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toStrictEqual([
      { id: 'p', tool: 'paragraph', data: { text: 'parent' } },
      { id: 'c', tool: 'paragraph', data: { text: 'child' }, parentId: 'p' },
    ]);
  });

  it('skips a blocks entry whose id has no node in any subTree', () => {
    const json = JSON.stringify({
      blocks: [
        { id: 'ghost', subTree: {} },
        { id: 'p', subTree: { 'raw-p': node('p', 1, { data: segments('real') }) } },
      ],
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'real' } }]);
  });

  it('drops a stray table row (type 28) that is walked without its table', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('r', 28, { data: segments('orphan cell') }), node('p', 1, { data: segments('kept') }))
    );

    expect(out).toStrictEqual([{ id: 'p', tool: 'paragraph', data: { text: 'kept' } }]);
  });
});

describe('parseNextSpaceBlocks — segment text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escapes a greater-than sign', () => {
    const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('a > b') })));

    expect(out).toStrictEqual([{ id: 'a', tool: 'paragraph', data: { text: 'a &gt; b' } }]);
  });

  it('converts a lone carriage return to a single <br>', () => {
    const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('first\rsecond') })));

    expect(out).toStrictEqual([{ id: 'a', tool: 'paragraph', data: { text: 'first<br>second' } }]);
  });

  it('yields empty text when data carries no segments array', () => {
    const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: {} })));

    expect(out).toStrictEqual([{ id: 'a', tool: 'paragraph', data: { text: '' } }]);
  });

  it('contributes nothing for a segment whose text is not a string', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('a', 1, { data: { segments: [{ text: 'kept' }, { text: 42 }] } }))
    );

    expect(out).toStrictEqual([{ id: 'a', tool: 'paragraph', data: { text: 'kept' } }]);
  });

  it('contributes nothing for a null segment', () => {
    const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: { segments: [null, { text: 'kept' }] } })));

    expect(out).toStrictEqual([{ id: 'a', tool: 'paragraph', data: { text: 'kept' } }]);
  });

  it('joins raw code segments and skips the ones with non-string text', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('c', 25, { data: { segments: [{ text: 'a' }, { text: 42 }], format: { language: 'YAML' } } }))
    );

    expect(out).toStrictEqual([
      { id: 'c', tool: 'code', data: { code: 'a', language: 'yaml', lineNumbers: false } },
    ]);
  });
});

describe('parseNextSpaceBlocks — callout colours and icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to the default emoji when the icon value is an empty string', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('cl', 13, { data: { segments: [], icon: { type: 'emoji', value: '' } } }))
    );

    expect(out).toStrictEqual([
      { id: 'cl', tool: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null } },
    ]);
  });

  it('maps absent colour keys to null', () => {
    // buildin omits `textColor` / `backgroundColor` entirely on an uncoloured
    // callout, so the normalizer receives `undefined`, not an empty string.
    const out = parseNextSpaceBlocks(envelope({ uuid: 'cl', type: 13, data: { segments: [] } }));

    expect(out).toStrictEqual([
      { id: 'cl', tool: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null } },
    ]);
  });
});

describe('parseNextSpaceBlocks — columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores a columnRatio that is not a number', () => {
    const out = parseNextSpaceBlocks(
      tree(
        node('cl', 10, { subNodes: ['col'] }),
        node('col', 11, { parentId: 'cl', data: { segments: [], columnRatio: '0.5' } })
      )
    );

    expect(out).toStrictEqual([
      { id: 'cl', tool: 'column_list', data: {} },
      { id: 'col', tool: 'column', data: {}, parentId: 'cl' },
    ]);
  });
});

describe('parseNextSpaceBlocks — table expansion edges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces no rows when subNodes is not an array', () => {
    const out = parseNextSpaceBlocks(
      tree(node('tb', 27, { data: { segments: [], format: { tableBlockColumnOrder: ['A'] } }, subNodes: 'nope' }))
    );

    expect(out).toStrictEqual([
      { id: 'tb', tool: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [] } },
    ]);
  });

  it('produces no cells when the column order is not an array', () => {
    const out = parseNextSpaceBlocks(
      tree(
        node('tb', 27, {
          data: { segments: [], format: { tableBlockColumnOrder: 'A,B', tableBlockColumnHeader: true } },
          subNodes: ['r1'],
        }),
        node('r1', 28, { parentId: 'tb', data: { collectionProperties: {} } })
      )
    );

    expect(out).toStrictEqual([
      { id: 'tb', tool: 'table', data: { withHeadings: false, withHeadingColumn: true, content: [[]] } },
    ]);
  });

  it('ignores non-string row ids and column ids', () => {
    const out = parseNextSpaceBlocks(
      tree(
        node('tb', 27, {
          data: { segments: [], format: { tableBlockColumnOrder: ['A', 7] } },
          subNodes: ['r1', 9],
        }),
        node('r1', 28, { parentId: 'tb', data: { collectionProperties: { A: [{ text: 'cell' }] } } })
      )
    );

    expect(out).toStrictEqual([
      {
        id: 'tb',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r1:A'] }]] },
      },
      { id: 'r1:A', tool: 'paragraph', data: { text: 'cell' }, parentId: 'tb' },
    ]);
  });

  it('emits empty cells for a row id with no node', () => {
    const out = parseNextSpaceBlocks(
      tree(node('tb', 27, { data: { segments: [], format: { tableBlockColumnOrder: ['A'] } }, subNodes: ['gone'] }))
    );

    expect(out).toStrictEqual([
      {
        id: 'tb',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['gone:A'] }]] },
      },
      { id: 'gone:A', tool: 'paragraph', data: { text: '' }, parentId: 'tb' },
    ]);
  });

  it('keeps the parentId of a nested table', () => {
    const out = parseNextSpaceBlocks(
      tree(
        node('tg', 6, { data: segments('holder'), subNodes: ['tb'] }),
        node('tb', 27, {
          parentId: 'tg',
          data: { segments: [], format: { tableBlockColumnOrder: ['A'] } },
          subNodes: ['r1'],
        }),
        node('r1', 28, { parentId: 'tb', data: { collectionProperties: { A: [{ text: 'x' }] } } })
      )
    );

    expect(out).toStrictEqual([
      { id: 'tg', tool: 'toggle', data: { text: 'holder', isOpen: true } },
      {
        id: 'tb',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r1:A'] }]] },
        parentId: 'tg',
      },
      { id: 'r1:A', tool: 'paragraph', data: { text: 'x' }, parentId: 'tb' },
    ]);
  });

  it('never emits a consumed row again, even when it maps to a real tool', () => {
    // A malformed payload can point `subNodes` at a paragraph; expanding the
    // table consumes it, so the walker must not emit it a second time.
    const table = node('tb', 27, { data: { segments: [], format: { tableBlockColumnOrder: ['A'] } }, subNodes: ['r1'] });
    const row = node('r1', 1, { parentId: 'tb', data: segments('not really a row') });
    const json = JSON.stringify({
      blocks: [{ id: 'tb', subTree: { 'raw-tb': table, 'raw-r1': row } }, { id: 'r1', subTree: {} }],
      pageId: PAGE,
    });

    expect(parseNextSpaceBlocks(json)).toStrictEqual([
      {
        id: 'tb',
        tool: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['r1:A'] }]] },
      },
      { id: 'r1:A', tool: 'paragraph', data: { text: '' }, parentId: 'tb' },
    ]);
  });
});

describe('parseNextSpaceBlocks — media edges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the node title as the paragraph text when there is no ossName', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('m', 14, { title: 'photo.png', data: { segments: [], display: 'image' } }))
    );

    expect(out).toStrictEqual([{ id: 'm', tool: 'paragraph', data: { text: 'photo.png' } }]);
  });

  it('ignores a title that is not a string', () => {
    const out = parseNextSpaceBlocks(envelope(node('m', 14, { title: 7, data: { segments: [], display: 'file' } })));

    expect(out).toStrictEqual([{ id: 'm', tool: 'paragraph', data: { text: '' } }]);
  });

  it('omits alignment for an image whose format carries no gravity', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('im', 14, { data: { segments: [], display: 'image', ossName: 's3/x/p.png', format: {} } }))
    );

    expect(out).toStrictEqual([
      { id: 'im', tool: 'image', data: { url: 'https://cdn2.buildin.ai/s3/x/p.png' } },
    ]);
  });

  it('omits alignment for an image with no format at all', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('im', 14, { data: { segments: [], display: 'image', ossName: 's3/x/p.png' } }))
    );

    expect(out).toStrictEqual([
      { id: 'im', tool: 'image', data: { url: 'https://cdn2.buildin.ai/s3/x/p.png' } },
    ]);
  });

  it('maps LEFT gravity to a left-aligned image', () => {
    const out = parseNextSpaceBlocks(
      envelope(
        node('im', 14, {
          data: { segments: [], display: 'image', ossName: 's3/x/p.png', format: { contentGravity: 'LEFT' } },
        })
      )
    );

    expect(out).toStrictEqual([
      { id: 'im', tool: 'image', data: { url: 'https://cdn2.buildin.ai/s3/x/p.png', alignment: 'left' } },
    ]);
  });

  it('omits the audio title and fileName when the node has no name', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('au', 14, { data: { segments: [], display: 'audio', ossName: 's3/x/s.mp3' } }))
    );

    expect(out).toStrictEqual([
      { id: 'au', tool: 'audio', data: { url: 'https://cdn2.buildin.ai/s3/x/s.mp3' } },
    ]);
  });

  it('omits the file fileName when the node has no name', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('f', 14, { data: { segments: [], display: 'file', ossName: 's3/x/d.pdf' } }))
    );

    expect(out).toStrictEqual([{ id: 'f', tool: 'file', data: { url: 'https://cdn2.buildin.ai/s3/x/d.pdf' } }]);
  });
});

describe('parseNextSpaceBlocks — link resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trims a link before matching it', () => {
    const out = parseNextSpaceBlocks(
      envelope(node('e', 21, { data: { segments: [], link: '  https://example.com/x  ' } }))
    );

    expect(out).toStrictEqual([{ id: 'e', tool: 'bookmark', data: { url: 'https://example.com/x' } }]);
  });

  it('does not treat a URL mentioned mid-text as a link', () => {
    const out = parseNextSpaceBlocks(
      envelope(
        node('e', 21, {
          data: { segments: [{ text: 'see https://example.com' }], link: 'see https://example.com' },
        })
      )
    );

    expect(out).toStrictEqual([{ id: 'e', tool: 'paragraph', data: { text: 'see https://example.com' } }]);
  });

  it('accepts a plain http link', () => {
    const out = parseNextSpaceBlocks(envelope(node('e', 21, { data: { segments: [], link: 'http://example.com/x' } })));

    expect(out).toStrictEqual([{ id: 'e', tool: 'bookmark', data: { url: 'http://example.com/x' } }]);
  });

  it('joins a link carried as segments before matching it', () => {
    const out = parseNextSpaceBlocks(
      envelope(
        node('e', 21, {
          data: { segments: [], link: [{ text: 'https://example.com/' }, { text: 'deep' }] },
        })
      )
    );

    expect(out).toStrictEqual([{ id: 'e', tool: 'bookmark', data: { url: 'https://example.com/deep' } }]);
  });
});

/*
 * Mutants deliberately left alive — each is equivalent, with the reason:
 *
 * - `typeof parsed !== 'object'` (guard in `parseNextSpaceBlocks`) → false:
 *   every JSON primitive walks through `decodeEnvelope` to `byId.size === 0`
 *   and returns null anyway.
 * - `.filter((id): id is string => …)` on the blocks `topLevelOrder` → dropped,
 *   and its `typeof id === 'string'` → true: `byId` keys are always strings
 *   (`isNextSpaceNode` requires a string uuid), so a non-string id hits
 *   `node === undefined` in `walk` and returns — the same no-op.
 * - `typeof parentId !== 'string'` (root filter) → false: for a non-string
 *   parentId `!byId.has(parentId)` is true for the same reason, and for a
 *   string parentId the original already short-circuits to that test.
 * - `value.length === 0` in `normalizeBuildinColor` → false: `''` then reaches
 *   `BLOK_COLOR_NAMES.has('')`, and no COLOR_PRESETS entry is named `''`, so
 *   the result is null either way.
 * - `typeof data.display === 'string'` → true, and its `'file'` default → `''`:
 *   `display` is only ever compared against 'image' / 'video' / 'audio', and
 *   every non-match takes the file branch.
 * - the `catch` body of `safeJsonParse` → `{}`: it then returns `undefined`,
 *   which the sole caller's `typeof parsed !== 'object'` guard maps to null.
 *
 * One non-equivalent mutant is left alive: `Array.isArray(node.subNodes) ?
 * node.subNodes : []` → `["Stryker was here"]`. `walk` returns at the
 * `node === undefined` guard for that id, so it is observable only by seeding
 * the payload with a node whose uuid is the mutant's own literal string.
 */
