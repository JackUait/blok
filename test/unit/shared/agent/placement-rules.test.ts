// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkChildType, checkMove, satisfiesChildTools, snapshotTree } from '../../../../src/shared/agent/placement-rules';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { ContainerFacts, Refusal } from '../../../../src/shared/agent/placement-rules';
import type { OutputBlockData, OutputData } from '../../../../types/data-formats/output-data';

type ToolFacts = ContainerFacts & { restrictedInTableCell: boolean };

const OPEN: ToolFacts = { accepts: true, ownedByTool: false, restrictedInTableCell: false };

const localFacts = (): Map<string, ToolFacts> => new Map([
  ['paragraph', { ...OPEN }],
  ['header', { ...OPEN, restrictedInTableCell: true }],
  ['toggle', { ...OPEN, deny: ['table'] }],
  ['leaf', { ...OPEN, accepts: false }],
  ['owner', { ...OPEN, ownedByTool: true }],
  ['closedOwner', { ...OPEN, accepts: false, ownedByTool: true, deny: ['paragraph'] }],
  ['paragraphsOnly', { ...OPEN, allow: ['paragraph'] }],
  ['headersOnly', { ...OPEN, allow: ['header'] }],
  ['both', { ...OPEN, allow: ['paragraph', 'header'], deny: ['header'] }],
  ['empty', { ...OPEN, allow: [], deny: [] }],
  ['column_list', { ...OPEN, ownedByTool: true, allow: ['column'] }],
  ['column', { ...OPEN }],
  ['grid_alias', { ...OPEN, ownedByTool: true }],
]);

const block = (id: string, type = 'paragraph', parent?: string, content?: string[]): OutputBlockData => ({
  id,
  type,
  data: {},
  ...(parent !== undefined && { parent }),
  ...(content !== undefined && { content }),
});

const documentFixture = (): OutputData => ({
  blocks: [
    block('free'),
    block('h', 'header'),
    block('tg', 'toggle', undefined, ['in']),
    block('in', 'paragraph', 'tg'),
    block('leaf', 'leaf', undefined, ['legacyChild', 'legacyOther']),
    block('legacyChild', 'paragraph', 'leaf'),
    block('legacyOther', 'paragraph', 'leaf'),
    block('owner', 'owner', undefined, ['owned', 'ownedOther']),
    block('owned', 'paragraph', 'owner'),
    block('ownedOther', 'paragraph', 'owner'),
    block('otherOwner', 'owner'),
    block('closedOwner', 'closedOwner'),
    block('only', 'paragraphsOnly'),
    block('headersOnly', 'headersOnly'),
    block('both', 'both'),
    block('empty', 'empty'),
    block('unknown', 'host-defined'),
    block('unknownChild', 'host-child'),
    block('cl', 'column_list', undefined, ['c1', 'c2']),
    block('c1', 'column', 'cl', ['x1', 'x2']),
    block('x1', 'paragraph', 'c1'),
    block('x2', 'paragraph', 'c1'),
    block('c2', 'column', 'cl', ['y1']),
    block('y1', 'paragraph', 'c2'),
    {
      id: 'tbl', type: 'grid_alias',
      data: { content: [[
        { blocks: ['p1', 'p2', 'cellToggle', 'cellLeaf', 'cellOnly', 'cellColumn'] },
        { blocks: ['q1', 'q2'] },
      ]] },
      content: ['p1', 'p2', 'cellToggle', 'cellLeaf', 'cellOnly', 'cellColumn', 'q1', 'q2'],
    },
    block('p1', 'paragraph', 'tbl'),
    block('p2', 'paragraph', 'tbl'),
    block('cellToggle', 'toggle', 'tbl', ['deepToggle']),
    block('deepToggle', 'toggle', 'cellToggle', ['deep1', 'deep2', 'cellHeader']),
    block('deep1', 'paragraph', 'deepToggle'),
    block('deep2', 'paragraph', 'deepToggle'),
    block('cellHeader', 'header', 'deepToggle'),
    block('cellLeaf', 'leaf', 'tbl'),
    block('cellOnly', 'paragraphsOnly', 'tbl'),
    block('cellColumn', 'column', 'tbl'),
    block('q1', 'paragraph', 'tbl'),
    block('q2', 'paragraph', 'tbl'),
  ],
});

