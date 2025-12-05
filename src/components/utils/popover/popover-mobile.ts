import { PopoverAbstract } from './popover-abstract';
import ScrollLocker from '../scroll-locker';
import { PopoverHeader } from './components/popover-header';
import { PopoverStatesHistory } from './utils/popover-states-history';
import type { PopoverMobileNodes, PopoverParams } from '@/types/utils/popover/popover';
import type { PopoverItemDefault, PopoverItemParams } from './components/popover-item';
import { PopoverItemType } from './components/popover-item';
import { css, DATA_ATTR } from './popover.const';
import Dom from '../../dom';
import { twMerge } from '../tw';


/**
 * Mobile Popover.
 * On mobile devices Popover behaves like a fixed panel at the bottom of screen. Nested item appears like "pages" with the "back" button
 */
export class PopoverMobile extends PopoverAbstract<PopoverMobileNodes> {
  /**
   * ScrollLocker instance
   */
  private scrollLocker = new ScrollLocker();

  /**
   * Reference to popover header if exists
   */
  private header: PopoverHeader | undefined | null;

  /**
   * History of popover states for back navigation.
   * Is used for mobile version of popover,
   * where we can not display nested popover of the screen and
   * have to render nested items in the same popover switching to new state
   */
  private history = new PopoverStatesHistory();

  /**
   * Flag that indicates if popover is hidden
   */
  private isHidden = true;

  /**
   * Construct the instance
   * @param params - popover params
   */
  constructor(params: PopoverParams) {
    super(params, {
      [PopoverItemType.Default]: {
        hint: {
          enabled: false,
        },
      },
      [PopoverItemType.Html]: {
        hint: {
          enabled: false,
        },
      },
    });

    this.nodes.overlay = Dom.make('div', [css.popoverOverlay], {
      [DATA_ATTR.popoverOverlay]: '',
      [DATA_ATTR.overlayHidden]: '',
      'data-blok-testid': 'popover-overlay',
    });
    this.nodes.popover.insertBefore(this.nodes.overlay, this.nodes.popover.firstChild);

    this.listeners.on(this.nodes.overlay, 'click', () => {
      this.hide();
    });

    /* Save state to history for proper navigation between nested and parent popovers */
    this.history.push({ items: params.items });

    // Set mobile offset CSS variable (moved from popover.css @screen mobile rule)
    this.nodes.popoverContainer.style.setProperty('--offset', '5px');

    // Apply mobile-specific classes to container
    this.nodes.popoverContainer.className = twMerge(
      css.popoverContainer,
      css.popoverContainerMobile
    );
  }

  /**
   * Open popover
   */
  public show(): void {
    this.nodes.overlay.removeAttribute(DATA_ATTR.overlayHidden);
    this.nodes.overlay.className = twMerge(css.popoverOverlay, 'fixed inset-0 block visible z-[3] opacity-50 transition-opacity duration-[120ms] ease-in will-change-[opacity]');

    super.show();

    // Apply mobile opened state classes AFTER super.show() to override base class styles
    this.nodes.popoverContainer.className = twMerge(
      css.popoverContainer,
      css.popoverContainerMobile,
      css.popoverContainerOpened,
      'animate-[panelShowingMobile_250ms_ease]'
    );

    this.scrollLocker.lock();

    this.isHidden = false;
  }

  /**
   * Closes popover
   */
  public hide(): void {
    if (this.isHidden) {
      return;
    }

    super.hide();
    this.nodes.overlay.setAttribute(DATA_ATTR.overlayHidden, '');
    this.nodes.overlay.className = css.popoverOverlay;

    // Reset to mobile base closed state
    this.nodes.popoverContainer.className = twMerge(
      css.popoverContainer,
      css.popoverContainerMobile
    );

    this.scrollLocker.unlock();

    this.history.reset();

    this.isHidden = true;
  }

  /**
   * Clears memory
   */
  public destroy(): void {
    super.destroy();

    this.scrollLocker.unlock();
  }

  /**
   * Handles displaying nested items for the item
   * @param item – item to show nested popover for
   */
  protected override showNestedItems(item: PopoverItemDefault): void {
    /** Show nested items */
    this.updateItemsAndHeader(item.children, item.title);

    this.history.push({
      title: item.title,
      items: item.children,
    });
  }

  /**
   * Removes rendered popover items and header and displays new ones
   * @param items - new popover items
   * @param title - new popover header text
   */
  private updateItemsAndHeader(items: PopoverItemParams[], title?: string ): void {
    /** Re-render header */
    if (this.header !== null && this.header !== undefined) {
      this.header.destroy();
      this.header = null;
    }
    const shouldRenderHeader = title !== undefined;

    if (shouldRenderHeader) {
      this.header = new PopoverHeader({
        text: title,
        onBackButtonClick: () => {
          this.history.pop();

          this.updateItemsAndHeader(this.history.currentItems, this.history.currentTitle);
        },
      });
    }

    const headerElement = this.header?.getElement() ?? null;

    if (shouldRenderHeader && headerElement !== null) {
      this.nodes.popoverContainer.insertBefore(headerElement, this.nodes.popoverContainer.firstChild);
    }

    /** Re-render items */
    this.items.forEach(item => item.getMountElement?.()?.remove());

    this.items = this.buildItems(items);

    this.items.forEach(item => {
      const itemEl = item.getMountElement?.() ?? item.getElement();

      if (itemEl === null) {
        return;
      }
      this.nodes.items?.appendChild(itemEl);
    });
  }
}
