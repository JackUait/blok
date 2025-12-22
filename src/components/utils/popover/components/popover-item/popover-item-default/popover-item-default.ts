import type {
  PopoverItemDefaultParams,
  PopoverItemRenderParamsMap,
  PopoverItemType
} from '@/types/utils/popover/popover-item';
import { PopoverItem } from '../popover-item';
import { css, cssInline, cssNestedInline } from './popover-item-default.const';
import { DATA_ATTR } from '../../../../../constants/data-attributes';
import { twMerge } from '../../../../tw';
import { IconChevronRight } from '../../../../../icons';

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
    return this.params.title;
  }

  /**
   * English title for multilingual search fallback
   */
  public get englishTitle(): string | undefined {
    return this.params.englishTitle;
  }

  /**
   * Additional search terms for this item
   */
  public get searchTerms(): string[] | undefined {
    return this.params.searchTerms;
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
    root: null | HTMLElement;
    icon: null | HTMLElement;
    titleEl: null | HTMLElement;
    secondaryLabelEl: null | HTMLElement;
    chevron: null | HTMLElement;
  } = {
      root: null,
      icon: null,
      titleEl: null,
      secondaryLabelEl: null,
      chevron: null,
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
    this.nodes.root = this.createRootElement(params, renderParams);
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

    const currentlyActive = this.nodes.root.hasAttribute(DATA_ATTR.popoverItemActive);
    const shouldBeActive = isActive !== undefined ? isActive : !currentlyActive;

    this.setActive(shouldBeActive);
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public override toggleHidden(isHidden: boolean): void {
    this.setHidden(isHidden);
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
   * Creates the root container element
   * @param params - item construction params
   * @param renderParams - popover item render params
   */
  private createRootElement(
    params: PopoverItemDefaultParams,
    renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Default]
  ): HTMLElement {
    const wrapperTag = renderParams?.wrapperTag ?? 'div';
    const root = document.createElement(wrapperTag);

    if (wrapperTag === 'button') {
      root.setAttribute('type', 'button');
    }

    // Set classes
    root.className = this.getContainerClass();

    // Set data attributes
    root.setAttribute(DATA_ATTR.popoverItem, '');
    root.setAttribute('data-blok-testid', 'popover-item');

    if (params.name) {
      root.setAttribute('data-blok-item-name', params.name);
    }
    if (params.dataset) {
      Object.entries(params.dataset).forEach(([key, value]) => {
        root.setAttribute(`data-${key}`, value);
      });
    }
    if (params.isDisabled) {
      root.setAttribute(DATA_ATTR.disabled, 'true');
    }
    if (this.isActive) {
      root.setAttribute(DATA_ATTR.popoverItemActive, 'true');
    }
    if (this.hasChildren) {
      root.setAttribute(DATA_ATTR.hasChildren, 'true');
    }

    // Create content elements
    this.createContentElements(root, params, renderParams);

    // Add hint if configured
    const shouldAddHint = params.hint !== undefined && renderParams?.hint?.enabled !== false;

    if (shouldAddHint && params.hint !== undefined) {
      this.addHint(root, {
        ...params.hint,
        position: renderParams?.hint?.position || 'right',
        alignment: renderParams?.hint?.alignment || 'center',
      });
    }

    return root;
  }

  /**
   * Creates the content elements (icon, title, secondary label, chevron)
   */
  private createContentElements(
    root: HTMLElement,
    params: PopoverItemDefaultParams,
    renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Default]
  ): void {
    const iconWithGap = renderParams?.iconWithGap ?? true;
    const isInline = renderParams?.isInline ?? false;
    const isNestedInline = renderParams?.isNestedInline ?? false;

    const title = params.title;

    // Icon
    if (params.icon) {
      this.nodes.icon = this.createIconElement(params.icon, iconWithGap, isInline, isNestedInline);
      root.appendChild(this.nodes.icon);
    }

    // Title
    if (title !== undefined) {
      const titleEl = document.createElement('div');

      titleEl.className = 'mr-auto truncate text-sm font-medium leading-5';
      titleEl.setAttribute(DATA_ATTR.popoverItemTitle, '');
      titleEl.setAttribute('data-blok-testid', 'popover-item-title');
      titleEl.textContent = title;

      root.appendChild(titleEl);
      this.nodes.titleEl = titleEl;
    }

    // Secondary label
    if (params.secondaryLabel) {
      const secondaryEl = document.createElement('div');

      secondaryEl.className = 'whitespace-nowrap pr-1.5 text-xs font-light tracking-[0.25px] text-text-secondary opacity-60';
      secondaryEl.setAttribute(DATA_ATTR.popoverItemSecondaryTitle, '');
      secondaryEl.setAttribute('data-blok-testid', 'popover-item-secondary-title');
      secondaryEl.textContent = params.secondaryLabel;

      root.appendChild(secondaryEl);
      this.nodes.secondaryLabelEl = secondaryEl;
    }

    // Chevron
    const showChevron = this.hasChildren && !this.isChevronHidden;

    if (showChevron) {
      const chevronEl = document.createElement('div');

      chevronEl.className = this.getChevronClass(isInline);
      chevronEl.setAttribute(DATA_ATTR.popoverItemIcon, '');
      chevronEl.setAttribute(DATA_ATTR.popoverItemIconChevronRight, '');
      chevronEl.setAttribute('data-blok-testid', 'popover-item-chevron-right');
      chevronEl.innerHTML = IconChevronRight;

      root.appendChild(chevronEl);
      this.nodes.chevron = chevronEl;
    }
  }


  /**
   * Creates an icon element
   */
  private createIconElement(icon: string, iconWithGap: boolean, isInline: boolean, isNestedInline: boolean): HTMLElement {
    const iconEl = document.createElement('div');

    iconEl.className = this.getIconClass(iconWithGap, isInline, isNestedInline, false);
    iconEl.setAttribute(DATA_ATTR.popoverItemIcon, '');
    iconEl.setAttribute('data-blok-testid', 'popover-item-icon');
    iconEl.innerHTML = icon;

    if (iconWithGap) {
      iconEl.setAttribute(DATA_ATTR.tool, '');
    }

    return iconEl;
  }

  /**
   * Gets the container class based on current state
   */
  private getContainerClass(): string {
    const isInline = this.renderParams?.isInline ?? false;
    const isNestedInline = this.renderParams?.isNestedInline ?? false;

    return twMerge(
      css.item,
      isInline && cssInline.item,
      isNestedInline && cssNestedInline.item,
      this.params.isDisabled && css.itemDisabled
    );
  }

  /**
   * Gets the icon class based on context
   */
  private getIconClass(iconWithGap: boolean, isInline: boolean, isNestedInline: boolean, isWobbling: boolean): string {
    return twMerge(
      css.icon,
      isInline && 'w-auto h-auto [&_svg]:w-icon [&_svg]:h-icon mobile:[&_svg]:w-icon-mobile mobile:[&_svg]:h-icon-mobile',
      isNestedInline && 'w-toolbox-btn h-toolbox-btn',
      iconWithGap && 'mr-2',
      iconWithGap && isInline && 'shadow-none bg-transparent !mr-0',
      iconWithGap && isNestedInline && '!mr-2',
      isWobbling && 'animate-wobble'
    );
  }

  /**
   * Gets the chevron class based on context
   */
  private getChevronClass(isInline: boolean): string {
    return twMerge(
      css.icon,
      isInline && 'rotate-90'
    );
  }

  /**
   * Sets the active state of the item
   */
  private setActive(isActive: boolean): void {
    if (!this.nodes.root) {
      return;
    }

    if (isActive) {
      this.nodes.root.setAttribute(DATA_ATTR.popoverItemActive, 'true');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.popoverItemActive);
    }
  }

  /**
   * Sets the hidden state of the item
   */
  private setHidden(isHidden: boolean): void {
    if (!this.nodes.root) {
      return;
    }

    if (isHidden) {
      this.nodes.root.setAttribute(DATA_ATTR.hidden, 'true');
      this.nodes.root.classList.add('!hidden');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.hidden);
      this.nodes.root.classList.remove('!hidden');
    }
  }

  /**
   * Sets the focused state of the item
   * @param isFocused - true if item should be focused
   */
  public setFocused(isFocused: boolean): void {
    if (!this.nodes.root) {
      return;
    }

    if (isFocused) {
      this.nodes.root.setAttribute(DATA_ATTR.focused, 'true');
      this.nodes.root.classList.add('!bg-item-focus-bg');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.focused);
      this.nodes.root.classList.remove('!bg-item-focus-bg');
    }
  }

  /**
   * Sets the no-hover state
   */
  private setNoHover(noHover: boolean): void {
    if (!this.nodes.root) {
      return;
    }

    if (noHover) {
      this.nodes.root.setAttribute(DATA_ATTR.popoverItemNoHover, 'true');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.popoverItemNoHover);
    }
  }

  /**
   * Sets the no-focus state
   */
  private setNoFocus(noFocus: boolean): void {
    if (!this.nodes.root) {
      return;
    }

    if (noFocus) {
      this.nodes.root.setAttribute(DATA_ATTR.popoverItemNoFocus, 'true');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.popoverItemNoFocus);
    }
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

    // Update confirmation state
    this.setConfirmation(params);
    this.confirmationState = newState;

    this.enableSpecialHoverAndFocusBehavior();
  }

  /**
   * Sets the confirmation state with new params
   */
  private setConfirmation(params: PopoverItemDefaultParams | null): void {
    if (!this.nodes.root) {
      return;
    }

    if (params === null) {
      this.clearConfirmationState();

      return;
    }

    this.applyConfirmationState(params);
  }

  /**
   * Clears confirmation state and restores original content
   */
  private clearConfirmationState(): void {
    if (!this.nodes.root) {
      return;
    }

    this.nodes.root.removeAttribute(DATA_ATTR.popoverItemConfirmation);
    this.nodes.root.classList.remove('!bg-item-confirm-bg', '!text-white');

    this.restoreOriginalIcon();
    this.restoreOriginalTitle();
    this.restoreOriginalSecondaryLabel();
  }

  /**
   * Applies confirmation state with new params
   */
  private applyConfirmationState(params: PopoverItemDefaultParams): void {
    if (!this.nodes.root) {
      return;
    }

    this.nodes.root.setAttribute(DATA_ATTR.popoverItemConfirmation, 'true');
    this.nodes.root.classList.add('!bg-item-confirm-bg', '!text-white');

    this.updateIcon(params.icon);
    this.updateTitle(params);
    this.updateSecondaryLabel(params.secondaryLabel);
  }

  /**
   * Restores the original icon
   */
  private restoreOriginalIcon(): void {
    if (!this.nodes.icon || !this.params.icon) {
      return;
    }

    this.nodes.icon.innerHTML = this.params.icon;
  }

  /**
   * Restores the original title
   */
  private restoreOriginalTitle(): void {
    if (!this.nodes.titleEl || this.params.title === undefined) {
      return;
    }

    this.nodes.titleEl.textContent = this.params.title;
  }

  /**
   * Restores the original secondary label
   */
  private restoreOriginalSecondaryLabel(): void {
    if (!this.nodes.secondaryLabelEl) {
      return;
    }

    this.nodes.secondaryLabelEl.textContent = this.params.secondaryLabel ?? '';
    this.nodes.secondaryLabelEl.style.display = this.params.secondaryLabel ? '' : 'none';
  }

  /**
   * Updates the icon with new content
   */
  private updateIcon(icon: string | undefined): void {
    if (!this.nodes.icon || !icon) {
      return;
    }

    this.nodes.icon.innerHTML = icon;
  }

  /**
   * Updates the title with new content
   */
  private updateTitle(params: PopoverItemDefaultParams): void {
    if (!this.nodes.titleEl || params.title === undefined) {
      return;
    }

    this.nodes.titleEl.textContent = params.title;
  }

  /**
   * Updates the secondary label with new content
   */
  private updateSecondaryLabel(secondaryLabel: string | undefined): void {
    if (!this.nodes.secondaryLabelEl) {
      return;
    }

    this.nodes.secondaryLabelEl.textContent = secondaryLabel ?? '';
    this.nodes.secondaryLabelEl.style.display = secondaryLabel ? '' : 'none';
  }

  /**
   * Returns item to its original state
   */
  private disableConfirmationMode(): void {
    if (this.nodes.root === null) {
      return;
    }

    // Clear confirmation state
    this.setConfirmation(null);
    this.confirmationState = null;

    this.disableSpecialHoverAndFocusBehavior();
  }

  /**
   * Enables special focus and hover behavior for item in confirmation state.
   * This is needed to prevent item from being highlighted as hovered/focused just after click.
   */
  private enableSpecialHoverAndFocusBehavior(): void {
    this.setNoHover(true);
    this.setNoFocus(true);

    this.nodes.root?.addEventListener('mouseleave', this.removeSpecialHoverBehavior, { once: true });
  }

  /**
   * Disables special focus and hover behavior
   */
  private disableSpecialHoverAndFocusBehavior(): void {
    this.removeSpecialFocusBehavior();
    this.removeSpecialHoverBehavior();

    this.nodes.root?.removeEventListener('mouseleave', this.removeSpecialHoverBehavior);
  }

  /**
   * Removes class responsible for special focus behavior on an item
   */
  private removeSpecialFocusBehavior = (): void => {
    this.setNoFocus(false);
  };

  /**
   * Removes class responsible for special hover behavior on an item
   */
  private removeSpecialHoverBehavior = (): void => {
    this.setNoHover(false);
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
    this.triggerWobble();
  }

  /**
   * Triggers wobble animation on the icon
   */
  private triggerWobble(): void {
    if (!this.nodes.icon) {
      return;
    }

    const isInline = this.renderParams?.isInline ?? false;
    const isNestedInline = this.renderParams?.isNestedInline ?? false;
    const iconWithGap = this.renderParams?.iconWithGap ?? true;

    // Add wobble class
    this.nodes.icon.setAttribute(DATA_ATTR.popoverItemWobble, 'true');
    this.nodes.icon.className = this.getIconClass(iconWithGap, isInline, isNestedInline, true);

    // Remove wobble after animation ends
    const handleAnimationEnd = (): void => {
      if (this.nodes.icon) {
        this.nodes.icon.removeAttribute(DATA_ATTR.popoverItemWobble);
        this.nodes.icon.className = this.getIconClass(iconWithGap, isInline, isNestedInline, false);
      }
    };

    this.nodes.icon.addEventListener('animationend', handleAnimationEnd, { once: true });
  }

  /**
   * Gets reference to the icon element
   */
  public getIconElement(): HTMLElement | null {
    return this.nodes.icon;
  }
}
