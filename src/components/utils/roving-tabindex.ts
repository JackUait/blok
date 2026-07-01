/**
 * Roving tabindex controller.
 *
 * Manages a group of elements where at most one is a tab stop (`tabindex="0"`)
 * and the rest are `tabindex="-1"`. Arrow keys move DOM focus between the items
 * and roll the tab stop to the focused element, so the whole group behaves as a
 * single stop in the tab order while remaining fully arrow-navigable — the
 * WAI-ARIA "roving tabindex" pattern, mirroring Radix's Toolbar / RovingFocus.
 *
 * Hidden items (`display: none`, the `hidden` attribute, or `aria-hidden`) are
 * skipped during navigation so a collapsed control never traps focus.
 *
 * When {@link RovingTabindexOptions.tabbable} is `false` the group is kept out
 * of the tab order entirely (every item stays `tabindex="-1"`). Focus is then
 * expected to be moved in programmatically (e.g. via a focus-the-toolbar
 * shortcut) rather than by pressing Tab; arrow navigation still works because
 * `tabindex="-1"` elements remain focusable via `.focus()`.
 */
export type RovingOrientation = 'horizontal' | 'vertical';

export interface RovingTabindexOptions {
  /**
   * Which arrow keys move focus. `horizontal` uses ArrowLeft/ArrowRight,
   * `vertical` uses ArrowUp/ArrowDown. Defaults to `horizontal`.
   */
  orientation?: RovingOrientation;

  /**
   * Whether focus wraps around the ends of the group. Defaults to `true`.
   */
  loop?: boolean;

  /**
   * Whether the group participates in the tab order via a single
   * `tabindex="0"` stop. When `false`, all items stay `tabindex="-1"` and the
   * group is entered programmatically. Defaults to `true`.
   */
  tabbable?: boolean;
}

/**
 * Returns whether the element is currently hidden and therefore should be
 * skipped during roving navigation.
 * @param element - candidate group item
 */
const isHidden = (element: HTMLElement): boolean => {
  return element.style.display === 'none'
    || element.hidden
    || element.getAttribute('aria-hidden') === 'true';
};

/**
 * @see module-level documentation for the roving tabindex contract.
 */
export class RovingTabindexController {
  /**
   * The managed group items, in DOM/navigation order.
   */
  private readonly items: readonly HTMLElement[];

  /**
   * Which axis the arrow keys navigate.
   */
  private readonly orientation: RovingOrientation;

  /**
   * Whether focus wraps at the ends.
   */
  private readonly loop: boolean;

  /**
   * Whether the active item is a real tab stop (`tabindex="0"`).
   */
  private readonly tabbable: boolean;

  /**
   * Bound keydown handler kept as a stable reference for add/removeEventListener.
   */
  private readonly boundKeydown: (event: KeyboardEvent) => void;

  /**
   * @param items - group elements, in navigation order
   * @param options - orientation / loop / tabbable configuration
   */
  constructor(items: HTMLElement[], options: RovingTabindexOptions = {}) {
    this.items = [...items];
    this.orientation = options.orientation ?? 'horizontal';
    this.loop = options.loop ?? true;
    this.tabbable = options.tabbable ?? true;
    this.boundKeydown = (event: KeyboardEvent): void => this.onKeydown(event);

    this.items.forEach((item) => item.addEventListener('keydown', this.boundKeydown));
    this.syncTabindex();
  }

  /**
   * The currently active group element, if any.
   */
  public get activeElement(): HTMLElement | undefined {
    return this.items[this.activeIndex];
  }

  /**
   * Focuses the group item at the given index (clamped to a visible item),
   * rolling the tab stop to it.
   * @param index - target item index
   */
  public focus(index: number): void {
    const resolved = this.resolveVisibleIndex(index);

    if (resolved === -1) {
      return;
    }

    this.activeIndex = resolved;
    this.syncTabindex();
    this.items[resolved].focus();
  }

  /**
   * Focuses the first visible item.
   */
  public focusFirst(): void {
    this.focus(this.findVisible(0, 1));
  }

  /**
   * Focuses the last visible item.
   */
  public focusLast(): void {
    this.focus(this.findVisible(this.items.length - 1, -1));
  }

  /**
   * Detaches all listeners. Tabindex attributes are left as-is.
   */
  public destroy(): void {
    this.items.forEach((item) => item.removeEventListener('keydown', this.boundKeydown));
  }

  /**
   * Index of the currently active (roving) item.
   */
  private activeIndex = 0;

  /**
   * Applies the roving tabindex to every item based on the active index and the
   * `tabbable` option.
   */
  private syncTabindex(): void {
    this.items.forEach((item, index) => {
      const isActiveStop = this.tabbable && index === this.activeIndex;

      item.setAttribute('tabindex', isActiveStop ? '0' : '-1');
    });
  }

  /**
   * Keydown handler implementing arrow / Home / End navigation.
   * @param event - keyboard event from a group item
   */
  private onKeydown(event: KeyboardEvent): void {
    const [nextKey, prevKey] = this.orientation === 'horizontal'
      ? ['ArrowRight', 'ArrowLeft']
      : ['ArrowDown', 'ArrowUp'];

    if (event.key === nextKey) {
      event.preventDefault();
      this.move(1);
    } else if (event.key === prevKey) {
      event.preventDefault();
      this.move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.focusFirst();
    } else if (event.key === 'End') {
      event.preventDefault();
      this.focusLast();
    }
  }

  /**
   * Moves focus by `delta` steps, skipping hidden items and honoring `loop`.
   * @param delta - +1 for forward, -1 for backward
   */
  private move(delta: number): void {
    const count = this.items.length;

    if (count === 0) {
      return;
    }

    let index = this.activeIndex;

    for (let step = 0; step < count; step++) {
      index += delta;

      if (index < 0 || index >= count) {
        if (!this.loop) {
          return;
        }

        index = (index + count) % count;
      }

      if (!isHidden(this.items[index])) {
        this.focus(index);

        return;
      }
    }
  }

  /**
   * Finds the nearest visible item starting at `from`, scanning in `direction`.
   * @param from - starting index
   * @param direction - +1 forward, -1 backward
   * @returns visible index, or -1 if none
   */
  private findVisible(from: number, direction: number): number {
    for (let index = from; index >= 0 && index < this.items.length; index += direction) {
      if (!isHidden(this.items[index])) {
        return index;
      }
    }

    return -1;
  }

  /**
   * Clamps an index into range and skips forward to the nearest visible item.
   * @param index - requested index
   * @returns a visible index, or -1 if none exist
   */
  private resolveVisibleIndex(index: number): number {
    if (this.items.length === 0) {
      return -1;
    }

    const clamped = Math.max(0, Math.min(index, this.items.length - 1));

    if (!isHidden(this.items[clamped])) {
      return clamped;
    }

    const forward = this.findVisible(clamped, 1);

    return forward !== -1 ? forward : this.findVisible(clamped, -1);
  }
}
