import SelectionUtils from '../selection';
import * as _ from '../utils';
import type {
  InlineTool,
  InlineToolConstructable,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import { PopoverItemType } from '../utils/popover';
import type { Notifier, Toolbar, I18n, InlineToolbar } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { IconLink } from '../icons';
import { DATA_ATTR, createSelector } from '../constants';
import { twMerge } from '../utils/tw';

/**
 * Link Tool
 *
 * Inline Toolbar Tool
 *
 * Wrap selected text with <a> tag
 */
const LinkInlineTool: InlineToolConstructable = class LinkInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Link';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'link';

  /**
   * Sanitizer Rule
   * Leave <a> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      a: {
        href: true,
        target: '_blank',
        rel: 'nofollow',
      },
    } as SanitizerConfig;
  }

  /**
   * Tailwind classes for input
   */
  private readonly INPUT_BASE_CLASSES = 'hidden w-full m-0 px-2 py-1 text-sm leading-[22px] font-medium bg-item-hover-bg border border-[rgba(226,226,229,0.2)] rounded-md outline-none box-border appearance-none font-[inherit] placeholder:text-gray-text mobile:text-[15px] mobile:font-medium';

  /**
   * Data attributes for e2e selectors
   */
  private readonly DATA_ATTRIBUTES = {
    buttonActive: 'data-blok-link-tool-active',
    buttonUnlink: 'data-blok-link-tool-unlink',
    inputOpened: 'data-blok-link-tool-input-opened',
  } as const;

  /**
   * Elements
   */
  private nodes: {
    input: HTMLInputElement | null;
    button: HTMLButtonElement | null;
  } = {
      input: null,
      button: null,
    };

  /**
   * SelectionUtils instance
   */
  private selection: SelectionUtils;

  /**
   * Input opening state
   */
  private inputOpened = false;

  /**
   * Tracks whether unlink action is available via toolbar button toggle
   */
  private unlinkAvailable = false;

  /**
   * Available Toolbar methods (open/close)
   */
  private toolbar: Toolbar;

  /**
   * Available inline toolbar methods (open/close)
   */
  private inlineToolbar: InlineToolbar;

  /**
   * Notifier API methods
   */
  private notifier: Notifier;

  /**
   * I18n API
   */
  private i18n: I18n;

  /**
   * @param api - Blok API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.toolbar = api.toolbar;
    this.inlineToolbar = api.inlineToolbar;
    this.notifier = api.notifier;
    this.i18n = api.i18n;
    this.selection = new SelectionUtils();
    this.nodes.input = this.createInput();
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconLink,
      isActive: () => !!this.selection.findParentTag('A'),
      children: {
        hideChevron: true,
        items: [
          {
            type: PopoverItemType.Html,
            element: this.nodes.input!,
          },
        ],
        onOpen: () => {
          this.openActions(true);
        },
        onClose: () => {
          this.closeActions();
        },
      },
    };
  }

  /**
   * Input for the link
   */
  private createInput(): HTMLInputElement {
    const input = document.createElement('input') as HTMLInputElement;

    input.placeholder = this.i18n.t('tools.link.addLink');
    input.enterKeyHint = 'done';
    input.className = this.INPUT_BASE_CLASSES;
    input.setAttribute('data-blok-testid', 'inline-tool-input');
    this.setBooleanStateAttribute(input, this.DATA_ATTRIBUTES.inputOpened, false);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        this.enterPressed(event);
      }
    });

    return input;
  }

  /**
   * Set a shortcut
   */
  public get shortcut(): string {
    return 'CMD+K';
  }

  /**
   * @param {boolean} needFocus - on link creation we need to focus input. On editing - nope.
   */
  private openActions(needFocus = false): void {
    if (!this.nodes.input) {
      return;
    }

    const anchorTag = this.selection.findParentTag('A');

    const hasAnchor = Boolean(anchorTag);

    this.updateButtonStateAttributes(hasAnchor);
    this.unlinkAvailable = hasAnchor;

    if (anchorTag) {
      /**
       * Fill input value with link href
       */
      const hrefAttr = anchorTag.getAttribute('href');

      this.nodes.input.value = hrefAttr !== null ? hrefAttr : '';
    } else {
      this.nodes.input.value = '';
    }

    this.nodes.input.className = twMerge(this.INPUT_BASE_CLASSES, 'block');
    this.setBooleanStateAttribute(this.nodes.input, this.DATA_ATTRIBUTES.inputOpened, true);

    /**
     * Set fake background to visually indicate selection when focus moves to input
     */
    this.selection.setFakeBackground();
    this.selection.save();

    if (needFocus) {
      this.focusInputWithRetry();
    }
    this.inputOpened = true;
  }
  /**
   * Ensures the link input receives focus even if other listeners steal it
   */
  private focusInputWithRetry(): void {
    if (!this.nodes.input) {
      return;
    }

    this.nodes.input.focus();

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    window.setTimeout(() => {
      if (document.activeElement !== this.nodes.input) {
        this.nodes.input?.focus();
      }
    }, 0);
  }

  /**
   * Resolve the current inline toolbar button element
   */
  private getButtonElement(): HTMLButtonElement | null {
    if (this.nodes.button && document.contains(this.nodes.button)) {
      return this.nodes.button;
    }

    const button = document.querySelector<HTMLButtonElement>(
      `${createSelector(DATA_ATTR.interface, 'inlineToolbar')} [data-blok-item-name="link"]`
    );

    if (button) {
      button.addEventListener('click', this.handleButtonClick, true);
    }

    this.nodes.button = button ?? null;

    return this.nodes.button;
  }

  /**
   * Update button state attributes for e2e hooks
   * @param hasAnchor - Optional override for anchor presence
   */
  private updateButtonStateAttributes(hasAnchor?: boolean): void {
    const button = this.getButtonElement();

    if (!button) {
      return;
    }

    const anchorPresent = typeof hasAnchor === 'boolean' ? hasAnchor : Boolean(this.selection.findParentTag('A'));

    this.setBooleanStateAttribute(button, this.DATA_ATTRIBUTES.buttonActive, anchorPresent);
    this.setBooleanStateAttribute(button, this.DATA_ATTRIBUTES.buttonUnlink, anchorPresent);
  }

  /**
   * Handles toggling the inline tool button while actions menu is open
   * @param event - Click event emitted by the inline tool button
   */
  private handleButtonClick = (event: MouseEvent): void => {
    if (!this.inputOpened || !this.unlinkAvailable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    this.restoreSelection();
    this.unlink();
    this.inlineToolbar.close();
  };


  /**
   * Close input
   * @param {boolean} clearSavedSelection — we don't need to clear saved selection
   *                                        on toggle-clicks on the icon of opened Toolbar
   */
  private closeActions(clearSavedSelection = true): void {
    const shouldRestoreSelection = this.selection.isFakeBackgroundEnabled ||
      (clearSavedSelection && !!this.selection.savedSelectionRange);

    if (shouldRestoreSelection) {
      this.restoreSelection();
    }

    if (!this.nodes.input) {
      return;
    }
    this.nodes.input.className = this.INPUT_BASE_CLASSES;
    this.setBooleanStateAttribute(this.nodes.input, this.DATA_ATTRIBUTES.inputOpened, false);
    this.nodes.input.value = '';
    this.updateButtonStateAttributes(false);
    this.unlinkAvailable = false;
    if (clearSavedSelection) {
      this.selection.clearSaved();
    }
    this.inputOpened = false;
  }

  /**
   * Restore selection after closing actions
   */
  private restoreSelection(): void {
    // if actions is broken by other selection We need to save new selection
    const currentSelection = new SelectionUtils();
    const isSelectionInBlok = SelectionUtils.isAtBlok;

    if (isSelectionInBlok) {
      currentSelection.save();
    }

    this.selection.removeFakeBackground();
    this.selection.restore();

    // and recover new selection after removing fake background
    if (!isSelectionInBlok && this.selection.savedSelectionRange) {
      const range = this.selection.savedSelectionRange;
      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement;

      element?.focus();
    }

    if (!isSelectionInBlok) {
      return;
    }

    currentSelection.restore();

    const range = currentSelection.savedSelectionRange;

    if (range) {
      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement;

      element?.focus();
    }
  }

  /**
   * Enter pressed on input
   * @param {KeyboardEvent} event - enter keydown event
   */
  private enterPressed(event: KeyboardEvent): void {
    if (!this.nodes.input) {
      return;
    }
    const value = this.nodes.input.value || '';

    if (!value.trim()) {
      this.selection.restore();
      this.unlink();
      event.preventDefault();
      this.closeActions();
      // Explicitly close inline toolbar as well, similar to legacy behavior
      this.inlineToolbar.close();

      return;
    }

    if (!this.validateURL(value)) {
      this.notifier.show({
        message: this.i18n.t('tools.link.invalidLink'),
        style: 'error',
      });

      _.log('Incorrect Link pasted', 'warn', value);

      return;
    }

    const preparedValue = this.prepareLink(value);

    this.selection.removeFakeBackground();
    this.selection.restore();

    this.insertLink(preparedValue);

    /**
     * Preventing events that will be able to happen
     */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.selection.collapseToEnd();
    this.inlineToolbar.close();
  }

  /**
   * Detects if passed string is URL
   * @param {string} str - string to validate
   * @returns {boolean}
   */
  private validateURL(str: string): boolean {
    /**
     * Don't allow spaces
     */
    return !/\s/.test(str);
  }

  /**
   * Process link before injection
   * - sanitize
   * - add protocol for links like 'google.com'
   * @param {string} link - raw user input
   */
  private prepareLink(link: string): string {
    return this.addProtocol(link.trim());
  }

  /**
   * Add 'http' protocol to the links like 'vc.ru', 'google.com'
   * @param {string} link - string to process
   */
  private addProtocol(link: string): string {
    /**
     * If protocol already exists, do nothing
     */
    if (/^(\w+):(\/\/)?/.test(link)) {
      return link;
    }

    /**
     * We need to add missed HTTP protocol to the link, but skip 2 cases:
     *     1) Internal links like "/general"
     *     2) Anchors looks like "#results"
     *     3) Protocol-relative URLs like "//google.com"
     */
    const isInternal = /^\/[^/\s]/.test(link);
    const isAnchor = link.substring(0, 1) === '#';
    const isProtocolRelative = /^\/\/[^/\s]/.test(link);

    if (!isInternal && !isAnchor && !isProtocolRelative) {
      return 'http://' + link;
    }

    return link;
  }

  /**
   * Inserts <a> tag with "href"
   * @param {string} link - "href" value
   */
  private insertLink(link: string): void {
    /**
     * Edit all link, not selected part
     */
    const anchorTag = this.selection.findParentTag('A') as HTMLAnchorElement;

    if (anchorTag) {
      this.selection.expandToTag(anchorTag);

      anchorTag.href = link;
      anchorTag.target = '_blank';
      anchorTag.rel = 'nofollow';

      return;
    }

    const range = SelectionUtils.range;

    if (!range) {
      return;
    }

    const anchor = document.createElement('a');

    anchor.href = link;
    anchor.target = '_blank';
    anchor.rel = 'nofollow';

    anchor.appendChild(range.extractContents());

    range.insertNode(anchor);

    this.selection.expandToTag(anchor);
  }

  /**
   * Removes <a> tag
   */
  private unlink(): void {
    const anchorTag = this.selection.findParentTag('A');

    if (anchorTag) {
      this.unwrap(anchorTag);
      this.updateButtonStateAttributes(false);
      this.unlinkAvailable = false;
    }
  }

  /**
   * Unwrap passed node
   * @param term - node to unwrap
   */
  private unwrap(term: HTMLElement): void {
    const docFrag = document.createDocumentFragment();

    while (term.firstChild) {
      docFrag.appendChild(term.firstChild);
    }

    term.parentNode?.replaceChild(docFrag, term);
  }

  /**
   * Persist state as data attributes for testing hooks
   * @param element - The HTML element to set the attribute on, or null
   * @param attributeName - The name of the attribute to set
   * @param state - The boolean state value to persist
   */
  private setBooleanStateAttribute(element: HTMLElement | null, attributeName: string, state: boolean): void {
    if (!element) {
      return;
    }

    element.setAttribute(attributeName, state ? 'true' : 'false');
  }
};

export default LinkInlineTool;
