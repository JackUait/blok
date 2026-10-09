import { nanoid } from 'nanoid';

import { IconCheck, IconCross, IconDotsHorizontal, IconMenu, IconTrash } from '../../../components/icons';
import { getTabbables } from '../../../components/utils/modal-dialog';
import { DatabaseModel } from '../database-model';
import type { PropertyDefinition, PropertyValue, SelectOption } from '../types';
import { CellPopover } from './cell-popover';
import { createOptionPill, optionsFor } from './display';
import { OPTION_COLORS, optionColorLabelKey, optionColorOf, pickOptionColor } from './option-colors';
import type { CellEditorContext, CellEditorHandle } from './types';

const listIds = { next: 0 };

const byPosition = (options: SelectOption[]): SelectOption[] =>
  [...options].sort((a, b) => (a.position < b.position ? -1 : 1));

const selectedIdsOf = (value: PropertyValue | undefined): string[] => {
  if (Array.isArray(value)) {
    return [...value];
  }

  return typeof value === 'string' && value !== '' ? [value] : [];
};

const iconButton = (attribute: string, icon: string, label: string): HTMLButtonElement => {
  const button = document.createElement('button');

  button.type = 'button';
  button.tabIndex = -1;
  button.setAttribute(attribute, '');
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;

  return button;
};

