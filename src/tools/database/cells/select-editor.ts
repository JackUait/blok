import { nanoid } from 'nanoid';

import { IconCheck, IconCross, IconDotsHorizontal, IconMenu, IconSliders } from '../../../components/icons';
import { onHover } from '../../../components/utils/tooltip';
import { DatabaseModel } from '../database-model';
import { orderedStatusOptions, personIdsOf, statusGroupOf, statusGroupsOf } from '../property-values';
import { sortedSelectOptions } from '../../../shared/database/value-helpers';
import type { PropertyDefinition, PropertyValue, SelectOption } from '../types';
import { CellPopover, coverMinWidth } from './cell-popover';
import { createOptionPill, optionsFor } from './display';
import { pickOptionColor, shownStatusOption } from './option-colors';
import { OptionDrag, buildDeletePrompt, buildOptionPanel, placeDroppedOption } from './option-editing';
import type { CellEditorContext, CellEditorHandle } from './types';

const listIds = { next: 0 };

const selectedIdsOf = (value: PropertyValue | undefined): string[] => personIdsOf(value);

const iconButton = (attribute: string, icon: string, label: string): HTMLButtonElement => {
  const button = document.createElement('button');

  button.type = 'button';
  button.tabIndex = -1;
  button.setAttribute(attribute, '');
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;

  return button;
};

/**
 * Search-or-create option picker for select and multi-select. Single select
 * commits once and closes; multi-select commits each change and stays open.
 * Option edits (create, rename, recolor, delete, reorder) go out whole
 * through `ctx.onOptionsChange`.
 */
class SelectEditor {
  private readonly multi: boolean;
  private options: SelectOption[];
  private selected: string[];
  private query = '';
  private activeIndex = -1;
  private open = true;
  private readonly listId = `blok-database-select-${++listIds.next}`;
  private readonly root = document.createElement('div');
  private readonly chips = document.createElement('div');
  private readonly search = document.createElement('input');
  private readonly body = document.createElement('div');
  private readonly popover: CellPopover;
  private panelOptionId: string | null = null;
  private readonly drag = new OptionDrag(
    this.body,
    () => this.options,
    (id, others, index) => {
      const dragged = this.options.find((option) => option.id === id);

      if (dragged !== undefined) {
        const placed = placeDroppedOption(this.property, others, index, dragged);

        this.setOptions(this.options.map((option) => (option.id === id ? placed : option)));
      }
    },
    () => this.renderList()
  );
  private deletePromptOpen = false;

