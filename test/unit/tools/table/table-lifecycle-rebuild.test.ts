import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions, HTMLPasteEvent } from '../../../../types';

/**
 * Tests for unified lifecycle rebuild paths.
 *
 * The Table tool has three paths that rebuild subsystems on a grid element:
 *   rendered() — initial mount
 *   setData()  — undo/redo or Yjs-driven replacement
 *   onPaste()  — table HTML pasted over the block
 *
 * All three must follow the same sequence:
 *   1. Teardown existing subsystems (resize, addControls, rowColControls, cellSelection)
 *   2. Rebuild DOM (setData/onPaste only: render() + replaceChild)
 *   3. Initialize cells + update model
 *   4. Initialize subsystems on the new grid
 *
 * These tests verify that the lifecycle produces consistent, working results
 * regardless of which path triggered the rebuild.
 */

const createMockAPI = (overrides: Partial<Record<string, unknown>> = {}): API => {
  const { blocks: blocksOverrides, events: eventsOverrides, ...restOverrides } = overrides;

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
    i18n: {
      t: (key: string) => key,
    },
    blocks: {
      delete: vi.fn(),
      insert: vi.fn().mockImplementation(() => {
        const holder = document.createElement('div');
        const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

        holder.setAttribute('data-blok-id', id);

        return { id, holder };
      }),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlocksCount: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockReturnValue(undefined),
      setBlockParent: vi.fn(),
      ...(blocksOverrides as Record<string, unknown>),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
      ...(eventsOverrides as Record<string, unknown>),
    },
    ...restOverrides,
  } as unknown as API;
};

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {},
  apiOverrides: Partial<Record<string, unknown>> = {},
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(apiOverrides),
  readOnly: false,
  block: { id: 'table-lifecycle-test' } as never,
});

/**
 * Create an HTMLPasteEvent containing a simple HTML table.
 */
const createPasteEvent = (rows: string[][]): HTMLPasteEvent => {
  const tableHtml = `<table>${rows.map(
    row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
  ).join('')}</table>`;

  const parser = new DOMParser();
  const doc = parser.parseFromString(tableHtml, 'text/html');
  const tableEl = doc.querySelector('table') as HTMLTableElement;

  return {
    detail: { data: tableEl },
  } as unknown as HTMLPasteEvent;
};

/**
 * Count subsystem-related DOM elements inside the wrapper.
 * Returns counts for elements created by initAddControls / initRowColControls.
 */
const countSubsystemElements = (wrapper: HTMLElement): {
  addButtons: number;
  gripElements: number;
  cellBlockContainers: number;
} => ({
  addButtons: wrapper.querySelectorAll('[data-blok-table-add-row], [data-blok-table-add-col]').length,
  gripElements: wrapper.querySelectorAll('[data-blok-table-grip]').length,
  cellBlockContainers: wrapper.querySelectorAll('[data-blok-table-cell-blocks]').length,
});

