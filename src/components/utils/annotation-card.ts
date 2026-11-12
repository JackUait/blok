import { ANNOTATION_ATTR, ANNOTATION_SUBTITLE_ATTR } from '../../shared/annotation-mark';

import { lightAnnotationPhrase } from './annotation-highlight';
import { syncPortalDirection } from './portal-direction';
import { createPositionTracker, type PositionTracker } from './popover/anchored-position';
import { MIN_HINT_DELAY } from './tooltip';
import { promoteToTopLayer, removeFromTopLayer } from './top-layer';
import { twJoin } from './tw';

/** Time the pointer has to travel from the phrase onto the card (WCAG 1.4.13). */
const GRACE_HIDE_DURATION = 250;

/** Gap between the phrase and the card. MUST match the stem's `h-[11px]`. */
const GAP = 11;

/** Keeps the stem off the card's rounded corners. */
const STEM_INSET = 12;

const VIEWPORT_MARGIN = 4;

/** MUST cover the longest closing transition in build(), or the fade-out is clipped. */
const ANIMATION_DURATION = 150;

interface AnnotationCardOptions {
  /** Accessible name of the card. */
  label: string;
}

/**
 * The card a reader gets for an annotated phrase: the hint text, and a quieter
 * subtitle under it. Hover shows it after the shortest hint delay; a click pins it.
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
   * Hover: show after the shortest hint delay.
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
    }, MIN_HINT_DELAY);
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
    this.lightPhrase(null);
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
    this.lightPhrase(null);
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
    this.lightPhrase(anchor);
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
   * @param anchor - the phrase to light, or null to clear
   */
  private lightPhrase(anchor: HTMLElement | null): void {
    if (anchor === null) {
      lightAnnotationPhrase(null);

      return;
    }

    const range = document.createRange();

    range.selectNodeContents(anchor);
    lightAnnotationPhrase(range);
  }

  /**
   * Below the phrase, centred on its last line; above its first line when
   * there is no room below. The card floats, so the text never moves.
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
    const below = last.bottom + GAP;
    const above = first.top - GAP - height;
    const isBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN || above < VIEWPORT_MARGIN;
    const line = isBelow ? last : first;
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    const top = Math.max(VIEWPORT_MARGIN, Math.min(isBelow ? below : above, maxTop));
    const centre = line.left + line.width / 2;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(centre - width / 2, window.innerWidth - width - VIEWPORT_MARGIN));
    const stemX = Math.max(STEM_INSET, Math.min(centre - left, width - STEM_INSET));

    this.nodes.wrapper.style.left = `${left}px`;
    this.nodes.wrapper.style.top = `${top}px`;
    this.nodes.wrapper.style.setProperty('--blok-annotation-stem-x', `${stemX}px`);
    this.nodes.wrapper.setAttribute('data-side', isBelow ? 'bottom' : 'top');
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

    // The wrapper only places the card; the surface below carries the look.
    wrapper.className = twJoin(
      'group fixed z-overlay top-0 left-0',
      'text-[15px] leading-[1.5] text-text-primary text-left'
    );
    // Inline, not utilities: the top-layer reset in isolation.css zeroes padding on the promoted element.
    // As wide as the text, up to 340px. px, not rem: the host's root font-size must not resize it.
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.width = 'max-content';
    wrapper.style.maxWidth = 'min(340px, calc(100vw - 8px))';
    wrapper.style.padding = '0';
    wrapper.setAttribute('data-state', 'closed');
    wrapper.setAttribute('data-side', 'bottom');
    wrapper.setAttribute('data-blok-testid', 'annotation-card');
    wrapper.setAttribute('role', 'note');
    wrapper.setAttribute('aria-label', label);
    wrapper.inert = true;
    // Body-mounted: without this scope every utility above is dead in a consumer app (body-mount-scope-law).
    wrapper.setAttribute('data-blok-interface', 'annotation-card');

    const stem = document.createElement('div');

    // Grows from the phrase toward the card, on whichever side the card sits.
    stem.className = twJoin(
      'absolute w-[1.5px] h-[11px] -ml-[0.75px] left-(--blok-annotation-stem-x) bg-text-primary',
      'top-[-11px] origin-top group-data-[side=top]:top-auto group-data-[side=top]:bottom-[-11px] group-data-[side=top]:origin-bottom',
      'scale-y-0 transition-[scale] duration-[80ms] ease-in',
      'group-data-[state=open]:scale-y-100 group-data-[state=open]:ease-out',
      'motion-reduce:transition-none'
    );
    stem.setAttribute('data-blok-testid', 'annotation-card-stem');
    stem.setAttribute('aria-hidden', 'true');

    const surface = document.createElement('div');

    // Springs out of the stem's end; the open delay lets the stem land first.
    surface.className = twJoin(
      'py-[14px] px-[16px] bg-popover-bg rounded-(--blok-radius-surface) shadow-(--blok-popover-box-shadow)',
      'origin-[var(--blok-annotation-stem-x)_0] group-data-[side=top]:origin-[var(--blok-annotation-stem-x)_100%]',
      'opacity-0 scale-[0.55] transition-[opacity,scale] duration-[140ms] ease-in',
      'group-data-[state=open]:opacity-100 group-data-[state=open]:scale-100',
      'group-data-[state=open]:duration-[240ms] group-data-[state=open]:delay-[40ms] group-data-[state=open]:ease-[cubic-bezier(0.2,1.45,0.35,1)]',
      'motion-reduce:transition-none motion-reduce:scale-100'
    );

    const body = document.createElement('div');

    // The words come into focus after the card has landed.
    body.className = twJoin(
      'opacity-0 blur-[5px] translate-y-[5px] transition-[opacity,filter,translate] duration-[120ms] ease-out',
      'group-data-[state=open]:opacity-100 group-data-[state=open]:blur-[0px] group-data-[state=open]:translate-y-0',
      'group-data-[state=open]:duration-[150ms] group-data-[state=open]:delay-[80ms]',
      'motion-reduce:transition-none motion-reduce:blur-[0px] motion-reduce:translate-y-0'
    );

    const text = document.createElement('div');

    text.className = 'block leading-[22px] whitespace-pre-wrap break-words select-text';
    text.setAttribute('data-blok-testid', 'annotation-card-text');

    const subtitle = document.createElement('div');

    subtitle.className = twJoin(
      'block mt-[8px] text-[12px] text-gray-text whitespace-pre-wrap break-words select-text',
      'before:content-[""] before:inline-block before:w-[14px] before:h-px before:mr-[8px] before:align-middle before:bg-current'
    );
    subtitle.setAttribute('data-blok-testid', 'annotation-card-subtitle');

    body.append(text, subtitle);
    surface.append(body);
    wrapper.append(stem, surface);
    wrapper.addEventListener('mouseenter', () => this.cancelHide());
    wrapper.addEventListener('mouseleave', () => this.scheduleHide());

    return { wrapper, text, subtitle };
  }
}
