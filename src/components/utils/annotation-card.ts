import { ANNOTATION_ATTR, ANNOTATION_SUBTITLE_ATTR } from '../../shared/annotation-mark';

import { syncPortalDirection } from './portal-direction';
import { createPositionTracker, type PositionTracker } from './popover/anchored-position';
import { HINT_DELAY } from './tooltip';
import { promoteToTopLayer, removeFromTopLayer } from './top-layer';
import { twJoin } from './tw';

/** Time the pointer has to travel from the phrase onto the card (WCAG 1.4.13). */
const GRACE_HIDE_DURATION = 250;

/** Gap between the phrase and the card. */
const GAP = 8;

const VIEWPORT_MARGIN = 4;

/** MUST match the `duration-150` transition on the wrapper, or the fade-out is clipped. */
const ANIMATION_DURATION = 150;

interface AnnotationCardOptions {
  /** Accessible name of the card. */
  label: string;
}

/**
 * The card a reader gets for an annotated phrase: the hint text, and a quieter
 * subtitle under it. Hover shows it after the hint delay; a click pins it.
 * Its text can be selected, so the shared tooltip cannot host it.
 */
export class AnnotationCard {
  private readonly nodes: {
    wrapper: HTMLElement;
    text: HTMLElement;
    subtitle: HTMLElement;
  };

  private currentAnchor: HTMLElement | null = null;

  private pendingAnchor: HTMLElement | null = null;

  private showTimeout: ReturnType<typeof setTimeout> | null = null;

  private graceHideTimeout: ReturnType<typeof setTimeout> | null = null;

  private exitTimeout: ReturnType<typeof setTimeout> | null = null;

  private enterFrame: number | null = null;

  private positionTracker: PositionTracker | null = null;

  private shown = false;

  private isPinned = false;

  constructor(options: AnnotationCardOptions) {
    this.nodes = this.build(options.label);
  }

  /** The phrase whose card is visible. */
  public get anchor(): HTMLElement | null {
    return this.shown ? this.currentAnchor : null;
  }

  /** A pinned card ignores the pointer leaving. */
  public get pinned(): boolean {
    return this.shown && this.isPinned;
  }

  /**
   * Hover: show after the hint delay.
   * @param anchor - the annotated phrase
   */
  public show(anchor: HTMLElement): void {
    this.cancelHide();

    if (this.currentAnchor === anchor || this.pendingAnchor === anchor) {
      return;
    }

    this.cancelShow();
    this.pendingAnchor = anchor;
    this.showTimeout = setTimeout(() => {
      this.showTimeout = null;
      this.pendingAnchor = null;
      this.showNow(anchor, false);
    }, HINT_DELAY);
  }

  /**
   * Click: show at once and keep open.
   * @param anchor - the annotated phrase
   */
  public pin(anchor: HTMLElement): void {
    this.cancelShow();
    this.showNow(anchor, true);
  }

  /**
   * Click on a phrase: pin its card, or close the card it already pinned.
   * @param anchor - the annotated phrase
   */
  public toggle(anchor: HTMLElement): void {
    if (this.pinned && this.currentAnchor === anchor) {
      this.hide();

      return;
    }

    this.pin(anchor);
  }

  /** The pointer left the phrase or the card. */
  public scheduleHide(): void {
    this.cancelHide();

    if (!this.shown) {
      this.cancelShow();

      return;
    }

    if (this.isPinned) {
      return;
    }

    this.graceHideTimeout = setTimeout(() => {
      this.graceHideTimeout = null;
      this.hide();
    }, GRACE_HIDE_DURATION);
  }

  public cancelHide(): void {
    if (this.graceHideTimeout !== null) {
      clearTimeout(this.graceHideTimeout);
      this.graceHideTimeout = null;
    }
  }

  public hide(): void {
    this.cancelHide();
    this.cancelShow();
    this.cancelEnterFrame();

    if (!this.shown) {
      return;
    }

    this.shown = false;
    this.setPinned(false);
    this.currentAnchor = null;
    this.nodes.wrapper.inert = true;
    this.positionTracker?.detach();
    this.positionTracker = null;
    this.nodes.wrapper.setAttribute('data-state', 'closed');
    this.cancelExit();
    this.exitTimeout = setTimeout(() => {
      this.exitTimeout = null;
      removeFromTopLayer(this.nodes.wrapper);
      this.nodes.wrapper.remove();
    }, ANIMATION_DURATION);
  }

  public destroy(): void {
    this.cancelHide();
    this.cancelShow();
    this.cancelEnterFrame();
    this.cancelExit();
    this.setPinned(false);
    this.positionTracker?.detach();
    this.positionTracker = null;
    removeFromTopLayer(this.nodes.wrapper);
    this.nodes.wrapper.remove();
    this.currentAnchor = null;
    this.shown = false;
  }

