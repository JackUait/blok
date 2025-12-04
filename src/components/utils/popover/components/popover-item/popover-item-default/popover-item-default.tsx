import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type {
  PopoverItemDefaultParams as PopoverItemDefaultParams,
  PopoverItemRenderParamsMap,
  PopoverItemType
} from '@/types/utils/popover/popover-item';
import { PopoverItem } from '../popover-item';
import { DATA_ATTR } from './popover-item-default.const';
import {
  PopoverItemDefaultComponent,
  type PopoverItemDefaultComponentHandle
} from './PopoverItemDefaultComponent';

/**
 * Selector for icon element
 */
const ICON_SELECTOR = '[data-blok-testid="popover-item-icon"]';

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
   * React 18 root instance for persistent rendering
   */
  private reactRoot: Root | null = null;

  /**
   * Ref to the imperative handle exposed by the React component
   */
  private componentRef = createRef<PopoverItemDefaultComponentHandle>();

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

    const currentlyActive = this.nodes.root.hasAttribute(DATA_ATTR.active);
    const shouldBeActive = isActive !== undefined ? isActive : !currentlyActive;

    // Update via React imperative handle
    this.componentRef.current?.setActive(shouldBeActive);
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public override toggleHidden(isHidden: boolean): void {
    // Update via React imperative handle
    this.componentRef.current?.setHidden(isHidden);
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
   * Cleanup method to unmount React root and prevent memory leaks
   * Should be called when the item is removed from DOM
   */
  public override destroy(): void {
    super.destroy();

    if (this.reactRoot) {
      try {
        this.reactRoot.unmount();
      } catch {
        // Ignore errors if DOM is already cleaned up by parent popover
      }
      this.reactRoot = null;
    }
  }

  /**
   * Creates the root container element and initializes React rendering
   * @param params - item construction params
   * @param renderParams - popover item render params
   */
  private createRootElement(params: PopoverItemDefaultParams, renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Default]): HTMLElement {
    // Create container element that will host the React root
    const container = document.createElement('div');

    container.style.display = 'contents'; // Make container transparent in layout

    // Create React root and render component
    this.reactRoot = createRoot(container);
    this.renderComponent(params, renderParams);

    // Get the actual rendered element (first child of container)
    // We need to return the actual button/div element, not the container
    const renderedElement = container.firstElementChild as HTMLElement;

    // Fallback: return container if no child rendered (shouldn't happen)
    if (!renderedElement) {
      return container;
    }

    // Store reference to icon element
    this.nodes.icon = renderedElement.querySelector(ICON_SELECTOR);

    // Add hint if configured
    const shouldAddHint = params.hint !== undefined && renderParams?.hint?.enabled !== false;

    if (shouldAddHint && params.hint !== undefined) {
      this.addHint(renderedElement, {
        ...params.hint,
        position: renderParams?.hint?.position || 'right',
        alignment: renderParams?.hint?.alignment || 'center',
      });
    }

    return renderedElement;
  }

  /**
   * Renders the React component with current params
   * @param params - item params to render
   * @param renderParams - render configuration
   */
  private renderComponent(params: PopoverItemDefaultParams, renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Default]): void {
    if (!this.reactRoot) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- TODO: remove this once label is removed
    const title = params.title || params.label;

    // Use flushSync to ensure synchronous rendering for immediate DOM access
    flushSync(() => {
      this.reactRoot?.render(
        <PopoverItemDefaultComponent
          ref={this.componentRef}
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
    });
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

    // Update confirmation state via React imperative handle
    this.componentRef.current?.setConfirmation(params);
    this.confirmationState = newState;

    this.enableSpecialHoverAndFocusBehavior();

    // Update icon reference after React re-render
    this.nodes.icon = this.componentRef.current?.getIconElement() ?? this.nodes.root.querySelector(ICON_SELECTOR);
  }

  /**
   * Returns item to its original state
   */
  private disableConfirmationMode(): void {
    if (this.nodes.root === null) {
      return;
    }

    // Clear confirmation state via React imperative handle
    this.componentRef.current?.setConfirmation(null);
    this.confirmationState = null;

    this.disableSpecialHoverAndFocusBehavior();

    // Update icon reference after React re-render
    this.nodes.icon = this.componentRef.current?.getIconElement() ?? this.nodes.root.querySelector(ICON_SELECTOR);
  }

  /**
   * Enables special focus and hover behavior for item in confirmation state.
   * This is needed to prevent item from being highlighted as hovered/focused just after click.
   */
  private enableSpecialHoverAndFocusBehavior(): void {
    this.componentRef.current?.setNoHover(true);
    this.componentRef.current?.setNoFocus(true);

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
    this.componentRef.current?.setNoFocus(false);
  };

  /**
   * Removes class responsible for special hover behavior on an item
   */
  private removeSpecialHoverBehavior = (): void => {
    this.componentRef.current?.setNoHover(false);
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
    // Trigger wobble animation via React imperative handle
    this.componentRef.current?.triggerWobble();
  }
}
