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
  PasteConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';

import {
  saveToggleItem,
  mergeToggleItemData,
  setToggleItemData,
  parseHTML,
} from './block-operations';
import { ARROW_ICON, PLACEHOLDER_KEY, TOOL_NAME } from './constants';
import { renderToggleItem, updateArrowState, updateChildrenVisibility } from './toggle-lifecycle';
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
  private _isOpen: boolean = false;

  private blockId?: string;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);

    if (block) {
      this.blockId = block.id;
    }
  }

  private normalizeData(data: ToggleItemData | Record<string, never>): ToggleItemData {
    if (typeof data === 'object' && data !== null && 'text' in data) {
      return {
        text: typeof data.text === 'string' ? data.text : '',
      };
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
    });

    this._element = result.wrapper;
    this._contentElement = result.contentElement;
    this._arrowElement = result.arrowElement;

    return this._element;
  }

  public rendered(): void {
    this.updateChildrenVisibility();
  }

  public save(): ToggleItemData {
    return saveToggleItem(this._data, this._element, this.getContentElement.bind(this));
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

  public setData(newData: ToggleItemData): boolean {
    const result = setToggleItemData(
      this._data,
      newData,
      this.getContentElement.bind(this)
    );

    this._data = result.newData;

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

  private getContentElement(): HTMLElement | null {
    return this._contentElement;
  }

  private setOpenState(open: boolean): void {
    this._isOpen = open;

    if (this._arrowElement && this._element) {
      updateArrowState(this._arrowElement, this._element, this._isOpen);
    }

    this.updateChildrenVisibility();
  }

  private toggleOpen(): void {
    this.setOpenState(!this._isOpen);
  }

  private updateChildrenVisibility(): void {
    if (this.blockId === undefined) {
      return;
    }

    updateChildrenVisibility(this.api, this.blockId, this._isOpen);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.handleEnter();

      return;
    }

    if (event.key === 'Backspace') {
      void this.handleBackspace(event);
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

  public static get shortcut(): string {
    return 'CMD+ALT+7';
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: ARROW_ICON,
      title: 'Toggle list',
      titleKey: 'toggleList',
      name: TOOL_NAME,
      searchTerms: ['toggle', 'collapse', 'expand', 'accordion'],
    };
  }

  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'text',
      import: 'text',
    };
  }

  public static get sanitize(): SanitizerConfig {
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
