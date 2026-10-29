import { IconMinus, IconPlus } from '../../../components/icons';
import type { PropertyDefinition, PropertyValue, RelationValue } from '../types';
import { relationIdsOf } from '../relation-values';
import { pagePlaceholderIcon } from '../page-icon';
import { CellPopover, coverMinWidth } from './cell-popover';
import type { CellEditorContext, CellEditorHandle } from './types';

const listIds = { next: 0 };

interface Candidate {
  id: string;
  title: string;
}

/**
 * The relation picker: a search field over the related database's rows.
 * Picking a row adds or removes it; with a one-page limit it replaces the
 * row. Every change commits the whole list as `{id}` objects.
 */
class RelationEditor implements CellEditorHandle {
  private readonly root = document.createElement('div');
  private readonly search = document.createElement('input');
  private readonly list = document.createElement('div');
  private readonly listId = `blok-database-relation-list-${++listIds.next}`;
  private readonly popover: CellPopover;
  private selected: string[];
  private query = '';
  /** By id, not index: a link regroups the rows. */
  private activeId: string | null = null;
  private open = true;
  /** The table picker's label over the list; null elsewhere. */
  private heading: HTMLElement | null = null;

  constructor(
    private readonly property: PropertyDefinition,
    value: PropertyValue | undefined,
    anchor: HTMLElement,
    private readonly ctx: CellEditorContext,
    private readonly candidates: Candidate[]
  ) {
    this.selected = relationIdsOf(value);
    this.root.setAttribute('data-blok-database-relation-editor', '');
    this.root.setAttribute('data-blok-keyboard-owner', '');
    this.search.type = 'text';
    this.search.setAttribute('data-blok-database-relation-search', '');
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-expanded', 'true');
    this.search.setAttribute('aria-controls', this.listId);
    this.search.setAttribute('aria-label', property.name);
    this.search.placeholder = ctx.i18n.t('tools.database.relationSearchPlaceholder');

    const hint = document.createElement('div');

    hint.setAttribute('data-blok-database-select-hint', '');
    hint.textContent = ctx.i18n.t(property.relation?.limit === 1 ? 'tools.database.relationHintOne' : 'tools.database.relationHint');
    this.list.id = this.listId;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-multiselectable', property.relation?.limit === 1 ? 'false' : 'true');
    this.list.setAttribute('aria-label', property.name);
    // The row page keeps the plain search and hint; a table cell and a form name the database.
    const scope = ctx.coverCell === 'value' ? undefined : ctx.relationScope?.(property);

    if (scope === undefined) {
      this.root.append(this.search, hint, this.list);
    } else {
      this.root.append(this.formHeader(scope), this.list);
    }

    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.activeId = this.rows()[0]?.id ?? null;
      this.renderList();
    });
    this.search.addEventListener('keydown', this.handleKey);
    this.root.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
      }
    });

    this.popover = new CellPopover({
      anchor,
      cover: ctx.coverCell,
      content: this.root,
      // notion-spec-2 §18.3: 560 wide over a table cell.
      minWidth: coverMinWidth(anchor, ctx.coverCell, ctx.coverCell === true ? 560 : 300),
      onEscape: () => this.finish(true),
      onDismiss: () => this.finish(false),
    });

    // notion-spec-2 §19.2: the first row is highlighted on open, a linked one when any is linked.
    this.activeId = this.rows()[0]?.id ?? null;
    this.renderList();
    this.popover.show();
    this.search.focus();
  }

  /** Research/19 §3b: "Search…" with "In <database>" at its end, then "Select a page". */
  private formHeader(scope: string): HTMLElement {
    const header = document.createElement('div');
    const bar = document.createElement('div');
    const chip = document.createElement('span');
    const name = document.createElement('strong');
    const heading = document.createElement('div');
    const [before, after = ''] = this.ctx.i18n.t('tools.database.formRelationScope').split('{database}');

    if (this.ctx.coverCell !== true) {
      this.search.placeholder = this.ctx.i18n.t('tools.database.formRelationSearch');
    }
    header.setAttribute('data-blok-database-relation-head', '');
    bar.setAttribute('data-blok-database-relation-search-bar', '');
    chip.setAttribute('data-blok-database-relation-scope', '');
    name.textContent = scope;
    chip.append(before, name, after);
    heading.setAttribute('data-blok-database-relation-heading', '');
    heading.textContent = this.ctx.i18n.t('tools.database.formRelationHeading');
    bar.append(this.search, chip);
    header.append(bar, heading);
    if (this.ctx.coverCell === true) {
      this.heading = heading;
    }

    return header;
  }

  get isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.finish(true);
  }

  cancel(): void {
    this.finish(true);
  }

  private finish(closePopover: boolean): void {
    if (!this.open) return;
    this.open = false;
    if (closePopover) this.popover.close();
    this.ctx.onClose?.();
  }

  private titleOf(candidate: Candidate): string {
    return candidate.title === '' ? this.ctx.i18n.t('tools.database.relationUntitled') : candidate.title;
  }

  private filtered(): Candidate[] {
    const needle = this.query.trim().toLowerCase();

    return needle === '' ? this.candidates : this.candidates.filter((c) => this.titleOf(c).toLowerCase().includes(needle));
  }

  /** notion-spec-2 §19.2: the table picker lists the linked pages first. */
  private rows(): Candidate[] {
    const rows = this.filtered();

    if (this.heading === null) {
      return rows;
    }
    const linked = this.selected.flatMap((id) => rows.filter((row) => row.id === id));

    return [...linked, ...rows.filter((row) => !this.selected.includes(row.id))];
  }

  private toggle(id: string): void {
    if (this.property.relation?.limit === 1) {
      this.selected = this.selected.includes(id) ? [] : [id];
    } else {
      if (!this.selected.includes(id) && this.ctx.maxSelections !== undefined && this.selected.length >= this.ctx.maxSelections) return;
      this.selected = this.selected.includes(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id];
    }
    const value: RelationValue[] = this.selected.map((selected) => ({ id: selected }));

    this.ctx.onCommit(value);
    this.renderList();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    const rows = this.rows();
    const index = rows.findIndex((row) => row.id === this.activeId);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      this.activeId = rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].id;
      this.renderList();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[index];

      if (row === undefined) return;
      // Enter only links: the first row is highlighted on open, and Enter there must not unlink it.
      if (!this.selected.includes(row.id)) this.toggle(row.id);
      // notion-spec-2 §19.2: in the table picker, Enter on a linked page opens it.
      else if (this.heading !== null) this.openPeek(row.id);
    }
  };

  /**
   * notion-spec-2 §19.2: a centred peek opens over the picker, which stays
   * open under it. The hold must start before the peek takes focus.
   */
  private openPeek(rowId: string): void {
    const release = this.popover.hold();
    const opened = this.ctx.openRelated?.(this.property, rowId, {
      mode: 'center',
      // notion-spec-2 §20.12: focus stays on the page; the picker's Escape works from there.
      onClose: release,
    });

    if (opened !== true) release();
  }

  private renderList(): void {
    const rows = this.rows();
    const linked = rows.filter((row) => this.selected.includes(row.id)).length;

    this.search.removeAttribute('aria-activedescendant');
    if (this.heading !== null) {
      this.heading.textContent = linked === 0
        ? this.ctx.i18n.t('tools.database.formRelationHeading')
        : this.ctx.i18n.t('tools.database.tableSelectedCount').replace('{count}', String(linked));
    }

    const items = rows.map((candidate, index) => {
      const row = document.createElement('div');
      const chosen = this.selected.includes(candidate.id);

      row.id = `${this.listId}-${index}`;
      row.setAttribute('data-blok-database-relation-option', candidate.id);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', chosen ? 'true' : 'false');
      row.append(pagePlaceholderIcon(), this.titleOf(candidate));
      if (this.heading !== null) {
        // notion-spec-2 §19.15: "+" links, "−" unlinks; a click on it is the row's click.
        const toggle = document.createElement('span');

        toggle.setAttribute('data-blok-database-relation-toggle', chosen ? 'remove' : 'add');
        toggle.setAttribute('aria-hidden', 'true');
        toggle.innerHTML = chosen ? IconMinus : IconPlus;
        row.appendChild(toggle);
      }
      if (candidate.id === this.activeId) {
        row.setAttribute('data-active', '');
        this.search.setAttribute('aria-activedescendant', row.id);
      }
      row.addEventListener('click', () => this.toggle(candidate.id));

      return row;
    });

    if (this.heading !== null && linked > 0 && linked < rows.length) {
      const more = document.createElement('div');

      more.setAttribute('data-blok-database-relation-heading', '');
      more.setAttribute('role', 'presentation');
      more.textContent = this.ctx.i18n.t('tools.database.relationSelectMore');
      items.splice(linked, 0, more);
    }
    this.list.replaceChildren(...items);
  }
}

const CLOSED: CellEditorHandle = { isOpen: false, close: () => undefined, cancel: () => undefined };

export const openRelationEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  const candidates = ctx.relationCandidates?.(property);

  return candidates === undefined ? CLOSED : new RelationEditor(property, value, anchor, ctx, candidates);
};
