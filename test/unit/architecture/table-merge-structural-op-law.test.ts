import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — every structural op on a MERGED table must re-render the
 * body from the model, never mutate the DOM at physical indices.
 *
 * TableGrid's mutators (addRow, addColumn/insertColumn, deleteRow,
 * deleteColumn, moveRow, moveColumn) all assume a rectangular grid: one <td>
 * per column in every <tr>, at its own physical index, with no spans. On a
 * merged grid that is false — a covered cell has NO <td>, and the origin
 * carries a colSpan/rowSpan that only createGridFromModel ever writes. Running
 * a physical op there inserts a phantom <td> inside the merge footprint,
 * leaves the origin's span stale, and reindexCoordinates then re-derives the
 * logical coordinates from those stale spans and scrambles
 * data-blok-table-cell-col. Content typed into the phantom cell has no model
 * slot and is silently dropped on the next render.
 *
 * This bug shipped because the guard was written PER HANDLER: delete-row and
 * delete-col rebuilt, move-row/move-col bailed, and insert-row/insert-col —
 * added later — simply forgot, with nothing to catch the omission.
 *
 * THE LAW: in `table-row-col-action-handler.ts`, no handler may touch
 * `ctx.grid` structurally on its own. Every structural DOM change is passed as
 * the callback of `applyStructuralDom(ctx, …)`, which rebuilds from the model
 * when `ctx.data.hasMerges`. Read-only grid queries are fine.
 *
 * If this test failed because you added a new row/column action: wrap its DOM
 * mutation in `applyStructuralDom(ctx, () => ctx.grid.…)` — see handleInsertRow.
 * See also the "Table merged-cell coordinate law" note in CLAUDE.md.
 */

const HANDLER_PATH = join(
  __dirname,
  '../../../src/tools/table/table-row-col-action-handler.ts'
);

const GUARD = 'applyStructuralDom';

/**
 * TableGrid members a handler may reach for OUTSIDE the guard: they only read
 * the DOM (or resize <col>s), so they cannot desync a merged grid's structure.
 */
const READ_ONLY_GRID_MEMBERS = [
  'getRowCount',
  'getColumnCount',
  'getCell',
  'getColWidths',
  'getColgroup',
];

/**
 * Handlers exempt from the law, with the reason they cannot desync a merged
 * grid. Keyed by handler function name.
 */
const EXEMPTIONS: Record<string, string> = {};

/**
 * Every structural handler the dispatcher can reach. Listed explicitly so a
 * renamed or newly added handler trips the "scan went stale" test below
 * instead of silently escaping the law.
 */
const EXPECTED_STRUCTURAL_HANDLERS = [
  'handleInsertRow',
  'handleInsertCol',
  'handleDuplicateRow',
  'handleDuplicateCol',
  'handleMoveRow',
  'handleMoveCol',
  'handleDeleteRow',
  'handleDeleteCol',
];

interface HandlerSource {
  name: string;
  body: string;
}

/**
 * Drop comments before scanning: the law is about CODE. The guard's own doc
 * comment names `ctx.grid` while explaining what handlers may not do with it.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Split the file into its `const handleX = (…) => { … };` definitions.
 */
const parseHandlers = (source: string): HandlerSource[] => {
  const handlers: HandlerSource[] = [];
  const pattern = /const (handle[A-Za-z]+) = \([\s\S]*?\): ActionResult => \{([\s\S]*?)\n\s*\};/g;

  for (const match of source.matchAll(pattern)) {
    handlers.push({ name: match[1], body: match[2] });
  }

  return handlers;
};

/**
 * Character ranges covered by a `applyStructuralDom(…)` call, found by matching
 * parentheses so a multi-line callback is fully included.
 */
const guardedRanges = (source: string): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  const needle = `${GUARD}(`;

  let cursor = source.indexOf(needle);

  while (cursor !== -1) {
    const open = cursor + needle.length - 1;
    const end = source.split('').reduce<{ depth: number; close: number }>((state, char, i) => {
      if (i < open || state.close !== -1) {
        return state;
      }

      if (char === '(') {
        return { depth: state.depth + 1, close: -1 };
      }

      if (char === ')') {
        const depth = state.depth - 1;

        return depth === 0 ? { depth, close: i } : { depth, close: -1 };
      }

      return state;
    }, { depth: 0, close: -1 }).close;

    ranges.push([cursor, end === -1 ? source.length : end]);
    cursor = source.indexOf(needle, cursor + needle.length);
  }

  return ranges;
};

