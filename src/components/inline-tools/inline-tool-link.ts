import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import { linkSanitize } from '../../shared/tool-descriptions/sanitize/inline';
import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { BlokConfig } from '../../../types/configs/blok-config';
import type { Blocks, Notifier, Toolbar, I18n, InlineToolbar, Tools } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector, INLINE_TOOLBAR_INTERFACE_VALUE } from '../constants';
import { IconLink, IconGlobe, IconMail, IconHash, IconTrash, IconReturn, IconWarning, IconPage, IconTable } from '../icons';
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
import { PAGE_REFERENCE_ATTR } from '../../shared/page-reference';
import { PAGE_PATH_SEPARATOR } from '../../tools/page/constants';
import { pageIconNode } from '../../tools/page/icon-node';
import { searchVisiblePages } from '../../tools/page/search-pages';
import type { PageConfig, PageSearchResult } from '../../tools/page/types';

// ps-0.5 and gap-2 put its 24px icon box and its text on the list rows' columns.
const SUGGESTION_ROW_BASE = 'flex items-center gap-2 w-full mt-0.5 ps-0.5 pe-2 py-1.5 rounded-(--blok-radius-inner,var(--blok-radius-control)) text-left appearance-none border-0 bg-transparent font-[inherit] outline-hidden';
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
const ENTER_HINT_CLASSES = 'items-center justify-center self-center size-5 shrink-0 text-gray-text [&_svg]:size-3.5';

const HEADING_LIMIT = 6;
const PAGE_LIMIT = 6;
// Pause after the last keystroke before the host is asked for pages.
const PAGE_SEARCH_DELAY = 150;
// Headings step in under their parent, never deeper than this.
const HEADING_MAX_DEPTH = 2;

/**
 * Link kinds offered when the field has nothing else to show. Picking one
 * types its prefix into the field.
 */
const LINK_KINDS = [
  { icon: IconGlobe, titleKey: 'tools.link.webPage', prefix: 'https://' },
  { icon: IconMail, titleKey: 'tools.link.emailAddress', prefix: 'mailto:' },
] as const;

/** A search hit, with the mark a host puts on a full-page database. */
type LinkPage = PageSearchResult & { kind?: 'database' };

/**
 * A heading in this document that a link can jump to.
 */
interface HeadingTarget {
  blockId: string;
  level: number;
  text: string;
  /** Steps in from the left edge: 0 for a heading with no parent above it. */
  depth: number;
}

/**
 * Rows cascade in with the suggestion row's keyframes. Each row sets its own
 * animation-delay; motion-safe drops the whole cascade for reduced motion.
 * The row starts 4px in from the field's edge and ends at the field's end.
 */
const OPTION_ROW_CLASSES = 'group flex items-start gap-2.5 w-full min-h-8 py-[5px] ps-1 pe-2 rounded-(--blok-radius-inner,var(--blok-radius-control)) cursor-pointer can-hover:hover:bg-item-hover-bg aria-selected:bg-item-hover-bg transition-colors motion-safe:animate-[blok-link-reveal_160ms_ease-out_both]';
// The title, with where it leads on a second line under it.
const OPTION_TEXT_CLASSES = 'flex-1 min-w-0 flex flex-col';
const OPTION_TITLE_CLASSES = 'min-w-0 text-sm leading-5 text-text-primary truncate';
const OPTION_META_CLASSES = 'min-w-0 text-xs leading-4 text-gray-text truncate';
const OPTION_ICON_CLASSES = 'flex items-center justify-center size-5 shrink-0 text-gray-text [&_svg]:size-5';
// A section that follows a visible one gets extra room above its label.
const SECTION_CLASSES = 'w-0 min-w-full [[data-link-group]:not([hidden])~&]:pt-2';
const SECTION_LABEL_CLASSES = 'px-1 pt-2 pb-1.5 text-xs leading-4 font-medium text-gray-text';
const PAGE_ICON_CLASSES = 'flex items-center justify-center size-5 shrink-0 text-base leading-none [&_img]:size-4 [&_img]:rounded-(--blok-radius-control-sm) [&_svg]:size-4 text-gray-text';
// The sign's size and line weight live in link-picker.css.
const RECENT_ICON_CLASSES = 'flex items-center justify-center size-5 shrink-0 text-gray-text';
// The list fades over its top and bottom edge (link-picker.css). The
// highlighted row stops short of each fade, and the list ends this far
// under its last whole row.
const FADE_TOP_CLEARANCE = 24;
const FADE_BOTTOM_CLEARANCE = 28;
const LIST_TAIL = 22;

