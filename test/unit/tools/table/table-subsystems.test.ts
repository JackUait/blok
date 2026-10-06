import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { TableSubsystems } from '../../../../src/tools/table/table-subsystems';
import type { TableHost } from '../../../../src/tools/table/table-subsystems';
import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';
import type { API, BlockAPI } from '../../../../types';
import { CELL_ATTR } from '../../../../src/tools/table/table-core';
import { recordPasteHandling } from '../../../../src/components/utils/paste-continuation';
import { logLabeled } from '../../../../src/components/utils/logger';
import type * as Logger from '../../../../src/components/utils/logger';

vi.mock('../../../../src/components/utils/logger', async (importOriginal) => ({
  ...await importOriginal<typeof Logger>(),
  logLabeled: vi.fn(),
}));

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
    getBlockIndex: () => undefined,
    setBlockParent: vi.fn(),
    beginTransaction: vi.fn(),
    endTransaction: vi.fn(),
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
    fitToPageWidth: vi.fn(),
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

      subsystems.initScrollHazeOnly(document.createElement('table'));

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

  describe('corner drag undo grouping', () => {
    it('opens a transaction on drag start and closes it on drag end', () => {
      HTMLElement.prototype.setPointerCapture = vi.fn();
      HTMLElement.prototype.releasePointerCapture = vi.fn();

      const { subsystems, gridEl, host } = createSubsystems();

      subsystems.initAll(gridEl);

      const hitZone = host.element?.querySelector('[data-blok-table-corner-drag]');

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('corner drag hit zone not rendered');
      }

      hitZone.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      }));
      // Past DRAG_THRESHOLD, so the gesture counts as a drag rather than a tap.
      hitZone.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 0,
        clientY: 40,
        pointerId: 1,
      }));

      expect(host.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);
      expect(host.api.blocks.endTransaction).not.toHaveBeenCalled();

      hitZone.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 0,
        clientY: 40,
        pointerId: 1,
      }));

      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * A drag's transaction holds the undo capture open. When the table goes
   * away mid-drag (a peer removes it, a re-render, the editor is destroyed),
   * no pointerup ever comes, so the owner must close it.
   */
  describe('a drag that never ends', () => {
    const startCornerDrag = (host: TableHost): void => {
      const hitZone = host.element?.querySelector('[data-blok-table-corner-drag]');

      if (!(hitZone instanceof HTMLElement)) {
        throw new Error('corner drag hit zone not rendered');
      }

      hitZone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1 }));
      hitZone.dispatchEvent(new PointerEvent('pointermove', { bubbles: true,
        clientX: 0,
        clientY: 40,
        pointerId: 1 }));
    };

    const startAddRowDrag = (host: TableHost): void => {
      const button = host.element?.querySelector('[data-blok-table-add-row]');

      if (!(button instanceof HTMLElement)) {
        throw new Error('add-row button not rendered');
      }

      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1 }));
      // Past the drag threshold, short of one row (30px fallback).
      button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true,
        clientX: 0,
        clientY: 10,
        pointerId: 1 }));
    };

    beforeEach(() => {
      HTMLElement.prototype.setPointerCapture = vi.fn();
      HTMLElement.prototype.releasePointerCapture = vi.fn();
    });

    it('closes the corner drag transaction on teardown', () => {
      const { subsystems, gridEl, host } = createSubsystems();

      subsystems.initAll(gridEl);
      startCornerDrag(host);
      expect(host.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);

      subsystems.teardown();

      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });

    it('closes the corner drag transaction when the controls are rebuilt', () => {
      const { subsystems, gridEl, host } = createSubsystems();

      subsystems.initAll(gridEl);
      startCornerDrag(host);

      subsystems.initAll(gridEl);

      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });

    it('closes the add-row drag transaction on teardown', () => {
      const { subsystems, gridEl, host } = createSubsystems();

      subsystems.initAll(gridEl);
      startAddRowDrag(host);
      expect(host.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);

      subsystems.teardown();

      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });

    it('closes a transaction once, not again on a later teardown', () => {
      const { subsystems, gridEl, host } = createSubsystems();

      subsystems.initAll(gridEl);
      startCornerDrag(host);
      subsystems.teardown();
      subsystems.teardown();

      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });
  });
  /**
   * A paste into a cell whose clipboard also holds text outside the table:
   * the cells land, and the rest is pasted after the table through a second,
   * synthetic paste event (the editor's paste module, stood in for here).
   */
  describe('paste with content around the table', () => {
    const CLIPBOARD = '<p>Intro</p><table><tr><td>X</td></tr></table>';

    interface PasteRig {
      host: TableHost;
      placeholder: BlockAPI;
      deleteBlock: ReturnType<typeof vi.fn>;
      getBlockIndex: ReturnType<typeof vi.fn>;
      paste: () => void;
    }

    /** `handling` is what the stand-in paste module records for the synthetic paste. */
    const rig = (handling: () => Promise<void>): PasteRig => {
      const { subsystems, gridEl, host } = createSubsystems();
      const holder = document.createElement('div');
      const placeholder = { id: 'placeholder', holder, isEmpty: true } as unknown as BlockAPI;
      const deleteBlock = vi.fn(() => Promise.resolve());
      const getBlockIndex = vi.fn(() => 1);

      document.body.appendChild(holder);
      Object.assign(host.api.blocks, {
        insertAt: vi.fn(() => placeholder),
        getById: vi.fn((id: string) => (id === placeholder.id ? placeholder : null)),
        getBlockIndex,
        delete: deleteBlock,
      });

      const onPaste = (event: Event): void => {
        if (event.target instanceof Node && holder.contains(event.target)) {
          recordPasteHandling(event, handling());
        }
      };

      document.addEventListener('paste', onPaste);
      onTestFinished(() => document.removeEventListener('paste', onPaste));

      subsystems.initAll(gridEl);

      const cell = gridEl.querySelector<HTMLElement>(`[${CELL_ATTR}]`);
      const focusable = document.createElement('div');

      if (cell === null) {
        throw new Error('no cell');
      }
      focusable.tabIndex = 0;
      cell.appendChild(focusable);

      const paste = (): void => {
        focusable.focus();

        const event = new Event('paste', { bubbles: true, cancelable: true });

        Object.defineProperty(event, 'clipboardData', {
          value: { types: ['text/html'], getData: (type: string): string => (type === 'text/html' ? CLIPBOARD : '') },
        });
        focusable.dispatchEvent(event);
      };

      return { host, placeholder, deleteBlock, getBlockIndex, paste };
    };

    const flush = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('removes the empty placeholder, ends the undo step once and logs once when the paste fails', async () => {
      const { host, deleteBlock, paste } = rig(() => Promise.reject(new Error('chunk failed to load')));

      paste();
      await flush();

      expect(deleteBlock).toHaveBeenCalledWith(1);
      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
      expect(logLabeled).toHaveBeenCalledTimes(1);
    });

    it('ends the undo step after a bounded wait while the paste hangs, then still removes the empty placeholder', async () => {
      const pending = { resolve: (): void => undefined };
      const { host, deleteBlock, paste } = rig(() => new Promise<void>((resolve) => {
        pending.resolve = resolve;
      }));

      paste();
      await flush();

      expect(host.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);
      expect(host.api.blocks.endTransaction).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
      expect(deleteBlock).not.toHaveBeenCalled();

      pending.resolve();
      await flush();

      expect(deleteBlock).toHaveBeenCalledWith(1);
      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });

    it('deletes the empty placeholder inside the undo step on a normal paste', async () => {
      const { host, deleteBlock, paste } = rig(() => Promise.resolve());
      const order: string[] = [];

      deleteBlock.mockImplementation(() => {
        order.push('delete');

        return Promise.resolve();
      });
      const { endTransaction } = host.api.blocks;

      if (endTransaction === undefined) {
        throw new Error('mock API has no endTransaction');
      }
      vi.mocked(endTransaction).mockImplementation(() => {
        order.push('end');
      });

      paste();
      await flush();

      expect(order).toEqual(['delete', 'end']);
    });

    it('leaves the blocks alone but still ends the undo step when the editor is destroyed mid-paste', async () => {
      const pending = { resolve: (): void => undefined };
      const { host, placeholder, deleteBlock, getBlockIndex, paste } = rig(() => new Promise<void>((resolve) => {
        pending.resolve = resolve;
      }));

      paste();
      await flush();
      // Editor teardown empties its holder, detaching every block.
      placeholder.holder.remove();
      pending.resolve();
      await flush();

      expect(getBlockIndex).not.toHaveBeenCalled();
      expect(deleteBlock).not.toHaveBeenCalled();
      expect(host.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
