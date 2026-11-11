import type { PasteEvent, PasteEventDetail } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { protectPageReferenceAnchor } from '../../../../shared/page-reference';
import { protectAnnotationSpan } from '../../../../shared/inline-text-sanitize';
import { getRestrictedTools } from '../../../../tools/table/table-restrictions';
import { Dom } from '../../../dom';
import { SelectionUtils } from '../../../selection/index';
import { clean } from '../../../utils/sanitizer';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PasteData } from '../types';

/**
 * Paste Handler interface.
 * All paste handlers implement this interface.
 */
export interface PasteHandler {
  /**
   * Check if this handler can process the given data.
   * @returns Priority score (higher = more specific). Return 0 to skip.
   */
  canHandle(data: unknown): number;

  /**
   * Process the data and insert blocks.
   * @returns true if handled, false otherwise
   */
  handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Releases anything the handler left open, such as a menu.
   */
  destroy?(): void;
}

/**
 * Base class for all paste handlers.
 * Provides common functionality for handlers.
 */
export abstract class BasePasteHandler implements PasteHandler {
  constructor(
    protected readonly Blok: BlokModules,
    protected readonly toolRegistry: ToolRegistry,
    protected readonly sanitizerBuilder: SanitizerConfigBuilder
  ) {}

  abstract canHandle(data: unknown): number;
  abstract handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Compose a paste event with the given type and detail.
   */
  protected composePasteEvent(type: string, detail: PasteEventDetail): PasteEvent {
    return new CustomEvent(type, {
      detail,
    }) as PasteEvent;
  }

  /**
   * Determine if current block should be replaced.
   */
  protected shouldReplaceCurrentBlock(toolName?: string): boolean {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (toolName && currentBlock.name === toolName) {
      return true;
    }

    const isCurrentBlockDefault = Boolean(currentBlock.tool.isDefault);

    return isCurrentBlockDefault && currentBlock.isEmpty;
  }

  /**
   * If we're inside a table cell and any pasted item uses a tool that can't
   * be nested in table cells (e.g. table, header), redirect the insertion
   * point to the parent table block. This prevents new block DOM elements
   * from being placed inside the existing table's grid structure, which
   * would corrupt the table's saved data.
   * @returns true when the insertion point moved to the table
   */
  private redirectToTableParentIfNeeded(data: PasteData[], BlockManager: BlokModules['BlockManager']): boolean {
    const currentBlock = BlockManager.currentBlock;
    const isInsideTableCell = currentBlock?.holder?.closest('[data-blok-table-cell-blocks]');
    const restricted = new Set(getRestrictedTools());
    const hasRestrictedTools = data.some(item => restricted.has(item.tool));

    if (!isInsideTableCell || !hasRestrictedTools || currentBlock === undefined) {
      return false;
    }

    const tableBlockHolder = currentBlock.holder
      .closest('[data-blok-tool="table"]')
      ?.closest('[data-blok-element]') as HTMLElement | null;

    if (!tableBlockHolder) {
      return false;
    }

    BlockManager.setCurrentBlockByChildNode(tableBlockHolder);

    return true;
  }

  /**
   * Whether the caret sits in a container's title: the block owns a
   * [data-blok-toggle-children] region and the caret is outside it.
   */
  protected caretIsInContainerTitle(): boolean {
    const currentBlock = this.Blok.BlockManager.currentBlock;
    const childContainer = currentBlock?.holder?.querySelector('[data-blok-toggle-children]') ?? null;

    return childContainer !== null && !childContainer.contains(currentBlock?.currentInput ?? null);
  }

  /**
   * Whether a paste may split the current block at the caret: it has text and
   * an input, and it is neither a container title nor a container child. There
   * the pasted lines belong in the container's children, not in the title.
   */
  protected canSplitAtCaret(): boolean {
    const currentBlock = this.Blok.BlockManager.currentBlock;

    if (!currentBlock || currentBlock.isEmpty || currentBlock.currentInput == null) {
      return false;
    }

    const isInContainerChild = currentBlock.holder?.closest('[data-blok-toggle-children]') != null;

    return !this.caretIsInContainerTitle() && !isInContainerChild;
  }