/**
 * Link Tool
 *
 * Inline Toolbar Tool
 *
 * Wrap selected text with <a> tag
 */
export class LinkInlineTool implements InlineTool {
  public static describe = BUILT_IN_INLINE_DESCRIPTIONS.link;

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
    return linkSanitize();
  }

  /**
   * Layout classes for a closed input. The look comes from data-blok-field.
   * `hidden!` because field.css shows an input field with an unlayered
   * display rule that a plain `hidden` loses to.
   */
  private readonly INPUT_BASE_CLASSES = 'hidden! w-full min-w-[220px] m-0 box-border appearance-none';

  /**
   * Layout classes for an open input.
   */
  private readonly INPUT_OPEN_CLASSES = 'block w-full min-w-[220px] m-0 box-border appearance-none';

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
    pages: HTMLElement | null;
    pageList: HTMLElement | null;
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
      pages: null,
      pageList: null,
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
   * The host's pages for the field's value, as last answered.
   */
  private pageHits: LinkPage[] = [];

  /**
   * Page rows by page id, reused so a row that stays never replays its entrance.
   */
  private pageRows = new Map<string, HTMLElement>();

  /**
   * Bumped on every new search and on close: an answer with an old number is dropped.
   */
  private pageSearchToken = 0;

  private pageSearchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Links with a lookup in flight, so one link is never asked for twice at once.
   */
  private lookups = new Set<string>();

  /**
   * Headings of this document, read on every open.
   */
  private headingTargets: HeadingTarget[] = [];

  /**
   * Heading rows by block id, kept while the field is open so typing only
   * adds and removes rows.
   */
  private headingRows = new Map<string, HTMLElement>();

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
   * Tools API, read for the page tool's config
   */
  private tools: Tools;

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
    this.tools = api.tools;
    this.linkConfig = api.config.link ?? {};
    this.selection = new SelectionUtils();
    this.nodes.urlLabel = this.createFieldLabel(this.i18n.t('tools.link.pageOrUrl'), 'inline-tool-url-label', false);
    this.nodes.input = this.createInput();
    this.nodes.suggestion = this.createSuggestion();
    this.nodes.recent = this.createRecent();
    this.nodes.pages = this.createPages();
    this.nodes.headings = this.createHeadings();
    this.nodes.kinds = this.createKinds();
    this.nodes.options = this.createOptions();
    this.nodes.error = this.createError();
    this.nodes.titleLabel = this.createFieldLabel(this.i18n.t('tools.link.linkTitle'), 'inline-tool-title-label', true);
    this.nodes.titleInput = this.createTitleInput();
    this.nodes.divider = this.createDivider();
    this.nodes.removeButton = this.createRemoveButton();
    this.nodes.inputWrapper = document.createElement('div');
    // One card width for every state, so the lists never make it jump.
    this.nodes.inputWrapper.className = 'pt-0.5 w-80 mobile:w-auto';
    this.nodes.inputWrapper.setAttribute('data-link-field', '');
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
    input.setAttribute('data-blok-field', 'text');
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
    this.searchPages();
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
    input.setAttribute('data-blok-field', 'text');
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

    divider.className = 'hidden mt-2.5 mb-1.5 h-px bg-link-input-border';
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
    button.className = 'hidden group/remove w-full flex items-center gap-2.5 px-2 py-1.5 rounded-(--blok-radius-inner,var(--blok-radius-control)) text-left text-sm font-medium text-text-primary cursor-pointer can-hover:hover:bg-red-500/10 can-hover:hover:text-red-500 focus-visible:bg-red-500/10 focus-visible:text-red-500 outline-hidden transition-colors appearance-none border-0 bg-transparent font-[inherit]';
    button.setAttribute('data-blok-testid', 'inline-tool-remove-link');

    const iconEl = document.createElement('span');

    iconEl.className = 'shrink-0 flex text-gray-text transition-colors can-hover:group-hover/remove:text-red-500 in-focus-visible:text-red-500 [&>svg]:size-5';
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

    // Positioned, so a row's offsetTop is measured from the list itself.
    options.className = 'relative pt-2 pb-0.5';
    options.setAttribute(DATA_ATTR.popoverScroller, '');
    options.addEventListener('scroll', () => this.markScrollEdges(), { passive: true });
    options.append(...[this.nodes.recent, this.nodes.pages, this.nodes.headings, this.nodes.kinds].filter((node) => node !== null));

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
   * @param leading - icon in front of the text, or null for none
   * @param title - main line
   * @param meta - second line, skipped when empty
   * @param onPick - what a click or Enter does
   */
  private createOptionRow(kind: string, id: string, leading: HTMLElement | null, title: string, meta: string, onPick: () => void): HTMLElement {
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

    row.append(...(leading ? [leading] : []), textEl, enterHint);
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
    const { section, list } = this.createSection(`${this.errorId}-recent`, 'data-link-recent', this.i18n.t('tools.link.recent'));

    list.setAttribute('data-link-recent-list', '');
    this.nodes.recentList = list;

    return section;
  }

  /**
   * "Pages": the host's pages a link can point at.
   */
  private createPages(): HTMLElement {
    const { section, list } = this.createSection(`${this.errorId}-pages`, 'data-link-pages', this.i18n.t('tools.database.moveToPages'));

    this.nodes.pageList = list;

    return section;
  }

  /**
   * The page tool's config, when the host can both search pages and give
   * their addresses. Without either there is nothing to link to.
   */
  private pageHost(): PageConfig | null {
    const page = this.tools.getBlockTools().find((tool) => tool.name === 'page')?.settings as PageConfig | undefined;

    return page?.search !== undefined && page.href !== undefined ? page : null;
  }

  /**
   * A page's address, or '' when the host gives none or an unsafe one.
   * @param host - the page tool's config
   * @param pageId - the page to link to
   */
  private pageHref(host: PageConfig, pageId: string): string {
    try {
      const href = host.href?.(pageId) ?? '';

      return hasUnsafeScheme(href) ? '' : href;
    } catch {
      return '';
    }
  }

  /**
   * Drop the pending page search and any answer still on its way.
   */
  private cancelPageSearch(): void {
    this.pageSearchToken += 1;

    if (this.pageSearchTimer !== null) {
      clearTimeout(this.pageSearchTimer);
      this.pageSearchTimer = null;
    }
  }

  /**
   * Ask the host for the pages that fit the field's value: at once for an
   * empty field (its recent pages), after a short pause while typing. A
   * typed link, a "#" heading search and edit mode ask for nothing.
   */
  private searchPages(): void {
    const host = this.pageHost();
    const value = this.nodes.input?.value.trim() ?? '';

    this.cancelPageSearch();

    if (host === null || this.editing || value.startsWith('#') || (value !== '' && this.isLinkComplete(value))) {
      this.pageHits = [];

      return;
    }

    // Until the answer comes, keep the pages that still fit: the list does not blink on every key.
    this.pageHits = this.pageHits.filter((hit) => (hit.title ?? '').toLowerCase().includes(value.toLowerCase()));

    const token = this.pageSearchToken;
    const ask = (): void => {
      this.pageSearchTimer = null;
      searchVisiblePages(host, value)
        .then((hits) => {
          if (token !== this.pageSearchToken) {
            return;
          }

          this.pageHits = hits.filter((hit) => this.pageHref(host, hit.pageId) !== '').slice(0, PAGE_LIMIT);
          // The row the user is on keeps Enter: late pages never take it.
          this.updateOptions(this.getOptionRows()[this.activeOptionIndex]);
        })
        .catch(() => undefined);
    };

    if (value === '') {
      ask();
    } else {
      this.pageSearchTimer = setTimeout(ask, PAGE_SEARCH_DELAY);
    }
  }

  /**
   * Bring the page rows in line with the last answer.
   */
  private renderPages(): void {
    const list = this.nodes.pageList;
    const host = this.pageHost();

    if (!list || host === null) {
      return;
    }

    const query = (this.nodes.input?.value ?? '').trim().toLowerCase();
    const fresh = this.pageHits.filter((hit) => !this.pageRows.has(hit.pageId));
    const rows = this.pageHits.map((hit) => {
      const cached = this.pageRows.get(hit.pageId);
      const title = hit.title || this.i18n.t('tools.page.unresolved');

      if (cached) {
        this.markMatch(cached, 'page', title, query);

        return cached;
      }

      const icon = document.createElement('span');
      const href = this.pageHref(host, hit.pageId);
      const meta = [
        hit.status === 'draft' ? this.i18n.t('tools.page.draft') : '',
        (hit.path ?? []).join(PAGE_PATH_SEPARATOR),
      ].filter((part) => part !== '').join(' · ');

      icon.className = PAGE_ICON_CLASSES;
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('data-link-page-icon', '');
      icon.append(pageIconNode(hit.icon, hit.kind === 'database' ? IconTable : IconPage));

      const row = this.createOptionRow(
        'page',
        '',
        icon,
        title,
        meta,
        () => this.applyPageLink(href)
      );

      this.markMatch(row, 'page', title, query);
      row.style.animationDelay = `${fresh.indexOf(hit) * 30}ms`;
      this.pageRows.set(hit.pageId, row);

      return row;
    });

    // Patched, not rebuilt, for the same reason as the heading rows.
    Array.from(list.children).forEach((child) => {
      if (!rows.includes(child as HTMLElement)) {
        child.remove();
      }
    });
    rows.forEach((row, index) => {
      if (list.children[index] !== row) {
        list.insertBefore(row, list.children[index] ?? null);
      }
      row.setAttribute('id', `${this.errorId}-page-${index}`);
    });
  }

  /**
   * Link the selection to a page. The address is the host's own, so it skips
   * the typed-link rules, and a page is not a web link for the Recents list.
   * @param href - the page's address
   */
  private applyPageLink(href: string): void {
    this.clearValidationError();
    this.selection.removeFakeBackground();
    this.selection.restore();
    this.insertLink(href);
    this.inlineToolbar.close();
  }

  /**
   * "On this page": headings of this document a link can jump to.
   */
  private createHeadings(): HTMLElement {
    const { section, list } = this.createSection(
      `${this.errorId}-headings`,
      'data-link-headings',
      this.i18n.t('tools.link.onThisPage')
    );

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
    const rows = getRecentLinks().map((entry, index) => this.createRecentRow(entry, index));

    this.nodes.recentList?.replaceChildren(...rows);
  }

  /**
   * Draw the rows again after a lookup answered, keeping the highlighted
   * row where the user left it.
   */
  private redrawRecent(): void {
    const list = this.nodes.recentList;

    if (!list || this.nodes.input?.getAttribute(this.DATA_ATTRIBUTES.inputOpened) !== 'true') {
      return;
    }

    this.renderRecent();

    // The rows are already on screen: no second entrance.
    Array.from(list.children).forEach((row) => {
      if (row instanceof HTMLElement) {
        row.style.setProperty('animation', 'none');
      }
    });
    this.setActiveOption(this.activeOptionIndex);
  }

  /**
   * One recent link as a row: the link sign, the page title and the site
   * name under it. A title that only names the site ("YouTube") gives its
   * slot to the path, so two pages of one site stay apart. Without a title
   * the site name takes the title slot and the path goes under it.
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
    const squash = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const brand = site.split('.').slice(0, -1).join('.') || site;
    const namesOnlySite = entry.title !== undefined && squash(entry.title) === squash(brand);
    const title = namesOnlySite && path !== '' ? path : entry.title ?? site;
    const meta = entry.title !== undefined ? site : path;
    const icon = this.createIcon(IconLink, RECENT_ICON_CLASSES);

    icon.setAttribute('data-link-recent-icon', '');

    const row = this.createOptionRow(
      'recent',
      `${this.errorId}-recent-${index}`,
      icon,
      title,
      meta,
      () => this.applyLink(entry.url)
    );

    row.title = entry.url;
    row.style.animationDelay = `${index * 40}ms`;

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
      })
      .reduce<{ targets: HeadingTarget[]; parents: number[] }>((outline, heading) => {
        // A heading sits one step under the nearest smaller level above it.
        const parents = outline.parents.filter((level) => level < heading.level);

        return {
          targets: [...outline.targets, { ...heading, depth: Math.min(parents.length, HEADING_MAX_DEPTH) }],
          parents: [...parents, heading.level],
        };
      }, { targets: [], parents: [] })
      .targets;
  }

  /**
   * The text a heading search looks for: the value without its "#".
   * @param value - the trimmed field value
   */
  private headingQuery(value: string): string {
    return (value.startsWith('#') ? value.slice(1) : value).trim().toLowerCase();
  }

  /**
   * Headings matching the field: all of them when it is empty or a bare "#",
   * otherwise those whose text contains the value (without its "#").
   * @param value - the trimmed field value
   */
  private matchHeadings(value: string): HeadingTarget[] {
    const query = this.headingQuery(value);

    return this.headingTargets
      .filter((heading) => heading.text.toLowerCase().includes(query))
      .slice(0, HEADING_LIMIT);
  }

  /**
   * Set a row's title, with the part the search matched in bold.
   * @param row - a heading's or a page's row
   * @param kind - the row kind its data markers are named after
   * @param text - the title
   * @param query - lowercase search text, empty for none
   */
  private markMatch(row: HTMLElement, kind: 'heading' | 'page', text: string, query: string): void {
    const title = row.querySelector(`[data-link-${kind}-title]`);
    const at = query === '' ? -1 : text.toLowerCase().indexOf(query);

    if (!title) {
      return;
    }

    if (at === -1) {
      title.textContent = text;

      return;
    }

    const match = document.createElement('span');

    match.className = 'font-bold';
    match.setAttribute(`data-link-${kind}-match`, '');
    match.textContent = text.slice(at, at + query.length);
    title.replaceChildren(text.slice(0, at), match, text.slice(at + query.length));
  }

  /**
   * @param matches - headings to list
   * @param query - lowercase search text, empty for none
   */
  private renderHeadings(matches: HeadingTarget[], query: string): void {
    const list = this.nodes.headingList;

    if (!list) {
      return;
    }

    // Only rows new to the list cascade in, staggered among themselves.
    const fresh = matches.filter((heading) => !this.headingRows.has(heading.blockId));
    const rows = matches.map((heading) => {
      const cached = this.headingRows.get(heading.blockId);

      if (cached) {
        this.markMatch(cached, 'heading', heading.text, query);

        return cached;
      }

      const row = this.createOptionRow(
        'heading',
        '',
        null,
        heading.text,
        '',
        () => this.applyLink(`#${heading.blockId}`)
      );
      const tag = document.createElement('span');

      // Drawn by link-picker.css from the attribute, so the row's text stays the heading alone.
      tag.setAttribute('aria-hidden', 'true');
      tag.setAttribute('data-link-heading-tag', `H${heading.level}`);
      row.lastElementChild?.before(tag);
      row.style.animationDelay = `${fresh.indexOf(heading) * 30}ms`;
      row.style.setProperty('--_blok-link-heading-depth', String(heading.depth));
      row.setAttribute('data-link-heading-level', String(heading.level));
      row.setAttribute('data-link-heading-depth', String(heading.depth));
      this.markMatch(row, 'heading', heading.text, query);
      this.headingRows.set(heading.blockId, row);

      return row;
    });

    // Patch the list instead of rebuilding it: a row that leaves and re-enters
    // the DOM replays its entrance animation, which flickers on every keystroke.
    Array.from(list.children).forEach((child) => {
      if (!rows.includes(child as HTMLElement)) {
        child.remove();
      }
    });
    rows.forEach((row, index) => {
      if (list.children[index] !== row) {
        list.insertBefore(row, list.children[index] ?? null);
      }
      row.setAttribute('id', `${this.errorId}-heading-${index}`);
    });
  }

  /**
   * Show the sections that fit the field's value. Empty field: recent links,
   * pages and headings, or the link kinds when there are none. Typed value:
   * the pages and headings it matches.
   * @param keep - the row that stays highlighted, when it is still listed
   */
  private updateOptions(keep?: HTMLElement): void {
    const { recent, pages, headings, kinds, options, suggestion, input } = this.nodes;

    if (!recent || !pages || !headings || !kinds || !options || !input) {
      return;
    }

    const value = input.value.trim();
    const matches = this.editing ? [] : this.matchHeadings(value);
    const recentCount = this.nodes.recentList?.childElementCount ?? 0;
    const incomplete = value !== '' && !this.isLinkComplete(value);

    this.renderHeadings(matches, this.headingQuery(value));
    this.renderPages();
    recent.hidden = this.editing || value !== '' || recentCount === 0;
    pages.hidden = this.pageHits.length === 0;
    headings.hidden = matches.length === 0;
    kinds.hidden = this.editing || value !== '' || !recent.hidden || !pages.hidden || !headings.hidden;
    options.hidden = recent.hidden && pages.hidden && headings.hidden && kinds.hidden;
    input.setAttribute('aria-expanded', String(!options.hidden));

    // A typed search picks its first row (row 0: Recent hides once there is
    // a value), so Enter goes there. The suggestion row would then promise a
    // different Enter, so it hides. A typed web link keeps Enter for itself.
    const searching = (matches.length > 0 || !pages.hidden) && (value.startsWith('#') || incomplete);
    const kept = keep ? this.getOptionRows().indexOf(keep) : -1;

    if (searching) {
      suggestion?.classList.add('hidden');
    }

    const first = searching ? 0 : -1;

    this.setActiveOption(kept !== -1 ? kept : first);
    this.fitOptions();
    this.markScrollEdges();
  }

  /**
   * End the list on a whole row with a sliver of the next one, so the bottom
   * fade never cuts a row in half. Only while the list is at its top: a
   * scrolled list must not jump.
   */
  private fitOptions(): void {
    const options = this.nodes.options;

    if (!options || options.scrollTop !== 0) {
      return;
    }

    options.style.maxHeight = '';

    const room = options.clientHeight;

    if (options.scrollHeight <= room + 1) {
      return;
    }

    const whole = this.getOptionRows()
      .map((row) => row.offsetTop + row.offsetHeight)
      .filter((bottom) => bottom <= room - LIST_TAIL);
    const last = whole[whole.length - 1];

    if (last !== undefined) {
      options.style.maxHeight = `${last + LIST_TAIL}px`;
    }
  }

  /**
   * Tell the stylesheet which edges have more rows behind them, so it fades
   * only those.
   */
  private markScrollEdges(): void {
    const options = this.nodes.options;

    if (!options) {
      return;
    }

    options.toggleAttribute('data-link-more-up', options.scrollTop > 1);
    options.toggleAttribute('data-link-more-down', options.scrollTop + options.clientHeight < options.scrollHeight - 1);
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
    const sections = [this.nodes.recent, this.nodes.pages, this.nodes.headings, this.nodes.kinds];

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

      this.keepClearOfFades(active);
    } else {
      this.nodes.input?.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * Scroll the list just enough to show a row in full, clear of the faded
   * top and bottom edges.
   * @param row - the highlighted row
   */
  private keepClearOfFades(row: HTMLElement): void {
    const options = this.nodes.options;

    if (!options) {
      return;
    }

    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;

    if (top < options.scrollTop + FADE_TOP_CLEARANCE) {
      options.scrollTop = top - FADE_TOP_CLEARANCE;
    } else if (bottom > options.scrollTop + options.clientHeight - FADE_BOTTOM_CLEARANCE) {
      options.scrollTop = bottom - options.clientHeight + FADE_BOTTOM_CLEARANCE;
    }

    this.markScrollEdges();
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

    if (getRecentLinks()[0]?.checked !== true) {
      this.lookUp(url);
    }
  }

  /**
   * Ask the unfurl endpoint for a link's title, once.
   * @param url - a recorded href
   */
  private lookUp(url: string): void {
    const unfurl = this.linkConfig.unfurl;

    if (unfurl === undefined || this.lookups.has(url)) {
      return;
    }

    this.lookups.add(url);
    new MetadataFetcher(unfurl)
      .fetch(url)
      .then((meta) => {
        updateRecentLinkMeta(url, { title: meta.title });
        this.redrawRecent();
      })
      .catch(() => undefined)
      .finally(() => {
        this.lookups.delete(url);
      });
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

    // tel:, sms:, ftp: and the like lead to no web page.
    const isWeb = !/^\w+:/.test(url) || /^https?:/i.test(url) || this.isHostWithPort(url);

    return { icon: IconGlobe, label: this.i18n.t(isWeb ? 'tools.link.webPage' : 'tools.link.webLink') };
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
    // The linked text stays selected, as in Notion (U070).
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

    // A link that was never looked up, or one whose lookup failed, gets its lookup now.
    if (!this.editing) {
      getRecentLinks().filter((entry) => entry.checked !== true).forEach((entry) => this.lookUp(entry.url));
    }

    this.headingTargets = this.editing ? [] : this.readHeadings();
    this.headingRows.clear();
    this.nodes.headingList?.replaceChildren();
    this.pageHits = [];
    this.pageRows.clear();
    this.nodes.pageList?.replaceChildren();
    this.searchPages();
    this.updateOptions();

    this.nodes.input.className = this.INPUT_OPEN_CLASSES;
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

    // The popover has no size until it is laid out, a frame after it opens.
    requestAnimationFrame(() => {
      this.fitOptions();
      this.markScrollEdges();
    });
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
        ? this.INPUT_OPEN_CLASSES
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
    this.headingRows.clear();
    this.nodes.headingList?.replaceChildren();
    this.cancelPageSearch();
    this.pageHits = [];
    this.pageRows.clear();
    this.nodes.pageList?.replaceChildren();
    [this.nodes.options, this.nodes.recent, this.nodes.pages, this.nodes.headings, this.nodes.kinds].forEach((node) => node?.toggleAttribute('hidden', true));
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
    // The linked text stays selected, as in Notion (U070).
    this.inlineToolbar.close();
  }

  /**
   * Detects if passed string is URL
   * @param {string} str - string to validate
   * @returns {boolean}
   */
  private validateURL(str: string): boolean {
    // Checked as it will be saved: trimmed, and with the protocol a bare site gets.
    const link = this.prepareLink(str);

    /**
     * Don't allow spaces
     */
    if (/\s/.test(link)) {
      return false;
    }

    /**
     * Reject URL schemes that execute script when the anchor is clicked.
     * The anchor is inserted into the live document before any save-time
     * sanitization runs, so an unfiltered `javascript:`/`data:` href is
     * clickable XSS. An allowlist of safe schemes is used because denylists
     * keep losing to scheme smuggling (e.g. `data:image/svg+xml`).
     */
    if (hasUnsafeScheme(link)) {
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
   * True for "localhost:3000" or "example.com:8080/docs": a site and its port,
   * not a kind of link. "tel:911" is a kind of link.
   * @param link - a trimmed value
   */
  private isHostWithPort(link: string): boolean {
    return /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(link) && !/^(?:https?|mailto|tel|sms):/i.test(link);
  }

  /**
   * Add 'http' protocol to the links like 'vc.ru', 'google.com'
   * @param {string} link - string to process
   */
  private addProtocol(link: string): string {
    if (this.isHostWithPort(link)) {
      return 'http://' + link;
    }

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
      if (anchorTag.hasAttribute(PAGE_REFERENCE_ATTR)) {
        // The page sanitizer drops edited URLs while this ID remains.
        anchorTag.removeAttribute(PAGE_REFERENCE_ATTR);
        anchorTag.removeAttribute(DATA_ATTR.mutationFree);
        anchorTag.removeAttribute(DATA_ATTR.linkOwner);
        anchorTag.removeAttribute('contenteditable');
        anchorTag.removeAttribute('tabindex');
        anchorTag.removeAttribute('draggable');
        anchorTag.removeAttribute('role');
        anchorTag.removeAttribute('aria-disabled');
      }

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
