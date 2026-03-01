import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

import { Table } from '../tools';

import { createEditorContainer, defaultTools, simulateClick, waitForToolbar } from './helpers';
import type { EditorFactoryOptions } from './helpers';

import type { OutputData, ToolSettings } from '@/types';

// ── Constants ────────────────────────────────────────────────────────

const TIMEOUT_INIT = { timeout: 5000 };
const TABLE_SELECTOR = '[data-blok-tool="table"]';
const GRIP_COL_SELECTOR = '[data-blok-table-grip-col]';
const GRIP_ROW_SELECTOR = '[data-blok-table-grip-row]';
const CELL_SELECTOR = '[data-blok-table-cell]';
const ROW_SELECTOR = '[data-blok-table-row]';
const RESIZE_HANDLE_SELECTOR = '[data-blok-table-resize]';
const ADD_ROW_SELECTOR = '[data-blok-table-add-row]';
const ADD_COL_SELECTOR = '[data-blok-table-add-col]';

// ── Types ────────────────────────────────────────────────────────────

interface TableArgs extends EditorFactoryOptions {
  minHeight: number;
  data: OutputData | undefined;
  readOnly: boolean;
}

// ── Tools configuration ──────────────────────────────────────────────

const tableTools = {
  ...defaultTools,
  table: {
    class: Table,
    inlineToolbar: true,
  } as ToolSettings,
};

// ── Editor factory ───────────────────────────────────────────────────

const createEditor = (args: TableArgs): HTMLElement =>
  createEditorContainer({
    ...args,
    tools: tableTools,
  });

// ── Meta ─────────────────────────────────────────────────────────────

const meta: Meta<TableArgs> = {
  title: 'Tools/Table',
  tags: ['autodocs'],
  args: {
    minHeight: 300,
    data: undefined,
    readOnly: false,
  },
  render: createEditor,
};

export default meta;

type Story = StoryObj<TableArgs>;

// ── Helpers ──────────────────────────────────────────────────────────

const waitForTable = async (canvas: HTMLElement): Promise<void> => {
  await waitFor(
    () => {
      expect(canvas.querySelector(TABLE_SELECTOR)).toBeInTheDocument();
    },
    TIMEOUT_INIT
  );
};

const forceGripsVisible = (grips: NodeListOf<Element>): void => {
  grips.forEach((grip) => {
    grip.setAttribute('data-blok-table-grip-visible', '');
    grip.classList.remove('opacity-0', 'pointer-events-none');
    grip.classList.add('opacity-100', 'pointer-events-auto');
  });
};

const forceGripActive = (grip: Element, expanded: { width: string; height: string }): void => {
  grip.setAttribute('data-blok-table-grip-visible', '');
  grip.classList.remove('opacity-0', 'pointer-events-none', 'bg-gray-300');
  grip.classList.add('opacity-100', 'pointer-events-auto', 'bg-blue-500', 'text-white');

  const el = grip as HTMLElement;

  el.style.width = expanded.width;
  el.style.height = expanded.height;

  const svg = grip.querySelector('svg');

  if (svg) {
    svg.classList.remove('opacity-0', 'text-gray-400');
    svg.classList.add('opacity-100', 'text-white');
  }
};

const markRowCellsSelected = (
  row: Element,
  colRange: [number, number],
  out: Element[]
): void => {
  const cells = row.querySelectorAll(CELL_SELECTOR);

  for (let c = colRange[0]; c <= colRange[1]; c++) {
    if (!cells[c]) {
      continue;
    }

    cells[c].setAttribute('data-blok-table-cell-selected', '');
    out.push(cells[c]);
  }
};

const forceSelectionOverlay = (
  canvasElement: HTMLElement,
  rowRange: [number, number],
  colRange: [number, number]
): HTMLDivElement | null => {
  const rows = canvasElement.querySelectorAll(ROW_SELECTOR);
  const selectedCells: Element[] = [];

  for (let r = rowRange[0]; r <= rowRange[1]; r++) {
    if (rows[r]) {
      markRowCellsSelected(rows[r], colRange, selectedCells);
    }
  }

  if (selectedCells.length === 0) {
    return null;
  }

  const grid = rows[0]?.parentElement;

  if (!grid) {
    return null;
  }

  const gridRect = grid.getBoundingClientRect();
  const firstRect = selectedCells[0].getBoundingClientRect();
  const lastRect = selectedCells[selectedCells.length - 1].getBoundingClientRect();

  const overlay = document.createElement('div');

  overlay.style.position = 'absolute';
  overlay.style.border = '2px solid #3b82f6';
  overlay.style.borderRadius = '1px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2';
  overlay.style.left = `${firstRect.left - gridRect.left}px`;
  overlay.style.top = `${firstRect.top - gridRect.top}px`;
  overlay.style.width = `${lastRect.right - firstRect.left}px`;
  overlay.style.height = `${lastRect.bottom - firstRect.top}px`;

  grid.style.position = grid.style.position || 'relative';
  grid.appendChild(overlay);

  return overlay;
};

