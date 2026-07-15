/**
 * Blok Saver
 * @module Saver
 * @author Blok Team
 * @version 2.0.0
 */
import type { OutputData, SanitizerConfig } from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { SavedData, ValidatedData } from '../../../types/data-formats';
import { Module } from '../__module';
import type { Block } from '../block';
import { getBlokVersion, isEmpty, isObject, log, logLabeled } from '../utils';
import { collapseToLegacy, shouldCollapseToLegacy } from '../utils/data-model-transform';
import { validateHierarchy } from '../utils/hierarchy-invariant';
import { sanitizeBlocks } from '../utils/sanitizer';
import { normalizeInlineImages } from './normalizeInlineImages';

type SaverValidatedData = ValidatedData & {
  tunes?: Record<string, BlockTuneData>;
  /**
   * Parent block id for hierarchical structure (Notion-like flat-with-references model)
   */
  parentId?: string | null;
  /**
   * Array of child block ids (Notion-like flat-with-references model)
   */
  contentIds?: string[];
  /**
   * Timestamp of the last edit to this block
   */
  lastEditedAt?: number;
  /**
   * Identifier of the user who last edited this block
   */
  lastEditedBy?: string | null;
};

type SanitizableBlockData = SaverValidatedData & Pick<SavedData, 'data' | 'tool'>;

/**
 * @classdesc This method reduces all Blocks asyncronically and calls Block's save method to extract data
 * @typedef {Saver} Saver
 * @property {Element} html - Blok HTML content
 * @property {string} json - Blok JSON output
 */
export class Saver extends Module {
  /**
   * Stores the last error raised during save attempt
   */
  private lastSaveError?: unknown;

  /**
   * Stores the in-flight save promise for deduplication.
   * If a save is already in progress, subsequent calls return the same promise.
   */
  private pendingSave: Promise<OutputData | undefined> | null = null;

  /**
   * Composes new chain of Promises to fire them alternatelly.
   * Deduplicates concurrent calls — if a save is already in-flight, returns the same promise.
   * @returns {OutputData | undefined}
   */
  public async save(): Promise<OutputData | undefined> {
    if (this.isDestroyed) {
      return undefined;
    }

    if (this.pendingSave !== null) {
      return this.pendingSave;
    }

    this.pendingSave = this.doSave();

    try {
      return await this.pendingSave;
    } finally {
      this.pendingSave = null;
    }
  }