  /**
   * The one rich text field a tool converts through, like a paragraph's `text`.
   * Only such a tool can take the head of a split or carry its tail.
   * @param toolName - the tool to check
   */
  protected textFieldOf(toolName: string): string | undefined {
    const tool = this.Blok.Tools?.blockTools.get(toolName);
    const conversion = tool?.conversionConfig;
    const field = conversion?.export;

    if (tool === undefined || typeof field !== 'string' || conversion?.import !== field) {
      return undefined;
    }

    const fields = tool.richTextFields;

    return fields.length === 1 && fields[0] === field ? field : undefined;
  }

  /**
   * Whether pasted blocks may split the current block at the caret: the first
   * merges into the text before the caret and the last takes the text after it.
   * Text blocks only, in a contenteditable. The range must
   * sit in that input: the first block's text goes in at the caret, and with no
   * caret there it would be lost.
   * @param firstTool - the first pasted block's tool
   * @param lastTool - the last pasted block's tool
   */
  protected canSplitBlocksAtCaret(firstTool: string, lastTool: string): boolean {
    const currentBlock = this.Blok.BlockManager.currentBlock;
    const input = currentBlock?.currentInput;
    const range = SelectionUtils.range;

    return this.canSplitAtCaret() &&
      currentBlock !== undefined &&
      input != null &&
      !Dom.isNativeInput(input) &&
      range !== null &&
      input.contains(range.startContainer) &&
      input.contains(range.endContainer) &&
      this.textFieldOf(currentBlock.name) !== undefined &&
      this.textFieldOf(firstTool) !== undefined &&
      this.textFieldOf(lastTool) !== undefined;
  }

  /**
   * Insert HTML at the caret, cleaned with the current block's inline rules.
   * Inline-tool rules have no `br`. Keep it, like the block path does: the
   * field's own sanitize still decides on save.
   * @param html - the HTML to insert
   */
  protected insertHtmlAtCaret(html: string): void {
    const { BlockManager, Caret } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (currentBlock === undefined) {
      return;
    }

    const baseConfig = currentBlock.tool.baseSanitizeConfig;
    const anchorRule = baseConfig.a;
    const ordinaryAnchorRule = typeof anchorRule === 'string' ? false : anchorRule ?? false;

    Caret.insertContentAtCaretPosition(clean(html, {
      ...baseConfig,
      a: protectPageReferenceAnchor(ordinaryAnchorRule),
      span: protectAnnotationSpan(baseConfig.span),
      br: {},
    }));
  }

  /**
   * Caret-split for a multi-line plain-text paste into a NON-EMPTY block: extract
   * the current block's post-caret remainder, merge the FIRST pasted line inline at
   * the caret, carry that remainder onto the LAST line, and return the remaining
   * lines (everything after the first) to be inserted as new blocks.
   * @param data - the multi-line paste, one item per line
   */
  private async caretSplitFirstLine(data: PasteData[]): Promise<PasteData[]> {
    const { Caret } = this.Blok;
    const trailingFragment = Caret.extractFragmentFromCaretPosition();

    // First line merges into the current block at the caret.
    await this.processInlinePaste(data[0], false);

    const linesToInsert = data.slice(1);

    // Carry the current block's post-caret remainder onto the last line.
    if (trailingFragment) {
      linesToInsert[linesToInsert.length - 1].content.append(trailingFragment);
    }

    return linesToInsert;
  }

  /**
   * Resolve which pasted lines should be inserted as blocks.
   *
   * - When the first line can merge into the current block at the caret, split
   *   it off and carry the caret remainder onto the tail.
   * - When a newline-prefixed paste has an empty leading segment, drop it.
   * - Otherwise insert every line as-is.
   */
  private async resolveLinesToInsert(
    data: PasteData[],
    canCaretSplit: boolean,
    firstSegmentIsEmpty: boolean
  ): Promise<PasteData[]> {
    if (canCaretSplit) {
      return this.caretSplitFirstLine(data);
    }

    if (firstSegmentIsEmpty) {
      return data.slice(1);
    }

    return data;
  }

  /**
   * Run `fn` as one undo group held across its awaits. Older test mocks may
   * not expose the group API.
   * @param fn - the paste work
   */
  protected async inOneUndoGroup(fn: () => Promise<void>): Promise<void> {
    const { BlockManager } = this.Blok;
    const holdsGroup = typeof BlockManager.beginToolTransaction === 'function';

    if (holdsGroup) {
      BlockManager.beginToolTransaction();
    }

    try {
      await fn();
    } finally {
      if (holdsGroup) {
        BlockManager.endToolTransaction();
      }
    }
  }

