import { PopoverItem } from '../popover-item';
import type { PopoverItemHtmlParams, PopoverItemRenderParamsMap, PopoverItemType } from '@/types/utils/popover/popover-item';
import { Dom } from '../../../../../dom';
import { css, cssInline } from './popover-item-html.const';
import { DATA_ATTR } from '../../../../../constants/data-attributes';
import { twMerge } from '../../../../tw';

/**
 * Represents popover item with custom html content
 */
export class PopoverItemHtml extends PopoverItem {
  /**
   * Item html elements
   */
  private nodes: { root: HTMLElement | null } = { root: null };

  /**
   * Whether the item is currently hidden
   */
  private isHidden = false;

  /**
   * Whether this item is in an inline popover context
   */
  private readonly isInline: boolean;

  /**
   * Constructs the instance
   * @param params – instance parameters
   * @param renderParams – popover item render params.
   * The parameters that are not set by user via popover api but rather depend on technical implementation
   */
  constructor(params: PopoverItemHtmlParams, renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Html]) {
    super(params);

    this.isInline = renderParams?.isInline ?? false;

    this.nodes.root = this.createRootElement(params, renderParams);
  }

  /**
   * Returns popover item root element
   */
  public getElement(): HTMLElement {
    return this.nodes.root as HTMLElement;
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public toggleHidden(isHidden: boolean): void {
    this.isHidden = isHidden;
    this.updateRootClasses();

    if (!this.nodes.root) {
      return;
    }

    if (isHidden) {
      this.nodes.root.setAttribute(DATA_ATTR.hidden, 'true');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.hidden);
    }
  }

  /**
   * Returns list of buttons and inputs inside custom content
   */
  public getControls(): HTMLElement[] {
    if (!this.nodes.root) {
      return [];
    }

    const controls = this.nodes.root.querySelectorAll<HTMLElement>(
      `button, ${Dom.allInputsSelector}`
    );

    return Array.from(controls);
  }

  /**
   * Updates the root element's class list based on current state
   */
  private updateRootClasses(): void {
    if (!this.nodes.root) {
      return;
    }

    this.nodes.root.className = twMerge(
      css.root,
      this.isInline && cssInline.root,
      this.isHidden && css.rootHidden
    );
  }

  /**
   * Creates the root container element
   * @param params - item params
   * @param renderParams - render configuration
   */
  private createRootElement(
    params: PopoverItemHtmlParams,
    renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Html]
  ): HTMLElement {
    const root = document.createElement('div');

    // Set initial classes
    root.className = twMerge(
      css.root,
      this.isInline && cssInline.root
    );

    // Set data attributes
    root.setAttribute(DATA_ATTR.popoverItemHtml, '');
    root.setAttribute('data-blok-testid', 'popover-item-html');

    if (params.name) {
      root.setAttribute('data-blok-item-name', params.name);
    }

    // Append the custom element
    root.appendChild(params.element);

    // Add hint if configured
    if (params.hint !== undefined && renderParams?.hint?.enabled !== false) {
      this.addHint(root, {
        ...params.hint,
        position: renderParams?.hint?.position || 'right',
        alignment: renderParams?.hint?.alignment || 'center',
      });
    }

    return root;
  }
}
