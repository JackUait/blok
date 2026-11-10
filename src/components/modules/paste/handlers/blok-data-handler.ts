import { nanoid } from 'nanoid';
import type { SanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { SavedData } from '../../../../../types/data-formats';
import type { BlockToolData } from '../../../../../types';
import type { BlockTuneData } from '../../../../../types/block-tunes/block-tune-data';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { Block } from '../../../block';
import { convertBlockDataToString, convertStringToBlockData } from '../../../utils/blocks';
import { generateBlockId } from '../../../utils/id-generator';
import { log } from '../../../utils/logger';
import { composeStubData, resolveBlockTool } from '../../../utils/stub-tool';
import type { StubData } from '../../../../tools/stub';
import { linkToBlock, takeCut, type CopyLink } from '../../../utils/copy-as-link';
import { sanitizeBlocks } from '../../../utils/sanitizer';
import { safeHref } from '../../../utils/sanitize-url';
import { isPagePointer } from '../../../../shared/page-pointer';
import { databaseRowTitle } from '../../../../shared/database-rows';
import { mintDatabaseRefIds, mintDatabaseViewIds, remapDatabaseRefs, remapDatabaseViewIds } from '../../../../shared/database/linked-source';
import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK } from '../../../../shared/page-reference';
import { getRestrictedTools } from '../../../../tools/table/table-restrictions';
import { TOOL_NAME as LIST_TOOL_NAME } from '../../../../tools/list/constants';
import { enclosingCellTable } from '../../../utils/enclosing-cell-table';
import { isChildToolAllowed } from '../../../utils/child-tools';
import type { TreePlacement } from '../../../utils/tree-order';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PatternMatch } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';
import { PatternHandler } from './pattern-handler';

/**
 * Shape of a block in the Blok clipboard data.
 * Extends the basic SavedData fields with optional hierarchy information.
 */
interface BlokClipboardBlock extends Pick<SavedData, 'id' | 'data' | 'tool'> {
  tunes?: { [name: string]: BlockTuneData };
  parentId?: string | null;
  contentIds?: string[];
  /** Set by a cut of a `copyAsLink` block: its first paste may recreate it. */
  cut?: string;
  /** The link a `copyAsLink` block stood for when it was cut. */
  link?: CopyLink;
  /** A database row's title, for a paste where no database takes the row. */
  title?: string;
}


/**
 * Blok Data Handler Priority.
 * Handles internal Blok JSON data.
 */
export class BlokDataHandler extends BasePasteHandler implements PasteHandler {
  private patternHandler?: PatternHandler;

  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
    private readonly config: { sanitizer?: SanitizerConfig }
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    try {
      JSON.parse(data);
      return 100;
    } catch {
      return 0;
    }
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const parsedBlokData = JSON.parse(data) as BlokClipboardBlock[];

    // Blok's own text/plain is the Markdown of these blocks and can read as one
    // tool pattern (a bare URL, `---`), so only foreign payloads try patterns.
    const hasPatterns = this.toolRegistry.toolsPatterns.length > 0;
    const plainData = context.plainData;

    if (!hasPatterns || !plainData || context.fromBlokClipboard === true) {
      this.insertBlokBlocks(parsedBlokData, context.canReplaceCurrentBlock);

      return true;
    }

    const patternResult = await this.tryPatternMatch(plainData);

    if (patternResult) {
      await this.insertPatternMatch(patternResult, context.canReplaceCurrentBlock);

      return true;
    }

