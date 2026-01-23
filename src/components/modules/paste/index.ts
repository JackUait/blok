import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';
import { Module } from '../../__module';
import { Dom as dom$ } from '../../dom';
import { composeSanitizerConfig, clean } from '../../utils/sanitizer';

import type { PasteHandler } from './handlers/base';
import { BlokDataHandler } from './handlers/blok-data-handler';
import { FilesHandler } from './handlers/files-handler';
import { HtmlHandler } from './handlers/html-handler';
import { PatternHandler } from './handlers/pattern-handler';
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
   * Set onPaste callback and collect tools' paste configurations.
   */
  public async prepare(): Promise<void> {
    const { Tools } = this.Blok;

    this.toolRegistry = new ToolRegistry(Tools.blockTools, this.config);
    this.sanitizerBuilder = new SanitizerConfigBuilder(Tools.blockTools, this.config);

    await this.toolRegistry.processTools();

    // Initialize handlers in priority order (higher priority first)
    this.handlers = [
      new BlokDataHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder, this.config),
      new FilesHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder),
      new PatternHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder),
      new HtmlHandler(this.Blok, this.toolRegistry, this.sanitizerBuilder),
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
  public async processDataTransfer(dataTransfer: DataTransfer): Promise<void> {
    const blokData = dataTransfer.getData(this.MIME_TYPE);
    const plainData = dataTransfer.getData('text/plain');
    const rawHtmlData = dataTransfer.getData('text/html');

    // Route to handlers based on data type
    const handled = await this.routeToHandlers(dataTransfer, plainData, rawHtmlData, blokData);

    if (handled) {
      return;
    }

    // Fallback: process as plain text
    await this.processAsText(plainData);
  }

  /**
   * Route paste data to handlers in priority order.
   */
  private async routeToHandlers(
    dataTransfer: DataTransfer,
    plainData: string,
    rawHtmlData: string,
    blokData: string
  ): Promise<boolean> {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    const canReplaceCurrentBlock = Boolean(
      currentBlock &&
      currentBlock.tool.isDefault &&
      currentBlock.isEmpty
    );

    const context: HandlerContext = {
      canReplaceCurrentBlock,
      currentBlock: currentBlock ?? undefined,
      plainData,
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

    if (handler instanceof FilesHandler) {
      return dataTransfer;
    }

    if (handler instanceof PatternHandler) {
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
    const customConfig = composeSanitizerConfig(
      this.config.sanitizer as SanitizerConfig,
      toolsTags,
      inlineSanitizeConfig,
      { br: {} }
    );

    const cleanData = clean(rawHtmlData, customConfig);
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
    this.listeners.on(this.Blok.UI.nodes.holder, 'paste', this.handlePasteEventWrapper);
  }

  /**
   * Unset onPaste callback handler.
   */
  private unsetCallback(): void {
    this.listeners.off(this.Blok.UI.nodes.holder, 'paste', this.handlePasteEventWrapper);
  }

  /**
   * Wrapper handler for paste event that matches listeners.on signature.
   */
  private handlePasteEventWrapper = (event: Event): void => {
    void this.handlePasteEvent(event as ClipboardEvent);
  };

  /**
   * Check if browser behavior suits better.
   */
  private isNativeBehaviour(element: EventTarget): boolean {
    return dom$.isNativeInput(element);
  }

  /**
   * Check if Blok should process pasted data and pass data transfer object to handler.
   */
  private handlePasteEvent = async (event: ClipboardEvent): Promise<void> => {
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
      await this.processDataTransfer(event.clipboardData);
    }

    Toolbar.close();
  };
}
