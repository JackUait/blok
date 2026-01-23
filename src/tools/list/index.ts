import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  PasteEvent,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
  PasteConfig,
} from '../../../types';
import type { MoveEvent } from '../../../types/tools/hook-events';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { setupPlaceholder } from '../../components/utils/placeholder';

import {
  rerenderListItem,
  saveListItem,
  setListItemData,
  mergeListItemData,
  renderListSettings,
} from './block-operations';
import { PLACEHOLDER_KEY } from './constants';
import { getContentOffset } from './content-offset';
import { parseHTML } from './content-operations';
import { normalizeListItemData } from './data-normalizer';
import { ListDepthValidator } from './depth-validator';
import {
  getContentElement as helpersGetContentElement,
  adjustDepthTo as helpersAdjustDepthTo,
  getBulletCharacter,
  getSiblingIndex,
  getOrderedMarkerText,
  findListGroupStartIndex,
  updateMarkersInRange,
  updateAllOrderedListMarkers,
} from './list-helpers';
import { handleEnter, handleBackspace, handleIndent, handleOutdent } from './list-keyboard';
import { renderListItem } from './list-lifecycle';
import { ListMarkerCalculator } from './marker-calculator';
import { OrderedMarkerManager } from './ordered-marker-manager';
import { isPasteEventHTMLElement, detectStyleFromPastedContent, extractPastedContent, extractDepthFromPastedContent } from './paste-handler';
import { getListSanitizeConfig, getListPasteConfig, getListConversionConfig } from './static-configs';
import { STYLE_CONFIGS, getToolboxConfig } from './style-config';
import type { ListItemStyle, ListItemConfig, StyleConfig, ListItemData } from './types';

