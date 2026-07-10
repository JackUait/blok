import { DATA_ATTR } from '../../../../constants/data-attributes';
import { Dom } from '../../../../dom';
import { IconChevronLeft } from '../../../../icons';
import { generateId } from '../../../id-generator';
import { Listeners } from '../../../listeners';

import { css } from './popover-header.const';
import type { PopoverHeaderParams } from './popover-header.types';

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
   * Stable id of the title element. Consumers point `aria-labelledby` at it so
   * the sheet/menu is named by the header title.
   */
  private readonly titleId: string;

  /**
   * Constructs the instance
   * @param params - popover header params
   */
  constructor({ text, onBackButtonClick, backButtonLabel }: PopoverHeaderParams) {
    this.text = text;
    this.onBackButtonClick = onBackButtonClick;
    this.titleId = generateId('blok-popover-header-title-');

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

    // Name the icon-only back button for assistive tech.
    if (backButtonLabel !== undefined) {
      this.nodes.backButton.setAttribute('aria-label', backButtonLabel);
    }

    this.nodes.root.appendChild(this.nodes.backButton);
    this.listeners.on(this.nodes.backButton, 'click', this.onBackButtonClick);

    this.nodes.text.id = this.titleId;
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
   * Returns the id of the header title element so callers can reference it from
   * an `aria-labelledby` on the owning menu/sheet.
   */
  public getTitleId(): string {
    return this.titleId;
  }

  /**
   * Destroys the instance
   */
  public destroy(): void {
    this.nodes.root.remove();
    this.listeners.destroy();
  }
}
