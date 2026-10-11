import { prefersReducedMotion } from '../../components/utils/reduced-motion';

/** Matches the `transition: opacity` on the line in database.css. */
export const DROP_LINE_FADE_MS = 200;

const THICKNESS = 4;

/**
 * The 4px line that marks where a dragged card, row or column will land.
 * It lives on the page, not in the board, so showing it never moves a card
 * and never mutates the block.
 */
export class DatabaseDropLine {
  private el: HTMLElement | null = null;
  /** Lines fading out, each with the timer that removes it. */
  private readonly leaving = new Map<HTMLElement, number>();

  /** @param tokenSource - an element inside the editor, where the colour token resolves */
  constructor(private readonly tokenSource?: HTMLElement) {}

  public showHorizontal({ left, centerY, width }: { left: number; centerY: number; width: number }): void {
    this.place(left, centerY - THICKNESS / 2, width, THICKNESS);
  }

  public showVertical({ centerX, top, height }: { centerX: number; top: number; height: number }): void {
    this.place(centerX - THICKNESS / 2, top, THICKNESS, height);
  }

  /** Fades the line out. Under reduced motion it goes at once. */
  public hide(): void {
    const el = this.el;

    if (el === null) {
      return;
    }
    this.el = null;

    if (prefersReducedMotion()) {
      el.remove();

      return;
    }
    el.style.opacity = '0';
    this.leaving.set(el, window.setTimeout(() => {
      el.remove();
      this.leaving.delete(el);
    }, DROP_LINE_FADE_MS));
  }

  public destroy(): void {
    this.el?.remove();
    this.el = null;
    this.leaving.forEach((timer, el) => {
      window.clearTimeout(timer);
      el.remove();
    });
    this.leaving.clear();
  }

  private place(left: number, top: number, width: number, height: number): void {
    const el = this.el ?? this.revive() ?? this.create();

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }

  /** A line still fading out comes back instead of a second line next to it. */
  private revive(): HTMLElement | null {
    const last = [...this.leaving.keys()].at(-1);

    if (last === undefined) {
      return null;
    }
    window.clearTimeout(this.leaving.get(last));
    this.leaving.delete(last);
    last.style.opacity = '';
    this.el = last;

    return last;
  }

  private create(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-database-drop-line', '');
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';

    const color = this.tokenSource === undefined
      ? ''
      : window.getComputedStyle(this.tokenSource).getPropertyValue('--blok-database-drop-line').trim();

    if (color !== '') {
      el.style.backgroundColor = color;
    }
    document.body.appendChild(el);
    this.el = el;

    return el;
  }
}
