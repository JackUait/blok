import { Module } from '../__module';

/** Covers the focus move that follows a Tab keydown. */
const TAB_MS = 100;

interface Saved {
  element: HTMLElement;
  ranges: Range[];
}

/**
 * Keeps a page inside an embed from taking focus on its own. A frame's
 * `focus()` needs no user action, and no sandbox token or `allow` feature stops
 * it, so after the reader clicks back into the text their keys would go to the
 * frame. When focus enters an embed frame in this editor and the reader did not aim
 * at it, focus and the caret go back where they were.
 *
 * A click inside a cross-origin frame never reaches this document. The only
 * sign of it is the pointer moving onto the frame first.
 */
export class FrameFocus extends Module {
  /** The frame the pointer moved onto, while nothing else happened here since. */
  private aimed: HTMLIFrameElement | null = null;
  private lastMove: { x: number; y: number } | null = null;
  private lastTab: { at: number; event: KeyboardEvent } | null = null;
  /**
   * The last press here was a finger or pen. A tap inside a frame sends this
   * page no pointer event at all, so it can't be told from a steal; such
   * focus moves are let through.
   */
  private byTouch = false;

  public prepare(): void {
    this.listeners.on(document, 'pointermove', this.onPointerMove, { capture: true, passive: true });
    this.listeners.on(document, 'pointerover', this.onPointerOver, true);
    this.listeners.on(document, 'pointerdown', this.onPointerDown, true);
    this.listeners.on(document, 'keydown', this.onKeyDown, true);
    this.listeners.on(document, 'focusout', this.onFocusOut, true);
  }

  public destroy(): void {
    this.listeners.removeAll();
    this.aimed = null;
    this.lastMove = null;
    this.lastTab = null;
    this.byTouch = false;
  }

  private readonly onPointerMove = (event: Event): void => {
    if (event instanceof MouseEvent) {
      this.lastMove = { x: event.clientX, y: event.clientY };
    }
  };

  /**
   * A frame scrolled under a still pointer also fires `pointerover`, and a
   * frame's own `focus()` scrolls the page. The pointer moved onto the frame
   * only if, at its last point seen here, something else is on top: a handle
   * or the toolbar drawn over the frame counts as outside it.
   */
  private readonly onPointerOver = (event: Event): void => {
    const frame = event.target;
    const move = this.lastMove;

    this.aimed = frame instanceof HTMLIFrameElement && move !== null && document.elementFromPoint(move.x, move.y) !== frame
      ? frame
      : null;
  };

  /** Firefox leaves focus in a frame on a click in the page unless the frame is blurred first. */
  private readonly onPointerDown = (event: Event): void => {
    this.aimed = null;
    this.byTouch = event instanceof PointerEvent && (event.pointerType === 'touch' || event.pointerType === 'pen');

    const active = document.activeElement;

    if (this.ownsFrame(active)) {
      active.blur();
    }
  };

  /** Typing here means the pointer resting on a frame is not aimed at it. */
  private readonly onKeyDown = (event: Event): void => {
    this.aimed = null;

    if (event instanceof KeyboardEvent && event.key === 'Tab') {
      this.lastTab = { at: performance.now(), event };
    }
  };

  /**
   * Firefox already reports the frame as active here, Chromium only a task later.
   * The task runs before Find's window-blur task, which would drop focus to the body.
   */
  private readonly onFocusOut = (event: Event): void => {
    const element = event.target;

    if (this.isDestroyed || !(element instanceof HTMLElement) || element instanceof HTMLIFrameElement) {
      return;
    }

    const saved: Saved = { element, ranges: this.rangesIn(element) };

    if (!this.restore(saved)) {
      setTimeout(() => this.restore(saved), 0);
    }
  };

  private restore(saved: Saved): boolean {
    const frame = document.activeElement;

    if (this.isDestroyed || !this.ownsFrame(frame)) {
      return false;
    }

    if (frame === this.aimed || this.byTouch || this.tabbedIn()) {
      return true;
    }

    // The page usually keeps its caret while the frame has focus, and it may be
    // newer than the saved copy. Read it before focus(), which can move it.
    const live = this.rangesIn(saved.element);
    const ranges = live.length > 0 ? live : saved.ranges;

    // Firefox keeps focus in the frame unless the frame is blurred first.
    frame.blur();
    saved.element.focus({ preventScroll: true });

    const selection = document.getSelection();

    if (selection !== null && ranges.length > 0) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }

    return true;
  }

  /**
   * Only embed frames in this editor. A custom tool's own iframe may take focus from code.
   * The embed tool stamps `data-blok-tool="embed"` on its root whatever name it is registered under.
   */
  private ownsFrame(element: Element | null): element is HTMLIFrameElement {
    return element instanceof HTMLIFrameElement
      && element.closest('[data-blok-tool="embed"]') !== null
      && this.Blok.UI.nodes.wrapper.contains(element);
  }

  private tabbedIn(): boolean {
    const tab = this.lastTab;

    return tab !== null && !tab.event.defaultPrevented && performance.now() - tab.at <= TAB_MS;
  }

  private rangesIn(element: HTMLElement): Range[] {
    const selection = document.getSelection();

    if (selection === null) {
      return [];
    }

    return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
      .filter((range) => element.contains(range.commonAncestorContainer))
      .map((range) => range.cloneRange());
  }
}
