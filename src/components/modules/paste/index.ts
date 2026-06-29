import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';
import { Module } from '../../__module';
import { Dom as dom$ } from '../../dom';
import { composeSanitizerConfig, clean } from '../../utils/sanitizer';

import { SAFE_STRUCTURAL_TAGS } from './constants';
import { preprocessGoogleDocsHtml } from './google-docs-preprocessor';
import { preprocessNotionHtml } from './notion-preprocessor';
import { NOTION_BLOCKS_V3_MIME, parseNotionBlocksV3 } from './notion-blocks-v3';
import { NEXT_SPACE_MIMES, parseNextSpaceBlocks } from './next-space-blocks';
import type { PasteHandler } from './handlers/base';
import { BlokDataHandler } from './handlers/blok-data-handler';
import { FilesHandler } from './handlers/files-handler';
import { HtmlHandler } from './handlers/html-handler';
import { MarkdownHandler } from '../../../markdown/markdown-handler';
import { PatternHandler } from './handlers/pattern-handler';
import { TableCellsHandler } from './handlers/table-cells-handler';
import { TextHandler } from './handlers/text-handler';
import { SanitizerConfigBuilder } from './sanitizer-config';
import { ToolRegistry } from './tool-registry';
import type { HandlerContext } from './types';

/**
 * @class Paste
 * @classdesc Contains methods to handle paste on blok
 * @module Paste
 * @version 2.0.0
 */
export class Paste extends Module {
  /** If string's length is greater than this number we don't check paste patterns */
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;

  /** Custom Blok mime-type to handle in-blok copy/paste actions */
  public readonly MIME_TYPE = 'application/x-blok';

  private toolRegistry!: ToolRegistry;
  private sanitizerBuilder!: SanitizerConfigBuilder;
  private handlers!: PasteHandler[];

  /**
   * Whether the most recent keyboard activity had Shift held. A `paste`
   * ClipboardEvent carries no modifier flags, so we read Shift from the
   * keydown/keyup that drives Cmd/Ctrl+Shift+V and use it to route the paste
   * to the raw plain-text path (paste-without-formatting), bypassing the
   * markdown/HTML→blocks conversion pipeline.
   */
  private isShiftHeld = false;

