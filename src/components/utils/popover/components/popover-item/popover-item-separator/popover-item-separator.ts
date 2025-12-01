import Dom from '../../../../../dom';
import { PopoverItem } from '../popover-item';
import { css, DATA_ATTR } from './popover-item-separator.const';
import { twMerge } from '../../../../tw';

/**
 * Represents popover separator node
 */
export class PopoverItemSeparator extends PopoverItem {
  /**
   * Html elements
   */
  private nodes: { root: HTMLElement; line: HTMLElement };

  /**
   * Constructs the instance
   */
  constructor() {
    super();

    this.nodes = {
      root: Dom.make('div', css.container, {
        [DATA_ATTR.root]: '',
      }),
      line: Dom.make('div', css.line, {
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
      this.nodes.root.className = twMerge(css.container, css.containerHidden);
    } else {
      this.nodes.root?.removeAttribute(DATA_ATTR.hidden);
      this.nodes.root.className = css.container;
    }
  }
}