  protected async insertPasteData(
    data: PasteData[],
    canReplaceCurrentBlock: boolean
  ): Promise<void> {
    const { BlockManager, Caret } = this.Blok;

    if (!data.length) {
      return;
    }

    // Multiple items: insert each as a separate block
    const isMultipleItems = data.length > 1;

    if (isMultipleItems) {
      this.redirectToTableParentIfNeeded(data, BlockManager);

      const currentBlock = BlockManager.currentBlock;

      // Caret-split path: a multi-line PLAIN-TEXT paste (every item is inline,
      // not a block) into a NON-EMPTY block must split at the caret, matching
      // Notion: the first line merges into the current block at the caret, the
      // middle lines become new blocks, and the current block's post-caret
      // remainder rides with the LAST pasted segment.
      const isInlineMultiline = data.every((item) => !item.isBlock);

      const isInContainerTitle = this.caretIsInContainerTitle();

      // A newline-prefixed paste has an empty first segment: there is no real
      // inline first line to merge, so suppress the caret-split and drop the
      // empty lead — the remaining lines become new blocks.
      const firstSegmentIsEmpty = isInlineMultiline &&
        (data[0]?.content?.textContent ?? '').trim() === '';

      // Block items split only as a flat run of text blocks: a nested item
      // points at its parent by index, and the first item is merged away.
      const canSplitBlocks = !isInlineMultiline &&
        data.every((item) => item.parentPasteIndex === undefined) &&
        this.canSplitBlocksAtCaret(data[0].tool, data[data.length - 1].tool);

      const canCaretSplit = (isInlineMultiline && this.canSplitAtCaret() && !firstSegmentIsEmpty) || canSplitBlocks;

      // One undo group from the caret split to the last pasted block: the
      // split edits the current block before the first insert, and one Cmd+Z
      // must revert both.
      await this.inOneUndoGroup(async () => {
        const linesToInsert = await this.resolveLinesToInsert(data, canCaretSplit, firstSegmentIsEmpty);

        const contextParentId = isInContainerTitle
          ? (currentBlock?.id ?? null)
          : (currentBlock?.parentId ?? null);
        const insertedByIndex: Array<Awaited<ReturnType<BlokModules['BlockManager']['paste']>>> = [];

        // Notion parity (M-17): pasting list-style continuation blocks into an
        // EMPTY list item replaces it with the first inserted block. The global
        // canReplaceCurrentBlock flag is false for a non-default (list) target,
        // so allow the replace here when the produced blocks are list items.
        const firstIsListOverride = this.readListOverride(linesToInsert[0]?.content) !== null;
        const targetIsEmptyList = currentBlock?.name === 'list' && currentBlock.isEmpty;
        const allowReplaceEmptyList = firstIsListOverride && targetIsEmptyList;

        for (const [index, pasteData] of linesToInsert.entries()) {
          const shouldReplace = index === 0 &&
            (canReplaceCurrentBlock || allowReplaceEmptyList) &&
            BlockManager.currentBlock?.isEmpty === true;
          const pastedBlock = await BlockManager.paste(
            pasteData.tool,
            pasteData.event,
            shouldReplace,
            pasteData.toolData
          );

          // Stamp the inherited list style/depth/checked onto the freshly
          // pasted list block. The list tool's onPaste only sets text + a
          // default style from the plain-text content, so the override is
          // applied here via BlockManager.update (carrier read from content).
          const block = await this.applyListStyleOverride(pastedBlock, pasteData.content);

          Caret.setToBlock(block, Caret.positions.END);
          insertedByIndex.push(block);

          this.applyPastedBlockParent(block, pasteData, insertedByIndex, BlockManager, contextParentId);
        }
      });

      BlockManager.currentBlock && Caret.setToBlock(BlockManager.currentBlock, Caret.positions.END);

      return;
    }

    // Single item: decide whether to insert as block or inline content
    const [singleItem] = data;
    const isBlock = singleItem.isBlock;

    // A lone table in a cell would flatten into it; it goes after the table.
    // Other lone restricted blocks keep their text in the cell. Same name as
    // the outer table, so processSingleBlock would merge it in as text.
    if (singleItem.tool === 'table' && this.redirectToTableParentIfNeeded(data, BlockManager)) {
      await this.insertBlock(singleItem);

      return;
    }

    if (isBlock) {
      await this.processSingleBlock(singleItem, canReplaceCurrentBlock);
      return;
    }

    await this.processInlinePaste(singleItem, canReplaceCurrentBlock);
  }