/**
 * Structural uses of `ctx.grid` that are NOT inside an applyStructuralDom
 * callback. Pure function of the source so the scanner itself can be
 * mutation-tested below.
 */
const findUnguardedGridUses = (source: string): string[] => {
  const ranges = guardedRanges(source);
  const isGuarded = (index: number): boolean =>
    ranges.some(([start, end]) => index > start && index < end);

  const violations: string[] = [];
  const pattern = /ctx\.grid(\.(\w+))?/g;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const member = match[2];

    if (member !== undefined && READ_ONLY_GRID_MEMBERS.includes(member)) {
      continue;
    }

    if (isGuarded(index)) {
      continue;
    }

    violations.push(member === undefined ? 'ctx.grid (passed as a value)' : `ctx.grid.${member}`);
  }

  return violations;
};

describe('table merged-grid structural-op law', () => {
  const source = (): string => stripComments(readFileSync(HANDLER_PATH, 'utf8'));

  it('the action handler and its guard helper exist (guards against a rename breaking the law silently)', () => {
    expect(existsSync(HANDLER_PATH)).toBe(true);
    expect(source()).toContain(`const ${GUARD} = (ctx: ActionContext`);
  });

  it('finds every structural handler (guards against the scan going stale)', () => {
    const names = parseHandlers(source())
      .map(handler => handler.name)
      .filter(name => /^handle(Insert|Duplicate|Move|Delete)/.test(name));

    expect(names.sort()).toEqual([...EXPECTED_STRUCTURAL_HANDLERS].sort());
  });

  it('every structural handler routes its DOM change through the guard', () => {
    const violations = parseHandlers(source())
      .filter(handler => EXPECTED_STRUCTURAL_HANDLERS.includes(handler.name))
      .filter(handler => !(handler.name in EXEMPTIONS))
      .filter(handler => !handler.body.includes(`${GUARD}(`))
      .map(handler => handler.name);

    expect(
      violations,
      `These structural handlers mutate the grid without ${GUARD}:\n`
      + violations.map(name => `  - ${name}`).join('\n')
      + `\nOn a merged table they will insert phantom <td>s and scramble the `
      + `cell coordinates. Wrap the DOM mutation in ${GUARD}(ctx, () => …).`
    ).toEqual([]);
  });

  it('no handler touches ctx.grid structurally outside the guard', () => {
    const violations = findUnguardedGridUses(source());

    expect(
      violations,
      `Unguarded structural use of ctx.grid:\n`
      + violations.map(use => `  - ${use}`).join('\n')
      + `\nOnly read-only members (${READ_ONLY_GRID_MEMBERS.join(', ')}) may be `
      + `used outside ${GUARD}.`
    ).toEqual([]);
  });

  it('the scanner actually catches a violation (mutation check)', () => {
    const violating = [
      'const handleInsertRow = (gridEl: HTMLElement, index: number, ctx: ActionContext): ActionResult => {',
      '  ctx.grid.addRow(gridEl, index);',
      '',
      '  return noOpResult(ctx);',
      '};',
    ].join('\n');

    expect(parseHandlers(violating)).toHaveLength(1);
    expect(parseHandlers(violating)[0].body).not.toContain(`${GUARD}(`);
    expect(findUnguardedGridUses(violating)).toEqual(['ctx.grid.addRow']);

    // ...and clears a compliant handler.
    const compliant = [
      'const handleInsertRow = (gridEl: HTMLElement, index: number, ctx: ActionContext): ActionResult => {',
      '  applyStructuralDom(ctx, () => ctx.grid.addRow(gridEl, index));',
      '',
      '  return noOpResult(ctx);',
      '};',
    ].join('\n');

    expect(findUnguardedGridUses(compliant)).toEqual([]);
    expect(parseHandlers(compliant)[0].body).toContain(`${GUARD}(`);
  });

  it('every exemption names a real handler and carries a reason', () => {
    const names = new Set(parseHandlers(source()).map(handler => handler.name));

    for (const [handler, reason] of Object.entries(EXEMPTIONS)) {
      expect(names.has(handler), `Stale exemption: ${handler} no longer exists`).toBe(true);
      expect(reason.length, `Exemption for ${handler} needs a non-trivial reason`).toBeGreaterThan(20);
    }
  });
});
