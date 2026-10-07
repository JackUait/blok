import type { BlockOrigin, BlockToolData, LooseOutputBlockData, LooseOutputData, OutputBlockData, OutputData, ToolConfig } from '../../../../types';
import type { BlockAPI as BlockAPIInterface, Blocks, CreateBlockOptions, InsertAtOptions, MoveToTarget } from '../../../../types/api';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { DerivedSource } from '../blockManager/types';
import type { BlockToolAdapter } from '../../tools/block';
import type { InsertInsideParentWithCurrentOptions } from '../blockManager/block-insertion';
import { blocksToMarkdown } from '../../../markdown/blocks-to-markdown';
import type { InternalMarkdownImportConfig, MarkdownImportConfig } from '../../../markdown/types';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import { Module } from '../../__module';
import { Block } from '../../block';
import { BlockAPI } from '../../block/api';
import { ToolNotFoundError } from '../../errors/tool-not-found';
import { capitalize } from '../../utils';
import { richTextInputToHtml } from '../../utils/rich-text-input';
import { sanitizeBlocks, stripUnsafeUrlsDeep } from '../../utils/sanitizer';
import { applyBlockMigration } from '../../migration/block-migrations';
import { announce } from '../../utils/announcer';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { cloneOutputBlocks } from '../../utils/clone-output-blocks';
import { normalizeTableChildParents } from '../../utils/data-model-transform';
import { equalsOutputData, normalizeOutputBlocks } from '../../../shared/output-data';
import { isNestedDocument, outputBlocksToCanonicalSegments, outputBlocksToSegments } from '../../../shared/rich-text/block-data';
import { LEGACY_BODY_TYPES, LEGACY_ITEM_TYPES } from '../../../shared/rich-text/fields';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';
import { resolveHashTarget } from '../../utils/hash-target';
import { highlightBlockArrival } from '../../utils/highlight-block-arrival';
import { assertCanMoveUnder, BlockPlacementError, findBlock, isUnder, resolvePlacement, type BlockTree } from './block-placement';

import { logLabeled } from './../../utils';


/**
 * @class BlocksAPI
 * provides with methods working with Block
 */
export class BlocksAPI extends Module {
  /** Where the open `transactWithoutCapture` scope's data comes from, if it has a source. */
  private derivedFrom: DerivedSource | null = null;

  /**
   * Available methods
   * @returns {Blocks}
   */
  public get methods(): Blocks {
    const blocksAPI = this;

    return {
      get isSyncingFromYjs(): boolean {
        return blocksAPI.Blok.BlockManager.isSyncingFromYjs;
      },
      get isPointerDragActive(): boolean {
        return blocksAPI.Blok.BlockManager.isPointerDragActive;
      },
      get isApplyingRemoteChange(): boolean {
        return blocksAPI.Blok.BlockManager.isApplyingRemoteChange;
      },
      clear: (): Promise<void> => this.clear(),
      render: (data: OutputData): Promise<void> => this.render(data),
      renderFromHTML: (data: string): Promise<void> => this.renderFromHTML(data),
      importMarkdown: (md: string, options?: MarkdownImportConfig): Promise<OutputData> => this.importMarkdown(md, options),
      exportMarkdown: (): Promise<string> => this.exportMarkdown(),
      delete: (index?: number, setCaret?: boolean): Promise<void> => this.delete(index, setCaret),
      move: (toIndex: number, fromIndex?: number): void => this.move(toIndex, fromIndex),
      getBlockByIndex: (index: number): BlockAPIInterface | undefined => this.getBlockByIndex(index),
      getById: (id: string): BlockAPIInterface | null => this.getById(id),
      getCurrentBlockIndex: (): number => this.getCurrentBlockIndex(),
      getBlockIndex: (id: string): number | undefined => this.getBlockIndex(id),
      getBlocksCount: (): number => this.getBlocksCount(),
      getBlockByElement: (element: HTMLElement) => this.getBlockByElement(element),
      getChildren: (parentId: string): BlockAPIInterface[] => this.getChildren(parentId),
      insert: this.insert,
      insertAt: this.insertAt,
      create: this.create,
      moveTo: (id: string, target: MoveToTarget): void => this.moveTo(id, target),
      insertMany: this.insertMany,
      update: this.update,
      composeBlockData: this.composeBlockData,
      convert: this.convert,
      setBlockParent: (blockId: string, parentId: string | null): void => this.setBlockParent(blockId, parentId),
      stopBlockMutationWatching: (index: number): void => this.stopBlockMutationWatching(index),
      startBlockMutationWatching: (blockId: string): void => this.startBlockMutationWatching(blockId),
      splitBlock: this.splitBlock,
      insertInsideParent: this.insertInsideParent,
      transact: (fn: () => void): void => this.transact(fn),
      transactWithoutCapture: (fn: () => void, options?: { derivedFrom?: string; from?: readonly string[] }): void => this.transactWithoutCapture(fn, options),
      beginTransaction: (): void => this.beginTransaction(),
      endTransaction: (): void => this.endTransaction(),
      setPointerDragActive: (active: boolean): void => this.setPointerDragActive(active),
      scrollToBlock: (id: string, options?: { select?: boolean }): void => this.scrollToBlock(id, options),
    };
  }

  /**
   * Returns Blocks count
   * @returns {number}
   */
  public getBlocksCount(): number {
    return this.Blok.BlockManager.blocks.length;
  }

  /**
   * Returns current block index
   * @returns {number}
   */
  public getCurrentBlockIndex(): number {
    return this.Blok.BlockManager.currentBlockIndex;
  }

  /**
   * Returns the index of Block by id;
   * @param id - block id
   */
  public getBlockIndex(id: string): number | undefined {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (!block) {
      logLabeled('There is no block with id `' + id + '`', 'warn');

      return;
    }

    return this.Blok.BlockManager.getBlockIndex(block);
  }