const forceAddButtonsVisible = (canvas: HTMLElement): void => {
  [ADD_ROW_SELECTOR, ADD_COL_SELECTOR].forEach((sel) => {
    const btn = canvas.querySelector(sel);

    if (btn instanceof HTMLElement) {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }
  });
};

const highlightCells = (cells: Element[]): void => {
  cells.forEach((cell) => {
    const el = cell as HTMLElement;

    el.style.backgroundColor = '#f3f4f6';
    el.style.opacity = '0.7';
  });
};

const createDropIndicator = (
  orientation: 'row' | 'col',
  positionPx: number,
  lengthPx?: number
): HTMLDivElement => {
  const indicator = document.createElement('div');

  indicator.style.position = 'absolute';
  indicator.style.backgroundColor = '#3b82f6';
  indicator.style.borderRadius = '1.5px';
  indicator.style.zIndex = '5';
  indicator.style.pointerEvents = 'none';

  if (orientation === 'row') {
    indicator.style.height = '3px';
    indicator.style.left = '0';
    indicator.style.right = '0';
    indicator.style.top = `${positionPx - 1.5}px`;
  } else {
    indicator.style.width = '3px';
    indicator.style.top = '0';
    indicator.style.height = `${lengthPx ?? 0}px`;
    indicator.style.left = `${positionPx - 1.5}px`;
  }

  return indicator;
};

// ═══════════════════════════════════════════════════════════════════════
// LAYOUT & STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Basic 2×2 table with no headings.
 */
export const Default: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'default-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['Cell A1', 'Cell B1'],
              ['Cell A2', 'Cell B2'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * 3×3 table with varied content.
 */
export const ThreeByThree: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'three-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['Product', 'Price', 'Stock'],
              ['Widget', '$9.99', '142'],
              ['Gadget', '$24.50', '38'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Large 5×5 table with realistic data and heading row.
 */
export const LargeTable: Story = {
  args: {
    minHeight: 400,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'large-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Name', 'Role', 'Department', 'Location', 'Status'],
              ['Alice Chen', 'Engineer', 'Platform', 'San Francisco', 'Active'],
              ['Bob Smith', 'Designer', 'Product', 'New York', 'Active'],
              ['Carol Wu', 'Manager', 'Engineering', 'London', 'On Leave'],
              ['Dave Park', 'Analyst', 'Data Science', 'Berlin', 'Active'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Full-width stretched table.
 */
export const Stretched: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'stretched-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            stretched: true,
            content: [
              ['Feature', 'Status', 'Priority'],
              ['Authentication', 'Complete', 'High'],
              ['Dashboard', 'In Progress', 'Medium'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Table with first row styled as heading (bold, gray background).
 */
export const WithHeadingRow: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'heading-row-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Quarter', 'Revenue', 'Growth'],
              ['Q1 2025', '$1.2M', '+15%'],
              ['Q2 2025', '$1.5M', '+25%'],
              ['Q3 2025', '$1.8M', '+20%'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Table with first column styled as heading.
 */
export const WithHeadingColumn: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'heading-col-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: true,
            content: [
              ['Monday', '9am - 5pm', 'Available'],
              ['Tuesday', '10am - 6pm', 'Available'],
              ['Wednesday', '9am - 1pm', 'Half day'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Table with both heading row and heading column.
 */
export const WithBothHeadings: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'both-headings-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: true,
            content: [
              ['', 'Jan', 'Feb', 'Mar'],
              ['Sales', '120', '145', '163'],
              ['Costs', '80', '85', '90'],
              ['Profit', '40', '60', '73'],
            ],
          },
        },
      ],
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// CELL CONTENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cells containing bold, italic, and linked text.
 */
export const FormattedCellContent: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'formatted-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Format', 'Example'],
              ['<b>Bold text</b>', 'Important items are bold'],
              ['<i>Italic text</i>', 'Emphasis via italic'],
              ['<a href="https://example.com">Link</a>', 'Clickable reference'],
              ['<b><i>Bold italic</i></b>', 'Combined formatting'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Cells containing header and list blocks (nested block types).
 */
export const NestedBlocksInCells: Story = {
  args: {
    minHeight: 400,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'nested-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['nested-header'] },
                { blocks: ['nested-para'] },
              ],
              [
                { blocks: ['nested-list-1', 'nested-list-2', 'nested-list-3'] },
                { blocks: ['nested-multi-1', 'nested-multi-2'] },
              ],
            ],
          },
        },
        { id: 'nested-header', type: 'header', data: { text: 'Section Title', level: 3 } },
        { id: 'nested-para', type: 'paragraph', data: { text: 'A regular paragraph in a cell.' } },
        { id: 'nested-list-1', type: 'list', data: { text: 'First item', style: 'unordered' } },
        { id: 'nested-list-2', type: 'list', data: { text: 'Second item', style: 'unordered' } },
        { id: 'nested-list-3', type: 'list', data: { text: 'Third item', style: 'unordered' } },
        { id: 'nested-multi-1', type: 'paragraph', data: { text: 'First paragraph in cell.' } },
        { id: 'nested-multi-2', type: 'paragraph', data: { text: 'Second paragraph below.' } },
      ],
    },
  },
};

