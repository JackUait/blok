import type { PropertyDefinition, PropertyValue, RelationValue } from '../types';
import { relationIdsOf } from '../relation-values';
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
  private activeIndex = 0;
  private open = true;

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
    const scope = ctx.relationScope?.(property);

    if (scope === undefined) {
      this.root.append(this.search, hint, this.list);
    } else {
      this.root.append(this.formHeader(scope), this.list);
    }

    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.activeIndex = 0;
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
      minWidth: coverMinWidth(anchor, ctx.coverCell, 300),
      onEscape: () => this.finish(true),
      onDismiss: () => this.finish(false),
    });

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

    this.search.placeholder = this.ctx.i18n.t('tools.database.formRelationSearch');
    bar.setAttribute('data-blok-database-relation-search-bar', '');
    chip.setAttribute('data-blok-database-relation-scope', '');
    name.textContent = scope;
    chip.append(before, name, after);
    heading.setAttribute('data-blok-database-relation-heading', '');
    heading.textContent = this.ctx.i18n.t('tools.database.formRelationHeading');
    bar.append(this.search, chip);
    header.append(bar, heading);

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
    const rows = this.filtered();

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      this.activeIndex = (this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      this.renderList();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[this.activeIndex];

      if (row !== undefined) this.toggle(row.id);
    }
  };

  private renderList(): void {
    const rows = this.filtered();

    this.list.replaceChildren(...rows.map((candidate, index) => {
      const row = document.createElement('div');
      const chosen = this.selected.includes(candidate.id);

      row.id = `${this.listId}-${index}`;
      row.setAttribute('data-blok-database-relation-option', candidate.id);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', chosen ? 'true' : 'false');
      row.textContent = this.titleOf(candidate);
      if (index === this.activeIndex) {
        row.setAttribute('data-active', '');
        this.search.setAttribute('aria-activedescendant', row.id);
      }
      row.addEventListener('click', () => this.toggle(candidate.id));

      return row;
    }));
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