  private showNow(anchor: HTMLElement, pinned: boolean): void {
    const text = anchor.getAttribute(ANNOTATION_ATTR) ?? '';

    if (text === '') {
      return;
    }

    this.cancelHide();
    this.cancelExit();
    this.currentAnchor = anchor;
    this.nodes.wrapper.inert = false;

    const subtitle = anchor.getAttribute(ANNOTATION_SUBTITLE_ATTR) ?? '';

    this.nodes.text.textContent = text;
    this.nodes.subtitle.textContent = subtitle;
    this.nodes.subtitle.hidden = subtitle === '';
    // `hidden` alone loses to the `block` utility on the same element.
    this.nodes.subtitle.style.display = subtitle === '' ? 'none' : '';

    if (!this.nodes.wrapper.isConnected) {
      document.body.appendChild(this.nodes.wrapper);
    }

    this.shown = true;
    this.setPinned(pinned);
    syncPortalDirection(this.nodes.wrapper, { source: anchor });
    promoteToTopLayer(this.nodes.wrapper);
    this.position(anchor);
    this.positionTracker?.detach();
    this.positionTracker = createPositionTracker(this.nodes.wrapper, () => {
      if (this.shown && this.currentAnchor === anchor) {
        this.position(anchor);
      }
    });
    this.positionTracker.attach();

    this.cancelEnterFrame();
    this.enterFrame = requestAnimationFrame(() => {
      this.enterFrame = null;
      this.nodes.wrapper.setAttribute('data-state', 'open');
    });
  }

  /**
   * Escape and outside presses close a pinned card only, so the listeners live
   * exactly as long as the pin.
   * @param pinned - the new pin state
   */
  private setPinned(pinned: boolean): void {
    if (this.isPinned === pinned) {
      return;
    }

    this.isPinned = pinned;

    if (pinned) {
      document.addEventListener('keydown', this.handleKeydown, true);
      document.addEventListener('pointerdown', this.handlePointerDown, true);

      return;
    }

    document.removeEventListener('keydown', this.handleKeydown, true);
    document.removeEventListener('pointerdown', this.handlePointerDown, true);
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.hide();
    }
  };

  private handlePointerDown = (event: Event): void => {
    const target = event.target;

    if (target instanceof Node && (this.nodes.wrapper.contains(target) || this.currentAnchor?.contains(target) === true)) {
      return;
    }

    this.hide();
  };

  /**
   * Above the phrase, centred on its first line; below its last line when there
   * is no room above. The card floats, so the text never moves.
   * @param anchor - the annotated phrase
   */
  private position(anchor: HTMLElement): void {
    const rects = anchor.getClientRects();
    const first = rects[0];
    const last = rects[rects.length - 1];

    if (first === undefined || last === undefined) {
      return;
    }

    const width = this.nodes.wrapper.offsetWidth;
    const height = this.nodes.wrapper.offsetHeight;
    const above = first.top - GAP - height;
    const desiredTop = above < VIEWPORT_MARGIN ? last.bottom + GAP : above;
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    const top = Math.max(VIEWPORT_MARGIN, Math.min(desiredTop, maxTop));
    const centred = first.left + first.width / 2 - width / 2;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(centred, window.innerWidth - width - VIEWPORT_MARGIN));

    this.nodes.wrapper.style.left = `${left}px`;
    this.nodes.wrapper.style.top = `${top}px`;
  }

  private cancelShow(): void {
    if (this.showTimeout !== null) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
    this.pendingAnchor = null;
  }

  private cancelExit(): void {
    if (this.exitTimeout !== null) {
      clearTimeout(this.exitTimeout);
      this.exitTimeout = null;
    }
  }

  private cancelEnterFrame(): void {
    if (this.enterFrame !== null) {
      cancelAnimationFrame(this.enterFrame);
      this.enterFrame = null;
    }
  }

  private build(label: string): AnnotationCard['nodes'] {
    const wrapper = document.createElement('div');

    wrapper.className = twJoin(
      'fixed z-overlay top-0 left-0',
      // px, not rem: the card must not resize with the host's root font-size.
      'w-[340px] max-w-[calc(100vw-8px)] box-border',
      'bg-popover-bg rounded-(--blok-radius-surface) shadow-(--blok-popover-box-shadow)',
      'text-[14px] leading-[1.5] text-text-primary text-left',
      'opacity-0 translate-y-px transition-[opacity,transform] duration-150 ease-out',
      'data-[state=open]:opacity-100 data-[state=open]:translate-y-0',
      'motion-reduce:transition-none'
    );
    // Inline, not utilities: the top-layer reset in isolation.css zeroes padding on the promoted element.
    wrapper.style.paddingTop = 'var(--blok-space-3)';
    wrapper.style.paddingBottom = 'var(--blok-space-3)';
    wrapper.style.paddingLeft = '14px';
    wrapper.style.paddingRight = '14px';
    wrapper.setAttribute('data-state', 'closed');
    wrapper.setAttribute('data-blok-testid', 'annotation-card');
    wrapper.setAttribute('role', 'note');
    wrapper.setAttribute('aria-label', label);
    wrapper.inert = true;
    // Body-mounted: without this scope every utility above is dead in a consumer app (body-mount-scope-law).
    wrapper.setAttribute('data-blok-interface', 'annotation-card');

    const text = document.createElement('div');

    text.className = 'block whitespace-pre-wrap break-words select-text';
    text.setAttribute('data-blok-testid', 'annotation-card-text');

    const subtitle = document.createElement('div');

    subtitle.className = 'block mt-2 text-[12px] text-gray-text whitespace-pre-wrap break-words select-text';
    subtitle.setAttribute('data-blok-testid', 'annotation-card-subtitle');

    wrapper.append(text, subtitle);
    wrapper.addEventListener('mouseenter', () => this.cancelHide());
    wrapper.addEventListener('mouseleave', () => this.scheduleHide());

    return { wrapper, text, subtitle };
  }
}