  /**
   * Internal save implementation.
   * Waits for any pending render to complete before reading blocks.
   * @returns {OutputData | undefined}
   */
  private async doSave(): Promise<OutputData | undefined> {
    // Wait for any in-progress render to complete before reading blocks
    const pendingRender = this.Blok.Renderer?.pendingRender;

    if (pendingRender !== null && pendingRender !== undefined) {
      await pendingRender;
    }

    // Check again after awaiting — editor may have been destroyed during the wait
    if (this.isDestroyed) {
      return undefined;
    }

    const { BlockManager, Tools } = this.Blok;
    const blocks = BlockManager.blocks;

    /**
     * If there is only one block and it is empty and it's the default tool, return empty blocks array.
     * Non-default blocks (like headers or lists created via shortcuts) should be preserved even when empty.
     */
    const shouldFilterSingleBlock = blocks.length === 1 && blocks[0].isEmpty && blocks[0].tool.isDefault;

    if (shouldFilterSingleBlock) {
      return {
        time: +new Date(),
        blocks: [],
        version: getBlokVersion(),
      };
    }

    /**
     * Dangling parentId repair pass (belt-and-braces).
     *
     * Before deriving content[] or running hierarchy validation, walk every
     * block and, if a block's parentId points at an id that does NOT exist in
     * the live blocks array, clear it in-memory. This promotes the orphan to
     * root-level — strictly better than emitting a dangling `parent` reference
     * downstream, which produces corrupted JSON for users. This is the final
     * exit ramp for the "container paste ejection" bug family: even if a
     * mutation path somewhere else regresses, the saver is physically incapable
     * of shipping output with a parent pointing to a non-existent block.
     */
    const blockIds = new Set(blocks.map(b => b.id));

    /**
     * Compute an EFFECTIVE parentId per block WITHOUT mutating the live model.
     *
     * save() is a read path — mutating `block.parentId` here diverges the
     * in-memory model from the Yjs source of truth (the repair never reaches
     * Yjs, and a later observe could re-apply the stale value) and makes save()
     * non-idempotent. So a block whose parentId dangles (points at an id not in
     * the live array) is treated as root-level for output purposes ONLY, via
     * this map; the live `block.parentId` is left untouched.
     */
    const effectiveParentId = new Map<string, string | null>();
    for (const block of blocks) {
      if (block.parentId !== null && !blockIds.has(block.parentId)) {
        logLabeled(`Saver: treating dangling parentId ${block.parentId} on block ${block.id} as root in output`, 'warn');
        effectiveParentId.set(block.id, null);
      } else {
        effectiveParentId.set(block.id, block.parentId);
      }
    }

    /**
     * Derive each parent's content[] from the live blocks array.
     *
     * `block.contentIds` is a mutable array kept in sync by hierarchy.setBlockParent,
     * but it can drift out of sync with `block.parentId` — e.g. when hierarchical data
     * is loaded with `parent` fields on children but no `content` on the parent,
     * insertMany does not reconcile the two. Downstream consumers
     * (notably collapseToLegacy's processRootCalloutItem) read `content[]` as the
     * source of truth for nesting, and any child missing from that array gets ejected
     * from its parent. Deriving content[] at save time from `parentId` makes the
     * invariant `child.parentId ⇒ parent.content.includes(child)` always hold.
     */
    const childrenByParent = new Map<string, string[]>();
    for (const block of blocks) {
      const parentId = effectiveParentId.get(block.id) ?? null;

      if (parentId === null) {
        continue;
      }
      const siblings = childrenByParent.get(parentId);
      if (siblings === undefined) {
        childrenByParent.set(parentId, [block.id]);
      } else {
        siblings.push(block.id);
      }
    }

    this.lastSaveError = undefined;

    try {
      /**
       * WYSIWYG order guard: the flat-array order of a container's children
       * must match their DOM order (what the user sees). See
       * {@link enforceDomOrderInvariant} for semantics — throws in dev/test,
       * repairs the output to DOM order in production.
       */
      const orderedBlocks = this.enforceDomOrderInvariant(blocks, effectiveParentId, childrenByParent);

      const chainData: Array<Promise<SaverValidatedData>> = orderedBlocks.map((block: Block) => {
        return this.getSavedData(
          block,
          childrenByParent.get(block.id) ?? [],
          effectiveParentId.get(block.id) ?? null
        );
      });

      const extractedData = await Promise.all(chainData);
      const sanitizedData = this.sanitizeExtractedData(
        extractedData,
        (name) => Tools.blockTools.get(name)?.sanitizeConfig,
        this.config.sanitizer as SanitizerConfig
      );

      const normalizedData = normalizeInlineImages(sanitizedData);

      /**
       * Table view-reference guard: every child of a table must be referenced
       * by a grid cell and every grid reference must resolve. See
       * {@link enforceTableViewReferenceInvariant} — throws in dev/test,
       * repairs the output in production.
       */
      const guardedData = this.enforceTableViewReferenceInvariant(normalizedData);

      /**
       * Table cell order guard: within each grid cell, the saved block order
       * must match the visible DOM order of the mounted holders. See
       * {@link enforceTableCellOrderInvariant} — throws in dev/test, repairs
       * the output in production.
       */
      const orderGuardedData = this.enforceTableCellOrderInvariant(guardedData);

      // Check destruction one more time after async block.save() operations
      if (this.isDestroyed) {
        return undefined;
      }

      return this.makeOutput(orderGuardedData);
    } catch (error: unknown) {
      this.lastSaveError = error;

      const normalizedError = error instanceof Error ? error : new Error(String(error));

      logLabeled(`Saving failed due to the Error %o`, 'error', normalizedError);

      return undefined;
    }
  }

  /**
   * Parents whose children's DOM order legitimately diverges from the flat
   * array: they render children through their own view layer (table cells by
   * grid coordinates, database rows by the active view's grouping/sort), so
   * the model order — not the DOM — is authoritative for them.
   */
  private static readonly DOM_ORDER_EXEMPT_PARENTS = new Set(['table', 'database']);

