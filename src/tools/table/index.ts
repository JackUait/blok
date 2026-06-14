import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  HTMLPasteEvent,
  PasteConfig,
  ToolboxConfig,
} from '../../../types';
import type { ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import { DATA_ATTR } from '../../components/constants';
import { IconTable } from '../../components/icons';
import { mapToNearestPresetColor } from '../../components/utils/color-mapping';
import { twMerge } from '../../components/utils/tw';

import { TableCellBlocks, CELL_BLOCKS_ATTR } from './table-cell-blocks';
import {
  isDefaultBlack,
  ALLOWED_MARK_STYLE_PROPS,
} from './table-cell-clipboard';
import { TableGrid, ROW_ATTR, CELL_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from './table-core';
import {
  applyCellColors,
  applyCellPlacements,
  applyPixelWidths,
  computeInitialColWidth,
  getBlockIdsInColumn,
  getBlockIdsInRow,
  mountCellBlocksReadOnly,
  normalizeTableData,
  populateNewCells,
  readPixelWidths,
  SCROLL_OVERFLOW_CLASSES,
  setupKeyboardNavigation,
  updateHeadingColumnStyles,
  updateHeadingStyles,
} from './table-operations';
import { TableModel } from './table-model';
import { registerAdditionalRestrictedTools } from './table-restrictions';
import { TableSubsystems } from './table-subsystems';
import type { TableHost } from './table-subsystems';
import type { LegacyCellContent, TableData, TableConfig } from './types';
import { isCellWithBlocks } from './types';

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

const WRAPPER_CLASSES = [
  'my-2',
  'pr-5',
];

const WRAPPER_EDIT_CLASSES = [
  'relative',
  'mb-7',
  'after:content-[""]',
  'after:absolute',
  'after:-bottom-10',
  'after:left-0',
  'after:right-0',
  'after:h-10',
  'after:pointer-events-none',
];

/**
 * Table block tool for the Blok Editor.
 * Renders a 2D grid of contentEditable cells.
 */
export class Table implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private config: TableConfig;
  private initialContent: LegacyCellContent[][] | null = null;
  private grid: TableGrid;
  private model: TableModel;
  private subsystems: TableSubsystems;
  private cellBlocks: TableCellBlocks | null = null;
  private element: HTMLDivElement | null = null;
  private gridElement: HTMLElement | null = null;
  private scrollContainer: HTMLDivElement | null = null;
  private gripOverlay: HTMLDivElement | null = null;
  private blockId: string | undefined;
  private isNewTable = false;
  private unregisterRestrictedTools: (() => void) | null = null;
  private keyboardNavCleanup: (() => void) | null = null;

  /**
   * Generation counter for setData calls.
   * Incremented at the start of each setData; checked before expensive operations
   * (DOM rebuild, initializeCells) to bail out if a newer call has started.
   * Prevents orphaned blocks when rapid undo/redo triggers overlapping setData calls.
   */
  private setDataGeneration = 0;

  /**
   * Depth counter for structural operations (add/delete/move row/col).
   * When > 0, TableCellBlocks defers handleBlockMutation events to prevent
   * event cascade corruption during multi-step structural changes.
   */
  private structuralOpDepth = 0;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<TableData, TableConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config ?? {};
    const normalized = normalizeTableData(data, this.config);

    this.initialContent = normalized.content;
    this.grid = new TableGrid({ readOnly });
    this.model = new TableModel(normalized);
    this.blockId = block?.id;
    this.subsystems = new TableSubsystems(this.createSubsystemHost());

    if (this.config.restrictedTools !== undefined) {
      this.unregisterRestrictedTools = registerAdditionalRestrictedTools(this.config.restrictedTools);
    }
  }

  /**
   * Build the {@link TableHost} adapter handed to {@link TableSubsystems}.
   * Uses live getters so the manager always reads current DOM refs / state
   * without reaching into Table's private fields directly.
   */
  private createSubsystemHost(): TableHost {
    const self = this;

    return {
      get api() { return self.api; },
      get readOnly() { return self.readOnly; },
      get blockId() { return self.blockId; },
      get model() { return self.model; },
      get grid() { return self.grid; },
      get cellBlocks() { return self.cellBlocks; },
      get element() { return self.element; },
      get gridElement() { return self.gridElement; },
      get scrollContainer() { return self.scrollContainer; },
      get gripOverlay() { return self.gripOverlay; },
      get setDataGeneration() { return self.setDataGeneration; },
      runStructuralOp: <T>(fn: () => T, discard?: boolean): T => self.runStructuralOp(fn, discard),
      runTransactedStructuralOp: <T>(fn: () => T, discard?: boolean): T => self.runTransactedStructuralOp(fn, discard),
      ensureScrollContainer: (): HTMLDivElement => self.ensureScrollContainer(),
      rebuildTableBody: (): void => self.rebuildTableBody(),
    };
  }

  /**
   * Execute a function within a structural operation lock.
   * While active, block-changed events are deferred in TableCellBlocks.
   *
   * @param fn - The structural operation to execute
   * @param discard - If true, discard deferred events (for full rebuilds like setData/onPaste).
   *                  If false (default), replay deferred events after the operation.
   */
  private runStructuralOp<T>(fn: () => T, discard = false): T {
    this.structuralOpDepth++;

    try {
      return fn();
    } finally {
      this.structuralOpDepth--;

      const shouldFlush = this.structuralOpDepth === 0;

      if (shouldFlush && discard) {
        this.cellBlocks?.discardDeferredEvents();
      }
      if (shouldFlush && !discard) {
        this.cellBlocks?.flushDeferredEvents();
      }
    }
  }

  /**
   * Execute a structural operation within a Yjs transaction.
   * Combines the structural op lock (event deferral) with Yjs undo grouping.
   * Used for interactive operations that should be a single undo entry.
   *
   * @param fn - The structural operation to execute
   * @param discard - If true, discard deferred events (forwarded to runStructuralOp)
   */
  private runTransactedStructuralOp<T>(fn: () => T, discard = false): T {
    if (!this.api.blocks.transact) {
      return this.runStructuralOp(fn, discard);
    }

    const ref = { current: undefined as T | undefined };

    this.api.blocks.transact(() => {
      ref.current = this.runStructuralOp(fn, discard);
    });

    return ref.current as T;
  }

  /**
   * Tear down all visual subsystems (resize, add-controls, row/col-controls,
   * cell-selection). Called before DOM rebuild in setData/onPaste and during
   * destroy(). Does NOT tear down cellBlocks — that has special Yjs handling.
   */
  private teardownSubsystems(): void {
    this.subsystems.teardown();
    this.keyboardNavCleanup?.();
    this.keyboardNavCleanup = null;
  }

  /**
   * Rebuild the <tbody> from the current model state.
   * Generates a new table via createGridFromModel (with correct colspan/rowspan),
   * transplants existing block holders into the new cells, and swaps the tbody.
   */
  private rebuildTableBody(): void {
    const gridEl = this.gridElement;

    if (!gridEl) {
      return;
    }

    const oldTbody = gridEl.querySelector('tbody');

    if (!oldTbody) {
      return;
    }

    // Collect all existing block holders by ID before replacing tbody
    const blockHolders = new Map<string, HTMLElement>();

    oldTbody.querySelectorAll('[data-blok-id]').forEach(el => {
      const id = el.getAttribute('data-blok-id');

      if (id) {
        blockHolders.set(id, el as HTMLElement);
      }
    });

    // Build new table from model (has correct colspan/rowspan structure)
    const newTable = this.grid.createGridFromModel(this.model);
    const newTbody = newTable.querySelector('tbody');

    if (!newTbody) {
      return;
    }

    // Move block holders from old cells to new cells
    const content = this.model.snapshot().content;

    this.mountBlockHoldersInNewTbody(content, newTbody, blockHolders);

    // Replace old tbody with new
    oldTbody.replaceWith(newTbody);
  }

  /**
   * Mount block holders into the new tbody cells based on model content.
   * Extracted to keep rebuildTableBody under nesting depth limit.
   */
  private mountBlockHoldersInNewTbody(
    content: TableData['content'],
    newTbody: Element,
    blockHolders: Map<string, HTMLElement>
  ): void {
    const mounted = new Set<string>();

    content.forEach((rowData, r) => {
      rowData.forEach((cellContent, c) => {
        if (typeof cellContent === 'string') {
          return;
        }

        if (cellContent.mergedInto) {
          return;
        }

        const newCell = newTbody.querySelector(
          `[${CELL_ROW_ATTR}="${r}"][${CELL_COL_ATTR}="${c}"]`
        );

        if (!newCell) {
          return;
        }

        const container = newCell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

        if (!container) {
          return;
        }

        cellContent.blocks.forEach(blockId => {
          const holder = blockHolders.get(blockId);

          if (holder && !mounted.has(blockId)) {
            container.appendChild(holder);
            mounted.add(blockId);
          }
        });
      });
    });
  }

  /**
   * Check if the model's content contains any merged cells.
   */
  private modelHasMerges(): boolean {
    const snapshot = this.model.snapshot();

    return snapshot.content.some(row =>
      row.some(cell =>
        typeof cell !== 'string' && ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1)
      )
    );
  }

  /**
   * Create a flat grid (no merge handling) using createGrid.
   * Extracted from render() to keep it readable.
   */
  private createFlatGrid(): HTMLTableElement {
    const rows = this.initialContent?.length || this.config.rows || DEFAULT_ROWS;
    const cols = this.initialContent?.reduce((max, row) => Math.max(max, row?.length ?? 0), 0) || this.config.cols || DEFAULT_COLS;

    return this.grid.createGrid(rows, cols, this.model.colWidths);
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconTable,
      titleKey: 'tools.table.title',
      searchTerms: ['table', 'grid', 'spreadsheet'],
      searchTermKeys: ['table', 'grid', 'spreadsheet'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get enableLineBreaks(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['TABLE', 'TR', { TH: { style: true } }, { TD: { style: true } }],
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      content: {
        br: true,
        b: true,
        i: true,
        strong: true,
        em: true,
        mark: (node: Element): { [attr: string]: boolean | string } => {
          const el = node as HTMLElement;
          const style = el.style;

          const props = Array.from({ length: style.length }, (_, i) => style.item(i));

          for (const prop of props) {
            if (!ALLOWED_MARK_STYLE_PROPS.has(prop)) {
              style.removeProperty(prop);
            }
          }

          return style.length > 0 ? { style: true } : {};
        },
        a: { href: true, target: '_blank', rel: 'nofollow' },
        input: { type: true, checked: true },
      },
    };
  }

  /**
   * Ensure a scroll container exists between the wrapper and the grid.
   * Creates one on demand (e.g. when the first resize converts percent → pixel mode).
   */
  private ensureScrollContainer(): HTMLDivElement {
    if (this.scrollContainer) {
      return this.scrollContainer;
    }

    const sc = document.createElement('div');

    sc.setAttribute('data-blok-table-scroll', '');

    const grid = this.gridElement;

    if (grid && this.element) {
      this.element.insertBefore(sc, grid);
      sc.appendChild(grid);
    }

    this.scrollContainer = sc;

    // Keep add-button positions in sync when the user scrolls horizontally.
    // addControls may be null when the scroll container is first created during
    // initAll() (initResize runs before initAddControls). In that case,
    // initAddControls() will call attachScrollContainer() once addControls exists.
    this.subsystems.attachScrollContainer(sc);

    return sc;
  }

  public render(): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge(WRAPPER_CLASSES, !this.readOnly && WRAPPER_EDIT_CLASSES);
    wrapper.setAttribute(DATA_ATTR.tool, 'table');

    if (this.readOnly) {
      wrapper.setAttribute('data-blok-table-readonly', '');
    }

    this.isNewTable = (this.initialContent?.length ?? 0) === 0;

    const hasContent = (this.initialContent?.length ?? 0) > 0;
    const hasMerges = hasContent && this.modelHasMerges();

    const gridEl = hasMerges
      ? this.grid.createGridFromModel(this.model)
      : this.createFlatGrid();

    if (hasContent && !hasMerges) {
      this.grid.fillGrid(gridEl, this.initialContent ?? []);
    }

    if (this.model.colWidths) {
      applyPixelWidths(gridEl, this.model.colWidths);
    }

    this.gridElement = gridEl;

    if (this.model.colWidths || !this.readOnly) {
      const sc = document.createElement('div');

      sc.setAttribute('data-blok-table-scroll', '');

      const overflowClasses = this.model.colWidths ? SCROLL_OVERFLOW_CLASSES : [];

      sc.classList.add(...overflowClasses);

      sc.appendChild(gridEl);
      wrapper.appendChild(sc);
      this.scrollContainer = sc;
    } else {
      wrapper.appendChild(gridEl);
      this.scrollContainer = null;
    }

    if (!this.readOnly) {
      const overlay = document.createElement('div');

      overlay.setAttribute('data-blok-table-grip-overlay', '');
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '3';
      wrapper.appendChild(overlay);
      this.gripOverlay = overlay;
    }

    this.element = wrapper;

    if (this.model.withHeadings) {
      updateHeadingStyles(this.gridElement, this.model.withHeadings);
    }

    if (this.model.withHeadingColumn) {
      updateHeadingColumnStyles(this.gridElement, this.model.withHeadingColumn);
    }

    if (!this.readOnly) {
      this.initCellBlocks(gridEl);
      this.keyboardNavCleanup = setupKeyboardNavigation(gridEl, this.cellBlocks);
    }

    return wrapper;
  }

  public rendered(): void {
    if (!this.element || this.initialContent === null) {
      return;
    }

    const gridEl = this.gridElement;

    if (!gridEl) {
      return;
    }

    const content = this.initialContent;

    this.initialContent = null;

    if (this.readOnly) {
      mountCellBlocksReadOnly(gridEl, content, this.api, this.blockId ?? '');
      const snap = this.model.snapshot();
      applyCellColors(gridEl, snap.content);
      applyCellPlacements(gridEl, snap.content);
      this.subsystems.initScrollHazeOnly();

      return;
    }

    this.runTransactedStructuralOp(() => {
      const initializedContent = this.cellBlocks?.initializeCells(content) ?? content;

      // When a new table is created with empty content, the DOM grid already has
      // the correct dimensions but the model has zero rows. Pre-populate the
      // model with an empty grid so populateNewCells can sync blocks via
      // addBlockToCell (which requires valid row/col bounds).
      const contentForModel = this.isNewTable && initializedContent.length === 0
        ? Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`), (row) => {
          const cellCount = row.querySelectorAll(`[${CELL_ATTR}]`).length;

          return Array.from({ length: cellCount }, () => ({ blocks: [] as string[] }));
        })
        : initializedContent;

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: contentForModel,
      });

      if (this.isNewTable) {
        populateNewCells(gridEl, this.cellBlocks);
      }

      this.removeGhostChildren();
    }, true);

    if (this.model.initialColWidth === undefined) {
      const widths = this.model.colWidths ?? readPixelWidths(gridEl);

      this.model.setInitialColWidth(widths.length > 0
        ? computeInitialColWidth(widths)
        : undefined);
    }

    this.subsystems.initAll(gridEl);
    const snapInit = this.model.snapshot();
    applyCellColors(gridEl, snapInit.content);
    applyCellPlacements(gridEl, snapInit.content);

    if (this.isNewTable) {
      this.subsystems.cellSelectionSubsystem?.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    }
  }

  /**
   * Toggle read-only mode in place without re-rendering.
   * Entering readonly tears down all interactive subsystems and cell blocks;
   * exiting readonly recreates them.
   */
  public setReadOnly(state: boolean): void {
    const wrapper = this.element;
    const gridEl = this.gridElement;

    if (!wrapper || !gridEl) {
      return;
    }

    this.readOnly = state;

    if (state) {
      // Entering readonly: tear down interactive subsystems
      this.teardownSubsystems();
      this.cellBlocks?.destroy();
      this.cellBlocks = null;

      // Remove grip overlay
      if (this.gripOverlay) {
        this.gripOverlay.remove();
        this.gripOverlay = null;
      }

      // Update wrapper classes and attributes
      WRAPPER_EDIT_CLASSES.forEach(cls => wrapper.classList.remove(cls));
      wrapper.setAttribute('data-blok-table-readonly', '');

      // Mount cell content as non-interactive
      const snap = this.model.snapshot();

      mountCellBlocksReadOnly(gridEl, snap.content, this.api, this.blockId ?? '');
    } else {
      // Exiting readonly: restore interactive subsystems
      wrapper.removeAttribute('data-blok-table-readonly');
      WRAPPER_EDIT_CLASSES.forEach(cls => wrapper.classList.add(cls));

      // Create grip overlay
      const overlay = document.createElement('div');

      overlay.setAttribute('data-blok-table-grip-overlay', '');
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '3';
      wrapper.appendChild(overlay);
      this.gripOverlay = overlay;

      // Initialize cell blocks and subsystems
      this.initCellBlocks(gridEl);
      this.keyboardNavCleanup = setupKeyboardNavigation(gridEl, this.cellBlocks);
      this.subsystems.initAll(gridEl);
    }
  }

  /**
   * Remove blocks that claim this table as parent but are not referenced in any cell.
   *
   * These "ghost children" can appear when stale data is saved — e.g. a paste or split
   * creates a child block that never gets placed into a cell. On the next load, the
   * Renderer creates Block instances for every saved block and appends their holders to
   * the working area. initializeCells() only claims blocks actually listed in a cell's
   * `blocks` array, leaving ghosts visible below the table.
   *
   * Must be called after initializeCells() and model.replaceAll() so the model's
   * blockCellMap is fully populated.
   */
  private removeGhostChildren(): void {
    const tableId = this.blockId;

    if (tableId === undefined) {
      return;
    }

    const allChildren = this.api.blocks.getChildren(tableId);

    // Delete ghost children in reverse index order so removals don't shift indices
    const ghostEntries = allChildren
      .filter(child => this.model.findCellForBlock(child.id) === null)
      .map(child => ({
        id: child.id,
        index: this.api.blocks.getBlockIndex(child.id),
      }))
      .filter((entry): entry is { id: string; index: number } => entry.index !== undefined)
      .sort((a, b) => b.index - a.index);

    for (const { index } of ghostEntries) {
      void this.api.blocks.delete(index);
    }
  }

  public save(_blockContent: HTMLElement): TableData {
    const data = this.model.snapshot();

    // Filter out block IDs that don't belong to this table.
    // Corrupted data may contain cross-table references or phantom IDs
    // (blocks deleted but matrix not updated); persisting them causes DOM
    // node stealing and data loss on subsequent renders.
    const tableId = this.blockId ?? '';
    const gridEl = this.gridElement;

    data.content = data.content.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        if (!isCellWithBlocks(cell)) {
          return cell;
        }

        const filtered = cell.blocks.filter(blockId => {
          const block = this.api.blocks.getById?.(blockId);

          return block != null && (block.parentId ?? '') === tableId;
        });

        // Recover from a stale model snapshot: if the model says this cell is
        // empty but the live DOM still has child blocks parented to the table
        // here, harvest their ids from the DOM. Without this guard, a
        // mid-render snapshot can persist empty cells to Yjs and become an
        // attractor state that later undo presses revert to — see
        // table-undo-redo-orphans regression.
        if (filtered.length === 0 && gridEl) {
          const cellEl = gridEl.querySelector<HTMLElement>(
            `[${CELL_ROW_ATTR}="${rowIndex}"][${CELL_COL_ATTR}="${colIndex}"]`
          );
          const container = cellEl?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);
          const harvested = container
            ? Array.from(container.querySelectorAll<HTMLElement>('[data-blok-id]'))
              .map(el => el.getAttribute('data-blok-id') ?? '')
              .filter(id => {
                if (!id) {
                  return false;
                }
                const block = this.api.blocks.getById?.(id);

                return block != null && (block.parentId ?? '') === tableId;
              })
            : [];

          if (harvested.length > 0) {
            return { ...cell, blocks: harvested };
          }
        }

        return { ...cell, blocks: filtered };
      })
    );

    return data;
  }

  public validate(savedData: TableData): boolean {
    return savedData.content.length > 0;
  }

  /**
   * Update table with new data in-place (used by undo/redo).
   * Follows the onPaste() pattern: delete old blocks, re-render, reinitialize.
   */
  public setData(newData: Partial<TableData>): void {
    this.setDataGeneration++;
    const currentGeneration = this.setDataGeneration;

    const normalized = normalizeTableData(
      {
        ...this.model.snapshot(),
        ...newData,
      } as TableData,
      this.config
    );

    this.initialContent = normalized.content;
    this.model.replaceAll(normalized);

    // Only delete cell blocks during normal updates, not Yjs undo/redo.
    // During Yjs sync, the child cell blocks are managed by Yjs and will be
    // reattached via mountBlocksInCell(). Deleting them here would destroy
    // the block data that Yjs is restoring, causing empty cells after undo.
    if (!this.api.blocks.isSyncingFromYjs) {
      this.runStructuralOp(() => {
        this.cellBlocks?.deleteAllBlocks();
      }, true);
    }

    this.cellBlocks?.destroy();

    const oldElement = this.element;

    if (!oldElement?.parentNode) {
      return;
    }

    // If a newer setData call has started, bail out. The newer call will
    // handle the full DOM rebuild and block initialization, so continuing
    // here would create blocks that the newer call immediately orphans.
    if (currentGeneration !== this.setDataGeneration) {
      return;
    }

    const savedSelectionRange = this.subsystems.cellSelectionSubsystem?.getSelectedRange() ?? null;
    const savedGripIndices = this.subsystems.rowColControlsSubsystem?.getVisibleGripIndices() ?? null;

    this.teardownSubsystems();

    const newElement = this.render();

    oldElement.parentNode.replaceChild(newElement, oldElement);

    const gridEl = this.gridElement;

    if (!gridEl) {
      return;
    }

    if (this.readOnly) {
      const snapRO = this.model.snapshot();
      applyCellColors(gridEl, snapRO.content);
      applyCellPlacements(gridEl, snapRO.content);

      return;
    }

    // Check generation before initializeCells — if a re-entrant setData
    // was triggered during render() or replaceChild(), bail out.
    if (currentGeneration !== this.setDataGeneration) {
      return;
    }

    const isSyncReplay = this.api.blocks.isSyncingFromYjs;

    this.runStructuralOp(() => {
      const setDataContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      // Check generation after initializeCells — if a re-entrant setData
      // was triggered during block insertion inside initializeCells, bail
      // out to avoid overwriting the newer call's model and controls.
      if (currentGeneration !== this.setDataGeneration) {
        return;
      }

      // When an undo replay reverts content to empty, the DOM grid has its
      // default dimensions but the model has zero rows. Reflect the grid
      // shape in the model with empty cells so subsequent operations have
      // valid bounds. Do NOT call populateNewCells here — fabricating new
      // paragraph blocks during a Yjs replay creates orphans that survive
      // the next undo cycle (regression: table-undo-redo-orphans).
      // If Yjs actually contains child blocks for those cells they will
      // arrive via separate block-add events.
      if (this.api.blocks.isSyncingFromYjs && setDataContent.length === 0 && gridEl) {
        const emptyGridContent = Array.from(gridEl.querySelectorAll(`[${ROW_ATTR}]`), (row) => {
          const cellCount = row.querySelectorAll(`[${CELL_ATTR}]`).length;

          return Array.from({ length: cellCount }, () => ({ blocks: [] as string[] }));
        });

        this.model.replaceAll({
          ...this.model.snapshot(),
          content: emptyGridContent,
        });
      } else {
        this.model.replaceAll({
          ...this.model.snapshot(),
          content: setDataContent,
        });
      }

      this.initialContent = null;
    }, true);

    if (currentGeneration !== this.setDataGeneration) {
      return;
    }

    this.subsystems.initAll(gridEl);

    const cellSelection = this.subsystems.cellSelectionSubsystem;

    if (savedSelectionRange !== null && cellSelection !== null) {
      cellSelection.selectRange(savedSelectionRange);
    }

    const rowColControls = this.subsystems.rowColControlsSubsystem;

    if (savedGripIndices !== null && rowColControls !== null) {
      rowColControls.restoreVisibleGrips(savedGripIndices.col, savedGripIndices.row);
    }

    const snapSet = this.model.snapshot();
    applyCellColors(gridEl, snapSet.content);
    applyCellPlacements(gridEl, snapSet.content);

    if (isSyncReplay) {
      // Catch blocks already restored by sibling Yjs ops in this same replay
      // batch — they may be sitting at the top level waiting to be reattached
      // to their original cell. Without this, multi-cell undo restoration
      // leaves cell content as orphan top-level blocks.
      this.cellBlocks?.reclaimReferencedBlocks();
      // Yjs sometimes restores sibling blocks AFTER this sync transaction
      // commits. Schedule a second pass on the next microtask so blocks that
      // arrive late are still attached to their cells.
      void Promise.resolve().then(() => {
        if (currentGeneration !== this.setDataGeneration) {
          return;
        }
        this.cellBlocks?.reclaimReferencedBlocks();
      });
    }
  }

  public onPaste(event: HTMLPasteEvent): void {
    const content = event.detail.data;
    const rows = content.querySelectorAll('tr');
    const tableContent: string[][] = [];
    const cellColors: Array<Array<{ color?: string; textColor?: string }>> = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      const rowData: string[] = [];
      const rowColors: Array<{ color?: string; textColor?: string }> = [];

      cells.forEach(cell => {
        rowData.push(cell.innerHTML);

        const style = cell.getAttribute('style') ?? '';
        const entry: { color?: string; textColor?: string } = {};

        const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);

        if (bgMatch?.[1]) {
          entry.color = mapToNearestPresetColor(bgMatch[1].trim(), 'bg');
        }

        const textMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(style);

        if (textMatch?.[1] && !isDefaultBlack(textMatch[1].trim())) {
          entry.textColor = mapToNearestPresetColor(textMatch[1].trim(), 'text');
        }

        rowColors.push(entry);
      });

      if (rowData.length > 0) {
        tableContent.push(rowData);
        cellColors.push(rowColors);
      }
    });

    const hasTheadHeadings = content.querySelector('thead') !== null;
    const hasThHeadings = rows[0]?.querySelector('th') !== null;
    const withHeadings = hasTheadHeadings || hasThHeadings;

    this.initialContent = tableContent;
    this.model.setWithHeadings(withHeadings);
    this.model.setWithHeadingColumn(false);
    this.model.setColWidths(undefined);

    this.runStructuralOp(() => {
      this.cellBlocks?.deleteAllBlocks();
    }, true);
    this.cellBlocks?.destroy();
    this.teardownSubsystems();

    const oldElement = this.element;

    if (!oldElement?.parentNode) {
      return;
    }

    const newElement = this.render();

    oldElement.parentNode.replaceChild(newElement, oldElement);

    const gridEl = this.gridElement;

    if (!this.readOnly && gridEl) {
      this.runStructuralOp(() => {
        const pasteContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

        this.model.replaceAll({
          ...this.model.snapshot(),
          content: pasteContent,
        });
        this.initialContent = null;

        // Apply cell colors extracted from td/th style attributes
        cellColors.forEach((rowColors, r) => {
          rowColors.forEach((colors, c) => {
            if (colors.color !== undefined) {
              this.model.setCellColor(r, c, colors.color);
            }

            if (colors.textColor !== undefined) {
              this.model.setCellTextColor(r, c, colors.textColor);
            }
          });
        });
      }, true);

      this.subsystems.initAll(gridEl);
      const snapPaste = this.model.snapshot();
      applyCellColors(gridEl, snapPaste.content);
      applyCellPlacements(gridEl, snapPaste.content);
    }
  }

  public destroy(): void {
    this.unregisterRestrictedTools?.();
    this.unregisterRestrictedTools = null;

    // Only delete cell blocks during normal removal, not Yjs undo.
    // When the table is removed via Yjs undo, its child cell blocks are managed
    // by Yjs and will be restored during redo. Deleting them here would make
    // redo create empty paragraphs instead of restoring the original content.
    if (!this.api.blocks.isSyncingFromYjs) {
      this.cellBlocks?.deleteAllBlocks();
    }

    this.teardownSubsystems();
    this.cellBlocks?.destroy();
    this.cellBlocks = null;
    this.gridElement = null;
    this.scrollContainer = null;
    this.element = null;
  }

  public deleteRowWithCleanup(rowIndex: number): void {
    const gridEl = this.gridElement;

    if (!gridEl) {
      return;
    }

    this.runTransactedStructuralOp(() => {
      const { blocksToDelete } = this.model.deleteRow(rowIndex);

      this.cellBlocks?.deleteBlocks(blocksToDelete);
      this.grid.deleteRow(gridEl, rowIndex);
    });
  }

  public deleteColumnWithCleanup(colIndex: number): void {
    const gridEl = this.gridElement;

    if (!gridEl) {
      return;
    }

    this.runTransactedStructuralOp(() => {
      // model.deleteColumn() already removes the width at colIndex from
      // colWidthsValue internally, so no additional syncColWidthsAfterDeleteColumn
      // call is needed — that would double-delete.
      const { blocksToDelete } = this.model.deleteColumn(colIndex);

      this.cellBlocks?.deleteBlocks(blocksToDelete);
      this.grid.deleteColumn(gridEl, colIndex);
    });
  }

  public getBlockIdsInRow(rowIndex: number): string[] {
    return getBlockIdsInRow(this.element, this.cellBlocks, rowIndex);
  }

  public getBlockIdsInColumn(colIndex: number): string[] {
    return getBlockIdsInColumn(this.element, this.cellBlocks, colIndex);
  }

  private initCellBlocks(gridEl: HTMLElement): void {
    this.cellBlocks = new TableCellBlocks({
      api: this.api,
      gridElement: gridEl,
      tableBlockId: this.blockId ?? '',
      model: this.model,
      isStructuralOpActive: () => this.structuralOpDepth > 0,
    });
  }

}
