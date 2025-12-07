import { DATA_INTERFACE_ATTRIBUTE, TOOLTIP_INTERFACE_VALUE } from '../constants';
import { twJoin } from './tw';

/**
 * Tooltip supported content
 */
export type TooltipContent = HTMLElement | DocumentFragment | Node | string;

/**
 * Base options interface for tooltips
 */
export interface TooltipOptions {
  /**
   * Tooltip placement: top|bottom|left|right
   */
  placement?: string;

  /**
   * Tooltip top margin
   */
  marginTop?: number;

  /**
   * Tooltip left margin
   */
  marginLeft?: number;

  /**
   * Tooltip right margin
   */
  marginRight?: number;

  /**
   * Tooltip bottom margin
   */
  marginBottom?: number;

  /**
   * Timout before showing
   */
  delay?: number;

  /**
   * Timout before hiding
   */
  hidingDelay?: number;
}

const DEFAULT_OFFSET = 10;
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
  placement: {
    left: string | string[];
    bottom: string | string[];
    right: string | string[];
    top: string | string[];
  };
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
        'absolute z-overlay top-0 left-0',
        'bg-tooltip-bg opacity-0',
        'select-none pointer-events-none',
        'transition-[opacity,transform] duration-[50ms,70ms] ease-in',
        'rounded-lg shadow-tooltip',
        'will-change-[opacity,top,left]',
        'before:content-[\'\'] before:absolute before:inset-0 before:bg-tooltip-bg before:-z-10 before:rounded-lg',
        'mobile:hidden'
      ).split(' '),
      tooltipContent: twJoin(
        'px-2.5 py-1.5',
        'text-tooltip-font text-xs text-center',
        'tracking-[0.02em] leading-[1em]'
      ).split(' '),
      tooltipShown: ['opacity-100', 'transform-none'],
      placement: {
        left: ['-translate-x-[5px]'],
        bottom: ['translate-y-[5px]'],
        right: ['translate-x-[5px]'],
        top: ['-translate-y-[5px]'],
      },
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
   * How many milliseconds need to wait before hiding
   */
  private hidingDelay: number = 0;

  /**
   * Store timeout before hiding
   */
  private hidingTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * MutationObserver for watching tooltip visibility changes
   */
  private ariaObserver: MutationObserver | null = null;

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

    if (this.hidingTimeout) {
      clearTimeout(this.hidingTimeout);
      this.hidingTimeout = null;
    }

    const basicOptions = {
      placement: 'bottom',
      marginTop: 0,
      marginLeft: 0,
      marginRight: 0,
      marginBottom: 0,
      delay: 70,
      hidingDelay: 0,
    };
    const showingOptions = Object.assign(basicOptions, options);

    if (showingOptions.hidingDelay) {
      this.hidingDelay = showingOptions.hidingDelay;
    }

    if (!this.nodes.content) {
      return;
    }

    this.nodes.content.innerHTML = '';
    this.nodes.content.appendChild(this.createContentNode(content));

    if (!this.nodes.wrapper) {
      return;
    }

    // Flatten the placement classes (each can be a string or array) before removing
    const placementClasses = Object.values(this.CSS.placement).flatMap(cls => Array.isArray(cls) ? cls : [cls]);

    this.nodes.wrapper.classList.remove(...placementClasses);

    switch (showingOptions.placement) {
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

    if (showingOptions && showingOptions.delay) {
      this.showingTimeout = setTimeout(() => {
        if (this.nodes.wrapper) {
          const classes = Array.isArray(this.CSS.tooltipShown) ? this.CSS.tooltipShown : [this.CSS.tooltipShown];

          this.nodes.wrapper.classList.add(...classes);
          this.updateTooltipVisibility();
        }
        this.showed = true;
      }, showingOptions.delay);

      return;
    }

    if (this.nodes.wrapper) {
      const classes = Array.isArray(this.CSS.tooltipShown) ? this.CSS.tooltipShown : [this.CSS.tooltipShown];

      this.nodes.wrapper.classList.add(...classes);
      this.updateTooltipVisibility();
    }
    this.showed = true;
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
   * @param {boolean} skipDelay - forces hiding immediately
   */
  public hide(skipDelay: boolean = false): void {
    const shouldDelay = Boolean(this.hidingDelay) && !skipDelay;

    if (shouldDelay && this.hidingTimeout) {
      clearTimeout(this.hidingTimeout);
    }

    if (shouldDelay) {
      this.hidingTimeout = setTimeout(() => {
        this.hide(true);
      }, this.hidingDelay);

      return;
    }

    if (this.nodes.wrapper) {
      const classes = Array.isArray(this.CSS.tooltipShown) ? this.CSS.tooltipShown : [this.CSS.tooltipShown];

      this.nodes.wrapper.classList.remove(...classes);
      this.updateTooltipVisibility();
    }
    this.showed = false;

    if (this.showingTimeout) {
      clearTimeout(this.showingTimeout);
      this.showingTimeout = null;
    }
  }

  /**
   * Mouseover/Mouseleave decorator
   * @param {HTMLElement} element - target element to place Tooltip near that
   * @param {TooltipContent} content — any HTML Element of String that will be used as content
   * @param {TooltipOptions} options — Available options {@link TooltipOptions}
   */
  public onHover(element: HTMLElement, content: TooltipContent, options: TooltipOptions = {}): void {
    element.addEventListener('mouseenter', () => {
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

      this.show(element, content, options);
    });
    element.addEventListener('mouseleave', () => {
      this.hide();
    });
  }

  /**
   * Release DOM and event listeners
   */
  public destroy(): void {
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
      this.hide(true);
    }
  };

  /**
   * Module Preparation method
   */
  private prepare(): void {
    this.nodes.wrapper = this.make('div', this.CSS.tooltip);
    this.nodes.wrapper.setAttribute(DATA_INTERFACE_ATTRIBUTE, TOOLTIP_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute('data-blok-testid', 'tooltip');
    this.nodes.content = this.make('div', this.CSS.tooltipContent);
    this.nodes.content.setAttribute('data-blok-testid', 'tooltip-content');

    if (this.nodes.wrapper && this.nodes.content) {
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

    this.nodes.wrapper.style.setProperty(VISIBILITY_PROPERTY, isShown ? VISIBILITY_VISIBLE : VISIBILITY_HIDDEN);
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

    if (!this.nodes.wrapper.hasAttribute(DATA_INTERFACE_ATTRIBUTE) || this.nodes.wrapper.getAttribute(DATA_INTERFACE_ATTRIBUTE) !== TOOLTIP_INTERFACE_VALUE) {
      this.nodes.wrapper.setAttribute(DATA_INTERFACE_ATTRIBUTE, TOOLTIP_INTERFACE_VALUE);
    }

    this.nodes.wrapper.setAttribute('role', TOOLTIP_ROLE);
    this.watchTooltipVisibility();
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

    const classes = Array.isArray(this.CSS.placement[place]) ? this.CSS.placement[place] : [this.CSS.placement[place]];

    this.nodes.wrapper.classList.add(...classes);
    this.nodes.wrapper.setAttribute('data-blok-placement', place);

    this.nodes.wrapper.style.left = `${left}px`;
    this.nodes.wrapper.style.top = `${top}px`;
  }

  /**
   * Get current page vertical scroll offset
   */
  private getScrollTop(): number {
    if (typeof window.scrollY === 'number') {
      return window.scrollY;
    }

    return document.documentElement?.scrollTop ?? document.body.scrollTop ?? 0;
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

  /**
   * Append element or a couple to the beginning of the parent elements
   * @param {Element} parent - where to append
   * @param {Element|Element[]} elements - element or elements list
   */
  private prepend(parent: Element, elements: Element | Element[]): void {
    if (Array.isArray(elements)) {
      const reversed = elements.reverse();

      reversed.forEach((el) => parent.prepend(el));
    } else {
      parent.prepend(elements);
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
 * @param {boolean} skipHidingDelay - forces hiding immediately
 */
export const hide = (skipHidingDelay = false): void => {
  getTooltip().hide(skipHidingDelay);
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
