import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { TableScrollHaze } from '../../../../src/tools/table/table-scroll-haze';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

// ─── Helpers ───────────────────────────────────────────────────────

const createMockAPI = (): API => {
  return {
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: { t: (key: string) => key },
    blocks: {
      insert: vi.fn().mockImplementation(() => {
        const holder = document.createElement('div');

        return { id: 'mock-block', holder };
      }),
      delete: vi.fn(),
      getChildren: vi.fn().mockReturnValue([]),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockReturnValue(undefined),
      getBlocksCount: vi.fn().mockReturnValue(0),
      setBlockParent: vi.fn(),
    },
    events: { on: vi.fn(), off: vi.fn() },
    toolbar: { close: vi.fn() },
  } as unknown as API;
};

/**
 * Create a pixel-mode Table (colWidths set) mounted to the document so the
 * scroll container + scroll haze are live, then return the table and grid.
 */
const createPixelTable = (
  content: string[][],
  colWidths: number[],
): { table: Table; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content, colWidths },
    config: {},
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  const scrollContainer = element.firstElementChild as HTMLElement;
  const gridEl = scrollContainer.firstElementChild as HTMLElement;

  return { table, gridEl };
};

const invokeAction = (table: Table, gridEl: HTMLElement, action: RowColAction): void => {
  const subsystems = (table as unknown as { subsystems: unknown }).subsystems;

  (subsystems as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
    .handleRowColAction(gridEl, action);
};

// ─── Tests ─────────────────────────────────────────────────────────

describe('Table scroll-haze refresh on structural grow (L2)', () => {
  let updateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateSpy = vi.spyOn(TableScrollHaze.prototype, 'update');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('refreshes the scroll haze when a column is inserted via the grip menu', () => {
    const { table, gridEl } = createPixelTable([['A', 'B'], ['C', 'D']], [100, 100]);

    // Ignore any update() calls fired during initial render/setup.
    updateSpy.mockClear();

    invokeAction(table, gridEl, { type: 'insert-col-right', index: 1 });

    // Growing the table past its scroll container must recompute the haze so the
    // right-edge scroll affordance is correct — otherwise it stays stale until an
    // unrelated scroll/resize event repaints it.
    expect(updateSpy).toHaveBeenCalled();
  });
});
