import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableSubsystems } from '../../../../src/tools/table/table-subsystems';
import type { TableHost } from '../../../../src/tools/table/table-subsystems';
import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';
import type { API } from '../../../../types';

// ─── Helpers ───────────────────────────────────────────────────────

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }],
  ],
  ...overrides,
});

const createMockAPI = (): API => ({
  i18n: { t: (key: string) => key },
  rectangleSelection: {
    isRectActivated: () => false,
    clearSelection: vi.fn(),
    startSelection: vi.fn(),
    endSelection: vi.fn(),
  },
  toolbar: {
    close: vi.fn(),
  },
  blocks: {
    setPointerDragActive: vi.fn(),
    insert: vi.fn(),
    getBlocksCount: () => 0,
    setBlockParent: vi.fn(),
  },
  caret: {
    setToBlock: vi.fn(),
  },
} as unknown as API);

/**
 * Build a TableSubsystems with a minimal hand-rolled TableHost backed by a real
 * model + grid DOM, so the manager's lifecycle can be exercised in isolation
 * from the Table block tool.
 */
const createSubsystems = (): {
  subsystems: TableSubsystems;
  gridEl: HTMLElement;
  host: TableHost;
} => {
  const model = new TableModel(makeData());
  const grid = new TableGrid({ readOnly: false });
  const gridEl = grid.createGrid(2, 2, undefined);

  const element = document.createElement('div');
  const scrollContainer = document.createElement('div');
  const gripOverlay = document.createElement('div');

  element.appendChild(scrollContainer);
  scrollContainer.appendChild(gridEl);
  element.appendChild(gripOverlay);
  document.body.appendChild(element);

  const host: TableHost = {
    api: createMockAPI(),
    readOnly: false,
    blockId: 'table-1',
    model,
    grid,
    cellBlocks: null,
    element,
    gridElement: gridEl,
    scrollContainer,
    gripOverlay,
    setDataGeneration: 0,
    runStructuralOp: <T>(fn: () => T): T => fn(),
    runTransactedStructuralOp: <T>(fn: () => T): T => fn(),
    ensureScrollContainer: (): HTMLDivElement => scrollContainer,
    rebuildTableBody: vi.fn(),
  };

  return { subsystems: new TableSubsystems(host), gridEl, host };
};

// ─── Tests ─────────────────────────────────────────────────────────

describe('TableSubsystems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('exposes no interactive subsystems before initAll', () => {
      const { subsystems } = createSubsystems();

      expect(subsystems.cellSelectionSubsystem).toBeNull();
      expect(subsystems.rowColControlsSubsystem).toBeNull();
    });

    it('creates the interactive subsystems on initAll', () => {
      const { subsystems, gridEl } = createSubsystems();

      subsystems.initAll(gridEl);

      expect(subsystems.cellSelectionSubsystem).not.toBeNull();
      expect(subsystems.rowColControlsSubsystem).not.toBeNull();
    });

    it('disposes all subsystems on teardown', () => {
      const { subsystems, gridEl } = createSubsystems();

      subsystems.initAll(gridEl);
      subsystems.teardown();

      expect(subsystems.cellSelectionSubsystem).toBeNull();
      expect(subsystems.rowColControlsSubsystem).toBeNull();
    });

    it('teardown is idempotent when no subsystems exist', () => {
      const { subsystems } = createSubsystems();

      expect(() => {
        subsystems.teardown();
        subsystems.teardown();
      }).not.toThrow();
    });

    it('initScrollHazeOnly does not create the interactive subsystems', () => {
      const { subsystems } = createSubsystems();

      subsystems.initScrollHazeOnly();

      expect(subsystems.cellSelectionSubsystem).toBeNull();
      expect(subsystems.rowColControlsSubsystem).toBeNull();
    });
  });

  describe('attachScrollContainer', () => {
    it('is a safe no-op before add-controls are initialized', () => {
      const { subsystems } = createSubsystems();
      const sc = document.createElement('div');

      expect(() => subsystems.attachScrollContainer(sc)).not.toThrow();
    });
  });
});
