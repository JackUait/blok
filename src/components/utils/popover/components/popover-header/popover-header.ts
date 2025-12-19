import type { PopoverHeaderParams } from './popover-header.types';
import { Dom } from '../../../../dom';
import { css } from './popover-header.const';
import { DATA_ATTR } from '../../../../constants/data-attributes';
import { IconChevronLeft } from '../../../../icons';
import { Listeners } from '../../../listeners';

/**
 * Represents popover header ui element
 */
export class PopoverHeader {
  /**
   * Listeners util instance
   */
  private listeners = new Listeners();

  /**
   * Header html elements
   */
  private nodes: {
      root: HTMLElement,
      text: HTMLElement,
      backButton: HTMLElement
    };

  /**
   * Text displayed inside header
   */
  private readonly text: string;

  /**
   * Back button click handler
   */
  private readonly onBackButtonClick: () => void;

  /**
   * Constructs the instance
   * @param params - popover header params
   */
  constructor({ text, onBackButtonClick }: PopoverHeaderParams) {
    this.text = text;
    this.onBackButtonClick = onBackButtonClick;

    this.nodes = {
      root: Dom.make('div', [ css.root ], {
        'data-blok-testid': 'popover-header',
        [DATA_ATTR.popoverHeader]: '',
      }),
      backButton: Dom.make('button', [ css.backButton ], {
        'data-blok-testid': 'popover-header-back-button',
        [DATA_ATTR.popoverHeaderBackButton]: '',
      }),
      text: Dom.make('div', [ css.text ], {
        'data-blok-testid': 'popover-header-text',
        [DATA_ATTR.popoverHeaderText]: '',
      }),
    };
    this.nodes.backButton.innerHTML = IconChevronLeft;
    this.nodes.root.appendChild(this.nodes.backButton);
    this.listeners.on(this.nodes.backButton, 'click', this.onBackButtonClick);

    this.nodes.text.innerText = this.text;
    this.nodes.root.appendChild(this.nodes.text);
  }

  /**
   * Returns popover header root html element
   */
  public getElement(): HTMLElement | null {
    return this.nodes.root;
  }

  /**
   * Destroys the instance
   */
  public destroy(): void {
    this.nodes.root.remove();
    this.listeners.destroy();
  }
}
