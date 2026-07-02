import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../constants';

import { shouldFlip } from './popover/popover-position';
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
 * hiding. It gives the pointer time to travel onto the (now hoverable) bubble
 * without the tooltip vanishing — the "hoverable" half of WCAG 1.4.13.
 */
const GRACE_HIDE_DURATION = 100;
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
         * `pointer-events-none` is deliberately omitted: the bubble must be
         * hoverable so the pointer can travel onto it without dismissing the
         * tooltip (WCAG 1.4.13 "hoverable"). While hidden the wrapper carries
         * `visibility: hidden`, which already blocks pointer interaction.
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
   * Deferred-hide timer armed when the pointer leaves the trigger. Cleared if
   * the pointer reaches the bubble within {@link GRACE_HIDE_DURATION} so the
   * bubble stays hoverable (WCAG 1.4.13).
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

    window.addEventListener('scroll', this.handleWindowScroll, { passive: true });
  }

  /**
   * Show Tooltip near passed element with specified HTML content
   * @param {HTMLElement} element - target element to place Tooltip near that
   * @param {TooltipContent} content — any HTML Element of String that will be used as content
   * @param {TooltipOptions} options — Available options {@link TooltipOptions}
   */
  public show(element: HTMLElement, content: TooltipContent, options: TooltipOptions = {}): void {
    if (!this.nodes.wrapper) {
      this.prepare();
    }

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
    // Stamp the hide time so an imminent re-show can skip its open delay.
    this.lastHideTimestamp = Date.now();
  }

  /**
   * Arm the grace timer that hides the tooltip after {@link GRACE_HIDE_DURATION}.
   * Called when the pointer leaves either the trigger or the bubble, so the
   * pointer has time to travel between them without the tooltip vanishing.
   */
  private scheduleGraceHide(): void {
    this.cancelGraceHide();

    this.graceHideTimeout = setTimeout(() => {
      this.graceHideTimeout = null;
      this.hide();
    }, GRACE_HIDE_DURATION);
  }

  /**
   * Cancel a pending grace hide (e.g. the pointer reached the bubble in time).
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
    const handlePointerEnter = (event: PointerEvent): void => {
      this.lastPointerType = event.pointerType;
    };
    const handleMouseEnter = (): void => {
      // Touch users don't hover; a hover tooltip would just cover the tap target.
      if (this.lastPointerType === 'touch') {
        return;
      }

      revealFor(options);
    };
    // Defer the hide so the pointer can travel onto the hoverable bubble.
    const handleMouseLeave = (): void => this.scheduleGraceHide();
    /**
     * Keyboard focus must also surface the tooltip (WCAG 1.4.13). Focus-driven
     * reveals are immediate — the hover `delay` is a pointer affordance and
     * would make keyboard users wait.
     */
    const handleFocusIn = (): void => revealFor({ ...options,
      delay: 0 });
    const handleFocusOut = (): void => this.hide();

    element.addEventListener('pointerenter', handlePointerEnter);
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    element.addEventListener('focusin', handleFocusIn);
    element.addEventListener('focusout', handleFocusOut);

    this.hoverBindings.set(element, () => {
      element.removeEventListener('pointerenter', handlePointerEnter);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
      element.removeEventListener('focusin', handleFocusIn);
      element.removeEventListener('focusout', handleFocusOut);
    });
  }

  /**
   * Release DOM and event listeners
   */
  public destroy(): void {
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

    window.removeEventListener('scroll', this.handleWindowScroll);

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
       * Hoverable bubble (WCAG 1.4.13): moving the pointer onto the tooltip
       * itself keeps it open (cancels the pending grace hide); leaving the
       * bubble re-arms the grace hide.
       */
      this.nodes.wrapper.addEventListener('mouseenter', this.handleBubbleEnter);
      this.nodes.wrapper.addEventListener('mouseleave', this.handleBubbleLeave);
      this.append(this.nodes.wrapper, this.nodes.content);
      this.append(document.body, this.nodes.wrapper);
      this.ensureTooltipAttributes();
    }
  }

  /**
   * Pointer entered the bubble — keep it open by cancelling the grace hide.
   */
  private handleBubbleEnter = (): void => {
    this.cancelGraceHide();
  };

  /**
   * Pointer left the bubble — arm the grace hide.
   */
  private handleBubbleLeave = (): void => {
    this.scheduleGraceHide();
  };

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
