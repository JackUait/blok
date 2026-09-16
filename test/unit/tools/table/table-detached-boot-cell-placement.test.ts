import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputBlockData, OutputData } from '../../../../types';

const TABLE_ID = 'table-1';

/**
 * A key/value table in the shape every consumer stores it in: cells reference
 * their content by id, and the referenced paragraphs are flat siblings carrying
 * `parent` = the table id.
 * @param rows - [label, value] pairs, one per table row
 */
const buildDocument = (rows: Array<[string, string]>): OutputData => {
  const cellIds = rows.map((_, rowIndex) => [`c${rowIndex}-0`, `c${rowIndex}-1`]);

  const table: OutputBlockData = {
    id: TABLE_ID,
    type: 'table',
    data: {
      withHeadings: false,
      withHeadingColumn: true,
      content: cellIds.map(row => row.map(id => ({ blocks: [id] }))),
    },
  };

  const cells: OutputBlockData[] = rows.flatMap((row, rowIndex) =>
    row.map((text, colIndex) => ({
      id: cellIds[rowIndex][colIndex],
      type: 'paragraph',
      data: { text },
      parent: TABLE_ID,
    }))
  );

  return { blocks: [table, ...cells] };
};

/**
 * Text content of every cell, addressed as `"<row>,<col>"`.
 * @param root - any element containing the rendered grid
 */
const readGrid = (root: HTMLElement): Record<string, string> => {
  const cells = root.querySelectorAll<HTMLElement>('[data-blok-table-cell]');

  return Object.fromEntries(
    Array.from(cells).map(cell => [
      `${cell.getAttribute('data-blok-table-cell-row')},${cell.getAttribute('data-blok-table-cell-col')}`,
      (cell.textContent ?? '').trim(),
    ])
  );
};

/**
 * A table's cells each carry the nested-blocks attribute, so a table holder has
 * one child slot PER CELL. Core resolves a parent's child slot with a
 * querySelector — the FIRST match — which for a table is always cell (0,0). The
 * anti-stealing veto in BlockHierarchy.setBlockParent is what keeps every cell's
 * block in its own cell, and it used to require the claiming container to be
 * `isConnected`.
 *
 * Nothing in the editor's own boot violates that, which is why this went
 * unnoticed: it needs the HOLDER to be detached. Every framework adapter does
 * exactly that — blok-react's useBlok creates the holder div itself and attaches
 * it after the editor has rendered — so in React/Vue/Angular hosts the whole
 * subtree is out of the document while Table.rendered() mounts its cells. Each
 * cell block was placed correctly and then immediately yanked into cell (0,0) by
 * the no-op setBlockParent that follows the mount, leaving one cell holding
 * every value and the rest empty.
 *
 * This test boots on a detached holder on purpose. Attaching the holder before
 * boot instead makes it pass against the unfixed code.
 */
describe('table cells survive a boot on a detached holder (adapter mount shape)', () => {
  let holder: HTMLElement;
  let blok: Blok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    blok = null;
  });

  // Teardown runs even when an assertion throws — which is the state these tests
  // exist to detect — so a booted editor never leaks into the rest of the worker.
  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('keeps each cell block in its own cell', async () => {
    blok = new Blok({
      holder,
      tools: { table: Table, paragraph: Paragraph },
      data: buildDocument([
        ['What', 'The best pizza'],
        ['Where', 'Drinkit'],
        ['When', '19.09.2026'],
      ]),
    });

    await blok.isReady;

    // The defect's precondition: nothing was in the document while it rendered.
    expect(holder.isConnected).toBe(false);

    document.body.appendChild(holder);

    expect(readGrid(holder)).toStrictEqual({
      '0,0': 'What',
      '0,1': 'The best pizza',
      '1,0': 'Where',
      '1,1': 'Drinkit',
      '2,0': 'When',
      '2,1': '19.09.2026',
    });

    // The symptom, stated as the thing that must not happen.
    const firstCellSlot = holder.querySelector<HTMLElement>(
      '[data-blok-table-cell][data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-table-cell-blocks]'
    );

    expect(firstCellSlot?.querySelectorAll('[data-blok-id]')).toHaveLength(1);
  });
});