export class ListItem implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _settings: ListItemConfig;
  private _data: ListItemData;
  private _element: HTMLElement | null = null;
  private depthValidator: ListDepthValidator;
  private markerCalculator: ListMarkerCalculator;
  private markerManager: OrderedMarkerManager | null;

  private blockId?: string;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<ListItemData, ListItemConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);
    this.depthValidator = new ListDepthValidator(api.blocks);
    this.markerCalculator = new ListMarkerCalculator(api.blocks);

    this.markerManager = this._data.style === 'ordered' ? new OrderedMarkerManager(api.blocks) : null;

    if (block) {
      this.blockId = block.id;
    }

    if (this._data.style === 'ordered') {
      this.api.events.on('block changed', this.handleBlockChanged);
    }
  }

  private isBlockChangedEventPayload(data: unknown): data is { event: { type: string } } {
    return typeof data === 'object' && data !== null && 'event' in data &&
      typeof data.event === 'object' && data.event !== null && 'type' in data.event &&
      typeof data.event.type === 'string';
  }

  private handleBlockChanged = (data: unknown): void => {
    if (!this.isBlockChangedEventPayload(data)) {
      return;
    }

    if (data.event.type === 'block-removed' || data.event.type === 'block-added') {
      this.markerManager?.scheduleUpdateAll();
    }
  };

  sanitize?: ToolSanitizerConfig | undefined;

  private normalizeData(data: ListItemData | Record<string, never>): ListItemData {
    return normalizeListItemData(data, this._settings);
  }

  private get availableStyles(): StyleConfig[] {
    const configuredStyles = this._settings.styles;
    if (!configuredStyles || configuredStyles.length === 0) {
      return STYLE_CONFIGS;
    }
    return STYLE_CONFIGS.filter(s => configuredStyles.includes(s.style));
  }

  private get itemColor(): string | undefined {
    return this._settings.itemColor;
  }

  private get itemSize(): string | undefined {
    return this._settings.itemSize;
  }

  private get placeholder(): string {
    return this.api.i18n.t(PLACEHOLDER_KEY);
  }

  private setupItemPlaceholder(element: HTMLElement): void {
    if (this.readOnly) {
      return;
    }
    setupPlaceholder(element, this.placeholder);
  }

  public render(): HTMLElement {
    this._element = renderListItem({
      data: this._data,
      readOnly: this.readOnly,
      placeholder: this.placeholder,
      itemColor: this.itemColor,
      itemSize: this.itemSize,
      setupItemPlaceholder: this.setupItemPlaceholder.bind(this),
      onCheckboxChange: (checked, content) => {
        this._data.checked = checked;
        if (content instanceof HTMLElement) {
          content.classList.toggle('line-through', checked);
          content.classList.toggle('opacity-60', checked);
        }
      },
      keydownHandler: this.readOnly ? undefined : this.handleKeyDown.bind(this),
    });

    return this._element;
  }

  public rendered(): void {
    this.updateMarkersAfterPositionChange();
  }

  public moved(event: MoveEvent): void {
    this.validateAndAdjustDepthAfterMove(event.toIndex);
    this.updateMarkersAfterPositionChange();
  }

  private updateMarkersAfterPositionChange(): void {
    if (this._data.style !== 'ordered' || !this._element) {
      return;
    }

    this.updateMarker();
    this.updateSiblingListMarkers();
  }

  private validateAndAdjustDepthAfterMove(newIndex: number): void {
    const currentDepth = this.getDepth();
    const targetDepth = this.depthValidator.getTargetDepthForMove({
      blockIndex: newIndex,
      currentDepth,
    });

    if (currentDepth !== targetDepth) {
      this.adjustDepthTo(targetDepth);
    }
  }

  private adjustDepthTo(newDepth: number): void {
    helpersAdjustDepthTo(this._element, this._data, newDepth);
  }

  public removed(): void {
    if (this._data.style !== 'ordered') {
      return;
    }

    this.api.events.off('block changed', this.handleBlockChanged);

    requestAnimationFrame(() => {
      this.updateAllOrderedListMarkers();
    });
  }

  private updateAllOrderedListMarkers(): void {
    updateAllOrderedListMarkers(this.api.blocks, this.depthValidator, this.markerCalculator);
  }

  private updateMarker(): void {
    const marker = this._element?.querySelector('[data-list-marker]');
    if (!marker) {
      return;
    }

    const depth = this.getDepth();
    const siblingIndex = getSiblingIndex(this.blockId, depth, this._data.style, this.api.blocks, this.markerCalculator);
    const markerText = getOrderedMarkerText(siblingIndex, depth, this._data, this.blockId, this.api.blocks, this.markerCalculator);
    marker.textContent = markerText;
  }

  private updateSiblingListMarkers(): void {
    const currentBlockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();

    const currentDepth = this.getDepth();
    const currentStyle = this._data.style;
    const blocksCount = this.api.blocks.getBlocksCount();

    const groupStartIndex = findListGroupStartIndex(currentBlockIndex, currentDepth, currentStyle, this.markerCalculator);

    updateMarkersInRange(groupStartIndex, blocksCount, currentBlockIndex, currentDepth, currentStyle, this.api.blocks, this.depthValidator, this.markerCalculator);
  }

  private updateMarkerForDepth(newDepth: number, style: ListItemStyle): void {
    const marker = this._element?.querySelector('[aria-hidden="true"]');

    if (!(marker instanceof HTMLElement)) {
      return;
    }

    if (style === 'ordered') {
      const siblingIndex = getSiblingIndex(this.blockId, newDepth, this._data.style, this.api.blocks, this.markerCalculator);
      const markerText = getOrderedMarkerText(siblingIndex, newDepth, this._data, this.blockId, this.api.blocks, this.markerCalculator);

      marker.textContent = markerText;
    } else {
      const bulletChar = getBulletCharacter(newDepth, this.markerCalculator);

      marker.textContent = bulletChar;
    }
  }

  private updateCheckboxState(checked: boolean): void {
    const checkbox = this._element?.querySelector('input[type="checkbox"]');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = checked;
    }
  }

  private getDepth(): number {
    return this._data.depth ?? 0;
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

    if (event.key !== 'Tab') {
      return;
    }

    const selectedBlocks = document.querySelectorAll('[data-blok-selected="true"]');

    if (selectedBlocks.length > 1) {
      return;
    }

    event.preventDefault();

    if (event.shiftKey) {
      void this.handleOutdent();

      return;
    }

    void this.handleIndent();
  }

  private async handleEnter(): Promise<void> {
    const context = {
      api: this.api,
      blockId: this.blockId,
      data: this._data,
      element: this._element,
      getContentElement: this.getContentElement.bind(this),
      syncContentFromDOM: this.syncContentFromDOM.bind(this),
      getDepth: this.getDepth.bind(this),
    };

    await handleEnter(context);
  }

  private async handleBackspace(event: KeyboardEvent): Promise<void> {
    const context = {
      api: this.api,
      blockId: this.blockId,
      data: this._data,
      element: this._element,
      getContentElement: this.getContentElement.bind(this),
      syncContentFromDOM: this.syncContentFromDOM.bind(this),
      getDepth: this.getDepth.bind(this),
    };

    await handleBackspace(context, event);
  }

  private async handleIndent(): Promise<void> {
    const context = {
      api: this.api,
      blockId: this.blockId,
      data: this._data,
      element: this._element,
      getContentElement: this.getContentElement.bind(this),
      syncContentFromDOM: this.syncContentFromDOM.bind(this),
      getDepth: this.getDepth.bind(this),
    };

    await handleIndent(context, this.depthValidator);
  }

  private async handleOutdent(): Promise<void> {
    const context = {
      api: this.api,
      blockId: this.blockId,
      data: this._data,
      element: this._element,
      getContentElement: this.getContentElement.bind(this),
      syncContentFromDOM: this.syncContentFromDOM.bind(this),
      getDepth: this.getDepth.bind(this),
    };

    await handleOutdent(context);
  }

  private syncContentFromDOM(): void {
    const contentEl = this.getContentElement();
    if (contentEl) {
      this._data.text = contentEl.innerHTML;
    }

    if (this._data.style !== 'checklist') {
      return;
    }

    const checkbox = this._element?.querySelector('input[type="checkbox"]');
    if (checkbox instanceof HTMLInputElement) {
      this._data.checked = checkbox.checked;
    }
  }

  private getContentElement(): HTMLElement | null {
    return helpersGetContentElement(this._element, this._data.style);
  }

  public renderSettings(): MenuConfig {
    return renderListSettings(this.availableStyles, this._data.style, this.api.i18n.t, (style) => this.setStyle(style));
  }

  private setStyle(style: ListItemStyle): void {
    const previousStyle = this._data.style;
    this._data.style = style;
    this.rerender();

    if (previousStyle !== style) {
      requestAnimationFrame(() => {
        this.updateAllOrderedListMarkers();
      });
    }
  }

  private rerender(): void {
    const newElement = rerenderListItem({
      data: this._data,
      readOnly: this.readOnly,
      placeholder: this.placeholder,
      itemColor: this.itemColor,
      itemSize: this.itemSize,
      element: this._element,
      setupItemPlaceholder: this.setupItemPlaceholder.bind(this),
      onCheckboxChange: (checked, content) => {
        this._data.checked = checked;
        if (content instanceof HTMLElement) {
          content.classList.toggle('line-through', checked);
          content.classList.toggle('opacity-60', checked);
        }
      },
      keydownHandler: this.readOnly ? undefined : this.handleKeyDown.bind(this),
    });

    if (newElement) {
      this._element = newElement;
      // After rerender, update markers for ordered lists to ensure correct numeration
      this.updateMarkersAfterPositionChange();
    }
  }

  public validate(blockData: ListItemData): boolean {
    return typeof blockData.text === 'string';
  }

  public save(): ListItemData {
    return saveListItem(this._data, this._element, this.getContentElement.bind(this));
  }

  public setData(newData: ListItemData): boolean {
    const result = setListItemData(
      this._data,
      newData,
      this._element,
      this.getContentElement.bind(this),
      {
        adjustDepthTo: this.adjustDepthTo.bind(this),
        updateMarkerForDepth: this.updateMarkerForDepth.bind(this),
        updateCheckboxState: this.updateCheckboxState.bind(this),
      }
    );

    this._data = result.newData;
    return result.inPlace;
  }

  public merge(data: ListItemData): void {
    mergeListItemData(
      {
        data: this._data,
        element: this._element,
        getContentElement: this.getContentElement.bind(this),
        parseHTML,
      },
      data
    );
  }

  public static get conversionConfig(): ConversionConfig<ListItemData> {
    return getListConversionConfig();
  }

  public static get sanitize(): ToolSanitizerConfig {
    return getListSanitizeConfig();
  }

  public static get pasteConfig(): PasteConfig {
    return getListPasteConfig();
  }

  public onPaste(event: PasteEvent): void {
    const detail = event.detail;
    if (!('data' in detail)) return;

    const data = detail.data;
    if (!isPasteEventHTMLElement(data)) {
      return;
    }

    const { text, checked } = extractPastedContent(data);
    const depth = extractDepthFromPastedContent(data);

    this._data = {
      text,
      style: detectStyleFromPastedContent(data, this._data.style),
      checked,
      depth,
    };

    this.rerender();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public getContentOffset(hoveredElement: Element): { left: number } | undefined {
    return getContentOffset(hoveredElement);
  }

  public static get toolbox(): ToolboxConfig {
    return getToolboxConfig();
  }
}

export type { ListItemConfig, ListItemData };
