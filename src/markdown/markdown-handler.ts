import type { BlokModules } from '../types-internal/blok-modules';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { SanitizerConfigBuilder } from '../components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../components/modules/paste/tool-registry';
import type { HandlerContext } from '../components/modules/paste/types';
import type { PasteHandler } from '../components/modules/paste/handlers/base';
import { BasePasteHandler } from '../components/modules/paste/handlers/base';
import { Block } from '../components/block';
import { normalizeTableChildParents } from '../components/utils/data-model-transform';
import { getRestrictedTools, isInsideTableCell } from '../tools/table/table-restrictions';
import type { InternalMarkdownImportConfig } from './types';

/**
 * Patterns that indicate text is likely Markdown rather than plain text.
 * Each must be unlikely to appear in normal prose.
 */
const MARKDOWN_SIGNALS: RegExp[] = [
  /^#{1,6}\s/m,                   // ATX headings: # Heading
  /^```/m,                         // Fenced code blocks
  /\|\s*---/,                      // GFM table separator: | --- |
  /^- \[[ x]\]/m,                  // Task list items: - [ ] or - [x]
  /^[ \t]*[-*+][ \t]+\S/m,         // Unordered list item: - / * / + marker + content
  /^[ \t]*\d{1,9}[.)][ \t]+\S/m,  // Ordered list item: 1. / 1) marker + content
  /^ {0,3}> \S/m,                  // Blockquote: `> text` (a space then content, so `->`/`=>`/`>>>` never match)
  // Link text excludes `[`/`]` and the URL excludes `[` so neither scan can
  // run past the next candidate start: `/\[.+?\]\(.+?\)/` retried from every
  // `[` and froze the tab on hostile paste. Costs link text containing
  // brackets — a signal, not a parser.
  /\[[^\][\n]+\]\([^)[\n]+\)/,   // Markdown links: [text](url)
  /\*\*.+?\*\*/,                   // Bold: **text**
  /!\[/,                           // Image: ![
  /\$\$[\s\S]+?\$\$/,             // Block math: $$...$$
  /(?<!\$)\$(?!\$)(?=\S)[^$]+(?<=\S)\$(?!\$)/, // Inline math: $...$
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
 * Uses BlockManager.insertMany() to insert converted blocks directly
 * (one insert per block inside a table cell, so the table can claim them),
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

    const rawOutputBlocks = await this.convert(data);

    if (rawOutputBlocks === null || !rawOutputBlocks.length) {
      return false;
    }

    const { BlockManager, Caret } = this.Blok;

    // Inline markdown fragment pasted mid-text: a single-line input that
    // converts to exactly one paragraph block is INLINE content (e.g.
    // `**bold**`, `[text](url)`), not a block. When the caret sits inside a
    // NON-EMPTY block, Notion merges the converted rich text at the caret
    // instead of dropping a sibling paragraph below. Block-level markdown
    // (headings, lists, code, multi-line) keeps converting to blocks.
    const currentBlock = BlockManager.currentBlock;
    const isSingleLine = !/\r?\n/.test(data);
    const convertsToInlineParagraph = rawOutputBlocks.length === 1 && rawOutputBlocks[0].type === 'paragraph';

    if (
      isSingleLine &&
      convertsToInlineParagraph &&
      currentBlock !== undefined &&
      !currentBlock.isEmpty &&
      currentBlock.currentInput != null
    ) {
      const text = (rawOutputBlocks[0].data as { text?: string }).text ?? '';
      const content = document.createElement('div');

      content.innerHTML = text;

      const event = this.composePasteEvent('tag', { data: content });

      await this.processInlinePaste(
        { content, tool: rawOutputBlocks[0].type, isBlock: false, event },
        false
      );

      return true;
    }

    // Defense-in-depth: backfill `parent` on table cell children so that any
    // future regression in mdast-to-blocks (or external converter) cannot
    // produce the dodopizza shape (children referenced by table cells but
    // lacking explicit parent), which would render them at page bottom.
    const outputBlocks = normalizeTableChildParents(rawOutputBlocks);

    // Container membership: when the caret sits inside a container child (e.g. a
    // callout/toggle body) the converted top-level blocks must stay inside that
    // container instead of ejecting to the root. Mirrors BasePasteHandler's
    // contextParentId capture. The container itself is NOT part of the inserted
    // set, so we reparent AFTER insertMany via setBlockParent (insertMany would
    // otherwise clear a parentId that points outside its input).
    const childContainer = currentBlock?.holder?.querySelector('[data-blok-toggle-children]') ?? null;
    const isInContainerTitle = childContainer !== null &&
      !childContainer.contains(currentBlock?.currentInput ?? null);

    const table = currentBlock !== undefined ? this.enclosingCellTable(currentBlock) : undefined;
    const restricted = new Set(getRestrictedTools());
    // A tool barred from cells sends the whole batch out of the table, right
    // after its subtree, as BasePasteHandler.redirectToTableParentIfNeeded does.
    const redirectTable = table !== undefined && outputBlocks.some(block => restricted.has(block.type)) ? table : undefined;

    if (currentBlock !== undefined && table !== undefined && redirectTable === undefined
      && currentBlock.parentId === table.id && !isInContainerTitle) {
      await this.insertIntoCell(outputBlocks, currentBlock);

      return true;
    }

    // Replace empty default block if present
    const shouldReplace = redirectTable === undefined && context.canReplaceCurrentBlock && currentBlock !== undefined && currentBlock.isEmpty;
    const nextIndex = redirectTable !== undefined ? this.indexAfterSubtree(redirectTable) : BlockManager.currentBlockIndex + 1;
    const insertIndex = shouldReplace ? BlockManager.currentBlockIndex : nextIndex;
    const caretParentId = isInContainerTitle
      ? (currentBlock?.id ?? null)
      : (currentBlock?.parentId ?? null);
    const contextParentId = redirectTable !== undefined ? redirectTable.parentId : caretParentId;

    // Compose Block instances from OutputBlockData
    const composed = outputBlocks.map(({ id, type, data: blockData, parent }) => ({
      block: BlockManager.composeBlock({
        id,
        tool: type,
        data: blockData,
        parentId: parent,
        // Markdown import materialises a document the caller already wrote —
        // its containers arrive with their children, so none may self-seed.
        origin: 'paste',
      }),
      hasParent: parent !== undefined && parent !== null,
    }));
    const blocksToInsert = composed.map(({ block }) => block);

    // yjsSync 'add': markdown lands in a LIVE document, and the default
    // 'replace' reloads the doc from this batch alone, dropping every block
    // around it from Yjs while the in-memory store still reads correctly.
    BlockManager.insertMany(blocksToInsert, insertIndex, { yjsSync: 'add' });

    // Reparent every top-level produced block into the surrounding container so
    // the paste stays nested (hierarchical children like table cells already
    // carry their own parent and are left untouched).
    for (const { block, hasParent } of composed) {
      if (contextParentId === null || hasParent) {
        continue;
      }

      BlockManager.setBlockParent(block, contextParentId);
    }

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

  /**
   * The nearest table above `block` when `block` sits in one of its cells.
   * @param block - the caret block
   */
  private enclosingCellTable(block: Block): Block | undefined {
    if (block.parentId == null || !isInsideTableCell(block)) {
      return undefined;
    }

    const { BlockManager } = this.Blok;
    const walk = (parentId: string | null): Block | undefined => {
      const parent = parentId !== null ? BlockManager.getBlockById(parentId) : undefined;

      return parent === undefined || parent.name === 'table' ? parent : walk(parent.parentId);
    };

    return walk(block.parentId);
  }

  /**
   * Flat index right after `block` and all its descendants.
   * @param block - the subtree root
   */
  private indexAfterSubtree(block: Block): number {
    const { BlockManager } = this.Blok;
    const isUnder = (candidate: Block): boolean => {
      const parent = candidate.parentId !== null ? BlockManager.getBlockById(candidate.parentId) : undefined;

      return parent !== undefined && (parent === block || isUnder(parent));
    };
    const blocks = BlockManager.blocks;
    const start = BlockManager.getBlockIndex(block) + 1;
    const offset = blocks.slice(start).findIndex(candidate => !isUnder(candidate));

    return offset === -1 ? blocks.length : start + offset;
  }

  /**
   * Insert the batch into the caret's table cell, after the caret block.
   * Top-level blocks go in by index so the table claims them into that cell
   * from the block-added event — insertMany fires none, and a later
   * setBlockParent to the table would mount them in the FIRST cell.
   * @param outputBlocks - the converted batch, in flat document order
   * @param caretBlock - the cell block the caret is in
   */
  private async insertIntoCell(outputBlocks: OutputBlockData[], caretBlock: Block): Promise<void> {
    const { BlockManager, Caret } = this.Blok;
    const inserted: Block[] = [];

    await this.inOneUndoGroup(async () => {
      const start = this.indexAfterSubtree(caretBlock);

      for (const { id, type, data: blockData, parent } of outputBlocks) {
        const parentId = typeof parent === 'string' ? parent : null;
        const afterId = parentId === null
          ? null
          : ([...inserted].reverse().find(block => block.parentId === parentId)?.id ?? null);

        inserted.push(parentId === null
          ? BlockManager.insert({ id, tool: type, data: blockData, index: start + inserted.length, needToFocus: false, origin: 'paste' })
          : BlockManager.insert({ id, tool: type, data: blockData, placement: { parentId, afterId }, needToFocus: false, origin: 'paste' }));
      }
    });

    const lastBlock = inserted[inserted.length - 1];

    if (lastBlock !== undefined) {
      Caret.setToBlock(lastBlock, Caret.positions.END);
    }
  }

  /**
   * Convert, or return null so `handle` DECLINES the paste. A throw here (bad
   * markdown, failed chunk load) must not escape routeToHandlers — otherwise
   * the pipeline never reaches TextHandler and the paste silently does
   * nothing. Only conversion is guarded: a throw after insertMany must not
   * report false and get re-pasted as plain text on top of the inserted blocks.
   */
  private async convert(data: string): Promise<OutputBlockData[] | null> {
    try {
      const { markdownToBlocks } = await import('./index');

      // A line break the user pasted is one they can see; keep it.
      const config: InternalMarkdownImportConfig = { softBreaks: true };

      return await markdownToBlocks(data, config);
    } catch (e) {
      console.warn('MarkdownHandler: markdown conversion failed, falling back to plain text', e);

      return null;
    }
  }
}
