import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';
import type { BlokConfig } from '../../../../types';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { Dom as dom$ } from '../../dom';
import { composeSanitizerConfig, clean } from '../../utils/sanitizer';
import { normalizeInlineMarkupHtml } from '../../utils/inline-normalization';
import { preservePageReferenceAnchor } from '../../../shared/page-reference';

import { BLOK_MIME_TYPE, NEXT_SPACE_MIMES, NOTION_BLOCKS_V3_MIME, SAFE_STRUCTURAL_TAGS } from './constants';
import { preprocessPastedHtml } from './preprocess-pasted-html';
import { parseNotionBlocksV3 } from './notion-blocks-v3';
import { parseNextSpaceBlocks } from './next-space-blocks';
import type { PasteHandler } from './handlers/base';
import { BlokDataHandler } from './handlers/blok-data-handler';
import { FilesHandler } from './handlers/files-handler';
import { HtmlHandler } from './handlers/html-handler';
import { MarkdownHandler } from '../../../markdown/markdown-handler';
import { PatternHandler } from './handlers/pattern-handler';
import { TableCellsHandler } from './handlers/table-cells-handler';
import { TextHandler } from './handlers/text-handler';
import { SanitizerConfigBuilder } from './sanitizer-config';
import type { ToolRegistry } from './tool-registry';
import type { HandlerContext } from './types';
import { pasteHtmlAsBlocks } from './html-import';

/**
 * The paste pipeline: handlers, preprocessors and importers. The Paste module
 * loads it on the first paste, so an editor that never pastes never downloads it.
 */
export class PasteEngine {
  private readonly sanitizerBuilder: SanitizerConfigBuilder;
  private readonly handlers: PasteHandler[];

  constructor(
    private readonly Blok: BlokModules,
    private readonly config: BlokConfig,
    private readonly toolRegistry: ToolRegistry
  ) {
    this.sanitizerBuilder = new SanitizerConfigBuilder(Blok.Tools.blockTools, config);

    // Initialize handlers in priority order (higher priority first).
    // HtmlHandler (40) must precede MarkdownHandler (30): rich clipboards such
    // as Notion ship both a faithful text/html payload and a lossy markdown
    // text/plain twin, and routing picks the first eligible handler in this
    // list. Trying HTML first keeps images, links and other structure that the
    // markdown twin drops; markdown still wins when no usable HTML is present.
    this.handlers = [
      new BlokDataHandler(Blok, toolRegistry, this.sanitizerBuilder, config),
      new TableCellsHandler(Blok, toolRegistry, this.sanitizerBuilder),
      new FilesHandler(Blok, toolRegistry, this.sanitizerBuilder),
      new PatternHandler(Blok, toolRegistry, this.sanitizerBuilder, config),
      new HtmlHandler(Blok, toolRegistry, this.sanitizerBuilder, config),
      new MarkdownHandler(Blok, toolRegistry, this.sanitizerBuilder),
      new TextHandler(Blok, toolRegistry, this.sanitizerBuilder, config),
    ];
  }

  /**
   * Closes the link paste menu if it is still open.
   */
  public destroy(): void {
    this.handlers.forEach(handler => handler.destroy?.());
  }

  /**
   * Process text data. Used by API.renderFromHTML().
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
   * The blocks a paste of `html` gives, without touching this editor.
   * @param html - the HTML to paste
   */
  public blocksFromHtml(html: string): Promise<OutputBlockData[]> {
    return pasteHtmlAsBlocks(this.config, html);
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
      dataTransfer.getData(BLOK_MIME_TYPE) ||
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
   * Process plain text as fallback.
   */
  public async processAsText(plainData: string): Promise<void> {
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
   * Read Notion's `text/_notion-blocks-v3-production` clipboard flavour and
   * translate it into the Blok clipboard JSON shape, or return '' when it is
   * absent / unparseable (so the caller falls back to the HTML path).
   */
  private readNotionBlocksV3(dataTransfer: DataTransfer): string {
    const raw = dataTransfer.getData(NOTION_BLOCKS_V3_MIME);

    if (!raw) {
      return '';
    }

    const parsed = parseNotionBlocksV3(raw, tool => this.Blok.Tools.blockTools.has(tool));

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
    );
    /**
     * The whole-document first pass must always keep structural tags and tool
     * substitution tags — they exist so tools can receive their elements later
     * in the pipeline. Passing the user's global sanitizer as the compose base
     * would drop every tag it doesn't mention (tables, headers, lists), so we
     * compose from an empty base and append the user's config last: its rules
     * still win for the tags it does specify.
     */
    const customConfig = composeSanitizerConfig(
      {},
      structuralTagsConfig,
      toolsTags,
      inlineSanitizeConfig,
      { a: preservePageReferenceAnchor, br: {} },
      this.config.sanitizer as SanitizerConfig
    );

    const preprocessed = preprocessPastedHtml(rawHtmlData);
    /**
     * Clipboard sources describe formatting run by run, so pasted markup
     * arrives fragmented no matter which app it came from. Collapse it here,
     * after sanitization has settled which tags and attributes survive —
     * two wrappers only become interchangeable once that is decided.
     */
    /**
     * `clean()` allowlists the href/src ATTRIBUTE but never inspects its scheme,
     * so a pasted `javascript:` link would otherwise arrive as a live anchor.
     */
    const cleanData = normalizeInlineMarkupHtml(clean(preprocessed, customConfig));
    const cleanDataIsHtml = dom$.isHTMLString(cleanData);
    const shouldProcessAsPlain = !cleanData.trim() || (cleanData.trim() === plainData || !cleanDataIsHtml);

    return shouldProcessAsPlain ? undefined : cleanData;
  }
}
