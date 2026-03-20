import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { Notifier, Toolbar, I18n, InlineToolbar } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector, INLINE_TOOLBAR_INTERFACE_VALUE } from '../constants';
import { IconLink } from '../icons';
import { SelectionUtils } from '../selection/index';
import { log } from '../utils';
import { PopoverItemType } from '../utils/popover';
import { twMerge } from '../utils/tw';

/** SVG icons for the link suggestion chip — 20×20 viewBox, stroke-width 1.25, matching project icon style */
const ICON_GLOBE = '<svg width="28" height="28" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.25"/><path d="M10 4C8 6 7.5 8 7.5 10C7.5 12 8 14 10 16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4C12 6 12.5 8 12.5 10C12.5 12 12 14 10 16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 10H16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
const ICON_MAIL = '<svg width="28" height="28" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="5.5" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M3 7.5L10 12L17 7.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_HASH = '<svg width="28" height="28" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 4L6 16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M14 4L12.5 16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M4 8.5H16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M4 12H16" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';

const SUGGESTION_ROW_VALID = 'flex items-center gap-2 w-full mt-0.5 px-1.5 py-1.5 rounded-md text-left cursor-pointer can-hover:hover:bg-item-hover-bg transition-colors';
const SUGGESTION_ROW_INVALID = 'flex items-center gap-2 w-full mt-0.5 px-1.5 py-1.5 rounded-md text-left pointer-events-none';

/**
 * Link Tool
 *
 * Inline Toolbar Tool
 *
 * Wrap selected text with <a> tag
 */
