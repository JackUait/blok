import { IconArrowDiagonal, IconArrowLeftSmall, IconCheck, IconChevronLeft, IconChevronRight, IconCross, IconMenu } from '../../components/icons';
import { CellPopover } from './cells/cell-popover';
import { hide as hideTooltip } from '../../components/utils/tooltip';

/**
 * One screen of a paged panel. `build` runs again on every refresh, so it
 * reads live state instead of capturing it.
 */
export interface PanelPage {
  title?: string;
  /** Draws the title as a small secondary label, like Notion's root "View settings" (research/26 §1a). */
  titleIsLabel?: boolean;
  /** A control at the header's end, built on every render. */
  headerAction?: (panel: DatabasePanel) => HTMLElement;
  /** `data-blok-testid` of the control that opened this page; leaving the page focuses it again. */
  returnFocus?: string;
  build: (panel: DatabasePanel) => HTMLElement[];
}

export interface DatabasePanelOptions {
  anchor: HTMLElement;
  root: PanelPage;
  /** `data-blok-testid` of the panel. */
  testId: string;
  /** Measured widths: 290 for view settings, 220 for a filter (research/08). */
  width: number;
  /** The back button's accessible name. */
  backLabel: string;
  /** Docks at the window's end edge (view settings, research/26 §1a). */
  docked?: boolean;
  /** With `docked`: every sub-page header ends in a × with this name (findings V25). */
  closeLabel?: string;
  /** `escape` is true when Escape closed the first page. */
  onClose?: (escape: boolean) => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/**
 * A popover that pages forward and back like Notion's view settings: a row
 * with a chevron pushes a page, the header's back button or Escape pops it,
 * and Escape on the first page closes. The panel owns its keys.
 */
export class DatabasePanel {
  private readonly options: DatabasePanelOptions;
  private readonly element: HTMLElement;
  private readonly popover: CellPopover;
  private readonly stack: PanelPage[];
  private closed = false;

  constructor(options: DatabasePanelOptions) {
    this.options = options;
    this.stack = [options.root];
    this.element = document.createElement('div');
    this.element.setAttribute('data-blok-database-panel', '');
    this.element.setAttribute('data-blok-testid', options.testId);
    this.element.style.width = `${options.width}px`;
    if (options.docked === true) this.element.setAttribute('data-docked', '');
    this.element.addEventListener('keydown', this.handleKeydown);
    this.popover = new CellPopover({
      anchor: options.anchor,
      content: this.element,
      ...(options.docked === true ? { docked: true } : {}),
      onEscape: () => this.back(true),
      onDismiss: () => this.finish(),
    });
  }

  get depth(): number {
    return this.stack.length;
  }

  get root(): HTMLElement {
    return this.element;
  }

  open(): void {
    this.render();
    this.popover.show();
    this.focusFirst();
  }

  push(page: PanelPage): void {
    this.stack.push(page);
    this.render();
    this.focusFirst();
  }

  /** Steps back a page, or closes on the first one. */
  back(escape = false): void {
    if (this.stack.length <= 1) {
      this.close(escape);

      return;
    }
    const left = this.stack.pop();

    this.render();
    const opener = left?.returnFocus === undefined
      ? null
      : this.element.querySelector<HTMLElement>(`[data-blok-testid="${CSS.escape(left.returnFocus)}"]`);

    if (opener === null) {
      this.focusFirst();
    } else {
      opener.focus();
    }
  }