  /**
   * WYSIWYG order guard (regression family: "the image saved right under the
   * column title moved to the very bottom of the column after saving").
   *
   * The saver derives each parent's content[] and the output array order from
   * the FLAT blocks array, while the editor displays holders in DOM order. Any
   * code path that moves a holder in the DOM without moving the block in the
   * flat array (or vice versa) makes the saved document differ from what the
   * user sees — silent content reordering. The plus-button's raw DOM hoist was
   * one such path; this guard catches the whole class at the save boundary.
   *
   * For every parent whose children's holders are all connected and mounted
   * inside the parent's own holder (and whose tool does not own its child DOM
   * order — see {@link DOM_ORDER_EXEMPT_PARENTS}), the children's flat order
   * must match their DOM document order. On divergence:
   *   - test/dev: THROW so the offending mutation path is fixed before it ships.
   *   - production: repair the OUTPUT to the DOM order — what the user actually
   *     saw — and log an error. The live model is left untouched (save() is a
   *     read path).
   * @param blocks - live flat blocks snapshot
   * @param effectiveParentId - per-block parent id used for output
   * @param childrenByParent - derived children map; repaired in place in production
   * @returns the block array to serialize (repaired copy in production, input otherwise)
   */
  private enforceDomOrderInvariant(
    blocks: Block[],
    effectiveParentId: Map<string, string | null>,
    childrenByParent: Map<string, string[]>
  ): Block[] {
    const blockById = new Map(blocks.map(block => [block.id, block]));
    const repairs = new Map<string, string[]>();

    for (const [parentId, childIds] of childrenByParent) {
      const parent = blockById.get(parentId);

      if (parent === undefined || childIds.length < 2 || Saver.DOM_ORDER_EXEMPT_PARENTS.has(parent.name)) {
        continue;
      }

      const parentHolder: unknown = parent.holder;

      if (!(parentHolder instanceof HTMLElement) || !parentHolder.isConnected) {
        continue;
      }

      const children = childIds.map(id => blockById.get(id));
      const comparable = children.every((child): child is Block =>
        child !== undefined &&
        child.holder instanceof HTMLElement &&
        child.holder.isConnected &&
        parentHolder.contains(child.holder));

      if (!comparable) {
        continue;
      }

      const domSorted = [...children].sort((a, b) => {
        if (a.holder === b.holder) {
          return 0;
        }

        return (a.holder.compareDocumentPosition(b.holder) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
      });
      const domSortedIds = domSorted.map(child => child.id);

      if (domSortedIds.some((id, index) => id !== childIds[index])) {
        repairs.set(parentId, domSortedIds);
      }
    }

    if (repairs.size === 0) {
      return blocks;
    }

    const message =
      `Saver: children of block(s) ${[...repairs.keys()].join(', ')} are saved in a different order than their DOM order — ` +
      'a mutation path moved a holder in the DOM without moving the block in the flat array (or vice versa), ' +
      'so the saved document would not match what the user sees.';
    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    if (nodeEnv === 'test' || nodeEnv === 'development') {
      throw new Error(message);
    }

    logLabeled(message, 'error');

    // Production repair: within each affected parent, permute the children's
    // flat positions to the DOM order. Only within-group order matters
    // downstream (renderers mount children by per-parent flat filtering), so
    // the group's positions in the array are reused as-is.
    const repaired = [...blocks];

    for (const [parentId, domSortedIds] of repairs) {
      const groupPositions: number[] = [];

      repaired.forEach((block, index) => {
        if (effectiveParentId.get(block.id) === parentId) {
          groupPositions.push(index);
        }
      });

      groupPositions.forEach((position, k) => {
        const block = blockById.get(domSortedIds[k]);

        if (block !== undefined) {
          repaired[position] = block;
        }
      });

      childrenByParent.set(parentId, domSortedIds);
    }

    return repaired;
  }

  /**
   * Table view-reference guard (regression family: "Cmd+Z in a table, then
   * save → the table's text reappears line-by-line under the table").
   *
   * A table renders its children exclusively through its grid — `data.content`
   * cells hold the block-id lists. Any child of a table that no cell
   * references is INVISIBLE in the editor but still emitted by the saver, so
   * it resurfaces below the table on the consumer's next render as an
   * unremovable ghost paragraph. The inverse drift — a cell referencing a
   * block that does not exist — renders as an unfillable hole. Both are the
   * signature of a rebuild path (undo/redo replay, remote sync, readonly
   * toggle) desyncing the grid from the flat model.
   *
   * The mount-side fix lives in TableCellBlocks (own blocks stranded in a
   * previous render's grid are re-mounted, not duplicated); this guard is the
   * save-boundary backstop that catches the WHOLE class, including future
   * vectors:
   *   - test/dev: THROW so the offending mutation path is fixed before it ships.
   *   - production: repair the OUTPUT to what the user actually saw and log an
   *     error. An orphan child whose holder is disconnected is invisible →
   *     pruned; a connected orphan is visible somewhere → promoted to root so
   *     it stays a normal, selectable block. Dangling grid references are
   *     removed from the emitted table data. The live model is left untouched
   *     (save() is a read path).
   *
   * Legacy string-cell tables are skipped — they carry no block references.
   * @param extracted - saved data for all blocks, post-sanitization
   * @returns the array to serialize (repaired copy in production, input otherwise)
   */
  /**
   * Extracts the set of block ids referenced by a saved table's grid cells.
   * Returns null when the table carries no validatable references — a
   * malformed/absent grid or legacy string cells.
   * @param item - a saved block whose tool is 'table'
   */
  private static tableGridRefs(item: SaverValidatedData): Set<string> | null {
    const content = (item.data as { content?: unknown } | undefined)?.content;

    if (!Array.isArray(content) || !content.every(row => Array.isArray(row))) {
      return null;
    }

    const cells = (content as unknown[][]).flat();

    // Legacy string cell → this table has no block references to validate.
    if (cells.some(cell => typeof cell === 'string')) {
      return null;
    }

    return new Set(cells.flatMap(cell => {
      const blocks = (cell as { blocks?: unknown } | null)?.blocks;

      return Array.isArray(blocks) ? blocks.filter((id): id is string => typeof id === 'string') : [];
    }));
  }

  /**
   * Production-repair helper for {@link enforceTableViewReferenceInvariant}:
   * removes grid references to blocks missing from the saved output.
   * @param item - the saved table block to repair
   * @param savedIds - ids of all blocks present in the saved output
   */
  private static pruneDanglingGridRefs(item: SaverValidatedData, savedIds: Set<string>): SaverValidatedData {
    const content = (item.data as { content?: unknown[][] }).content ?? [];
    const pruneCell = (cell: unknown): unknown => {
      const blocks = (cell as { blocks?: unknown } | null)?.blocks;

      if (!Array.isArray(blocks)) {
        return cell;
      }

      return {
        ...(cell as Record<string, unknown>),
        blocks: blocks.filter(id => typeof id === 'string' && savedIds.has(id)),
      };
    };

    return {
      ...item,
      data: {
        ...(item.data as Record<string, unknown>),
        content: content.map(row => row.map(pruneCell)),
      } as SaverValidatedData['data'],
    };
  }

  private enforceTableViewReferenceInvariant(extracted: SaverValidatedData[]): SaverValidatedData[] {
    const savedIds = new Set(extracted.map(item => item.id).filter((id): id is string => typeof id === 'string'));
    const liveBlockById = new Map(this.Blok.BlockManager.blocks.map(block => [block.id, block]));
    const problems: string[] = [];
    /** Orphan child ids → whether their holder is still connected (visible). */
    const orphanVisibility = new Map<string, boolean>();
    /** Table item ids that carry at least one dangling grid reference. */
    const tablesWithDanglingRefs = new Set<string>();

    for (const item of extracted) {
      if (item.tool !== 'table' || typeof item.id !== 'string') {
        continue;
      }

      const refs = Saver.tableGridRefs(item);

      if (refs === null) {
        continue;
      }

      const danglingRefs = [...refs].filter(ref => !savedIds.has(ref));

      if (danglingRefs.length > 0) {
        problems.push(...danglingRefs.map(ref => `table ${item.id} grid references missing block ${ref}`));
        tablesWithDanglingRefs.add(item.id);
      }

      const tableId = item.id;
      const orphanIds = extracted
        .filter(child => child.parentId === tableId)
        .map(child => child.id)
        .filter((id): id is string => typeof id === 'string')
        .filter(id => !refs.has(id));

      for (const orphanId of orphanIds) {
        const liveHolder: unknown = liveBlockById.get(orphanId)?.holder;
        const isVisible = liveHolder instanceof HTMLElement && liveHolder.isConnected;

        problems.push(`block ${orphanId} is a child of table ${tableId} but is not referenced by any cell (${isVisible ? 'visible' : 'invisible'} ghost)`);
        orphanVisibility.set(orphanId, isVisible);
      }
    }

    if (problems.length === 0) {
      return extracted;
    }

    const message =
      `Saver: table children diverge from their grid references — a rebuild path desynced the table view from the flat model. ${problems.join('; ')}`;
    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    if (nodeEnv === 'test' || nodeEnv === 'development') {
      throw new Error(message);
    }

    logLabeled(message, 'error');

    // Production repair — emit what the user actually saw.
    const droppedIds = new Set(
      [...orphanVisibility.entries()].filter(([, visible]) => !visible).map(([id]) => id)
    );

    return extracted
      .filter(item => typeof item.id !== 'string' || !droppedIds.has(item.id))
      .map(item => {
        const isVisibleOrphan = typeof item.id === 'string' && orphanVisibility.get(item.id) === true;
        const hasOrphanContentIds = item.contentIds !== undefined && item.contentIds.some(id => orphanVisibility.has(id));
        const base: SaverValidatedData = {
          ...item,
          ...(isVisibleOrphan && { parentId: null }),
          ...(hasOrphanContentIds && { contentIds: item.contentIds?.filter(id => !orphanVisibility.has(id)) }),
        };

        return typeof base.id === 'string' && tablesWithDanglingRefs.has(base.id)
          ? Saver.pruneDanglingGridRefs(base, savedIds)
          : base;
      });
  }

  /**
   * Table cell order guard (regression family: "images inserted at the top of
   * a table cell moved to the bottom of the cell after saving").
   *
   * A table's per-cell block lists (`data.content[row][col].blocks`) are the
   * saved order, but they live in the tool's own model — invisible to
   * {@link enforceDomOrderInvariant} (tables are DOM_ORDER_EXEMPT) and to
   * {@link enforceTableViewReferenceInvariant} (which checks membership, not
   * order). Table.save() repairs its own order divergence, but silently — a
   * future regression there would ship unseen. This guard is the independent
   * save-boundary backstop for the ORDER half of the invariant:
   *   - test/dev: THROW so the offending mutation path is fixed before it ships.
   *   - production: repair the emitted cell order to the DOM order — what the
   *     user actually saw — and log an error. The live model is untouched.
   *
   * A cell is only comparable when EVERY referenced holder is connected and
   * mounted inside the same cell-blocks container; transitional states (block
   * mid-insert, detached grid) keep the model order.
   * @param extracted - saved data for all blocks, post view-reference guard
   * @returns the array to serialize (repaired copy in production, input otherwise)
   */
  private enforceTableCellOrderInvariant(extracted: SaverValidatedData[]): SaverValidatedData[] {
    const liveBlockById = new Map(this.Blok.BlockManager.blocks.map(block => [block.id, block]));

    /**
     * Returns the cell's block ids sorted by the DOM order of their mounted
     * holders, or null when the cell is not comparable (any holder missing,
     * disconnected, or mounted in a different cell container).
     */
    const domOrderOf = (blockIds: string[]): string[] | null => {
      const holders = blockIds.map(id => {
        const holder: unknown = liveBlockById.get(id)?.holder;

        return holder instanceof HTMLElement && holder.isConnected ? holder : null;
      });

      if (holders.some(holder => holder === null)) {
        return null;
      }

      const containers = holders.map(holder => (holder as HTMLElement).closest('[data-blok-table-cell-blocks]'));

      if (containers[0] === null || containers.some(container => container !== containers[0])) {
        return null;
      }

      return blockIds
        .map((id, index) => ({ id, holder: holders[index] as HTMLElement }))
        .sort((a, b) => {
          if (a.holder === b.holder) {
            return 0;
          }

          return (a.holder.compareDocumentPosition(b.holder) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
        })
        .map(entry => entry.id);
    };

    const problems: string[] = [];
    /** table item id → per-cell repairs keyed by "row:col". */
    const repairsByTable = new Map<string, Map<string, string[]>>();

    for (const item of extracted) {
      if (item.tool !== 'table' || typeof item.id !== 'string' || Saver.tableGridRefs(item) === null) {
        continue;
      }

      const tableId = item.id;
      const content = (item.data as { content?: unknown[][] }).content ?? [];

      content.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
        const blocks = (cell as { blocks?: unknown } | null)?.blocks;

        if (!Array.isArray(blocks) || blocks.length < 2 || !blocks.every((id): id is string => typeof id === 'string')) {
          return;
        }

        const domSorted = domOrderOf(blocks);

        if (domSorted === null || domSorted.every((id, index) => id === blocks[index])) {
          return;
        }

        problems.push(`table ${tableId} cell [${rowIndex},${colIndex}] saves order [${blocks.join(', ')}] but the DOM shows [${domSorted.join(', ')}]`);

        const cellRepairs = repairsByTable.get(tableId) ?? new Map<string, string[]>();

        cellRepairs.set(`${rowIndex}:${colIndex}`, domSorted);
        repairsByTable.set(tableId, cellRepairs);
      }));
    }