  /**
   * Stamp the inherited list style/depth/checked onto a freshly pasted list
   * block. Returns the (possibly re-created) block, or the original block when
   * no override applies.
   * @param pastedBlock - the block produced by the paste
   * @param content - the pasted item's content carrying the list override
   */
  private async applyListStyleOverride(
    pastedBlock: Awaited<ReturnType<BlokModules['BlockManager']['paste']>>,
    content: HTMLElement | undefined
  ): Promise<Awaited<ReturnType<BlokModules['BlockManager']['paste']>>> {
    const { BlockManager } = this.Blok;
    const listOverride = this.readListOverride(content);

    if (listOverride === null || typeof BlockManager.update !== 'function') {
      return pastedBlock;
    }

    return BlockManager.update(pastedBlock, listOverride);
  }

  /**
   * Read the inherited list style/depth carried on a pasted item's content
   * (set by TextHandler when the paste target is a list item). Returns the
   * data to merge into the new block, or null when the item is not a list
   * continuation. New list items are always created unchecked (m-16).
   */
  private readListOverride(content: HTMLElement | undefined): { style: string; depth: number; checked: boolean } | null {
    if (content === undefined) {
      return null;
    }

    const style = content.getAttribute('data-blok-paste-list-style');

    if (style !== 'ordered' && style !== 'unordered' && style !== 'checklist') {
      return null;
    }

    const depthAttr = content.getAttribute('data-blok-paste-list-depth');
    const parsedDepth = depthAttr !== null ? Number.parseInt(depthAttr, 10) : 0;
    const depth = Number.isNaN(parsedDepth) ? 0 : Math.max(0, parsedDepth);

    return {
      style,
      depth,
      checked: false,
    };
  }

  /**
   * Wire up the parent relationship for a pasted block.
   */
  private applyPastedBlockParent(
    block: Awaited<ReturnType<BlokModules['BlockManager']['paste']>>,
    pasteData: PasteData,
    insertedByIndex: Array<Awaited<ReturnType<BlokModules['BlockManager']['paste']>>>,
    BlockManager: BlokModules['BlockManager'],
    contextParentId: string | null
  ): void {
    if (pasteData.parentPasteIndex !== undefined) {
      const parentBlock = insertedByIndex[pasteData.parentPasteIndex];

      if (parentBlock) {
        BlockManager.setBlockParent(block, parentBlock.id);
      }
    } else if (contextParentId !== null) {
      // Container-title paste context: assign all flat blocks to the container
      BlockManager.setBlockParent(block, contextParentId);
    } else if (block.parentId != null) {
      // Root-level paste context: clear any parent inherited from predecessor
      BlockManager.setBlockParent(block, null);
    }
  }

  /**
   * Insert a single block.
   */
  protected async insertBlock(data: PasteData, canReplaceCurrentBlock = false): Promise<void> {
    const { BlockManager, Caret } = this.Blok;
    const { currentBlock } = BlockManager;

    if (canReplaceCurrentBlock && currentBlock && currentBlock.isEmpty) {
      const replacedBlock = await BlockManager.paste(data.tool, data.event, true, data.toolData);

      Caret.setToBlock(replacedBlock, Caret.positions.END);

      return;
    }

    const block = await BlockManager.paste(data.tool, data.event, false, data.toolData);

    Caret.setToBlock(block, Caret.positions.END);
  }

  /**
   * Process paste of single Block tool content.
   */
  protected async processSingleBlock(dataToInsert: PasteData, canReplaceCurrentBlock: boolean): Promise<void> {
    const { Caret, BlockManager } = this.Blok;
    const { currentBlock } = BlockManager;
    const $ = Dom;

    if (
      !currentBlock ||
      dataToInsert.tool !== currentBlock.name ||
      !$.containsOnlyInlineElements(dataToInsert.content.innerHTML)
    ) {
      await this.insertBlock(dataToInsert, canReplaceCurrentBlock);

      return;
    }

    Caret.insertContentAtCaretPosition(dataToInsert.content.innerHTML);
  }

  /**
   * Process paste to single Block.
   */
  protected async processInlinePaste(dataToInsert: PasteData, canReplaceCurrentBlock: boolean): Promise<void> {
    const { BlockManager } = this.Blok;
    const { content } = dataToInsert;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock || !currentBlock.currentInput) {
      await this.insertBlock(dataToInsert, canReplaceCurrentBlock);

      return;
    }

    this.insertHtmlAtCaret(content.innerHTML);
  }
}