/**
 * Cells with background colors applied (green=done, yellow=progress, red=blocked).
 */
export const ColoredCells: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'colored-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Status', 'Task', 'Owner'],
              [
                { blocks: ['cc-done'], color: '#D1FAE5' },
                { blocks: ['cc-task-1'] },
                { blocks: ['cc-owner-1'] },
              ],
              [
                { blocks: ['cc-progress'], color: '#FEF3C7' },
                { blocks: ['cc-task-2'] },
                { blocks: ['cc-owner-2'] },
              ],
              [
                { blocks: ['cc-blocked'], color: '#FEE2E2' },
                { blocks: ['cc-task-3'] },
                { blocks: ['cc-owner-3'] },
              ],
            ],
          },
        },
        { id: 'cc-done', type: 'paragraph', data: { text: 'Done' } },
        { id: 'cc-task-1', type: 'paragraph', data: { text: 'Setup CI/CD pipeline' } },
        { id: 'cc-owner-1', type: 'paragraph', data: { text: 'Alice' } },
        { id: 'cc-progress', type: 'paragraph', data: { text: 'In Progress' } },
        { id: 'cc-task-2', type: 'paragraph', data: { text: 'Implement auth flow' } },
        { id: 'cc-owner-2', type: 'paragraph', data: { text: 'Bob' } },
        { id: 'cc-blocked', type: 'paragraph', data: { text: 'Blocked' } },
        { id: 'cc-task-3', type: 'paragraph', data: { text: 'Deploy to production' } },
        { id: 'cc-owner-3', type: 'paragraph', data: { text: 'Carol' } },
      ],
    },
  },
};

/**
 * Cells with text color and combined background + text color.
 */
export const TextColoredCells: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'textcolor-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['tc-1'], textColor: '#DC2626' },
                { blocks: ['tc-2'], textColor: '#2563EB' },
              ],
              [
                { blocks: ['tc-3'], textColor: '#059669' },
                { blocks: ['tc-4'], color: '#1E293B', textColor: '#F8FAFC' },
              ],
            ],
          },
        },
        { id: 'tc-1', type: 'paragraph', data: { text: 'Red text' } },
        { id: 'tc-2', type: 'paragraph', data: { text: 'Blue text' } },
        { id: 'tc-3', type: 'paragraph', data: { text: 'Green text' } },
        { id: 'tc-4', type: 'paragraph', data: { text: 'Light on dark' } },
      ],
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// GRIPS & CONTROLS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Column grips in visible (hover) state.
 */
export const ColumnGripsVisible: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'gripscol-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Name', 'Email', 'Role'],
              ['Alice', 'alice@co.com', 'Admin'],
              ['Bob', 'bob@co.com', 'User'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force column grips visible', async () => {
      const grips = canvasElement.querySelectorAll(GRIP_COL_SELECTOR);

      forceGripsVisible(grips);

      await waitFor(
        () => {
          const visible = canvasElement.querySelectorAll(`${GRIP_COL_SELECTOR}[data-blok-table-grip-visible]`);

          expect(visible.length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
    });
  },
};

/**
 * Row grips in visible (hover) state.
 */
export const RowGripsVisible: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'gripsrow-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['Row 1 Col 1', 'Row 1 Col 2'],
              ['Row 2 Col 1', 'Row 2 Col 2'],
              ['Row 3 Col 1', 'Row 3 Col 2'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force row grips visible', async () => {
      const grips = canvasElement.querySelectorAll(GRIP_ROW_SELECTOR);

      forceGripsVisible(grips);

      await waitFor(
        () => {
          const visible = canvasElement.querySelectorAll(`${GRIP_ROW_SELECTOR}[data-blok-table-grip-visible]`);

          expect(visible.length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
    });
  },
};

/**
 * Column grip in active (selected, blue) state with expanded dot pattern.
 */
export const ColumnGripActive: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'gripactive-col-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['A1', 'B1', 'C1'],
              ['A2', 'B2', 'C2'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force first column grip active', async () => {
      const grip = canvasElement.querySelector(GRIP_COL_SELECTOR);

      if (grip) {
        forceGripActive(grip, { width: '24px', height: '16px' });
      }

      await waitFor(
        () => {
          expect(canvasElement.querySelector(`${GRIP_COL_SELECTOR}.bg-blue-500`)).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );
    });
  },
};

/**
 * Row grip in active (selected, blue) state with expanded dot pattern.
 */
