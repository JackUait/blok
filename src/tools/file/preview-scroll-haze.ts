/**
 * Four-sided scroll haze for the file-preview modal.
 *
 * Overlays soft gradient strips on the edges of the preview body, each shown
 * only while the active view has hidden content in that direction — so a tall
 * sheet, a wide table, a long document, or a scrolling code/markdown pane all
 * read as scrollable from every side.
 *
 * One instance serves every previewable type. Rather than binding to a specific
 * scroll container (which would miss the markdown Preview ⇄ Source toggle), it
 * binds to the body and resolves the *active* scrolling child on each update:
 *   - scroll is caught in the capture phase (scroll doesn't bubble, but it does
 *     propagate capturing), so any descendant scroll refreshes the haze;
 *   - a MutationObserver refreshes after content renders or the view toggles;
 *   - window resize refreshes on layout changes.
 * The strips never intercept pointer events, and the haze colour tracks the
 * active surface so it fades into whatever is scrolling (paper, desk, editor).
 */

const SIDES = ['top', 'bottom', 'left', 'right'] as const;

type Side = (typeof SIDES)[number];

/** Minimum scroll delta to treat an edge as "scrolled" (avoids sub-pixel flicker). */
const SCROLL_THRESHOLD = 1;

export class ScrollHaze {
  private readonly strips = new Map<Side, HTMLElement>();
  private body: HTMLElement | null = null;
  private refresh: (() => void) | null = null;
  private observer: MutationObserver | null = null;
  private ticking = false;

  /**
   * Mount the haze over a preview body and start tracking its active scroller.
   *
   * @param body - The `position: relative` preview body that wraps the views.
   */
  public init(body: HTMLElement): void {
    this.body = body;

    for (const side of SIDES) {
      const strip = document.createElement('div');
      strip.className = 'blok-file-preview-haze';
      strip.setAttribute('data-blok-haze', side);
      strip.setAttribute('aria-hidden', 'true');
      body.appendChild(strip);
      this.strips.set(side, strip);
    }

    this.refresh = (): void => {
      if (this.ticking) {
        return;
      }
      this.ticking = true;
      requestAnimationFrame(() => {
        this.update();
        this.ticking = false;
      });
    };

    // Capture phase: scroll events don't bubble, but they do propagate down the
    // capture path, so this one listener covers whichever child is scrolling.
    body.addEventListener('scroll', this.refresh, { capture: true, passive: true });
    window.addEventListener('resize', this.refresh, { passive: true });

    this.observer = new MutationObserver(this.refresh);
    this.observer.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
    });

    this.update();
  }

  /** Recompute which edges of the active view currently have hidden content. */
  public update(): void {
    const scroller = this.activeScroller();
    if (scroller === null) {
      for (const side of SIDES) {
        this.setVisible(side, false);
      }

      return;
    }

    const surface = getComputedStyle(scroller).backgroundColor;
    if (surface !== '' && this.body !== null) {
      this.body.style.setProperty('--blok-haze-color', surface);
    }

    const { scrollTop, scrollLeft, scrollWidth, scrollHeight, clientWidth, clientHeight } = scroller;
    const maxX = scrollWidth - clientWidth;
    const maxY = scrollHeight - clientHeight;

    this.setVisible('top', scrollTop > SCROLL_THRESHOLD);
    this.setVisible('bottom', maxY > SCROLL_THRESHOLD && scrollTop < maxY - SCROLL_THRESHOLD);
    this.setVisible('left', scrollLeft > SCROLL_THRESHOLD);
    this.setVisible('right', maxX > SCROLL_THRESHOLD && scrollLeft < maxX - SCROLL_THRESHOLD);
  }

  /** Detach listeners/observer and remove the strips. */
  public destroy(): void {
    if (this.refresh !== null && this.body !== null) {
      this.body.removeEventListener('scroll', this.refresh, { capture: true });
      window.removeEventListener('resize', this.refresh);
    }
    this.observer?.disconnect();

    this.strips.forEach((strip) => strip.remove());
    this.strips.clear();
    this.body = null;
    this.refresh = null;
    this.observer = null;
    this.ticking = false;
  }

  /** The visible, non-haze child that currently owns the scroll. */
  private activeScroller(): HTMLElement | null {
    if (this.body === null) {
      return null;
    }

    const candidates = Array.from(this.body.children).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement
        && !el.classList.contains('blok-file-preview-haze')
        && !el.hidden
        && getComputedStyle(el).display !== 'none',
    );

    // Prefer a child that is actually overflowing; otherwise the first visible
    // view (its metrics resolve to "no haze", which is correct).
    return (
      candidates.find(
        (el) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth,
      ) ?? candidates[0] ?? null
    );
  }

  private setVisible(side: Side, visible: boolean): void {
    const strip = this.strips.get(side);
    if (strip === undefined) {
      return;
    }

    if (visible) {
      strip.setAttribute('data-blok-haze-visible', '');
    } else {
      strip.removeAttribute('data-blok-haze-visible');
    }
  }
}
