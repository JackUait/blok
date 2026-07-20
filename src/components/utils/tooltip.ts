import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../constants';

import { shouldFlip } from './popover/popover-position';
import { syncPortalDirection } from './portal-direction';
import {
  promoteToTopLayer,
  removeFromTopLayer,
} from './top-layer';
import { twJoin } from './tw';

// TooltipContent / TooltipOptions are declared in the published types
// (types/api/tooltip.d.ts) as the single source of truth, so the package's
// declaration surface stays self-contained and never re-exports raw src.
import type { TooltipContent, TooltipOptions } from '@/types/api/tooltip';

export type { TooltipContent, TooltipOptions };

const DEFAULT_OFFSET = 10;
/**
 * If a new tooltip is requested within this window (ms) of the last hide, it
 * opens instantly regardless of the requested `delay` — the "skip-delay warm
 * window" (Radix Tooltip). Sweeping across adjacent triggers should feel
 * continuous, not re-incur the open delay on each one.
 */
const SKIP_DELAY_DURATION = 300;
/**
 * Grace period (ms) between the pointer leaving the trigger and the tooltip
 * hiding. Smooths brief exits/re-entries of the trigger so the bubble does
 * not flicker; the bubble itself is click-transparent (`pointer-events-none`),
 * so this timer — not bubble hover — is the only thing keeping it open.
 */
const GRACE_HIDE_DURATION = 100;
/**
 * Window (ms) after a touch interaction during which a focus-triggered open is
 * suppressed. Tap-focus on touch devices fires `focusin` right after the touch
 * `pointerdown`, and the tooltip must not open there (same touch guard as the
 * hover path) — while genuine keyboard focus, which has no recent touch,
 * still opens the tooltip (WCAG 1.4.13).
 */
const TOUCH_FOCUS_SUPPRESS_DURATION = 500;
const TOOLTIP_ID = 'blok-tooltip';
const ARIA_DESCRIBEDBY_ATTRIBUTE = 'aria-describedby';
const TOOLTIP_ROLE = 'tooltip';
const ARIA_HIDDEN_ATTRIBUTE = 'aria-hidden';
const ARIA_HIDDEN_FALSE = 'false';
const ARIA_HIDDEN_TRUE = 'true';
const VISIBILITY_PROPERTY = 'visibility';
const VISIBILITY_VISIBLE = 'visible';
const VISIBILITY_HIDDEN = 'hidden';

type CSSTooltipClasses = {
  tooltip: string | string[];
  tooltipContent: string | string[];
  tooltipShown: string | string[];
};

/**
 * Tiny any beautiful tooltips module.
 *
 * Can be showed near passed Element with any specified HTML content
 */
class Tooltip {
  /**
   * Tooltip CSS classes
   * @returns {object} CSS class names
   */
  private get CSS(): CSSTooltipClasses {
    return {
      tooltip: twJoin(
        /**
         * `fixed` (not `absolute`) anchors the wrapper to the viewport. That
         * matters because placement math feeds in viewport-relative coords
         * (from `getBoundingClientRect()`, with no scroll offset added), and
         * the CSS Top Layer does NOT give `position: absolute` a viewport
         * containing block — Chrome keeps the initial containing block
         * (document), so a scrolled page would push the tooltip up by
         * `scrollY`. `fixed` side-steps that entirely, both before and after
         * the wrapper is promoted to the Top Layer.
         */
        'fixed z-overlay top-0 left-0',
        'bg-tooltip-bg opacity-0',
        /**
         * Click-transparency is applied as an inline `pointer-events: none
         * !important` in prepare() — NOT as a `pointer-events-none` utility —
         * because the Top-Layer reset (`[data-blok-top-layer][popover]
         * { all: initial !important }`) would override any class-based rule,
         * exactly like the `visibility` case in updateTooltipVisibility().
         */
        'select-none',
        'rounded-lg shadow-tooltip',
        'mobile:hidden'
      ).split(' '),
      tooltipContent: twJoin(
        'px-2.5 py-1.5',
        'text-tooltip-font text-xs text-center',
        'tracking-[0.02em] leading-[1em]'
      ).split(' '),
      tooltipShown: ['opacity-100'],
    };
  }