export const RowGripActive: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'gripactive-row-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['A1', 'B1'],
              ['A2', 'B2'],
              ['A3', 'B3'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force first row grip active', async () => {
      const grip = canvasElement.querySelector(GRIP_ROW_SELECTOR);

      if (grip) {
        forceGripActive(grip, { width: '16px', height: '20px' });
      }

      await waitFor(
        () => {
          expect(canvasElement.querySelector(`${GRIP_ROW_SELECTOR}.bg-blue-500`)).toBeInTheDocument();
        },
        TIMEOUT_INIT
      );
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Single cell in focused state with cursor inside.
 */
export const CellFocused: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'focus-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Header A', 'Header B'],
              ['Click me', 'Other cell'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table and toolbar', async () => {
      await waitForTable(canvasElement);
      await waitForToolbar(canvasElement);
    });

    await step('Click cell to focus', async () => {
      const rows = canvasElement.querySelectorAll(ROW_SELECTOR);
      const targetCell = rows[1]?.querySelector(CELL_SELECTOR);

      if (targetCell) {
        const editable = targetCell.querySelector('[contenteditable="true"]');

        if (editable) {
          simulateClick(editable);
        }
      }

      await waitFor(
        () => {
          const focused = document.activeElement;

          expect(focused?.closest(CELL_SELECTOR)).toBeTruthy();
        },
        TIMEOUT_INIT
      );
    });
  },
};

/**
 * Multi-cell rectangular selection with blue border overlay.
 */
export const MultiCellSelection: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'selection-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['A1', 'B1', 'C1'],
              ['A2', 'B2', 'C2'],
              ['A3', 'B3', 'C3'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force 2x2 cell selection with border overlay', async () => {
      forceSelectionOverlay(canvasElement, [0, 1], [0, 1]);

      const selected = canvasElement.querySelectorAll('[data-blok-table-cell-selected]');

      expect(selected.length).toBe(4);
    });
  },
};

/**
 * Selection pill in expanded state at the edge of a column selection.
 */
export const SelectionPillExpanded: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'pill-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['A1', 'B1', 'C1'],
              ['A2', 'B2', 'C2'],
              ['A3', 'B3', 'C3'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force column selection with pill', async () => {
      const overlay = forceSelectionOverlay(canvasElement, [0, 2], [0, 0]);

      if (overlay) {
        const pill = document.createElement('div');

        pill.style.position = 'absolute';
        pill.style.right = '-10px';
        pill.style.top = '50%';
        pill.style.transform = 'translateY(-50%)';
        pill.style.width = '16px';
        pill.style.height = '20px';
        pill.style.backgroundColor = '#3b82f6';
        pill.style.borderRadius = '2px';
        pill.style.cursor = 'pointer';
        pill.setAttribute('data-blok-table-selection-pill', '');

        overlay.appendChild(pill);
      }

      const selected = canvasElement.querySelectorAll('[data-blok-table-cell-selected]');

      expect(selected.length).toBe(3);
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// RESIZE & SCROLL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Table with explicit pixel-width columns.
 */
export const PixelWidthColumns: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'pixelwidth-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['ID', 'Description', 'Status'],
              ['1', 'A task with a longer description text', 'Done'],
              ['2', 'Short', 'Pending'],
            ],
            colWidths: [60, 350, 100],
          },
        },
      ],
    },
  },
};

/**
 * Horizontally scrollable table with haze indicators on edges.
 */
export const ScrollOverflow: Story = {
  args: {
    width: 500,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'scroll-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Col 1', 'Col 2', 'Col 3', 'Col 4', 'Col 5', 'Col 6'],
              ['Data A1', 'Data A2', 'Data A3', 'Data A4', 'Data A5', 'Data A6'],
              ['Data B1', 'Data B2', 'Data B3', 'Data B4', 'Data B5', 'Data B6'],
            ],
            colWidths: [150, 150, 150, 150, 150, 150],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force scroll haze visible', async () => {
      const hazes = canvasElement.querySelectorAll('[data-blok-table-haze]');

      hazes.forEach((haze) => {
        haze.setAttribute('data-blok-table-haze-visible', '');
        haze.classList.remove('opacity-0');
        haze.classList.add('opacity-100');
      });

      await waitFor(
        () => {
          const visible = canvasElement.querySelectorAll('[data-blok-table-haze-visible]');

          expect(visible.length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// READONLY
// ═══════════════════════════════════════════════════════════════════════

/**
 * Table in read-only mode — no grips, controls, or selection.
 */
export const ReadOnly: Story = {
  args: {
    readOnly: true,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'readonly-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Language', 'Year', 'Creator'],
              ['TypeScript', '2012', 'Microsoft'],
              ['Rust', '2010', 'Mozilla'],
              ['Go', '2009', 'Google'],
            ],
          },
        },
      ],
    },
  },
};

/**
 * Read-only table with colored cells preserved.
 */
