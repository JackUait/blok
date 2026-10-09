import type { I18n } from '../../../types';
import { openCellEditor } from './cells';
import type { CellContext, CellEditorHandle } from './cells';
import { readPropertyValue } from './property-values';
import type { DatabaseRow, PropertyDefinition, PropertyValue, SelectOption } from './types';

export interface CellRef {
  rowId: string;
  propertyId: string;
}

/** A cell (with an optional range to `focus`) or a set of whole rows. */
export type TableSelection =
  | { kind: 'cell'; anchor: CellRef; focus: CellRef }
  | { kind: 'rows'; rowIds: string[] };

/**
 * What a table keeps across redraws. The tool owns one per view; every redraw
 * hands it to the new table, so a selection, an expanded load limit or a
 * collapsed group survives a peer edit or a commit. Never saved.
 */
export interface TableState {
  selection: TableSelection | null;
  /** A cell editor is open. The tool defers redraws while it is. */
  editing: boolean;
  /** A resize, column move or row drag is running. Also defers redraws. */
  busy: boolean;
  /** Rows shown per group key ('' when ungrouped), past the view's load limit. */
  loaded: Map<string, number>;
  collapsed: Set<string>;
  /** Open this cell's editor once the next render is in the page. */
  pendingEdit?: CellRef;
  /** Row made by "+ New page" and still untouched: Escape on it deletes it. */
  freshRowId?: string;
  /** The grid had focus, so the redraw gives it back. */
  focused: boolean;
}

export const createTableState = (): TableState => ({
  selection: null,
  editing: false,
  busy: false,
  loaded: new Map(),
  collapsed: new Set(),
  focused: false,
});

export interface GridCallbacks {
  commitCell: (rowId: string, propertyId: string, value: PropertyValue) => void;
  editEnded: () => void;
  deleteRows: (rowIds: string[]) => void;
  duplicateRows: (rowIds: string[]) => void;
  optionsChange?: (propertyId: string, options: SelectOption[]) => void;
  /** Selection changed: the view repaints checkboxes and the selection bar. */
  selectionChanged: () => void;
}

export interface GridOptions {
  root: HTMLElement;
  readOnly: boolean;
  i18n: Pick<I18n, 't'>;
  state: TableState;
  columns: PropertyDefinition[];
  rows: Map<string, DatabaseRow>;
  titlePropertyId: string;
  callbacks: GridCallbacks;
  /** Host extras for the cell editors, such as the rows a relation can pick. */
  cellContext?: Partial<CellContext>;
}

/** The value a cleared cell takes, per type. Undefined: the cell cannot be cleared. */
export const emptyValueOf = (property: PropertyDefinition): PropertyValue | undefined => {
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return '';
    case 'multiSelect':
    case 'person':
    case 'files':
    case 'relation':
      return [];
    case 'checkbox':
      return false;
    case 'number':
    case 'select':
    case 'status':
    case 'date':
    case 'richText':
      return null;
    case 'uniqueId':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'formula':
    case 'rollup':
      return undefined;
    default:
      // A type from a newer client: its empty shape is unknown.
      return undefined;
  }
};

const isPrintableKey = (event: KeyboardEvent): boolean =>
  event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;

/**
 * The table's cell keyboard model and selection, as measured in Notion
 * (research/08 "Cell keyboard model"). It works on the rendered DOM: rows are
 * the `[data-blok-database-table-row]` elements in order, columns the
 * `[role=gridcell]` order inside a row.
 */
export class DatabaseTableGrid {
  private readonly root: HTMLElement;
  private readonly readOnly: boolean;
  private readonly i18n: Pick<I18n, 't'>;
  private readonly state: TableState;
  private readonly columns: PropertyDefinition[];
  private readonly rows: Map<string, DatabaseRow>;
  private readonly titlePropertyId: string;
  private readonly callbacks: GridCallbacks;
  private readonly cellContext: Partial<CellContext>;
  private editor: CellEditorHandle | null = null;
  private destroyed = false;
  /** The key being handled while an editor closes: tells Enter and Escape from an outside press. */
  private keyInFlight: string | null = null;

  constructor(options: GridOptions) {
    this.root = options.root;
    this.readOnly = options.readOnly;
    this.i18n = options.i18n;
    this.state = options.state;
    this.columns = options.columns;
    this.rows = options.rows;
    this.titlePropertyId = options.titlePropertyId;
    this.callbacks = options.callbacks;
    this.cellContext = options.cellContext ?? {};

    this.root.addEventListener('keydown', this.handleKeydown);
    this.root.addEventListener('focusin', this.handleFocus);
    this.root.addEventListener('focusout', this.handleFocus);
  }

