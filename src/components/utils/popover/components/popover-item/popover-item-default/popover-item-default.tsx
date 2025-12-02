import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type {
  PopoverItemDefaultParams as PopoverItemDefaultParams,
  PopoverItemRenderParamsMap,
  PopoverItemType
} from '@/types/utils/popover/popover-item';
import { PopoverItem } from '../popover-item';
import { css, cssInline, cssNestedInline, DATA_ATTR } from './popover-item-default.const';
import { PopoverItemDefaultComponent } from './PopoverItemDefaultComponent';
import { twMerge } from '../../../../tw';

/**
 * Selector for icon element
 */
const ICON_SELECTOR = '[data-blok-testid="popover-item-icon"]';

/**
 * Creates a temporary container and renders React component to extract the element
 * Uses flushSync to ensure synchronous rendering for immediate DOM access
 * @param component - React component to render
 */
const renderToElement = (component: React.ReactNode): HTMLElement => {
  const container = document.createElement('div');
  const root = createRoot(container);

  flushSync(() => {
    root.render(component);
  });

  const element = container.firstElementChild as HTMLElement;

  // Unmount React after extracting the element to avoid memory leaks
  root.unmount();

  return element;
};

/**
 * Represents single popover item node
 * @todo replace multiple make() usages with constructing separate instances
 * @todo split regular popover item and popover item with confirmation to separate classes
 * @todo display icon on the right side of the item for rtl languages
 */
export class PopoverItemDefault extends PopoverItem {
  /**
   * True if item is disabled and hence not clickable
   */
  public get isDisabled(): boolean {
    return this.params.isDisabled === true;
  }

  /**
   * Exposes popover item toggle parameter
   */
  public get toggle(): boolean | string | undefined {
    return this.params.toggle;
  }

  /**
   * Item title
   */
  public get title(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: remove this once label is removed
    return this.params.title || this.params.label;
  }

  /**
   * True if confirmation state is enabled for popover item
   */
  public get isConfirmationStateEnabled(): boolean {
    return this.confirmationState !== null;
  }

  /**
   * True if item is focused in keyboard navigation process
   */
  public get isFocused(): boolean {
    if (this.nodes.root === null) {
      return false;
    }

    return this.nodes.root.hasAttribute(DATA_ATTR.focused);
  }

  /**
   * Item html elements
   */
  private nodes: {
    root: null | HTMLElement,
    icon: null | HTMLElement
  } = {
      root: null,
      icon: null,
    };

  /**
   * If item is in confirmation state, stores confirmation params such as icon, label, onActivate callback and so on
   */
  private confirmationState: PopoverItemDefaultParams | null = null;

  /**
   * Render params passed during construction, stored for re-rendering
   */
  private readonly renderParams: PopoverItemRenderParamsMap[PopoverItemType.Default] | undefined;

