import Dom from '../../../../../dom';
import { PopoverItem } from '../popover-item';
import { css, cssInline, DATA_ATTR } from './popover-item-separator.const';
import { twMerge } from '../../../../tw';
import type { PopoverItemRenderParamsMap, PopoverItemType } from '@/types/utils/popover/popover-item';

/**
 * Represents popover separator node
 */
export class PopoverItemSeparator extends PopoverItem {
  /**
   * Html elements
   */
  private nodes: { root: HTMLElement; line: HTMLElement };

  /**
   * Whether this separator is in an inline popover context
   */
  private readonly isInline: boolean;

  /**
   * Whether this separator is in a nested inline popover context
   */
  private readonly isNestedInline: boolean;

  /**
   * Constructs the instance
   * @param renderParams - optional render params for styling context
   */
  constructor(renderParams?: PopoverItemRenderParamsMap[PopoverItemType.Separator]) {
    super();

    this.isInline = renderParams?.isInline ?? false;
    this.isNestedInline = renderParams?.isNestedInline ?? false;

    const containerClass = this.getContainerClass();
    const lineClass = this.getLineClass();

    this.nodes = {
      root: Dom.make('div', containerClass, {
        [DATA_ATTR.root]: '',
      }),
      line: Dom.make('div', lineClass, {
        [DATA_ATTR.line]: '',
      }),
    };

    this.nodes.root.setAttribute('data-blok-testid', 'popover-item-separator');
    this.nodes.root.appendChild(this.nodes.line);
  }

  /**
   * Returns popover separator root element
   */
  public getElement(): HTMLElement {
    return this.nodes.root;
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public toggleHidden(isHidden: boolean): void {
    if (isHidden) {
      this.nodes.root?.setAttribute(DATA_ATTR.hidden, 'true');
      this.nodes.root.className = twMerge(this.getContainerClass(), css.containerHidden);
    } else {
      this.nodes.root?.removeAttribute(DATA_ATTR.hidden);
      this.nodes.root.className = this.getContainerClass();
    }
  }

  /**
   * Returns the container class based on context
   */
  private getContainerClass(): string {
    if (this.isNestedInline) {
      return twMerge(css.container, cssInline.nestedContainer);
    }
    if (this.isInline) {
      return twMerge(css.container, cssInline.container);
    }
    return css.container;
  }

  /**
   * Returns the line class based on context
   */
  private getLineClass(): string {
    if (this.isNestedInline) {
      return twMerge(css.line, cssInline.nestedLine);
    }
    if (this.isInline) {
      return twMerge(css.line, cssInline.line);
    }
    return css.line;
  }
}