  /**
   * Module nodes
   */
  private nodes: {
      wrapper: HTMLElement | null;
      content: HTMLElement | null;
    } = {
      wrapper: null,
      content: null,
    };

  /**
   * Appearance state
   */
  private showed: boolean = false;

  /**
   * Offset above the Tooltip
   */
  private offsetTop: number = DEFAULT_OFFSET;

  /**
   * Offset at the left from the Tooltip
   */
  private offsetLeft: number = DEFAULT_OFFSET;

  /**
   * Offset at the right from the Tooltip
   */
  private offsetRight: number = DEFAULT_OFFSET;

  /**
   * Store timeout before showing to clear it on hide
   */
  private showingTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Deferred-hide timer armed when the pointer leaves the trigger. Cleared by
   * a re-show within {@link GRACE_HIDE_DURATION} so quick trigger re-entries
   * and sweeps to adjacent triggers do not flicker.
   */
  private graceHideTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Timestamp (ms, `Date.now()`) of the last hide. Drives the skip-delay warm
   * window: a show requested within {@link SKIP_DELAY_DURATION} of this opens
   * instantly. Starts at -Infinity so the first show always honors its delay.
   */
  private lastHideTimestamp: number = Number.NEGATIVE_INFINITY;

  /**
   * The `pointerType` of the most recent pointer interaction on a hover
   * target. Used to suppress hover tooltips for touch input (Radix touch
   * guard) — touch users get no hover affordance and a tooltip would just
   * cover the content they tapped.
   */
  private lastPointerType: string | null = null;

  /**
   * Timestamp (ms, `Date.now()`) of the most recent touch interaction on a
   * hover target. Drives the focus-path touch guard: a `focusin` arriving
   * within {@link TOUCH_FOCUS_SUPPRESS_DURATION} of a touch is a tap-focus,
   * not keyboard focus, and must not open the tooltip.
   */
  private lastTouchTimestamp: number = Number.NEGATIVE_INFINITY;

  /**
   * Set once {@link destroy} has run. Orphaned per-trigger handlers (bound
   * closures in elements that were never untracked) check this flag so they
   * can never re-open the tooltip or re-register the document-level Escape
   * listener after the instance is gone.
   */
  private destroyed: boolean = false;

  /**
   * MutationObserver for watching tooltip visibility changes
   */
  private ariaObserver: MutationObserver | null = null;

  /**
   * The element the singleton tooltip currently describes. Tracked so
   * {@link hide} clears `aria-describedby` from exactly that element (the
   * singleton describes only one target at a time).
   */
  private currentTarget: HTMLElement | null = null;

  /**
   * Per-target cleanup functions for {@link onHover} listeners, so repeated
   * `onHover` calls on the same element replace (never stack) their bindings.
   */
  private hoverBindings: WeakMap<HTMLElement, () => void> = new WeakMap();

  /**
   * Static singleton instance
   */
  private static instance: Tooltip | null = null;

  /**
   * Get singleton instance
   */
  public static getInstance(): Tooltip {
    if (!Tooltip.instance) {
      Tooltip.instance = new Tooltip();
    }

    return Tooltip.instance;
  }

  /**
   * Module constructor
   */
  private constructor() {
    this.prepare();

    window.addEventListener('scroll', this.handleWindowScroll, { capture: true, passive: true });
  }

