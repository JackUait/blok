import { PopoverItem } from '../popover-item';
import type { PopoverItemHtmlParams, PopoverItemRenderParamsMap, PopoverItemType } from '@/types/utils/popover/popover-item';
import { css, cssInline, DATA_ATTR } from './popover-item-html.const';
import Dom from '../../../../../dom';
import { twMerge } from '../../../../tw';

/**
 * Represents popover item with custom html content
 */
export class PopoverItemHtml extends PopoverItem {
  /**
   * Item html elements
   */
  private nodes: { root: HTMLElement };

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

    const rootClass = this.isInline ? twMerge(css.root, cssInline.root) : css.root;

    this.nodes = {
      root: Dom.make('div', rootClass, {
        [DATA_ATTR.root]: '',
      }),
    };

    this.nodes.root.appendChild(params.element);
    this.nodes.root.setAttribute('data-blok-testid', 'popover-item-html');

    if (params.name) {
      this.nodes.root.setAttribute('data-blok-item-name', params.name);
    }

    if (params.hint !== undefined && renderParams?.hint?.enabled !== false) {
      this.addHint(this.nodes.root, {
        ...params.hint,
        position: renderParams?.hint?.position || 'right',
        alignment: renderParams?.hint?.alignment || 'center',
      });
    }
  }

  /**
   * Returns popover item root element
   */
  public getElement(): HTMLElement {
    return this.nodes.root;
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public toggleHidden(isHidden: boolean): void {
    const baseClass = this.isInline ? twMerge(css.root, cssInline.root) : css.root;

    if (isHidden) {
      this.nodes.root?.setAttribute(DATA_ATTR.hidden, 'true');
      this.nodes.root.className = twMerge(baseClass, css.rootHidden);
    } else {
      this.nodes.root?.removeAttribute(DATA_ATTR.hidden);
      this.nodes.root.className = baseClass;
    }
  }

  /**
   * Returns list of buttons and inputs inside custom content
   */
  public getControls(): HTMLElement[] {
    /** Query buttons and inputs inside custom html */
    const controls = this.nodes.root.querySelectorAll<HTMLElement>(
      `button, ${Dom.allInputsSelector}`
    );

    return Array.from(controls);
  }
}
