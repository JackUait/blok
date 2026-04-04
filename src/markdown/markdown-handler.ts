import type { BlockToolData } from '../../types';
import type { BlokModules } from '../types-internal/blok-modules';
import type { SanitizerConfigBuilder } from '../components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../components/modules/paste/tool-registry';
import type { HandlerContext } from '../components/modules/paste/types';
import type { PasteHandler } from '../components/modules/paste/handlers/base';
import { BasePasteHandler } from '../components/modules/paste/handlers/base';
import { Block } from '../components/block';

/**
 * Patterns that indicate text is likely Markdown rather than plain text.
 * Each must be unlikely to appear in normal prose.
 */
const MARKDOWN_SIGNALS: RegExp[] = [
  /^#{1,6}\s/m,                   // ATX headings: # Heading
  /^```/m,                         // Fenced code blocks
  /\|\s*---/,                      // GFM table separator: | --- |
  /^- \[[ x]\]/m,                  // Task list items: - [ ] or - [x]
  /\[.+?\]\(.+?\)/,               // Markdown links: [text](url)
  /\*\*.+?\*\*/,                   // Bold: **text**
  /!\[/,                           // Image: ![
];

/**
 * Check if a plain-text string contains strong Markdown signals.
 */
export function hasMarkdownSignals(text: string): boolean {
  if (!text) {
    return false;
  }

  return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text));
}

/**
 * Paste handler that detects and converts Markdown text.
 * Priority 30: between TextHandler (10) and HtmlHandler (40).
 * Lazy-loads the converter on first use.
 *
 * Uses BlockManager.insertMany() to insert converted blocks directly,
 * preserving all block data (list depth, table cells, etc.) that
 * would be lost if mapped through the DOM-based paste pipeline.
 */
export class MarkdownHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string' || !data.trim()) {
      return 0;
    }

    return hasMarkdownSignals(data) ? 30 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const { markdownToBlocks } = await import('./index');
    const outputBlocks = markdownToBlocks(data);

    if (!outputBlocks.length) {
      return false;
    }

    const { BlockManager, Caret } = this.Blok;

    // Replace empty default block if present
    const currentBlock = BlockManager.currentBlock;
    const shouldReplace = context.canReplaceCurrentBlock && currentBlock !== undefined && currentBlock.isEmpty;
    const insertIndex = shouldReplace
      ? BlockManager.currentBlockIndex
      : BlockManager.currentBlockIndex + 1;

    // Compose Block instances from OutputBlockData
    const blocksToInsert = outputBlocks.map(({ id, type, data: blockData, parent }) =>
      BlockManager.composeBlock({
        id,
        tool: type,
        data: blockData as BlockToolData,
        parentId: parent,
      })
    );

    BlockManager.insertMany(blocksToInsert, insertIndex);

    // Remove the replaced empty block
    if (shouldReplace && currentBlock !== undefined) {
      await BlockManager.removeBlock(currentBlock, false);
    }

    // Set caret to end of last inserted block
    const lastBlock = blocksToInsert[blocksToInsert.length - 1];

    if (lastBlock instanceof Block) {
      Caret.setToBlock(lastBlock, Caret.positions.END);
    }

    return true;
  }
}
