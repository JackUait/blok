import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, LegacyCellContent, TableData } from '../../../../src/tools/table/types';

/**
 * Seeded fuzz over the table model: random merge / split / add / delete / move /
 * style sequences, checking the merge structure after every step.
 */

const lcg = (seed: number): (() => number) => {
  const state = { s: seed >>> 0 };

  return () => {
    state.s = (Math.imul(state.s, 1664525) + 1013904223) >>> 0;

    return state.s / 2 ** 32;
  };
};

const asCell = (cell: LegacyCellContent): CellContent => {
  if (typeof cell === 'string') {
    throw new Error('snapshot returned a legacy string cell');
  }

  return cell;
};

interface Slot { r: number; c: number; cell: CellContent }

const slotsOf = (grid: CellContent[][]): Slot[] =>
  grid.flatMap((row, r) => row.map((cell, c) => ({ r, c, cell })));

const footprint = (r: number, c: number, rowspan: number, colspan: number): Array<[number, number]> =>
  Array.from({ length: rowspan * colspan }, (_, i): [number, number] => [r + Math.floor(i / colspan), c + (i % colspan)])
    .filter(([dr, dc]) => dr !== r || dc !== c);

/**
 * Map each covered slot to the origin whose span covers it; report overlaps.
 */
const buildCoverage = (grid: CellContent[][]): { owners: Map<string, string>; error: string | null } => {
  const owners = new Map<string, string>();
  const errors: string[] = [];

  slotsOf(grid).forEach(({ r, c, cell }) => {
    const colspan = cell.colspan ?? 1;
    const rowspan = cell.rowspan ?? 1;
    const isOrigin = colspan > 1 || rowspan > 1;

    if (isOrigin && cell.mergedInto !== undefined) {
      errors.push(`[${r},${c}] is both covered and an origin`);
    }
    if (!isOrigin) {
      return;
    }

    footprint(r, c, rowspan, colspan).forEach(([dr, dc]) => {
      const key = `${dr},${dc}`;

      if (owners.has(key)) {
        errors.push(`[${key}] is covered by two origins`);
      }
      owners.set(key, `${r},${c}`);
    });
  });

  return { owners, error: errors[0] ?? null };
};

const slotError = ({ r, c, cell }: Slot, owners: Map<string, string>): string | null => {
  const owner = owners.get(`${r},${c}`) ?? null;

  if (cell.mergedInto === undefined) {
    return owner === null ? null : `[${r},${c}] lies inside origin ${owner} but has no mergedInto`;
  }

  if (owner !== cell.mergedInto.join(',')) {
    return `[${r},${c}] mergedInto ${cell.mergedInto.join(',')} but covered by ${owner ?? 'nothing'}`;
  }

  if (cell.blocks.length > 0) {
    return `covered [${r},${c}] holds blocks ${cell.blocks.join(',')}`;
  }

  const styled = cell.color !== undefined || cell.textColor !== undefined || cell.placement !== undefined;

  return styled ? `covered [${r},${c}] keeps styling` : null;
};

/**
 * Structural checks validateInvariants does not make on its own.
 */
const checkMergeStructure = (data: TableData): string | null => {
  const grid = data.content.map(row => row.map(asCell));
  const { owners, error } = buildCoverage(grid);

  if (error !== null) {
    return error;
  }

  return slotsOf(grid).map(slot => slotError(slot, owners)).find(e => e !== null) ?? null;
};

interface FuzzState {
  model: TableModel;
  pick: (n: number) => number;
  alive: Set<string>;
  newId: () => string;
  log: string[];
  merges: { total: number };
}

const fillNewCells = ({ model, alive, newId }: FuzzState): void => {
  Array.from({ length: model.rows * model.cols }, (_, i) => [Math.floor(i / model.cols), i % model.cols])
    .filter(([r, c]) => !model.isSpannedCell(r, c) && model.getCellBlocks(r, c).length === 0)
    .forEach(([r, c]) => {
      const id = newId();

      model.setCellBlocks(r, c, [id]);
      alive.add(id);
    });
};