    this.insertBlokBlocks(parsedBlokData, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Try pattern matching before inserting Blok JSON.
   */
  private async tryPatternMatch(plainData: string): Promise<PatternMatch | undefined> {
    if (!this.patternHandler) {
      this.patternHandler = new PatternHandler(
        this.Blok,
        this.toolRegistry,
        this.sanitizerBuilder
      );
    }

    if (plainData.length > PatternHandler.PATTERN_PROCESSING_MAX_LENGTH) {
      return;
    }

    const pattern = this.toolRegistry.findToolForPattern(plainData);

    if (!pattern) {
      return;
    }

    const event = this.composePasteEvent('pattern', {
      key: pattern.key,
      data: plainData,
    });

    return {
      key: pattern.key,
      data: plainData,
      tool: pattern.tool.name,
      event,
    };
  }

  /**
   * Insert a matched pattern as a new block.
   */
  private async insertPatternMatch(patternResult: PatternMatch, canReplace: boolean): Promise<void> {
    const { BlockManager, Caret } = this.Blok;

    const insertedBlock = await BlockManager.paste(patternResult.tool, patternResult.event, canReplace);

    Caret.setToBlock(insertedBlock, Caret.positions.END);
  }

  /**
   * A `copyAsLink` block pastes as its link, except:
   * - a page block stays a block while a block for the same page is live in
   *   this document: it is another entry point to that page;
   * - the first paste of a cut from this tab recreates the block, while no
   *   live block links to the same url.
   * This holds for any payload: another tab, an older build, a hand-written one.
   *
   * With no link at all the entry becomes a page reference or the tool's
   * exported text, or is dropped when that is empty.
   * @param entries - the parsed clipboard entries
   */
  private linksForSingletons(entries: BlokClipboardBlock[]): BlokClipboardBlock[] {
    const { Tools, BlockManager } = this.Blok;
    // Built on first need: most pastes hold no such block.
    const live = { urls: undefined as Set<string> | undefined, pageIds: undefined as Set<string> | undefined };
    const liveUrls = (): Set<string> => {
      live.urls ??= new Set(
        BlockManager.blocks
          .map((block) => block.tool.copyAsLink(block.preservedData)?.url)
          .filter((url): url is string => url !== undefined)
      );

      return live.urls;
    };
    const livePageIds = (): Set<string> => {
      live.pageIds ??= new Set(
        BlockManager.blocks
          .filter((block) => isPagePointer(block.name, block.preservedData))
          .map((block) => block.preservedData.pageId)
          .filter((pageId): pageId is string => typeof pageId === 'string')
      );

      return live.pageIds;
    };
    // Each token is taken once per paste, so every entry of one cut agrees.
    const cuts = new Map<string, boolean>();
    const isFreshCut = (token: unknown): boolean => {
      if (typeof token !== 'string') {
        return false;
      }
      if (!cuts.has(token)) {
        cuts.set(token, takeCut(token));
      }

      return cuts.get(token) === true;
    };

    // Entries replaced by a link, and so their subtrees. Entries come parents first.
    const replaced = new Set<string>();

    return entries.flatMap((entry): BlokClipboardBlock[] => {
      if (typeof entry.parentId === 'string' && replaced.has(entry.parentId)) {
        replaced.add(entry.id);

        return [];
      }

      const tool = Tools.blockTools.get(entry.tool);
      const built = tool?.copyAsLink?.(entry.data);

      if (tool === undefined || built === undefined) {
        return [entry];
      }

      const link = isCopyLink(entry.link) ? entry.link : built;
      const pageId = isPagePointer(entry.tool, entry.data) && typeof entry.data.pageId === 'string'
        ? entry.data.pageId
        : undefined;
      // The cut is taken even when a live block wins, so a later paste of it links too.
      const fresh = isFreshCut(entry.cut);

      if (pageId !== undefined && livePageIds().has(pageId)) {
        return [entry];
      }

      if (fresh && (link === null || !liveUrls().has(link.url))) {
        if (link !== null) {
          liveUrls().add(link.url);
        }
        if (pageId !== undefined) {
          livePageIds().add(pageId);
        }

        return [entry];
      }

      const shape = { id: entry.id, parentId: entry.parentId };

      replaced.add(entry.id);

      if (link !== null) {
        return [{ ...shape, ...linkToBlock(link, Tools.defaultTool) }];
      }

      const pageLink = pageId === undefined ? undefined : Tools.blockTools.get('page-link');

      if (pageId !== undefined && pageLink?.name === 'page-link') {
        return [{ ...shape, tool: pageLink.name, data: { pageId } }];
      }

      const reference = pageId === undefined ? undefined : this.pageReference(pageId);

      if (reference !== undefined) {
        return [{ ...shape, ...reference }];
      }

      const exported: unknown = convertBlockDataToString(entry.data, tool.conversionConfig);
      const text = typeof exported === 'string' ? exported : '';

      if (text.trim() === '') {
        return [];
      }

      const { defaultTool } = Tools;

      return [{ ...shape, tool: defaultTool.name, data: convertStringToBlockData(text, defaultTool.conversionConfig, defaultTool.settings) }];
    });
  }

  /**
   * A row copied without its database lives only in a database. Pasted
   * anywhere else, it becomes its title, and its page body follows at its level.
   * @param entries - the parsed clipboard entries, parents first
   */
  private rowsOutsideDatabases(entries: BlokClipboardBlock[]): BlokClipboardBlock[] {
    const { BlockManager, Tools } = this.Blok;
    const pastedIds = new Set(entries.map(entry => entry.id));
    const isLoneRow = (entry: BlokClipboardBlock): boolean =>
      entry.tool === 'database-row' && !(typeof entry.parentId === 'string' && pastedIds.has(entry.parentId));

    if (!entries.some(isLoneRow)) {
      return entries;
    }
    const caretParentId = this.caretParentId();
    // A row page body denies rows, so a paste there lands in the database around it.
    const landingId = this.placementOutsideDenyingParents(caretParentId, ['database-row'])?.parentId ?? caretParentId;

    if (landingId !== null && BlockManager.getBlockById(landingId)?.name === 'database') {
      return entries;
    }
    const { defaultTool } = Tools;
    // Row id to the parent its body moves to.
    const unwrapped = new Map<string, string | null | undefined>();

    return entries.flatMap((original): BlokClipboardBlock[] => {
      const entry = typeof original.parentId === 'string' && unwrapped.has(original.parentId)
        ? { ...original, parentId: unwrapped.get(original.parentId) }
        : original;

      if (!isLoneRow(entry)) {
        return [entry];
      }
      unwrapped.set(entry.id, entry.parentId);
      const title = typeof entry.title === 'string' ? entry.title : databaseRowTitle({ data: entry.data }, undefined);

      if (title.trim() === '') {
        return [];
      }
      const text = document.createElement('div');

      text.textContent = title;

      return [{
        id: entry.id,
        parentId: entry.parentId,
        tool: defaultTool.name,
        data: convertStringToBlockData(text.innerHTML, defaultTool.conversionConfig, defaultTool.settings),
      }];
    });
  }

  /**
   * A non-owning page reference in a paragraph, when Paragraph can import it.
   * @param pageId - the page the reference names
   */
  private pageReference(pageId: string): { tool: string; data: BlockToolData } | undefined {
    const paragraph = this.Blok.Tools.blockTools.get('paragraph');
    const importRule = paragraph?.conversionConfig?.import;

    if (paragraph === undefined || (typeof importRule !== 'string' && typeof importRule !== 'function')) {
      return undefined;
    }

    const anchor = document.createElement('a');

    anchor.setAttribute(PAGE_REFERENCE_ATTR, pageId);
    anchor.textContent = PAGE_REFERENCE_FALLBACK;

    return { tool: paragraph.name, data: convertStringToBlockData(anchor.outerHTML, paragraph.conversionConfig, paragraph.settings) };
  }

  /**
   * The entry with the tool this editor builds it with: a copied stub unwraps
   * to its own tool when registered here, and a missing tool becomes a stub.
   * @param entry - a clipboard entry
   */
  private withResolvedTool(entry: BlokClipboardBlock): BlokClipboardBlock {
    const { Tools } = this.Blok;
    const isStub = entry.tool === Tools.stubTool;
    const payload = entry.data as { type?: unknown; data?: unknown } | undefined;

    if (isStub && (typeof payload?.type !== 'string' || typeof payload.data !== 'object' || payload.data === null)) {
      return entry;
    }

    const type = isStub ? payload?.type as string : entry.tool;
    const data = (isStub ? payload?.data : entry.data) as BlockToolData;
    const resolved = resolveBlockTool(
      Tools,
      (name) => name !== Tools.stubTool && Tools.blockTools.get(name) !== undefined,
      type,
      data
    );

    return { ...entry, tool: resolved.tool, data: resolved.data };
  }

  /**
   * A stub's payload, cleaned with the inline tools' rules. The clipboard JSON
   * can be forged, and the stub saves this payload as a block of its real tool,
   * whose own rules this editor does not know.
   * @param data - the stub data built by withResolvedTool
   */
  private sanitizeStubPayload(data: BlockToolData): BlockToolData {
    const { Tools } = this.Blok;
    const savedData = (data as Partial<StubData> | undefined)?.savedData;

    if (savedData === undefined || typeof savedData.type !== 'string' || typeof savedData.data !== 'object' || savedData.data === null) {
      return data;
    }

    const [cleaned] = sanitizeBlocks(
      [{ tool: savedData.type, data: savedData.data as BlockToolData }],
      Tools.getAllInlineToolsSanitizeConfig(),
      this.config.sanitizer
    );

    return { ...data, savedData: { ...savedData, data: cleaned.data } };
  }

  /**
   * The entry's tunes as insert options. The clipboard JSON can be forged, so
   * only tunes the tool enables are kept, each cleaned with its own rules.
   * @param tool - the tool the block is inserted with
   * @param entry - the clipboard entry
   */
  private tunesOf(tool: string, entry: BlokClipboardBlock): { tunes?: { [name: string]: BlockTuneData } } {
    const { tunes } = entry;
    const enabled = this.Blok.Tools.blockTools.get(tool)?.tunes;

    if (typeof tunes !== 'object' || tunes === null || Array.isArray(tunes) || enabled === undefined) {
      return {};
    }

    const kept = Object.entries(tunes).flatMap(([name, value]): Array<[string, BlockTuneData]> => {
      const tune = enabled.get(name);

      if (tune === undefined) {
        return [];
      }

      const [cleaned] = sanitizeBlocks([{ tool: name, data: { value } }], { value: tune.sanitizeConfig }, this.config.sanitizer);

      return [[name, (cleaned.data as { value: BlockTuneData }).value]];
    });

    return kept.length > 0 ? { tunes: Object.fromEntries(kept) } : {};
  }

  /**
   * A list item copied without its parent list item still carries that nesting in
   * `data.depth`. The list tool reads `data.depth` only when no list is above it,
   * so the stale value would indent the pasted root. Its children take their depth
   * from the tree. A flat list (no parent at all) keeps its depth.
   * @param tool - the tool the block is inserted with
   * @param data - the block data
   * @param original - the clipboard entry
   * @param parentIsPasted - whether the entry's parent is in the paste
   */
  private withoutStaleListDepth(tool: string, data: BlockToolData, original: BlokClipboardBlock, parentIsPasted: boolean): BlockToolData {
    const hasCopiedParent = typeof original.parentId === 'string';

    if (tool !== LIST_TOOL_NAME || !hasCopiedParent || parentIsPasted || typeof data.depth !== 'number' || data.depth === 0) {
      return data;
    }

    return { ...data, depth: 0 };
  }

  /**
   * The table enclosing the caret cell, when the batch holds a tool barred from cells.
   * @param blocks - the clipboard entries, nested ones included
   */
  private tableToLeave(blocks: BlokClipboardBlock[]): Block | undefined {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;
    const restricted = new Set(getRestrictedTools());

    if (currentBlock === undefined || !blocks.some(block => restricted.has(block.tool))) {
      return undefined;
    }

    return enclosingCellTable(currentBlock, id => BlockManager.getBlockById(id));
  }

  /**
   * The parent pasted roots join: the container whose title holds the caret,
   * else the caret block's parent. Without it a paste into a container child
   * would land as a root sibling of the container.
   * Mirrors `contextParentId` in `BasePasteHandler.insertPasteData`.
   */
  private caretParentId(): string | null {
    const currentBlock = this.Blok.BlockManager.currentBlock;

    return this.caretIsInContainerTitle()
      ? (currentBlock?.id ?? null)
      : (currentBlock?.parentId ?? null);
  }

  /**
   * Where the batch goes when the caret's container denies one of its roots:
   * after the nearest enclosing block whose own parent allows every root.
   * @param parentId - the parent the roots would join
   * @param rootTools - the tools of the batch roots
   */
  private placementOutsideDenyingParents(parentId: string | null, rootTools: string[]): TreePlacement | undefined {
    const { BlockManager } = this.Blok;
    const walk = (candidateId: string | null, anchor: Block | undefined, seen: Set<string>): TreePlacement | undefined => {
      const candidate = candidateId === null ? null : BlockManager.getBlockById(candidateId);

      if (candidate === undefined || (candidateId !== null && seen.has(candidateId))) {
        return undefined;
      }
      if (rootTools.every(tool => isChildToolAllowed(candidate, tool))) {
        return anchor === undefined ? undefined : { parentId: candidateId, afterId: anchor.id };
      }
      if (candidate === null) {
        return undefined;
      }

      return walk(candidate.parentId, candidate, seen.add(candidate.id));
    };

    return walk(parentId, undefined, new Set());
  }

  /**
   * Insert Blok JSON blocks using a two-pass approach:
   *
   * Pass 1 — TABLE cell children (blocks whose parentId is a pasted table) are
   * inserted first.  They receive new IDs, which are recorded in a map, so the
   * owning table can be inserted with its `data.content` references remapped to
   * the new cell IDs.  This prevents container tools (TableCellBlocks) from
   * resolving old IDs that still exist in the editor and stealing blocks from
   * the original table.
   *
   * Pass 2 — every other block (roots AND flow-nested children such as list
   * sub-items and toggle/callout/column children) is inserted in DOCUMENT ORDER
   * with its data remapped.  Preserving document order is what keeps a nested
   * child from rendering above its parent (the Notion-paste scramble bug);
   * flow-nested blocks have no separate DOM container, so their array position
   * IS their visual position.
   *
   * After both passes the parent-child hierarchy is re-established using the
   * accumulated old→new ID mapping.
   */
  private insertBlokBlocks(
    rawBlocks: BlokClipboardBlock[],
    canReplace: boolean
  ): void {
    const { BlockManager, Caret, Tools } = this.Blok;

    // Some article shapes (e.g. flat-array exports) reference table children
    // ONLY via `data.content[r][c].blocks = [<id>]` and never set parentId
    // on the children themselves. Backfill parentId before classification so
    // those children get adopted by the table during the two-pass insert
    // instead of becoming detached top-level paragraphs.
    const blocks = backfillTableChildParents(this.rowsOutsideDatabases(this.linksForSingletons(rawBlocks.map(entry => this.withResolvedTool(entry)))));
    const sanitizedBlocks = sanitizeBlocks(
      blocks,
      (name) => Tools.blockTools.get(name)?.sanitizeConfig ?? {},
      this.config.sanitizer
    ).map((sanitized, i) => (sanitized.tool === Tools.stubTool ? { ...sanitized, data: this.sanitizeStubPayload(blocks[i].data) } : sanitized));

    // A tool barred from cells sends the whole batch out of the table, right
    // after its subtree, as BasePasteHandler.redirectToTableParentIfNeeded does.
    const redirectTable = this.tableToLeave(blocks);

    if (redirectTable !== undefined) {
      // An insert after a table goes after its whole run, at its level.
      BlockManager.currentBlock = redirectTable;
    }

    const caretParentId = this.caretParentId();
    const pastedIds = new Set(blocks.map(b => b.id));
    const rootTools = sanitizedBlocks
      .filter((_, i) => !(typeof blocks[i]?.parentId === 'string' && pastedIds.has(blocks[i].parentId)))
      .map(block => block.tool);
    // A root the caret's container denies (a tabs block inside a tab) would be
    // demoted, and its children nested under the demoted block and never shown.
    const leavePlacement = redirectTable === undefined
      ? this.placementOutsideDenyingParents(caretParentId, rootTools)
      : undefined;

    // Capture replace intent before any insertions move the current block pointer.
    const shouldReplaceFirst =
      redirectTable === undefined &&
      leavePlacement === undefined &&
      canReplace &&
      Boolean(BlockManager.currentBlock?.tool.isDefault) &&
      Boolean(BlockManager.currentBlock?.isEmpty);

    const leftParentId = leavePlacement !== undefined ? leavePlacement.parentId : caretParentId;
    const contextParentId = redirectTable !== undefined ? redirectTable.parentId : leftParentId;

    // IDs of pasted table blocks. ONLY a table's cell children must be inserted
    // before their parent: the table block's `data.content` references its cell
    // child IDs and the table tool resolves (adopts) them on insert, so the
    // cells must already exist with their new IDs. Every OTHER nested block —
    // list sub-items, toggle/callout/column children — is "flow-nested" and
    // must be inserted in DOCUMENT ORDER. Inserting those children-first
    // scrambled the document: a nested list child rendered ABOVE its parent and
    // the whole top-level order collapsed (Notion paste "broken order" bug).
    const pastedTableIds = new Set(
      blocks.filter(b => b.tool === 'table' && b.id !== undefined).map(b => b.id)
    );

    const isTableCellChild = (block: BlokClipboardBlock): boolean =>
      block.parentId !== undefined &&
      block.parentId !== null &&
      pastedTableIds.has(block.parentId);

    type Entry = { sanitized: (typeof sanitizedBlocks)[number]; original: BlokClipboardBlock };
    const tableCells: Entry[] = [];
    const documentFlow: Entry[] = [];

    sanitizedBlocks.forEach((sanitizedBlock, i) => {
      const original = blocks[i];

      if (original === undefined) {
        return;
      }

      (isTableCellChild(original) ? tableCells : documentFlow).push({ sanitized: sanitizedBlock, original });
    });

    // Table cells go in after the caret block, so a replace on the first flow
    // block would hit a cell. The empty caret block is removed after the inserts.
    const blockToRemove = shouldReplaceFirst && tableCells.length > 0 ? BlockManager.currentBlock : undefined;

    /**
     * Map from original (old) block ID to the newly inserted Block instance.
     * Used to remap data and restore hierarchy after both passes.
     */
    const oldIdToEntry = new Map<string, { newBlock: Block; original: BlokClipboardBlock }>();
    // Kept apart from oldIdToNewId: remapIds rewrites every matching string in the data.
    const copies = [...tableCells, ...documentFlow].map(({ sanitized, original }) => ({ id: original.id, type: sanitized.tool, data: sanitized.data }));
    const copiedRefIds = mintDatabaseRefIds(copies, generateBlockId);
    const copiedViewIds = mintDatabaseViewIds(copies, nanoid);

    // Group every insert + setBlockParent call into a single Yjs undo entry
    // so that one Cmd+Z removes the whole pasted set. Without this wrapper
    // each BlockManager.insert and setBlockParent lands on its own undo
    // stack item, and the user has to press undo N times to clear a paste.
    // A tool that throws while building its block becomes a stub, so the rest of the paste still lands.
    // Blocks created with another tool than asked for: their copied children must not nest under them.
    const demotedIds = new Set<string>();
    // Only the first insert of the batch takes the placement; the rest follow it.
    const pending = { placement: leavePlacement };
    const insertOrStub = (requested: Parameters<typeof BlockManager.insert>[0] & { tool: string; data: BlockToolData }): Block => {
      const options = pending.placement === undefined ? requested : { ...requested, replace: false, placement: pending.placement };
      const created = (tool: string, block: Block): Block => {
        if (block.name !== tool) {
          demotedIds.add(block.id);
        }

        return block;
      };

      pending.placement = undefined;

      try {
        return created(options.tool, BlockManager.insert(options));
      } catch (error) {
        if (options.tool === Tools.stubTool) {
          throw error;
        }
        log(`Pasted block «${options.tool}» replaced with a stub because of a plugin error`, 'error', { error });

        return created(Tools.stubTool, BlockManager.insert({ ...options, tool: Tools.stubTool, data: composeStubData(Tools, options.tool, options.data) }));
      }
    };

    // A flat run of text blocks splits the caret block, as a plain-text paste does.
    const splitsAtCaret = tableCells.length === 0 &&
      redirectTable === undefined &&
      leavePlacement === undefined &&
      !shouldReplaceFirst &&
      documentFlow.length > 1 &&
      documentFlow.every(({ original }) => !(typeof original.parentId === 'string' && pastedIds.has(original.parentId))) &&
      this.canSplitBlocksAtCaret(documentFlow[0].sanitized.tool, documentFlow[documentFlow.length - 1].sanitized.tool);

    /**
     * The text before the caret takes the first block's text, and the text
     * after it rides on the last block. Runs before any insert moves the caret.
     */
    const splitCaretBlock = (): void => {
      const first = documentFlow[0].sanitized;
      const last = documentFlow[documentFlow.length - 1];
      const firstField = this.textFieldOf(first.tool);
      const lastField = this.textFieldOf(last.sanitized.tool);
      const tail = Caret.extractFragmentFromCaretPosition();

      if (firstField !== undefined) {
        this.insertHtmlAtCaret(textOf(first.data[firstField]));
      }
      documentFlow.shift();

      if (tail === undefined || lastField === undefined) {
        return;
      }

      const tailHtml = document.createElement('div');

      tailHtml.append(tail);
      last.sanitized = {
        ...last.sanitized,
        data: { ...last.sanitized.data, [lastField]: `${textOf(last.sanitized.data[lastField])}${tailHtml.innerHTML}` },
      };
    };

    const runInsertPasses = (): void => {
      if (splitsAtCaret) {
        splitCaretBlock();
      }

      // Pass 1: insert table cells first so they exist with new IDs before the
      // owning table block is inserted with its (remapped) content references.
      // At the root: a cell left in the caret's container slot, or under its column,
      // is copied by the table as another owner's block, and the original lands in a cell too.
      tableCells.forEach(({ sanitized, original }) => {
        const block = insertOrStub({ tool: sanitized.tool,
          data: remapDatabaseViewIds(sanitized.tool, original.id, sanitized.data, copiedViewIds),
          forceTopLevel: true,
          origin: 'paste',
          ...this.tunesOf(sanitized.tool, original) });

        oldIdToEntry.set(original.id, { newBlock: block, original });
        Caret.setToBlock(block, Caret.positions.END);
      });

      // Build old→new string map for remapping ID references inside parent data.
      const oldIdToNewId = new Map<string, string>();

      for (const [oldId, { newBlock }] of oldIdToEntry) {
        oldIdToNewId.set(oldId, newBlock.id);
      }

      // Pass 2: insert every remaining block in DOCUMENT ORDER, remapping any
      // table cell IDs in their data. Skip replace when table cells were
      // pre-inserted to avoid replacing a just-inserted cell paragraph rather
      // than the original empty block.
      documentFlow.forEach(({ sanitized, original }, idx) => {
        const ownViews = remapDatabaseViewIds(sanitized.tool, original.id, sanitized.data, copiedViewIds);
        const remappedData = oldIdToNewId.size > 0
          ? remapIds(ownViews, oldIdToNewId) as typeof sanitized.data
          : ownViews;
        const id = copiedRefIds.get(original.id);
        // A copied parent that is not in the paste counts as no parent: the pass below cannot restore it.
        const parentIsPasted = original.parentId !== undefined && original.parentId !== null && pastedIds.has(original.parentId);
        const data = remapDatabaseRefs(sanitized.tool, remappedData, copiedRefIds);

        const block = insertOrStub({
          tool: sanitized.tool,
          data: this.withoutStaleListDepth(sanitized.tool, data, original, parentIsPasted),
          replace: idx === 0 && shouldReplaceFirst && tableCells.length === 0,
          origin: 'paste',
          ...(id !== undefined && { id }),
          ...this.tunesOf(sanitized.tool, original),
        });

        // A root of the paste joins the caret's container.

        if (contextParentId !== null && !parentIsPasted && block.parentId !== contextParentId) {
          BlockManager.setBlockParent(block, contextParentId);
        }

        oldIdToEntry.set(original.id, { newBlock: block, original });
        Caret.setToBlock(block, Caret.positions.END);
      });

      /**
       * Restore parent-child hierarchy using the old-to-new ID mapping.
       * Only restores relationships where both parent and child are in the pasted set.
       */
      for (const [, { newBlock, original }] of oldIdToEntry) {
        if (original.parentId === undefined || original.parentId === null) {
          continue;
        }

        const parentEntry = oldIdToEntry.get(original.parentId);

        if (parentEntry === undefined || demotedIds.has(parentEntry.newBlock.id)) {
          continue;
        }

        // Route through the canonical reparent API — it handles old-parent
        // splice, new-parent push, DOM reparent into the container's children
        // wrapper, collapsed-hidden state sync, and the Yjs parentId +
        // contentIds companion writes. Direct parentId/contentIds mutations
        // bypass every one of those and reintroduce the callout paste
        // ejection bug family.
        BlockManager.setBlockParent(newBlock, parentEntry.newBlock.id);
      }

      if (blockToRemove !== undefined) {
        void BlockManager.removeBlock(blockToRemove, false);
      }
    };

    // Older test mocks may not expose transactForTool; fall through
    // gracefully in that case so unrelated suites keep working.
    if (typeof BlockManager.transactForTool === 'function') {
      BlockManager.transactForTool(runInsertPasses);
    } else {
      runInsertPasses();
    }
  }
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Any page can write this payload, so a carried url must be a safe href. */
const isCopyLink = (value: unknown): value is CopyLink =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { url?: unknown }).url === 'string' &&
  (value as { url: string }).url !== '' &&
  safeHref((value as { url: string }).url) !== null &&
  typeof (value as { text?: unknown }).text === 'string';

/**
 * Records each cell-referenced child id under its owning table.
 */
function collectCellChildIds(
  cell: unknown,
  tableId: string,
  childToTable: Map<string, string>
): void {
  if (
    typeof cell !== 'object' ||
    cell === null ||
    !Array.isArray((cell as { blocks?: unknown }).blocks)
  ) {
    return;
  }
  const ids = (cell as { blocks: unknown[] }).blocks;

  ids.forEach(childId => {
    if (typeof childId === 'string' && !childToTable.has(childId)) {
      childToTable.set(childId, tableId);
    }
  });
}

/**
 * Walks a clipboard table block's `data.content[r][c]` cells and records
 * every child id referenced by `cell.blocks` under its owning table.
 */
function collectTableCellRefs(
  block: BlokClipboardBlock,
  childToTable: Map<string, string>
): void {
  if (block.tool !== 'table' || block.id === undefined) {
    return;
  }
  const data = block.data as { content?: unknown } | undefined;
  const content = data?.content;

  if (!Array.isArray(content)) {
    return;
  }

  const tableId = block.id;

  content.forEach(row => {
    if (!Array.isArray(row)) {
      return;
    }
    row.forEach(cell => collectCellChildIds(cell, tableId, childToTable));
  });
}

/**
 * Backfills `parentId` on clipboard blocks that are referenced by a sibling
 * table's `data.content[r][c].blocks` array but never declare a parent of
 * their own. Idempotent — never overwrites an explicit parentId.
 */
function backfillTableChildParents(
  blocks: BlokClipboardBlock[]
): BlokClipboardBlock[] {
  const childToTable = new Map<string, string>();

  blocks.forEach(block => collectTableCellRefs(block, childToTable));

  if (childToTable.size === 0) {
    return blocks;
  }

  return blocks.map(block => {
    if (block.id === undefined) {
      return block;
    }
    const tableId = childToTable.get(block.id);

    if (tableId === undefined) {
      return block;
    }
    if (block.parentId !== undefined && block.parentId !== null) {
      return block;
    }

    return { ...block, parentId: tableId };
  });
}

/**
 * Recursively walks `value` and replaces any string found as a key in `idMap`
 * with its mapped value.  Used to remap old block IDs to new IDs within a
 * tool's data object before insertion, so that container blocks (e.g. tables)
 * reference the correct newly-inserted child block IDs.
 */
function remapIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return idMap.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map(item => remapIds(item, idMap));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = remapIds(v, idMap);
    }

    return result;
  }

  return value;
}