  /** Rebuilds the current page, keeping focus on the same control when it still exists. */
  refresh(): void {
    if (this.closed) return;
    const focusKey = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-blok-testid')
      : null;

    this.render();
    if (focusKey !== null) {
      this.element.querySelector<HTMLElement>(`[data-blok-testid="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  close(escape = false): void {
    if (this.closed) return;
    this.popover.close();
    this.finish(escape);
  }

  private finish(escape = false): void {
    if (this.closed) return;
    this.closed = true;
    this.options.onClose?.(escape);
  }

  private render(): void {
    const page = this.stack[this.stack.length - 1];

    // The page's hint triggers are replaced, so no mouseleave would hide a shown hint.
    hideTooltip();
    const children: HTMLElement[] = [];

    if (this.stack.length > 1 || page.title !== undefined) {
      children.push(this.header(page.title ?? '', page.headerAction?.(this), page.titleIsLabel === true));
    }
    children.push(...page.build(this));
    this.element.replaceChildren(...children);
  }

  private header(title: string, action: HTMLElement | undefined, isLabel: boolean): HTMLElement {
    const header = document.createElement('div');

    header.setAttribute('data-blok-database-panel-header', isLabel ? 'label' : '');
    if (this.stack.length > 1) {
      const back = document.createElement('button');

      back.type = 'button';
      back.setAttribute('data-blok-database-panel-back', '');
      back.setAttribute('data-blok-testid', 'database-panel-back');
      back.setAttribute('aria-label', this.options.backLabel);
      // 11-notion-layout.png: the docked view settings goes back with a left arrow.
      back.innerHTML = this.options.docked === true ? IconArrowLeftSmall : IconChevronLeft;
      back.addEventListener('click', () => this.back());
      header.appendChild(back);
    }
    const label = document.createElement('span');

    label.textContent = title;
    header.appendChild(label);
    if (action !== undefined) header.appendChild(action);
    const closeLabel = this.options.closeLabel;

    if (action === undefined && this.stack.length > 1 && this.options.docked === true && closeLabel !== undefined) {
      header.appendChild(panelCloseButton(this, closeLabel));
    }

    return header;
  }

  private focusFirst(): void {
    const preferred = this.element.querySelector<HTMLElement>('[autofocus]');

    if (preferred !== null) {
      preferred.focus();

      return;
    }
    // The header × never takes first focus: opening lands on the first row.
    this.element.querySelector<HTMLElement>(`[data-blok-database-panel-row]:not([disabled]), :is(${FOCUSABLE}):not([data-blok-database-panel-close])`)?.focus();
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const items = [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];

    event.preventDefault();
    next?.focus();
  };
}

// ─── Row builders ───

/** Notion's round header × (research/26 §1b): closes the panel, as Escape does on the first page. No hint. */
export const panelCloseButton = (panel: DatabasePanel, label: string): HTMLButtonElement => {
  const close = document.createElement('button');

  close.type = 'button';
  close.setAttribute('data-blok-database-panel-close', '');
  close.setAttribute('data-blok-testid', 'database-panel-close');
  close.setAttribute('aria-label', label);
  close.innerHTML = IconCross;
  close.addEventListener('click', () => panel.close());

  return close;
};

export interface PanelRowOptions {
  label: string;
  testId: string;
  icon?: string;
  /** A gray line under the label. */
  description?: string;
  /** Gray text on the right (research/08: rgb(161,158,153)). */
  value?: string;
  /** Shows a chevron: the row opens a page. */
  opensPage?: boolean;
  /** Shows a diagonal arrow: the row leaves this app (research/26 §3d). */
  external?: boolean;
  /** A checkmark marks the chosen option, never a fill (no-blue law). */
  checked?: boolean;
  danger?: boolean;
  /** Secondary ink, as Notion's "Add sort" and "Delete sort" (research/21 §1c). */
  muted?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export const panelRow = (options: PanelRowOptions): HTMLButtonElement => {
  const row = document.createElement('button');

  row.type = 'button';
  row.setAttribute('data-blok-database-panel-row', '');
  row.setAttribute('data-blok-testid', options.testId);
  row.disabled = options.disabled === true;
  if (options.danger === true) row.setAttribute('data-danger', '');
  if (options.muted === true) row.setAttribute('data-muted', '');
  if (options.checked !== undefined) {
    row.setAttribute('role', 'menuitemradio');
    row.setAttribute('aria-checked', String(options.checked));
  }
  if (options.icon !== undefined) {
    const icon = document.createElement('span');

    icon.setAttribute('data-blok-database-panel-icon', '');
    icon.innerHTML = options.icon;
    row.appendChild(icon);
  }
  const label = document.createElement('span');

  label.setAttribute('data-blok-database-panel-label', '');
  label.textContent = options.label;
  if (options.description === undefined) {
    row.appendChild(label);
  } else {
    const text = document.createElement('span');
    const description = document.createElement('span');

    text.setAttribute('data-blok-database-panel-text', '');
    description.setAttribute('data-blok-database-panel-description', '');
    description.textContent = options.description;
    text.append(label, description);
    row.appendChild(text);
  }
  if (options.value !== undefined) {
    const value = document.createElement('span');

    value.setAttribute('data-blok-database-panel-value', '');
    value.textContent = options.value;
    row.appendChild(value);
  }
  if (options.checked === true) {
    const check = document.createElement('span');

    check.setAttribute('data-blok-database-panel-check', '');
    check.innerHTML = IconCheck;
    row.appendChild(check);
  }
  if (options.opensPage === true) {
    const chevron = document.createElement('span');

    chevron.setAttribute('data-blok-database-panel-chevron', '');
    chevron.innerHTML = IconChevronRight;
    row.appendChild(chevron);
  }
  if (options.external === true) {
    const arrow = document.createElement('span');

    arrow.setAttribute('data-blok-database-panel-external', '');
    arrow.innerHTML = IconArrowDiagonal;
    row.appendChild(arrow);
  }
  row.addEventListener('click', () => options.onClick());

  return row;
};

export const panelSwitch = (options: { label: string; testId: string; checked: boolean; icon?: string; disabled?: boolean; onToggle: (next: boolean) => void }): HTMLButtonElement => {
  const button = document.createElement('button');
  const track = document.createElement('span');

  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(options.checked));
  button.setAttribute('data-blok-database-panel-row', '');
  button.setAttribute('data-blok-database-panel-switch', '');
  button.setAttribute('data-blok-testid', options.testId);
  button.disabled = options.disabled === true;
  const knob = document.createElement('span');

  track.setAttribute('data-blok-database-switch-track', '');
  knob.setAttribute('data-blok-database-switch-knob', '');
  track.appendChild(knob);

  const label = document.createElement('span');

  label.setAttribute('data-blok-database-panel-label', '');
  label.textContent = options.label;
  if (options.icon !== undefined) {
    const icon = document.createElement('span');

    icon.setAttribute('data-blok-database-panel-icon', '');
    icon.innerHTML = options.icon;
    button.appendChild(icon);
  }
  button.append(label, track);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';

    button.setAttribute('aria-checked', String(next));
    options.onToggle(next);
  });

  return button;
};

export const panelLabel = (text: string): HTMLElement => {
  const label = document.createElement('div');

  label.setAttribute('data-blok-database-panel-section', '');
  label.textContent = text;

  return label;
};

export const panelText = (text: string): HTMLElement => {
  const note = document.createElement('div');

  note.setAttribute('data-blok-database-panel-note', '');
  note.textContent = text;

  return note;
};

export const panelSeparator = (): HTMLElement => {
  const line = document.createElement('div');

  line.setAttribute('data-blok-database-panel-separator', '');
  line.setAttribute('aria-hidden', 'true');

  return line;
};

export const panelInput = (options: {
  value: string;
  placeholder: string;
  testId: string;
  label: string;
  onInput: (value: string) => void;
}): HTMLInputElement => {
  const input = document.createElement('input');

  input.type = 'text';
  input.value = options.value;
  input.placeholder = options.placeholder;
  input.setAttribute('aria-label', options.label);
  input.setAttribute('data-blok-database-panel-input', '');
  input.setAttribute('data-blok-testid', options.testId);
  input.addEventListener('input', () => options.onInput(input.value));

  return input;
};

/**
 * A list whose rows reorder by dragging their ⋮⋮ handle, or with Alt+Arrow
 * keys on the handle. `onMove(id, beforeId)` gets `null` for "to the end".
 */
export const panelReorderList = (options: {
  testId: string;
  items: Array<{ id: string; element: HTMLElement }>;
  handleLabel: string;
  onMove: (id: string, beforeId: string | null) => void;
}): HTMLElement => {
  const list = document.createElement('div');

  list.setAttribute('data-blok-database-panel-list', '');
  list.setAttribute('data-blok-testid', options.testId);

  const ids = options.items.map((item) => item.id);
  const moveBy = (id: string, delta: number): void => {
    const from = ids.indexOf(id);
    const to = from + delta;

    if (to < 0 || to >= ids.length) return;
    const rest = ids.filter((other) => other !== id);

    options.onMove(id, rest[to] ?? null);
  };

  for (const { id, element } of options.items) {
    const row = document.createElement('div');
    const handle = document.createElement('button');

    row.setAttribute('data-blok-database-panel-list-item', '');
    row.setAttribute('data-item-id', id);
    handle.type = 'button';
    handle.setAttribute('data-blok-database-panel-handle', '');
    handle.setAttribute('data-blok-testid', `${options.testId}-handle-${id}`);
    handle.setAttribute('aria-label', options.handleLabel);
    handle.innerHTML = IconMenu;
    handle.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      event.stopPropagation();
      moveBy(id, event.key === 'ArrowUp' ? -1 : 1);
    });
    handle.addEventListener('pointerdown', (event) => startDrag(event, list, id, options.onMove));
    row.append(handle, element);
    list.appendChild(row);
  }

  return list;
};

/** Notion starts a list drag somewhere in 10–19px (r35:509, not narrowed). */
const DRAG_THRESHOLD = 12;

/**
 * Pointer drag inside one list, as Notion's sort list (r35:497-509): past the
 * threshold the row follows the pointer, clamped to the list ends. A neighbour
 * jumps one slot, with no motion, once the row's leading edge passes its middle.
 * Release commits the order shown.
 */
const startDrag = (
  event: PointerEvent,
  list: HTMLElement,
  id: string,
  onMove: (id: string, beforeId: string | null) => void
): void => {
  if (event.button !== 0) return;
  event.preventDefault();
  const rows = [...list.querySelectorAll<HTMLElement>('[data-blok-database-panel-list-item]')];
  const from = rows.findIndex((row) => row.getAttribute('data-item-id') === id);
  const source = rows[from];

  if (source === undefined) return;
  const startY = event.clientY;
  // Read once: the inline tops written below move these boxes. A passed row
  // jumps by the dragged row's height plus the gap.
  const rects = rows.map((row) => row.getBoundingClientRect());
  const self = rects[from];
  const pitchUp = from > 0 ? self.bottom - rects[from - 1].bottom : 0;
  const pitchDown = from < rows.length - 1 ? rects[from + 1].top - self.top : 0;
  const minOffset = rects[0].top - self.top;
  const maxOffset = rects[rects.length - 1].bottom - self.bottom;
  const state = { dragging: false, slot: from };

  const clear = (): void => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', clear);
    source.removeAttribute('data-dragging');
    for (const row of rows) {
      row.style.position = '';
      row.style.top = '';
    }
  };
  const move = (moveEvent: PointerEvent): void => {
    const delta = moveEvent.clientY - startY;

    if (!state.dragging) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      state.dragging = true;
      source.setAttribute('data-dragging', '');
      for (const row of rows) row.style.position = 'relative';
    }
    const offset = Math.min(maxOffset, Math.max(minOffset, delta));
    const top = self.top + offset;
    const bottom = self.bottom + offset;

    source.style.top = `${offset}px`;
    state.slot = from;
    for (const [index, row] of rows.entries()) {
      const middle = rects[index].top + rects[index].height / 2;
      const passedAbove = index < from && top < middle;
      const passedBelow = index > from && bottom > middle;
      const shift = (passedAbove ? pitchUp : 0) - (passedBelow ? pitchDown : 0);

      state.slot += (passedBelow ? 1 : 0) - (passedAbove ? 1 : 0);
      if (index !== from) row.style.top = shift === 0 ? '' : `${shift}px`;
    }
  };
  const up = (): void => {
    clear();
    if (!state.dragging || state.slot === from) return;
    const rest = rows.filter((row) => row !== source);

    onMove(id, rest[state.slot]?.getAttribute('data-item-id') ?? null);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', clear);
};
