import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { SelectionRect } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Two people merging at the same time, read back through the real load path.
 *
 * `normalizeContent`'s merge repair is what every peer runs on every load, so
 * whatever it produces IS the table. `validateInvariants` is the tool's own
 * definition of a valid one — after the repair a converged document must never
 * violate it, or the renderer paints a grid that does not match the model.
 */

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/**
 * Fix a store's Yjs client id. Which peer's `mergedInto` survives on a shared
 * cell is decided by client id, and only one of the two outcomes is the
 * interesting one — without this the test would be a coin flip.
 */
const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

const grid = (rows: number, cols: number): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ blocks: [`r${r}c${c}`] }))),
});

const twoPeers = (data: TableData, clientA: number, clientB: number): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, clientA);
  pinClientId(b, clientB);

  a.fromJSON([{ id: 'T',
    type: 'table',
    data: data }]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

const tableData = (store: DocumentStore): TableData =>
  (store.toJSON().find((block) => block.id === 'T')?.data ?? {}) as unknown as TableData;

const modelOf = (store: DocumentStore): TableModel => new TableModel(tableData(store));

/** Apply a tool operation to a peer's model and save it the way `Table.save()` does. */
const edit = (store: DocumentStore, operation: (model: TableModel) => void): void => {
  const model = modelOf(store);

  operation(model);
  store.updateBlockData('T', 'content', model.snapshot().content);
};

const blockIds = (data: TableData): string[] =>
  (data.content ?? []).flatMap((row) =>
    row.flatMap((cell) => (typeof cell === 'string' ? [] : cell.blocks ?? []))).sort();

const cellAt = (data: TableData, r: number, c: number): Exclude<NonNullable<TableData['content']>[number][number], string> | undefined => {
  const cell = (data.content ?? [])[r]?.[c];

  return typeof cell === 'string' || cell === undefined ? undefined : cell;
};

/**
 * Cells the repair freed (covered before, plain after) that a live origin in
 * the repaired grid still spans. Each one renders a second <td> in a slot the
 * span already claims, which shifts the row for good.
 */
const freedInsideLiveSpan = (raw: TableData, repaired: TableData): [number, number][] => {
  const offenders: [number, number][] = [];

  (repaired.content ?? []).forEach((row, r) => row.forEach((_cell, c) => {
    const before = cellAt(raw, r, c);
    const after = cellAt(repaired, r, c);

    if (before?.mergedInto === undefined || after?.mergedInto !== undefined) {
      return;
    }

    const covered = (repaired.content ?? []).some((originRow, or) =>
      originRow.some((origin, oc) => {
        const spanning = cellAt(repaired, or, oc);

        if (spanning === undefined || (or === r && oc === c)) {
          return false;
        }

        return r >= or && r < or + (spanning.rowspan ?? 1) &&
          c >= oc && c < oc + (spanning.colspan ?? 1);
      }));

    if (covered) {
      offenders.push([r, c]);
    }
  }));

  return offenders;
};

/** Every rectangle in a rows x cols grid that covers more than one cell. */
const mergeableRects = (rows: number, cols: number): SelectionRect[] => {
  const rowRanges = Array.from({ length: rows }, (_, minRow) =>
    Array.from({ length: rows - minRow }, (_, span) => [minRow, minRow + span] as const)).flat();
  const colRanges = Array.from({ length: cols }, (_, minCol) =>
    Array.from({ length: cols - minCol }, (_, span) => [minCol, minCol + span] as const)).flat();

  return rowRanges.flatMap(([minRow, maxRow]) => colRanges
    .filter(([minCol, maxCol]) => minRow !== maxRow || minCol !== maxCol)
    .map(([minCol, maxCol]) => ({ minRow,
      maxRow,
      minCol,
      maxCol })));
};

const overlaps = (x: SelectionRect, y: SelectionRect): boolean =>
  x.minRow <= y.maxRow && y.minRow <= x.maxRow && x.minCol <= y.maxCol && y.minCol <= x.maxCol;

describe('two peers merging overlapping rectangles, read back', () => {
  it('leaves no freed cell sitting inside a live span', () => {
    const { a, b } = twoPeers(grid(3, 3), 1, 2);

    // The rectangles overlap in TWO dimensions: they share column 1 of rows 0-1.
    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1 }));
    edit(b, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 1,
      maxCol: 2 }));

    sync(a, b);

    const model = modelOf(a);

    // The defect: (1,1) converges pointing at (0,1), (0,1) is itself covered by
    // (0,0), and the repair FREED (1,1) — inside (0,0)'s live 2x2 span. Row 1
    // then renders its own <td> for a slot the rowspan already claims.
    expect(model.isSpannedCell(1, 1)).toBe(true);
    expect(() => model.validateInvariants()).not.toThrow();
    expect(modelOf(b).snapshot().content).toEqual(model.snapshot().content);
  });

  it('frees a covered cell that no live span claims', () => {
    const { a, b } = twoPeers(grid(3, 3), 1, 2);

    // A merges row 0 entirely; B merges only the first two cells of row 0.
    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 0,
      minCol: 1,
      maxCol: 2 }));
    edit(b, (model) => model.mergeCells({ minRow: 0,
      maxRow: 0,
      minCol: 0,
      maxCol: 1 }));

    sync(a, b);

    const model = modelOf(a);
    const covered = model.snapshot().content?.map((row) =>
      row.map((cell) => (typeof cell === 'string' ? false : cell.mergedInto !== undefined)));

    // Nothing spans (0,2) once (0,1) loses, so it must come back as a plain cell.
    expect(covered?.[0][2]).toBe(false);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('is stable: a second load of what it produced changes nothing', () => {
    const { a, b } = twoPeers(grid(3, 3), 1, 2);

    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1 }));
    edit(b, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 1,
      maxCol: 2 }));

    sync(a, b);

    const once = modelOf(a).snapshot();
    const twice = new TableModel(once).snapshot();

    expect(twice.content).toEqual(once.content);
  });

  /**
   * Fuzz over every overlapping merge pair a 3x3 grid allows, in both client-id
   * orders — which peer wins a shared cell decides whether the repair frees or
   * re-points, and only one of the two hits the 2-D case.
   *
   * The property is about what the repair OWNS: freeing a covered cell. Other
   * malformed-merge signatures (a cell outside the winning origin's span, a
   * slot no peer ever covered) are left alone on purpose so validateInvariants
   * still reports them, so they are not asserted away here.
   */
  it('never frees a covered cell into a slot a live span still claims', () => {
    const rects = mergeableRects(3, 3);
    const failures: string[] = [];

    for (const [clientA, clientB] of [[1, 2], [2, 1]] as const) {
      rects.forEach((rectA, i) => rects.slice(i).forEach((rectB) => {
        if (overlaps(rectA, rectB)) {
          const { a, b } = twoPeers(grid(3, 3), clientA, clientB);

          edit(a, (model) => model.mergeCells(rectA));
          edit(b, (model) => model.mergeCells(rectB));
          sync(a, b);

          const raw = tableData(a);
          const repaired = modelOf(a).snapshot();
          const where = `${clientA}/${clientB} ${JSON.stringify(rectA)} + ${JSON.stringify(rectB)}`;

          freedInsideLiveSpan(raw, repaired).forEach((coords) => {
            failures.push(`${where}: freed [${coords[0]},${coords[1]}] inside a live span`);
          });

          // The repair may relocate a block into the covering origin, but it
          // must never drop one.
          if (blockIds(repaired).length !== 9) {
            failures.push(`${where}: lost blocks`);
          }
        }
      }));
    }

    expect(failures).toEqual([]);
  // A full-suite run starves this loop's event loop; the default 5s is a
  // budget for the machine, not for the ~750 merge pairs it drives.
  }, 30000);
});