  /**
   * Show Tooltip near passed element with specified HTML content
   * @param {HTMLElement} element - target element to place Tooltip near that
   * @param {TooltipContent} content — any HTML Element of String that will be used as content
   * @param {TooltipOptions} options — Available options {@link TooltipOptions}
   */
  public show(element: HTMLElement, content: TooltipContent, options: TooltipOptions = {}): void {
    if (this.destroyed) {
      return;
    }

    if (!this.nodes.wrapper) {
      this.prepare();
    }

    /**
     * A new show supersedes any pending grace hide from a previous trigger's
     * exit. Without this, the stale grace timer fires during a delayed show
     * and hide() clears the pending showing timeout — the new tooltip never
     * appears.
     */
    this.cancelGraceHide();

    /**
     * Clear any existing show timeout to prevent orphaned timeouts from firing.
     * This fixes the bug where tooltips would appear after the user has already
     * moved away, caused by multiple rapid hover events scheduling multiple timeouts.
     */
    if (this.showingTimeout) {
      clearTimeout(this.showingTimeout);
      this.showingTimeout = null;
    }

    const basicOptions = {
      placement: 'bottom',
      marginTop: 0,
      marginLeft: 0,
      marginRight: 0,
      marginBottom: 0,
      delay: 0,
    };
    const showingOptions = Object.assign(basicOptions, options);

    if (!this.nodes.content) {
      return;
    }

    this.nodes.content.innerHTML = '';
    this.nodes.content.appendChild(this.createContentNode(content));

    if (!this.nodes.wrapper) {
      return;
    }

    /**
     * The singleton lives under body/Top Layer, outside its owning editor.
     * Refresh on every show so simultaneous RTL and LTR editors cannot leak a
     * stale direction into one another.
     */
    syncPortalDirection(this.nodes.wrapper, { source: element });

    const resolvedPlacement = this.resolvePlacement(element, showingOptions.placement ?? 'bottom');

    switch (resolvedPlacement) {
      case 'top':
        this.placeTop(element, showingOptions);
        break;

      case 'left':
        this.placeLeft(element, showingOptions);
        break;

      case 'right':
        this.placeRight(element, showingOptions);
        break;

      case 'bottom':
      default:
        this.placeBottom(element, showingOptions);
        break;
    }

    this.setDescribedBy(element);

    /**
     * Skip-delay warm window: if the previous tooltip hid within
     * {@link SKIP_DELAY_DURATION}, open instantly and ignore the requested
     * delay so sweeping across adjacent triggers stays continuous.
     */
    const withinWarmWindow = Date.now() - this.lastHideTimestamp < SKIP_DELAY_DURATION;

    if (showingOptions && showingOptions.delay && !withinWarmWindow) {
      this.showingTimeout = setTimeout(() => {
        /**
         * Clear the timeout reference after execution to maintain correct state.
         */
        this.showingTimeout = null;
        this.reveal();
      }, showingOptions.delay);

      return;
    }

    this.reveal();
  }

  /**
   * Single internal reveal step both the immediate and delayed show paths
   * funnel through. Always promotes the wrapper to the Top Layer — previously
   * only the immediate path did, so delayed tooltips rendered BELOW open
   * popovers. Also arms the one-shot Escape dismissal listener.
   */
  private reveal(): void {
    // A fresh reveal supersedes any pending grace hide from an earlier exit.
    this.cancelGraceHide();

    if (this.nodes.wrapper) {
      const classes = Array.isArray(this.CSS.tooltipShown) ? this.CSS.tooltipShown : [this.CSS.tooltipShown];

      this.nodes.wrapper.classList.add(...classes);
      this.nodes.wrapper.setAttribute('data-state', 'open');
      this.updateTooltipVisibility();
      this.promoteToTopLayer();
    }
    this.showed = true;
    this.registerEscapeListener();
  }

  /**
   * Point the target's `aria-describedby` at the singleton tooltip. Clears the
   * attribute from any previously-described element first, since the singleton
   * can describe only one target at a time.
   * @param {HTMLElement} element - the element the tooltip now describes
   */
  private setDescribedBy(element: HTMLElement): void {
    if (this.currentTarget && this.currentTarget !== element) {
      this.currentTarget.removeAttribute(ARIA_DESCRIBEDBY_ATTRIBUTE);
    }

    this.currentTarget = element;
    element.setAttribute(ARIA_DESCRIBEDBY_ATTRIBUTE, TOOLTIP_ID);
  }

