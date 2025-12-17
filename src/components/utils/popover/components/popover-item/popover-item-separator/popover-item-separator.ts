import { twMerge } from '../../../../tw';
import { PopoverItem } from '../popover-item';
import type { PopoverItemRenderParamsMap, PopoverItemType } from '@/types/utils/popover/popover-item';
import { css, cssInline } from './popover-item-separator.const';
import { DATA_ATTR } from '../../../../../constants/data-attributes';

/**
 * Represents popover separator node
 */
export class PopoverItemSeparator extends PopoverItem {
  /**
   * Html elements
   */
  private nodes: { root: HTMLElement | null; line: HTMLElement | null } = { root: null, line: null };

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

    this.nodes.root = this.createRootElement();
  }

  /**
   * Returns popover separator root element
   */
  public getElement(): HTMLElement {
    return this.nodes.root as HTMLElement;
  }

  /**
   * Toggles item hidden state
   * @param isHidden - true if item should be hidden
   */
  public toggleHidden(isHidden: boolean): void {
    if (!this.nodes.root) {
      return;
    }

    const baseClass = this.getContainerClass(false);
    const hiddenClass = this.getContainerClass(true);

    this.nodes.root.className = isHidden ? hiddenClass : baseClass;

    if (isHidden) {
      this.nodes.root.setAttribute(DATA_ATTR.hidden, 'true');
    } else {
      this.nodes.root.removeAttribute(DATA_ATTR.hidden);
    }
  }

  /**
   * Build container class based on context
   */
  private getContainerClass(isHidden: boolean): string {
    const baseClass = css.container;

    if (this.isNestedInline) {
      return twMerge(baseClass, cssInline.nestedContainer, isHidden && css.containerHidden);
    }
    if (this.isInline) {
      return twMerge(baseClass, cssInline.container, isHidden && css.containerHidden);
    }

    return twMerge(baseClass, isHidden && css.containerHidden);
  }

  /**
   * Build line class based on context
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

  /**
   * Creates the root container element
   */
  private createRootElement(): HTMLElement {
    const container = document.createElement('div');

    container.className = this.getContainerClass(false);
    container.setAttribute(DATA_ATTR.popoverItemSeparator, '');
    container.setAttribute('data-blok-testid', 'popover-item-separator');

    const line = document.createElement('div');

    line.className = this.getLineClass();
    line.setAttribute(DATA_ATTR.popoverItemSeparatorLine, '');

    container.appendChild(line);
    this.nodes.line = line;

    return container;
  }
}
