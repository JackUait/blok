/**
 * Thin ring around the active find match's fill.
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

/** Sub-pixel text rects of neighbouring spans can leave a hairline gap. */
const TOUCH_TOLERANCE = 1;

/**
 * Join rects on the same line that touch or overlap, so a match made of
 * several spans gets one box, not one per span.
 * @param rects - a match's line rects
 */
const joinTouching = (rects: LensRect[]): LensRect[] =>
  rects.reduce<LensRect[]>((joined, rect) => {
    const touching = joined.find((other) =>
      other.top === rect.top
      && other.height === rect.height
      && rect.left <= other.left + other.width + TOUCH_TOLERANCE
      && other.left <= rect.left + rect.width + TOUCH_TOLERANCE
    );

    if (touching === undefined) {
      return [...joined, { ...rect }];
    }

    const right = Math.max(touching.left + touching.width, rect.left + rect.width);

    touching.left = Math.min(touching.left, rect.left);
    touching.width = right - touching.left;

    return joined;
  }, []);

const LENS = 'data-blok-find-lens';
const BOX = 'data-blok-find-lens-box';
const ARRIVE = 'data-blok-find-lens-arrive';

export class FindLens {
  private readonly container: HTMLElement;
  private root: HTMLElement | null = null;
  private boxes: HTMLElement[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public moveTo(lineRects: LensRect[], options: { pulse?: boolean } = {}): void {
    const rects = joinTouching(lineRects);

    if (rects.length === 0) {
      this.hide();

      return;
    }

    const root = this.ensureRoot();

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
        // Remove, reflow, re-add: restarts the arrival when it is already playing.
        box.removeAttribute(ARRIVE);
        void box.offsetWidth;
        box.setAttribute(ARRIVE, '');
      }
    });
  }

  public hide(): void {
    if (this.root !== null) {
      this.root.hidden = true;
    }
  }

  public destroy(): void {
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
    box.addEventListener('animationend', () => box.removeAttribute(ARRIVE));
    root.appendChild(box);
    this.boxes.push(box);

    return box;
  }
}
