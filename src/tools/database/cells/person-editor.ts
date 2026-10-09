import { IconCross } from '../../../components/icons';
import type { DatabasePerson, PersonValue, PropertyDefinition, PropertyValue } from '../types';
import { personIdsOf } from '../property-values';
import { CellPopover } from './cell-popover';
import type { CellEditorContext, CellEditorHandle } from './types';

const listIds = { next: 0 };

/**
 * The person picker: chips for the chosen people, a search field, and the
 * host's people with the current user first. Every change commits the whole
 * list at once, as `{id}` objects.
 */
class PersonEditor implements CellEditorHandle {
  private readonly root = document.createElement('div');
  private readonly chips = document.createElement('div');
  private readonly search = document.createElement('input');
  private readonly list = document.createElement('div');
  private readonly listId = `blok-database-person-list-${++listIds.next}`;
  private readonly popover: CellPopover;
  private readonly people: DatabasePerson[];
  private selected: string[];
  private query = '';
  private activeIndex = 0;
  private open = true;

  constructor(
    private readonly property: PropertyDefinition,
    value: PropertyValue | undefined,
    anchor: HTMLElement,
    private readonly ctx: CellEditorContext & { people: DatabasePerson[] }
  ) {
    const me = ctx.me;

    this.people = [
      ...ctx.people.filter((p) => p.id === me),
      ...ctx.people.filter((p) => p.id !== me),
    ];
    this.selected = personIdsOf(value);

    this.root.setAttribute('data-blok-database-person-editor', '');
    this.chips.setAttribute('data-blok-database-select-chips', '');
    this.search.type = 'text';
    this.search.setAttribute('data-blok-database-person-search', '');
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-expanded', 'true');
    this.search.setAttribute('aria-controls', this.listId);
    this.search.setAttribute('aria-label', property.name);
    this.search.placeholder = ctx.i18n.t('tools.database.personSearchPlaceholder');
    this.chips.appendChild(this.search);

    const hint = document.createElement('div');

    hint.setAttribute('data-blok-database-select-hint', '');
    hint.textContent = ctx.i18n.t('tools.database.personHint');
    this.list.id = this.listId;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-multiselectable', 'true');
    this.list.setAttribute('aria-label', property.name);
    this.root.append(this.chips, hint, this.list);

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
      content: this.root,
      minWidth: `${Math.max(anchor.getBoundingClientRect().width, 240)}px`,
      onEscape: () => this.finish(true),
      onDismiss: () => this.finish(false),
    });

    this.renderChips();
    this.renderList();
    this.popover.show();
    this.search.focus();
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

  private filtered(): DatabasePerson[] {
    const needle = this.query.trim().toLowerCase();

    return needle === '' ? this.people : this.people.filter((p) => p.name.toLowerCase().includes(needle));
  }

  private commit(): void {
    const value: PersonValue[] = this.selected.map((id) => ({ id }));

    this.ctx.onCommit(value);
    this.renderChips();
    this.renderList();
  }

  private toggle(id: string): void {
    this.selected = this.selected.includes(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id];
    this.search.value = '';
    this.query = '';
    this.commit();
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
      const person = rows[this.activeIndex];

      if (person !== undefined) this.toggle(person.id);
    } else if (event.key === 'Backspace' && this.search.value === '' && this.selected.length > 0) {
      event.preventDefault();
      this.toggle(this.selected[this.selected.length - 1]);
    }
  };

  private nameOf(id: string): string {
    return this.people.find((p) => p.id === id)?.name ?? this.ctx.i18n.t('tools.database.personUnknown');
  }

  private renderChips(): void {
    this.chips.querySelectorAll('[data-blok-database-person-chip]').forEach((chip) => chip.remove());
    for (const id of this.selected) {
      const chip = document.createElement('span');
      const remove = document.createElement('button');

      chip.setAttribute('data-blok-database-person-chip', id);
      chip.append(this.nameOf(id));
      remove.type = 'button';
      remove.setAttribute('data-blok-database-person-remove', '');
      remove.setAttribute('aria-label', this.ctx.i18n.t('tools.database.removeOption').replace('{option}', this.nameOf(id)));
      remove.innerHTML = IconCross;
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle(id);
        this.search.focus();
      });
      chip.appendChild(remove);
      this.chips.insertBefore(chip, this.search);
    }
  }

  private renderList(): void {
    const rows = this.filtered();

    this.list.replaceChildren(...rows.map((person, index) => {
      const row = document.createElement('div');
      const chosen = this.selected.includes(person.id);

      row.id = `${this.listId}-${index}`;
      row.setAttribute('data-blok-database-person-option', person.id);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', chosen ? 'true' : 'false');
      row.textContent = person.id === this.ctx.me
        ? this.ctx.i18n.t('tools.database.personYou').replace('{name}', person.name)
        : person.name;
      if (index === this.activeIndex) {
        row.setAttribute('data-active', '');
        this.search.setAttribute('aria-activedescendant', row.id);
      }
      row.addEventListener('click', () => this.toggle(person.id));

      return row;
    }));
  }
}

export const openPersonEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle | null => {
  const people = ctx.people;

  return people === undefined ? null : new PersonEditor(property, value, anchor, { ...ctx, people });
};
