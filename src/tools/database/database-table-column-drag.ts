import { copyGhostContext, mountGhost } from './copy-ghost-radius';
import type { TableState } from './database-table-grid';

const THRESHOLD = 5;

export interface TableColumnDragOptions {
  grid: HTMLElement;
  state: TableState;
  /** `beforeId` is the column now after the moved one, or null for the end. */
  onDrop: (propertyId: string, beforeId: string | null) => void;
}

/**
 * Column reorder by dragging a header left or right, Notion's model
 * (notion-motion.md "Column header drag"): a pressed-fill copy of the header
 * follows the pointer, its slot stays empty, and the headers between it and
 * the pointer slide aside. Body cells stay put until the drop. A press that
 * never moves stays a click, which opens the header menu.
 */
export class DatabaseTableColumnDrag {
  private readonly grid: HTMLElement;
  private readonly state: TableState;
  private readonly onDrop: (propertyId: string, beforeId: string | null) => void;
  private press: { header: HTMLElement; x: number; y: number; offsetX: number } | null = null;
  private ghost: HTMLElement | null = null;
  /** Header boxes at the start: the slid headers' live boxes would move the target under the pointer. */
  private slots: Array<{ el: HTMLElement; rect: DOMRect }> = [];
  private beforeId: string | null | undefined = undefined;

  constructor(options: TableColumnDragOptions) {
    this.grid = options.grid;
    this.state = options.state;
    this.onDrop = options.onDrop;
    this.grid.addEventListener('pointerdown', this.handleDown);
  }

  destroy(): void {
    this.grid.removeEventListener('pointerdown', this.handleDown);
    this.stop();
    disarm();
  }

  /** The pressed header's own row: a grouped table repeats the header row per group. */
  private headers(): HTMLElement[] {
    const row = this.press?.header.parentElement ?? this.grid;

    return [...row.querySelectorAll<HTMLElement>(':scope > [data-blok-database-table-column-header]')];
  }

  private readonly handleDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest<HTMLElement>('[data-blok-database-table-column-header]');

    if (header === null || header === undefined || target?.closest('[data-blok-database-table-resize]') !== null || event.button !== 0) {
      return;
    }
    this.press = { header, x: event.clientX, y: event.clientY, offsetX: event.clientX - header.getBoundingClientRect().left };
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleUp);
    document.addEventListener('pointercancel', this.handleCancel);
  };

  private readonly handleMove = (event: PointerEvent): void => {
    const press = this.press;

    if (press === null) {
      return;
    }
    if (this.ghost === null) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) {
        return;
      }
      this.start(press.header);
    }
    event.preventDefault();
    if (this.ghost !== null) {
      this.ghost.style.left = `${event.clientX - press.offsetX}px`;
    }
    this.track(event.clientX);
  };

  private start(header: HTMLElement): void {
    const rect = header.getBoundingClientRect();
    const ghost = header.cloneNode(true) as HTMLElement;

    ghost.removeAttribute('data-blok-database-table-column-header');
    ghost.removeAttribute('role');
    ghost.setAttribute('data-blok-database-table-column-ghost', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    copyGhostContext(header, this.grid, ghost, { attributes: ['data-vertical-lines'] });
    mountGhost(header, ghost);
    this.ghost = ghost;
    this.slots = this.headers().map((el) => ({ el, rect: el.getBoundingClientRect() }));
    // Capture: the drag's Escape must not also reach Blok's own Escape handling.
    document.addEventListener('keydown', this.handleKey, true);
    header.setAttribute('data-dragging', '');
    this.grid.setAttribute('data-column-dragging', '');
    this.state.busy = true;
  }

  private track(clientX: number): void {
    const source = this.press?.header;
    const sourceIndex = this.slots.findIndex((slot) => slot.el === source);
    const others = this.slots.filter((slot) => slot.el !== source);
    const rtl = getComputedStyle(this.grid).direction === 'rtl';
    const found = others.findIndex(({ rect }) => {
      const mid = rect.left + rect.width / 2;

      return rtl ? clientX > mid : clientX < mid;
    });
    const target = found === -1 ? others.length : found;
    const width = this.slots[sourceIndex]?.rect.width ?? 0;

    this.beforeId = others[target]?.el.getAttribute('data-property-id') ?? null;
    others.forEach(({ el }, index) => {
      // A header before the source moves one slot toward the end when the target is at or before it; one after moves back when the target is past it.
      const shift = (index < sourceIndex && index >= target ? 1 : 0) - (index >= sourceIndex && index < target ? 1 : 0);

      el.style.setProperty('transform', shift === 0 ? '' : `translateX(${shift * width * (rtl ? -1 : 1)}px)`);
    });
  }

  private readonly handleUp = (): void => {
    const press = this.press;
    const dragged = this.ghost !== null;
    const beforeId = this.beforeId;

    this.stop();
    if (!dragged || press === null || beforeId === undefined) {
      return;
    }
    // A drag is not a click: the header must not open its menu on release.
    // On the document: the drop redraws the table, so the click lands in new DOM.
    armSwallow();

    const propertyId = press.header.getAttribute('data-property-id') ?? '';
    const headers = [...press.header.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-blok-database-table-column-header]') ?? []];
    const next = headers[headers.indexOf(press.header) + 1]?.getAttribute('data-property-id') ?? null;

    if (beforeId !== propertyId && beforeId !== next) {
      this.onDrop(propertyId, beforeId);
    }
  };

  private readonly handleCancel = (): void => {
    this.stop();
  };

  /** notion-motion.md Round 27 §3 "Column drag": Escape cancels; the release after it moves nothing and opens no menu. */
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.stop();
    document.addEventListener('pointerup', armSwallow, { capture: true, once: true });
    document.addEventListener('pointercancel', disarm, { capture: true, once: true });
  };

  private stop(): void {
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleUp);
    document.removeEventListener('pointercancel', this.handleCancel);
    document.removeEventListener('keydown', this.handleKey, true);
    this.ghost?.remove();
    // The slide transition goes first, so the headers jump back instead of sliding.
    this.grid.removeAttribute('data-column-dragging');
    this.slots.forEach(({ el }) => el.style.removeProperty('transform'));
    this.press?.header.removeAttribute('data-dragging');
    if (this.ghost !== null) {
      this.state.busy = false;
    }
    this.ghost = null;
    this.slots = [];
    this.press = null;
    this.beforeId = undefined;
  }
}

const swallow = (event: Event): void => {
  event.stopPropagation();
  event.preventDefault();
};

/** Swallows the click the current release makes, if it makes one. */
const armSwallow = (): void => {
  document.removeEventListener('pointercancel', disarm, { capture: true });
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
};

/** After Escape, a cancelled pointer makes no release: the next ordinary click must not be swallowed. */
const disarm = (): void => {
  document.removeEventListener('pointerup', armSwallow, { capture: true });
  document.removeEventListener('pointercancel', disarm, { capture: true });
};