export const ReadOnlyWithColors: Story = {
  args: {
    readOnly: true,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'readonly-colored-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Priority', 'Task'],
              [
                { blocks: ['rc-high'], color: '#FEE2E2', textColor: '#DC2626' },
                { blocks: ['rc-task-1'] },
              ],
              [
                { blocks: ['rc-medium'], color: '#FEF3C7', textColor: '#D97706' },
                { blocks: ['rc-task-2'] },
              ],
              [
                { blocks: ['rc-low'], color: '#D1FAE5', textColor: '#059669' },
                { blocks: ['rc-task-3'] },
              ],
            ],
          },
        },
        { id: 'rc-high', type: 'paragraph', data: { text: 'High' } },
        { id: 'rc-task-1', type: 'paragraph', data: { text: 'Fix critical security bug' } },
        { id: 'rc-medium', type: 'paragraph', data: { text: 'Medium' } },
        { id: 'rc-task-2', type: 'paragraph', data: { text: 'Update documentation' } },
        { id: 'rc-low', type: 'paragraph', data: { text: 'Low' } },
        { id: 'rc-task-3', type: 'paragraph', data: { text: 'Refactor logging module' } },
      ],
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// PRESET COLORS
// ═══════════════════════════════════════════════════════════════════════

/**
 * 2×5 table showcasing all 10 preset background colors.
 */
export const AllPresetBackgroundColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'preset-bg-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['pb-gray'], color: '#f1f1ef' },
                { blocks: ['pb-brown'], color: '#f4eeee' },
                { blocks: ['pb-orange'], color: '#fbecdd' },
                { blocks: ['pb-yellow'], color: '#fbf3db' },
                { blocks: ['pb-green'], color: '#edf3ec' },
              ],
              [
                { blocks: ['pb-teal'], color: '#e4f5f3' },
                { blocks: ['pb-blue'], color: '#e7f3f8' },
                { blocks: ['pb-purple'], color: '#f6f3f9' },
                { blocks: ['pb-pink'], color: '#f9f0f5' },
                { blocks: ['pb-red'], color: '#fdebec' },
              ],
            ],
          },
        },
        { id: 'pb-gray', type: 'paragraph', data: { text: 'Gray' } },
        { id: 'pb-brown', type: 'paragraph', data: { text: 'Brown' } },
        { id: 'pb-orange', type: 'paragraph', data: { text: 'Orange' } },
        { id: 'pb-yellow', type: 'paragraph', data: { text: 'Yellow' } },
        { id: 'pb-green', type: 'paragraph', data: { text: 'Green' } },
        { id: 'pb-teal', type: 'paragraph', data: { text: 'Teal' } },
        { id: 'pb-blue', type: 'paragraph', data: { text: 'Blue' } },
        { id: 'pb-purple', type: 'paragraph', data: { text: 'Purple' } },
        { id: 'pb-pink', type: 'paragraph', data: { text: 'Pink' } },
        { id: 'pb-red', type: 'paragraph', data: { text: 'Red' } },
      ],
    },
  },
};

/**
 * 2×5 table showcasing all 10 preset text colors.
 */
export const AllPresetTextColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'preset-text-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['pt-gray'], textColor: '#787774' },
                { blocks: ['pt-brown'], textColor: '#9f6b53' },
                { blocks: ['pt-orange'], textColor: '#d9730d' },
                { blocks: ['pt-yellow'], textColor: '#cb9b00' },
                { blocks: ['pt-green'], textColor: '#448361' },
              ],
              [
                { blocks: ['pt-teal'], textColor: '#2b9a8f' },
                { blocks: ['pt-blue'], textColor: '#337ea9' },
                { blocks: ['pt-purple'], textColor: '#9065b0' },
                { blocks: ['pt-pink'], textColor: '#c14c8a' },
                { blocks: ['pt-red'], textColor: '#d44c47' },
              ],
            ],
          },
        },
        { id: 'pt-gray', type: 'paragraph', data: { text: 'Gray' } },
        { id: 'pt-brown', type: 'paragraph', data: { text: 'Brown' } },
        { id: 'pt-orange', type: 'paragraph', data: { text: 'Orange' } },
        { id: 'pt-yellow', type: 'paragraph', data: { text: 'Yellow' } },
        { id: 'pt-green', type: 'paragraph', data: { text: 'Green' } },
        { id: 'pt-teal', type: 'paragraph', data: { text: 'Teal' } },
        { id: 'pt-blue', type: 'paragraph', data: { text: 'Blue' } },
        { id: 'pt-purple', type: 'paragraph', data: { text: 'Purple' } },
        { id: 'pt-pink', type: 'paragraph', data: { text: 'Pink' } },
        { id: 'pt-red', type: 'paragraph', data: { text: 'Red' } },
      ],
    },
  },
};

/**
 * 2×5 table with both preset background and text colors combined.
 */