  destroy(): void {
    this.destroyed = true;
    this.root.removeEventListener('keydown', this.handleKeydown);
    this.root.removeEventListener('focusin', this.handleFocus);
    this.root.removeEventListener('focusout', this.handleFocus);
    window.removeEventListener('keydown', this.recordKey, true);
    this.editor?.close();
  }

  /** Paint the stored selection and run a pending edit. Call once the grid is in the page. */
  restore(): void {
    this.dropMissing();
    this.paint();

    const pending = this.state.pendingEdit;

    this.state.pendingEdit = undefined;
    if (pending !== undefined && this.cellEl(pending) !== null) {
      this.state.selection = { kind: 'cell', anchor: pending, focus: pending };
      this.paint();
      this.openEditor(pending);

      return;
    }
    if (this.state.focused && this.state.selection !== null) {
      this.root.focus({ preventScroll: true });
    }
  }

  get isEditing(): boolean {
    return this.editor?.isOpen === true;
  }

  /** A click on a cell: select it and open its editor at once. Shift extends the range. */
  clickCell(ref: CellRef, extend: boolean): void {
    const selection = this.state.selection;

    if (extend && selection?.kind === 'cell') {
      this.state.selection = { ...selection, focus: ref };
      this.paint();
      this.root.focus({ preventScroll: true });

      return;
    }
    this.state.selection = { kind: 'cell', anchor: ref, focus: ref };
    this.paint();
    if (this.readOnly) {
      this.root.focus({ preventScroll: true });

      return;
    }
    this.openEditor(ref);
  }

  /** Open a cell's editor; `initialText` replaces its value. */
  openEditor(ref: CellRef, initialText?: string): void {
    const property = this.columns.find((p) => p.id === ref.propertyId);
    const anchor = this.cellEl(ref);
    const row = this.rows.get(ref.rowId);

    if (this.readOnly || property === undefined || anchor === null || row === undefined) {
      return;
    }
    this.editor?.close();
    this.state.editing = true;
    // Registered before the editor's own window listener, so it runs first.
    window.addEventListener('keydown', this.recordKey, true);

    const handle = openCellEditor(property, readPropertyValue(row, property), anchor, {
      ...this.cellContext,
      i18n: this.i18n,
      readOnly: false,
      options: property.config?.options ?? [],
      ...(initialText !== undefined ? { initialText } : {}),
      ...(this.callbacks.optionsChange !== undefined
        ? { onOptionsChange: (next: SelectOption[]) => this.callbacks.optionsChange?.(ref.propertyId, next) }
        : {}),
      onCommit: (value) => this.commit(ref, value),
      onClose: () => this.editorClosed(ref),
    });

    this.editor = handle.isOpen ? handle : null;
  }

  private commit(ref: CellRef, value: PropertyValue): void {
    const row = this.rows.get(ref.rowId);

    if (row !== undefined) {
      // A relation shows its computed list; repaint from the new value until the next redraw.
      const computed = row.computed !== undefined && Object.hasOwn(row.computed, ref.propertyId)
        ? { computed: { ...row.computed, [ref.propertyId]: value } }
        : {};

      this.rows.set(ref.rowId, { ...row, properties: { ...row.properties, [ref.propertyId]: value }, ...computed });
    }
    if (ref.rowId === this.state.freshRowId) {
      this.state.freshRowId = undefined;
    }
    this.callbacks.commitCell(ref.rowId, ref.propertyId, value);
    this.repaintCell(ref);
  }

  private editorClosed(ref: CellRef): void {
    const key = this.keyInFlight;

    this.editor = null;
    this.state.editing = false;
    window.removeEventListener('keydown', this.recordKey, true);
    if (this.destroyed) {
      return;
    }

    if (key === 'Escape' && ref.rowId === this.state.freshRowId && this.isBlankRow(ref.rowId)) {
      this.state.freshRowId = undefined;
      this.state.selection = null;
      this.callbacks.deleteRows([ref.rowId]);
      this.callbacks.editEnded();

      return;
    }

    const target = key === 'Enter' ? this.offset(ref, 1, 0) : ref;

    this.state.selection = { kind: 'cell', anchor: target, focus: target };
    this.paint();
    if (key === 'Enter' || key === 'Escape' || this.root.contains(document.activeElement) || document.activeElement === document.body) {
      this.root.focus({ preventScroll: true });
    }
    this.callbacks.editEnded();
  }

  private isBlankRow(rowId: string): boolean {
    const title = this.rows.get(rowId)?.properties[this.titlePropertyId];

    return title === undefined || title === null || title === '';
  }