export class LinkInlineTool implements InlineTool {
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
  private readonly INPUT_BASE_CLASSES = 'hidden w-[200px] m-0 px-2 py-1 text-sm leading-[22px] font-medium text-text-primary bg-item-hover-bg border border-link-input-border rounded-lg! outline-hidden box-border appearance-none font-[inherit] placeholder:text-gray-text mobile:text-[15px] mobile:font-medium';

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
    inputWrapper: HTMLElement | null;
    suggestion: HTMLElement | null;
    button: HTMLButtonElement | null;
  } = {
      input: null,
      inputWrapper: null,
      suggestion: null,
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
    this.nodes.suggestion = this.createSuggestion();
    this.nodes.inputWrapper = document.createElement('div');
    this.nodes.inputWrapper.append(this.nodes.input, this.nodes.suggestion);
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconLink,
      name: 'link',
      isActive: () => !!this.selection.findParentTag('A'),
      children: {
        hideChevron: true,
        items: [
          {
            type: PopoverItemType.Html,
            // Wrapper contains the input and suggestion chip
            element: this.nodes.inputWrapper as HTMLElement,
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
    const input = document.createElement('input');

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
    input.addEventListener('paste', () => {
      requestAnimationFrame(() => {
        this.updateSuggestion(input.value);
      });
    });
    input.addEventListener('input', () => {
      this.updateSuggestion(input.value);
    });

    return input;
  }

  /**
   * Create the suggestion chip shown below the input when a URL is present
   */
  private createSuggestion(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.className = 'hidden';
    wrapper.setAttribute('data-link-suggestion', '');

    const divider = document.createElement('div');

    divider.className = 'mt-1 mb-0.5 h-px bg-link-input-border';

    const row = document.createElement('button');

    row.type = 'button';
    row.className = SUGGESTION_ROW_VALID;
    row.setAttribute('data-link-suggestion-row', '');

    const iconEl = document.createElement('span');

    iconEl.className = 'text-gray-text shrink-0 flex';
    iconEl.setAttribute('data-link-suggestion-icon', '');

    const textEl = document.createElement('span');

    textEl.className = 'flex-1 min-w-0';

    const urlEl = document.createElement('span');

    urlEl.className = 'block text-xs font-medium text-text-primary truncate';
    urlEl.setAttribute('data-link-suggestion-url', '');

    const typeEl = document.createElement('span');

    typeEl.className = 'block text-[10.5px] text-gray-text leading-tight mt-px';
    typeEl.setAttribute('data-link-suggestion-type', '');

    textEl.append(urlEl, typeEl);
    row.append(iconEl, textEl);
    wrapper.append(divider, row);

    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => this.confirmLink());

    return wrapper;
  }

  /**
   * Update the suggestion chip content and visibility based on current input value
   */
  private updateSuggestion(value: string): void {
    if (!this.nodes.suggestion) {
      return;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      this.nodes.suggestion.classList.add('hidden');

      return;
    }

    const isComplete = this.isLinkComplete(trimmed);
    const { icon, label } = this.getLinkTypeInfo(trimmed);
    const iconEl = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-icon]');
    const urlEl = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-url]');
    const typeEl = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-type]');
    const row = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-row]');

    if (iconEl) {
      iconEl.innerHTML = icon;
      iconEl.className = `${isComplete ? 'text-gray-text' : 'text-gray-text opacity-40'} shrink-0 flex`;
    }
    if (urlEl) {
      urlEl.textContent = trimmed;
      urlEl.className = `block text-xs font-medium truncate ${isComplete ? 'text-text-primary' : 'text-gray-text'}`;
    }
    if (typeEl) {
      typeEl.textContent = isComplete ? label : 'Keep typing to add a link';
      typeEl.className = 'block text-[10.5px] text-gray-text leading-tight mt-px';
    }
    if (row) {
      row.className = isComplete ? SUGGESTION_ROW_VALID : SUGGESTION_ROW_INVALID;
    }

    this.nodes.suggestion.classList.remove('hidden');
  }

  /**
   * Return true if the URL is complete enough to confirm as a link.
   *
   * Rules by category:
   *  - http/https   → must have at least one character after "://"
   *  - other ://    → same (ftp, ws, etc.)
   *  - mailto/tel/… → must have something after the colon
   *  - //host       → must have at least one character after "//"
   *  - #anchor      → must have at least one character after "#"
   *  - /path        → always valid (internal link)
   *  - plain text   → must look like a domain (dot + 2+ letter TLD) or IP address
   */
  private isLinkComplete(url: string): boolean {
    // http / https — require a non-empty host after "://"
    if (/^https?:\/\//i.test(url)) {
      return url.replace(/^https?:\/\//i, '').length > 0;
    }
    // Other double-slash protocols (ftp://, ws://, etc.)
    if (/^\w+:\/\//.test(url)) {
      return url.replace(/^\w+:\/\//, '').length > 0;
    }
    // Single-colon schemes: mailto:, tel:, sms:, etc. — require something after ":"
    if (/^\w+:/.test(url)) {
      return url.slice(url.indexOf(':') + 1).length > 0;
    }
    // Protocol-relative — require a non-empty host after "//"
    if (url.startsWith('//')) {
      return url.slice(2).length > 0;
    }
    // Anchor — require at least one character after "#"
    if (url.startsWith('#')) {
      return url.length > 1;
    }
    // Absolute internal path — always valid
    if (url.startsWith('/')) {
      return true;
    }
    // Plain text — must look like a domain or IP address
    return /\.[a-zA-Z]{2,}/.test(url) || /^\d{1,3}(\.\d{1,3}){3}/.test(url);
  }

  /**
   * Return the icon SVG and human-readable label for a given URL
   */
  private getLinkTypeInfo(url: string): { icon: string; label: string } {
    if (url.startsWith('mailto:')) {
      return { icon: ICON_MAIL, label: 'Email address' };
    }
    if (url.startsWith('#')) {
      return { icon: ICON_HASH, label: 'Jump to section' };
    }

    return { icon: ICON_GLOBE, label: 'Link to web page' };
  }

  /**
   * Insert the link from the input — called by the suggestion chip click
   */
  private confirmLink(): void {
    if (!this.nodes.input) {
      return;
    }

    const value = this.nodes.input.value || '';

    if (!value.trim() || !this.isLinkComplete(value.trim())) {
      return;
    }

    if (!this.validateURL(value)) {
      this.notifier.show({
        message: this.i18n.t('tools.link.invalidLink'),
        style: 'error',
      });

      return;
    }

    const preparedValue = this.prepareLink(value);

    this.selection.removeFakeBackground();
    this.selection.restore();
    this.insertLink(preparedValue);
    this.selection.collapseToEnd();
    this.inlineToolbar.close();
  }

  /**
   * Shortcut for the link tool
   */
  public static shortcut = 'CMD+K';

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

    this.updateSuggestion(this.nodes.input.value);

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
    // Always query fresh to ensure we have the latest DOM element
    const button = document.querySelector<HTMLButtonElement>(
      `${createSelector(DATA_ATTR.interface, INLINE_TOOLBAR_INTERFACE_VALUE)} [data-blok-item-name="link"]`
    );

    // Only add click listener if this is a new button element
    if (button && button !== this.nodes.button) {
      button.addEventListener('click', this.handleButtonClick, true);
      this.nodes.button = button;
    }

    return button;
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
    this.nodes.suggestion?.classList.add('hidden');
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

      log('Incorrect Link pasted', 'warn', value);

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
    const anchorTag = this.selection.findParentTag('A');

    if (anchorTag instanceof HTMLAnchorElement) {
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

