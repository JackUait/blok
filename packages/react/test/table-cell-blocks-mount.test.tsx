/**
 * A table whose cells hold child blocks must survive the React mount.
 *
 * `useBlok` creates the holder div itself and hands it to the editor before
 * `BlokContent` has attached it (see the "Create detached holder" step in
 * `../src/useBlok.ts`), so the whole subtree renders while it is OUT of the
 * document. That is not incidental — it is how the adapter avoids React and the
 * editor both owning the same DOM — and core has to tolerate it.
 *
 * It did not. A table stamps the nested-blocks attribute on EVERY cell's slot,
 * and core resolves a parent's child slot with a querySelector (first match), so
 * for a table that is always cell (0,0). The anti-stealing veto in
 * `BlockHierarchy.setBlockParent` is what keeps each cell's block in its own
 * cell, and it only counted a container as claiming the holder while that
 * container was `isConnected`. Detached, the veto went silent: `Table.rendered()`
 * placed each cell's block correctly and the no-op `setBlockParent` that follows
 * the mount dragged it straight into cell (0,0). Users saw one cell holding every
 * value and the rest empty, on every reload.
 *
 * Asserting through the adapter rather than core keeps the detached-mount
 * contract itself covered: a core-only test passes even if the adapter changes
 * when it attaches.
 *
 * These tests boot the REAL core (this package's vitest config aliases the core
 * to the repo's `src/`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { useBlok, BlokContent } from '../src';
import type { UseBlokConfig } from '../src';
import type { Blok } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table/index';

const TOOLS: UseBlokConfig['tools'] = {
  paragraph: { class: Paragraph },
  table: { class: Table },
};

const TABLE_ID = 'brief-table';

const ROWS: Array<[string, string]> = [
  ['What', 'The best pizza'],
  ['Where', 'Drinkit'],
  ['When', '19.09.2026'],
];

const cellIds = ROWS.map((_, row) => [`c${row}-0`, `c${row}-1`]);

const DATA: UseBlokConfig['data'] = {
  blocks: [
    {
      id: TABLE_ID,
      type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: true,
        content: cellIds.map((row) => row.map((id) => ({ blocks: [id] }))),
      },
    },
    ...ROWS.flatMap((row, rowIndex) =>
      row.map((text, colIndex) => ({
        id: cellIds[rowIndex][colIndex],
        type: 'paragraph',
        data: { text },
        parent: TABLE_ID,
      }))
    ),
  ],
};

let editors: Blok[] = [];

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  useEffect(() => {
    if (editor !== null && !editors.includes(editor)) {
      editors.push(editor);
    }
  }, [editor]);

  return <BlokContent editor={editor} data-testid="container" />;
}

const waitForEditor = async (): Promise<Blok> => {
  await waitFor(() => {
    expect(editors.length).toBeGreaterThan(0);
  }, { timeout: 5000 });

  return editors[0];
};

/** Cell text addressed as `"<row>,<col>"`. */
const readGrid = (root: HTMLElement): Record<string, string> =>
  Object.fromEntries(
    Array.from(root.querySelectorAll<HTMLElement>('[data-blok-table-cell]')).map((cell) => [
      `${cell.getAttribute('data-blok-table-cell-row')},${cell.getAttribute('data-blok-table-cell-col')}`,
      (cell.textContent ?? '').trim(),
    ])
  );

describe('table cells mounted through the React adapter (real core)', () => {
  beforeEach(() => {
    editors = [];
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Let useBlok's deferred destroy (setTimeout 0) run after RTL's unmount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.restoreAllMocks();
  });

  it('keeps every cell block in its own cell', async () => {
    const { getByTestId } = render(<Harness config={{ tools: TOOLS, data: DATA }} />);

    await waitForEditor();

    const container = getByTestId('container');

    await waitFor(() => {
      expect(container.querySelectorAll('[data-blok-table-cell]')).toHaveLength(ROWS.length * 2);
    }, { timeout: 5000 });

    expect(readGrid(container)).toStrictEqual({
      '0,0': 'What',
      '0,1': 'The best pizza',
      '1,0': 'Where',
      '1,1': 'Drinkit',
      '2,0': 'When',
      '2,1': '19.09.2026',
    });
  });

  it('leaves the first cell holding exactly its own block', async () => {
    // The collapse always emptied the other cells INTO cell (0,0), so its child
    // count is the single most direct statement of the defect.
    const { getByTestId } = render(<Harness config={{ tools: TOOLS, data: DATA }} />);

    await waitForEditor();

    const container = getByTestId('container');

    await waitFor(() => {
      expect(container.querySelectorAll('[data-blok-table-cell]')).toHaveLength(ROWS.length * 2);
    }, { timeout: 5000 });

    const firstCellSlot = container.querySelector<HTMLElement>(
      '[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-table-cell-blocks]'
    );

    expect(firstCellSlot?.querySelectorAll('[data-blok-id]')).toHaveLength(1);
  });
});
