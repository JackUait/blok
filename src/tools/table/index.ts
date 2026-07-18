import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  HTMLPasteEvent,
  PasteConfig,
  ToolboxConfig,
} from '../../../types';
import type { ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { DATA_ATTR } from '../../components/constants';
import {
  IconCollapseFullscreen,
  IconExpandFullscreen,
  IconHeaderColumn,
  IconHeaderRow,
  IconTable,
  IconTextSizeLarge,
  IconTextSizeSmall,
} from '../../components/icons';
import { mapToNearestPresetColor } from '../../components/utils/color-mapping';
import { twMerge } from '../../components/utils/tw';

import { TableCellBlocks, CELL_BLOCKS_ATTR } from './table-cell-blocks';
import {
  isDefaultBlack,
  placementFromAlignment,
  ALLOWED_MARK_STYLE_PROPS,
} from './table-cell-clipboard';
import { TableGrid, ROW_ATTR, CELL_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from './table-core';
import {
  applyCellColors,
  applyCellPlacements,
  applyFluidWidths,
  applyPixelWidths,
  computeInitialColWidth,
  getBlockIdsInColumn,
  getBlockIdsInRow,
  mountCellBlocksReadOnly,
  normalizeTableData,
  parsePastedTable,
  populateNewCells,
  readPixelWidths,
  SCROLL_OVERFLOW_CLASSES,
  setupKeyboardNavigation,
  updateHeadingColumnStyles,
  updateHeadingStyles,
  updateTextSizeStyles,
} from './table-operations';
import { TableModel } from './table-model';
import { registerAdditionalRestrictedTools } from './table-restrictions';
import { TableSubsystems } from './table-subsystems';
import type { TableHost } from './table-subsystems';
import type { CellContent, LegacyCellContent, TableData, TableConfig, TableTextSize } from './types';
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
  private block: BlockAPI | undefined;
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
    this.block = block;
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
      fitToPageWidth: (): void => self.fitToPageWidth(),
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

    // Reconcile the <colgroup> when the column COUNT changed (delete-col /
    // insert-col on a merged grid route through here). Only swapping <tbody>
    // would leave a stale <col> count, so the rendered grid width and
    // getColumnCount() would disagree with the model. Scoped to count changes
    // so same-width rebuilds (merge/split) keep their existing <col> widths
    // untouched (avoids resetting custom percent/pixel widths).
    const oldColgroup = gridEl.querySelector('colgroup');
    const newColgroup = newTable.querySelector('colgroup');

    if (
      oldColgroup
      && newColgroup
      && oldColgroup.querySelectorAll('col').length !== newColgroup.querySelectorAll('col').length
    ) {
      oldColgroup.replaceWith(newColgroup);
    }

    // Replace old tbody with new
    oldTbody.replaceWith(newTbody);

    // Editability backstop. splitCell empties the revealed cells (blocks: []),
    // and mountBlockHoldersInNewTbody only re-mounts EXISTING holders — so a
    // revealed (or merged-into-empty origin) cell would have no paragraph and
    // be impossible to click into or type in. The initializeCells completeness
    // sweep cannot cover this: it is skipped for merge tables and the split
    // path never runs it. Mirror the read-only→edit fix by guaranteeing every
    // rendered cell holds at least one editable block. Skipped in read-only
    // (no editing surface) — merge/split are edit-only anyway. Wrapped in a
    // structural op so the synthesized block-added events are deferred instead
    // of being double-claimed by the cell mutation handler.
    if (!this.readOnly) {
      this.runTransactedStructuralOp(() => {
        newTbody.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`).forEach(cell => {
          this.cellBlocks?.ensureCellHasBlock(cell);
        });
      }, true);
    }
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

  /**
   * A table's child blocks ARE its cell contents — it places every one of them
   * into a cell. Core must never let a user gesture nest an outside block into
   * it: an adopted block becomes a rogue cell block and surfaces inside the
   * first cell.
   */
  public static get ownsChildren(): boolean {
    return true;
  }

  public static get enableLineBreaks(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      // colspan/rowspan must be whitelisted here or the paste sanitizer strips
      // them before onPaste runs, silently flattening merged cells.
      tags: [
        'TABLE',
        'TR',
        { TH: { style: true, colspan: true, rowspan: true } },
        { TD: { style: true, colspan: true, rowspan: true } },
      ],
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

    // Every table gets a scroll container, in BOTH width modes and in read-only.
    // Percent (fluid) tables can overflow too — they carry a per-column
    // min-width floor (see MIN_COL_WIDTH), so a 20-column table scrolls instead
    // of squeezing its columns into unreadable slivers. Gating the overflow on
    // colWidths is what left pasted/read-only wide tables with no scroll
    // container at all. `overflow-x-auto` shows no scrollbar when the table fits.
    const sc = document.createElement('div');

    sc.setAttribute('data-blok-table-scroll', '');
    sc.classList.add(...SCROLL_OVERFLOW_CLASSES);
    sc.appendChild(gridEl);
    wrapper.appendChild(sc);
    this.scrollContainer = sc;

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

    updateTextSizeStyles(this.gridElement, this.model.textSize);

    if (!this.readOnly) {
      this.initCellBlocks(gridEl);
      this.keyboardNavCleanup = setupKeyboardNavigation(gridEl, this.cellBlocks);
    }

    return wrapper;
  }

  /**
   * Block ☰ menu. Without this the table had NO tool-level settings at all:
   * the header toggles were reachable only from the row-0 / col-0 grip, the
   * `stretched` flag had no UI (its model setter had zero call sites), and a
   * resized table could never get back to fluid width.
   */
  public renderSettings(): MenuConfig {
    const i18n = this.api.i18n;

    return [
      {
        icon: IconHeaderRow,
        title: i18n.t('tools.table.headerRow'),
        name: 'table-heading-row',
        isActive: this.model.withHeadings,
        closeOnActivate: true,
        onActivate: (): void => this.toggleHeadingRow(),
      },
      {
        icon: IconHeaderColumn,
        title: i18n.t('tools.table.headerColumn'),
        name: 'table-heading-column',
        isActive: this.model.withHeadingColumn,
        closeOnActivate: true,
        onActivate: (): void => this.toggleHeadingColumn(),
      },
      {
        icon: IconCollapseFullscreen,
        title: i18n.t('tools.table.fitToPageWidth'),
        name: 'table-fit-to-page-width',
        closeOnActivate: true,
        onActivate: (): void => this.fitToPageWidth(),
      },
      {
        icon: IconExpandFullscreen,
        title: i18n.t('tools.table.fullWidth'),
        name: 'table-full-width',
        isActive: this.model.stretched,
        closeOnActivate: true,
        onActivate: (): void => this.toggleFullWidth(),
      },
      {
        icon: IconTextSizeLarge,
        title: i18n.t('tools.table.textSize'),
        name: 'table-text-size',
        children: {
          items: [
            {
              icon: IconTextSizeSmall,
              title: i18n.t('tools.table.compactText'),
              name: 'table-text-compact',
              isActive: this.model.textSize === 'compact',
              closeOnActivate: true,
              onActivate: (): void => this.setTextSize('compact'),
            },
            {
              icon: IconTextSizeLarge,
              title: i18n.t('tools.table.comfortableText'),
              name: 'table-text-comfortable',
              isActive: this.model.textSize === 'comfortable',
              closeOnActivate: true,
              onActivate: (): void => this.setTextSize('comfortable'),
            },
          ],
        },
      },
    ];
  }

  private toggleHeadingRow(): void {
    const next = !this.model.withHeadings;

    this.model.setWithHeadings(next);
    updateHeadingStyles(this.gridElement, next);
    this.block?.dispatchChange();
  }

  private toggleHeadingColumn(): void {
    const next = !this.model.withHeadingColumn;

    this.model.setWithHeadingColumn(next);
    updateHeadingColumnStyles(this.gridElement, next);
    this.block?.dispatchChange();
  }

  private setTextSize(size: TableTextSize): void {
    if (this.model.textSize === size) {
      return;
    }

    this.model.setTextSize(size);
    updateTextSizeStyles(this.gridElement, size);
    this.block?.dispatchChange();
  }

  private toggleFullWidth(): void {
    const next = !this.model.stretched;

    this.model.setStretched(next);

    // Only the core style manager renders full-width; the model just round-trips it.
    if (this.block) {
      this.block.stretched = next;
    }

    this.block?.dispatchChange();
  }

  /**
   * Notion's "Fit to page width": drop the custom column widths and snap the
   * table back to the page/column width.
   *
   * This is the ONLY way back to fluid mode. The first pointerdown on a resize
   * handle pins the whole table to pixels (TableResize.applyWidths) and every
   * later render keeps those pixels, so without this action a single resize was
   * a permanent, irreversible conversion.
   */
  public fitToPageWidth(): void {
    const gridEl = this.gridElement;

    if (!gridEl) {
      return;
    }

    this.model.setColWidths(undefined);
    applyFluidWidths(gridEl);
    this.subsystems.refreshResize(gridEl);
    this.block?.dispatchChange();
  }

  public rendered(): void {
    if (!this.element || this.initialContent === null) {
      return;
    }

    // Apply full-width via the core Block.stretched setter. The model
    // round-trips the flag but only the core style manager renders it.
    if (this.block) {
      this.block.stretched = this.model.stretched;
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

      // The read-only mount path synthesizes no block for empty cells
      // ({ blocks: [] } — produced by migrating empty source cells), so after
      // restoring edit mode those cells would have no contenteditable target
      // and be impossible to click into or type in. Mirror the fresh-render
      // edit path (initializeCells) by guaranteeing every cell holds at least
      // one editable paragraph. Wrapped in a structural op so the freshly
      // constructed cellBlocks mutation handler defers the synthesized
      // block-added events instead of double-claiming them.
      // (regression: published-article tables with empty cells became
      // un-editable on the read-only→edit toggle.)
      this.runTransactedStructuralOp(() => {
        gridEl.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`).forEach(cell => {
          this.cellBlocks?.ensureCellHasBlock(cell);
        });
      }, true);

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

        const cellEl = gridEl?.querySelector<HTMLElement>(
          `[${CELL_ROW_ATTR}="${rowIndex}"][${CELL_COL_ATTR}="${colIndex}"]`
        );
        const container = cellEl?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`) ?? null;

        const filtered = cell.blocks.filter(blockId => {
          const block = this.api.blocks.getById?.(blockId);

          if (block == null) {
            return false;
          }

          const parentId = block.parentId ?? '';

          if (parentId === tableId) {
            return true;
          }

          // Ownership repair: the model references the block AND its holder
          // is visibly mounted in this very cell, but the parent link was
          // never (or no longer) set. Dropping the reference here silently
          // unparents visible cell content into a top-level orphan that
          // reloads at the bottom of / below the table (images-drift
          // regression). Re-adopt it — unless another table owns it.
          const mountedHere = container?.querySelector(
            `[data-blok-id="${CSS.escape(blockId)}"]`
          ) != null;

          if (parentId === '' && mountedHere) {
            this.api.blocks.setBlockParent(blockId, tableId);

            return true;
          }

          return false;
        });

        // Recover from a stale model snapshot: if the model says this cell is
        // empty but the live DOM still has child blocks parented to the table
        // here, harvest their ids from the DOM. Without this guard, a
        // mid-render snapshot can persist empty cells to Yjs and become an
        // attractor state that later undo presses revert to — see
        // table-undo-redo-orphans regression.
        if (filtered.length === 0 && gridEl) {
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

        // WYSIWYG completeness: a block parented to this table and visibly
        // mounted in this cell's container MUST be saved as part of the cell,
        // even if the model never recorded it (a DOM move performed by core
        // code without a block event). Dropping it lets the saver's
        // view-reference guard unparent visible content into a top-level
        // orphan. Skip ids tracked by the model in some cell — those are
        // either already in `filtered` or deliberately elsewhere.
        const mountedUntracked = container
          ? Array.from(container.querySelectorAll<HTMLElement>('[data-blok-id]'))
            .map(el => el.getAttribute('data-blok-id') ?? '')
            .filter(id => {
              if (!id || filtered.includes(id) || this.model.findCellForBlock(id) !== null) {
                return false;
              }

              const block = this.api.blocks.getById?.(id);

              return block != null && (block.parentId ?? '') === tableId;
            })
          : [];

        const merged = [...filtered, ...mountedUntracked];

        return { ...cell, blocks: this.reorderToDomOrder(merged, rowIndex, colIndex) };
      })
    );

    return data;
  }

  /**
   * WYSIWYG backstop: reorder a cell's block ids to match the visible DOM
   * order of their holders. The model is kept in sync on every insert/move,
   * but if any path ever reorders the DOM without syncing the model, the
   * DOM — what the user sees — must win at save time (images-drift-to-cell-
   * bottom regression). Only applies when EVERY id resolves to a holder
   * inside the cell's container; a partially-mounted cell (mid-rebuild
   * transitional state) keeps the model order rather than guessing.
   */
  private reorderToDomOrder(blockIds: string[], rowIndex: number, colIndex: number): string[] {
    if (blockIds.length < 2) {
      return blockIds;
    }

    const cellEl = this.gridElement?.querySelector<HTMLElement>(
      `[${CELL_ROW_ATTR}="${rowIndex}"][${CELL_COL_ATTR}="${colIndex}"]`
    );
    const container = cellEl?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return blockIds;
    }

    const positions = new Map<string, number>();

    Array.from(container.querySelectorAll<HTMLElement>('[data-blok-id]')).forEach((holder, index) => {
      const id = holder.getAttribute('data-blok-id');

      if (id !== null && !positions.has(id)) {
        positions.set(id, index);
      }
    });

    if (!blockIds.every(id => positions.has(id))) {
      return blockIds;
    }

    return [...blockIds].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0));
  }

  public validate(savedData: TableData): boolean {
    // Require at least one row AND every row to have columns. A zero-column
    // row (e.g. [[]]) passes a naive length check but then desyncs the
    // DEFAULT_COLS DOM fallback against a 0-column model.
    return (
      savedData.content.length > 0 &&
      savedData.content.every(row => Array.isArray(row) && row.length > 0)
    );
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

  /**
   * Extract background / text color and alignment overrides from a pasted
   * cell's inline style. `text-align` / `vertical-align` map onto Blok's own
   * 9-way cell placement — pasteConfig whitelists `style` on TD/TH so both
   * survive the paste sanitizer; nothing used to read them.
   */
  private static extractPastedCellMetadata(cell: Element): Partial<CellContent> {
    const style = cell.getAttribute('style') ?? '';
    const entry: Partial<CellContent> = {};

    const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);

    if (bgMatch?.[1]) {
      entry.color = mapToNearestPresetColor(bgMatch[1].trim(), 'bg');
    }

    const textMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(style);

    if (textMatch?.[1] && !isDefaultBlack(textMatch[1].trim())) {
      entry.textColor = mapToNearestPresetColor(textMatch[1].trim(), 'text');
    }

    const placement = placementFromAlignment(
      /(?<![a-z-])text-align\s*:\s*([^;]+)/i.exec(style)?.[1],
      /vertical-align\s*:\s*([^;]+)/i.exec(style)?.[1],
    );

    if (placement !== undefined) {
      entry.placement = placement;
    }

    return entry;
  }

  public onPaste(event: HTMLPasteEvent): void {
    const content = event.detail.data;
    const rows = content.querySelectorAll('tr');
    // Logical grid: spans are honoured, covered slots carry mergedInto and
    // colors sit at their logical (not physical) coordinates.
    const tableContent = parsePastedTable(rows, Table.extractPastedCellMetadata);

    const hasTheadHeadings = content.querySelector('thead') !== null;
    const hasThHeadings = rows[0]?.querySelector('th') !== null;
    // Notion parity: pasted spreadsheet/HTML data treats its first row as the
    // header by default. Explicit thead/th force it on; otherwise any multi-row
    // paste heads its first row. A single-row paste has no body to head, so it
    // stays plain (matches the "paste over a fully configured table" contract).
    const withHeadings = hasTheadHeadings || hasThHeadings || rows.length >= 2;

    this.initialContent = tableContent;
    this.model.setWithHeadings(withHeadings);
    this.model.setWithHeadingColumn(false);
    this.model.setColWidths(undefined);
    // Push the parsed grid into the model BEFORE render() so the merge-aware
    // path (createGridFromModel) builds the DOM with colspan/rowspan.
    this.model.replaceAll({
      ...this.model.snapshot(),
      content: tableContent,
    });

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