describe('Table lifecycle rebuild', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  describe('subsystem initialization consistency', () => {
    it('rendered() initializes cell block containers for every cell', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const { cellBlockContainers } = countSubsystemElements(element);

      // 2×2 = 4 cells, each should have a cell-blocks container
      expect(cellBlockContainers).toBe(4);
    });

    it('setData() reinitializes cell block containers for new content', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // setData with 3×3 content
      table.setData({ content: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']] });

      const newWrapper = container.firstElementChild as HTMLElement;
      const { cellBlockContainers } = countSubsystemElements(newWrapper);

      // 3×3 = 9 cells
      expect(cellBlockContainers).toBe(9);
    });

    it('onPaste() reinitializes cell block containers for pasted content', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const pasteEvent = createPasteEvent([['X', 'Y', 'Z'], ['P', 'Q', 'R']]);

      table.onPaste(pasteEvent);

      const newWrapper = container.firstElementChild as HTMLElement;
      const { cellBlockContainers } = countSubsystemElements(newWrapper);

      // 2×3 = 6 cells
      expect(cellBlockContainers).toBe(6);
    });
  });

  describe('sequential lifecycle transitions', () => {
    it('render → rendered → setData → destroy completes without errors', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setData({ content: [['X']], withHeadings: true });

      expect(() => table.destroy()).not.toThrow();
    });

    it('render → rendered → onPaste → destroy completes without errors', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const pasteEvent = createPasteEvent([['X', 'Y'], ['P', 'Q']]);

      table.onPaste(pasteEvent);

      expect(() => table.destroy()).not.toThrow();
    });

    it('render → rendered → setData → onPaste → destroy completes without errors', () => {
      const options = createTableOptions({ content: [['A']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setData({ content: [['B', 'C'], ['D', 'E']] });

      const pasteEvent = createPasteEvent([['X']]);

      table.onPaste(pasteEvent);

      expect(() => table.destroy()).not.toThrow();
    });

    it('multiple setData calls in sequence produce correct final state', () => {
      const options = createTableOptions({ content: [['A']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setData({ content: [['B', 'C']] });
      table.setData({ content: [['D', 'E', 'F'], ['G', 'H', 'I']] });

      const finalWrapper = container.firstElementChild as HTMLElement;
      const rows = finalWrapper.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(2);

      const saved = table.save(finalWrapper);

      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(3);
    });

    it('onPaste after setData produces correct final state', () => {
      const options = createTableOptions({ content: [['A']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.setData({ content: [['B', 'C']] });

      const pasteEvent = createPasteEvent([['X', 'Y', 'Z']]);

      table.onPaste(pasteEvent);

      const finalWrapper = container.firstElementChild as HTMLElement;
      const rows = finalWrapper.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(1);

      const cells = finalWrapper.querySelectorAll('[data-blok-table-cell]');

      expect(cells).toHaveLength(3);
    });
  });

  describe('subsystem teardown during rebuild', () => {
    it('setData() tears down subsystems before DOM rebuild', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // After setData, the old element should be removed from container
      table.setData({ content: [['X']] });

      // Old element should no longer be in the container
      expect(container.contains(element)).toBe(false);

      // New element should be in the container
      const newWrapper = container.firstElementChild as HTMLElement;

      expect(newWrapper).not.toBe(element);
      expect(newWrapper).toBeTruthy();
    });

    it('onPaste() tears down subsystems before DOM rebuild', () => {
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      const pasteEvent = createPasteEvent([['X']]);

      table.onPaste(pasteEvent);

      // Old element should be replaced
      expect(container.contains(element)).toBe(false);

      const newWrapper = container.firstElementChild as HTMLElement;

      expect(newWrapper).not.toBe(element);
      expect(newWrapper).toBeTruthy();
    });

    it('destroy() cleans up all references', () => {
      const eventsOff = vi.fn();
      const options = createTableOptions(
        { content: [['A', 'B'], ['C', 'D']] },
        {},
        { events: { on: vi.fn(), off: eventsOff } },
      );
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      table.destroy();

      // After destroy, save should report empty content (model snapshot still works
      // but the element reference is cleared)
      const saved = table.save(document.createElement('div'));

      // Model snapshot should still be valid
      expect(saved.content).toBeDefined();

      // api.events.off should have been called to unsubscribe from block events
      expect(eventsOff).toHaveBeenCalled();
    });
  });

  describe('onPaste subsystem teardown consistency with setData', () => {
    it('onPaste uses teardownSubsystems to clean up before rebuild', () => {
      /**
       * This test verifies that onPaste() properly tears down subsystems
       * before rebuilding, matching the setData() pattern.
       *
       * Previously, onPaste() skipped explicit subsystem teardown, relying
       * on the init methods' self-cleanup. After the lifecycle consolidation,
       * both paths use the same teardownSubsystems() method.
       */
      const options = createTableOptions({ content: [['A', 'B'], ['C', 'D']] });
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Trigger onPaste — this should teardown + rebuild cleanly
      const pasteEvent = createPasteEvent([['X', 'Y']]);

      table.onPaste(pasteEvent);

      // Then destroy — should not double-destroy anything
      expect(() => table.destroy()).not.toThrow();

      // After full lifecycle, calling destroy again should also be safe
      expect(() => table.destroy()).not.toThrow();
    });
  });

  describe('rendered() undo grouping', () => {
    it('wraps cell population in a Yjs transaction via api.blocks.transact', () => {
      const transactFn = vi.fn((fn: () => void) => fn());

      const options = createTableOptions(
        {},
        {},
        { blocks: { transact: transactFn } }
      );
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // rendered() should use runTransactedStructuralOp, which calls api.blocks.transact
      expect(transactFn).toHaveBeenCalledTimes(1);
    });

    it('still initializes cells correctly when transact is available', () => {
      const transactFn = vi.fn((fn: () => void) => fn());

      const options = createTableOptions(
        { content: [['A', 'B'], ['C', 'D']] },
        {},
        { blocks: { transact: transactFn } }
      );
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // Cells should have blocks mounted despite the transaction wrapper
      const { cellBlockContainers } = countSubsystemElements(element);

      expect(cellBlockContainers).toBe(4);

      // Each cell should have a paragraph block
      const blockElements = element.querySelectorAll('[data-blok-id]');

      expect(blockElements.length).toBe(4);
    });
  });

  describe('setData() with empty content during Yjs sync', () => {
    it('populates empty cells when content reverts to empty during undo', () => {
      const options = createTableOptions(
        { content: [['A', 'B'], ['C', 'D']] },
        {},
        { blocks: { isSyncingFromYjs: true } }
      );
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // setData with empty content (simulating undo reverting table to initial state)
      table.setData({ content: [] });

      const newWrapper = container.firstElementChild as HTMLElement;

      // Grid should have default dimensions (3x3) since content is empty
      const rows = newWrapper.querySelectorAll('[data-blok-table-row]');

      expect(rows.length).toBeGreaterThan(0);

      // Each cell should still have a block (populated via populateNewCells)
      const blockElements = newWrapper.querySelectorAll('[data-blok-id]');

      expect(blockElements.length).toBeGreaterThan(0);
      expect(blockElements.length).toBe(rows.length * rows[0].querySelectorAll('[data-blok-table-cell]').length);
    });

    it('does not populate cells when content has actual data', () => {
      const options = createTableOptions(
        { content: [['A', 'B'], ['C', 'D']] },
        {},
        { blocks: { isSyncingFromYjs: true } }
      );
      const table = new Table(options);
      const element = table.render();

      container.appendChild(element);
      table.rendered();

      // setData with real content - should work normally without extra population
      table.setData({ content: [['X', 'Y']] });

      const newWrapper = container.firstElementChild as HTMLElement;
      const { cellBlockContainers } = countSubsystemElements(newWrapper);

      // 1 row × 2 cols = 2 cells
      expect(cellBlockContainers).toBe(2);
    });
  });
});
