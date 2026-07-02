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
import { PLACEHOLDER_KEY, TOOL_NAME } from './constants';
import { getContentOffset } from './content-offset';
import { applyCheckboxState } from './dom-builder';
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
import { handleEnter, handleBackspace, handleIndent, handleOutdent, toggleChecklistChecked } from './list-keyboard';
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
  private placeholderCleanup: (() => void) | null = null;
  private boundHandleKeyDown: ((event: KeyboardEvent) => void) | null = null;

  /**
   * Whether this item was structurally nested (had a list parent) at the last
   * move/render. Lets {@link moved} tell a structural outdent-to-root (depth must
   * reset to 0) apart from a same-position drag at root (depth recomputed from
   * neighbours). Drag never sets a list item's `parentId`, so the structural
   * path only activates for keyboard Tab/Shift+Tab nesting.
   */
  private wasStructurallyNested = false;

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
    this.placeholderCleanup = setupPlaceholder(element, this.placeholder);
  }

  public render(): HTMLElement {
    if (this._element) {
      return this._element;
    }

    // Reconcile the flat carrier to the tree BEFORE the DOM builder reads
    // data.depth for the indent/marker, so a stale value can never render a
    // depth that disagrees with the block's structural nesting.
    this.reconcileDepthFromStructure();

    const blockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();
    const depth = this._data.depth ?? 0;
    const markerDepth = this.markerCalculator.getVisualDepth(blockIndex, depth);

    if (!this.boundHandleKeyDown) {
      this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    }

    this._element = renderListItem({
      data: this._data,
      readOnly: this.readOnly,
      placeholder: this.placeholder,
      itemColor: this.itemColor,
      itemSize: this.itemSize,
      markerDepth,
      setupItemPlaceholder: this.setupItemPlaceholder.bind(this),
      onCheckboxChange: (checked, content) => {
        this._data.checked = checked;
        if (content instanceof HTMLElement) {
          content.classList.toggle('line-through', checked);
          content.classList.toggle('opacity-60', checked);
        }
      },
      keydownHandler: this.readOnly ? undefined : this.boundHandleKeyDown,
    });

    return this._element;
  }

  public setReadOnly(state: boolean): void {
    if (!this._element) {
      return;
    }

    this.readOnly = state;

    const content = this.getContentElement();

    // Toggle contentEditable on content container
    if (content) {
      content.contentEditable = state ? 'false' : 'true';
    }

    // Toggle checkbox disabled state for checklists
    const checkbox = this._element.querySelector<HTMLInputElement>('input[type="checkbox"]');

    if (checkbox) {
      checkbox.disabled = state;
    }

    // Toggle keydown handler and placeholder
    if (state) {
      if (this.boundHandleKeyDown) {
        this._element.removeEventListener('keydown', this.boundHandleKeyDown);
      }

      if (this.placeholderCleanup) {
        this.placeholderCleanup();
        this.placeholderCleanup = null;
      }
    } else {
      if (this.boundHandleKeyDown) {
        this._element.addEventListener('keydown', this.boundHandleKeyDown);
      }

      if (content) {
        this.placeholderCleanup = setupPlaceholder(content, this.placeholder);
      }
    }
  }

  public rendered(): void {
    // Seed the structural-nesting flag from the loaded tree so the first move
    // after render can distinguish a structural outdent from a flat drag.
    const structuralDepth = this.getStructuralListDepth();
    this.wasStructurallyNested = structuralDepth !== null;

    // The parentId chain may only be assembled AFTER the initial render() (the
    // block is parented once the tree is built). If it turned out to be
    // structurally nested at a depth the flat carrier didn't match, reconcile
    // the rendered indent + marker now so structure stays the source of truth.
    if (structuralDepth !== null && structuralDepth !== (this._data.depth ?? 0)) {
      this.adjustDepthTo(structuralDepth);
      this.updateMarkerForDepth(structuralDepth, this._data.style);
    }

    this.updateMarkersAfterPositionChange();
  }

  public moved(event: MoveEvent): void {
    // A horizontal drag-to-indent supplies the pointer-resolved drop depth. It is
    // authoritative — the drop must land at the depth the indicator previewed, not
    // the neighbour auto-resolution — so honor it directly (still clamped to the
    // legal range by the validator's pointer path) and skip the auto heuristics.
    if (event.targetDepth !== undefined) {
      this.validateAndAdjustDepthAfterMove(event.toIndex, event.isGroupMove, event.targetDepth);
      this.wasStructurallyNested = this.getStructuralListDepth() !== null;
      this.updateMarkersAfterPositionChange();
      this.markerManager?.scheduleUpdateAll();

      return;
    }

    const structuralDepth = this.getStructuralListDepth();
    // A history-replay reparent (undo/redo) is definitionally structural: derive
    // depth from the tree even on a freshly-rendered instance whose in-memory
    // `wasStructurallyNested` flag was reset. Without this, undoing a keyboard Tab
    // leaves the flat `data.depth` carrier stale (still 1) so save() reports the
    // wrong depth.
    const isStructural = event.structural === true || structuralDepth !== null || this.wasStructurallyNested;

    if (isStructural) {
      // Keyboard Tab/Shift+Tab nests/outdents list items STRUCTURALLY
      // (parentId/contentIds) and emits BlockMoved. Derive depth from the tree
      // and sync the flat carriers (margin + data.depth + marker) so rendering,
      // numbering and serialization stay correct. An item that was nested and is
      // now at root (structuralDepth === null) outdented to depth 0.
      const derivedDepth = structuralDepth ?? 0;

      this.adjustDepthTo(derivedDepth);
      this.updateMarkerForDepth(derivedDepth, this._data.style);
      this.wasStructurallyNested = structuralDepth !== null;
    } else {
      this.validateAndAdjustDepthAfterMove(event.toIndex, event.isGroupMove);
    }

    this.updateMarkersAfterPositionChange();
    // updateMarkersAfterPositionChange only renumbers the destination group
    // around this block. Dragging an item out of another list (e.g. the 2nd of
    // three) leaves that source group short an item with no moved() hook of its
    // own, so renumber every ordered group — same as removed() does.
    this.markerManager?.scheduleUpdateAll();
  }

  /**
   * Structural nesting depth of this list item, DERIVED from its position in the
   * block tree (the parentId chain), not a stored `data.depth`. Returns the
   * number of consecutive list ancestors (a list two levels under another list
   * is depth 2), or null when the item is not structurally nested under another
   * list — in which case depth falls back to the flat `data.depth` carrier that
   * drag-and-drop still uses.
   */
  private getStructuralListDepth(): number | null {
    if (this.blockId === undefined) {
      return null;
    }

    const countListAncestors = (childId: string, depth: number): number => {
      const child = this.api.blocks.getById(childId);
      const parentId = child?.parentId ?? null;

      if (parentId === null) {
        return depth;
      }

      const parent = this.api.blocks.getById(parentId);

      if (parent === null || parent.name !== TOOL_NAME) {
        return depth;
      }

      return countListAncestors(parentId, depth + 1);
    };

    const depth = countListAncestors(this.blockId, 0);

    return depth > 0 ? depth : null;
  }

  /**
   * Collapse the flat `data.depth` carrier onto the STRUCTURAL depth whenever
   * this item has a list parent, so the persisted value can never drift from the
   * block tree (which is the single source of truth for a nested item). No-op for
   * flat/unparented items (structural depth null): they legitimately rely on the
   * flat carrier for drag/paste until they gain a structural parent, and
   * {@link getDepth} keeps reading it as the fallback in that case.
   */
  private reconcileDepthFromStructure(): void {
    const structuralDepth = this.getStructuralListDepth();

    if (structuralDepth !== null && structuralDepth !== (this._data.depth ?? 0)) {
      this._data.depth = structuralDepth;
    }
  }

  private updateMarkersAfterPositionChange(): void {
    if (this._data.style !== 'ordered' || !this._element) {
      return;
    }

    this.updateMarker();
    this.updateSiblingListMarkers();
  }

  private validateAndAdjustDepthAfterMove(newIndex: number, skipDepthPromotion?: boolean, pointerDepth?: number): void {
    const currentDepth = this.getDepth();
    const targetDepth = this.depthValidator.getTargetDepthForMove({
      blockIndex: newIndex,
      currentDepth,
      skipDepthPromotion,
      pointerDepth,
    });

    if (currentDepth !== targetDepth) {
      this.adjustDepthTo(targetDepth);
      // adjustDepthTo only updates margin + data-depth. The marker glyph is
      // depth-derived (unordered bullets •/◦/▪ and ordered a./i. formatting),
      // so refresh it too — otherwise a depth-changed item keeps its old glyph.
      // Mirrors the adjustDepthTo + updateMarkerForDepth pairing used on setData.
      this.updateMarkerForDepth(targetDepth, this._data.style);
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

    this.markerManager?.scheduleUpdateAll();
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

    const blockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();
    const visualDepth = this.markerCalculator.getVisualDepth(blockIndex, newDepth);

    if (style === 'ordered') {
      const siblingIndex = getSiblingIndex(this.blockId, newDepth, this._data.style, this.api.blocks, this.markerCalculator);
      const markerText = getOrderedMarkerText(siblingIndex, newDepth, this._data, this.blockId, this.api.blocks, this.markerCalculator);

      marker.textContent = markerText;
    } else {
      const bulletChar = getBulletCharacter(visualDepth, this.markerCalculator);

      marker.textContent = bulletChar;
    }
  }

  private updateCheckboxState(checked: boolean): void {
    const checkbox = this._element?.querySelector('input[type="checkbox"]');
    if (checkbox instanceof HTMLInputElement) {
      applyCheckboxState(checkbox, checked);
    }
  }

  private getDepth(): number {
    // Prefer the STRUCTURAL depth (tree position) when the item is nested under
    // another list via parentId/contentIds — keyboard Tab nesting. Fall back to
    // the flat `data.depth` carrier for drag-nested items (which set depth but
    // not parentId) and for un-nested root items.
    return this.getStructuralListDepth() ?? this._data.depth ?? 0;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Notion parity (m-11): Cmd/Ctrl+Enter toggles a to-do's checkbox IN PLACE,
    // it does not split or create a new item.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && this._data.style === 'checklist') {
      event.preventDefault();
      void this.toggleChecked();

      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.handleEnter();

      return;
    }

    if (event.key === 'Backspace') {
      void this.handleBackspace(event);

      return;
    }

    /**
     * Tab / Shift+Tab nesting is normally structural (parentId/contentIds) and
     * handled by the shared module keydown handler (KeyboardNavigation.handleTab)
     * — the SAME path text and headers use. Leaving the event un-prevented lets
     * it reach that handler, which nests the item under its preceding sibling
     * (Tab) or outdents it to the grandparent (Shift+Tab).
     *
     * Exception: items nested via the FLAT `data.depth` carrier (drag-nested, or
     * authored from data with `depth` but no list parentId) have no structural
     * parent for that handler to act on — its outdent is a no-op for them. Handle
     * Shift+Tab here for that case by decrementing the flat depth carrier and
     * restoring the caret to the content element.
     */
    if (event.key === 'Tab' && this.getStructuralListDepth() === null) {
      /**
       * Flat-carrier items (drag-nested, or authored with `data.depth` but no
       * list parentId) have no structural parent for the shared Tab handler to
       * act on: its indent would no-op on the first item / derive the wrong
       * depth, and its outdent is a no-op. Handle both here via the flat depth
       * carrier — handleIndent caps at the max allowed depth, handleOutdent
       * guards at depth 0. Structurally nested items fall through to the shared
       * handler.
       *
       * Notion parity (M-2): an item whose previous block is a NON-list block
       * (paragraph/heading) must NOT be handled here. The flat handleIndent has
       * nothing to nest under (its first-in-group guard no-ops), and swallowing
       * the event with preventDefault would short-circuit the shared structural
       * handler that DOES indent type-agnostically (nesting the item as the last
       * child of the preceding paragraph/heading). Leave the event un-prevented
       * so that handler runs.
       *
       * Notion parity (M-9): an un-nested list item (flat depth 0) must nest
       * STRUCTURALLY under its preceding sibling so the indent survives a
       * save()/reload — exactly like the multi-select Tab path. Only keep the
       * flat indent for items already carried by a flat `data.depth` (> 0), where
       * the cap-based depth bump must be preserved (drag/authored nesting).
       */
      const previousBlockIsList = this.getPreviousBlock()?.name === TOOL_NAME;

      if (event.shiftKey && this.getDepth() > 0) {
        event.preventDefault();
        void this.handleOutdent();
      } else if (!event.shiftKey && previousBlockIsList && this.getDepth() > 0) {
        event.preventDefault();
        void this.handleIndent();
      }
    }
  }

  /**
   * The block immediately preceding this list item in the document order, or
   * undefined when this is the first block.
   */
  private getPreviousBlock(): { name: string } | undefined {
    const currentBlockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();

    return currentBlockIndex > 0
      ? this.api.blocks.getBlockByIndex(currentBlockIndex - 1)
      : undefined;
  }

  private async toggleChecked(): Promise<void> {
    const context = {
      api: this.api,
      blockId: this.blockId,
      data: this._data,
      element: this._element,
      getContentElement: this.getContentElement.bind(this),
      syncContentFromDOM: this.syncContentFromDOM.bind(this),
      getDepth: this.getDepth.bind(this),
    };

    await toggleChecklistChecked(context);
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

    await handleEnter(context, this.depthValidator);
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

    await handleBackspace(context, event, this.depthValidator);
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

    await handleOutdent(context, this.depthValidator);
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
      this.markerManager?.scheduleUpdateAll();
    }
  }

  private rerender(): void {
    // Same drift guard as render(): keep the rebuilt indent/marker aligned with
    // the structural tree rather than a possibly-stale flat depth carrier.
    this.reconcileDepthFromStructure();

    const blockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();
    const depth = this._data.depth ?? 0;

    const newElement = rerenderListItem({
      data: this._data,
      readOnly: this.readOnly,
      placeholder: this.placeholder,
      itemColor: this.itemColor,
      itemSize: this.itemSize,
      markerDepth: this.markerCalculator.getVisualDepth(blockIndex, depth),
      element: this._element,
      setupItemPlaceholder: this.setupItemPlaceholder.bind(this),
      onCheckboxChange: (checked, content) => {
        this._data.checked = checked;
        if (content instanceof HTMLElement) {
          content.classList.toggle('line-through', checked);
          content.classList.toggle('opacity-60', checked);
        }
      },
      keydownHandler: this.readOnly ? undefined : this.boundHandleKeyDown ?? undefined,
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
    // Serialize the STRUCTURAL depth (derived from the parentId chain), not the
    // stored flat data.depth — keeping the saved depth consistent with the block
    // tree after a drag/keyboard nest. getDepth() falls back to data.depth for
    // imported lists that are not yet structurally parented.
    return saveListItem(this._data, this._element, this.getContentElement.bind(this), this.getDepth());
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
