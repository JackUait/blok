import { DATA_ATTR } from '../../constants/data-attributes';
import { Dom } from '../../dom';
import { Flipper } from '../../flipper';
import { keyCodes } from '../../utils';
import { ScrollLocker } from '../scroll-locker';
import { twMerge } from '../tw';

import { PopoverHeader } from './components/popover-header';
import type { PopoverItem, PopoverItemParams } from './components/popover-item';
import { PopoverItemDefault, css as popoverItemCls, PopoverItemType } from './components/popover-item';
import { PopoverItemHtml } from './components/popover-item/popover-item-html/popover-item-html';
import { PopoverAbstract } from './popover-abstract';
import { css } from './popover.const';
import { PopoverStatesHistory } from './utils/popover-states-history';

import type { PopoverMobileNodes, PopoverParams } from '@/types/utils/popover/popover';




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
   * Flipper - drives keyboard navigation (arrows/Tab/Enter) over the sheet's
   * items. Reused across page swaps: re-activated with the new item list when
   * the sheet navigates into or out of a nested "page".
   */
  private flipper: Flipper;

  /**
   * Element that had DOM focus before the sheet opened (usually the
   * contenteditable block holding the caret). Focus is returned to it when
   * the sheet closes, so keyboard and AT users are not stranded.
   */
  private previouslyFocusedElement: HTMLElement | null = null;

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

    // The sheet's items wrapper takes real DOM focus while the sheet is open
    // (Radix Dialog/Drawer behaviour). Without it, keydowns keep targeting the
    // contenteditable block behind the sheet and the flipper skips them.
    this.nodes.items.tabIndex = -1;

    this.flipper = new Flipper({
      items: this.flippableElements,
      focusedItemClass: popoverItemCls.focused,
      // Mirror the flipper's virtual focus onto the really-focused items
      // wrapper so screen readers can follow keyboard navigation.
      activeDescendantHost: this.nodes.items,
      allowedKeys: [
        keyCodes.TAB,
        keyCodes.UP,
        keyCodes.DOWN,
        keyCodes.ENTER,
        keyCodes.RIGHT,
        keyCodes.LEFT,
      ],
      // ArrowLeft mirrors the header back button: step out of a nested page.
      onArrowLeft: () => this.navigateBack(),
    });
  }

  /**
   * Returns the list of item elements available for keyboard navigation.
   */
  private get flippableElements(): HTMLElement[] {
    return this.items
      .flatMap(item => this.getFlippableElementsForItem(item))
      .filter((element): element is HTMLElement => element !== null && element !== undefined);
  }

  /**
   * Resolves the navigable element(s) for a single item, skipping separators
   * and disabled items.
   * @param item - popover item to resolve elements for
   */
  private getFlippableElementsForItem(item: PopoverItem): HTMLElement[] {
    if (item instanceof PopoverItemHtml) {
      const controls = item.getControls();

      if (controls.length > 0) {
        return controls;
      }

      const element = item.getElement();

      return element ? [ element ] : [];
    }

    if (!(item instanceof PopoverItemDefault) || item.isDisabled) {
      return [];
    }

    const element = item.getElement();

    return element ? [ element ] : [];
  }

  /**
   * Steps one level back in the sheet's page history (mirrors the header back
   * button). No-op at the root level, where there is nothing to go back to.
   */
  private navigateBack(): void {
    if (this.header === null || this.header === undefined) {
      return;
    }

    this.history.pop();
    this.updateItemsAndHeader(this.history.currentItems, this.history.currentTitle);
  }

  /**
   * Open popover
   */
  public show(): void {
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    this.nodes.overlay.removeAttribute(DATA_ATTR.overlayHidden);
    this.nodes.overlay.className = twMerge(css.popoverOverlay, 'fixed inset-0 block visible z-3 opacity-50');

    super.show();

    // Apply mobile opened state classes AFTER super.show() to override base class styles
    // For mobile, we use max-h-none instead of max-h-(--max-height) since mobile popovers
    // should expand to fit their content
    // Use z-4 to ensure container is above the overlay (z-[3])
    this.nodes.popoverContainer.className = twMerge(
      css.popoverContainer,
      css.popoverContainerMobile,
      css.popoverContainerOpened,
      'max-h-none z-4'
    );

    this.scrollLocker.lock();

    this.isHidden = false;

    // Move focus into the sheet so keyboard users land on the first item
    // (Radix Dialog/Drawer behaviour). The flipper drives virtual focus over
    // the current page's items.
    this.flipper.activate(this.flippableElements);
    this.flipper.focusItem(0, { skipNextTab: true });

    // Take real DOM focus so keydowns target the sheet (not the block behind
    // it) and AT perceives focus as inside the dialog.
    this.nodes.items.focus();
  }

  /**
   * Closes popover
   */
  public hide(): void {
    if (this.isHidden) {
      return;
    }

    super.hide();

    this.flipper.deactivate();

    this.restorePreviousFocus();

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
    this.flipper.deactivate();

    this.restorePreviousFocus();

    super.destroy();

    if (this.scrollLocker.isLocked) {
      this.scrollLocker.unlock();
    }
  }

  /**
   * Returns DOM focus to the element that was focused before the sheet
   * opened, if it is still attached to the document.
   */
  private restorePreviousFocus(): void {
    const previous = this.previouslyFocusedElement;

    this.previouslyFocusedElement = null;

    if (previous !== null && previous.isConnected) {
      previous.focus();
    }
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
        backButtonLabel: this.messages.back,
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

    // Name the sheet's menu by its header title (aria-labelledby), and drop the
    // association when returning to the header-less root page.
    if (this.header !== null && this.header !== undefined) {
      this.nodes.items.setAttribute('aria-labelledby', this.header.getTitleId());
    } else {
      this.nodes.items.removeAttribute('aria-labelledby');
    }

    // Announce the page the user just navigated to. The header title names a
    // nested page; the root page has no title so nothing is announced.
    if (title !== undefined) {
      this.announcePageTitle(title);
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

    // Re-activate the flipper over the freshly-rendered page so keyboard
    // navigation keeps working after the swap, and move focus to the first item.
    this.flipper.deactivate();
    this.flipper.activate(this.flippableElements);
    this.flipper.focusItem(0, { skipNextTab: true });
  }

  /**
   * Writes the current page title into the visually-hidden results announcer so
   * screen readers hear the page change during in-place sheet navigation.
   * @param title - title of the page navigated to
   */
  private announcePageTitle(title: string): void {
    const announcer = this.nodes.resultsAnnouncer;

    if (announcer === undefined) {
      return;
    }

    announcer.textContent = title;
  }
}