export const PresetDualColors: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'preset-dual-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['pd-gray'], color: '#f1f1ef', textColor: '#787774' },
                { blocks: ['pd-brown'], color: '#f4eeee', textColor: '#9f6b53' },
                { blocks: ['pd-orange'], color: '#fbecdd', textColor: '#d9730d' },
                { blocks: ['pd-yellow'], color: '#fbf3db', textColor: '#cb9b00' },
                { blocks: ['pd-green'], color: '#edf3ec', textColor: '#448361' },
              ],
              [
                { blocks: ['pd-teal'], color: '#e4f5f3', textColor: '#2b9a8f' },
                { blocks: ['pd-blue'], color: '#e7f3f8', textColor: '#337ea9' },
                { blocks: ['pd-purple'], color: '#f6f3f9', textColor: '#9065b0' },
                { blocks: ['pd-pink'], color: '#f9f0f5', textColor: '#c14c8a' },
                { blocks: ['pd-red'], color: '#fdebec', textColor: '#d44c47' },
              ],
            ],
          },
        },
        { id: 'pd-gray', type: 'paragraph', data: { text: 'Gray' } },
        { id: 'pd-brown', type: 'paragraph', data: { text: 'Brown' } },
        { id: 'pd-orange', type: 'paragraph', data: { text: 'Orange' } },
        { id: 'pd-yellow', type: 'paragraph', data: { text: 'Yellow' } },
        { id: 'pd-green', type: 'paragraph', data: { text: 'Green' } },
        { id: 'pd-teal', type: 'paragraph', data: { text: 'Teal' } },
        { id: 'pd-blue', type: 'paragraph', data: { text: 'Blue' } },
        { id: 'pd-purple', type: 'paragraph', data: { text: 'Purple' } },
        { id: 'pd-pink', type: 'paragraph', data: { text: 'Pink' } },
        { id: 'pd-red', type: 'paragraph', data: { text: 'Red' } },
      ],
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// INLINE MARKERS IN CELLS
// ═══════════════════════════════════════════════════════════════════════

/**
 * 2×5 table: each cell has a preset background color AND an inline text-color
 * mark on the word. Tests CSS cascade — mark text color overrides cell text.
 */
export const CellBgWithInlineMarker: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'cellmark-bg-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['cm-bg-gray'], color: '#f1f1ef' },
                { blocks: ['cm-bg-brown'], color: '#f4eeee' },
                { blocks: ['cm-bg-orange'], color: '#fbecdd' },
                { blocks: ['cm-bg-yellow'], color: '#fbf3db' },
                { blocks: ['cm-bg-green'], color: '#edf3ec' },
              ],
              [
                { blocks: ['cm-bg-teal'], color: '#e4f5f3' },
                { blocks: ['cm-bg-blue'], color: '#e7f3f8' },
                { blocks: ['cm-bg-purple'], color: '#f6f3f9' },
                { blocks: ['cm-bg-pink'], color: '#f9f0f5' },
                { blocks: ['cm-bg-red'], color: '#fdebec' },
              ],
            ],
          },
        },
        { id: 'cm-bg-gray', type: 'paragraph', data: { text: '<mark style="color: #787774; background-color: transparent">Gray</mark>' } },
        { id: 'cm-bg-brown', type: 'paragraph', data: { text: '<mark style="color: #9f6b53; background-color: transparent">Brown</mark>' } },
        { id: 'cm-bg-orange', type: 'paragraph', data: { text: '<mark style="color: #d9730d; background-color: transparent">Orange</mark>' } },
        { id: 'cm-bg-yellow', type: 'paragraph', data: { text: '<mark style="color: #cb9b00; background-color: transparent">Yellow</mark>' } },
        { id: 'cm-bg-green', type: 'paragraph', data: { text: '<mark style="color: #448361; background-color: transparent">Green</mark>' } },
        { id: 'cm-bg-teal', type: 'paragraph', data: { text: '<mark style="color: #2b9a8f; background-color: transparent">Teal</mark>' } },
        { id: 'cm-bg-blue', type: 'paragraph', data: { text: '<mark style="color: #337ea9; background-color: transparent">Blue</mark>' } },
        { id: 'cm-bg-purple', type: 'paragraph', data: { text: '<mark style="color: #9065b0; background-color: transparent">Purple</mark>' } },
        { id: 'cm-bg-pink', type: 'paragraph', data: { text: '<mark style="color: #c14c8a; background-color: transparent">Pink</mark>' } },
        { id: 'cm-bg-red', type: 'paragraph', data: { text: '<mark style="color: #d44c47; background-color: transparent">Red</mark>' } },
      ],
    },
  },
};

/**
 * 2×5 table: each cell has a preset text color AND an inline background-color
 * mark. Tests CSS cascade — mark background overlays cell, text inherits cell color.
 */