const OPS: Array<(s: FuzzState) => void> = [
  (s) => {
    const { model, pick, merges } = s;
    const [r1, r2, c1, c2] = [pick(model.rows), pick(model.rows), pick(model.cols), pick(model.cols)];
    const rect = { minRow: Math.min(r1, r2), maxRow: Math.max(r1, r2), minCol: Math.min(c1, c2), maxCol: Math.max(c1, c2) };

    if (!model.canMergeCells(rect)) {
      return;
    }
    merges.total += 1;
    s.log.push(`merge ${JSON.stringify(rect)}`);
    model.mergeCells(rect);
  },
  (s) => {
    const [r, c] = [s.pick(s.model.rows), s.pick(s.model.cols)];

    s.log.push(`split ${r},${c}`);
    s.model.splitCell(r, c);
    fillNewCells(s);
  },
  (s) => {
    const i = s.pick(s.model.rows + 1);

    s.log.push(`addRow ${i}`);
    s.model.addRow(i);
    fillNewCells(s);
  },
  (s) => {
    const i = s.pick(s.model.cols + 1);

    s.log.push(`addColumn ${i}`);
    s.model.addColumn(i, 80);
    fillNewCells(s);
  },
  (s) => {
    if (s.model.rows <= 1) {
      return;
    }
    const i = s.pick(s.model.rows);

    s.log.push(`deleteRow ${i}`);
    s.model.deleteRow(i).blocksToDelete.forEach(id => s.alive.delete(id));
    fillNewCells(s);
  },
  (s) => {
    if (s.model.cols <= 1) {
      return;
    }
    const i = s.pick(s.model.cols);

    s.log.push(`deleteColumn ${i}`);
    s.model.deleteColumn(i).blocksToDelete.forEach(id => s.alive.delete(id));
    fillNewCells(s);
  },
  (s) => {
    const [from, to] = [s.pick(s.model.rows), s.pick(s.model.rows)];

    s.log.push(`moveRow ${from}->${to}`);
    s.model.moveRow(from, to);
  },
  (s) => {
    const [from, to] = [s.pick(s.model.cols), s.pick(s.model.cols)];

    s.log.push(`moveColumn ${from}->${to}`);
    s.model.moveColumn(from, to);
  },
  (s) => {
    const [r, c] = [s.pick(s.model.rows), s.pick(s.model.cols)];

    s.log.push(`style ${r},${c}`);
    s.model.setCellColor(r, c, '#ff0000');
    s.model.setCellPlacement(r, c, 'middle-center');
  },
];

const stepError = (s: FuzzState): string | null => {
  s.model.validateInvariants();

  const snap = s.model.snapshot();
  const structure = checkMergeStructure(snap);

  if (structure !== null) {
    return structure;
  }

  const inGrid = new Set(snap.content.flatMap(row => row.map(asCell).flatMap(cell => cell.blocks)));
  const lost = [...s.alive].filter(id => !inGrid.has(id));

  if (lost.length > 0) {
    return `blocks lost without being reported for deletion: ${lost.join(',')}`;
  }

  if ((snap.colWidths?.length ?? s.model.cols) !== s.model.cols) {
    return `colWidths length ${snap.colWidths?.length ?? 0} vs ${s.model.cols} cols`;
  }

  const reloaded = new TableModel(snap).snapshot();

  return JSON.stringify(reloaded.content) === JSON.stringify(snap.content) ? null : 'save -> load changed the content';
};

const safeStepError = (s: FuzzState, op: (st: FuzzState) => void): string | null => {
  try {
    op(s);

    return stepError(s);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const runSequence = (seed: number, steps: number, merges: { total: number }): { log: string[]; error: string | null } => {
  const rand = lcg(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const size = { rows: 2 + pick(3), cols: 2 + pick(3) };
  const counter = { next: 0 };
  const newId = (): string => {
    counter.next += 1;

    return `b${counter.next}`;
  };
  const model = new TableModel({
    withHeadings: false,
    withHeadingColumn: false,
    colWidths: Array.from({ length: size.cols }, () => 100),
    content: Array.from({ length: size.rows }, () =>
      Array.from({ length: size.cols }, () => ({ blocks: [newId()] }))
    ),
  });
  const state: FuzzState = {
    model,
    pick,
    alive: new Set(Array.from({ length: counter.next }, (_, i) => `b${i + 1}`)),
    newId,
    log: [`init ${size.rows}x${size.cols}`],
    merges,
  };

  const error = Array.from({ length: steps }).reduce<string | null>(
    (found) => found ?? safeStepError(state, OPS[pick(OPS.length)]),
    null
  );

  return { log: state.log, error };
};

describe('merge audit: seeded model fuzz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the structure checker flags bad grids (control)', () => {
    const base = { withHeadings: false, withHeadingColumn: false };

    expect(checkMergeStructure({ ...base, content: [[{ blocks: [], colspan: 2 }, { blocks: ['x'], mergedInto: [0, 0] }]] }))
      .toContain('holds blocks');
    expect(checkMergeStructure({ ...base, content: [[{ blocks: [], colspan: 2 }, { blocks: [] }]] }))
      .toContain('no mergedInto');
    expect(checkMergeStructure({ ...base, content: [[{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0], color: '#f00' }]] }))
      .toContain('keeps styling');
    expect(checkMergeStructure({ ...base, content: [[{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }]] }))
      .toBeNull();
  });

  it('keeps the merge structure valid across 500 random op sequences', () => {
    const merges = { total: 0 };
    const failures = Array.from({ length: 500 }, (_, i) => i + 1)
      .map(seed => ({ seed, ...runSequence(seed, 30, merges) }))
      .filter(result => result.error !== null)
      .map(({ seed, error, log }) => `seed ${seed}: ${error ?? ''}\n  ${log.join('\n  ')}`);

    expect(failures.slice(0, 3).join('\n\n')).toBe('');
    // A green run proves nothing unless merges actually happened.
    expect(merges.total).toBeGreaterThan(500);
  });
});