  private readonly recordKey = (event: KeyboardEvent): void => {
    this.keyInFlight = event.key;
    setTimeout(() => {
      this.keyInFlight = null;
    }, 0);
  };

  private readonly handleFocus = (): void => {
    this.state.focused = this.root.contains(document.activeElement);
  };

  // ─── Geometry ───

  private rowIds(): string[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')]
      .map((el) => el.getAttribute('data-row-id') ?? '');
  }

  private columnIds(): string[] {
    return this.columns.map((p) => p.id);
  }

  private indexOf(ref: CellRef): { r: number; c: number } {
    return { r: this.rowIds().indexOf(ref.rowId), c: this.columnIds().indexOf(ref.propertyId) };
  }

  /** The cell `dr` rows and `dc` columns away, clamped to the grid. */
  private offset(ref: CellRef, dr: number, dc: number): CellRef {
    const rows = this.rowIds();
    const cols = this.columnIds();
    const { r, c } = this.indexOf(ref);
    const nr = Math.min(Math.max(r + dr, 0), rows.length - 1);
    const nc = Math.min(Math.max(c + dc, 0), cols.length - 1);

    return { rowId: rows[nr] ?? ref.rowId, propertyId: cols[nc] ?? ref.propertyId };
  }

  private cellEl(ref: CellRef): HTMLElement | null {
    const rowEl = [...this.root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')]
      .find((el) => el.getAttribute('data-row-id') === ref.rowId);

    return [...(rowEl?.querySelectorAll<HTMLElement>('[role="gridcell"]') ?? [])]
      .find((el) => el.getAttribute('data-property-id') === ref.propertyId) ?? null;
  }

  /** Cells inside the selection rectangle. */
  private rangeRefs(): CellRef[] {
    const selection = this.state.selection;

    if (selection?.kind !== 'cell') {
      return [];
    }
    const rows = this.rowIds();
    const cols = this.columnIds();
    const a = this.indexOf(selection.anchor);
    const f = this.indexOf(selection.focus);
    const rowSpan = rows.slice(Math.min(a.r, f.r), Math.max(a.r, f.r) + 1);
    const colSpan = cols.slice(Math.min(a.c, f.c), Math.max(a.c, f.c) + 1);

    return rowSpan.flatMap((rowId) => colSpan.map((propertyId) => ({ rowId, propertyId })));
  }

  /** Row ids the selection covers, whole rows or the rows of a cell range. */
  selectedRowIds(): string[] {
    const selection = this.state.selection;

    if (selection === null) {
      return [];
    }
    if (selection.kind === 'rows') {
      return selection.rowIds;
    }

    return [...new Set(this.rangeRefs().map((ref) => ref.rowId))];
  }

  /** A selection pointing at rows or columns the new render lacks is dropped. */
  private dropMissing(): void {
    const selection = this.state.selection;
    const rows = new Set(this.rowIds());
    const cols = new Set(this.columnIds());
    const known = (ref: CellRef): boolean => rows.has(ref.rowId) && cols.has(ref.propertyId);

    if (selection?.kind === 'cell' && (!known(selection.anchor) || !known(selection.focus))) {
      this.state.selection = null;
    }
    if (selection?.kind === 'rows') {
      const kept = selection.rowIds.filter((id) => rows.has(id));

      this.state.selection = kept.length > 0 ? { kind: 'rows', rowIds: kept } : null;
    }
  }

  // ─── Row selection ───

  toggleRow(rowId: string): void {
    const current = this.state.selection?.kind === 'rows' ? this.state.selection.rowIds : [];
    const next = current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId];

    this.state.selection = next.length > 0 ? { kind: 'rows', rowIds: next } : null;
    this.paint();
  }

  selectRows(rowIds: string[]): void {
    this.state.selection = rowIds.length > 0 ? { kind: 'rows', rowIds } : null;
    this.paint();
  }

  /** Header checkbox: all rows, or none when all are already selected. */
  toggleAll(): void {
    const all = this.rowIds();
    const selected = this.state.selection?.kind === 'rows' ? this.state.selection.rowIds : [];

    this.selectRows(selected.length === all.length ? [] : all);
  }

  // ─── Painting ───