  /**
   * Set onPaste callback and collect tools' paste configurations.
   */
  public async prepare(): Promise<void> {
    const { Tools } = this.Blok;

    this.toolRegistry = new ToolRegistry(Tools.blockTools, this.config);
    this.sanitizerBuilder = new SanitizerConfigBuilder(Tools.blockTools, this.config);

    await this.toolRegistry.processTools();

    // Initialize handlers in priority order (higher priority first).
    // HtmlHandler (40) must precede MarkdownHandler (30): rich clipboards such
    // as Notion ship both a faithful text/html payload and a lossy markdown
    // text/plain twin, and routing picks the first eligible handler in this
    // list. Trying HTML first keeps images, links and other structure that the
    // markdown twin drops; markdown still wins when no usable HTML is present.
    this.handlers = [
      new BlokDataHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder, this.config),
      new TableCellsHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder),
      new FilesHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder),
      new PatternHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder, this.config),
      new HtmlHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder, this.config),
      new MarkdownHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder),
      new TextHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder, this.config),
    ];
  }

  /**
   * Process text data (public API).
   * Used by API.renderFromHTML() to process HTML or plain text.
   * @param data - Text or HTML string to process
   * @param isHTML - If true, process as HTML, otherwise as plain text
   */
  public async processText(data: string, isHTML = false): Promise<void> {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    const canReplaceCurrentBlock = Boolean(
      currentBlock &&
      currentBlock.tool.isDefault &&
      currentBlock.isEmpty
    );

    const handler = isHTML
      ? this.handlers.find((h): h is HtmlHandler => h instanceof HtmlHandler)
      : this.handlers.find((h): h is TextHandler => h instanceof TextHandler);

    if (!handler) {
      return;
    }

    const context: HandlerContext = {
      canReplaceCurrentBlock,
      currentBlock: currentBlock ?? undefined,
    };

    await handler.handle(data, context);
  }

  /**
   * Set read-only state.
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      this.setCallback();
    } else {
      this.unsetCallback();
    }
  }

  /**
   * Handle pasted data transfer object.
   */
  public async processDataTransfer(dataTransfer: DataTransfer, pasteTarget?: Element): Promise<void> {
    const plainData = dataTransfer.getData('text/plain');

    // Give consumers a chance to transform or drop the raw clipboard HTML
    // before any Blok preprocessing/sanitization runs. Returning a string
    // replaces the HTML for the rest of the pipeline; returning null aborts the
    // HTML paste path entirely (an empty string makes HtmlHandler bail, so the
    // paste falls through to the plain-text handler).
    const clipboardHtml = dataTransfer.getData('text/html');
    const rawHtmlData = clipboardHtml && this.config.onBeforePaste
      ? this.config.onBeforePaste(clipboardHtml) ?? ''
      : clipboardHtml;

    // Native Blok clipboard data always wins. When absent, fall back to the
    // lossless proprietary flavours of other editors (web→web paste): they
    // carry full block state (checked, language, nesting, colour…) that the
    // HTML flavour cannot. We translate them into the Blok clipboard shape so
    // they flow through the existing BlokDataHandler two-pass hierarchy builder.
    const blokData =
      dataTransfer.getData(this.MIME_TYPE) ||
      this.readNotionBlocksV3(dataTransfer) ||
      this.readNextSpaceBlocks(dataTransfer);

    // Route to handlers based on data type
    const handled = await this.routeToHandlers(dataTransfer, plainData, rawHtmlData, blokData, pasteTarget);

    if (handled) {
      return;
    }

    // Fallback: process as plain text
    await this.processAsText(plainData);
  }

  /**
   * Read Notion's `text/_notion-blocks-v3-production` clipboard flavour and
   * translate it into the Blok clipboard JSON shape, or return '' when it is
   * absent / unparseable (so the caller falls back to the HTML path).
   */
  private readNotionBlocksV3(dataTransfer: DataTransfer): string {
    const raw = dataTransfer.getData(NOTION_BLOCKS_V3_MIME);

    if (!raw) {
      return '';
    }

    const parsed = parseNotionBlocksV3(raw);

    if (parsed === null || parsed.length === 0) {
      return '';
    }

    return JSON.stringify(parsed);
  }

  /**
   * Read buildin.ai's `text/next-space-blocks` / `text/next-space-content`
   * clipboard flavours and translate them into the Blok clipboard JSON shape,
   * or return '' when absent / unparseable (so the caller falls back to HTML).
   */
  private readNextSpaceBlocks(dataTransfer: DataTransfer): string {
    for (const mime of NEXT_SPACE_MIMES) {
      const raw = dataTransfer.getData(mime);

      if (!raw) {
        continue;
      }

      const parsed = parseNextSpaceBlocks(raw);

      if (parsed !== null && parsed.length > 0) {
        return JSON.stringify(parsed);
      }
    }

    return '';
  }

  /**
   * Route paste data to handlers in priority order.
   */
  private async routeToHandlers(
    dataTransfer: DataTransfer,
    plainData: string,
    rawHtmlData: string,
    blokData: string,
    pasteTarget?: Element
  ): Promise<boolean> {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    const canReplaceCurrentBlock = Boolean(
      currentBlock &&
      currentBlock.tool.isDefault &&
      currentBlock.isEmpty &&
      !currentBlock.holder?.closest('[data-blok-table-cell-blocks]')
    );

    const context: HandlerContext = {
      canReplaceCurrentBlock,
      currentBlock: currentBlock ?? undefined,
      plainData,
      pasteTarget,
    };

    // Try handlers in priority order
    for (const handler of this.handlers) {
      const dataToCheck = this.getDataForHandler(handler, dataTransfer, plainData, rawHtmlData, blokData);

      if (dataToCheck === undefined) {
        continue;
      }

      const priority = handler.canHandle(dataToCheck);

      if (priority === 0) {
        continue;
      }

      const handled = await handler.handle(dataToCheck, context);

      if (handled) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the appropriate data for each handler type.
   */
  private getDataForHandler(
    handler: PasteHandler,
    dataTransfer: DataTransfer,
    plainData: string,
    rawHtmlData: string,
    blokData: string
  ): unknown {
    if (handler instanceof BlokDataHandler) {
      return blokData;
    }

    if (handler instanceof TableCellsHandler) {
      return rawHtmlData;
    }

    if (handler instanceof FilesHandler) {
      return dataTransfer;
    }

    if (handler instanceof PatternHandler) {
      return plainData;
    }

    if (handler instanceof MarkdownHandler) {
      return plainData;
    }

    if (handler instanceof TextHandler) {
      return plainData;
    }

    if (!(handler instanceof HtmlHandler)) {
      return undefined;
    }

    // Build sanitize config first
    const toolsTags = this.sanitizerBuilder.buildToolsTagsConfig(this.toolRegistry.toolsTags);
    const inlineSanitizeConfig = this.Blok.Tools.getAllInlineToolsSanitizeConfig();
    const structuralTagsConfig = Object.fromEntries(
      [...SAFE_STRUCTURAL_TAGS].map((tag) => [tag, {}])
    ) as SanitizerConfig;
    const customConfig = composeSanitizerConfig(
      this.config.sanitizer as SanitizerConfig,
      structuralTagsConfig,
      toolsTags,
      inlineSanitizeConfig,
      { br: {} }
    );

    const preprocessed = preprocessNotionHtml(preprocessGoogleDocsHtml(rawHtmlData));
    const cleanData = clean(preprocessed, customConfig);
    const cleanDataIsHtml = dom$.isHTMLString(cleanData);
    const shouldProcessAsPlain = !cleanData.trim() || (cleanData.trim() === plainData || !cleanDataIsHtml);

    return shouldProcessAsPlain ? undefined : cleanData;
  }

  /**
   * Process plain text as fallback.
   */
  private async processAsText(plainData: string): Promise<void> {
    const { BlockManager } = this.Blok;

    if (!plainData) {
      return;
    }

    const currentBlock = BlockManager.currentBlock;
    const canReplaceCurrentBlock = Boolean(
      currentBlock &&
      currentBlock.tool.isDefault &&
      currentBlock.isEmpty
    );

    const textHandler = this.handlers.find((h): h is TextHandler => h instanceof TextHandler);

    if (textHandler) {
      await textHandler.handle(plainData, {
        canReplaceCurrentBlock,
        currentBlock: currentBlock ?? undefined,
      });
    }
  }

  /**
   * Set onPaste callback handler.
   */
  private setCallback(): void {
    const holder = this.Blok.UI.nodes.holder;

    this.listeners.on(holder, 'paste', this.handlePasteEventWrapper);
    this.listeners.on(holder, 'keydown', this.handleShiftStateWrapper);
    this.listeners.on(holder, 'keyup', this.handleShiftStateWrapper);
    this.listeners.on(holder, 'drop', this.handleDropEventWrapper);
    this.listeners.on(holder, 'dragover', this.handleDragOverEventWrapper);
    this.listeners.on(holder, 'dragleave', this.handleDragLeaveEventWrapper);
  }

  /**
   * Unset onPaste callback handler.
   */
  private unsetCallback(): void {
    const holder = this.Blok.UI.nodes.holder;

    this.listeners.off(holder, 'paste', this.handlePasteEventWrapper);
    this.listeners.off(holder, 'keydown', this.handleShiftStateWrapper);
    this.listeners.off(holder, 'keyup', this.handleShiftStateWrapper);
    this.listeners.off(holder, 'drop', this.handleDropEventWrapper);
    this.listeners.off(holder, 'dragover', this.handleDragOverEventWrapper);
    this.listeners.off(holder, 'dragleave', this.handleDragLeaveEventWrapper);
  }

  /**
   * Wrapper handler for paste event that matches listeners.on signature.
   */
  private handlePasteEventWrapper = (event: Event): void => {
    void this.handlePasteEvent(event as ClipboardEvent);
  };

  /**
   * Track whether Shift is currently held so a following paste can route to
   * the raw plain-text path. Reading shiftKey on both keydown and keyup keeps
   * the flag in sync as the modifier is pressed and released.
   */
  private handleShiftStateWrapper = (event: Event): void => {
    this.isShiftHeld = (event as KeyboardEvent).shiftKey;
  };

  private handleDropEventWrapper = (event: Event): void => {
    void this.handleDropEvent(event as DragEvent);
  };

  private handleDragOverEventWrapper = (event: Event): void => {
    this.handleDragOverEvent(event as DragEvent);
  };

  private handleDragLeaveEventWrapper = (event: Event): void => {
    this.handleDragLeaveEvent(event as DragEvent);
  };

  private dataTransferHasFiles(dataTransfer: DataTransfer | null | undefined): boolean {
    if (!dataTransfer) {
      return false;
    }

    const types = Array.from(dataTransfer.types ?? []);

    if (types.includes('Files')) {
      return true;
    }

    return Boolean(dataTransfer.files?.length);
  }

  private dropIndicatorHolder: HTMLElement | null = null;

  private handleDragOverEvent = (event: DragEvent): void => {
    const { dataTransfer } = event;

    if (!this.dataTransferHasFiles(dataTransfer)) {
      return;
    }

    event.preventDefault();

    if (dataTransfer) {
      dataTransfer.dropEffect = 'copy';
    }

    this.updateDropIndicator(event);
  };

  private updateDropIndicator(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const blockHolder = target?.closest('[data-blok-element]');

    if (!(blockHolder instanceof HTMLElement)) {
      this.clearDropIndicator();

      return;
    }

    const rect = blockHolder.getBoundingClientRect();
    const edge = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';

    if (this.dropIndicatorHolder && this.dropIndicatorHolder !== blockHolder) {
      this.dropIndicatorHolder.removeAttribute('data-drop-indicator');
      this.dropIndicatorHolder.style.removeProperty('--drop-indicator-depth');
    }

    blockHolder.setAttribute('data-drop-indicator', edge);
    blockHolder.style.setProperty('--drop-indicator-depth', String(this.computeDropDepth(blockHolder)));
    this.dropIndicatorHolder = blockHolder;
  }

  private computeDropDepth(blockHolder: HTMLElement): number {
    const ancestorBlocks = blockHolder.parentElement?.closest('[data-blok-element]')
      ? this.countAncestorBlocks(blockHolder)
      : 0;

    const listWrapper = blockHolder.querySelector('[data-list-depth]');
    const listDepthRaw = listWrapper?.getAttribute('data-list-depth') ?? '0';
    const listDepth = Number.parseInt(listDepthRaw, 10);
    const listContribution = Number.isNaN(listDepth) ? 0 : listDepth;

    return ancestorBlocks + listContribution;
  }

  private countAncestorBlocks(blockHolder: HTMLElement): number {
    const parent = blockHolder.parentElement?.closest('[data-blok-element]') as HTMLElement | null;

    if (!parent) {
      return 0;
    }

    return 1 + this.countAncestorBlocks(parent);
  }

  private clearDropIndicator(): void {
    if (this.dropIndicatorHolder) {
      this.dropIndicatorHolder.removeAttribute('data-drop-indicator');
      this.dropIndicatorHolder.style.removeProperty('--drop-indicator-depth');
      this.dropIndicatorHolder = null;
    }
  }

  private handleDragLeaveEvent = (event: DragEvent): void => {
    const holder = this.Blok.UI.nodes.holder;
    const related = event.relatedTarget as Node | null;

    if (related && holder.contains(related)) {
      return;
    }

    this.clearDropIndicator();
  };

  private handleDropEvent = async (event: DragEvent): Promise<void> => {
    this.clearDropIndicator();

    if (this.Blok.DragManager?.isDragging) {
      return;
    }

    if (!this.dataTransferHasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();

    const { BlockManager, Toolbar } = this.Blok;
    const currentBlock = BlockManager.setCurrentBlockByChildNode(event.target as HTMLElement);

    if (!currentBlock) {
      return;
    }

    if (this.toolRegistry.isException(currentBlock.name)) {
      return;
    }

    if (event.dataTransfer) {
      const dropTarget = event.target instanceof Element ? event.target : undefined;

      await this.processDataTransfer(event.dataTransfer, dropTarget);
    }

    Toolbar.moveAndOpen();
  };

  /**
   * Check if browser behavior suits better.
   */
  private isNativeBehaviour(element: EventTarget): boolean {
    return dom$.isNativeInput(element) ||
      (element instanceof HTMLElement && (
        element.contentEditable === 'plaintext-only' ||
        element.getAttribute('contenteditable') === 'plaintext-only'
      ));
  }

  /**
   * Check if Blok should process pasted data and pass data transfer object to handler.
   */
  private handlePasteEvent = async (event: ClipboardEvent): Promise<void> => {
    /**
     * If the event was already handled (e.g., by the table grid paste listener),
     * skip processing to prevent duplicate content insertion.
     */
    if (event.defaultPrevented) {
      return;
    }

    /**
     * Layer 20: paste-during-drag bail (regression: wrong-block-dropped family).
     *
     * DragController captures live Block references when the drag starts and
     * commits them in `handleDrop` on mouseup. A paste firing mid-drag would
     * call `BlockManager.paste` / `insert` / `convertToTool`, any of which
     * reshuffles the flat blocks array under DragController's feet — the
     * resulting indices are stale and a later move() silently drops an
     * unrelated block. Mirrors the Cmd+Z-during-drag guard in
     * uiControllers/controllers/keyboard.ts handleZ.
     *
     * Swallow the paste so the drag completes cleanly; the user can paste
     * after releasing the mouse.
     */
    if (this.Blok.DragManager?.isDragging) {
      event.preventDefault();

      return;
    }

    const { BlockManager, Toolbar } = this.Blok;

    const currentBlock = BlockManager.setCurrentBlockByChildNode(event.target as HTMLElement);

    if (
      !currentBlock ||
      (event.target && this.isNativeBehaviour(event.target) && event.clipboardData && !event.clipboardData.types.includes('Files'))
    ) {
      return;
    }

    if (this.toolRegistry.isException(currentBlock.name)) {
      return;
    }

    event.preventDefault();

    if (event.clipboardData) {
      const pasteTarget = event.target instanceof Element ? event.target : undefined;

      // Cmd/Ctrl+Shift+V (paste without formatting): insert the clipboard's
      // raw text/plain payload, skipping the markdown/HTML→blocks conversion
      // that processDataTransfer would otherwise apply.
      if (this.isShiftHeld) {
        await this.processAsText(event.clipboardData.getData('text/plain'));
      } else {
        await this.processDataTransfer(event.clipboardData, pasteTarget);
      }
    }

    Toolbar.moveAndOpen();
  };
}