  /**
   * Returns BlockAPI object by Block index
   * @param {number} index - index to get
   */
  public getBlockByIndex(index: number): BlockAPIInterface | undefined {
    const block = this.Blok.BlockManager.getBlockByIndex(index);

    if (block === undefined) {
      logLabeled('There is no block at index `' + index + '`', 'warn');

      return;
    }

    return new BlockAPI(block, this.Blok.API);
  }

  /**
   * Returns BlockAPI object by Block id
   * @param id - id of block to get
   */
  public getById(id: string): BlockAPIInterface | null {
    const block = this.Blok.BlockManager.getBlockById(id);

    if (block === undefined) {
      logLabeled('There is no block with id `' + id + '`', 'warn');

      return null;
    }

    return new BlockAPI(block, this.Blok.API);
  }

  /**
   * Get Block API object by any child html element
   * @param element - html element to get Block by
   */
  public getBlockByElement(element: HTMLElement): BlockAPIInterface | undefined {
    const block = this.Blok.BlockManager.getBlock(element);

    if (block === undefined) {
      logLabeled(`There is no block corresponding to element <${element.tagName?.toLowerCase() ?? 'unknown'}>`, 'warn');

      return;
    }

    return new BlockAPI(block, this.Blok.API);
  }

  /**
   * Returns all child blocks of a parent container block
   * @param parentId - id of the parent block
   */
  public getChildren(parentId: string): BlockAPIInterface[] {
    const children = this.Blok.BlockManager.blocks.filter(
      (block) => block.parentId === parentId
    );

    return children.map((block) => new BlockAPI(block, this.Blok.API));
  }


  /**
   * Move block from one index to another
   * @param {number} toIndex - index to move to
   * @param {number} fromIndex - index to move from
   */
  public move(toIndex: number, fromIndex?: number): void {
    this.Blok.YjsManager.beginApiCall();
    this.Blok.BlockManager.move(toIndex, fromIndex);
  }

