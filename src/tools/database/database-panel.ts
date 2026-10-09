import { IconChevronLeft, IconChevronRight, IconMenu } from '../../components/icons';
import { CellPopover } from './cells/cell-popover';

/**
 * One screen of a paged panel. `build` runs again on every refresh, so it
 * reads live state instead of capturing it.
 */
export interface PanelPage {
  title?: string;
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
  onClose?: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]';

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
    this.element.addEventListener('keydown', this.handleKeydown);
    this.popover = new CellPopover({
      anchor: options.anchor,
      content: this.element,
      onEscape: () => this.back(),
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
  back(): void {
    if (this.stack.length <= 1) {
      this.close();

      return;
    }
    this.stack.pop();
    this.render();
    this.focusFirst();
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

  close(): void {
    if (this.closed) return;
    this.popover.close();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.options.onClose?.();
  }

  private render(): void {
    const page = this.stack[this.stack.length - 1];
    const children: HTMLElement[] = [];

    if (this.stack.length > 1 || page.title !== undefined) {
      children.push(this.header(page.title ?? ''));
    }
    children.push(...page.build(this));
    this.element.replaceChildren(...children);
  }

  private header(title: string): HTMLElement {
    const header = document.createElement('div');

    header.setAttribute('data-blok-database-panel-header', '');
    if (this.stack.length > 1) {
      const back = document.createElement('button');

      back.type = 'button';
      back.setAttribute('data-blok-database-panel-back', '');
      back.setAttribute('data-blok-testid', 'database-panel-back');
      back.setAttribute('aria-label', this.options.backLabel);
      back.innerHTML = IconChevronLeft;
      back.addEventListener('click', () => this.back());
      header.appendChild(back);
    }
    const label = document.createElement('span');

    label.textContent = title;
    header.appendChild(label);

    return header;
  }

  private focusFirst(): void {
    this.element.querySelector<HTMLElement>(`[data-blok-database-panel-row]:not([disabled]), ${FOCUSABLE}`)?.focus();
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target instanceof HTMLInputElement) return;
    const items = [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];

    event.preventDefault();
    next?.focus();
  };
}

// ─── Row builders ───

export interface PanelRowOptions {
  label: string;
  testId: string;
  icon?: string;
  /** Gray text on the right (research/08: rgb(161,158,153)). */
  value?: string;
  /** Shows a chevron: the row opens a page. */
  opensPage?: boolean;
  /** A checkmark marks the chosen option, never a fill (no-blue law). */
  checked?: boolean;
  danger?: boolean;
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
  row.appendChild(label);
  if (options.value !== undefined) {
    const value = document.createElement('span');

    value.setAttribute('data-blok-database-panel-value', '');
    value.textContent = options.value;
    row.appendChild(value);
  }
  if (options.checked === true) {
    const check = document.createElement('span');

    check.setAttribute('data-blok-database-panel-check', '');
    row.appendChild(check);
  }
  if (options.opensPage === true) {
    const chevron = document.createElement('span');

    chevron.setAttribute('data-blok-database-panel-chevron', '');
    chevron.innerHTML = IconChevronRight;
    row.appendChild(chevron);
  }
  row.addEventListener('click', () => options.onClick());

  return row;
};

export const panelSwitch = (options: { label: string; testId: string; checked: boolean; disabled?: boolean; onToggle: (next: boolean) => void }): HTMLButtonElement => {
  const button = document.createElement('button');
  const track = document.createElement('span');

  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(options.checked));
  button.setAttribute('data-blok-database-panel-row', '');
  button.setAttribute('data-blok-database-panel-switch', '');
  button.setAttribute('data-blok-testid', options.testId);
  button.disabled = options.disabled === true;
  track.setAttribute('data-blok-database-switch-track', '');
  track.appendChild(document.createElement('span'));

  const label = document.createElement('span');

  label.setAttribute('data-blok-database-panel-label', '');
  label.textContent = options.label;
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
  line.setAttribute('role', 'separator');

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

/** Pointer drag inside one list: the row lands before the first row whose middle is below the pointer. */
const startDrag = (
  event: PointerEvent,
  list: HTMLElement,
  id: string,
  onMove: (id: string, beforeId: string | null) => void
): void => {
  if (event.button !== 0) return;
  event.preventDefault();
  const source = list.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);

  source?.setAttribute('data-dragging', '');

  const targetAt = (clientY: number): string | null => {
    const rows = [...list.querySelectorAll<HTMLElement>('[data-blok-database-panel-list-item]')]
      .filter((row) => row.getAttribute('data-item-id') !== id);
    const below = rows.find((row) => {
      const rect = row.getBoundingClientRect();

      return clientY < rect.top + rect.height / 2;
    });

    return below?.getAttribute('data-item-id') ?? null;
  };
  const up = (upEvent: PointerEvent): void => {
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    source?.removeAttribute('data-dragging');
    onMove(id, targetAt(upEvent.clientY));
  };
  const cancel = (): void => {
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    source?.removeAttribute('data-dragging');
  };

  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
};
