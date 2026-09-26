import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const popoverState: { shown: number; destroyed: number; titles: string[] } = { shown: 0, destroyed: 0, titles: [] };

vi.mock('../../../../src/components/utils/popover', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    PopoverDesktop: class MockPopoverDesktop {
      private el = document.createElement('div');
      constructor(args: { items?: Array<{ title?: string }> }) {
        popoverState.titles = (args.items ?? []).map(item => item.title ?? '');
      }
      show(): void {
        popoverState.shown += 1;
        this.el.setAttribute('data-blok-popover-opened', 'true');
        document.body.appendChild(this.el);
      }
      destroy(): void {
        popoverState.destroyed += 1;
        this.el.remove();
      }
      on(_event: string, _handler: () => void): void {
        // no-op
      }
      off(_event: string, _handler: () => void): void {
        // no-op
      }
      hide(): void {
        // no-op
      }
      getElement(): HTMLElement {
        return this.el;
      }
    },
  };
});

import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const PILL_ATTR = 'data-blok-table-selection-pill';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';

const createMockAPI = (): API => ({
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
  i18n: { t: (key: string) => key, has: () => false },
  blocks: {
    insert: vi.fn().mockImplementation(() => {
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-id', id);

      return { id, holder };
    }),
    delete: vi.fn(),
    getChildren: vi.fn().mockReturnValue([]),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlockIndex: vi.fn().mockReturnValue(undefined),
    getBlocksCount: vi.fn().mockReturnValue(0),
    setBlockParent: vi.fn(),
    setPointerDragActive: vi.fn(),
    transactWithoutCapture: vi.fn((fn: () => void) => fn()),
  },
  events: { on: vi.fn(), off: vi.fn() },
  toolbar: { close: vi.fn() },
  rectangleSelection: { cancelActiveSelection: vi.fn() },
} as unknown as API);

/** 2x3 table whose (0,0) is a colspan-2 merge. */
const MERGED_CONTENT: TableData['content'] = [
  [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
  [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
];

const createTable = (readOnly: boolean): { table: Table; element: HTMLDivElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content: MERGED_CONTENT },
    config: {},
    api: createMockAPI(),
    readOnly,
    block: { id: 'table-1' } as never,
  };
  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  return { table, element };
};

const cellAt = (root: HTMLElement, row: number, col: number): HTMLElement => {
  const cell = root.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

  if (cell === null) {
    throw new Error(`no cell at ${row},${col}`);
  }

  return cell;
};

const clickCell = (cell: HTMLElement): void => {
  cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
};

const cellSelectionOf = (table: Table): unknown =>
  (table as unknown as { subsystems: { cellSelectionSubsystem: unknown } }).subsystems.cellSelectionSubsystem;

describe('merge audit — read-only never offers Merge/Split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popoverState.shown = 0;
    popoverState.destroyed = 0;
    popoverState.titles = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('control: in edit mode a click on the merged cell paints a pill whose menu offers Split', () => {
    const { element } = createTable(false);

    clickCell(cellAt(element, 0, 0));

    const pill = element.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

    expect(pill).not.toBeNull();
    pill?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(popoverState.titles).toContain('tools.table.splitCell');
    expect(popoverState.titles).not.toContain('tools.table.mergeCells');
  });

  it('a table rendered read-only has no cell selection, so no pill and no Merge/Split', () => {
    const { table, element } = createTable(true);

    expect(cellSelectionOf(table)).toBeNull();

    clickCell(cellAt(element, 0, 0));
    cellAt(element, 0, 2).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(element.querySelector(`[${PILL_ATTR}]`)).toBeNull();
    expect(popoverState.shown).toBe(0);
  });

  it('setReadOnly(true) closes an open pill menu and stops offering one', () => {
    const { table, element } = createTable(false);

    clickCell(cellAt(element, 0, 0));
    element.querySelector<HTMLElement>(`[${PILL_ATTR}]`)
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(popoverState.shown).toBe(1);

    table.setReadOnly(true);

    expect(popoverState.destroyed).toBeGreaterThanOrEqual(1);
    expect(cellSelectionOf(table)).toBeNull();
    expect(element.querySelector(`[${PILL_ATTR}]`)).toBeNull();

    clickCell(cellAt(element, 0, 0));

    expect(element.querySelector(`[${PILL_ATTR}]`)).toBeNull();
    expect(popoverState.shown).toBe(1);
  });
});