  /**
   * Deletes Block
   * @param {number} blockIndex - index of Block to delete
   * @param {boolean} setCaret - whether to move the caret to the surviving current
   *   block after deletion. Defaults to `true` (interactive delete). Pass `false`
   *   for programmatic deletion (e.g. React `useBlocks.remove`) so the user's
   *   caret is not stolen from wherever they are typing.
   */
  public async delete(
    blockIndex: number = this.Blok.BlockManager.currentBlockIndex,
    setCaret = true
  ): Promise<void> {
    this.Blok.YjsManager.beginApiCall();
    const block = this.Blok.BlockManager.getBlockByIndex(blockIndex);

    if (block === undefined) {
      logLabeled(`There is no block at index \`${blockIndex}\``, 'warn');

      return;
    }

    const parent = block.parentId === null ? undefined : this.Blok.BlockManager.getBlockById(block.parentId);

    try {
      await this.Blok.BlockManager.removeBlock(block);
    } catch (error: unknown) {
      logLabeled(error as string, 'warn');

      return;
    }

    /**
     * Note: default-block insertion when the store is empty is handled
     * synchronously by removeBlock(block, addLastBlock=true).
     * A redundant async check here would race with clear()/render()
     * and could insert a spurious paragraph after the store has been
     * repopulated by Renderer.
     */

    /**
     * After Block deletion currentBlock is updated
     */
    if (setCaret && this.Blok.BlockManager.currentBlock) {
      this.Blok.Caret.setToBlock(this.Blok.BlockManager.currentBlock, this.Blok.Caret.positions.END);
    }

    // Wait only after the caret moves. Moving it after the table save keeps
    // the cell's stand-in blocks alive through undo, and their cleanup wipes redo.
    if (parent?.name === 'table') {
      await new Promise<void>(resolve => this.Blok.YjsManager.runAfterSavesOf(parent.id, resolve));
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Refuses a whole-document replacement while collaboration is on.
   *
   * `render()` and `clear()` rebuild the document from local data. In a
   * collaboration session the document belongs to the sync service, so
   * rebuilding it here would push one client's copy over everybody else's —
   * the dual-seeding corruption the sync-first load exists to prevent. The
   * sanctioned wholesale-replace is the server's reset endpoint.
   *
   * Zero cost single-player: `Collaboration` is undefined in a stubbed harness
   * and `isEnabled` is false whenever the `collaboration` key is absent.
   * @param method - the refused API, named back to the caller
   */
  private refuseWholesaleReplace(method: 'render' | 'clear' | 'renderFromHTML' | 'importMarkdown'): void {
    if (!this.Blok.Collaboration?.isEnabled) {
      return;
    }

    // The gate is the module; the doc id is only for the message, so a config
    // that cannot supply one still produces a readable endpoint.
    const doc = this.config.collaboration?.doc ?? '{doc}';

    throw new Error(
      `blocks.${method}() is not allowed while collaboration is on. ` +
      'The document lives on the sync service and is shared with everyone editing it, ' +
      'so replacing it from this editor would overwrite their work. ' +
      `To replace the whole document, call POST /sync/${doc}/reset on your server: ` +
      'it reloads the document from your own document endpoint and every open editor picks it up. ' +
      'To change part of the document, use blocks.insert(), blocks.update() or blocks.delete().'
    );
  }

  /**
   * Clear Blok's area
   */
  public async clear(): Promise<void> {
    this.refuseWholesaleReplace('clear');

    await this.Blok.BlockManager.clear(true);
    this.Blok.InlineToolbar.close();
  }

  /**
   * Fills Blok with Blocks data
   * @param {OutputData} data — Saved Blok data
   */
  public async render(data: OutputData | LooseOutputData): Promise<void> {
    // Before the data check and before the echo-equality save(): a refused
    // wholesale replace must do no work at all.
    this.refuseWholesaleReplace('render');

    return this.replaceDocument(data, { keepId: false });
  }

  /**
   * True when `data` holds the blocks the editor would save. Rich fields
   * compare as segments: the save holds segments, while a host may hand back
   * the HTML it first loaded, or segments in another spelling (split runs,
   * `bold: false`), which compare canonicalized.
   * @param current - the editor's host save
   * @param data - the incoming document
   */
  private isEchoOf(current: OutputData, data: OutputData | LooseOutputData): boolean {
    const resolve = (type: string): string[] => this.Blok.Tools.blockTools.get(type)?.richTextFields ?? [];
    const incoming = outputBlocksToCanonicalSegments(normalizeOutputBlocks(data.blocks), resolve, htmlToSegmentsDom);

    return equalsOutputData({ blocks: outputBlocksToSegments(current.blocks, resolve, htmlToSegmentsDom) }, { blocks: incoming });
  }

  /**
   * The body of {@link render}.
   * @param data - the document to show
   * @param options - replace behaviour
   * @param options.keepId - true when only the content changes (Markdown
   *   import), so an id-less `data` keeps the current document id
   */
  private async replaceDocument(data: OutputData | LooseOutputData, { keepId }: { keepId: boolean }): Promise<void> {
    if (data === undefined || data.blocks === undefined) {
      throw new Error('Incorrect data passed to the render() method');
    }

    /**
     * Echo-safety: render() is a full clear-and-rebuild that destroys the
     * caret/selection. When a consumer round-trips editor output through
     * their state (data → render → onSave → setState → data), the echoed
     * document is structurally identical to the current content — rebuilding
     * would clobber the caret for zero visual change. Compare against the
     * current saved state and no-op on equality (time/version are ignored).
     */
    const currentContent = await this.Blok.Saver.save();
    const incomingId = typeof data.id === 'string' && data.id !== '' ? data.id : null;

    // The echo check ignores `id`, so adopt before it: same blocks under a
    // new id is still a different document.
    if (incomingId !== null) {
      this.Blok.Saver.adoptDocumentRecordId(incomingId);
    }

    // Before the echo check: a rename with the same blocks is still a change.
    this.Blok.YjsManager.loadPage({ title: data.title ?? undefined, icon: data.icon ?? undefined });

    if (currentContent !== undefined && this.isEchoOf(currentContent, data)) {
      this.processPendingHashScroll();

      return;
    }

    // Only a real swap resets: an id-less echo would otherwise churn the id.
    if (incomingId === null && !keepId) {
      this.Blok.Saver.resetDocumentRecordId();
    }

    /**
     * Semantic meaning of the "render" method: "Display the new document over the existing one that stays unchanged"
     * So we need to disable modifications observer temporarily
     */
    this.Blok.ModificationsObserver.disable();
    /**
     * An edit made in the batch window just before this call was made against
     * the document being replaced, so it is moot — and delivering it would send
     * the host's own pushed document back to its save endpoint as an edit.
     * Only render() replaces the document: the read-only toggle and the i18n
     * repaint re-render the SAME document, so a pending edit there still counts.
     */
    this.Blok.ModificationsObserver.discardPendingChanges();
    this.Blok.Renderer.markRenderStart();

    try {
      await this.Blok.BlockManager.clear();
      // The caller owns `data` (often frozen store state): normalize the
      // loose wire shape, then deep-clone at this boundary so the editor
      // never mutates or retains their objects.
      await this.Blok.Renderer.render(cloneOutputBlocks(normalizeOutputBlocks(data.blocks)));
    } finally {
      this.Blok.Renderer.markRenderEnd();
      // Inside the finally, because the render above throws on a malformed
      // block. Left outside, one bad render kills onChange/onSave for the rest
      // of the editor's life — the observer is never re-armed by anything else.
      this.Blok.ModificationsObserver.enable();
    }

    this.processPendingHashScroll();
  }

  /**
   * Render passed HTML string
   * @param {string} data - HTML string to render
   * @returns {Promise<void>}
   */
  public async renderFromHTML(data: string): Promise<void> {
    this.refuseWholesaleReplace('renderFromHTML');

    this.Blok.Renderer.markRenderStart();

    try {
      await this.Blok.BlockManager.clear();

      // Awaited: the render must stay pending until the import ends, or a save
      // in between reads the half-cleared document.
      return await this.Blok.Paste.processText(data, true);
    } finally {
      this.Blok.Renderer.markRenderEnd();
    }
  }

  /**
   * Import Markdown string as blocks.
   * Lazy-loads the markdown converter on first call.
   * @param md - Markdown source string
   * @param options - Optional configuration for tool mapping and extensions
   */
  public async importMarkdown(md: string, options?: MarkdownImportConfig): Promise<OutputData> {
    // Refuse HERE, not in the render() this delegates to: the message names the
    // method the caller actually invoked, and a refused call never pays for the
    // converter's lazy chunk.
    this.refuseWholesaleReplace('importMarkdown');

    const { markdownToBlocks } = await import('../../../markdown/index');
    // HTML in, so the Saver's own format gates below decide what the host gets.
    const config: InternalMarkdownImportConfig = { ...options, htmlText: true };
    const blocks = await markdownToBlocks(md, config);
    const data: OutputData = { blocks };

    await this.replaceDocument(data, { keepId: true });

    // After the render: the legacy gate reads the detected input format.
    return {
      ...data,
      blocks: blocks.map((block) => {
        const tool = this.Blok.Tools.blockTools.get(block.type);

        return tool === undefined ? block : { ...block, data: this.Blok.Saver.blockDataForHost(tool, block.data) };
      }),
    };
  }

  /**
   * Export the current document as a Markdown string — the outbound twin of
   * {@link importMarkdown}. Blocks are read through the Saver, so the output
   * reflects the saved (validated) document rather than raw DOM.
   *
   * Blocks owned by a table cell are serialized INSIDE the pipe table and are not
   * repeated as loose lines (see `blocksToMarkdown`).
   * @returns the document as Markdown ('' when there is nothing to save)
   */
  public async exportMarkdown(): Promise<string> {
    // Internal dialect: blocksToMarkdown reads flat blocks holding HTML. The host
    // dialect holds segments and, with legacy output, list items[] and toggleList.
    const output = await this.Blok.Saver.save({ dialect: 'internal' });

    if (output === undefined) {
      return '';
    }

    const parentOf = new Map<string, string | null>();

    for (const block of output.blocks) {
      if (block.id !== undefined) {
        parentOf.set(block.id, block.parent ?? null);
      }
    }

    /**
     * Structural nesting depth of a block (its parentId-chain length).
     * @param id - block id
     * @returns the depth, 0 for root-level blocks
     */
    const depthOf = (id: string | undefined, seen: Set<string> = new Set()): number => {
      if (id === undefined || seen.has(id)) {
        return 0;
      }

      const parent = parentOf.get(id);

      if (typeof parent !== 'string') {
        return 0;
      }

      seen.add(id);

      return 1 + depthOf(parent, seen);
    };

    return blocksToMarkdown(output.blocks.map((block) => ({
      id: block.id,
      tool: block.type,
      data: block.data,
      parentId: block.parent ?? null,
      ...(block.content !== undefined ? { contentIds: block.content } : {}),
      indent: depthOf(block.id),
    })));
  }

  /**
   * Insert new Block and returns it's API
   * @param {string} type — Tool name
   * @param {BlockToolData} data — Tool data to insert
   * @param {ToolConfig} _config — Tool config
   * @param {number?} index — index where to insert new Block
   * @param {boolean?} needToFocus - flag to focus inserted Block
   * @param replace - pass true to replace the Block existed under passed index
   * @param {string} id — An optional id for the new block. If omitted then the new id will be generated
   * @param tunes — optional block tune data to apply at creation, keyed by tune name
   * @param origin — why the block is being created; defaults to `'api'`. Pass
   *   `'user'` from your own insertion UI (a custom toolbar or slash menu) so a
   *   container tool can tell the gesture from a programmatic refetch.
   */
  public insert = (
    type?: string,
    data: BlockToolData = {},
    _config: ToolConfig = {},
    index?: number,
    needToFocus?: boolean,
    replace?: boolean,
    id?: string,
    tunes?: { [name: string]: BlockTuneData },
    origin: BlockOrigin = 'api'
  ): BlockAPIInterface => {
    this.Blok.YjsManager.beginApiCall();
    const defaultTool = type ?? (this.config.defaultBlock);
    const tool = (() => {
      if (!defaultTool) {
        return defaultTool;
      }

      const targetIndex = index ?? this.Blok.BlockManager.currentBlockIndex;
      /**
       * A negative index carries no table-cell context: `currentBlockIndex` is -1
       * when nothing is focused, and `getBlockByIndex(-1)` is the repository's
       * legacy "give me the LAST block" shorthand. Feeding it -1 made the guard
       * inspect the document's last block, so a restricted tool inserted into a
       * document that merely ENDS with a table was silently demoted to a paragraph.
       */
      const targetBlock = targetIndex >= 0
        ? this.Blok.BlockManager.getBlockByIndex(targetIndex)
        : undefined;

      if (targetBlock !== undefined && isInsideTableCell(targetBlock) && isRestrictedInTableCell(defaultTool)) {
        return 'paragraph';
      }

      return defaultTool;
    })();

    const insertedBlock = this.Blok.BlockManager.insert({
      id,
      tool,
      data: this.hostBlockDataForTool(tool ?? this.config.defaultBlock ?? 'paragraph', data),
      index,
      needToFocus,
      replace,
      tunes,
      origin,
      inferParent: true,
    });

    return new BlockAPI(insertedBlock, this.Blok.API);
  };

  /**
   * Insert a new block at a parent + sibling-relative position.
   * @param type - tool name; defaults to `config.defaultBlock`
   * @param data - tool data
   * @param options - parent, position, id, tunes, focus, replace
   */
  public insertAt = (type?: string, data?: BlockToolData, options: InsertAtOptions = {}): BlockAPIInterface =>
    this.placeBlock(type, data, options, 'api');

  /**
   * Add a block the way a toolbox pick does: wait for the tool's
   * `prepareInsert`, then insert at the root's end with origin `'user'`.
   * @param type - tool name; defaults to `config.defaultBlock`
   * @param options - data, parent, position, id, tunes, focus
   */
  public create = async (type?: string, options: CreateBlockOptions = {}): Promise<BlockAPIInterface> => {
    const { data, ...placement } = options;
    const toolName = type ?? this.config.defaultBlock ?? 'paragraph';
    const tool = this.Blok.Tools.blockTools.get(toolName);

    if (tool === undefined) {
      throw new ToolNotFoundError(toolName, `Block Tool with type "${toolName}" not found`);
    }

    // Check the place before prepareInsert: a page's hook makes the host page,
    // which would be orphaned if the insert then failed.
    resolvePlacement(this.tree, placement.parentId, placement.position ?? 'end');

    const prepared = await tool.prepareInsert();

    return this.placeBlock(toolName, prepared === undefined ? data : { ...data, ...prepared }, placement, 'user');
  };

  private placeBlock(type: string | undefined, data: BlockToolData | undefined, options: InsertAtOptions, origin: BlockOrigin): BlockAPIInterface {
    this.Blok.YjsManager.beginApiCall();
    const { BlockManager } = this.Blok;
    const { parentId, position, id, tunes, focus = false, replace } = options;

    if (replace !== undefined) {
      if (parentId !== undefined || position !== undefined) {
        throw new BlockPlacementError('replace cannot be combined with parentId or position');
      }

      const target = findBlock(this.tree, replace);

      return this.insert(type, data, {}, BlockManager.getBlockIndex(target), focus, true, id, tunes, origin);
    }

    const placement = resolvePlacement(this.tree, parentId, position ?? 'end');

    // insertInsideParent turns the index back into `afterId`; it also keeps
    // the index path for table and database parents.
    if (placement.parentId !== null) {
      return this.insertInsideParent(placement.parentId, placement.index, data, type, { id, tunes, focus, keepCurrent: !focus, origin });
    }

    if (!BlockManager.suppressStopCapturing) {
      this.Blok.YjsManager.stopCapturing();
    }

    const block = BlockManager.insert({
      id,
      tool: type,
      data: data === undefined ? data : this.hostBlockDataForTool(type ?? this.config.defaultBlock ?? 'paragraph', data),
      needToFocus: focus,
      tunes,
      origin,
      placement: { parentId: null, afterId: placement.afterId },
    });

    return new BlockAPI(block, this.Blok.API);
  }

  /**
   * Move a block and its subtree to a parent + sibling-relative position, as
   * one undo step.
   * @param id - id of the block to move
   * @param target - new parent and position
   */
  public moveTo(id: string, target: MoveToTarget): void {
    const { BlockManager } = this.Blok;
    const block = findBlock(this.tree, id);
    const { position } = target;

    const refId = ((): string | undefined => {
      if (typeof position !== 'object') {
        return undefined;
      }

      return 'before' in position ? position.before : position.after;
    })();

    if (refId === id) {
      throw new BlockPlacementError(`cannot place "${id}" relative to itself`);
    }

    const placement = resolvePlacement(this.tree, target.parentId, position);

    assertCanMoveUnder(this.tree, block, placement.parentId, refId);

    const descendants = BlockManager.blocks.filter(candidate => isUnder(this.tree, candidate, block.id));
    const from = BlockManager.getBlockIndex(block);
    const end = from + descendants.length;
    // A slot inside or right after its own subtree needs no flat move.
    const movesFlat = placement.index <= from || placement.index > end + 1;
    const toIndex = from < placement.index ? placement.index - 1 : placement.index;

    // move() silently refuses a restricted tool whose slot neighbour is a
    // table cell block, even for the slot right after a table. Drop this when
    // the pin "blocks.move puts a header right after a table" passes.
    if (movesFlat && isRestrictedInTableCell(block.name) && isInsideTableCell(BlockManager.getBlockByIndex(toIndex))) {
      throw new BlockPlacementError(`cannot move "${block.name}" to a slot next to a table cell block`);
    }

    BlockManager.moveTo(block, { parentId: placement.parentId, afterId: placement.afterId });
  }

  /**
   * The block tree the placement helpers read.
   */
  private get tree(): BlockTree {
    const { BlockManager } = this.Blok;

    return {
      blocks: BlockManager.blocks,
      getBlockById: (blockId: string) => BlockManager.getBlockById(blockId),
    };
  }

  /**
   * Creates data of an empty block with a passed type.
   * @param toolName - block tool name
   */
  public composeBlockData = async (toolName: string): Promise<BlockToolData> => {
    const tool = this.Blok.Tools.blockTools.get(toolName);

    if (tool === undefined) {
      throw new ToolNotFoundError(toolName, `Block Tool with type "${toolName}" not found`);
    }

    const block = new Block({
      tool,
      api: this.Blok.API,
      readOnly: true,
      data: {},
      tunesData: {},
      // OFF-TREE probe: this Block is never inserted, never destroyed, yet it
      // still runs render() and (a frame later) rendered(). Labelling it lets a
      // container tool bail instead of seeding children into a document its
      // block is not even part of.
      origin: 'probe',
    });

    return block.data;
  };

  /**
   * Updates block data by id
   * @param id - id of the block to update
   * @param data - (optional) the new data
   * @param tunes - (optional) tune data
   */
  public update = async (id: string, data?: Partial<BlockToolData>, tunes?: {[name: string]: BlockTuneData}): Promise<BlockAPIInterface> => {
    const { BlockManager } = this.Blok;
    const block = BlockManager.getBlockById(id);

    if (block === undefined) {
      throw new Error(`Block with id "${id}" not found`);
    }

    // Read before the first await: `fn` of a derived scope returns before update writes.
    const derivedFrom = this.derivedFrom ?? undefined;

    if (derivedFrom === undefined) {
      this.Blok.YjsManager.beginApiCall();
    }
    const updatedBlock = await BlockManager.update(block, data === undefined ? data : this.hostDataForTool(block.name, data), tunes, derivedFrom);

    return new BlockAPI(updatedBlock, this.Blok.API);
  };

  /**
   * Converts block to another type. Both blocks should provide the conversionConfig.
   * @param id - id of the existing block to convert. Should provide 'conversionConfig.export' method
   * @param newType - new block type. Should provide 'conversionConfig.import' method
   * @param dataOverrides - optional data overrides for the new block
   * @throws Error if conversion is not possible
   */
  private convert = async (id: string, newType: string, dataOverrides?: BlockToolData): Promise<BlockAPIInterface> => {
    const { BlockManager, Tools } = this.Blok;
    const blockToConvert = BlockManager.getBlockById(id);

    if (!blockToConvert) {
      throw new Error(`Block with id "${id}" not found`);
    }

    const originalBlockTool = Tools.blockTools.get(blockToConvert.name);
    const targetBlockTool = Tools.blockTools.get(newType);

    if (!targetBlockTool) {
      throw new ToolNotFoundError(newType, `Block Tool with type "${newType}" not found`);
    }

    const originalBlockConvertable = originalBlockTool?.conversionConfig?.export !== undefined;
    const targetBlockConvertable = targetBlockTool.conversionConfig?.import !== undefined;

    if (originalBlockConvertable && targetBlockConvertable) {
      this.Blok.YjsManager.beginApiCall();
      // Overrides reach the Yjs document before the factory converts anything.
      const newBlock = await BlockManager.convert(blockToConvert, newType, dataOverrides === undefined ? dataOverrides : this.richTextToHtml(newType, dataOverrides));

      return new BlockAPI(newBlock, this.Blok.API);
    } else {
      const unsupportedBlockTypes = [
        !originalBlockConvertable ? capitalize(blockToConvert.name) : false,
        !targetBlockConvertable ? capitalize(newType) : false,
      ].filter(Boolean).join(' and ');

      throw new Error(`Conversion from "${blockToConvert.name}" to "${newType}" is not possible. ${unsupportedBlockTypes} tool(s) should provide a "conversionConfig"`);
    }
  };


  /**
   * Inserts several Blocks to a specified index
   *
   * The default index appends PAST the end of the flat store. It used to be
   * `length - 1` — the slot before the flat tail — which, for a document ending in
   * a nested-block tool (table/columns/toggle keep their children at the tail of
   * the same flat array), wedged the new blocks in between that container's
   * children instead of appending them to the document.
   * @param blocks - blocks data to insert
   * @param index - index to insert the blocks at. Defaults to the end of the document.
   */
  private insertMany = (
    blocks: OutputBlockData[] | LooseOutputBlockData[],
    index: number = this.Blok.BlockManager.blocks.length
  ): BlockAPIInterface[] => {
    this.validateIndex(index);
    this.Blok.YjsManager.beginApiCall();

    // Backfill `parent` on children referenced by table cells so that
    // alternative load paths (any consumer of the public API) get the
    // same hierarchical correctness as Renderer.render(). Without this,
    // flat-array article shapes lose their cell→child relationship and
    // children render as detached top-level blocks. The loose wire shape
    // (null data/ids) is normalized first.
    const normalizedBlocks = normalizeTableChildParents(normalizeOutputBlocks(blocks));

    const blocksToInsert = normalizedBlocks.map(({ id, type, data, tunes, parent, content, lastEditedAt, lastEditedBy }) => {
      const tool = type || (this.config.defaultBlock as string);

      return this.Blok.BlockManager.composeBlock({
        id,
        tool,
        data: this.hostBlockDataForTool(tool, data),
        tunes,
        parentId: parent,
        contentIds: content,
        lastEditedAt,
        lastEditedBy,
        origin: 'api',
      });
    });

    // notify: a programmatic bulk insert through the public API must emit a
    // BlockChanged mutation (mirroring single insert) so reactive consumers like
    // the React useBlocks hook re-render. Renderer.render() bypasses this wrapper
    // and calls BlockManager.insertMany directly, so initial render stays silent.
    // yjsSync 'add': this inserts into a LIVE document. The default 'replace'
    // reloads the doc from this batch alone, which silently deleted every other
    // block from Yjs (peers and the next reload) while the in-memory store —
    // and so `save()` — still looked right.
    this.Blok.BlockManager.insertMany(blocksToInsert, index, { notify: true, yjsSync: 'add' });

    return blocksToInsert.map((block) => new BlockAPI(block, this.Blok.API));
  };

  /**
   * Insert a new block as a child of the given parent block, atomically.
   * The block creation and parent assignment are grouped into a single undo entry,
   * so a single CMD+Z removes the new block completely.
   *
   * @param parentId - id of the parent block
   * @param insertIndex - flat block index where the new block should appear
   * @param childData - optional data for the new child block
   * @param toolName - optional tool to create; defaults to `config.defaultBlock`
   * @returns BlockAPI for the newly created child block
   */
  private insertInsideParent = (
    parentId: string,
    insertIndex: number,
    childData?: BlockToolData,
    toolName?: string,
    options?: InsertInsideParentWithCurrentOptions
  ): BlockAPIInterface => {
    // Force new undo group so this insertion is separate from previous typing,
    // UNLESS an enclosing atomic operation (e.g. tool conversion) has asked the
    // block manager to suppress stopCapturing so everything merges into a
    // single undo entry.
    if (!this.Blok.BlockManager.suppressStopCapturing) {
      this.Blok.YjsManager.stopCapturing();
    }

    const data = childData === undefined ? childData : this.hostBlockDataForTool(toolName ?? this.config.defaultBlock ?? 'paragraph', childData);
    const newBlock = this.Blok.BlockManager.insertInsideParent(parentId, insertIndex, data, toolName, options);

    // NOTE: Do NOT call stopCapturing in a trailing microtask. Late
    // mutation-observer writes from deferred DOM callbacks belong to this
    // insertion (under a table/database the operations layer also keeps
    // isSyncingFromYjs up through the next RAF). A trailing stopCapturing would
    // force them into a SEPARATE undo group, splitting the insertion across two
    // CMD+Z pops.

    return new BlockAPI(newBlock, this.Blok.API);
  };

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param blockId - id of the block to reparent
   * @param parentId - id of the new parent block, or null for root level
   */
  private setBlockParent(blockId: string, parentId: string | null): void {
    this.Blok.YjsManager.beginApiCall();
    const block = this.Blok.BlockManager.getBlockById(blockId);

    if (block === undefined) {
      logLabeled('There is no block with id `' + blockId + '`', 'warn');

      return;
    }

    this.Blok.BlockManager.setBlockParent(block, parentId);
  }

  /**
   * Stops mutation watching on a block at the specified index.
   * This is used to prevent spurious block-changed events during block replacement.
   * @param index - index of the block to stop watching
   */
  private stopBlockMutationWatching(index: number): void {
    const block = this.Blok.BlockManager.getBlockByIndex(index);

    if (block !== undefined) {
      block.unwatchBlockMutations();
    }
  }

  /**
   * Re-arms mutation watching on a block previously silenced via
   * stopBlockMutationWatching. Takes an id (not an index) because inserts
   * and replacements between the stop and the start shift indexes; a block
   * that no longer exists (e.g. replaced in place) is silently skipped —
   * its successor was constructed with its own watcher.
   * @param blockId - id of the block to resume watching
   */
  private startBlockMutationWatching(blockId: string): void {
    this.Blok.BlockManager.getBlockById(blockId)?.watchBlockMutations();
  }

  /**
   * Segment arrays in `data` → HTML, with the given tool's rich fields.
   * @param toolName - the tool the data belongs to
   * @param data - data from the host
   */
  private richTextToHtml<T extends Partial<BlockToolData>>(toolName: string, data: T): T {
    const resolveTool = (name: string): BlockToolAdapter | undefined => this.Blok.Tools.blockTools.get(name);

    return richTextInputToHtml(resolveTool(toolName), data, resolveTool) as T;
  }

  /**
   * Host data → what the tool may render: segments to HTML, then the same
   * sanitize passes `render()` runs (`Renderer.sanitizeToolData`). Order
   * matters: the sanitizer HTML-parses strings, and a segment's text is plain.
   * @param toolName - the tool the data is meant for
   * @param data - data from the host
   */
  private hostDataForTool<T extends Partial<BlockToolData>>(toolName: string, data: T): T {
    const html: Record<string, unknown> = this.richTextToHtml(toolName, data);
    // render() expands legacy shapes into blocks before it sanitizes; the tool's
    // rule has no entry for them, so sanitize them as the blocks they become.
    const items = LEGACY_ITEM_TYPES.has(toolName) && Array.isArray(html.items) ? html.items : undefined;
    const body = LEGACY_BODY_TYPES.has(toolName) && isNestedDocument(html.body) ? html.body : undefined;
    const rest = Object.fromEntries(Object.entries(html).filter(([key]) =>
      !(key === 'items' && items !== undefined) && !(key === 'body' && body !== undefined)));
    const cleaned = {
      ...this.sanitizeToolData(toolName, rest),
      ...(items === undefined ? {} : { items: this.sanitizeLegacyItems(toolName, items) }),
      ...(body === undefined ? {} : { body: { ...body, blocks: body.blocks.map(block => this.sanitizeNestedBlock(block)) } }),
    };

    return stripUnsafeUrlsDeep(cleaned, this.Blok.Tools.blockTools.get(toolName)?.sanitizeConfig) as T;
  }

  /**
   * {@link hostDataForTool} for a whole block's data. The host's
   * `config.migrations` rule runs first, as on render(): it may move markup
   * into a field the tool's rule allows. The factory runs it again; rules are
   * idempotent. A throwing rule leaves the data as is (the factory warns).
   * @param toolName - the tool the data is meant for
   * @param data - a whole block's data from the host
   */
  private hostBlockDataForTool<T extends Partial<BlockToolData>>(toolName: string, data: T): T {
    return this.hostDataForTool(toolName, applyBlockMigration(toolName, data, this.config.migrations) as T);
  }

  /**
   * The tool's sanitize config plus the global one.
   * @param toolName - the tool the data is meant for
   * @param data - tool-shaped data
   */
  private sanitizeToolData(toolName: string, data: BlockToolData): BlockToolData {
    const [sanitized] = sanitizeBlocks(
      [{ tool: toolName, data }],
      () => this.Blok.Tools.blockTools.get(toolName)?.sanitizeConfig,
      this.config.sanitizer
    );

    return sanitized.data;
  }

  /**
   * Legacy item text, sanitized as the `text` of the block it expands into.
   * @param toolName - the list tool
   * @param items - legacy `items[]`: strings or `{ content | text, items }`
   */
  private sanitizeLegacyItems(toolName: string, items: unknown[]): unknown[] {
    const clean = (value: unknown): unknown =>
      typeof value === 'string' ? this.sanitizeToolData(toolName, { text: value }).text : value;

    return items.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return clean(item);
      }

      const record = item as Record<string, unknown>;

      return {
        ...record,
        ...('content' in record ? { content: clean(record.content) } : {}),
        ...('text' in record ? { text: clean(record.text) } : {}),
        ...(Array.isArray(record.items) ? { items: this.sanitizeLegacyItems(toolName, record.items) } : {}),
      };
    });
  }

  /**
   * A legacy `body.blocks` entry, sanitized as a block of its own type.
   * @param block - one nested block
   */
  private sanitizeNestedBlock(block: OutputBlockData): OutputBlockData {
    if (typeof block !== 'object' || block === null || typeof block.type !== 'string' || typeof block.data !== 'object' || block.data === null) {
      return block;
    }

    return { ...block, data: this.hostDataForTool(block.type, block.data) };
  }

  /**
   * Atomically splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   *
   * @param currentBlockId - id of the block to update
   * @param currentBlockData - new data for the current block (typically truncated content)
   * @param newBlockType - tool type for the new block
   * @param newBlockData - data for the new block (typically extracted content)
   * @param insertIndex - index where to insert the new block
   * @returns the newly created block
   */
  private splitBlock = (
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): BlockAPIInterface => {
    // Force new undo group so block split is separate from previous typing.
    this.Blok.YjsManager.stopCapturing();

    const currentBlockName = this.Blok.BlockManager.getBlockById(currentBlockId)?.name;
    // Both halves are written to the Yjs document as given, before any factory runs.
    const newBlock = this.Blok.BlockManager.splitBlockWithData(
      currentBlockId,
      currentBlockName === undefined ? currentBlockData : this.richTextToHtml(currentBlockName, currentBlockData),
      newBlockType,
      this.richTextToHtml(newBlockType, newBlockData),
      insertIndex
    );

    // Use queueMicrotask to delay stopCapturing until after MutationObserver callbacks
    // have been processed. This ensures any DOM sync operations from the split complete first,
    // keeping them in the same undo entry as the split itself.
    queueMicrotask(() => {
      this.Blok.YjsManager.stopCapturing();
    });

    return new BlockAPI(newBlock, this.Blok.API);
  };

  /**
   * Execute a function within a transaction, grouping all block operations
   * into a single undo entry.
   */
  private transact(fn: () => void): void {
    this.Blok.YjsManager.beginApiCall();
    this.Blok.YjsManager.joinMovesToStep(() => this.Blok.BlockManager.transactForTool(fn));
  }

  /**
   * Open an undo group that stays open across async boundaries.
   * Use for pointer gestures that mutate the document continuously, where
   * transact() cannot help because it only wraps a synchronous function.
   * Must be paired with endTransaction().
   */
  private beginTransaction(): void {
    this.Blok.YjsManager.beginApiCall();
    this.Blok.BlockManager.beginToolTransaction();
  }

  /**
   * Close the undo group opened by beginTransaction().
   */
  private endTransaction(): void {
    this.Blok.BlockManager.endToolTransaction();
  }

  /**
   * Execute a function without adding any block operations to the undo history.
   * Useful for auto-repair operations that should never appear in undo history.
   */
  private transactWithoutCapture(fn: () => void, options?: { derivedFrom?: string; from?: readonly string[] }): void {
    const blockId = options?.derivedFrom;

    if (blockId === undefined) {
      this.Blok.YjsManager.transactWithoutCapture(fn);

      return;
    }

    const source = { blockId, from: options?.from ?? [] };

    // A save of the block still in flight may carry the edit this write comes
    // from: until it lands there is no undo step to join.
    this.Blok.YjsManager.runAfterSavesOf(blockId, () => {
      const outer = this.derivedFrom;

      this.derivedFrom = source;
      try {
        this.Blok.YjsManager.transactIntoStepThatWrote(blockId, fn, source.from);
      } finally {
        this.derivedFrom = outer;
      }
    });
  }

  /**
   * Notify BlockManager that a pointer drag interaction has started or ended.
   * While active, DOM-mutation-triggered Yjs syncs are suppressed to prevent
   * cross-cell browser DOM mutations from corrupting Yjs state.
   */
  private setPointerDragActive(active: boolean): void {
    this.Blok.BlockManager.setPointerDragActive(active);
  }

  /**
   * Validated block index and throws an error if it's invalid
   * @param index - index to validate
   */
  private validateIndex(index: unknown): void {
    if (typeof index !== 'number') {
      throw new Error('Index should be a number');
    }

    if (index < 0) {
      throw new Error(`Index should be greater than or equal to 0`);
    }
  }

  /**
   * Scrolls the block with the given id into view, selects it, highlights its
   * arrival and announces the navigation to assistive tech. No-op when no block
   * element with that id is present in the document.
   *
   * Public counterpart of the URL-hash scroll performed at boot. Adapters that
   * mount the editor into a DETACHED holder (React/Vue/Angular) render their
   * seeded content before the holder joins the document, so the boot-time
   * hash scroll — which queries the live document — finds nothing and defers.
   * Those adapters can drain that deferred navigation by calling this once the
   * holder connects, instead of hand-rolling a DOM-polling hook.
   * @param id - target block id
   * @param options - `select: false` jumps without selecting the block, so a
   *   following Backspace cannot delete it (in-page navigation such as a table of contents)
   */
  public scrollToBlock(id: string, options: { select?: boolean } = {}): void {
    /**
     * `id` is a block id for every caller that knows one, but the deferred
     * boot-time hash lands here too — and that hash can be a heading anchor
     * from imported HTML rather than a block id.
     */
    const target = resolveHashTarget(id, this.Blok.UI?.nodes.holder);

    if (target === null) {
      return;
    }

    const el = target.element;

    /**
     * A public scroll to this exact block consumes any deferred boot-time hash
     * scroll for it, so a later render()-driven drain can't re-fire the same
     * navigation. An unrelated pending hash is left untouched.
     */
    if (this.Blok.Renderer.pendingHashScroll === id) {
      this.Blok.Renderer.pendingHashScroll = null;
    }

    const topOffset = this.config.scrollToBlock?.topOffset ?? 0;
    const y = el.getBoundingClientRect().top + window.scrollY - topOffset;

    /**
     * A reader who asked for reduced motion gets the jump, not the glide. Every
     * other animated affordance in the editor already honours this.
     */
    window.scrollTo({ top: y, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });

    const block = target.blockId === null
      ? undefined
      : this.Blok.BlockManager.getBlockById(target.blockId);

    if (block !== undefined && options.select !== false) {
      this.Blok.BlockSelection.clearSelection();
      this.Blok.BlockSelection.selectBlock(block);
    }

    highlightBlockArrival(el);

    announce(this.Blok.I18n.t('a11y.navigatedToBlock'));
  }

  /**
   * If Renderer.pendingHashScroll is set (hash-based scroll was deferred because the
   * target block did not exist at init time), attempt to scroll to and select the block now.
   * Always clears the pending hash afterward (one-shot).
   */
  private processPendingHashScroll(): void {
    const hash = this.Blok.Renderer.pendingHashScroll;

    if (hash === null) {
      return;
    }

    this.Blok.Renderer.pendingHashScroll = null;

    this.scrollToBlock(hash);
  }
}
