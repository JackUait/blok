/**
 * Soft glowing outline around the active find match.
 *
 * One box per line rect rather than one union box: a match that wraps a line
 * break spans two short rects at opposite edges, and their union would cover
 * the whole paragraph between them.
 */

export interface LensRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const LENS = 'data-blok-find-lens';
const BOX = 'data-blok-find-lens-box';
const PING = 'data-blok-find-lens-ping';
const INSTANT = 'data-blok-find-lens-instant';

export class FindLens {
  private readonly container: HTMLElement;
  private root: HTMLElement | null = null;
  private boxes: HTMLElement[] = [];
  private instantFrame: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public moveTo(rects: LensRect[], options: { pulse?: boolean } = {}): void {
    if (rects.length === 0) {
      this.hide();

      return;
    }

    const root = this.ensureRoot();
    const wasHidden = root.hidden;

    // Coming back from hidden: place at once, or it would glide in from the old match.
    if (wasHidden) {
      this.setInstant(root);
    }

    root.hidden = false;

    while (this.boxes.length > rects.length) {
      this.boxes.pop()?.remove();
    }

    rects.forEach((rect, index) => {
      const box = this.boxes[index] ?? this.makeBox(root);

      box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;

      if (options.pulse === true) {
        // Remove, reflow, re-add: restarts the ping when it is already playing.
        box.removeAttribute(PING);
        void box.offsetWidth;
        box.setAttribute(PING, '');
      }
    });
  }

  public hide(): void {
    if (this.root !== null) {
      this.root.hidden = true;
    }
  }

  public destroy(): void {
    if (this.instantFrame !== null) {
      cancelAnimationFrame(this.instantFrame);
      this.instantFrame = null;
    }

    this.root?.remove();
    this.root = null;
    this.boxes = [];
  }

  private ensureRoot(): HTMLElement {
    if (this.root !== null) {
      return this.root;
    }

    const root = document.createElement('div');

    root.setAttribute(LENS, '');
    root.setAttribute('data-blok-testid', 'find-lens');
    root.setAttribute('aria-hidden', 'true');
    root.style.pointerEvents = 'none';
    root.hidden = true;
    this.container.appendChild(root);
    this.root = root;

    return root;
  }

  private makeBox(root: HTMLElement): HTMLElement {
    const box = document.createElement('div');

    box.setAttribute(BOX, '');
    box.setAttribute('data-blok-testid', 'find-lens-box');
    box.addEventListener('animationend', () => box.removeAttribute(PING));
    root.appendChild(box);
    this.boxes.push(box);

    return box;
  }

  private setInstant(root: HTMLElement): void {
    root.setAttribute(INSTANT, '');

    if (this.instantFrame !== null) {
      cancelAnimationFrame(this.instantFrame);
    }

    // Two frames: the first paints the new spot with transitions off.
    this.instantFrame = requestAnimationFrame(() => {
      this.instantFrame = requestAnimationFrame(() => {
        this.instantFrame = null;
        root.removeAttribute(INSTANT);
      });
    });
  }
}
