import { nanoid } from 'nanoid';

import { IconCheck, IconChevronRight, IconEmojiFlag, IconGroup, IconTrash } from '../../../components/icons';
import { openDatabaseConfirm } from '../database-confirm-dialog';
import type { DatabaseConfirmOptions } from '../database-confirm-dialog';
import { DatabaseModel } from '../database-model';
import { statusGroupOf } from '../property-values';
import type { PropertyDefinition, SelectOption } from '../types';
import { OPTION_COLORS, optionColorLabelKey, optionColorOf, pickOptionColor } from './option-colors';
import type { OptionColor } from './option-colors';

type Translate = (key: string) => string;

/** A new option after the last one in `options`, in the next free colour. */
export const newSelectOption = (options: SelectOption[], label: string): SelectOption => ({
  id: nanoid(),
  label,
  color: pickOptionColor(options),
  position: DatabaseModel.positionBetween(options.at(-1)?.position ?? null, null),
});

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
  /** Status in Edit property: "Group ›" with the option's group, after Set as default (notion-motion.md Round 56 §5). */
  group?: { label: string; onOpen: (row: HTMLElement) => void };
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

  const groupRows: HTMLElement[] = [];

  if (handlers.group !== undefined) {
    const { label, onOpen } = handlers.group;
    const group = document.createElement('button');
    const value = document.createElement('span');
    const chevron = document.createElement('span');

    group.type = 'button';
    group.setAttribute('data-blok-database-option-group', '');
    group.setAttribute('aria-haspopup', 'menu');
    group.setAttribute('aria-expanded', 'false');
    chevron.setAttribute('data-blok-database-option-group-chevron', '');
    group.innerHTML = IconGroup;
    value.setAttribute('data-blok-database-option-group-value', '');
    value.textContent = label;
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = IconChevronRight;
    group.append(t('tools.database.groupStatusGroup'), value, chevron);
    group.addEventListener('click', () => onOpen(group));
    groupRows.push(group);
  }

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

  panel.append(name, del, ...(handlers.onSetDefault === undefined ? [] : [setDefault]), ...groupRows, heading, colors);

  return { panel, name };
};

/**
 * The centred "delete this option?" confirm, Delete focused. The form's Delete option
 * (notion-motion.md Round 77 §4, Round 78 §2: a 600 title) and the cell editor's option
 * menu (Round 79 §4) show the same one.
 */
export const confirmOptionDelete = (
  t: Translate,
  placement: Pick<DatabaseConfirmOptions, 'directionSource' | 'signal' | 'container' | 'topLayer'>
): Promise<boolean> => openDatabaseConfirm({
  title: t('tools.database.optionDeleteConfirm'),
  confirmLabel: t('tools.database.optionDelete'),
  cancelLabel: t('tools.database.optionDeleteCancel'),
  destructive: true,
  focusConfirm: true,
  boldTitle: true,
  ...placement,
});

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
  /** The dragged row's place among `others` at pickup. */
  home: number;
  startY: number;
  /** Pickup centres of `others`, so the slides never move the drop slots. */
  centers: number[];
  /** How far a passed row slides: one row, the dragged row's height plus the list gap, even across a group heading (notion-motion.md Round 57 §4). */
  step: number;
  /** How far the dragged row may move before it leaves the list. */
  minDy: number;
  maxDy: number;
}

/** Marks the list while a row is dragged: database.css slides the rows only then. */
const REORDERING_ATTR = 'data-blok-database-option-reordering';

/**
 * Drag ⋮⋮ to reorder option rows (`[data-blok-database-select-option]`) inside `body`.
 * notion-motion.md Round 56 §7: the row follows the pointer, kept inside the list,
 * and the rows it passes slide one row over. No drop line.
 */
export class OptionDrag {
  private drag: DragState | null = null;

  constructor(
    private readonly body: HTMLElement,
    private readonly shown: () => SelectOption[],
    private readonly onDrop: (id: string, others: SelectOption[], index: number) => void,
    private readonly onEnd: () => void,
    /** The attribute that names a row's option id. */
    private readonly rowAttr = 'data-blok-database-select-option'
  ) {}

  start(event: PointerEvent, id: string): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const options = this.shown();
    const others = options.filter((option) => option.id !== id);
    const home = options.findIndex((option) => option.id === id);
    const row = this.row(id);
    const rect = row?.getBoundingClientRect();
    const rects = options.map((option) => this.row(option.id)?.getBoundingClientRect()).filter((r): r is DOMRect => r !== undefined);
    const gap = row?.parentElement === null || row?.parentElement === undefined ? 0 : Number.parseFloat(getComputedStyle(row.parentElement).rowGap) || 0;

    this.drag = {
      id,
      others,
      index: home,
      moved: false,
      home,
      startY: event.clientY,
      centers: others.map((option) => {
        const r = this.row(option.id)?.getBoundingClientRect();

        return r === undefined ? 0 : r.top + r.height / 2;
      }),
      step: (rect?.height ?? 0) + gap,
      minDy: rect === undefined ? 0 : Math.min(0, ...rects.map((r) => r.top - rect.top)),
      maxDy: rect === undefined ? 0 : Math.max(0, ...rects.map((r) => r.bottom - rect.bottom)),
    };
    row?.setAttribute('data-dragging', '');
    this.body.setAttribute(REORDERING_ATTR, '');
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleEnd);
    document.addEventListener('pointercancel', this.handleCancel);
  }

  stop(): void {
    const drag = this.drag;

    this.drag = null;
    // The flag goes first, so the rows jump back instead of sliding.
    this.body.removeAttribute(REORDERING_ATTR);
    if (drag !== null) {
      [drag.id, ...drag.others.map((option) => option.id)].forEach((id) => {
        const row = this.row(id);

        row?.removeAttribute('data-dragging');
        if (row instanceof HTMLElement) row.style.transform = '';
      });
    }
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleEnd);
    document.removeEventListener('pointercancel', this.handleCancel);
  }

  private row(id: string): HTMLElement | null {
    return this.body.querySelector<HTMLElement>(`[${this.rowAttr}="${CSS.escape(id)}"]`);
  }

  private readonly handleMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }
    drag.moved = true;
    drag.index = drag.centers.filter((center) => center < event.clientY).length;
    const dy = Math.min(drag.maxDy, Math.max(drag.minDy, event.clientY - drag.startY));
    const dragged = this.row(drag.id);

    if (dragged !== null) dragged.style.transform = `translateY(${dy}px)`;
    drag.others.forEach((option, index) => {
      const row = this.row(option.id);
      const down = index < drag.home && index >= drag.index;
      const up = index >= drag.home && index < drag.index;

      if (row !== null) row.style.transform = down || up ? `translateY(${down ? drag.step : -drag.step}px)` : '';
    });
  };

  private readonly handleEnd = (): void => {
    const drag = this.drag;

    this.stop();
    const unmoved = drag === null || !drag.moved || drag.home === drag.index;

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