interface DragState {
  id: string;
  others: SelectOption[];
  index: number;
  moved: boolean;
}

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
  private drag: DragState | null = null;
  private readonly listId = `blok-database-select-${++listIds.next}`;
  private readonly root = document.createElement('div');
  private readonly chips = document.createElement('div');
  private readonly search = document.createElement('input');
  private readonly body = document.createElement('div');
  private readonly popover: CellPopover;
  private panelOptionId: string | null = null;
  private deletePromptOpen = false;

  constructor(
    private readonly property: PropertyDefinition,
    value: PropertyValue | undefined,
    anchor: HTMLElement,
    private readonly ctx: CellEditorContext
  ) {
    this.multi = property.type === 'multiSelect';
    this.options = byPosition(optionsFor(property, ctx));
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
    this.search.placeholder = this.t('tools.database.selectSearchPlaceholder');
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
      content: this.root,
      minWidth: `${Math.max(anchor.getBoundingClientRect().width, 280)}px`,
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
    this.endDrag();
    if (closePopover) {
      this.popover.close();
    }
    this.ctx.onClose?.();
  }

  private t(key: string): string {
    return this.ctx.i18n.t(key);
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

  private setOptions(options: SelectOption[]): void {
    this.options = byPosition(options);
    this.ctx.onOptionsChange?.(options);
  }

  private pick(id: string): void {
    if (this.multi) {
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
        const target = targets[Math.max(this.activeIndex, 0)];

        if (target === undefined) {
          return;
        }
        if (target.kind === 'create') {
          this.create(target.label);
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

  private renderChips(): void {
    this.chips.querySelectorAll('[data-blok-database-select-chip]').forEach((chip) => chip.remove());
    for (const id of this.selected) {
      const option = this.options.find((o) => o.id === id);

      if (option === undefined) {
        continue;
      }
      const chip = createOptionPill(option);

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
    for (const option of this.filtered()) {
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

    this.body.replaceChildren(hint, list);
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

      handle.addEventListener('pointerdown', (event) => this.startDrag(event, option.id));
      handle.addEventListener('click', (event) => event.stopPropagation());
      row.appendChild(handle);
    }

    const pillSlot = document.createElement('span');

    pillSlot.setAttribute('data-blok-database-select-option-label', '');
    pillSlot.appendChild(createOptionPill(option));
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

    const panel = document.createElement('div');

    panel.setAttribute('data-blok-database-option-panel', option.id);

    const name = document.createElement('input');

    name.type = 'text';
    name.value = option.label;
    name.setAttribute('data-blok-database-option-name', '');
    name.setAttribute('aria-label', this.t('tools.database.optionName'));
    const rename = (): void => {
      const label = name.value.trim();
      const current = this.options.find((o) => o.id === option.id);

      if (label !== '' && current !== undefined && label !== current.label) {
        this.updateOption(option.id, { label });
      }
    };

    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        rename();
      }
    });
    name.addEventListener('change', rename);

    const del = document.createElement('button');

    del.type = 'button';
    del.setAttribute('data-blok-database-option-delete', '');
    del.innerHTML = IconTrash;
    del.append(this.t('tools.database.optionDelete'));
    del.addEventListener('click', () => this.confirmDelete(option.id));

    const heading = document.createElement('div');

    heading.setAttribute('data-blok-database-option-colors-heading', '');
    heading.textContent = this.t('tools.database.optionColors');

    const colors = document.createElement('div');

    colors.setAttribute('role', 'menu');
    colors.setAttribute('aria-label', this.t('tools.database.optionColors'));
    const current = optionColorOf(option);

    for (const color of OPTION_COLORS) {
      const item = document.createElement('button');

      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(color === current));
      item.setAttribute('data-blok-database-option-color', color);

      const swatch = document.createElement('span');

      swatch.setAttribute('data-blok-database-option-swatch', '');
      swatch.setAttribute('data-color', color);
      item.append(swatch, this.t(optionColorLabelKey(color)));
      if (color === current) {
        const check = document.createElement('span');

        check.setAttribute('data-blok-database-select-option-check', '');
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = IconCheck;
        item.appendChild(check);
      }
      item.addEventListener('click', () => {
        this.updateOption(option.id, { color });
        this.renderPanel();
      });
      colors.appendChild(item);
    }

    panel.append(name, del, heading, colors);
    this.body.replaceChildren(panel);
    name.focus();
  }

  /** Notion asks before deleting an option (research/08); rows keep existing, the value is cleared. */
  private confirmDelete(optionId: string): void {
    const prompt = document.createElement('div');
    const text = document.createElement('p');
    const confirm = document.createElement('button');
    const cancel = document.createElement('button');

    prompt.setAttribute('data-blok-database-option-delete-prompt', '');
    prompt.setAttribute('role', 'alertdialog');
    prompt.setAttribute('aria-modal', 'true');
    text.textContent = this.t('tools.database.optionDeleteConfirm');
    prompt.setAttribute('aria-label', text.textContent);
    confirm.type = 'button';
    confirm.setAttribute('data-blok-database-option-delete-confirm', '');
    confirm.textContent = this.t('tools.database.optionDelete');
    cancel.type = 'button';
    cancel.setAttribute('data-blok-database-option-delete-cancel', '');
    cancel.textContent = this.t('tools.database.optionDeleteCancel');
    confirm.addEventListener('click', () => {
      this.setOptions(this.options.filter((o) => o.id !== optionId));
      if (this.selected.includes(optionId)) {
        this.selected = this.selected.filter((id) => id !== optionId);
        this.commit();
      }
      this.closePanel();
    });
    cancel.addEventListener('click', () => this.renderPanel());
    prompt.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') {
        return;
      }
      const tabbables = getTabbables(prompt);
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];

      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
    prompt.append(text, confirm, cancel);
    this.body.replaceChildren(prompt);
    this.setDeletePromptOpen(true);
    confirm.focus();
  }

  // ─── Drag to reorder ───

  private startDrag(event: PointerEvent, id: string): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const others = this.options.filter((option) => option.id !== id);

    this.drag = { id, others, index: this.options.findIndex((option) => option.id === id), moved: false };
    this.body.querySelector(`[data-blok-database-select-option="${id}"]`)?.setAttribute('data-dragging', '');
    document.addEventListener('pointermove', this.handleDragMove);
    document.addEventListener('pointerup', this.handleDragEnd);
    document.addEventListener('pointercancel', this.handleDragCancel);
  }

  private readonly handleDragMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }
    drag.moved = true;
    drag.index = drag.others.filter((option) => {
      const row = this.body.querySelector(`[data-blok-database-select-option="${option.id}"]`);
      const rect = row?.getBoundingClientRect();

      return rect !== undefined && rect.top + rect.height / 2 < event.clientY;
    }).length;
    this.body.querySelectorAll('[data-drop-before], [data-drop-after]').forEach((row) => {
      row.removeAttribute('data-drop-before');
      row.removeAttribute('data-drop-after');
    });
    const before = drag.others[drag.index];
    const after = drag.others[drag.index - 1];

    if (before !== undefined) {
      this.body.querySelector(`[data-blok-database-select-option="${before.id}"]`)?.setAttribute('data-drop-before', '');
    } else if (after !== undefined) {
      this.body.querySelector(`[data-blok-database-select-option="${after.id}"]`)?.setAttribute('data-drop-after', '');
    }
  };

  private readonly handleDragEnd = (): void => {
    const drag = this.drag;

    this.endDrag();
    if (drag === null || !drag.moved) {
      this.renderList();

      return;
    }
    const after = drag.others[drag.index - 1] ?? null;
    const before = drag.others[drag.index] ?? null;
    const dragged = this.options.find((option) => option.id === drag.id);
    const unmoved = this.options.findIndex((option) => option.id === drag.id) === drag.index;

    if (dragged !== undefined && !unmoved) {
      const position = DatabaseModel.positionBetween(after?.position ?? null, before?.position ?? null);

      this.setOptions(this.options.map((option) => (option.id === drag.id ? { ...option, position } : option)));
    }
    this.renderList();
  };

  private readonly handleDragCancel = (): void => {
    this.endDrag();
    this.renderList();
  };

  private endDrag(): void {
    this.drag = null;
    document.removeEventListener('pointermove', this.handleDragMove);
    document.removeEventListener('pointerup', this.handleDragEnd);
    document.removeEventListener('pointercancel', this.handleDragCancel);
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
