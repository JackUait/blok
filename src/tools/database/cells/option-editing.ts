import { IconCheck, IconEmojiFlag, IconTrash } from '../../../components/icons';
import { getTabbables } from '../../../components/utils/modal-dialog';
import { DatabaseModel } from '../database-model';
import { statusGroupOf } from '../property-values';
import type { PropertyDefinition, SelectOption } from '../types';
import { OPTION_COLORS, optionColorLabelKey, optionColorOf } from './option-colors';
import type { OptionColor } from './option-colors';

type Translate = (key: string) => string;

/**
 * The "⋯" panel of one option: name field, Delete, then the 10 colors.
 * Shared by the select editor and the property menu's options list.
 */
export const buildOptionPanel = (option: SelectOption, handlers: {
  t: Translate;
  onRename: (label: string) => void;
  onRecolor: (color: OptionColor) => void;
  onDelete: () => void;
  /** A status option: with no colour, no colour row is checked (research/30 §10f). */
  status?: boolean;
  /** Status in Edit property: "Set as default" after Delete (research/30 §10f, shot 23). */
  onSetDefault?: () => void;
}): { panel: HTMLElement; name: HTMLInputElement } => {
  const { t } = handlers;
  const panel = document.createElement('div');
  const name = document.createElement('input');

  panel.setAttribute('data-blok-database-option-panel', option.id);
  name.type = 'text';
  name.value = option.label;
  name.setAttribute('data-blok-database-option-name', '');
  name.setAttribute('aria-label', t('tools.database.optionName'));
  const rename = (): void => {
    const label = name.value.trim();

    if (label !== '' && label !== option.label) {
      handlers.onRename(label);
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
  del.append(t('tools.database.optionDelete'));
  del.addEventListener('click', handlers.onDelete);
  const setDefault = document.createElement('button');

  setDefault.type = 'button';
  setDefault.setAttribute('data-blok-database-option-set-default', '');
  setDefault.innerHTML = IconEmojiFlag;
  setDefault.append(t('tools.database.templateSetDefault'));
  setDefault.addEventListener('click', () => handlers.onSetDefault?.());

  const heading = document.createElement('div');

  heading.setAttribute('data-blok-database-option-colors-heading', '');
  heading.textContent = t('tools.database.optionColors');

  const colors = document.createElement('div');

  colors.setAttribute('role', 'menu');
  colors.setAttribute('aria-label', t('tools.database.optionColors'));
  const current = handlers.status === true && option.color === undefined ? null : optionColorOf(option);

  for (const color of OPTION_COLORS) {
    const item = document.createElement('button');

    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(color === current));
    item.setAttribute('data-blok-database-option-color', color);

    const swatch = document.createElement('span');

    swatch.setAttribute('data-blok-database-option-swatch', '');
    swatch.setAttribute('data-color', color);
    item.append(swatch, t(optionColorLabelKey(color)));
    if (color === current) {
      const check = document.createElement('span');

      check.setAttribute('data-blok-database-select-option-check', '');
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = IconCheck;
      item.appendChild(check);
    }
    item.addEventListener('click', () => handlers.onRecolor(color));
    colors.appendChild(item);
  }

  panel.append(name, del, ...(handlers.onSetDefault === undefined ? [] : [setDefault]), heading, colors);

  return { panel, name };
};

/** Notion asks before deleting an option (research/08); rows keep existing, the value is cleared. */
export const buildDeletePrompt = (handlers: { t: Translate; onConfirm: () => void; onCancel: () => void }): { prompt: HTMLElement; confirm: HTMLButtonElement } => {
  const { t } = handlers;
  const prompt = document.createElement('div');
  const text = document.createElement('p');
  const confirm = document.createElement('button');
  const cancel = document.createElement('button');

  prompt.setAttribute('data-blok-database-option-delete-prompt', '');
  prompt.setAttribute('role', 'alertdialog');
  prompt.setAttribute('aria-modal', 'true');
  text.textContent = t('tools.database.optionDeleteConfirm');
  prompt.setAttribute('aria-label', text.textContent);
  confirm.type = 'button';
  confirm.setAttribute('data-blok-database-option-delete-confirm', '');
  confirm.textContent = t('tools.database.optionDelete');
  cancel.type = 'button';
  cancel.setAttribute('data-blok-database-option-delete-cancel', '');
  cancel.textContent = t('tools.database.optionDeleteCancel');
  confirm.addEventListener('click', handlers.onConfirm);
  cancel.addEventListener('click', handlers.onCancel);
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

  return { prompt, confirm };
};

/**
 * Where a dragged option lands. `others` is the shown order without it.
 * A status option joins the group of the row above the drop (or below, at
 * the top), and its position is taken from neighbours in that group only.
 */
export const placeDroppedOption = (property: PropertyDefinition, others: SelectOption[], index: number, dragged: SelectOption): SelectOption => {
  const after = others[index - 1];
  const before = others[index];

  if (property.type !== 'status') {
    return { ...dragged, position: DatabaseModel.positionBetween(after?.position ?? null, before?.position ?? null) };
  }
  const anchor = after ?? before;
  const groupId = anchor === undefined ? dragged.groupId : statusGroupOf(property, anchor.id)?.id;
  const inGroup = (option: SelectOption | undefined): SelectOption | undefined =>
    option !== undefined && statusGroupOf(property, option.id)?.id === groupId ? option : undefined;

  return {
    ...dragged,
    ...(groupId !== undefined ? { groupId } : {}),
    position: DatabaseModel.positionBetween(inGroup(after)?.position ?? null, inGroup(before)?.position ?? null),
  };
};

interface DragState {
  id: string;
  others: SelectOption[];
  index: number;
  moved: boolean;
}

/** Drag ⋮⋮ to reorder option rows (`[data-blok-database-select-option]`) inside `body`. */
export class OptionDrag {
  private drag: DragState | null = null;

  constructor(
    private readonly body: HTMLElement,
    private readonly shown: () => SelectOption[],
    private readonly onDrop: (id: string, others: SelectOption[], index: number) => void,
    private readonly onEnd: () => void
  ) {}

  start(event: PointerEvent, id: string): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const options = this.shown();

    this.drag = { id, others: options.filter((option) => option.id !== id), index: options.findIndex((option) => option.id === id), moved: false };
    this.row(id)?.setAttribute('data-dragging', '');
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleEnd);
    document.addEventListener('pointercancel', this.handleCancel);
  }

  stop(): void {
    this.drag = null;
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleEnd);
    document.removeEventListener('pointercancel', this.handleCancel);
  }

  private row(id: string): Element | null {
    return this.body.querySelector(`[data-blok-database-select-option="${CSS.escape(id)}"]`);
  }

  private readonly handleMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }
    drag.moved = true;
    drag.index = drag.others.filter((option) => {
      const rect = this.row(option.id)?.getBoundingClientRect();

      return rect !== undefined && rect.top + rect.height / 2 < event.clientY;
    }).length;
    this.body.querySelectorAll('[data-drop-before], [data-drop-after]').forEach((row) => {
      row.removeAttribute('data-drop-before');
      row.removeAttribute('data-drop-after');
    });
    const before = drag.others[drag.index];
    const after = drag.others[drag.index - 1];

    if (before !== undefined) {
      this.row(before.id)?.setAttribute('data-drop-before', '');
    } else if (after !== undefined) {
      this.row(after.id)?.setAttribute('data-drop-after', '');
    }
  };

  private readonly handleEnd = (): void => {
    const drag = this.drag;

    this.stop();
    const unmoved = drag === null || !drag.moved || this.shown().findIndex((option) => option.id === drag.id) === drag.index;

    if (drag !== null && !unmoved) {
      this.onDrop(drag.id, drag.others, drag.index);
    }
    this.onEnd();
  };

  private readonly handleCancel = (): void => {
    this.stop();
    this.onEnd();
  };
}