export const CellTextColorWithInlineMarker: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'cellmark-text-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['cm-tc-gray'], textColor: '#787774' },
                { blocks: ['cm-tc-brown'], textColor: '#9f6b53' },
                { blocks: ['cm-tc-orange'], textColor: '#d9730d' },
                { blocks: ['cm-tc-yellow'], textColor: '#cb9b00' },
                { blocks: ['cm-tc-green'], textColor: '#448361' },
              ],
              [
                { blocks: ['cm-tc-teal'], textColor: '#2b9a8f' },
                { blocks: ['cm-tc-blue'], textColor: '#337ea9' },
                { blocks: ['cm-tc-purple'], textColor: '#9065b0' },
                { blocks: ['cm-tc-pink'], textColor: '#c14c8a' },
                { blocks: ['cm-tc-red'], textColor: '#d44c47' },
              ],
            ],
          },
        },
        { id: 'cm-tc-gray', type: 'paragraph', data: { text: '<mark style="background-color: #f1f1ef">Gray</mark>' } },
        { id: 'cm-tc-brown', type: 'paragraph', data: { text: '<mark style="background-color: #f4eeee">Brown</mark>' } },
        { id: 'cm-tc-orange', type: 'paragraph', data: { text: '<mark style="background-color: #fbecdd">Orange</mark>' } },
        { id: 'cm-tc-yellow', type: 'paragraph', data: { text: '<mark style="background-color: #fbf3db">Yellow</mark>' } },
        { id: 'cm-tc-green', type: 'paragraph', data: { text: '<mark style="background-color: #edf3ec">Green</mark>' } },
        { id: 'cm-tc-teal', type: 'paragraph', data: { text: '<mark style="background-color: #e4f5f3">Teal</mark>' } },
        { id: 'cm-tc-blue', type: 'paragraph', data: { text: '<mark style="background-color: #e7f3f8">Blue</mark>' } },
        { id: 'cm-tc-purple', type: 'paragraph', data: { text: '<mark style="background-color: #f6f3f9">Purple</mark>' } },
        { id: 'cm-tc-pink', type: 'paragraph', data: { text: '<mark style="background-color: #f9f0f5">Pink</mark>' } },
        { id: 'cm-tc-red', type: 'paragraph', data: { text: '<mark style="background-color: #fdebec">Red</mark>' } },
      ],
    },
  },
};

/**
 * 2×5 table: each cell has preset dual colors (bg + text) AND an inline
 * dual mark (different text + bg). Tests full override — mark colors take
 * precedence over cell colors on marked text.
 */
export const CellDualWithInlineMarker: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'cellmark-dual-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              [
                { blocks: ['cm-d-gray'], color: '#f1f1ef', textColor: '#787774' },
                { blocks: ['cm-d-brown'], color: '#f4eeee', textColor: '#9f6b53' },
                { blocks: ['cm-d-orange'], color: '#fbecdd', textColor: '#d9730d' },
                { blocks: ['cm-d-yellow'], color: '#fbf3db', textColor: '#cb9b00' },
                { blocks: ['cm-d-green'], color: '#edf3ec', textColor: '#448361' },
              ],
              [
                { blocks: ['cm-d-teal'], color: '#e4f5f3', textColor: '#2b9a8f' },
                { blocks: ['cm-d-blue'], color: '#e7f3f8', textColor: '#337ea9' },
                { blocks: ['cm-d-purple'], color: '#f6f3f9', textColor: '#9065b0' },
                { blocks: ['cm-d-pink'], color: '#f9f0f5', textColor: '#c14c8a' },
                { blocks: ['cm-d-red'], color: '#fdebec', textColor: '#d44c47' },
              ],
            ],
          },
        },
        { id: 'cm-d-gray', type: 'paragraph', data: { text: 'Plain and <mark style="color: #d44c47; background-color: #fdebec">red mark</mark>' } },
        { id: 'cm-d-brown', type: 'paragraph', data: { text: 'Plain and <mark style="color: #337ea9; background-color: #e7f3f8">blue mark</mark>' } },
        { id: 'cm-d-orange', type: 'paragraph', data: { text: 'Plain and <mark style="color: #448361; background-color: #edf3ec">green mark</mark>' } },
        { id: 'cm-d-yellow', type: 'paragraph', data: { text: 'Plain and <mark style="color: #9065b0; background-color: #f6f3f9">purple mark</mark>' } },
        { id: 'cm-d-green', type: 'paragraph', data: { text: 'Plain and <mark style="color: #c14c8a; background-color: #f9f0f5">pink mark</mark>' } },
        { id: 'cm-d-teal', type: 'paragraph', data: { text: 'Plain and <mark style="color: #d9730d; background-color: #fbecdd">orange mark</mark>' } },
        { id: 'cm-d-blue', type: 'paragraph', data: { text: 'Plain and <mark style="color: #cb9b00; background-color: #fbf3db">yellow mark</mark>' } },
        { id: 'cm-d-purple', type: 'paragraph', data: { text: 'Plain and <mark style="color: #2b9a8f; background-color: #e4f5f3">teal mark</mark>' } },
        { id: 'cm-d-pink', type: 'paragraph', data: { text: 'Plain and <mark style="color: #787774; background-color: #f1f1ef">gray mark</mark>' } },
        { id: 'cm-d-red', type: 'paragraph', data: { text: 'Plain and <mark style="color: #9f6b53; background-color: #f4eeee">brown mark</mark>' } },
      ],
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Default empty table — renders 3×3 grid with no content.
 */