  /**
   * Constructs popover item instance
   * @param params - popover item construction params
   * @param renderParams - popover item render params.
   * The parameters that are not set by user via popover api but rather depend on technical implementation
   */
  constructor(protected readonly params: PopoverItemDefaultParams, renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Default]) {
    super(params);

    this.renderParams = renderParams;
    this.nodes.root = this.make(params, renderParams);
  }

  /**
   * Returns popover item root element
   */
  public getElement(): HTMLElement | null {
    return this.nodes.root;
  }

  /**
   * Called on popover item click
   */
  public handleClick(): void {
    if (this.isConfirmationStateEnabled && this.confirmationState !== null) {
      this.activateOrEnableConfirmationMode(this.confirmationState);

      return;
    }

    this.activateOrEnableConfirmationMode(this.params);
  }

  /**
   * Toggles item active state
   * @param isActive - true if item should strictly should become active
   */
  public toggleActive(isActive?: boolean): void {
    if (this.nodes.root === null) {
      return;
    }

    const shouldBeActive = isActive !== undefined ? isActive : !this.nodes.root.hasAttribute(DATA_ATTR.active);

    if (shouldBeActive) {
      this.nodes.root.setAttribute(DATA_ATTR.active, 'true');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.active);
    }

    this.updateRootClasses();
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public override toggleHidden(isHidden: boolean): void {
    if (isHidden) {
      this.nodes.root?.setAttribute(DATA_ATTR.hidden, 'true');
    } else {
      this.nodes.root?.removeAttribute(DATA_ATTR.hidden);
    }

    this.updateRootClasses();
  }

  /**
   * Resets popover item to its original state
   */
  public reset(): void {
    if (this.isConfirmationStateEnabled) {
      this.disableConfirmationMode();
    }
  }

  /**
   * Method called once item becomes focused during keyboard navigation
   */
  public onFocus(): void {
    this.disableSpecialHoverAndFocusBehavior();
  }

  /**
   * Constructs HTML element corresponding to popover item params
   * @param params - item construction params
   * @param renderParams - popover item render params
   */
  private make(params: PopoverItemDefaultParams, renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Default]): HTMLElement {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: remove this once label is removed
    const title = params.title || params.label;

    const el = renderToElement(
      <PopoverItemDefaultComponent
        icon={params.icon}
        title={title}
        secondaryLabel={params.secondaryLabel}
        isActive={this.isActive}
        isDisabled={params.isDisabled}
        hasChildren={this.hasChildren}
        hideChevron={this.isChevronHidden}
        wrapperTag={renderParams?.wrapperTag}
        name={params.name}
        iconWithGap={renderParams?.iconWithGap}
        isInline={renderParams?.isInline}
        isNestedInline={renderParams?.isNestedInline}
      />
    );

    // Store reference to icon element
    this.nodes.icon = el.querySelector(ICON_SELECTOR);

    if (params.hint !== undefined && renderParams?.hint?.enabled !== false) {
      this.addHint(el, {
        ...params.hint,
        position: renderParams?.hint?.position || 'right',
        alignment: renderParams?.hint?.alignment || 'center',
      });
    }

    return el;
  }

  /**
   * Activates confirmation mode for the item.
   * @param newState - new popover item params that should be applied
   */
  private enableConfirmationMode(newState: PopoverItemDefaultParams): void {
    if (this.nodes.root === null) {
      return;
    }

    const params = {
      ...this.params,
      ...newState,
      confirmation: 'confirmation' in newState ? newState.confirmation : undefined,
    } as PopoverItemDefaultParams;
    const confirmationEl = this.make(params, this.renderParams);

    this.nodes.root.innerHTML = confirmationEl.innerHTML;
    this.nodes.root.setAttribute(DATA_ATTR.confirmation, 'true');

    // Update icon reference after innerHTML change
    this.nodes.icon = this.nodes.root.querySelector(ICON_SELECTOR);

    this.confirmationState = newState;

    this.enableSpecialHoverAndFocusBehavior();
    this.updateRootClasses();
  }

  /**
   * Returns item to its original state
   */
  private disableConfirmationMode(): void {
    if (this.nodes.root === null) {
      return;
    }
    const itemWithOriginalParams = this.make(this.params, this.renderParams);

    this.nodes.root.innerHTML = itemWithOriginalParams.innerHTML;
    this.nodes.root.removeAttribute(DATA_ATTR.confirmation);

    // Update icon reference after innerHTML change
    this.nodes.icon = this.nodes.root.querySelector(ICON_SELECTOR);

    this.confirmationState = null;

    this.disableSpecialHoverAndFocusBehavior();
    this.updateRootClasses();
  }

  /**
   * Enables special focus and hover behavior for item in confirmation state.
   * This is needed to prevent item from being highlighted as hovered/focused just after click.
   */
  private enableSpecialHoverAndFocusBehavior(): void {
    this.nodes.root?.setAttribute(DATA_ATTR.noHover, 'true');
    this.nodes.root?.setAttribute(DATA_ATTR.noFocus, 'true');

    this.nodes.root?.addEventListener('mouseleave', this.removeSpecialHoverBehavior, { once: true });
  }

  /**
   * Disables special focus and hover behavior
   */
  private disableSpecialHoverAndFocusBehavior(): void  {
    this.removeSpecialFocusBehavior();
    this.removeSpecialHoverBehavior();

    this.nodes.root?.removeEventListener('mouseleave', this.removeSpecialHoverBehavior);
  }

  /**
   * Removes class responsible for special focus behavior on an item
   */
  private removeSpecialFocusBehavior = (): void => {
    this.nodes.root?.removeAttribute(DATA_ATTR.noFocus);
  };

  /**
   * Removes class responsible for special hover behavior on an item
   */
  private removeSpecialHoverBehavior = (): void => {
    this.nodes.root?.removeAttribute(DATA_ATTR.noHover);
  };

  /**
   * Executes item's onActivate callback if the item has no confirmation configured
   * @param item - item to activate or bring to confirmation mode
   */
  private activateOrEnableConfirmationMode(item: PopoverItemDefaultParams): void {
    if (!('confirmation' in item) || item.confirmation === undefined) {
      try {
        item.onActivate?.(item);
        this.disableConfirmationMode();
      } catch {
        this.animateError();
      }
    } else {
      this.enableConfirmationMode(item.confirmation);
    }
  }

  /**
   * Animates item which symbolizes that error occurred while executing 'onActivate()' callback
   */
  private animateError(): void {
    if (this.nodes.icon?.hasAttribute(DATA_ATTR.wobble)) {
      return;
    }

    this.nodes.icon?.setAttribute(DATA_ATTR.wobble, 'true');
    // Apply wobble animation class directly (moved from popover.css)
    this.nodes.icon?.classList.add('animate-wobble');

    this.nodes.icon?.addEventListener('animationend', this.onErrorAnimationEnd);
  }

  /**
   * Handles finish of error animation
   */
  private onErrorAnimationEnd = (): void => {
    this.nodes.icon?.removeAttribute(DATA_ATTR.wobble);
    // Remove wobble animation class
    this.nodes.icon?.classList.remove('animate-wobble');
    this.nodes.icon?.removeEventListener('animationend', this.onErrorAnimationEnd);
  };

  /**
   * Updates root element classes based on current state
   */
  private updateRootClasses(): void {
    if (this.nodes.root === null) {
      return;
    }

    const isActive = this.nodes.root.hasAttribute(DATA_ATTR.active);
    const isHidden = this.nodes.root.hasAttribute(DATA_ATTR.hidden);
    const isConfirmation = this.nodes.root.hasAttribute(DATA_ATTR.confirmation);
    const isFocused = this.nodes.root.hasAttribute(DATA_ATTR.focused);
    const isInline = this.renderParams?.isInline ?? false;
    const isNestedInline = this.renderParams?.isNestedInline ?? false;

    this.nodes.root.className = twMerge(
      css.item,
      isInline && cssInline.item,
      isNestedInline && cssNestedInline.item,
      isActive && css.itemActive,
      this.isDisabled && css.itemDisabled,
      isFocused && '!bg-item-focus-bg',
      isConfirmation && '!bg-item-confirm-bg !text-white',
      isHidden && '!hidden'
    );
  }
}
