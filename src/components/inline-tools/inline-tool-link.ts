import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { BlokConfig } from '../../../types/configs/blok-config';
import type { Blocks, Notifier, Toolbar, I18n, InlineToolbar } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector, INLINE_TOOLBAR_INTERFACE_VALUE } from '../constants';
import { IconLink, IconGlobe, IconMail, IconHash, IconTrash, IconReturn, IconWarning, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6 } from '../icons';
import { SelectionUtils } from '../selection/index';
import { log } from '../utils';
import { PopoverItemType } from '../utils/popover';
import { setFieldValidity } from '../utils/field-validity';
import { applyResolvedLinkAttributes, resolveLinkAttributes } from '../utils/resolve-link-attributes';
import { hasUnsafeScheme } from '../utils/sanitize-url';
import { twMerge } from '../utils/tw';
import { isHttpUrl } from '../../tools/link/registry';
import { MetadataFetcher } from '../../tools/link/metadata-fetcher';
import { getRecentLinks, recordRecentLink, updateRecentLinkMeta, type RecentLink } from './link-history';

const SUGGESTION_ROW_BASE = 'flex items-center gap-2.5 w-full mt-0.5 px-1.5 py-1.5 rounded-[10px] text-left appearance-none border-0 bg-transparent font-[inherit] outline-hidden';
const SUGGESTION_ROW_VALID = `${SUGGESTION_ROW_BASE} cursor-pointer can-hover:hover:bg-item-hover-bg focus-visible:bg-item-hover-bg transition-colors`;
const SUGGESTION_ROW_INVALID = `${SUGGESTION_ROW_BASE} pointer-events-none`;

/**
 * The suggestion's leading icon sits in the same fixed box the popover menus
 * use for their item icons, so the link card reads as part of one system.
 */
const SUGGESTION_ICON_CLASSES = 'flex items-center justify-center size-6 shrink-0 text-gray-text transition-opacity duration-150 [&_svg]:size-4';
const SUGGESTION_URL_TEXT = 'block text-[13px] leading-[18px] font-medium truncate';
const SUGGESTION_TYPE_TEXT = 'block text-[11px] leading-[14px] text-gray-text mt-px';

/**
 * ⏎ affordance on the confirmable suggestion row. Shown only when pressing
 * Enter would actually insert the link.
 */
const ENTER_HINT_CLASSES = 'items-center justify-center size-5 shrink-0 text-gray-text [&_svg]:size-3.5';

/**
 * Absent from the locale dictionaries on purpose: a new key resets the
 * translation audit ledger. Kept in a const so the static i18n scan skips it.
 */
const RECENT_LABEL_KEY = 'tools.link.recent';
const HEADINGS_LABEL_KEY = 'tools.link.onThisPage';

const HEADING_LIMIT = 6;
const HEADING_ICONS: Record<number, string> = { 1: IconH1, 2: IconH2, 3: IconH3, 4: IconH4, 5: IconH5, 6: IconH6 };

/**
 * Link kinds offered when the field has nothing else to show. Picking one
 * types its prefix into the field.
 */
const LINK_KINDS = [
  { icon: IconGlobe, titleKey: 'tools.link.webLink', prefix: 'https://' },
  { icon: IconMail, titleKey: 'tools.link.emailAddress', prefix: 'mailto:' },
] as const;

/**
 * A heading in this document that a link can jump to.
 */
interface HeadingTarget {
  blockId: string;
  level: number;
  text: string;
}

/**
 * Rows cascade in with the suggestion row's keyframes. Each row sets its own
 * animation-delay; motion-safe drops the whole cascade for reduced motion.
 */