  paint(): void {
    const selection = this.state.selection;
    const inRange = new Set(this.rangeRefs().map((ref) => `${ref.rowId}\u0000${ref.propertyId}`));
    const anchor = selection?.kind === 'cell' ? selection.anchor : null;
    const selectedRows = new Set(selection?.kind === 'rows' ? selection.rowIds : []);

    for (const rowEl of this.root.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')) {
      const rowId = rowEl.getAttribute('data-row-id') ?? '';
      const rowSelected = selectedRows.has(rowId);

      rowEl.setAttribute('aria-selected', rowSelected ? 'true' : 'false');
      rowEl.querySelector('[data-blok-database-table-row-checkbox]')?.setAttribute('aria-checked', rowSelected ? 'true' : 'false');

      for (const cellEl of rowEl.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
        const propertyId = cellEl.getAttribute('data-property-id') ?? '';
        const selected = inRange.has(`${rowId}\u0000${propertyId}`);
        const isAnchor = anchor !== null && anchor.rowId === rowId && anchor.propertyId === propertyId;

        cellEl.setAttribute('aria-selected', selected ? 'true' : 'false');
        cellEl.toggleAttribute('data-blok-database-table-cell-anchor', isAnchor);
        cellEl.tabIndex = isAnchor ? 0 : -1;
      }
    }

    const anchorEl = anchor === null ? null : this.cellEl(anchor);

    if (anchorEl?.id !== undefined && anchorEl.id !== '') {
      this.root.setAttribute('aria-activedescendant', anchorEl.id);
    } else {
      this.root.removeAttribute('aria-activedescendant');
    }
    this.callbacks.selectionChanged();
  }

  private repaintCell(ref: CellRef): void {
    const cellEl = this.cellEl(ref);

    cellEl?.dispatchEvent(new CustomEvent('blok-database-table-repaint', { bubbles: true }));
  }

  // ─── Keys ───

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || this.isEditing || !(event.target instanceof Node) || !this.root.contains(event.target)) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    const selection = this.state.selection;

    if (event.key === 'Escape') {
      this.escape(event);

      return;
    }
    if (selection?.kind === 'rows' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && !this.readOnly) {
      event.preventDefault();
      this.callbacks.duplicateRows(selection.rowIds);

      return;
    }
    if (selection?.kind !== 'cell') {
      if ((event.key === 'Backspace' || event.key === 'Delete') && selection?.kind === 'rows' && !this.readOnly) {
        event.preventDefault();
        this.callbacks.deleteRows(selection.rowIds);
      }

      return;
    }
    this.cellKey(event, selection);
  };

  private escape(event: KeyboardEvent): void {
    const selection = this.state.selection;

    if (selection === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (selection.kind === 'cell') {
      this.selectRows(this.selectedRowIds());

      return;
    }
    this.state.selection = null;
    this.paint();
  }

  private cellKey(event: KeyboardEvent, selection: Extract<TableSelection, { kind: 'cell' }>): void {
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const rtl = getComputedStyle(this.root).direction === 'rtl';
    const step = arrows[event.key];

    if (step !== undefined) {
      event.preventDefault();
      const [dr, rawDc] = step;
      const dc = rtl ? -rawDc : rawDc;

      if (event.shiftKey) {
        this.state.selection = { ...selection, focus: this.offset(selection.focus, dr, dc) };
      } else {
        const next = this.offset(selection.anchor, dr, dc);

        this.state.selection = { kind: 'cell', anchor: next, focus: next };
      }
      this.paint();
      this.cellEl(this.state.selection.kind === 'cell' ? this.state.selection.focus : selection.anchor)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });

      return;
    }

    switch (event.key) {
      case 'Tab': {
        event.preventDefault();
        if (event.shiftKey) {
          this.state.selection = { ...selection, focus: this.offset(selection.focus, 0, -1) };
        } else {
          const next = this.offset(selection.anchor, 0, 1);

          this.state.selection = { kind: 'cell', anchor: next, focus: next };
        }
        this.paint();

        return;
      }
      case 'Enter':
        event.preventDefault();
        this.openEditor(selection.anchor);

        return;
      case 'Backspace':
      case 'Delete':
        event.preventDefault();
        this.clearRange();

        return;
      default:
        break;
    }

    if (isPrintableKey(event) && !this.readOnly) {
      const property = this.columns.find((p) => p.id === selection.anchor.propertyId);

      if (property?.type === 'checkbox') {
        return;
      }
      event.preventDefault();
      this.openEditor(selection.anchor, event.key);
    }
  }

  private clearRange(): void {
    if (this.readOnly) {
      return;
    }
    for (const ref of this.rangeRefs()) {
      const property = this.columns.find((p) => p.id === ref.propertyId);

      const empty = property === undefined ? undefined : emptyValueOf(property);
      const current = this.rows.get(ref.rowId)?.properties[ref.propertyId];

      if (property !== undefined && empty !== undefined && JSON.stringify(current ?? empty) !== JSON.stringify(empty)) {
        this.commit(ref, empty);
      }
    }
    this.paint();
    this.callbacks.editEnded();
  }
}