const fixture = (facts = localFacts()) => {
  const snapshot = DocSnapshot.fromOutput(documentFixture());

  return { snapshot, tree: snapshotTree(snapshot, type => facts.get(type)) };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('satisfiesChildTools', () => {
  const cases: Array<{ name: string; allow?: string[]; deny?: string[]; type: string; expected: boolean }> = [
    { name: 'omitted lists', type: 'paragraph', expected: true },
    { name: 'empty lists', allow: [], deny: [], type: 'paragraph', expected: true },
    { name: 'empty allow with a deny match', allow: [], deny: ['paragraph'], type: 'paragraph', expected: false },
    { name: 'empty deny with an allow match', allow: ['paragraph'], deny: [], type: 'paragraph', expected: true },
    { name: 'allow match', allow: ['paragraph'], type: 'paragraph', expected: true },
    { name: 'allow miss', allow: ['paragraph'], type: 'header', expected: false },
    { name: 'deny match', deny: ['header'], type: 'header', expected: false },
    { name: 'deny miss', deny: ['header'], type: 'paragraph', expected: true },
    { name: 'deny wins when both lists name the tool', allow: ['header'], deny: ['header'], type: 'header', expected: false },
    { name: 'allow still limits tools absent from deny', allow: ['paragraph'], deny: ['table'], type: 'header', expected: false },
  ];

  it.each(cases)('$name', ({ allow, deny, type, expected }) => {
    expect(satisfiesChildTools(allow, deny, type)).toBe(expected);
  });

  it('does not change the declaration', () => {
    const allow = ['paragraph', 'header'];
    const deny = ['header'];

    satisfiesChildTools(allow, deny, 'header');

    expect({ allow, deny }).toEqual({ allow: ['paragraph', 'header'], deny: ['header'] });
  });
});

describe('checkChildType over real snapshot data', () => {
  const cases: Array<{ name: string; parentId: string | null; type: string; expected: Refusal | null }> = [
    { name: 'root accepts a tool restricted in cells', parentId: null, type: 'header', expected: null },
    { name: 'no children beats a denied child', parentId: 'closedOwner', type: 'paragraph',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"closedOwner" takes no children' } },
    { name: 'deny-only gives no allowed list', parentId: 'tg', type: 'table',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"tg" does not allow "table" children' } },
    { name: 'allow-only returns its allowed list', parentId: 'only', type: 'header',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"only" does not allow "header" children', allowed: ['paragraph'] } },
    { name: 'deny wins over an allow match', parentId: 'both', type: 'header',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"both" does not allow "header" children', allowed: ['paragraph', 'header'] } },
    { name: 'empty lists are unrestricted', parentId: 'empty', type: 'header', expected: null },
    { name: 'unknown parent tool is permissive', parentId: 'unknown', type: 'header', expected: null },
    { name: 'unknown child tool is not implicitly restricted', parentId: 'cellToggle', type: 'host-child', expected: null },
    { name: 'ownership does not forbid insertion', parentId: 'owner', type: 'paragraph', expected: null },
    { name: 'column-list insertion checks its allow list', parentId: 'cl', type: 'paragraph',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"cl" does not allow "paragraph" children', allowed: ['column'] } },
    { name: 'column-list insertion accepts a column', parentId: 'cl', type: 'column', expected: null },
    { name: 'no children beats a cell restriction', parentId: 'cellLeaf', type: 'header',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"cellLeaf" takes no children' } },
    { name: 'child lists beat a cell restriction', parentId: 'cellOnly', type: 'header',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"cellOnly" does not allow "header" children', allowed: ['paragraph'] } },
    { name: 'direct cell child is a prospective cell parent', parentId: 'p1', type: 'header',
      expected: { reason: 'RESTRICTED_IN_CELL', message: '"header" is not allowed inside a table cell' } },
    { name: 'deep descendant remains in a cell', parentId: 'deepToggle', type: 'header',
      expected: { reason: 'RESTRICTED_IN_CELL', message: '"header" is not allowed inside a table cell' } },
    { name: 'table container itself is not a cell', parentId: 'tbl', type: 'header', expected: null },
  ];

  it.each(cases)('$name', ({ parentId, type, expected }) => {
    expect(checkChildType(fixture().tree, parentId, type)).toEqual(expected);
  });

  it('copies the allowed list into a refusal', () => {
    const facts = localFacts();
    const { tree } = fixture(facts);
    const refusal = checkChildType(tree, 'only', 'header');

    expect(refusal).toEqual({
      reason: 'CHILD_NOT_ALLOWED', message: '"only" does not allow "header" children', allowed: ['paragraph'],
    });

    refusal?.allowed?.push('header');

    expect(facts.get('paragraphsOnly')?.allow).toEqual(['paragraph']);
    expect(checkChildType(tree, 'only', 'header')?.allowed).toEqual(['paragraph']);
  });
});

describe('checkMove refusal ordering and exact messages', () => {
  const cases: Array<{ name: string; blockId: string; parentId: string | null; refId?: string; expected: Refusal | null }> = [
    { name: 'self parent', blockId: 'tg', parentId: 'tg',
      expected: { reason: 'OWN_SUBTREE', message: 'cannot move "tg" inside its own subtree' } },
    { name: 'descendant parent', blockId: 'tg', parentId: 'in',
      expected: { reason: 'OWN_SUBTREE', message: 'cannot move "tg" inside its own subtree' } },
    { name: 'own subtree beats a cell boundary', blockId: 'tbl', parentId: 'deepToggle',
      expected: { reason: 'OWN_SUBTREE', message: 'cannot move "tbl" inside its own subtree' } },
    { name: 'cell boundary beats no children', blockId: 'free', parentId: 'cellLeaf',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "free" into, out of or between table cells' } },
    { name: 'same table parent does not mean same cell', blockId: 'p1', parentId: 'tbl', refId: 'q1',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells' } },
    { name: 'table parent without a sibling names no cell', blockId: 'p1', parentId: 'tbl',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells' } },
    { name: 'missing sibling under a table names no cell', blockId: 'p1', parentId: 'tbl', refId: 'missing',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells' } },
    { name: 'existing sibling outside cells is not a same-cell target', blockId: 'deep1', parentId: null, refId: 'free',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "deep1" into, out of or between table cells' } },
    { name: 'deep descendant cannot leave the cell', blockId: 'deep1', parentId: 'tg',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "deep1" into, out of or between table cells' } },
    { name: 'first-cell reorder beats table ownership', blockId: 'p2', parentId: 'tbl', refId: 'p1', expected: null },
    { name: 'second-cell reorder beats table ownership', blockId: 'q2', parentId: 'tbl', refId: 'q1', expected: null },
    { name: 'same parent beats no-children restriction on legacy data', blockId: 'legacyChild', parentId: 'leaf', refId: 'legacyOther', expected: null },
    { name: 'same parent beats ownership', blockId: 'owned', parentId: 'owner', refId: 'ownedOther', expected: null },
    { name: 'same parent beats column boundary and ownership', blockId: 'c1', parentId: 'cl', refId: 'c2', expected: null },
    { name: 'no children beats new-parent ownership', blockId: 'free', parentId: 'closedOwner',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"closedOwner" takes no children' } },
    { name: 'no children beats old-parent ownership', blockId: 'owned', parentId: 'leaf',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"leaf" takes no children' } },
    { name: 'new-parent ownership beats old-parent ownership', blockId: 'owned', parentId: 'otherOwner',
      expected: { reason: 'OWNS_CHILDREN', message: '"otherOwner" owns its children' } },
    { name: 'old-parent ownership beats column boundary', blockId: 'owned', parentId: 'c1',
      expected: { reason: 'OWNS_CHILDREN', message: '"owner" owns its children; "owned" cannot leave it' } },
    { name: 'leaving a table parent is still ownership even within one cell', blockId: 'p1', parentId: 'cellToggle',
      expected: { reason: 'OWNS_CHILDREN', message: '"tbl" owns its children; "p1" cannot leave it' } },
    { name: 'column boundary beats child restrictions', blockId: 'x1', parentId: 'headersOnly',
      expected: { reason: 'COLUMN_BOUNDARY', message: 'cannot move "x1" into or out of a column' } },
    { name: 'entering a column', blockId: 'free', parentId: 'c1',
      expected: { reason: 'COLUMN_BOUNDARY', message: 'cannot move "free" into or out of a column' } },
    { name: 'restrictions match the alias name, not its implementation', blockId: 'tbl', parentId: 'tg', expected: null },
    { name: 'allow list refuses a different tool', blockId: 'h', parentId: 'only',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"only" does not allow "header" children', allowed: ['paragraph'] } },
    { name: 'deny wins over allow on moves', blockId: 'h', parentId: 'both',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"both" does not allow "header" children', allowed: ['paragraph', 'header'] } },
    { name: 'child lists beat a cell restriction', blockId: 'cellHeader', parentId: 'cellOnly',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"cellOnly" does not allow "header" children', allowed: ['paragraph'] } },
    { name: 'restricted tool cannot enter a new parent in its cell', blockId: 'cellHeader', parentId: 'cellToggle',
      expected: { reason: 'RESTRICTED_IN_CELL', message: '"header" is not allowed inside a table cell' } },
    { name: 'same parent keeps an existing restricted tool', blockId: 'cellHeader', parentId: 'deepToggle', refId: 'deep1', expected: null },
    { name: 'deep descendant can reparent within its cell', blockId: 'deep1', parentId: 'cellToggle', expected: null },
    { name: 'plain move', blockId: 'free', parentId: 'tg', refId: 'in', expected: null },
    { name: 'unknown tools remain permissive', blockId: 'unknownChild', parentId: 'unknown', expected: null },
    { name: 'empty lists remain unrestricted on moves', blockId: 'h', parentId: 'empty', expected: null },
  ];

  it.each(cases)('$name', ({ blockId, parentId, refId, expected }) => {
    expect(checkMove(fixture().tree, blockId, parentId, refId)).toEqual(expected);
  });

  it('returns a deny-only refusal for the actual denied tool name', () => {
    const facts = localFacts();

    facts.set('grid_alias', { ...OPEN });
    facts.set('toggle', { ...OPEN, deny: ['grid_alias'] });

    expect(checkMove(fixture(facts).tree, 'tbl', 'tg', undefined)).toEqual({
      reason: 'CHILD_NOT_ALLOWED', message: '"tg" does not allow "grid_alias" children',
    });
  });

  it('copies the allowed list on a move refusal', () => {
    const facts = localFacts();
    const { tree } = fixture(facts);
    const refusal = checkMove(tree, 'h', 'only', undefined);

    expect(refusal?.allowed).toEqual(['paragraph']);

    refusal?.allowed?.push('header');

    expect(facts.get('paragraphsOnly')?.allow).toEqual(['paragraph']);
    expect(checkMove(tree, 'h', 'only', undefined)?.allowed).toEqual(['paragraph']);
  });
});

describe('allowColumnMoves bypasses only the column boundary', () => {
  it.each([undefined, false])('keeps the boundary with allowColumnMoves=%s', allowColumnMoves => {
    expect(checkMove(fixture().tree, 'free', 'c1', undefined, { allowColumnMoves })).toEqual({
      reason: 'COLUMN_BOUNDARY', message: 'cannot move "free" into or out of a column',
    });
  });

  it.each([
    { blockId: 'free', parentId: 'c1' },
    { blockId: 'x1', parentId: null },
    { blockId: 'x1', parentId: 'c2' },
  ])('permits a legal move from $blockId to $parentId', ({ blockId, parentId }) => {
    expect(checkMove(fixture().tree, blockId, parentId, undefined, { allowColumnMoves: true })).toBeNull();
  });

  const refusals: Array<{ name: string; blockId: string; parentId: string | null; refId?: string; expected: Refusal }> = [
    { name: 'own subtree', blockId: 'c1', parentId: 'x1',
      expected: { reason: 'OWN_SUBTREE', message: 'cannot move "c1" inside its own subtree' } },
    { name: 'cell boundary', blockId: 'free', parentId: 'cellColumn',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "free" into, out of or between table cells' } },
    { name: 'same-parent cross-cell boundary', blockId: 'p1', parentId: 'tbl', refId: 'q1',
      expected: { reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "p1" into, out of or between table cells' } },
    { name: 'no children', blockId: 'x1', parentId: 'leaf',
      expected: { reason: 'TAKES_NO_CHILDREN', message: '"leaf" takes no children' } },
    { name: 'new-parent ownership', blockId: 'free', parentId: 'cl',
      expected: { reason: 'OWNS_CHILDREN', message: '"cl" owns its children' } },
    { name: 'old-parent ownership', blockId: 'c1', parentId: null,
      expected: { reason: 'OWNS_CHILDREN', message: '"cl" owns its children; "c1" cannot leave it' } },
    { name: 'child restriction', blockId: 'x1', parentId: 'headersOnly',
      expected: { reason: 'CHILD_NOT_ALLOWED', message: '"headersOnly" does not allow "paragraph" children', allowed: ['header'] } },
    { name: 'cell tool restriction', blockId: 'cellHeader', parentId: 'cellColumn',
      expected: { reason: 'RESTRICTED_IN_CELL', message: '"header" is not allowed inside a table cell' } },
  ];

  it.each(refusals)('still refuses $name', ({ blockId, parentId, refId, expected }) => {
    expect(checkMove(fixture().tree, blockId, parentId, refId, { allowColumnMoves: true })).toEqual(expected);
  });

  it.each([
    { facts: { ...OPEN, accepts: false }, expected: { reason: 'TAKES_NO_CHILDREN', message: '"c1" takes no children' } },
    { facts: { ...OPEN, ownedByTool: true }, expected: { reason: 'OWNS_CHILDREN', message: '"c1" owns its children' } },
    { facts: { ...OPEN, deny: ['paragraph'] }, expected: { reason: 'CHILD_NOT_ALLOWED', message: '"c1" does not allow "paragraph" children' } },
  ])('retains the destination column contract: $expected.reason', ({ facts: columnFacts, expected }) => {
    const facts = localFacts();

    facts.set('column', columnFacts);

    expect(checkMove(fixture(facts).tree, 'free', 'c1', undefined, { allowColumnMoves: true })).toEqual(expected);
  });
});

describe('snapshotTree cell identity', () => {
  it('compares coordinates, not freshly allocated cell records', () => {
    const { snapshot, tree } = fixture();

    expect(tree.cellOf('p1', false)).toBe(tree.cellOf('p2', false));
    expect(tree.cellOf('p1', false)).not.toBe(tree.cellOf('q1', false));
    expect(tree.cellOf('p1', false)).toBe(tree.cellOf('p1', false));
    expect(snapshot.cellOf('p1')).toEqual({ tableId: 'tbl', row: 0, col: 0 });
    expect(snapshot.cellOf('q1')).toEqual({ tableId: 'tbl', row: 0, col: 1 });
    expect(tree.typeOf('tbl')).toBe('grid_alias');
  });

  it('uses the same snapshot cell for prospective parents and deep descendants', () => {
    const { tree } = fixture();

    expect(tree.cellOf('deep1', false)).toBe(tree.cellOf('cellToggle', true));
    expect(tree.cellOf('deepToggle', true)).toBe(tree.cellOf('p1', false));
    expect(tree.cellOf('cellToggle', false)).toBe(tree.cellOf('cellToggle', true));
    expect(tree.cellOf('tbl', true)).toBeNull();
    expect(tree.cellOf('free', false)).toBeNull();
    expect(tree.cellOf('missing', false)).toBeNull();
  });

  it('takes the nearest nested cell, even when table tools use aliases', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'outer', type: 'outer_alias', data: { content: [[{ blocks: ['shell'] }]] }, content: ['shell'] },
      block('shell', 'toggle', 'outer', ['inner', 'outerLeaf']),
      {
        id: 'inner', type: 'inner_alias', parent: 'shell',
        data: { content: [[{ blocks: ['innerToggle', 'innerPeer'] }, { blocks: ['otherCell'] }]] },
        content: ['innerToggle', 'innerPeer', 'otherCell'],
      },
      block('innerToggle', 'toggle', 'inner', ['deep']),
      block('deep', 'paragraph', 'innerToggle'),
      block('innerPeer', 'paragraph', 'inner'),
      block('otherCell', 'paragraph', 'inner'),
      block('outerLeaf', 'paragraph', 'shell'),
    ] });
    const tree = snapshotTree(snapshot, () => undefined);

    expect(tree.cellOf('deep', false)).toBe(tree.cellOf('innerPeer', false));
    expect(tree.cellOf('deep', false)).not.toBe(tree.cellOf('otherCell', false));
    expect(tree.cellOf('deep', false)).not.toBe(tree.cellOf('outerLeaf', false));
    expect(snapshot.cellOf('deep')).toEqual({ tableId: 'inner', row: 0, col: 0 });
    expect(snapshot.cellOf('inner')).toEqual({ tableId: 'outer', row: 0, col: 0 });
    expect(checkMove(tree, 'deep', 'inner', 'innerPeer')).toBeNull();
    expect(checkMove(tree, 'deep', 'inner', 'otherCell')).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "deep" into, out of or between table cells',
    });
  });

  it('does not conflate equal coordinates belonging to different tables', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'first', type: 'grid', data: { content: [[{ blocks: ['a'] }]] }, content: ['a'] },
      block('a', 'paragraph', 'first'),
      { id: 'second', type: 'grid', data: { content: [[{ blocks: ['b'] }]] }, content: ['b'] },
      block('b', 'paragraph', 'second'),
    ] });
    const tree = snapshotTree(snapshot, () => undefined);

    expect(tree.cellOf('a', false)).not.toBe(tree.cellOf('b', false));
    expect(checkMove(tree, 'a', 'second', 'b')).toEqual({
      reason: 'TABLE_CELL_BOUNDARY', message: 'cannot move "a" into, out of or between table cells',
    });
  });

  it('does not mutate its snapshot while checking placements', () => {
    const { snapshot, tree } = fixture();
    const before = snapshot.toOutput();

    checkMove(tree, 'free', 'tg', 'in');
    checkMove(tree, 'p1', 'tbl', 'q1');
    checkChildType(tree, 'cellToggle', 'header');

    expect(snapshot.toOutput()).toEqual(before);
  });
});