const OPTION_ROW_CLASSES = 'group flex items-center gap-2.5 w-full h-8 px-2 rounded-lg cursor-pointer can-hover:hover:bg-item-hover-bg aria-selected:bg-item-hover-bg transition-colors motion-safe:animate-[blok-link-reveal_160ms_ease-out_both]';
// One line per row: the title truncates first, the site name keeps its room.
const OPTION_TEXT_CLASSES = 'flex-1 min-w-0 flex items-baseline gap-2';
const OPTION_TITLE_CLASSES = 'min-w-0 text-sm leading-5 text-text-primary truncate';
const OPTION_META_CLASSES = 'shrink-0 max-w-[45%] text-xs leading-4 text-gray-text truncate';
const OPTION_ICON_CLASSES = 'flex items-center justify-center size-5 shrink-0 text-gray-text [&_svg]:size-5';
const HEADING_ICON_CLASSES = 'flex items-center justify-center size-5 shrink-0 text-gray-text opacity-60 [&_svg]:size-4';
// A section that follows a visible one gets extra room above its label.
const SECTION_CLASSES = 'w-0 min-w-full [[data-link-group]:not([hidden])~&]:pt-1.5';
const SECTION_LABEL_CLASSES = 'px-2 pt-1.5 pb-1 text-xs leading-4 font-medium text-gray-text';
const RECENT_TILE_CLASSES = 'flex items-center justify-center size-5 shrink-0 rounded-[5px] bg-item-hover-bg overflow-hidden text-[11px] font-semibold text-gray-text';

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
   * Leave <a> tags. target/rel pass through (instead of being forced to the
   * defaults) so consumer-configured BlokConfig.link.target / .rel values
   * survive save-time sanitization. Created anchors still default to
   * '_blank'/'nofollow' via insertLink().
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      a: {
        href: true,
        target: true,
        rel: true,
      },
    };
  }

  /**
   * Tailwind classes for input
   */
  private readonly INPUT_BASE_CLASSES = 'hidden w-full min-w-[220px] m-0 px-2.5 py-1.5 text-sm leading-[22px] font-medium text-text-primary bg-item-hover-bg border border-transparent rounded-[10px]! outline-hidden box-border appearance-none font-[inherit] placeholder:text-gray-text transition-[background-color,border-color,box-shadow] duration-150 ease-out focus:bg-popover-bg focus:border-search-input-focus-border aria-invalid:border-[var(--blok-color-danger)] focus:aria-invalid:border-[var(--blok-color-danger)] mobile:text-[15px] mobile:font-medium';

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
    urlLabel: HTMLElement | null;
    titleInput: HTMLInputElement | null;
    titleLabel: HTMLElement | null;
    inputWrapper: HTMLElement | null;
    suggestion: HTMLElement | null;
    options: HTMLElement | null;
    recent: HTMLElement | null;
    recentList: HTMLElement | null;
    headings: HTMLElement | null;
    headingList: HTMLElement | null;
    kinds: HTMLElement | null;
    error: HTMLElement | null;
    errorMessage: HTMLElement | null;
    divider: HTMLElement | null;
    removeButton: HTMLButtonElement | null;
    button: HTMLButtonElement | null;
  } = {
      input: null,
      urlLabel: null,
      options: null,
      recent: null,
      recentList: null,
      headings: null,
      headingList: null,
      kinds: null,
      titleInput: null,
      titleLabel: null,
      inputWrapper: null,
      suggestion: null,
      error: null,
      errorMessage: null,
      divider: null,
      removeButton: null,
      button: null,
    };

  /**
   * Whether the popover is editing an existing link (vs. creating one). In edit
   * mode the labeled Page/Title fields replace the create-mode suggestion chip.
   */
  private editing = false;

  /**
   * Option row picked with the arrow keys, -1 for none. Focus never leaves
   * the field: the popover's Flipper owns arrow keys on any other target.
   */
  private activeOptionIndex = -1;

  /**
   * Headings of this document, read on every open.
   */
  private headingTargets: HeadingTarget[] = [];

  /**
   * Stable id linking the input to its inline error via aria-describedby.
   */
  private readonly errorId = `blok-link-tool-error-${Math.random().toString(36).slice(2, 9)}`;

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
   * Blocks API, read for the document's headings
   */
  private blocks: Blocks;

  /**
   * Global anchor-building config (target / rel / transformHref)
   */
  private linkConfig: NonNullable<BlokConfig['link']>;

  /**
   * @param api - Blok API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.toolbar = api.toolbar;
    this.inlineToolbar = api.inlineToolbar;
    this.notifier = api.notifier;
    this.i18n = api.i18n;
    this.blocks = api.blocks;
    this.linkConfig = api.config.link ?? {};
    this.selection = new SelectionUtils();
    this.nodes.urlLabel = this.createFieldLabel(this.i18n.t('tools.link.pageOrUrl'), 'inline-tool-url-label', false);
    this.nodes.input = this.createInput();
    this.nodes.suggestion = this.createSuggestion();
    this.nodes.recent = this.createRecent();
    this.nodes.headings = this.createHeadings();
    this.nodes.kinds = this.createKinds();
    this.nodes.options = this.createOptions();
    this.nodes.error = this.createError();
    this.nodes.titleLabel = this.createFieldLabel(this.i18n.t('tools.link.linkTitle'), 'inline-tool-title-label', true);
    this.nodes.titleInput = this.createTitleInput();
    this.nodes.divider = this.createDivider();
    this.nodes.removeButton = this.createRemoveButton();
    this.nodes.inputWrapper = document.createElement('div');
    // Horizontal padding keeps the URL input's 2px focus ring from being clipped
    // by the popover's overflow-y-auto items box, which sits flush to the wrapper.
    // One card width for every state, so the lists never make it jump.
    this.nodes.inputWrapper.className = 'px-1 w-80 mobile:w-auto';
    this.nodes.inputWrapper.append(
      this.nodes.urlLabel,
      this.nodes.input,
      this.nodes.error,
      this.nodes.suggestion,
      this.nodes.options,
      this.nodes.titleLabel,
      this.nodes.titleInput,
      this.nodes.divider,
      this.nodes.removeButton
    );
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
        // The link field reads as a continuation of the toolbar, so it opens
        // under the toolbar card instead of beside it.
        placement: 'below',
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
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${this.errorId}-options`);
    this.setBooleanStateAttribute(input, this.DATA_ATTRIBUTES.inputOpened, false);
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        this.enterPressed(event);
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        this.moveActiveOption(event);
      }
    });
    // A paste replaces the rejected value, so the stale error must not
    // linger next to the freshly revealed suggestion row.
    input.addEventListener('paste', () => requestAnimationFrame(() => this.refreshForValue()));
    input.addEventListener('input', () => this.refreshForValue());

    return input;
  }

  /**
   * Bring the error, the suggestion row and the lists in line with the value.
   */
  private refreshForValue(): void {
    this.clearValidationError();
    this.updateSuggestion(this.nodes.input?.value ?? '');
    this.updateOptions();
  }

  /**
   * Title (link text) input, shown only when editing an existing link so the
   * user can change the anchor's visible text alongside its href. Hidden when
   * creating a new link (the selected text is the link text in that case).
   */
  private createTitleInput(): HTMLInputElement {
    const input = document.createElement('input');

    input.placeholder = this.i18n.t('tools.link.linkText');
    input.enterKeyHint = 'done';
    input.className = this.INPUT_BASE_CLASSES;
    input.setAttribute('data-blok-testid', 'inline-tool-title-input');
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        this.enterPressed(event);
      }
    });

    return input;
  }

  /**
   * Small field caption shown above a field in edit mode (e.g. "Page or URL",
   * "Link title"). Hidden by default; revealed alongside its field.
   * @param text - the caption text
   * @param testid - e2e selector hook
   * @param topGap - whether to add top spacing (for the second, stacked label)
   */
  private createFieldLabel(text: string, testid: string, topGap: boolean): HTMLElement {
    const label = document.createElement('div');

    label.className = twMerge(
      // px-0.5 lines the caption up with the input's edge, not its text.
      'hidden px-0.5 mb-1.5 text-xs font-normal tracking-[0.01em] text-gray-text',
      topGap ? 'mt-3.5' : ''
    );
    label.textContent = text;
    label.setAttribute('data-blok-testid', testid);

    return label;
  }

  /**
   * Hairline separator above the "Remove link" action in edit mode.
   */
  private createDivider(): HTMLElement {
    const divider = document.createElement('div');

    divider.className = 'hidden mt-2.5 mb-1.5 -mx-1 h-px bg-link-input-border';
    divider.setAttribute('data-blok-testid', 'inline-tool-link-divider');

    return divider;
  }

  /**
   * "Remove link" action, shown only when editing an existing link. Unlinks the
   * anchor (keeping its text) and closes the toolbar. A destructive menu row:
   * neutral at rest, tinting red on hover (text + icon) to signal its intent.
   */
  private createRemoveButton(): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'hidden group/remove w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[10px] text-left text-sm font-medium text-text-primary cursor-pointer can-hover:hover:bg-red-500/10 can-hover:hover:text-red-500 focus-visible:bg-red-500/10 focus-visible:text-red-500 outline-hidden transition-colors appearance-none border-0 bg-transparent font-[inherit]';
    button.setAttribute('data-blok-testid', 'inline-tool-remove-link');

    const iconEl = document.createElement('span');

    iconEl.className = 'shrink-0 flex text-gray-text transition-colors can-hover:group-hover/remove:text-red-500 group-focus-visible/remove:text-red-500 [&>svg]:size-5';
    iconEl.innerHTML = IconTrash;

    const label = document.createElement('span');

    label.textContent = this.i18n.t('tools.link.removeLink');

    button.append(iconEl, label);

    // Keep the selection intact when the button takes focus, then remove.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => this.removeLinkAndClose());

    return button;
  }

  /**
   * Inline error region for URL validation failures. Linked to the input via
   * aria-describedby (see {@link setFieldValidity}) so the message is exposed
   * to assistive tech alongside the existing toast.
   */
  private createError(): HTMLElement {
    const error = document.createElement('div');

    // No display class on the root so the `hidden` attribute keeps working;
    // the flex layout lives on the inner row instead.
    error.id = this.errorId;
    // w-0 + min-w-full for the same reason as the suggestion wrapper: a long
    // localized message must not widen the content-driven card.
    error.className = 'w-0 min-w-full mt-1.5 px-1.5';
    error.setAttribute('data-blok-link-tool-error', '');
    error.setAttribute('role', 'alert');
    error.hidden = true;

    const row = document.createElement('span');

    row.className = 'flex items-center gap-1.5 text-xs font-medium text-[var(--blok-color-danger)]';

    const iconEl = document.createElement('span');

    iconEl.className = 'shrink-0 flex [&_svg]:size-3.5';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.innerHTML = IconWarning;

    const message = document.createElement('span');

    this.nodes.errorMessage = message;
    row.append(iconEl, message);
    error.append(row);

    return error;
  }

  /**
   * Surface a URL validation failure: fill and reveal the inline error and
   * mark the input aria-invalid, describing it by the error region.
   */
  private showValidationError(): void {
    if (!this.nodes.input || !this.nodes.error || !this.nodes.errorMessage) {
      return;
    }

    this.nodes.errorMessage.textContent = this.i18n.t('tools.link.invalidLink');
    this.nodes.error.hidden = false;
    // The error and the suggestion row contradict each other — while the URL
    // is rejected, the row must not keep offering that same URL as confirmable.
    this.nodes.suggestion?.classList.add('hidden');
    setFieldValidity(this.nodes.input, false, this.errorId);
  }

  /**
   * Reset the inline error and the input's invalid state.
   */
  private clearValidationError(): void {
    if (!this.nodes.input || !this.nodes.error) {
      return;
    }

    if (this.nodes.errorMessage) {
      this.nodes.errorMessage.textContent = '';
    }
    this.nodes.error.hidden = true;
    setFieldValidity(this.nodes.input, true, this.errorId);
  }

  /**
   * Create the suggestion chip shown below the input when a URL is present
   */
  private createSuggestion(): HTMLElement {
    const wrapper = document.createElement('div');

    // w-0 + min-w-full: the URL input alone drives the card's content-driven
    // width — the row contributes nothing to the intrinsic measurement (its
    // long untruncated URL text would otherwise inflate the card) yet still
    // renders at the card's resolved width, which is what lets it truncate.
    wrapper.className = 'hidden w-0 min-w-full';
    wrapper.setAttribute('data-link-suggestion', '');

    const divider = document.createElement('div');

    divider.className = 'mt-1 mb-0.5 h-px bg-link-input-border';

    const row = document.createElement('button');

    row.type = 'button';
    row.className = SUGGESTION_ROW_VALID;
    row.setAttribute('data-link-suggestion-row', '');

    const iconEl = document.createElement('span');

    iconEl.className = SUGGESTION_ICON_CLASSES;
    iconEl.setAttribute('data-link-suggestion-icon', '');

    const textEl = document.createElement('span');

    textEl.className = 'flex-1 min-w-0';

    const urlEl = document.createElement('span');

    urlEl.className = `${SUGGESTION_URL_TEXT} text-text-primary`;
    urlEl.setAttribute('data-link-suggestion-url', '');

    const typeEl = document.createElement('span');

    typeEl.className = SUGGESTION_TYPE_TEXT;
    typeEl.setAttribute('data-link-suggestion-type', '');

    const enterHint = document.createElement('span');

    enterHint.className = `hidden ${ENTER_HINT_CLASSES}`;
    enterHint.setAttribute('data-link-suggestion-enter-hint', '');
    enterHint.setAttribute('aria-hidden', 'true');
    enterHint.innerHTML = IconReturn;

    textEl.append(urlEl, typeEl);
    row.append(iconEl, textEl, enterHint);
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

    // The suggestion chip belongs to create mode only; in edit mode the labeled
    // Page/Title fields stand in for it.
    if (!trimmed || this.editing) {
      this.nodes.suggestion.classList.add('hidden');

      return;
    }

    const isComplete = this.isLinkComplete(trimmed);
    const { icon, label } = this.getLinkTypeInfo(trimmed);
    const iconEl = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-icon]');
    const urlEl = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-url]');
    const typeEl = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-type]');
    const row = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-row]');
    const enterHint = this.nodes.suggestion.querySelector<HTMLElement>('[data-link-suggestion-enter-hint]');

    if (iconEl) {
      iconEl.innerHTML = icon;
      iconEl.className = `${SUGGESTION_ICON_CLASSES} ${isComplete ? '' : 'opacity-50'}`.trim();
    }
    if (urlEl) {
      urlEl.textContent = trimmed;
      urlEl.className = `${SUGGESTION_URL_TEXT} ${isComplete ? 'text-text-primary' : 'text-gray-text'}`;
    }
    if (typeEl) {
      typeEl.textContent = isComplete ? label : this.i18n.t('tools.link.keepTyping');
    }
    if (row instanceof HTMLButtonElement) {
      row.className = isComplete ? SUGGESTION_ROW_VALID : SUGGESTION_ROW_INVALID;
      // pointer-events-none does not stop keyboard focus — keep the inert row
      // out of the tab order too.
      row.tabIndex = isComplete ? 0 : -1;
    }
    if (enterHint) {
      enterHint.className = `${isComplete ? 'flex' : 'hidden'} ${ENTER_HINT_CLASSES}`;
    }

    this.nodes.suggestion.classList.remove('hidden');
  }

  /**
   * The one listbox the field controls. Its sections are option groups, so
   * the arrow keys walk from the recent links straight into the headings.
   */
  private createOptions(): HTMLElement {
    const options = document.createElement('div');

    options.id = `${this.errorId}-options`;
    options.setAttribute('role', 'listbox');
    options.setAttribute('data-link-options', '');
    options.hidden = true;

    const divider = document.createElement('div');

    divider.className = 'mt-1.5 mb-1 h-px bg-link-input-border';

    options.append(divider, ...[this.nodes.recent, this.nodes.headings, this.nodes.kinds].filter((node) => node !== null));

    return options;
  }

  /**
   * A labelled option group. No display class on the root, so the `hidden`
   * attribute works.
   * @param id - label id, also the base of the list id
   * @param marker - data attribute naming the section
   * @param labelText - the section label, or null for none
   */
  private createSection(id: string, marker: string, labelText: string | null): { section: HTMLElement; list: HTMLElement } {
    const section = document.createElement('div');

    // A long title must not widen the card.
    section.className = SECTION_CLASSES;
    section.setAttribute('data-link-group', '');
    section.setAttribute(marker, '');
    section.setAttribute('role', 'group');
    section.hidden = true;

    if (labelText !== null) {
      const label = document.createElement('div');

      label.id = id;
      label.className = SECTION_LABEL_CLASSES;
      label.setAttribute(`${marker}-label`, '');
      label.textContent = labelText;
      section.setAttribute('aria-labelledby', id);
      section.append(label);
    }

    const list = document.createElement('div');

    list.id = `${id}-list`;
    list.className = 'flex flex-col';
    section.append(list);

    return { section, list };
  }

  /**
   * An option row. Not a <button>: every button in a popover HTML item
   * becomes a Flipper stop, and Flipper would steal the arrow keys from the
   * field.
   * @param kind - names the row's data markers: data-link-<kind>-row/-title/-meta
   * @param id - element id, used by aria-activedescendant
   * @param leading - icon or tile in front of the text
   * @param title - main line
   * @param meta - second line, skipped when empty
   * @param onPick - what a click or Enter does
   */
  private createOptionRow(kind: string, id: string, leading: HTMLElement, title: string, meta: string, onPick: () => void): HTMLElement {
    const row = document.createElement('div');

    row.id = id;
    row.className = OPTION_ROW_CLASSES;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute(`data-link-${kind}-row`, '');

    const textEl = document.createElement('span');

    textEl.className = OPTION_TEXT_CLASSES;

    const titleEl = document.createElement('span');

    titleEl.className = OPTION_TITLE_CLASSES;
    titleEl.setAttribute(`data-link-${kind}-title`, '');
    titleEl.textContent = title;
    textEl.append(titleEl);

    if (meta !== '') {
      const metaEl = document.createElement('span');

      metaEl.className = OPTION_META_CLASSES;
      metaEl.setAttribute(`data-link-${kind}-meta`, '');
      metaEl.textContent = meta;
      textEl.append(metaEl);
    }

    // Shown only while the row is the active option: Enter picks it.
    const enterHint = document.createElement('span');

    enterHint.className = `hidden group-aria-selected:flex ${ENTER_HINT_CLASSES}`;
    enterHint.setAttribute('aria-hidden', 'true');
    enterHint.setAttribute('data-link-option-enter-hint', '');
    enterHint.innerHTML = IconReturn;

    row.append(leading, textEl, enterHint);
    // Keep the saved selection and the field's focus while the row takes the click.
    row.addEventListener('mousedown', (event) => event.preventDefault());
    row.addEventListener('click', onPick);

    return row;
  }

  private createIcon(svg: string, className = OPTION_ICON_CLASSES): HTMLElement {
    const icon = document.createElement('span');

    icon.className = className;
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = svg;

    return icon;
  }

  /**
   * "Recent" list of the last links added, shown under the empty field.
   */
  private createRecent(): HTMLElement {
    const label = this.i18n.has(RECENT_LABEL_KEY) ? this.i18n.t(RECENT_LABEL_KEY) : 'Recent';
    const { section, list } = this.createSection(`${this.errorId}-recent`, 'data-link-recent', label);

    this.nodes.recentList = list;

    return section;
  }

  /**
   * "On this page": headings of this document a link can jump to.
   */
  private createHeadings(): HTMLElement {
    const label = this.i18n.has(HEADINGS_LABEL_KEY) ? this.i18n.t(HEADINGS_LABEL_KEY) : 'On this page';
    const { section, list } = this.createSection(`${this.errorId}-headings`, 'data-link-headings', label);

    this.nodes.headingList = list;

    return section;
  }

  /**
   * The kinds of link the field takes, for when there is nothing else to
   * show. Built once: the rows never change.
   */
  private createKinds(): HTMLElement {
    const { section, list } = this.createSection(`${this.errorId}-kinds`, 'data-link-kinds', null);

    list.append(...LINK_KINDS.map((kind, index) => {
      const row = this.createOptionRow(
        'kind',
        `${this.errorId}-kind-${index}`,
        this.createIcon(kind.icon),
        this.i18n.t(kind.titleKey),
        `${kind.prefix}…`,
        () => this.startWith(kind.prefix)
      );

      row.setAttribute('data-link-kind-prefix', kind.prefix);

      return row;
    }));

    return section;
  }

  /**
   * Type a link kind's prefix into the field and keep the caret there.
   * @param prefix - e.g. "mailto:"
   */
  private startWith(prefix: string): void {
    const input = this.nodes.input;

    if (!input) {
      return;
    }

    input.value = prefix;
    input.focus();
    input.setSelectionRange(prefix.length, prefix.length);
    this.refreshForValue();
  }

  /**
   * Rebuild the recent rows from storage. Called on every open, so a link
   * added in another editor on the page shows up too.
   */
  private renderRecent(): void {
    this.nodes.recentList?.replaceChildren(
      ...getRecentLinks().map((entry, index) => this.createRecentRow(entry, index))
    );
  }

  /**
   * One recent link: favicon or letter tile, then the page title over the
   * site name.
   * Without a title the site name moves into the title slot and the path
   * takes its place.
   * @param entry - the stored link
   * @param index - position in the list, drives the cascade delay
   */
  private createRecentRow(entry: RecentLink, index: number): HTMLElement {
    const parsed = (() => {
      try {
        return new URL(entry.url);
      } catch {
        return null;
      }
    })();
    const site = parsed?.hostname.replace(/^www\./, '') ?? entry.url;
    const path = parsed ? `${parsed.pathname}${parsed.search}`.replace(/^\/$/, '') : '';
    const title = entry.title ?? site;
    const meta = entry.title !== undefined ? site : path;

    const tile = document.createElement('span');

    tile.className = RECENT_TILE_CLASSES;
    tile.setAttribute('aria-hidden', 'true');

    const showMonogram = (): void => {
      const monogram = document.createElement('span');

      monogram.setAttribute('data-link-recent-monogram', '');
      monogram.textContent = (Array.from(title)[0] ?? '').toUpperCase();
      tile.replaceChildren(monogram);
    };

    if (entry.favicon !== undefined && isHttpUrl(entry.favicon)) {
      const img = document.createElement('img');

      img.className = 'size-4';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', showMonogram, { once: true });
      img.src = entry.favicon;
      tile.append(img);
    } else {
      showMonogram();
    }

    const row = this.createOptionRow('recent', `${this.errorId}-recent-${index}`, tile, title, meta, () => this.applyLink(entry.url));

    row.title = entry.url;
    row.style.animationDelay = `${index * 30}ms`;

    return row;
  }

  /**
   * Read the document's headings. A heading counts for the block whose own
   * holder is its nearest block holder, so a container never re-reports a
   * child's heading.
   */
  private readHeadings(): HeadingTarget[] {
    const holderSelector = `[${DATA_ATTR.element}]`;

    return Array.from({ length: this.blocks.getBlocksCount() }, (_, index) => this.blocks.getBlockByIndex(index))
      .flatMap((block) => {
        const heading = block?.holder.querySelector('h1, h2, h3, h4, h5, h6');
        const text = heading?.textContent?.trim() ?? '';

        return block !== undefined && heading && heading.closest(holderSelector) === block.holder && text !== ''
          ? [{ blockId: block.id, level: Number(heading.tagName.slice(1)), text }]
          : [];
      });
  }

  /**
   * Headings matching the field: all of them when it is empty or a bare "#",
   * otherwise those whose text contains the value (without its "#").
   * @param value - the trimmed field value
   */
  private matchHeadings(value: string): HeadingTarget[] {
    const query = (value.startsWith('#') ? value.slice(1) : value).trim().toLowerCase();

    return this.headingTargets
      .filter((heading) => heading.text.toLowerCase().includes(query))
      .slice(0, HEADING_LIMIT);
  }

  /**
   * @param matches - headings to list
   */
  private renderHeadings(matches: HeadingTarget[]): void {
    this.nodes.headingList?.replaceChildren(...matches.map((heading, index) => {
      const row = this.createOptionRow(
        'heading',
        `${this.errorId}-heading-${index}`,
        this.createIcon(HEADING_ICONS[heading.level] ?? IconHash, HEADING_ICON_CLASSES),
        heading.text,
        '',
        () => this.applyLink(`#${heading.blockId}`)
      );

      row.style.animationDelay = `${index * 30}ms`;
      row.setAttribute('data-link-heading-level', String(heading.level));

      return row;
    }));
  }

  /**
   * Show the sections that fit the field's value. Empty field: recent links
   * and headings, or the link kinds when there are neither. Typed value:
   * the headings it matches.
   */
  private updateOptions(): void {
    const { recent, headings, kinds, options, suggestion, input } = this.nodes;

    if (!recent || !headings || !kinds || !options || !input) {
      return;
    }

    const value = input.value.trim();
    const matches = this.editing ? [] : this.matchHeadings(value);
    const recentCount = this.nodes.recentList?.childElementCount ?? 0;
    const incomplete = value !== '' && !this.isLinkComplete(value);

    this.renderHeadings(matches);
    recent.hidden = this.editing || value !== '' || recentCount === 0;
    headings.hidden = matches.length === 0;
    kinds.hidden = this.editing || value !== '' || !recent.hidden || !headings.hidden;
    options.hidden = recent.hidden && headings.hidden && kinds.hidden;
    input.setAttribute('aria-expanded', String(!options.hidden));

    // A typed search picks its first heading (row 0: the other sections hide
    // once there is a value), so Enter jumps to it. The suggestion row would
    // then promise a different Enter, so it hides. A typed web link keeps
    // Enter for itself.
    const searching = matches.length > 0 && (value.startsWith('#') || incomplete);

    if (searching) {
      suggestion?.classList.add('hidden');
    }

    this.setActiveOption(searching ? 0 : -1);
  }

  /**
   * @param url - the link to put on the selection
   */
  private applyLink(url: string): void {
    if (!this.nodes.input) {
      return;
    }
    this.nodes.input.value = url;
    this.confirmLink();
  }

  /**
   * Option rows of the visible sections, in order.
   */
  private getOptionRows(): HTMLElement[] {
    const sections = [this.nodes.recent, this.nodes.headings, this.nodes.kinds];

    return sections
      .filter((section) => section !== null && !section.hidden)
      .flatMap((section) => Array.from(section?.querySelectorAll<HTMLElement>('[role="option"]') ?? []));
  }

  /**
   * ArrowDown/ArrowUp from the field. Up past the first row returns to the
   * field itself.
   * @param event - the arrow key press
   */
  private moveActiveOption(event: KeyboardEvent): void {
    const count = this.getOptionRows().length;

    if (count === 0) {
      return;
    }

    event.preventDefault();

    const next = event.key === 'ArrowDown'
      ? Math.min(this.activeOptionIndex + 1, count - 1)
      : Math.max(this.activeOptionIndex - 1, -1);

    this.setActiveOption(next);
  }

  /**
   * @param index - row to highlight, -1 for none
   */
  private setActiveOption(index: number): void {
    this.activeOptionIndex = index;

    const rows = this.getOptionRows();

    this.nodes.options?.querySelectorAll('[role="option"]').forEach((row) => row.setAttribute('aria-selected', 'false'));

    const active = rows[index];

    if (active) {
      active.setAttribute('aria-selected', 'true');
      this.nodes.input?.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.nodes.input?.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * Add an applied web link to the history and, when an unfurl endpoint is
   * set, look up its page title once.
   * @param url - the href that was applied
   */
  private rememberLink(url: string): void {
    if (!isHttpUrl(url)) {
      return;
    }

    recordRecentLink(url);

    const unfurl = this.linkConfig.unfurl;

    if (unfurl === undefined || getRecentLinks()[0]?.title !== undefined) {
      return;
    }

    new MetadataFetcher(unfurl)
      .fetch(url)
      .then((meta) => updateRecentLinkMeta(url, { title: meta.title, favicon: meta.favicon }))
      .catch(() => undefined);
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
      return { icon: IconMail, label: this.i18n.t('tools.link.emailAddress') };
    }
    if (url.startsWith('#')) {
      return { icon: IconHash, label: this.i18n.t('tools.link.jumpToSection') };
    }

    return { icon: IconGlobe, label: this.i18n.t('tools.link.webLink') };
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
      // Surface the failure once, via the accessible inline field error
      // (aria-invalid + error region). A duplicate notifier toast would render
      // the same "Invalid link" text a second time.
      this.showValidationError();

      return;
    }

    this.clearValidationError();

    const preparedValue = this.prepareLink(value);

    this.selection.removeFakeBackground();
    this.selection.restore();
    this.insertLink(preparedValue);
    this.rememberLink(preparedValue);
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

    /**
     * Editing an existing link surfaces the title field (prefilled with the
     * anchor's text) and the remove-link action. Creating a new link keeps them
     * hidden — the selected text already serves as the link text.
     */
    this.setEditAffordancesVisible(hasAnchor, anchorTag?.textContent ?? '');

    // Edit mode uses the labeled Page/Title fields, not the create-mode
    // suggestion chip — keep it hidden even though the URL is prefilled.
    this.updateSuggestion(this.nodes.input.value);
    this.renderRecent();
    this.headingTargets = this.editing ? [] : this.readHeadings();
    this.updateOptions();

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
   * Toggle the edit-only affordances (title field + remove button). When shown,
   * the title field is prefilled with the link's current text.
   * @param visible - whether the affordances should be shown
   * @param titleValue - text to prefill the title field with when shown
   */
  private setEditAffordancesVisible(visible: boolean, titleValue = ''): void {
    this.editing = visible;

    if (this.nodes.titleInput) {
      this.nodes.titleInput.value = visible ? titleValue : '';
      this.nodes.titleInput.className = visible
        ? twMerge(this.INPUT_BASE_CLASSES, 'block')
        : this.INPUT_BASE_CLASSES;
    }

    this.nodes.urlLabel?.classList.toggle('hidden', !visible);
    this.nodes.urlLabel?.classList.toggle('block', visible);
    this.nodes.titleLabel?.classList.toggle('hidden', !visible);
    this.nodes.titleLabel?.classList.toggle('block', visible);
    this.nodes.divider?.classList.toggle('hidden', !visible);
    this.nodes.divider?.classList.toggle('block', visible);
    this.nodes.removeButton?.classList.toggle('hidden', !visible);
    this.nodes.removeButton?.classList.toggle('flex', visible);
  }

  /**
   * Restore the selection, unlink the anchor (keeping its text) and close the
   * toolbar. Backs the explicit "Remove link" button in edit mode.
   */
  private removeLinkAndClose(): void {
    this.restoreSelection();
    this.unlink();
    this.inlineToolbar.close();
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
    this.setEditAffordancesVisible(false);
    this.clearValidationError();
    this.nodes.suggestion?.classList.add('hidden');
    this.headingTargets = [];
    this.nodes.headingList?.replaceChildren();
    [this.nodes.options, this.nodes.recent, this.nodes.headings, this.nodes.kinds].forEach((node) => node?.toggleAttribute('hidden', true));
    this.nodes.input.setAttribute('aria-expanded', 'false');
    this.setActiveOption(-1);
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
    const activeRow = this.getOptionRows()[this.activeOptionIndex];

    if (activeRow !== undefined) {
      event.preventDefault();
      activeRow.click();

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
      // Surface the failure once, via the accessible inline field error
      // (aria-invalid + error region). A duplicate notifier toast would render
      // the same "Invalid link" text a second time.
      this.showValidationError();

      log('Incorrect Link pasted', 'warn', value);

      return;
    }

    this.clearValidationError();

    const preparedValue = this.prepareLink(value);

    this.selection.removeFakeBackground();
    this.selection.restore();

    this.insertLink(preparedValue);
    this.rememberLink(preparedValue);

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
    if (/\s/.test(str)) {
      return false;
    }

    /**
     * Reject URL schemes that execute script when the anchor is clicked.
     * The anchor is inserted into the live document before any save-time
     * sanitization runs, so an unfiltered `javascript:`/`data:` href is
     * clickable XSS. An allowlist of safe schemes is used because denylists
     * keep losing to scheme smuggling (e.g. `data:image/svg+xml`).
     */
    if (hasUnsafeScheme(str)) {
      return false;
    }

    return true;
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
      /**
       * Apply an edited link text before re-selecting: only when it actually
       * changed, so an untouched anchor keeps its inner formatting instead of
       * being flattened to plain text. Done before resolving so the `link`
       * config's `transform` sees the final anchor text.
       */
      const newTitle = this.nodes.titleInput?.value ?? '';

      if (newTitle.trim() !== '' && newTitle !== anchorTag.textContent) {
        anchorTag.textContent = newTitle;
      }

      this.selection.expandToTag(anchorTag);

      // Same-page targeting, transformHref/transform and any extra attributes are
      // resolved centrally so hand-created links match render/paste exactly.
      applyResolvedLinkAttributes(anchorTag, resolveLinkAttributes(link, anchorTag, this.linkConfig));

      return;
    }

    const range = SelectionUtils.range;

    if (!range) {
      return;
    }

    const anchor = document.createElement('a');

    // Populate the anchor text before resolving so the `transform` sees it.
    anchor.appendChild(range.extractContents());

    applyResolvedLinkAttributes(anchor, resolveLinkAttributes(link, anchor, this.linkConfig));

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
