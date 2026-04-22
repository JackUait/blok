/**
 * Toggle Tool for the Blok Editor
 * Provides collapsible toggle blocks with an arrow indicator.
 *
 * @license MIT
 */

import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
  ConversionConfig,
  SanitizerConfig,
  ToolSanitizerConfig,
  PasteConfig,
  PasteEvent,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';

import {
  saveToggleItem,
  mergeToggleItemData,
  setToggleItemData,
  parseHTML,
} from './block-operations';
import { clean } from '../../components/utils/sanitizer';
import { ARIA_LABEL_COLLAPSE_KEY, ARIA_LABEL_EXPAND_KEY, BODY_PLACEHOLDER_KEY, PLACEHOLDER_KEY, TOOL_NAME } from './constants';
import { IconToggleList } from '../../components/icons';
import { renderToggleItem, updateArrowState, updateChildrenVisibility, updateBodyPlaceholderVisibility, updateToggleEmptyState } from './toggle-lifecycle';
import { handleToggleEnter, handleToggleBackspace } from './toggle-keyboard';
import type { ToggleItemData, ToggleItemConfig } from './types';

export class ToggleItem implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _settings: ToggleItemConfig;
  private _data: ToggleItemData;
  private _element: HTMLElement | null = null;
  private _contentElement: HTMLElement | null = null;
  private _arrowElement: HTMLElement | null = null;
  private _bodyPlaceholderElement: HTMLElement | null = null;
  private _childContainerElement: HTMLElement | null = null;
  private _isOpen: boolean;

  private blockId?: string;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);
    this._isOpen = this._data.isOpen ?? true;

    if (block) {
      this.blockId = block.id;
    }

    if (!readOnly) {
      this.api.events.on('block changed', this.handleBlockChanged);
    }
  }

  private normalizeData(data: ToggleItemData | Record<string, never>): ToggleItemData {
    if (typeof data === 'object' && data !== null && 'text' in data) {
      const normalized: ToggleItemData = {
        text: typeof data.text === 'string' ? data.text : '',
      };

      if (typeof (data as ToggleItemData).isOpen === 'boolean') {
        normalized.isOpen = (data as ToggleItemData).isOpen;
      }

      return normalized;
    }

    // Handle legacy toggleList format: { title, isExpanded }
    if (typeof data === 'object' && data !== null && 'title' in data) {
      const legacyData = data as Record<string, unknown>;
      const normalized: ToggleItemData = {
        text: typeof legacyData.title === 'string' ? legacyData.title : '',
      };

      if (typeof legacyData.isExpanded === 'boolean') {
        normalized.isOpen = legacyData.isExpanded;
      }

      return normalized;
    }

    return { text: '' };
  }

  private get placeholder(): string {
    if (this._settings.placeholder) {
      return this._settings.placeholder;
    }

    const translated = this.api.i18n.t(PLACEHOLDER_KEY);

    if (translated !== PLACEHOLDER_KEY) {
      return translated;
    }

    return 'Toggle';
  }

  public render(): HTMLElement {
    const result = renderToggleItem({
      data: this._data,
      readOnly: this.readOnly,
      isOpen: this._isOpen,
      placeholder: this.placeholder,
      keydownHandler: this.readOnly ? null : this.handleKeyDown.bind(this),
      onArrowClick: () => this.toggleOpen(),
      onBodyPlaceholderClick: this.readOnly ? null : () => this.handleBodyPlaceholderClick(),
      bodyPlaceholderText: this.api.i18n.t(BODY_PLACEHOLDER_KEY),
      ariaLabels: {
        collapse: this.api.i18n.t(ARIA_LABEL_COLLAPSE_KEY),
        expand: this.api.i18n.t(ARIA_LABEL_EXPAND_KEY),
      },
    });

    this._element = result.wrapper;
    this._contentElement = result.contentElement;
    this._arrowElement = result.arrowElement;
    this._bodyPlaceholderElement = result.bodyPlaceholderElement;
    this._childContainerElement = result.childContainerElement;

    /**
     * Listen for input events from child blocks so the empty-state attribute
     * (and the grayish arrow it drives) tracks what the user is typing in
     * real time.
     */
    this._childContainerElement.addEventListener('input', this.handleChildContainerInput);

    return this._element;
  }

  private handleChildContainerInput = (): void => {
    updateToggleEmptyState(this._element, this._childContainerElement);
  };

  public rendered(): void {
    this.updateChildrenVisibility();
    this.updateBodyPlaceholderVisibility();
  }

  public save(): ToggleItemData {
    return saveToggleItem(this._data, this._element, this.getContentElement.bind(this), this._isOpen);
  }

  public validate(_blockData: ToggleItemData): boolean {
    return true;
  }

  public merge(data: ToggleItemData): void {
    mergeToggleItemData(
      {
        data: this._data,
        getContentElement: this.getContentElement.bind(this),
        parseHTML,
      },
      data
    );
  }

  public onPaste(event: PasteEvent): void {
    const detail = event.detail;

    if (!('data' in detail)) {
      return;
    }

    const content = detail.data as HTMLElement;
    const summary = content.querySelector('summary');
    const rawText = summary !== null ? summary.innerHTML : content.innerHTML;
    const text = clean(rawText, ToggleItem.sanitize.text as SanitizerConfig);

    this._data = { text };

    const contentEl = this.getContentElement();

    if (contentEl !== null) {
      contentEl.innerHTML = text;
    }
  }

  public setData(newData: ToggleItemData): boolean {
    const result = setToggleItemData(
      this._data,
      newData,
      this.getContentElement.bind(this)
    );

    this._data = result.newData;

    if (typeof this._data.isOpen === 'boolean') {
      this._isOpen = this._data.isOpen;
    }

    if (this._arrowElement && this._element) {
      updateArrowState(this._arrowElement, this._element, this._isOpen, {
        collapse: this.api.i18n.t(ARIA_LABEL_COLLAPSE_KEY),
        expand: this.api.i18n.t(ARIA_LABEL_EXPAND_KEY),
      });
    }

    this.updateChildrenVisibility();
    this.updateBodyPlaceholderVisibility();

    return result.inPlace;
  }

  public renderSettings(): MenuConfig {
    return [];
  }

  /**
   * Expand the toggle (no-op if already expanded).
   * Can be called externally via block.call('expand').
   */
  public expand(): void {
    if (this._isOpen) {
      return;
    }

    this.setOpenState(true);
  }

  /**
   * Collapse the toggle (no-op if already collapsed).
   * Can be called externally via block.call('collapse').
   */
  public collapse(): void {
    if (!this._isOpen) {
      return;
    }

    this.setOpenState(false);
  }

  public setReadOnly(state: boolean): void {
    if (!this._element) {
      return;
    }

    const wasReadOnly = this.readOnly;

    this.readOnly = state;

    // Toggle contentEditable on the content element
    if (this._contentElement) {
      this._contentElement.contentEditable = state ? 'false' : 'true';
    }

    // Manage block changed event subscription
    if (state && !wasReadOnly) {
      this.api.events.off('block changed', this.handleBlockChanged);
    } else if (!state && wasReadOnly) {
      this.api.events.on('block changed', this.handleBlockChanged);
    }

    // Update body placeholder visibility (hidden in read-only mode)
    this.updateBodyPlaceholderVisibility();
  }

  public removed(): void {
    this.api.events.off('block changed', this.handleBlockChanged);
  }

  private handleBlockChanged = (data: unknown): void => {
    if (!this.isBlockChangedPayload(data)) {
      return;
    }

    if (data.event.type === 'block-removed' || data.event.type === 'block-added') {
      this.updateBodyPlaceholderVisibility();
    }
  };

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

  private getContentElement(): HTMLElement | null {
    return this._contentElement;
  }

  private setOpenState(open: boolean): void {
    this._isOpen = open;

    if (this._arrowElement && this._element) {
      updateArrowState(this._arrowElement, this._element, this._isOpen, {
        collapse: this.api.i18n.t(ARIA_LABEL_COLLAPSE_KEY),
        expand: this.api.i18n.t(ARIA_LABEL_EXPAND_KEY),
      });
    }

    this.updateChildrenVisibility();
    this.updateBodyPlaceholderVisibility();
  }

  private toggleOpen(): void {
    this.setOpenState(!this._isOpen);
  }

  private updateChildrenVisibility(): void {
    if (this.blockId === undefined) {
      return;
    }

    updateChildrenVisibility(this.api, this.blockId, this._isOpen, this._childContainerElement, this._arrowElement);
  }

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

    updateToggleEmptyState(this._element, this._childContainerElement);
  }

  private handleBodyPlaceholderClick(): void {
    if (this.blockId === undefined) {
      return;
    }

    const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (blockIndex === undefined) {
      return;
    }

    const newBlock = this.api.blocks.insertInsideParent(this.blockId, blockIndex + 1);

    this.api.caret.setToBlock(newBlock.id, 'start');

    // Hide the body placeholder now that a child exists
    this._bodyPlaceholderElement?.classList.add('hidden');
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.handleEnter();

      return;
    }

    if (event.key === 'Backspace') {
      void this.handleBackspace(event);

      return;
    }
  }

  private createKeyboardContext(): Parameters<typeof handleToggleEnter>[0] {
    return {
      api: this.api,
      blockId: this.blockId,
      data: this._data,
      element: this._element,
      getContentElement: this.getContentElement.bind(this),
      syncContentFromDOM: this.syncContentFromDOM.bind(this),
      isOpen: this._isOpen,
      setOpen: (open: boolean) => {
        this._isOpen = open;
      },
    };
  }

  private async handleEnter(): Promise<void> {
    await handleToggleEnter(this.createKeyboardContext());

    // After Enter may create a child, update body placeholder visibility
    this.updateBodyPlaceholderVisibility();
  }

  private async handleBackspace(event: KeyboardEvent): Promise<void> {
    await handleToggleBackspace(this.createKeyboardContext(), event);
  }

  private syncContentFromDOM(): void {
    const contentEl = this.getContentElement();

    if (contentEl) {
      this._data.text = contentEl.innerHTML;
    }
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconToggleList,
      titleKey: 'toggleList',
      name: TOOL_NAME,
      searchTerms: ['toggle', 'collapse', 'expand', 'accordion'],
      searchTermKeys: ['toggle', 'collapse', 'expand', 'accordion'],
      shortcut: '>',
    };
  }

  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'text',
      import: 'text',
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      text: {
        br: true,
        a: {
          href: true,
          target: '_blank',
          rel: 'nofollow',
        },
        b: true,
        i: true,
        mark: {
          class: true,
          style: true,
        },
        code: true,
      },
    };
  }

  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['DETAILS'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ToggleItemConfig, ToggleItemData };
