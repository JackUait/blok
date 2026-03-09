/**
 * Header Tool for the Blok Editor
 * Provides Headings Blocks (H1-H6)
 *
 * Based on @editorjs/header by CodeX
 * @license MIT
 */
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteEvent,
  ToolboxConfig,
  ToolboxConfigEntry,
  ConversionConfig,
  SanitizerConfig,
  PasteConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { DATA_ATTR } from '../../components/constants';
import { IconH1, IconH2, IconH3, IconH4, IconH5, IconH6, IconHeading, IconToggleH1, IconToggleH2, IconToggleH3 } from '../../components/icons';
import { PLACEHOLDER_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
import { translateToolTitle } from '../../components/utils/tools';
import { twMerge } from '../../components/utils/tw';
import { ARROW_ICON, BODY_PLACEHOLDER_STYLES, TOGGLE_ATTR, TOGGLE_CHILDREN_STYLES } from '../toggle/constants';
import { buildArrow } from '../toggle/dom-builder';
import { updateArrowState, updateBodyPlaceholderVisibility, updateChildrenVisibility } from '../toggle/toggle-lifecycle';

/**
 * Tool's input and output data format
 */
export interface HeaderData extends BlockToolData {
  /** Header's content */
  text: string;
  /** Header's level from 1 to 6 */
  level: number;
  /** Whether this header has toggle (collapse/expand) behavior */
  isToggleable?: boolean;
  /** Whether the toggle heading is open (expanded). Persisted on save so state is restored on reload. */
  isOpen?: boolean;
}

/**
 * Level-specific overrides for customization
 */
export interface HeaderLevelConfig {
  /** Custom HTML tag to use (e.g., 'div', 'p', 'span') */
  tag?: string;
  /** Custom display name for this level */
  name?: string;
  /** Custom font size (e.g., '3em', '24px') */
  size?: string;
  /** Custom margin top (e.g., '20px', '1rem') */
  marginTop?: string;
  /** Custom margin bottom (e.g., '10px', '0.5rem') */
  marginBottom?: string;
}

/**
 * Tool's config from Editor
 */
export interface HeaderConfig {
  /** Block's placeholder */
  placeholder?: string;
  /** Heading levels */
  levels?: number[];
  /** Default level */
  defaultLevel?: number;
  /** Level-specific overrides keyed by level number (1-6) */
  levelOverrides?: Record<number, HeaderLevelConfig>;
  /** Custom shortcuts per level. If undefined, uses default markdown (#, ##, etc). If empty {}, disables all shortcuts. */
  shortcuts?: Record<number, string>;
  /**
   * @internal Injected by BlockToolAdapter - merged toolbox entries.
   * When present, renderSettings() will use these entries instead of the default levels.
   */
  _toolboxEntries?: ToolboxConfigEntry[];
}

/**
 * Heading level information
 */
interface Level {
  /** Level number */
  number: number;
  /** HTML tag corresponding with level number */
  tag: string;
  /** Translation key for this level (e.g., 'tools.header.heading1') */
  nameKey: string;
  /** Display name for this level (user override or fallback) */
  name: string;
  /** Icon */
  icon: string;
  /** Tailwind classes for styling */
  styles: string;
  /** Inline styles for custom overrides */
  inlineStyles: Partial<CSSStyleDeclaration>;
}

/**
 * Header block for the Blok Editor.
 *
 * @author CodeX (team@ifmo.su)
 * @copyright CodeX 2018
 * @license MIT
 * @version 2.0.0
 */
export class Header implements BlockTool {
  /**
   * Editor API
   */
  private api: API;

  /**
   * Read-only mode flag
   */
  private readOnly: boolean;

  /**
   * Tool's settings passed from Editor
   */
  private _settings: HeaderConfig;

  /**
   * Block's data
   */
  private _data: HeaderData;

  /**
   * Main Block wrapper
   */
  private _element: HTMLHeadingElement;

  /**
   * Arrow element for toggle heading
   */
  private _arrowElement: HTMLElement | null = null;

  /**
   * Wrapper div containing the arrow + heading element for toggle headings.
   * The arrow lives here (not inside the heading) to avoid Blink's behavior
   * of clearing the selection when a SPAN child is present in a contenteditable.
   */
  private _wrapper: HTMLElement | null = null;

  /**
   * The inner row div that wraps only the arrow and heading element.
   * This is the `position: relative` context for the arrow so that `top: 50%`
   * resolves against the heading height only — not the full wrapper height
   * that includes the [data-blok-toggle-children] container.
   */
  private _headerRow: HTMLElement | null = null;

  /**
   * Container element for child blocks when the heading is toggleable.
   * Mirrors the [data-blok-toggle-children] container used by the toggle list
   * tool so that BlockHierarchy can place child blocks inside it.
   */
  private _childContainerElement: HTMLElement | null = null;

  /**
   * Body placeholder element shown when toggle is open and has no children.
   */
  private _bodyPlaceholderElement: HTMLElement | null = null;

  /**
   * Whether the toggle is currently open (expanded)
   */
  private _isOpen: boolean;

  /**
   * Block ID from the editor
   */
  private blockId?: string;

  /**
   * Render plugin's main Element and fill it with saved data
   *
   * @param options - constructor options
   * @param options.data - previously saved data
   * @param options.config - user config for Tool
   * @param options.api - Editor API
   * @param options.readOnly - read only mode flag
   * @param options.block - block instance
   */
  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<HeaderData, HeaderConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);
    this._isOpen = this._data.isOpen ?? !readOnly;
    this._element = this.getTag();

    if (block) {
      this.blockId = block.id;
    }

    if (!readOnly && this._data.isToggleable) {
      this.api.events.on('block changed', this.handleBlockChanged);
    }
  }

  /**
   * Base styles for all header levels
   */
  private static readonly BASE_STYLES = 'py-[3px] px-[2px] m-0 leading-[1.3]! outline-hidden [&_p]:p-0! [&_p]:m-0! [&_div]:p-0! [&_div]:m-0!';

  /**
   * Styles
   * @deprecated Use data-blok-tool attribute instead (DATA_ATTR.tool)
   */
  private get _CSS(): { block: string; wrapper: string } {
    return {
      block: this.api.styles.block,
      wrapper: '',
    };
  }

  /**
   * Check if data is valid HeaderData
   *
   * @param data - data to check
   * @returns true if data is HeaderData
   */
  private isHeaderData(data: unknown): data is HeaderData {
    return typeof data === 'object' && data !== null && 'text' in data;
  }

  /**
   * Normalize input data
   *
   * @param data - saved data to process
   * @returns normalized HeaderData
   */
  private normalizeData(data: HeaderData | Record<string, never>): HeaderData {
    if (!this.isHeaderData(data)) {
      return { text: '', level: this.defaultLevel.number };
    }

    const parsedLevel = parseInt(String(data.level));
    const isValidLevel = data.level !== undefined && !isNaN(parsedLevel);

    const normalized: HeaderData = {
      text: data.text || '',
      level: isValidLevel ? parsedLevel : this.defaultLevel.number,
    };

    if (data.isToggleable === true) {
      normalized.isToggleable = true;
    }

    if (typeof data.isOpen === 'boolean') {
      normalized.isOpen = data.isOpen;
    }

    /**
     * Sanitize text to remove any previously saved arrow HTML (backwards compatibility)
     */
    if (normalized.text) {
      const temp = document.createElement('div');

      temp.innerHTML = normalized.text;

      const arrowEl = temp.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`);

      if (arrowEl) {
        arrowEl.remove();
        normalized.text = temp.innerHTML;
      }
    }

    return normalized;
  }

  /**
   * Return Tool's view.
   * For toggle headings, returns a wrapper div that contains the arrow and the heading.
   * The arrow is a sibling of the heading (not inside it), which is required to avoid
   * Blink's behavior of clearing the selection when a SPAN is present in a contenteditable.
   *
   * @returns HTMLElement (wrapper div for toggle headings, heading element otherwise)
   */
  public render(): HTMLElement {
    if (this._data.isToggleable) {
      this._wrapper = this.buildWrapper();
      return this._wrapper;
    }
    return this._element;
  }

  /**
   * Called after the block is rendered in the DOM.
   * Hides children if the toggle heading is collapsed.
   */
  public rendered(): void {
    if (this._data.isToggleable) {
      this.updateChildrenVisibility();
      this.updateBodyPlaceholderVisibility();
    }
  }

  /**
   * Called when the block is removed. Cleans up event listeners.
   */
  public removed(): void {
    this.api.events.off('block changed', this.handleBlockChanged);
  }

  /**
   * Expand the toggle heading (no-op if not toggleable or already expanded).
   * Can be called externally via block.call('expand').
   */
  public expand(): void {
    if (!this._data.isToggleable || this._isOpen) {
      return;
    }

    this._isOpen = true;

    if (this._arrowElement && this._element) {
      updateArrowState(this._arrowElement, this._element, this._isOpen, {
        collapse: this.api.i18n.t('tools.toggle.ariaLabelCollapse'),
        expand: this.api.i18n.t('tools.toggle.ariaLabelExpand'),
      });
    }

    this.updateChildrenVisibility();
    this.updateBodyPlaceholderVisibility();
  }

  /**
   * Collapse the toggle heading (no-op if not toggleable or already collapsed).
   * Can be called externally via block.call('collapse').
   */
  public collapse(): void {
    if (!this._data.isToggleable || !this._isOpen) {
      return;
    }

    this._isOpen = false;

    if (this._arrowElement && this._element) {
      updateArrowState(this._arrowElement, this._element, this._isOpen, {
        collapse: this.api.i18n.t('tools.toggle.ariaLabelCollapse'),
        expand: this.api.i18n.t('tools.toggle.ariaLabelExpand'),
      });
    }

    this.updateChildrenVisibility();
    this.updateBodyPlaceholderVisibility();
  }

  /**
   * Returns header block tunes config
   *
   * @returns MenuConfig array
   */
  public renderSettings(): MenuConfig {
    const toolboxEntries = this._settings._toolboxEntries;

    /**
     * If user provided custom toolbox entries, use them to build settings menu.
     * This ensures block settings match the toolbox configuration.
     * Entries without explicit level data will default to the configured defaultLevel.
     *
     * Only fall back to levels config when _toolboxEntries is not provided or empty,
     * or when using the default single "Heading" toolbox entry (detected by having
     * exactly one entry with no level data and no custom title or the default "Heading" title).
     */
    const isDefaultToolboxEntry = toolboxEntries?.length === 1 &&
      toolboxEntries[0].data === undefined &&
      (toolboxEntries[0].title === undefined || toolboxEntries[0].title === 'Heading');

    const levelSettings: MenuConfig = toolboxEntries !== undefined && toolboxEntries.length > 0 && !isDefaultToolboxEntry
      ? this.buildSettingsFromToolboxEntries(toolboxEntries)
      : this.levels.map(level => {
        const translated = this.api.i18n.t(level.nameKey);
        const title = translated !== level.nameKey ? translated : level.name;

        return {
          icon: level.icon,
          title,
          onActivate: (): void => this.setLevel(level.number),
          closeOnActivate: true,
          isActive: this.currentLevel.number === level.number,
          dataset: {
            'blok-header-level': String(level.number),
          },
        };
      });

    const settingsArray = Array.isArray(levelSettings) ? levelSettings : [levelSettings];

    /**
     * Add toggle heading option
     */
    const toggleHeadingTitle = this.api.i18n.t('tools.header.toggleHeading');

    settingsArray.push({
      icon: ARROW_ICON,
      title: toggleHeadingTitle !== 'tools.header.toggleHeading' ? toggleHeadingTitle : 'Toggle heading',
      onActivate: (): void => this.toggleIsToggleable(),
      closeOnActivate: true,
      isActive: this._data.isToggleable === true,
    });

    return settingsArray;
  }

  /**
   * Build settings menu items from toolbox entries.
   * This allows users to customize which levels appear in block settings
   * by configuring the toolbox.
   *
   * @param entries - Merged toolbox entries from user config
   * @returns MenuConfig array
   */
  private buildSettingsFromToolboxEntries(entries: ToolboxConfigEntry[]): MenuConfig {
    return entries.map(entry => {
      const entryData = entry.data as { level?: number } | undefined;
      const level = entryData?.level ?? this.defaultLevel.number;
      const defaultLevel = Header.DEFAULT_LEVELS.find(l => l.number === level);
      const fallbackTitle = defaultLevel?.name ?? `Heading ${level}`;

      const title = this.resolveToolboxEntryTitle(entry, fallbackTitle);
      const icon = entry.icon ?? defaultLevel?.icon ?? IconHeading;

      return {
        icon,
        title,
        onActivate: (): void => this.setLevel(level),
        closeOnActivate: true,
        isActive: this.currentLevel.number === level,
        dataset: {
          'blok-header-level': String(level),
        },
      };
    });
  }

  /**
   * Resolves the title for a toolbox entry using the shared translation utility.
   *
   * @param entry - Toolbox entry
   * @param fallback - Fallback title if no custom title or translation found
   * @returns Resolved title string
   */
  private resolveToolboxEntryTitle(entry: ToolboxConfigEntry, fallback: string): string {
    return translateToolTitle(this.api.i18n, entry, fallback);
  }

  /**
   * Callback for Block's settings buttons
   *
   * @param level - level to set
   */
  private setLevel(level: number): void {
    this.data = {
      level: level,
      text: this.data.text,
      isToggleable: this._data.isToggleable,
    };
  }

  /**
   * Method that specified how to merge two Text blocks.
   * Called by Editor by backspace at the beginning of the Block
   *
   * @param data - saved data to merge with current block
   */
  public merge(data: HeaderData): void {
    /**
     * Strip any arrow HTML from incoming data to prevent injection of toggle markup
     * (backwards compatibility: old saved data may have had the arrow inside the text).
     */
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = data.text;
    const arrowInData = tempDiv.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`);

    if (arrowInData) {
      arrowInData.remove();
    }

    this._element.insertAdjacentHTML('beforeend', tempDiv.innerHTML);
  }

  /**
   * Validate Text block data:
   * - check that text is a string
   *
   * @param blockData - data received after saving
   * @returns false if saved data is not correct, otherwise true
   */
  public validate(blockData: HeaderData): boolean {
    return typeof blockData.text === 'string';
  }

  /**
   * Extract Tool's data from the view.
   * Reads directly from this._element (the heading) which never contains the arrow —
   * the arrow lives in the wrapper div (sibling), so no cloning/stripping is needed.
   *
   * @returns saved data
   */
  public save(_toolsContent: HTMLElement): HeaderData {
    const data: HeaderData = {
      text: this._element.innerHTML,
      level: this.currentLevel.number,
    };

    if (this._data.isToggleable === true) {
      data.isToggleable = true;
      data.isOpen = this._isOpen;
    }

    return data;
  }

  /**
   * Allow Header to be converted to/from other blocks
   */
  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'text', // use 'text' property for other blocks
      import: 'text', // fill 'text' property from other block's export string
    };
  }

  /**
   * Sanitizer Rules
   */
  public static get sanitize(): SanitizerConfig {
    return {
      level: false,
      text: {},
      isToggleable: false,
      isOpen: false,
    };
  }

  /**
   * Returns true to notify core that read-only is supported
   *
   * @returns true
   */
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Get current Tool's data.
   * The heading element never contains the arrow (it lives in the wrapper sibling),
   * so innerHTML can be read directly without any stripping.
   *
   * @returns Current data
   */
  public get data(): HeaderData {
    this._data.text = this._element.innerHTML;
    this._data.level = this.currentLevel.number;

    return this._data;
  }

  /**
   * Store data in plugin:
   * - at the this._data property
   * - at the HTML
   *
   * @param data - data to set
   */
  public set data(data: HeaderData) {
    this._data = this.normalizeData(data);

    /**
     * If level is set and block in DOM
     * then replace it to a new block
     */
    if (data.level !== undefined && this._element.parentNode) {
      /**
       * Create a new tag
       */
      const newHeader = this.getTag();

      /**
       * Save Block's content
       */
      newHeader.innerHTML = this._element.innerHTML;

      /**
       * Replace blocks
       */
      this._element.parentNode.replaceChild(newHeader, this._element);

      /**
       * Save new block to private variable
       */
      this._element = newHeader;
    }

    /**
     * If data.text was passed then update block's content
     */
    if (data.text !== undefined) {
      this._element.innerHTML = this._data.text || '';
    }

    /**
     * Update toggle state: manage the wrapper div that holds the arrow as a sibling
     * of the heading element (keeping arrow outside the contenteditable h2).
     */
    if (this._data.isToggleable) {
      this._element.setAttribute(TOGGLE_ATTR.toggleOpen, String(this._isOpen));
      this._element.className = twMerge(Header.BASE_STYLES, this.currentLevel.styles, PLACEHOLDER_CLASSES, 'pl-8');

      if (!this._wrapper) {
        /**
         * Toggle was just enabled: wrap the heading in a new wrapper div and
         * prepend the arrow to the wrapper (not to the heading).
         */
        this.createToggleWrapper();
      } else if (!this._wrapper.querySelector(`[${TOGGLE_ATTR.toggleArrow}]`)) {
        /**
         * Wrapper exists but arrow was removed (e.g. after innerHTML reset) — re-add it.
         */
        const arrow = this.buildArrow();
        this._arrowElement = arrow;
        (this._headerRow ?? this._wrapper).prepend(arrow);
      }
    } else {
      this._element.removeAttribute(TOGGLE_ATTR.toggleOpen);
      this._element.className = twMerge(Header.BASE_STYLES, this.currentLevel.styles, PLACEHOLDER_CLASSES);
      this._arrowElement = null;

      if (this._wrapper) {
        /**
         * Toggle was just disabled: remove the wrapper and put the heading directly
         * in the wrapper's parent.
         */
        const parent = this._wrapper.parentNode;
        if (parent) {
          parent.replaceChild(this._element, this._wrapper);
        }
        this._wrapper = null;
        this._headerRow = null;
      }
    }
  }

  /**
   * Resolve the placeholder text for the heading element.
   * Returns the settings placeholder (translated) if set, otherwise falls back
   * to the translated level name when a translation exists, or the bare level name.
   *
   * @param translatedName - The already-translated level name key value
   * @returns The resolved placeholder string
   */
  private resolvePlaceholderText(translatedName: string): string {
    if (this._settings.placeholder) {
      return this.api.i18n.t(this._settings.placeholder);
    }

    if (translatedName !== this.currentLevel.nameKey) {
      return translatedName;
    }

    return this.currentLevel.name;
  }

  /**
   * Get tag for target level
   * By default returns second-leveled header
   *
   * @returns HTMLHeadingElement
   */
  private getTag(): HTMLHeadingElement {
    /**
     * Create element for current Block's level
     */
    const tag = document.createElement(this.currentLevel.tag) as HTMLHeadingElement;

    /**
     * Add text to block
     */
    tag.innerHTML = this._data.text || '';

    /**
     * Add styles class using twMerge to combine base and level-specific styles.
     * When isToggleable, add left padding to leave room for the arrow (which lives
     * in the wrapper div as a sibling, not inside this element).
     */
    tag.className = twMerge(Header.BASE_STYLES, this.currentLevel.styles, PLACEHOLDER_CLASSES, this._data.isToggleable ? 'pl-8' : '');

    /**
     * Apply inline styles for custom overrides (dynamic values from config)
     */
    const { inlineStyles } = this.currentLevel;

    if (inlineStyles) {
      Object.assign(tag.style, inlineStyles);
    }

    /**
     * Set data attribute for tool identification
     */
    tag.setAttribute(DATA_ATTR.tool, 'header');

    /**
     * Make tag editable
     */
    tag.contentEditable = this.readOnly ? 'false' : 'true';

    /**
     * Set toggle attribute on the heading element itself (not on the wrapper).
     * The wrapper is managed separately in render() / set data().
     */
    if (this._data.isToggleable) {
      tag.setAttribute(TOGGLE_ATTR.toggleOpen, String(this._isOpen));
    }

    const translatedName = this.api.i18n.t(this.currentLevel.nameKey);
    const placeholderText = this.resolvePlaceholderText(translatedName);

    if (!this.readOnly) {
      setupPlaceholder(tag, placeholderText);
    } else {
      tag.setAttribute('data-placeholder', placeholderText);
    }

    return tag;
  }

  /**
   * Build the arrow element for toggle heading.
   *
   * The arrow is absolutely positioned within the wrapper div, sitting in the area
   * to the left of the heading text (which has pl-7 padding). This keeps the arrow
   * completely outside the heading's contenteditable scope, allowing Chrome to
   * place a cursor and insert text without interference.
   *
   * @returns The arrow element
   */
  private buildArrow(): HTMLElement {
    const arrow = buildArrow(this._isOpen, this.readOnly ? null : () => this.toggleOpen(), {}, {
      collapse: this.api.i18n.t('tools.toggle.ariaLabelCollapse'),
      expand: this.api.i18n.t('tools.toggle.ariaLabelExpand'),
    });
    arrow.classList.add('absolute', 'left-0', 'top-1/2', '-translate-y-1/2');
    return arrow;
  }

  /**
   * Build the wrapper div that contains the arrow and heading as siblings.
   * The wrapper has relative positioning so the absolutely-positioned arrow
   * is anchored to it. The heading occupies the full width with pl-7 padding.
   *
   * @returns The wrapper element (with arrow and heading already appended)
   */
  private buildWrapper(): HTMLElement {
    const wrapper = document.createElement('div');

    // Inner row: positioning context for the arrow (only heading height, not children).
    const headerRow = document.createElement('div');
    headerRow.className = 'relative';
    this._headerRow = headerRow;

    const arrow = this.buildArrow();
    this._arrowElement = arrow;
    headerRow.appendChild(arrow);
    headerRow.appendChild(this._element);
    wrapper.appendChild(headerRow);

    const bodyPlaceholder = document.createElement('div');
    bodyPlaceholder.className = BODY_PLACEHOLDER_STYLES;
    bodyPlaceholder.setAttribute(TOGGLE_ATTR.toggleBodyPlaceholder, '');
    bodyPlaceholder.textContent = this.api.i18n.t('tools.toggle.bodyPlaceholder');
    bodyPlaceholder.addEventListener('click', () => this.handleBodyPlaceholderClick());
    this._bodyPlaceholderElement = bodyPlaceholder;
    wrapper.appendChild(bodyPlaceholder);

    const childContainer = document.createElement('div');
    childContainer.className = TOGGLE_CHILDREN_STYLES;
    childContainer.setAttribute(TOGGLE_ATTR.toggleChildren, '');
    this._childContainerElement = childContainer;
    wrapper.appendChild(childContainer);

    return wrapper;
  }

  /**
   * Wrap the heading element in a new wrapper div containing the toggle arrow,
   * replacing the heading's current position in the DOM.
   * Extracted to keep set data()'s nesting within the max-depth limit.
   */
  private createToggleWrapper(): void {
    const parent = this._element.parentNode;

    this._wrapper = document.createElement('div');

    // Inner row: positioning context for the arrow (only heading height, not children).
    const headerRow = document.createElement('div');
    headerRow.className = 'relative';
    this._headerRow = headerRow;

    const arrow = this.buildArrow();
    this._arrowElement = arrow;
    headerRow.appendChild(arrow);

    // Replace the heading in the DOM with the new outer wrapper first (while
    // this._element is still attached), then move the heading into the inner row.
    if (parent) {
      parent.replaceChild(this._wrapper, this._element);
    }
    headerRow.appendChild(this._element);
    this._wrapper.appendChild(headerRow);
  }

  /**
   * Toggle the isToggleable state on/off.
   * Called from the settings menu.
   */
  private toggleIsToggleable(): void {
    const wasToggleable = this._data.isToggleable === true;

    /**
     * If disabling toggle, ensure children are visible before removing toggle state
     */
    if (wasToggleable) {
      updateChildrenVisibility(this.api, this.blockId ?? '', true);
      this._isOpen = false;
      this.api.events.off('block changed', this.handleBlockChanged);
    } else if (!this.readOnly) {
      this.api.events.on('block changed', this.handleBlockChanged);
    }

    this.data = {
      level: this._data.level,
      text: this._data.text,
      isToggleable: !wasToggleable || undefined,
    };
  }

  /**
   * Toggle the open/closed state of the toggle heading.
   */
  private toggleOpen(): void {
    this._isOpen = !this._isOpen;

    if (this._arrowElement && this._element) {
      updateArrowState(this._arrowElement, this._element, this._isOpen, {
        collapse: this.api.i18n.t('tools.toggle.ariaLabelCollapse'),
        expand: this.api.i18n.t('tools.toggle.ariaLabelExpand'),
      });
    }

    this.updateChildrenVisibility();
    this.updateBodyPlaceholderVisibility();
  }

  /**
   * Show or hide child blocks based on the toggle's open state.
   */
  private updateChildrenVisibility(): void {
    if (this.blockId === undefined) {
      return;
    }

    updateChildrenVisibility(this.api, this.blockId, this._isOpen, this._childContainerElement, this._arrowElement);
  }

  /**
   * Show or hide the body placeholder based on open state and children count.
   */
  private updateBodyPlaceholderVisibility(): void {
    if (this.blockId === undefined) {
      return;
    }

    updateBodyPlaceholderVisibility(
      this._bodyPlaceholderElement,
      this.api,
      this.blockId,
      this._isOpen,
      this.readOnly
    );
  }

  /**
   * Handle a click on the body placeholder: insert a new child paragraph and focus it.
   * Mirrors the toggle list's handleBodyPlaceholderClick.
   */
  private handleBodyPlaceholderClick(): void {
    if (this.blockId === undefined) {
      return;
    }

    const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (blockIndex === undefined) {
      return;
    }

    const newBlock = this.api.blocks.insert('paragraph', { text: '' }, {}, blockIndex + 1, true);

    this.api.blocks.setBlockParent(newBlock.id, this.blockId);
    this.api.caret.setToBlock(newBlock.id, 'start');

    this._bodyPlaceholderElement?.classList.add('hidden');
  }

  /**
   * Handle 'block changed' events to refresh body placeholder visibility.
   */
  private handleBlockChanged = (data: unknown): void => {
    if (!this.isBlockChangedPayload(data)) {
      return;
    }

    if (data.event.type === 'block-removed') {
      this.updateBodyPlaceholderVisibility();
    }
  };

  /**
   * Type guard for block changed payload.
   */
  private isBlockChangedPayload(data: unknown): data is { event: { type: string } } {
    return (
      typeof data === 'object' &&
      data !== null &&
      'event' in data &&
      typeof (data as { event: unknown }).event === 'object' &&
      (data as { event: unknown }).event !== null &&
      'type' in (data as { event: { type: unknown } }).event &&
      typeof (data as { event: { type: unknown } }).event.type === 'string'
    );
  }

  /**
   * Get current level
   *
   * @returns Level object
   */
  private get currentLevel(): Level {
    const level = this.levels.find(levelItem => levelItem.number === this._data.level);

    return level ?? this.defaultLevel;
  }

  /**
   * Return default level
   *
   * @returns Level object
   */
  private get defaultLevel(): Level {
    /**
     * User can specify own default level value
     */
    if (!this._settings.defaultLevel) {
      /**
       * With no additional options, there will be H2 by default
       */
      return this.levels[1];
    }

    const userSpecified = this.levels.find(levelItem => {
      return levelItem.number === this._settings.defaultLevel;
    });

    if (userSpecified) {
      return userSpecified;
    }

    console.warn('(ง\'̀-\'́)ง Heading Tool: the default level specified was not found in available levels');

    return this.levels[1];
  }

  /**
   * Default level configurations using Tailwind CSS classes
   */
  private static readonly DEFAULT_LEVELS: Array<{
    number: number;
    tag: string;
    nameKey: string;
    name: string;
    icon: string;
    styles: string;
  }> = [
    { number: 1, tag: 'H1', nameKey: 'tools.header.heading1', name: 'Heading 1', icon: IconH1, styles: 'text-4xl font-bold mt-8 mb-1' },
    { number: 2, tag: 'H2', nameKey: 'tools.header.heading2', name: 'Heading 2', icon: IconH2, styles: 'text-3xl font-semibold mt-6 mb-px' },
    { number: 3, tag: 'H3', nameKey: 'tools.header.heading3', name: 'Heading 3', icon: IconH3, styles: 'text-2xl font-semibold mt-4 mb-px' },
    { number: 4, tag: 'H4', nameKey: 'tools.header.heading4', name: 'Heading 4', icon: IconH4, styles: 'text-xl font-semibold mt-3 mb-px' },
    { number: 5, tag: 'H5', nameKey: 'tools.header.heading5', name: 'Heading 5', icon: IconH5, styles: 'text-base font-semibold mt-3 mb-px' },
    { number: 6, tag: 'H6', nameKey: 'tools.header.heading6', name: 'Heading 6', icon: IconH6, styles: 'text-sm font-semibold mt-3 mb-px' },
  ];

  /**
   * Available header levels
   *
   * @returns Level array
   */
  private get levels(): Level[] {
    const overrides = this._settings.levelOverrides || {};

    const availableLevels: Level[] = Header.DEFAULT_LEVELS.map(defaultLevel => {
      const override = overrides[defaultLevel.number] || {};

      // Build inline styles for custom overrides (dynamic values don't work with Tailwind)
      const inlineStyles: Partial<CSSStyleDeclaration> = {};

      if (override.size) {
        inlineStyles.fontSize = override.size;
      }
      if (override.marginTop) {
        inlineStyles.marginTop = override.marginTop;
      }
      if (override.marginBottom) {
        inlineStyles.marginBottom = override.marginBottom;
      }

      return {
        number: defaultLevel.number,
        tag: override.tag?.toUpperCase() || defaultLevel.tag,
        nameKey: defaultLevel.nameKey,
        name: override.name || defaultLevel.name,
        icon: defaultLevel.icon,
        styles: defaultLevel.styles,
        inlineStyles,
      };
    });

    const allowedLevels = this._settings.levels;

    return allowedLevels
      ? availableLevels.filter(l => allowedLevels.includes(l.number))
      : availableLevels;
  }

  /**
   * Handle H1-H6 tags on paste to substitute it with header Tool
   *
   * @param event - event with pasted content
   */
  public onPaste(event: PasteEvent): void {
    const detail = event.detail;

    if (!('data' in detail)) {
      return;
    }

    const content = detail.data as HTMLElement;

    /**
     * Map tag names to level numbers
     */
    const tagToLevel: Record<string, number> = {
      H1: 1,
      H2: 2,
      H3: 3,
      H4: 4,
      H5: 5,
      H6: 6,
    };

    /**
     * Define default level value
     */
    const parsedLevel = tagToLevel[content.tagName] ?? this.defaultLevel.number;

    /**
     * If levels are restricted, find the nearest allowed level
     */
    const level = this._settings.levels
      ? this._settings.levels.reduce((prevLevel, currLevel) => {
        return Math.abs(currLevel - parsedLevel) < Math.abs(prevLevel - parsedLevel) ? currLevel : prevLevel;
      })
      : parsedLevel;

    this.data = {
      level,
      text: content.innerHTML,
    };
  }

  /**
   * Used by Editor paste handling API.
   * Provides configuration to handle H1-H6 tags.
   *
   * @returns PasteConfig
   */
  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'],
    };
  }

  /**
   * Get Tool toolbox settings
   * Returns an array of all 6 heading levels, each with its own icon and title.
   * The BlockToolAdapter will filter these based on the `levels` config if specified.
   *
   * @returns ToolboxConfig array with entries for H1-H6
   */
  public static get toolbox(): ToolboxConfig {
    const headingEntries = Header.DEFAULT_LEVELS.map(level => ({
      icon: level.icon,
      title: level.name,
      titleKey: level.nameKey,
      name: `header-${level.number}`,
      data: { level: level.number },
      searchTerms: [`h${level.number}`, 'title', 'header', 'heading'],
      shortcut: '#'.repeat(level.number),
    }));

    const toggleHeadingIcons: Record<number, string> = {
      1: IconToggleH1,
      2: IconToggleH2,
      3: IconToggleH3,
    };

    const toggleHeadingEntries = Header.DEFAULT_LEVELS
      .filter(level => level.number <= 3)
      .map(level => ({
        icon: toggleHeadingIcons[level.number],
        title: `Toggle heading ${level.number}`,
        titleKey: `tools.header.toggleHeading${level.number}`,
        name: `toggle-header-${level.number}`,
        data: { level: level.number, isToggleable: true },
        searchTerms: ['toggle', 'heading', `h${level.number}`, 'collapsible'],
        shortcut: '>' + '#'.repeat(level.number),
      }));

    return [...headingEntries, ...toggleHeadingEntries];
  }

}