  constructor(
    private readonly property: PropertyDefinition,
    value: PropertyValue | undefined,
    anchor: HTMLElement,
    private readonly ctx: CellEditorContext
  ) {
    this.multi = property.type === 'multiSelect';
    this.options = this.sorted(optionsFor(property, ctx));
    this.selected = selectedIdsOf(value).filter((id) => this.options.some((option) => option.id === id));

    this.root.setAttribute('data-blok-database-select-editor', property.type);
    this.chips.setAttribute('data-blok-database-select-chips', '');
    this.search.type = 'text';
    this.search.setAttribute('data-blok-database-select-search', '');
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-expanded', 'true');
    this.search.setAttribute('aria-autocomplete', 'list');
    this.search.setAttribute('aria-controls', this.listId);
    this.search.setAttribute('aria-label', property.name);
    // Notion's status head shows only the current pill (feel/findings-table T17).
    this.search.placeholder = property.type === 'status' ? '' : this.t('tools.database.selectSearchPlaceholder');
    this.chips.appendChild(this.search);
    this.root.append(this.chips, this.body);

    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.activeIndex = this.query.trim() === '' ? -1 : 0;
      this.renderList();
    });
    this.search.addEventListener('keydown', this.handleSearchKey);
    // Keep focus in the search field when a row is clicked, so the keys keep working.
    this.root.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
      }
    });

    this.popover = new CellPopover({
      anchor,
      cover: ctx.coverCell,
      content: this.root,
      // Notion: 300 wide beside a 200px cell (research/08:306); status is 240 (feel/findings-table T17).
      minWidth: coverMinWidth(anchor, ctx.coverCell, property.type === 'status' ? 240 : 300),
      onEscape: () => {
        if (this.deletePromptOpen) {
          this.renderPanel();

          return;
        }
        if (this.panelOptionId !== null) {
          this.closePanel();

          return;
        }
        this.finish(true);
      },
      onDismiss: () => this.finish(false),
    });

    if (ctx.initialText !== undefined) {
      this.search.value = ctx.initialText;
      this.query = ctx.initialText;
      this.activeIndex = ctx.initialText.trim() === '' ? -1 : 0;
    }
    this.renderChips();
    this.renderList();
    this.popover.show();
    this.search.focus();
  }

  get isOpen(): boolean {
    return this.open;
  }

  finish(closePopover: boolean): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.setDeletePromptOpen(false);
    this.drag.stop();
    if (closePopover) {
      this.popover.close();
    }
    this.ctx.onClose?.();
  }

  private t(key: string): string {
    return this.ctx.i18n.t(key);
  }

  /** notion-spec-2 §4: only the row page status picker names the hovered option. */
  private get showsOptionHints(): boolean {
    return this.property.type === 'status' && this.ctx.coverCell === 'value';
  }

  private get canEditOptions(): boolean {
    return this.ctx.onOptionsChange !== undefined;
  }

  private filtered(): SelectOption[] {
    const needle = this.query.trim().toLowerCase();

    return needle === '' ? this.options : this.options.filter((option) => option.label.toLowerCase().includes(needle));
  }

  /** The label to create, or null when the search is empty or names an existing option. */
  private creatable(): string | null {
    const label = this.query.trim();

    if (label === '' || !this.canEditOptions) {
      return null;
    }

    return this.options.some((option) => option.label.toLowerCase() === label.toLowerCase()) ? null : label;
  }

  private commit(): void {
    this.ctx.onCommit(this.multi ? [...this.selected] : this.selected[0] ?? null);
  }

  /** Status options go by group, then by position; the others by the property's Sort. */
  private sorted(options: SelectOption[]): SelectOption[] {
    return this.property.type === 'status'
      ? orderedStatusOptions({ ...this.property, config: { ...this.property.config, options } })
      : sortedSelectOptions(this.property, options);
  }

  private setOptions(options: SelectOption[]): void {
    this.options = this.sorted(options);
    this.ctx.onOptionsChange?.(options);
  }

  private pick(id: string): void {
    if (this.multi) {
      if (!this.selected.includes(id) && this.ctx.maxSelections !== undefined && this.selected.length >= this.ctx.maxSelections) return;
      this.selected = this.selected.includes(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id];
      this.commit();
      this.clearSearch();
      this.renderChips();
      this.renderList();

      return;
    }
    if (this.selected[0] !== id) {
      this.selected = [id];
      this.commit();
    }
    this.finish(true);
  }

  private create(label: string): void {
    const last = this.options[this.options.length - 1];
    const option: SelectOption = {
      id: nanoid(),
      label,
      color: pickOptionColor(this.options),
      position: DatabaseModel.positionBetween(last?.position ?? null, null),
    };

    this.setOptions([...this.options, option]);
    this.pick(option.id);
    if (this.multi) {
      // research/22 §13: the new option stays highlighted while the editor stays open.
      this.activeIndex = this.options.findIndex((o) => o.id === option.id);
      this.renderList();
    }
  }

  private remove(id: string): void {
    this.selected = this.selected.filter((s) => s !== id);
    this.commit();
    this.renderChips();
    this.renderList();
  }

  private clearSearch(): void {
    this.search.value = '';
    this.query = '';
    this.activeIndex = -1;
  }

  /** Rows the arrow keys walk: the filtered options, then the create row. */
  private activeTargets(): Array<{ kind: 'option'; id: string } | { kind: 'create'; label: string }> {
    const label = this.creatable();

    return [
      ...this.filtered().map((option) => ({ kind: 'option' as const, id: option.id })),
      ...(label !== null ? [{ kind: 'create' as const, label }] : []),
    ];
  }

  private readonly handleSearchKey = (event: KeyboardEvent): void => {
    if (event.isComposing) {
      return;
    }
    const targets = this.activeTargets();

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (targets.length === 0) {
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const from = this.activeIndex < 0 && step < 0 ? 0 : this.activeIndex;

        this.activeIndex = (from + step + targets.length) % targets.length;
        this.renderList();
        break;
      }
      case 'Enter': {
        event.preventDefault();
        // notion-spec-2 §18.4: nothing is highlighted on open, so Enter there changes nothing.
        const target = targets[this.activeIndex];

        if (target === undefined) {
          return;
        }
        if (target.kind === 'create') {
          this.create(target.label);
        } else if (this.multi && this.query.trim() !== '' && this.selected.includes(target.id)) {
          // research/22 §13: Enter on a typed, already selected option does nothing (no toggle-off).
          return;
        } else {
          this.pick(target.id);
        }
        break;
      }
      case 'Backspace':
        if (this.multi && this.search.value === '' && this.selected.length > 0) {
          event.preventDefault();
          this.remove(this.selected[this.selected.length - 1]);
        }
        break;
      default:
        break;
    }
  };

  /** A status option is drawn as the cell draws it: a round pill with its group's dot. */
  private pill(option: SelectOption): HTMLSpanElement {
    if (this.property.type !== 'status') {
      return createOptionPill(option);
    }
    const pill = createOptionPill(shownStatusOption(option));

    pill.setAttribute('data-status-group', statusGroupOf(this.property, option.id)?.kind ?? 'todo');

    return pill;
  }

  private renderChips(): void {
    this.chips.querySelectorAll('[data-blok-database-select-chip]').forEach((chip) => chip.remove());
    for (const id of this.selected) {
      const option = this.options.find((o) => o.id === id);

      if (option === undefined) {
        continue;
      }
      const chip = this.pill(option);

      chip.setAttribute('data-blok-database-select-chip', id);
      if (this.multi) {
        const remove = iconButton(
          'data-blok-database-select-chip-remove',
          IconCross,
          this.t('tools.database.removeOption').replace('{option}', option.label)
        );

        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          this.remove(id);
          this.search.focus();
        });
        chip.appendChild(remove);
      }
      this.chips.insertBefore(chip, this.search);
    }
  }

  private renderList(): void {
    if (this.panelOptionId !== null) {
      return;
    }
    const hint = document.createElement('div');

    hint.setAttribute('data-blok-database-select-hint', '');
    hint.textContent = this.t('tools.database.selectHint');

    const list = document.createElement('div');

    list.id = this.listId;
    list.setAttribute('data-blok-database-select-list', '');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', this.property.name);
    if (this.multi) {
      list.setAttribute('aria-multiselectable', 'true');
    }

    const targets = this.activeTargets();
    const active = targets[this.activeIndex];

    this.search.removeAttribute('aria-activedescendant');
    const lastGroup = { id: '' };

    for (const option of this.filtered()) {
      const group = this.property.type === 'status' ? statusGroupOf(this.property, option.id) ?? statusGroupsOf(this.property)[0] : undefined;

      if (group !== undefined && group.id !== lastGroup.id) {
        const heading = document.createElement('div');

        heading.setAttribute('data-blok-database-status-group-heading', group.id);
        heading.setAttribute('role', 'presentation');
        heading.textContent = group.name;
        list.appendChild(heading);
        lastGroup.id = group.id;
      }
      const row = this.renderOptionRow(option);

      if (active?.kind === 'option' && active.id === option.id) {
        row.setAttribute('data-active', '');
        this.search.setAttribute('aria-activedescendant', row.id);
      }
      list.appendChild(row);
    }

    const label = this.creatable();

    if (label !== null) {
      const create = document.createElement('div');

      create.id = `${this.listId}-create`;
      create.setAttribute('data-blok-database-select-create', '');
      create.setAttribute('role', 'option');
      create.setAttribute('aria-selected', 'false');
      create.append(this.t('tools.database.selectCreate'), ' ', createOptionPill({ label, color: pickOptionColor(this.options) }));
      if (active?.kind === 'create') {
        create.setAttribute('data-active', '');
        this.search.setAttribute('aria-activedescendant', create.id);
      }
      create.addEventListener('click', () => this.create(label));
      list.appendChild(create);
    }

    this.body.replaceChildren(...(this.property.type === 'status' ? [] : [hint]), list, ...this.editPropertyFooter());
  }

  /** research/08: the status editor ends with "Edit property". */
  private editPropertyFooter(): HTMLElement[] {
    const onEditProperty = this.ctx.onEditProperty;

    if (this.property.type !== 'status' || onEditProperty === undefined) {
      return [];
    }
    const footer = document.createElement('button');

    footer.type = 'button';
    footer.setAttribute('data-blok-database-select-edit-property', '');
    footer.innerHTML = IconSliders;
    footer.append(this.t('tools.database.editProperty'));
    footer.addEventListener('click', () => {
      this.finish(true);
      onEditProperty();
    });

    return [footer];
  }

  private renderOptionRow(option: SelectOption): HTMLElement {
    const row = document.createElement('div');
    const selected = this.selected.includes(option.id);

    row.id = `${this.listId}-${option.id}`;
    row.setAttribute('data-blok-database-select-option', option.id);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));

    if (this.canEditOptions) {
      const handle = iconButton('data-blok-database-select-option-handle', IconMenu, this.t('tools.database.dragOption'));

      // A sorted list puts a dropped option straight back, so only Manual drags.
      handle.addEventListener('pointerdown', (event) => {
        if (this.property.type === 'status' || this.property.optionSort === undefined) this.drag.start(event, option.id);
      });
      handle.addEventListener('click', (event) => event.stopPropagation());
      row.appendChild(handle);
    }

    const pillSlot = document.createElement('span');

    pillSlot.setAttribute('data-blok-database-select-option-label', '');
    pillSlot.appendChild(this.pill(option));
    row.appendChild(pillSlot);

    if (selected) {
      const check = document.createElement('span');

      check.setAttribute('data-blok-database-select-option-check', '');
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = IconCheck;
      row.appendChild(check);
    }

    if (this.canEditOptions) {
      const menu = iconButton('data-blok-database-select-option-menu', IconDotsHorizontal, this.t('tools.database.optionMenu'));

      menu.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openPanel(option.id);
      });
      row.appendChild(menu);
    }

    row.addEventListener('click', () => this.pick(option.id));
    if (this.showsOptionHints) {
      // Rows sit 4px inside the picker, so 10px here is Notion's 6px from the picker's edge.
      onHover(row, option.label, { placement: 'left', align: 'start', gap: 10 });
    }

    return row;
  }

  // ─── Option panel: rename, recolor, delete ───

  private openPanel(optionId: string): void {
    this.panelOptionId = optionId;
    this.renderPanel();
  }

  private closePanel(): void {
    this.panelOptionId = null;
    this.setDeletePromptOpen(false);
    this.renderChips();
    this.renderList();
    this.search.focus();
  }

  private updateOption(optionId: string, changes: Partial<Pick<SelectOption, 'label' | 'color'>>): void {
    this.setOptions(this.options.map((option) => (option.id === optionId ? { ...option, ...changes } : option)));
  }

  /** The search row stays in the popover under the prompt; inert keeps the prompt modal. */
  private setDeletePromptOpen(open: boolean): void {
    this.deletePromptOpen = open;
    this.chips.toggleAttribute('inert', open);
  }

  private renderPanel(): void {
    this.setDeletePromptOpen(false);
    const option = this.options.find((o) => o.id === this.panelOptionId);

    if (option === undefined) {
      this.closePanel();

      return;
    }
    const { panel, name } = buildOptionPanel(option, {
      t: (key) => this.t(key),
      onRename: (label) => this.updateOption(option.id, { label }),
      onRecolor: (color) => {
        this.updateOption(option.id, { color });
        this.renderPanel();
      },
      onDelete: () => this.confirmDelete(option.id),
      status: this.property.type === 'status',
    });

    this.body.replaceChildren(panel);
    name.focus();
  }

  private confirmDelete(optionId: string): void {
    const { prompt, confirm } = buildDeletePrompt({
      t: (key) => this.t(key),
      onConfirm: () => {
        this.setOptions(this.options.filter((o) => o.id !== optionId));
        if (this.selected.includes(optionId)) {
          this.selected = this.selected.filter((id) => id !== optionId);
          this.commit();
        }
        this.closePanel();
      },
      onCancel: () => this.renderPanel(),
    });

    this.body.replaceChildren(prompt);
    this.setDeletePromptOpen(true);
    confirm.focus();
  }
}
export const openSelectEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  const editor = new SelectEditor(property, value, anchor, ctx);

  return {
    get isOpen() {
      return editor.isOpen;
    },
    close: () => editor.finish(true),
    cancel: () => editor.finish(true),
  };
};