  /**
   * Capture-phase, one-shot `keydown` listener that dismisses the tooltip on
   * Escape. Does NOT stopPropagation/preventDefault, so menus and popovers
   * still receive the same Escape.
   */
  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.hide();
    }
  };

  /**
   * Arm the Escape dismissal listener (idempotent — removes any prior binding
   * before re-adding so racing shows never stack listeners).
   */
  private registerEscapeListener(): void {
    document.removeEventListener('keydown', this.handleDocumentKeydown, { capture: true });
    document.addEventListener('keydown', this.handleDocumentKeydown, { capture: true });
  }

  /**
   * Promote the tooltip wrapper to the CSS Top Layer via the centralized
   * helper. Necessary so the tooltip renders above any open popover —
   * popovers themselves use the Top Layer, and no z-index can beat that.
   */
  private promoteToTopLayer(): void {
    if (this.nodes.wrapper === null) {
      return;
    }

    promoteToTopLayer(this.nodes.wrapper);
  }

  /**
   * Prepare tooltip content node
   * @param {TooltipContent} content - tooltip content (Node or string)
   */
  private createContentNode(content: TooltipContent): Node {
    if (typeof content === 'string') {
      return document.createTextNode(content);
    }

    if (content instanceof Node) {
      return content;
    }

    throw Error('[Blok Tooltip] Wrong type of «content» passed. It should be an instance of Node or String. ' +
      'But ' + typeof content + ' given.');
  }

  /**
   * Hide toolbox tooltip and clean content
   */
  public hide(): void {
    if (this.destroyed) {
      return;
    }

    /**
     * Remember whether the tooltip was actually visible when hide ran: only a
     * real open→close transition may arm the skip-delay warm window below.
     */
    const wasVisible = this.showed;

    /**
     * Cancel any pending show timeout when hiding.
     * This prevents the tooltip from appearing after the user has already left the element.
     */
    if (this.showingTimeout) {
      clearTimeout(this.showingTimeout);
      this.showingTimeout = null;
    }

    this.cancelGraceHide();

    document.removeEventListener('keydown', this.handleDocumentKeydown, { capture: true });

    if (this.currentTarget) {
      this.currentTarget.removeAttribute(ARIA_DESCRIBEDBY_ATTRIBUTE);
      this.currentTarget = null;
    }

    if (this.nodes.wrapper) {
      const classes = Array.isArray(this.CSS.tooltipShown) ? this.CSS.tooltipShown : [this.CSS.tooltipShown];

      this.nodes.wrapper.classList.remove(...classes);
      this.nodes.wrapper.setAttribute('data-state', 'closed');
      this.updateTooltipVisibility();
      this.removeFromTopLayer();
    }
    this.showed = false;

    /**
     * Stamp the hide time so an imminent re-show can skip its open delay —
     * but only when the tooltip was actually visible. A hide funnelled from a
     * suppressed touch tap or a sweep over a delayed trigger (never shown)
     * must NOT arm the instant-open warm window.
     */
    if (wasVisible) {
      this.lastHideTimestamp = Date.now();
    }
  }

  /**
   * Arm the grace timer that hides the tooltip after {@link GRACE_HIDE_DURATION}.
   * Called when the pointer leaves the trigger; a re-show within the window
   * cancels it so brief exits do not flicker the bubble.
   */
  private scheduleGraceHide(): void {
    this.cancelGraceHide();

    this.graceHideTimeout = setTimeout(() => {
      this.graceHideTimeout = null;
      this.hide();
    }, GRACE_HIDE_DURATION);
  }

  /**
   * Cancel a pending grace hide (e.g. a re-show arrived within the window).
   */
  private cancelGraceHide(): void {
    if (this.graceHideTimeout) {
      clearTimeout(this.graceHideTimeout);
      this.graceHideTimeout = null;
    }
  }

  /**
   * Reverse of {@link promoteToTopLayer}. Delegates to the centralized helper
   * which hides the popover, clears the `popover` attribute, and removes the
   * top-layer marker so the wrapper returns to ordinary layout.
   */
  private removeFromTopLayer(): void {
    if (this.nodes.wrapper === null) {
      return;
    }

    removeFromTopLayer(this.nodes.wrapper);
  }

  /**
   * Mouseover/Mouseleave decorator
   * @param {HTMLElement} element - target element to place Tooltip near that
   * @param {TooltipContent} content — any HTML Element of String that will be used as content
   * @param {TooltipOptions} options — Available options {@link TooltipOptions}
   */
  public onHover(element: HTMLElement, content: TooltipContent, options: TooltipOptions = {}): void {
    if (this.destroyed) {
      return;
    }

    /**
     * Replace any prior binding on this element so repeated `onHover` calls
     * never stack duplicate listeners.
     */
    this.hoverBindings.get(element)?.();

    const revealFor = (revealOptions: TooltipOptions): void => {
      /**
       * Don't show tooltip if any Popover is currently open,
       * unless the element is inside the open popover (e.g., inline toolbar items)
       * This prevents tooltips from appearing over open menus while still allowing
       * tooltips on items within the popover itself
       */
      const openedPopover = document.querySelector('[data-blok-popover-opened="true"]');

      if (openedPopover !== null && !openedPopover.contains(element)) {
        return;
      }

      this.show(element, content, revealOptions);
    };

    /**
     * Record the pointer type so {@link handleMouseEnter} can suppress the
     * hover tooltip for touch input (touch guard) — `pointerenter` fires
     * before the synthesized `mouseenter`.
     */
    const handlePointerEnter = (event: PointerEvent): void => this.recordPointer(event);
    /**
     * Tap-focus on touch devices fires `pointerdown` before `focusin`; record
     * it so the focus handler can apply the same touch guard as the hover
     * path.
     */
    const handlePointerDown = (event: PointerEvent): void => this.recordPointer(event);
    const handleMouseEnter = (): void => {
      // Touch users don't hover; a hover tooltip would just cover the tap target.
      if (this.lastPointerType === 'touch') {
        return;
      }

      revealFor(options);
    };
    // Defer the hide so brief trigger exits/re-entries do not flicker.
    const handleMouseLeave = (): void => this.scheduleGraceHide();
    /**
     * Keyboard focus must also surface the tooltip (WCAG 1.4.13). Focus-driven
     * reveals are immediate — the hover `delay` is a pointer affordance and
     * would make keyboard users wait. A focus arriving right after a touch
     * interaction is a tap-focus, not keyboard focus, and stays suppressed
     * (touch guard).
     */
    const handleFocusIn = (): void => {
      if (Date.now() - this.lastTouchTimestamp < TOUCH_FOCUS_SUPPRESS_DURATION) {
        return;
      }

      revealFor({ ...options,
        delay: 0 });
    };
    const handleFocusOut = (): void => this.hide();

    element.addEventListener('pointerenter', handlePointerEnter);
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    element.addEventListener('focusin', handleFocusIn);
    element.addEventListener('focusout', handleFocusOut);

    this.hoverBindings.set(element, () => {
      element.removeEventListener('pointerenter', handlePointerEnter);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
      element.removeEventListener('focusin', handleFocusIn);
      element.removeEventListener('focusout', handleFocusOut);
    });
  }

  /**
   * Record a pointer interaction on a hover target: remembers the pointer
   * type for the hover touch guard and stamps the touch timestamp for the
   * focus-path touch guard.
   * @param {PointerEvent} event - the pointer event to record
   */
  private recordPointer(event: PointerEvent): void {
    this.lastPointerType = event.pointerType;

    if (event.pointerType === 'touch') {
      this.lastTouchTimestamp = Date.now();
    }
  }

  /**
   * Release DOM and event listeners
   */
  public destroy(): void {
    // Orphaned per-trigger handlers check this flag and become no-ops, so
    // they can never re-register the document keydown listener post-destroy.
    this.destroyed = true;

    this.cancelGraceHide();

    if (this.showingTimeout) {
      clearTimeout(this.showingTimeout);
      this.showingTimeout = null;
    }

    document.removeEventListener('keydown', this.handleDocumentKeydown, { capture: true });

    if (this.currentTarget) {
      this.currentTarget.removeAttribute(ARIA_DESCRIBEDBY_ATTRIBUTE);
      this.currentTarget = null;
    }

    this.ariaObserver?.disconnect();
    this.ariaObserver = null;

    if (this.nodes.wrapper) {
      this.nodes.wrapper.remove();
    }

    window.removeEventListener('scroll', this.handleWindowScroll, { capture: true });

    Tooltip.instance = null;
  }

  /**
   * Hide tooltip when page is scrolled
   */
  private handleWindowScroll = (): void => {
    if (this.showed) {
      this.hide();
    }
  };

  /**
   * Module Preparation method
   */
  private prepare(): void {
    this.nodes.wrapper = this.make('div', this.CSS.tooltip);
    this.nodes.wrapper.id = TOOLTIP_ID;
    this.nodes.wrapper.setAttribute(DATA_ATTR.interface, TOOLTIP_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute('data-blok-testid', 'tooltip');
    this.nodes.content = this.make('div', this.CSS.tooltipContent);
    this.nodes.content.setAttribute('data-blok-testid', 'tooltip-content');

    if (this.nodes.wrapper && this.nodes.content) {
      this.nodes.wrapper.setAttribute('data-state', 'closed');

      /**
       * Click-transparency is load-bearing: every blok tooltip carries static
       * text, and the bubble often renders over other interactive controls
       * (e.g. a color-picker swatch's tooltip covers the swatch row above
       * it). A bubble that received pointer events swallowed single clicks
       * on the controls it covered — users could not change an existing
       * highlight color because the active swatch's tooltip sat over the
       * Default swatch. Inline `!important` is required so the rule survives
       * the Top-Layer `all: initial !important` reset (inline !important >
       * author !important), same as the visibility handling in
       * updateTooltipVisibility().
       */
      this.nodes.wrapper.style.setProperty('pointer-events', 'none', 'important');
      this.append(this.nodes.wrapper, this.nodes.content);
      this.append(document.body, this.nodes.wrapper);
      this.ensureTooltipAttributes();
    }
  }

  /**
   * Update tooltip visibility based on shown state
   */
  private updateTooltipVisibility(): void {
    if (!this.nodes.wrapper) {
      return;
    }

    const shownClass = Array.isArray(this.CSS.tooltipShown) ? this.CSS.tooltipShown[0] : this.CSS.tooltipShown;
    const isShown = this.nodes.wrapper.classList.contains(shownClass);

    /**
     * Use `!important` priority when hiding so the inline style wins over the
     * author stylesheet's `all: initial !important` rule (which sets visibility
     * to `visible`). Inline `!important` > author `!important` in the cascade.
     * When showing, normal priority is sufficient (no competing rule sets visible).
     */
    this.nodes.wrapper.style.setProperty(
      VISIBILITY_PROPERTY,
      isShown ? VISIBILITY_VISIBLE : VISIBILITY_HIDDEN,
      isShown ? '' : 'important'
    );
    this.nodes.wrapper.setAttribute(ARIA_HIDDEN_ATTRIBUTE, isShown ? ARIA_HIDDEN_FALSE : ARIA_HIDDEN_TRUE);
    this.nodes.wrapper.setAttribute('data-blok-shown', isShown ? 'true' : 'false');
  }

  /**
   * Watch tooltip visibility changes for accessibility
   */
  private watchTooltipVisibility(): void {
    if (!this.nodes.wrapper) {
      return;
    }

    this.ariaObserver?.disconnect();

    this.updateTooltipVisibility();

    this.ariaObserver = new MutationObserver(() => {
      this.updateTooltipVisibility();
    });

    this.ariaObserver.observe(this.nodes.wrapper, {
      attributes: true,
      attributeFilter: [ 'class' ],
    });
  }

  /**
   * Ensure tooltip has proper accessibility attributes
   */
  private ensureTooltipAttributes(): void {
    if (!this.nodes.wrapper) {
      return;
    }

    if (!this.nodes.wrapper.hasAttribute(DATA_ATTR.interface) || this.nodes.wrapper.getAttribute(DATA_ATTR.interface) !== TOOLTIP_INTERFACE_VALUE) {
      this.nodes.wrapper.setAttribute(DATA_ATTR.interface, TOOLTIP_INTERFACE_VALUE);
    }

    this.nodes.wrapper.setAttribute('role', TOOLTIP_ROLE);
    this.watchTooltipVisibility();
  }



  /**
   * Collision detection: flips the requested placement to its opposite side
   * when the tooltip would overflow the viewport on the preferred side but
   * fits on the alternate one. Reuses the popover module's {@link shouldFlip}
   * predicate so there is a single source of flip math across the editor
   * rather than a tooltip-specific reimplementation.
   * @param {HTMLElement} element - target element the tooltip anchors to
   * @param {string} placement - requested placement
   * @returns {string} the resolved placement
   */
  private resolvePlacement(element: HTMLElement, placement: string): string {
    if (!this.nodes.wrapper) {
      return placement;
    }

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (placement === 'top' || placement === 'bottom') {
      const spaceBelow = viewportHeight - rect.bottom - this.offsetTop;
      const spaceAbove = rect.top - this.offsetTop;
      const preferred = placement === 'bottom' ? spaceBelow : spaceAbove;
      const alternate = placement === 'bottom' ? spaceAbove : spaceBelow;

      if (shouldFlip(this.nodes.wrapper.offsetHeight, preferred, alternate)) {
        return placement === 'bottom' ? 'top' : 'bottom';
      }

      return placement;
    }

    const spaceRight = viewportWidth - rect.right - this.offsetRight;
    const spaceLeft = rect.left - this.offsetLeft;
    const preferred = placement === 'right' ? spaceRight : spaceLeft;
    const alternate = placement === 'right' ? spaceLeft : spaceRight;

    if (shouldFlip(this.nodes.wrapper.offsetWidth, preferred, alternate)) {
      return placement === 'right' ? 'left' : 'right';
    }

    return placement;
  }

  /**
   * Calculates element coords and moves tooltip bottom of the element
   * @param {HTMLElement} element - target element
   * @param {TooltipOptions} showingOptions - placement options
   */
  private placeBottom(element: HTMLElement, showingOptions: TooltipOptions): void {
    if (!this.nodes.wrapper) {
      return;
    }

    const elementCoords = element.getBoundingClientRect();
    const left = elementCoords.left + element.clientWidth / 2 - this.nodes.wrapper.offsetWidth / 2;
    const top = elementCoords.bottom + this.getScrollTop() + this.offsetTop + (showingOptions.marginTop ?? 0);

    this.applyPlacement('bottom', left, top);
  }

  /**
   * Calculates element coords and moves tooltip top of the element
   * @param {HTMLElement} element - target element
   * @param {TooltipOptions} _showingOptions - placement options (unused for top placement)
   */
  private placeTop(element: HTMLElement, _showingOptions: TooltipOptions): void {
    if (!this.nodes.wrapper) {
      return;
    }

    const elementCoords = element.getBoundingClientRect();
    const left = elementCoords.left + element.clientWidth / 2 - this.nodes.wrapper.offsetWidth / 2;
    const top = elementCoords.top + this.getScrollTop() - this.nodes.wrapper.clientHeight - this.offsetTop;

    this.applyPlacement('top', left, top);
  }

  /**
   * Calculates element coords and moves tooltip left of the element
   * @param {HTMLElement} element - target element
   * @param {TooltipOptions} showingOptions - placement options
   */
  private placeLeft(element: HTMLElement, showingOptions: TooltipOptions): void {
    if (!this.nodes.wrapper) {
      return;
    }

    const elementCoords = element.getBoundingClientRect();
    const left = elementCoords.left - this.nodes.wrapper.offsetWidth - this.offsetLeft - (showingOptions.marginLeft ?? 0);
    const top = elementCoords.top + this.getScrollTop() + element.clientHeight / 2 - this.nodes.wrapper.offsetHeight / 2;

    this.applyPlacement('left', left, top);
  }

  /**
   * Calculates element coords and moves tooltip right of the element
   * @param {HTMLElement} element - target element
   * @param {TooltipOptions} showingOptions - placement options
   */
  private placeRight(element: HTMLElement, showingOptions: TooltipOptions): void {
    if (!this.nodes.wrapper) {
      return;
    }

    const elementCoords = element.getBoundingClientRect();
    const left = elementCoords.right + this.offsetRight + (showingOptions.marginRight ?? 0);
    const top = elementCoords.top + this.getScrollTop() + element.clientHeight / 2 - this.nodes.wrapper.offsetHeight / 2;

    this.applyPlacement('right', left, top);
  }

  /**
   * Set wrapper position
   * @param {string} place - placement direction
   * @param {number} left - left position in pixels
   * @param {number} top - top position in pixels
   */
  private applyPlacement(place: 'top' | 'bottom' | 'left' | 'right', left: number, top: number): void {
    if (!this.nodes.wrapper) {
      return;
    }

    this.nodes.wrapper.setAttribute('data-blok-placement', place);
    // `data-side` mirrors the resolved side for CSS animation/arrow styling,
    // matching the Radix convention.
    this.nodes.wrapper.setAttribute('data-side', place);

    /**
     * Clamp both axes to the viewport so the bubble never spills off-screen
     * near an edge. Uses the same viewport-edge clamp philosophy as the
     * popover positioner; `fixed` positioning keeps these coords
     * viewport-relative.
     */
    const clampedLeft = Math.max(0, Math.min(left, window.innerWidth - this.nodes.wrapper.offsetWidth));
    const clampedTop = Math.max(0, Math.min(top, window.innerHeight - this.nodes.wrapper.offsetHeight));

    this.nodes.wrapper.style.left = `${clampedLeft}px`;
    this.nodes.wrapper.style.top = `${clampedTop}px`;
  }

  /**
   * Scroll offset to add to placement math.
   *
   * Always 0. The wrapper is `position: fixed`, so its containing block is
   * the viewport regardless of Top-Layer promotion — and
   * `getBoundingClientRect()` is already viewport-relative. Adding `scrollY`
   * would double-count the offset and push the tooltip off-screen on any
   * scrolled page. Kept as a method (not inlined) so future placements have
   * a single chokepoint to revisit if the positioning model ever changes.
   */
  private getScrollTop(): number {
    return 0;
  }

  /**
   * Helper for making Elements with classname and attributes
   * @param  {string} tagName           - new Element tag name
   * @param  {Array<string>|string} classNames  - list or name of CSS classname(s)
   * @param  {object} attributes        - any attributes
   * @returns {HTMLElement}
   */
  private make(tagName: string, classNames: string | string[] | null = null, attributes: Record<string, unknown> = {}): HTMLElement {
    const el = document.createElement(tagName);

    if (Array.isArray(classNames)) {
      el.classList.add(...classNames);
    }

    if (typeof classNames === 'string') {
      el.classList.add(classNames);
    }

    for (const attrName in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, attrName)) {
        (el as unknown as Record<string, unknown>)[attrName] = attributes[attrName];
      }
    }

    return el;
  }

  /**
   * Append one or several elements to the parent
   * @param  {Element|DocumentFragment} parent    - where to append
   * @param  {Element|Element[]} elements - element or elements list
   */
  private append(parent: Element | DocumentFragment, elements: Element | Element[] | DocumentFragment): void {
    if (Array.isArray(elements)) {
      elements.forEach((el) => parent.appendChild(el));
    } else {
      parent.appendChild(elements);
    }
  }

}

/**
 * Get singleton tooltip instance
 */
const getTooltip = (): Tooltip => {
  return Tooltip.getInstance();
};

/**
 * Show tooltip near element with specified content
 * @param {HTMLElement} element - target element to place tooltip near
 * @param {TooltipContent} content - tooltip content
 * @param {TooltipOptions} options - tooltip options
 */
export const show = (element: HTMLElement, content: TooltipContent, options?: TooltipOptions): void => {
  getTooltip().show(element, content, options ?? {});
};

/**
 * Hide tooltip
 */
export const hide = (): void => {
  getTooltip().hide();
};

/**
 * Show tooltip on hover (mouseenter/mouseleave)
 * @param {HTMLElement} element - target element to place tooltip near
 * @param {TooltipContent} content - tooltip content
 * @param {TooltipOptions} options - tooltip options
 */
export const onHover = (element: HTMLElement, content: TooltipContent, options?: TooltipOptions): void => {
  getTooltip().onHover(element, content, options ?? {});
};

/**
 * Destroy tooltip instance and clean up
 */
export const destroy = (): void => {
  getTooltip().destroy();
};
