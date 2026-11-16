import type { AutoScroll } from '../../components/modules/drag/utils/AutoScroll';
import { mountGhost } from './copy-ghost-radius';
import { createDatabaseAutoScroll, listAutoScrollSpeed } from './database-auto-scroll';

const DRAG_THRESHOLD = 10;
const LINE = 4;
const CARD = '[data-blok-database-form-question]';

/**
 * Drags a form builder card to another gap (notion-motion.md Round 52 §3). While it drags,
 * every gap that would move the card shows a faint line; the two beside it show none.
 * The lines are fixed on the page, as the drop line is, so the block never changes.
 */
export class DatabaseFormQuestionDrag {
  private card: HTMLElement | null = null;
  private startY = 0;
  private grabX = 0;
  private grabY = 0;
  private ghost: HTMLElement | null = null;
  private dragging = false;
  private zones: HTMLElement[] = [];
  private autoScroll: AutoScroll | null = null;
  private lastY = 0;

  constructor(
    private readonly form: HTMLElement,
    private readonly onDrop: (id: string, beforeId: string | null) => void,
  ) {}

  begin(card: HTMLElement, event: PointerEvent): void {
    this.cleanup();
    this.card = card;
    this.startY = event.clientY;
    const box = card.getBoundingClientRect();

    this.grabX = event.clientX - box.left;
    this.grabY = event.clientY - box.top;
    document.addEventListener('pointermove', this.move);
    document.addEventListener('pointerup', this.up);
    document.addEventListener('pointercancel', this.cleanup);
    document.addEventListener('keydown', this.key);
  }

  readonly cleanup = (): void => {
    document.removeEventListener('pointermove', this.move);
    document.removeEventListener('pointerup', this.up);
    document.removeEventListener('pointercancel', this.cleanup);
    document.removeEventListener('keydown', this.key);
    this.autoScroll?.destroy();
    this.autoScroll = null;
    this.zones.forEach((zone) => zone.remove());
    this.zones = [];
    this.ghost?.remove();
    this.ghost = null;
    this.card?.removeAttribute('data-blok-database-drag-source');
    this.card = null;
    this.dragging = false;
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.cleanup();
  };

  private readonly move = (event: PointerEvent): void => {
    if (!this.dragging && Math.abs(event.clientY - this.startY) > DRAG_THRESHOLD) {
      this.dragging = true;
      this.ghost = this.card === null ? null : this.createGhost(this.card);
      // database.css hides the gap "+" while a card drags over it.
      this.card?.setAttribute('data-blok-database-drag-source', '');
      this.autoScroll = createDatabaseAutoScroll(this.card ?? this.form, 'y', listAutoScrollSpeed, () => this.paint(this.lastY));
    }
    if (!this.dragging) return;
    this.lastY = event.clientY;
    if (this.ghost !== null) {
      this.ghost.style.left = `${event.clientX - this.grabX}px`;
      this.ghost.style.top = `${event.clientY - this.grabY}px`;
    }
    this.paint(event.clientY);
    this.autoScroll?.start(event.clientY);
  };

  private readonly up = (event: PointerEvent): void => {
    const id = this.card?.getAttribute('data-blok-database-form-question') ?? null;
    const drop = this.dragging ? this.target(event.clientY) : null;

    this.cleanup();
    if (id !== null && drop !== null && !drop.adjacent) this.onDrop(id, drop.beforeId);
  };

  /** notion-motion.md Round 53 (b): a copy of the card at 0.18, no shadow, keeping the grab offset. */
  private createGhost(card: HTMLElement): HTMLElement {
    const box = card.getBoundingClientRect();
    const ghost = document.createElement('div');
    const copy = card.cloneNode(true) as HTMLElement;
    const fields = card.querySelectorAll<HTMLInputElement>('input, textarea');

    // cloneNode keeps the attributes, not what was typed or ticked.
    const copies = copy.querySelectorAll<HTMLInputElement>('input, textarea');

    fields.forEach((field, index) => {
      Object.assign(copies[index], { value: field.value, checked: field.checked });
    });
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    ghost.appendChild(copy);
    ghost.setAttribute('data-blok-database-ghost', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: 'fixed',
      pointerEvents: 'none',
      opacity: '0.18',
      zIndex: '50',
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    mountGhost(card, ghost);

    return ghost;
  }

  private cards(): HTMLElement[] {
    return [...this.form.querySelectorAll<HTMLElement>(CARD)];
  }

  /** The gap before the first card whose middle is under the pointer; the end past them all. */
  private target(y: number): { index: number; beforeId: string | null; adjacent: boolean } {
    const cards = this.cards();
    const source = this.card === null ? -1 : cards.indexOf(this.card);
    const found = cards.findIndex((card, index) => {
      const rect = card.getBoundingClientRect();

      return index !== source && y < rect.top + rect.height / 2;
    });
    const index = found === -1 ? cards.length : found;

    return {
      index,
      beforeId: cards[index]?.getAttribute('data-blok-database-form-question') ?? null,
      adjacent: index === source || index === source + 1,
    };
  }

  /** One line per gap, the ends included: gap i sits above card i. */
  private paint(y: number): void {
    const cards = this.cards();
    const source = this.card === null ? -1 : cards.indexOf(this.card);
    const target = this.target(y);
    const rects = cards.map((card) => card.getBoundingClientRect());
    const first = rects[0];
    const last = rects[rects.length - 1];

    if (first === undefined || last === undefined) return;
    // The ends sit as far out as the gap between two cards.
    const half = rects.length > 1 ? (rects[1].top - first.bottom) / 2 : 0;
    const centres = [
      first.top - half,
      ...rects.slice(1).map((rect, index) => (rects[index].bottom + rect.top) / 2),
      last.bottom + half,
    ];

    while (this.zones.length < centres.length) this.zones.push(this.zone());
    centres.forEach((centre, index) => {
      const zone = this.zones[index];

      zone.style.left = `${first.left}px`;
      zone.style.top = `${centre - LINE / 2}px`;
      zone.style.width = `${first.width}px`;
      zone.style.height = `${LINE}px`;
      zone.toggleAttribute('data-adjacent', index === source || index === source + 1);
      zone.toggleAttribute('data-target', index === target.index && !target.adjacent);
    });
  }

  private zone(): HTMLElement {
    const zone = document.createElement('div');
    // The line mounts on <body>, outside the editor's token scope.
    const style = getComputedStyle(this.form);
    const color = style.getPropertyValue('--blok-database-drop-line').trim();
    const radius = style.getPropertyValue('--blok-radius-pill').trim();

    // Scopes Blok's base styles to a line that lives outside the editor.
    zone.setAttribute('data-blok-interface', 'form-drop-zone');
    zone.setAttribute('data-blok-database-form-drop-zone', '');
    zone.setAttribute('aria-hidden', 'true');
    zone.style.position = 'fixed';
    zone.style.pointerEvents = 'none';
    if (color !== '') zone.style.backgroundColor = color;
    if (radius !== '') zone.style.borderRadius = radius;
    document.body.appendChild(zone);

    return zone;
  }
}