export const EmptyTable: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'empty-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [],
          },
        },
      ],
    },
  },
};

/**
 * Single-row table (1×3) — edge case for minimum row count.
 */
export const SingleRowTable: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'singlerow-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [['Column A', 'Column B', 'Column C']],
          },
        },
      ],
    },
  },
};

/**
 * Single-column table with heading row — edge case for minimum column count.
 */
export const SingleColumnTable: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'singlecol-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [['Title'], ['First'], ['Second'], ['Third']],
          },
        },
      ],
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// ADD & RESIZE CONTROLS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Add-row and add-column buttons in visible state.
 */
export const AddButtonsVisible: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'addbtns-table',
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['A1', 'B1'],
              ['A2', 'B2'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force add buttons visible', async () => {
      forceAddButtonsVisible(canvasElement);

      await waitFor(
        () => {
          const rowBtn = canvasElement.querySelector(ADD_ROW_SELECTOR);

          expect(rowBtn).toBeInTheDocument();
          expect(rowBtn instanceof HTMLElement && rowBtn.style.opacity === '1').toBe(true);
        },
        TIMEOUT_INIT
      );
    });
  },
};

/**
 * Column resize handles in visible (hover) state.
 */
export const ResizeHandlesVisible: Story = {
  args: {
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'resize-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Name', 'Description', 'Status'],
              ['Item 1', 'A longer description here', 'Active'],
              ['Item 2', 'Short', 'Pending'],
            ],
            colWidths: [100, 300, 100],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force resize handles visible', async () => {
      const handles = canvasElement.querySelectorAll(RESIZE_HANDLE_SELECTOR);

      handles.forEach((handle) => {
        const el = handle as HTMLElement;

        el.style.opacity = '1';
      });

      await waitFor(
        () => {
          expect(canvasElement.querySelectorAll(RESIZE_HANDLE_SELECTOR).length).toBeGreaterThan(0);
        },
        TIMEOUT_INIT
      );
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════
// DRAG STATES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Row drag in progress — source row highlighted with blue drop indicator.
 */
export const RowDragInProgress: Story = {
  args: {
    minHeight: 350,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'rowdrag-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Name', 'Role', 'Status'],
              ['Alice', 'Engineer', 'Active'],
              ['Bob', 'Designer', 'Active'],
              ['Carol', 'Manager', 'On Leave'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force row drag state', async () => {
      const rows = canvasElement.querySelectorAll(ROW_SELECTOR);
      const sourceRow = rows[1];
      const grid = rows[0]?.parentElement;
      const dropTarget = rows[3] as HTMLElement | undefined;

      if (sourceRow) {
        highlightCells(Array.from(sourceRow.querySelectorAll(CELL_SELECTOR)));
      }

      if (grid && dropTarget) {
        grid.style.position = grid.style.position || 'relative';
        grid.appendChild(createDropIndicator('row', dropTarget.offsetTop));
      }

      expect(rows.length).toBeGreaterThanOrEqual(4);
    });
  },
};

/**
 * Column drag in progress — source column highlighted with blue drop indicator.
 */
export const ColumnDragInProgress: Story = {
  args: {
    minHeight: 350,
    data: {
      time: Date.now(),
      version: '1.0.0',
      blocks: [
        {
          id: 'coldrag-table',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              ['Name', 'Role', 'Department', 'Status'],
              ['Alice', 'Engineer', 'Platform', 'Active'],
              ['Bob', 'Designer', 'Product', 'Active'],
            ],
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, step }) => {
    await step('Wait for table', async () => {
      await waitForTable(canvasElement);
    });

    await step('Force column drag state', async () => {
      const rows = canvasElement.querySelectorAll(ROW_SELECTOR);
      const columnCells: Element[] = [];

      rows.forEach((row) => {
        const cell = row.querySelectorAll(CELL_SELECTOR)[0];

        if (cell) {
          columnCells.push(cell);
        }
      });

      highlightCells(columnCells);

      const grid = rows[0]?.parentElement;
      const targetCell = rows[0]?.querySelectorAll(CELL_SELECTOR)[2] as HTMLElement | undefined;

      if (grid && targetCell) {
        grid.style.position = grid.style.position || 'relative';
        grid.appendChild(createDropIndicator('col', targetCell.offsetLeft, grid.offsetHeight));
      }

      expect(rows.length).toBeGreaterThan(0);
    });
  },
};
