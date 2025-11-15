import SelectionUtils from '../selection';
import * as _ from '../utils';
import type { InlineTool, SanitizerConfig, API } from '../../../types';
import type { Notifier, Toolbar, I18n, InlineToolbar } from '../../../types/api';
import { IconLink, IconUnlink } from '@codexteam/icons';

/**
 * Link Tool
 *
 * Inline Toolbar Tool
 *
 * Wrap selected text with <a> tag
 */
export default class LinkInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   *
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for hover-tooltip
   */
  public static title = 'Link';

  /**
   * Sanitizer Rule
   * Leave <a> tags
   *
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
   * Native Document's commands for link/unlink
   */
  private readonly commandLink: string = 'createLink';
  private readonly commandUnlink: string = 'unlink';

  /**
   * Enter key code
   */
  private readonly ENTER_KEY: number = 13;

  /**
   * Styles
   */
  private readonly CSS = {
    button: 'ce-inline-tool',
    buttonActive: 'ce-inline-tool--active',
    buttonModifier: 'ce-inline-tool--link',
    buttonUnlink: 'ce-inline-tool--unlink',
    input: 'ce-inline-tool-input',
    inputShowed: 'ce-inline-tool-input--showed',
  };
  /**
   * Data attributes for e2e selectors
   */
  private readonly DATA_ATTRIBUTES = {
    buttonActive: 'data-link-tool-active',
    buttonUnlink: 'data-link-tool-unlink',
    inputOpened: 'data-link-tool-input-opened',
  } as const;

  /**
   * Elements
   */
  private nodes: {
    button: HTMLButtonElement | null;
    input: HTMLInputElement | null;
  } = {
      button: null,
      input: null,
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
   * @param api - Editor.js API
   */
  constructor({ api }: { api: API }) {
    this.toolbar = api.toolbar;
    this.inlineToolbar = api.inlineToolbar;
    this.notifier = api.notifier;
    this.i18n = api.i18n;
    this.selection = new SelectionUtils();
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): HTMLElement {
    this.nodes.button = document.createElement('button') as HTMLButtonElement;
    this.nodes.button.type = 'button';
    this.nodes.button.classList.add(this.CSS.button, this.CSS.buttonModifier);
    this.setBooleanStateAttribute(this.nodes.button, this.DATA_ATTRIBUTES.buttonActive, false);
    this.setBooleanStateAttribute(this.nodes.button, this.DATA_ATTRIBUTES.buttonUnlink, false);

    this.nodes.button.innerHTML = IconLink;

    return this.nodes.button;
  }

  /**
   * Input for the link
   */
  public renderActions(): HTMLElement {
    this.nodes.input = document.createElement('input') as HTMLInputElement;
    this.nodes.input.placeholder = this.i18n.t('Add a link');
    this.nodes.input.enterKeyHint = 'done';
    this.nodes.input.classList.add(this.CSS.input);
    this.setBooleanStateAttribute(this.nodes.input, this.DATA_ATTRIBUTES.inputOpened, false);
    this.nodes.input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.keyCode === this.ENTER_KEY) {
        this.enterPressed(event);
      }
    });

    return this.nodes.input;
  }

  /**
   * Handle clicks on the Inline Toolbar icon
   *
   * @param {Range | null} range - range to wrap with link
   */
  public surround(range: Range | null): void {
    if (!range) {
      this.toggleActions();

      return;
    }

    /**
     * Save selection before change focus to the input
     */
    if (!this.inputOpened) {
      /** Create blue background instead of selection */
      this.selection.setFakeBackground();
      this.selection.save();
    } else {
      this.selection.restore();
      this.selection.removeFakeBackground();
    }
    const parentAnchor = this.selection.findParentTag('A');

    /**
     * Unlink icon pressed
     */
    if (parentAnchor) {
      this.selection.expandToTag(parentAnchor);
      this.unlink();
      this.closeActions();
      this.checkState();
      this.toolbar.close();

      return;
    }

    this.toggleActions();
  }

  /**
   * Check selection and set activated state to button if there are <a> tag
   */
  public checkState(): boolean {
    const anchorTag = this.selection.findParentTag('A');

    if (!this.nodes.button || !this.nodes.input) {
      return !!anchorTag;
    }

    if (anchorTag) {
      this.nodes.button.innerHTML = IconUnlink;
      this.nodes.button.classList.add(this.CSS.buttonUnlink);
      this.nodes.button.classList.add(this.CSS.buttonActive);
      this.setBooleanStateAttribute(this.nodes.button, this.DATA_ATTRIBUTES.buttonUnlink, true);
      this.setBooleanStateAttribute(this.nodes.button, this.DATA_ATTRIBUTES.buttonActive, true);
      this.openActions();

      /**
       * Fill input value with link href
       */
      const hrefAttr = anchorTag.getAttribute('href');

      this.nodes.input.value = hrefAttr !== null ? hrefAttr : '';

      this.selection.save();
    } else {
      this.nodes.button.innerHTML = IconLink;
      this.nodes.button.classList.remove(this.CSS.buttonUnlink);
      this.nodes.button.classList.remove(this.CSS.buttonActive);
      this.setBooleanStateAttribute(this.nodes.button, this.DATA_ATTRIBUTES.buttonUnlink, false);
      this.setBooleanStateAttribute(this.nodes.button, this.DATA_ATTRIBUTES.buttonActive, false);
    }

    return !!anchorTag;
  }

  /**
   * Function called with Inline Toolbar closing
   */
  public clear(): void {
    this.closeActions();
  }

  /**
   * Set a shortcut
   */
  public get shortcut(): string {
    return 'CMD+K';
  }

  /**
   * Show/close link input
   */
  private toggleActions(): void {
    if (!this.inputOpened) {
      this.openActions(true);
    } else {
      this.closeActions(false);
    }
  }

  /**
   * @param {boolean} needFocus - on link creation we need to focus input. On editing - nope.
   */
  private openActions(needFocus = false): void {
    if (!this.nodes.input) {
      return;
    }
    this.nodes.input.classList.add(this.CSS.inputShowed);
    this.setBooleanStateAttribute(this.nodes.input, this.DATA_ATTRIBUTES.inputOpened, true);
    if (needFocus) {
      this.nodes.input.focus();
    }
    this.inputOpened = true;
  }

  /**
   * Close input
   *
   * @param {boolean} clearSavedSelection — we don't need to clear saved selection
   *                                        on toggle-clicks on the icon of opened Toolbar
   */
  private closeActions(clearSavedSelection = true): void {
    if (this.selection.isFakeBackgroundEnabled) {
      // if actions is broken by other selection We need to save new selection
      const currentSelection = new SelectionUtils();

      currentSelection.save();

      this.selection.restore();
      this.selection.removeFakeBackground();

      // and recover new selection after removing fake background
      currentSelection.restore();
    }

    if (!this.nodes.input) {
      return;
    }
    this.nodes.input.classList.remove(this.CSS.inputShowed);
    this.setBooleanStateAttribute(this.nodes.input, this.DATA_ATTRIBUTES.inputOpened, false);
    this.nodes.input.value = '';
    if (clearSavedSelection) {
      this.selection.clearSaved();
    }
    this.inputOpened = false;
  }

  /**
   * Enter pressed on input
   *
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

      return;
    }

    if (!this.validateURL(value)) {
      this.notifier.show({
        message: 'Pasted link is not valid.',
        style: 'error',
      });

      _.log('Incorrect Link pasted', 'warn', value);

      return;
    }

    const preparedValue = this.prepareLink(value);

    this.selection.restore();
    this.selection.removeFakeBackground();

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
   *
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
   *
   * @param {string} link - raw user input
   */
  private prepareLink(link: string): string {
    return this.addProtocol(link.trim());
  }

  /**
   * Add 'http' protocol to the links like 'vc.ru', 'google.com'
   *
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
   *
   * @param {string} link - "href" value
   */
  private insertLink(link: string): void {
    /**
     * Edit all link, not selected part
     */
    const anchorTag = this.selection.findParentTag('A');

    if (anchorTag) {
      this.selection.expandToTag(anchorTag);
    }

    document.execCommand(this.commandLink, false, link);
  }

  /**
   * Removes <a> tag
   */
  private unlink(): void {
    document.execCommand(this.commandUnlink);
  }

  /**
   * Persist state as data attributes for testing hooks
   *
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
}