    if (problems.length === 0) {
      return extracted;
    }

    const message =
      `Saver: table cell block order diverges from the DOM order — a mutation path changed a cell's visible order without updating the table model, so the saved document would not match what the user sees. ${problems.join('; ')}`;
    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    if (nodeEnv === 'test' || nodeEnv === 'development') {
      throw new Error(message);
    }

    logLabeled(message, 'error');

    // Production repair — emit each diverged cell in the order the user saw.
    return extracted.map(item => {
      const cellRepairs = typeof item.id === 'string' ? repairsByTable.get(item.id) : undefined;

      if (cellRepairs === undefined) {
        return item;
      }

      const content = (item.data as { content?: unknown[][] }).content ?? [];
      const repairedContent = content.map((row, rowIndex) => row.map((cell, colIndex) => {
        const repairedBlocks = cellRepairs.get(`${rowIndex}:${colIndex}`);

        return repairedBlocks === undefined
          ? cell
          : { ...(cell as Record<string, unknown>), blocks: repairedBlocks };
      }));

      return {
        ...item,
        data: {
          ...(item.data as Record<string, unknown>),
          content: repairedContent,
        } as SaverValidatedData['data'],
      };
    });
  }

  /**
   * Saves and validates
   * @param block - block to save
   * @param derivedContentIds - content ids computed from live children's parentId
   *        (source of truth, see doSave for rationale)
   * @param effectiveParentId - parentId to emit in output; a dangling parent is
   *        passed as null so the orphan ships at root WITHOUT mutating the block
   */
  private async getSavedData(
    block: Block,
    derivedContentIds: string[],
    effectiveParentId: string | null
  ): Promise<SaverValidatedData> {
    const blockData = await block.save();
    const toolName = block.name;
    const normalizedData = blockData?.data !== undefined
      ? blockData
      : this.getPreservedSavedData(block);

    if (normalizedData === undefined) {
      return {
        tool: toolName,
        isValid: false,
      };
    }

    const isValid = await block.validate(normalizedData.data);

    return {
      ...normalizedData,
      isValid,
      parentId: effectiveParentId,
      contentIds: derivedContentIds,
      lastEditedAt: block.lastEditedAt,
      lastEditedBy: block.lastEditedBy,
    };
  }

  /**
   * Creates output object with saved data, time and version of blok
   * @param {ValidatedData} allExtractedData - data extracted from Blocks
   * @returns {OutputData}
   */
  private makeOutput(allExtractedData: SaverValidatedData[]): OutputData {
    const extractedBlocks: OutputData['blocks'] = [];

    allExtractedData.forEach(({ id, tool, data, tunes, isValid, parentId, contentIds, lastEditedAt, lastEditedBy }) => {
      const hasParent = parentId !== undefined && parentId !== null;

      if (!isValid && !hasParent) {
        log(`Block «${tool}» skipped because saved data is invalid`);

        return;
      }

      if (tool === undefined || data === undefined) {
        log('Block skipped because saved data is missing required fields');

        return;
      }

      /** If it was stub Block, get original data */
      if (tool === this.Blok.Tools.stubTool && this.isStubSavedData(data)) {
        extractedBlocks.push(data);

        return;
      }

      if (tool === this.Blok.Tools.stubTool) {
        log('Stub block data is malformed and was skipped');

        return;
      }

      const isTunesEmpty = tunes === undefined || isEmpty(tunes);
      const hasContent = contentIds !== undefined && contentIds.length > 0;
      const hasLastEdited = lastEditedAt !== undefined;
      const hasLastEditedBy = lastEditedBy !== undefined && lastEditedBy !== null;

      const output: OutputData['blocks'][number] = {
        id,
        type: tool,
        data,
        ...!isTunesEmpty && {
          tunes,
        },
        ...hasParent && {
          parent: parentId,
        },
        ...hasContent && {
          content: contentIds,
        },
        ...hasLastEdited && {
          lastEditedAt,
        },
        ...hasLastEditedBy && {
          lastEditedBy,
        },
      };

      extractedBlocks.push(output);
    });

    // Apply data model transformation if needed
    const dataModelConfig = this.config.dataModel || 'auto';
    const detectedInputFormat = this.Blok.Renderer?.getDetectedInputFormat?.() ?? 'flat';

    const finalBlocks = shouldCollapseToLegacy(dataModelConfig, detectedInputFormat)
      ? collapseToLegacy(extractedBlocks)
      : extractedBlocks;

    // Defense-in-depth: assert the parent/content invariant on the final output
    // in test/dev builds. Any drift here means a mutation path elsewhere is
    // leaking inconsistent state through every reconciliation layer — that is
    // the exact failure mode behind the callout paste ejection bug family.
    // Throwing in test flushes the regression out of any future refactor; in
    // production we only log, so an edge-case drift never breaks user saves.
    const violations = validateHierarchy(finalBlocks);

    if (violations.length > 0) {
      const summary = violations.map(v => v.message).join('; ');
      const message = `Saver produced output with hierarchy drift: ${summary}`;
      const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

      // Throw in test AND development so manual dev-time testing (yarn serve)
      // flushes drift out immediately. Only production silently logs so an
      // edge-case drift never breaks end-user saves.
      if (nodeEnv === 'test' || nodeEnv === 'development') {
        throw new Error(message);
      }
      logLabeled(message, 'error');
    }

    return {
      time: +new Date(),
      blocks: finalBlocks,
      version: getBlokVersion(),
    };
  }

  /**
   * Sanitizes extracted block data in-place
   * @param extractedData - collection of saved block data
   * @param getToolSanitizeConfig - resolver for tool-specific sanitize config
   * @param globalSanitizer - global sanitizer config specified in blok settings
   */
  private sanitizeExtractedData(
    extractedData: SaverValidatedData[],
    getToolSanitizeConfig: (toolName: string) => SanitizerConfig | undefined,
    globalSanitizer: SanitizerConfig
  ): SaverValidatedData[] {
    const blocksToSanitize: Array<{ index: number; data: SanitizableBlockData }> = [];

    extractedData.forEach((blockData, index) => {
      if (this.hasSanitizableData(blockData)) {
        blocksToSanitize.push({
          index,
          data: blockData,
        });
      }
    });

    if (blocksToSanitize.length === 0) {
      return extractedData;
    }

    const sanitizedBlocks = sanitizeBlocks(
      blocksToSanitize.map(({ data }) => data),
      getToolSanitizeConfig,
      globalSanitizer
    );

    const updatedData = extractedData.map((blockData) => ({ ...blockData }));

    blocksToSanitize.forEach(({ index }, sanitizedIndex) => {
      const sanitized = sanitizedBlocks[sanitizedIndex];

      updatedData[index] = {
        ...updatedData[index],
        data: sanitized.data,
      };
    });

    return updatedData;
  }

  /**
   * Checks whether block data contains fields required for sanitizing procedure
   * @param blockData - data to check
   */
  private hasSanitizableData(blockData: SaverValidatedData): blockData is SanitizableBlockData {
    return blockData.data !== undefined && typeof blockData.tool === 'string';
  }

  /**
   * Check that stub data matches OutputBlockData format
   * @param data - saved stub data that should represent original block payload
   */
  private isStubSavedData(data: unknown): data is OutputData['blocks'][number] {
    if (!isObject(data)) {
      return false;
    }

    const candidate = data;

    return typeof candidate.type === 'string' && candidate.data !== undefined;
  }

  /**
   * Returns the last error raised during save attempt
   */
  public getLastSaveError(): unknown {
    return this.lastSaveError;
  }

  /**
   * Returns the last successfully extracted data for the provided block, if any.
   * @param block - block whose preserved data should be returned
   */
  private getPreservedSavedData(block: Block): (SavedData & { tunes?: Record<string, BlockTuneData> }) | undefined {
    const preservedData = block.preservedData;

    if (isEmpty(preservedData)) {
      return undefined;
    }

    const preservedTunes = block.preservedTunes;

    return {
      id: block.id,
      tool: block.name,
      data: preservedData,
      ...( isEmpty(preservedTunes) ? {} : { tunes: preservedTunes }),
      time: 0,
    };
  }
}
