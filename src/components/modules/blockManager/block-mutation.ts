/**
 * @class BlockMutation
 * @classdesc In-place block mutations: update, replace, move, merge and convert.
 * @module BlockMutation
 */
import type { BlockToolData, SanitizerConfig } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import type { Block } from '../../block';
import type { BlockToolAdapter } from '../../tools/block';
import { isEmpty, isObject, isString, log } from '../../utils';
import { announce } from '../../utils/announcer';
import { convertStringToBlockData, isBlockConvertable } from '../../utils/blocks';
import { isChildToolAllowed } from '../../utils/child-tools';
import { canAdoptChild, releasesChildrenOnTurnInto } from '../../utils/turn-into-children';
import { sanitizeBlocks, clean, composeSanitizerConfig, stripUnsafeUrlsDeep } from '../../utils/sanitizer';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import { ToolNotFoundError } from '../../errors/tool-not-found';
import { getBlockNestingDepth } from '../drag/utils/depthUtils';
import type { BlockFactory } from './factory';
import type { BlockHierarchy } from './hierarchy';
import type { BlockRepository } from './repository';
import type { BlockDidMutated, BlockOperationsDependencies, OperationsContext } from './operations-context';
import type { BlocksStore } from './types';
import type { BlockYjsSync } from './yjs-sync';

/**
 * The CHARACTERS a stored HTML string renders as, with entity spellings and
 * tags removed.
 *
 * Parsed through a `<template>`, whose content lives in an inert document: an
 * `<img src=x onerror=…>` in a peer's payload never loads here (the
 * detached-innerHTML parse DOES fire it, which is why this is not a plain
 * `div`).
 * @param value - a stored HTML string
 * @returns its text content, or the value itself when there is nothing to parse
 */
const textContentOf = (value: string): string => {
  if (typeof document === 'undefined' || (!value.includes('<') && !value.includes('&'))) {
    return value;
  }

  const template = document.createElement('template');

  template.innerHTML = value;

  return template.content.textContent ?? '';
};

/**
 * Handles in-place mutations of existing blocks: data/tune updates, tool
 * replacement, reordering, merging and conversion. Reads/writes shared state
 * via the OperationsContext.
 */
export class BlockMutation {
  private readonly ctx: OperationsContext;

  /**
   * @param ctx - Shared operations context (state + cross-cutting helpers)
   */
  constructor(ctx: OperationsContext) {
    this.ctx = ctx;
  }

  private get dependencies(): BlockOperationsDependencies {
    return this.ctx.dependencies;
  }

  private get repository(): BlockRepository {
    return this.ctx.repository;
  }

  private get factory(): BlockFactory {
    return this.ctx.factory;
  }

  private get hierarchy(): BlockHierarchy {
    return this.ctx.hierarchy;
  }

  private get yjsSync(): BlockYjsSync {
    return this.ctx.yjsSync;
  }

  private get blockDidMutated(): BlockDidMutated {
    return this.ctx.blockDidMutated;
  }

  /**
   * Update Block data
   * @param block - Block to update
   * @param blocksStore - The blocks store to modify
   * @param data - New data
   * @param tunes - New tune data
   */
  public async update(block: Block, blocksStore: BlocksStore, data?: Partial<BlockToolData>, tunes?: { [name: string]: BlockTuneData }): Promise<Block> {
    if (!data && !tunes) {
      return block;
    }

    /**
     * Snapshot the document's own copy of the data BEFORE any await, so the
     * keys a peer changes while we read can be told apart from the keys that
     * were already there. See `composeWrite`.
     */
    const before = this.readDocumentData(block.id);

    /**
     * Layer 16: stale-source guard (regression: wrong-block-dropped family).
     *
     * Reading the data is async — during that await, `block` can be removed
     * by a Yjs remote delete, undo/redo, or tool conversion. When that happens
     * `blocksStore.replace(-1, newBlock)` throws `Incorrect index`, aborting
     * the surrounding batch mid-flight and leaving the flat blocks array
     * inconsistent with the DOM — exactly the stale-state condition that lets
     * drag drop an unrelated block.
     *
     * Abort cleanly: return the original block with no mutation or Yjs side
     * effects. `readLive` revalidates AFTER the await, not before, so the guard
     * covers the full async gap — and revalidates by ID, see `resolveLive`.
     */
    const source = await this.readLive(block);

    if (source === null) {
      return block;
    }

    const liveBlock = source.block;

    /**
     * Prefer the Tool's own in-place update over recomposing the Block.
     *
     * Recomposing means a NEW Block: a new tool instance, a new holder, and the
     * old instance destroyed right after. Every piece of state the tool holds
     * outside its data dies with it — for an adapter-authored block (React /
     * Vue / Angular) that is the mounted component and its portal, so a host
     * calling `api.blocks.update()` per keystroke was left with a permanently
     * empty holder. Keeping the Block alive also keeps its children attached
     * and the caret where the user put it.
     *
     * Tunes stay on the recompose path: they are instantiated during Block
     * construction, so there is nothing to update in place (same reasoning as
     * the Yjs replay path in yjs-sync.ts).
     *
     * The gate is the TOOL's declaration (`setData` on its prototype), never
     * `block.setData` — every Block has that method, and its innerHTML fallback
     * would silently swallow updates for tools that implement nothing.
     */
    // `composeWrite` is evaluated by the short-circuit, so it runs
    // synchronously one statement before `setData` writes the Tool's DOM.
    const inPlaceData = tunes === undefined && liveBlock.tool.supportsInPlaceSetData
      ? this.composeWrite(block.id, liveBlock.name, source.data, before, data)
      : undefined;
    const appliedInPlace = inPlaceData !== undefined && await liveBlock.setData(inPlaceData);

    if (appliedInPlace) {
      /**
       * `await block.setData` runs TOOL code, so it reopens the stale-source
       * window the guard above closes: resolve again and abort silently only
       * when the block was removed while the Tool applied the data.
       */
      const applied = this.resolveLive(block);

      if (applied === null) {
        return block;
      }

      this.blockDidMutated(BlockChangedMutationType, applied.block, {
        index: applied.index,
      });

      this.writeNormalization(block.id, inPlaceData, before, data);
      this.syncDataToYjs(block.id, data);

      return applied.block;
    }

    // `setData` above is awaited whenever the tool declares it, so the index
    // must be resolved once more before it drives `blocksStore.replace`.
    const target = this.resolveLive(block);

    if (target === null) {
      return block;
    }

    // Composed synchronously, immediately before the write — see `composeWrite`.
    const mergedData = this.composeWrite(block.id, target.block.name, source.data, before, data);

    const newBlock = this.factory.composeBlock({
      id: target.block.id,
      tool: target.block.name,
      data: mergedData,
      tunes: tunes ?? target.block.preservedTunes,
      parentId: target.block.parentId ?? undefined,
      contentIds: target.block.contentIds.length > 0 ? [...target.block.contentIds] : undefined,
      bindEventsImmediately: true,
    });

    const oldHolder = target.block.holder;

    blocksStore.replace(target.index, newBlock);

    // The swap takes the child slot with the old holder: re-seat every
    // descendant left in it, depth-first, so each finds its new home slot.
    const reseat = (parentId: string, visited: Set<string>): void => {
      if (visited.has(parentId)) {
        return;
      }
      visited.add(parentId);

      for (const childId of this.repository.getBlockById(parentId)?.contentIds ?? []) {
        const child = this.repository.getBlockById(childId);

        if (child === undefined) {
          continue;
        }
        if (oldHolder.contains(child.holder)) {
          this.hierarchy.setBlockParent(child, parentId);
        }
        reseat(childId, visited);
      }
    };

    reseat(newBlock.id, new Set<string>());

    this.blockDidMutated(BlockChangedMutationType, newBlock, {
      index: target.index,
    });

    this.writeNormalization(block.id, mergedData, before, data);
    this.syncDataToYjs(block.id, data);

    // Sync changed tunes to Yjs (`!= null` — callers may pass a literal null)
    if (tunes != null) {
      for (const [tuneName, tuneData] of Object.entries(tunes)) {
        this.dependencies.YjsManager.updateBlockTune(block.id, tuneName, tuneData);
      }
    }

    return newBlock;
  }

  /**
   * Read a block's data as the SHARED DOCUMENT currently holds it, without
   * flushing anything. Synchronous, so a value read here cannot go stale
   * before the caller's next synchronous statement: a peer's update reaches
   * the document through `applyRemoteUpdate`, which can only run between
   * tasks.
   * @param blockId - id of the block to read
   * @returns the block's data as a plain object, or undefined when the document has no such block
   */
  private readDocumentData(blockId: string): Record<string, unknown> | undefined {
    const yblock = this.dependencies.YjsManager.getBlockById(blockId);
    const yData = yblock?.get('data');

    return yData === undefined || yData === null
      ? undefined
      : this.dependencies.YjsManager.yMapToObject(yData as Parameters<typeof this.dependencies.YjsManager.yMapToObject>[0]);
  }

  /**
   * Keys of `blockId` whose value in the shared document CHANGED since
   * `before` was snapshotted, with their current values.
   *
   * This sees EVERY write that reached the document, not only a peer's: this
   * client's own write-buffer flush landing between the two snapshots shows up
   * here exactly like a remote keystroke, because nothing in a Y.Map read says
   * who wrote it. So drift means "the document moved", never "a peer typed" —
   * whoever needs to tell those apart must compare CONTENT, as
   * {@link readCarriesDocumentContent} does, not merely observe a change.
   * @param blockId - id of the block to compare
   * @param before - snapshot taken before the awaits (see `readDocumentData`)
   * @returns the changed keys and their current values; empty when nothing drifted
   */
  private documentDrift(blockId: string, before: Record<string, unknown> | undefined): Record<string, unknown> {
    const after = this.readDocumentData(blockId);

    if (before === undefined || after === undefined) {
      return {};
    }

    const drift: Record<string, unknown> = {};

    for (const key of Object.keys(after)) {
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
        drift[key] = after[key];
      }
    }

    return drift;
  }

  /**
   * Build the data an API call is about to WRITE, so it carries only what the
   * caller asked to change.
   *
   * `snapshot` was read across an await, so every key in it may predate a
   * peer's keystroke. Writing it back — into the Tool's DOM, which the
   * MutationObserver then syncs key by key — is what DELETED the peer's
   * characters: the minimal Y.Text diff turns a stale string into a deletion.
   *
   * So the keys the caller did NOT name are refreshed from the document right
   * here, synchronously, one statement before the write. That closes the
   * window rather than narrowing it: nothing can land between this read and
   * the write, because a remote update only arrives between tasks. The
   * caller's own keys always win — those are the ones it means to change.
   *
   * A key the document DROPPED counts as a refresh too. It is absent from the
   * post-await read, so an overlay alone would write the snapshot's stale copy
   * back and resurrect it — and `pruneBlockData`/`deepAssignYMap` really do
   * delete keys. Dropping it here is what makes "closes the window" true for
   * deletion as well as for mutation.
   * @param blockId - id of the block being written
   * @param tool - tool the composed data will be rendered with (drives sanitize)
   * @param snapshot - the data as read across the await
   * @param before - document snapshot taken before that await
   * @param patch - the keys the caller asked to change
   * @returns data safe to hand to `setData`/`composeBlock`
   */
  private composeWrite(
    blockId: string,
    tool: string,
    snapshot: BlockToolData,
    before: Record<string, unknown> | undefined,
    patch?: Partial<BlockToolData>
  ): BlockToolData {
    const drift = this.documentDrift(blockId, before);
    const composed = Object.assign({}, snapshot, this.sanitizeDocumentData(tool, drift), patch ?? {});
    const dropped = new Set(
      this.documentDeletions(blockId, before).filter((key) => patch === undefined || !(key in patch))
    );

    return Object.fromEntries(
      Object.entries(composed).filter(([key]) => !dropped.has(key))
    );
  }

  /**
   * Keys `blockId` HAD in the shared document when `before` was snapshotted and
   * no longer has.
   *
   * Separate from {@link documentDrift} because a removal has no value to
   * overlay — the only way to honour it is to drop the key.
   * @param blockId - id of the block to compare
   * @param before - snapshot taken before the awaits (see `readDocumentData`)
   * @returns the removed keys; empty when either snapshot is missing
   */
  private documentDeletions(blockId: string, before: Record<string, unknown> | undefined): string[] {
    const after = this.readDocumentData(blockId);

    if (before === undefined || after === undefined) {
      return [];
    }

    return Object.keys(before).filter((key) => !(key in after));
  }

  /**
   * Launder values read straight out of the shared document before they reach
   * a Tool's render.
   *
   * Mirror of `BlockYjsSync.sanitizeToolData` / `Renderer.sanitizeToolData`:
   * every other document->DOM path runs the tool's sanitize config plus the
   * global one, then the URL-scheme pass. The document is peer-writable, so a
   * raw value overlaid here would render a hostile peer's markup — the same
   * payload the reconciler strips on every other path.
   *
   * Bare url-ish VALUES (`data.url = 'javascript:…'`) are deliberately not
   * touched, exactly as on those paths: `stripUnsafeUrls` only rewrites
   * `href`/`src` inside markup, and the tools that render a stored url guard
   * the scheme themselves (`src/tools/file/url.ts`, `link/bookmark`,
   * `image/download.ts`). Diverging here would make one write path strip data
   * the document keeps everywhere else.
   * @param tool - tool name the data will be rendered with
   * @param data - values read from the shared document
   * @returns the same keys, safe to render
   */
  private sanitizeDocumentData(tool: string, data: Record<string, unknown>): BlockToolData {
    const toolSanitizeConfig = this.factory.getTool(tool)?.sanitizeConfig;

    const [sanitized] = sanitizeBlocks(
      [{ tool,
        data }],
      () => toolSanitizeConfig,
      this.dependencies.config.sanitizer
    );

    return stripUnsafeUrlsDeep(sanitized.data, toolSanitizeConfig);
  }

  /**
   * Resolve the Block instance for `block.id` that is CURRENTLY in the store,
   * with its index.
   *
   * Every re-read after an `await` must go through here instead of
   * `getBlockIndex(block)`. That lookup is by OBJECT IDENTITY, and the Yjs
   * reconciler REPLACES a Block (same id, a brand-new instance) when it applies
   * a peer's keystroke — so "the peer deleted this block" and "the peer typed a
   * character" both read as -1, and the caller's `update()`/`convert()` was
   * silently discarded. Only an id that is gone from the store is a removal.
   * @param block - the possibly stale Block reference the caller passed in
   * @returns the live Block and its index, or null when the id left the store
   */
  private resolveLive(block: Block): { block: Block; index: number } | null {
    const live = this.repository.getBlockById(block.id) ?? block;
    const index = this.repository.getBlockIndex(live);

    return index === -1 ? null : { block: live,
      index };
  }

  /**
   * Read the data of the instance that is CURRENTLY in the store for
   * `block.id`, together with that instance and its index.
   *
   * The read itself is the staleness window: when the reconciler swaps the
   * Block while it resolves, the value read belongs to the PRE-swap instance
   * and predates the peer's edit, so it is read again from the survivor. That
   * second read reopens the same window, hence the final resolve.
   * @param block - the possibly stale Block reference the caller passed in
   * @returns the live Block, its index and its data, or null when the id left the store
   */
  private async readLive(block: Block): Promise<{ block: Block; index: number; data: BlockToolData } | null> {
    const initialData = await block.data;
    const first = this.resolveLive(block);

    if (first === null) {
      return null;
    }

    if (first.block === block) {
      return { ...first,
        data: initialData };
    }

    const refreshedData = await first.block.data;
    const settled = this.resolveLive(block);

    return settled === null
      ? null
      : { ...settled,
        data: refreshedData };
  }

  /**
   * Write the keys the caller did NOT name, as the tool now holds them, to the
   * shared document, untracked. They differ only where the tool normalised the
   * document's data (a legacy shape). The block's next full-save flush would
   * add them tracked and prune the legacy keys untracked, so undo took the
   * patch back to a document that had lost the legacy keys it was derived from.
   * @param blockId - id of the updated block
   * @param composed - the data the block was given (see `composeWrite`)
   * @param before - document snapshot taken before the awaits; a key missing
   *   from it is a peer's and is never pruned
   * @param patch - the keys the caller asked to change; written tracked
   */
  private writeNormalization(
    blockId: string,
    composed: BlockToolData,
    before: Record<string, unknown> | undefined,
    patch?: Partial<BlockToolData>
  ): void {
    const current = this.readDocumentData(blockId);

    if (before === undefined || current === undefined) {
      return;
    }

    // A key the document moved since `before` is someone's edit (a peer's
    // keystroke can land while setData is awaited); `composed` is stale there.
    const settled = (key: string): boolean => (patch == null || !(key in patch))
      && JSON.stringify(current[key]) === JSON.stringify(before[key]);
    const changed = Object.entries(composed).filter(([key, value]) => settled(key)
      && JSON.stringify(value) !== JSON.stringify(current[key]));
    const keep = new Set([...Object.keys(composed), ...Object.keys(patch ?? {})]);
    const stale = Object.keys(current).filter(key => !keep.has(key) && key in before && settled(key));

    if (changed.length === 0 && stale.length === 0) {
      return;
    }

    this.dependencies.YjsManager.transactWithoutCapture(() => {
      for (const [key, value] of changed) {
        this.dependencies.YjsManager.updateBlockData(blockId, key, value);
      }
      this.dependencies.YjsManager.pruneBlockData(blockId, keep, new Set(stale));
    });
  }

  /**
   * Sync the caller's data patch to Yjs, key by key. Shared by both update
   * paths (in-place and recompose) so they stay in step.
   * @param blockId - id of the updated block
   * @param data - the patch the caller passed (`!= null` — callers may pass a literal null)
   */
  private syncDataToYjs(blockId: string, data?: Partial<BlockToolData>): void {
    if (data == null) {
      return;
    }

    for (const [key, value] of Object.entries(data)) {
      this.dependencies.YjsManager.updateBlockData(blockId, key, value);
    }
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - Block to replace
   * @param newTool - New Tool name
   * @param data - New Tool data
   * @param blocksStore - The blocks store to modify
   */
  public replace(block: Block, newTool: string, data: BlockToolData, blocksStore: BlocksStore): Block {
    /**
     * Layer 16: stale-source guard (regression: wrong-block-dropped family).
     *
     * `convert()` calls this after `await block.save()` — during that await
     * the block can be removed by a Yjs remote delete or undo. A stale source
     * here would drive `YjsManager.addBlock({...}, -1)` and
     * `insert({ index: -1, replace: true })` — both feed negative indices
     * into downstream splice paths that silently corrupt the flat array.
     *
     * Abort cleanly: return the original block with no Yjs or DOM side
     * effects. The caller (conversion dropdown, paste) already tolerates a
     * no-op outcome for a destroyed source. Resolve by ID — see `resolveLive`.
     */
    const source = this.resolveLive(block);

    if (source === null) {
      return block;
    }

    const { block: liveBlock, index: blockIndex } = source;

    /**
     * Preserve the ORIGINAL block id across the replacement.
     *
     * `replace()` backs both "turn into" (convert) and in-place markdown
     * conversion (typing `- ` on a paragraph). External references — comments,
     * backlinks, block-mentions — anchor to the block id, so regenerating it
     * here silently broke every id-keyed reference the moment a block changed
     * type. Keeping the id keeps those anchors intact.
     */
    const newBlockId = liveBlock.id;

    // Same rule as Turn into, applied the same way: release before the swap
    // (the rule reads the old holder's toggle marker) and before the type
    // write, so undo takes both back in one step.
    // Last child first: each one leaving goes to the end of the old block's run.
    const released = releasesChildrenOnTurnInto(liveBlock, newTool, data)
      ? [...liveBlock.contentIds].reverse().map(childId => this.repository.getBlockById(childId))
      : [];

    released.forEach((child) => {
      if (child !== undefined) {
        this.ctx.parentWriter(child, liveBlock.parentId);
      }
    });

    // Capture hierarchy before replacement
    const oldParentId = liveBlock.parentId;
    const oldContentIds = [...liveBlock.contentIds];

    /**
     * Mutate the block's TYPE and DATA in place on the SAME Yjs entry (one
     * transaction = one undo entry).
     *
     * The previous implementation removed the yblock and re-added a NEW one that
     * REUSED the same id. `BlockObserver` saw the id in both the added and
     * removed sets and emitted a no-op MOVE, so undoing a conversion never
     * re-rendered the block back to its prior tool (the undo/redo regression in
     * the list convert/delete specs). An in-place mutation emits an `update`
     * event instead, which the Yjs→DOM reconciler resolves against the yblock's
     * `type` and re-renders the correct tool.
     */
    this.dependencies.YjsManager.replaceBlockContent(newBlockId, newTool, data);

    // DOM update (skip Yjs sync — already done above)
    const newBlock = this.ctx.insert({
      id: newBlockId,
      tool: newTool,
      data,
      index: blockIndex,
      replace: true,
      skipYjsSync: true,
      // A turn-into IS a creation of the target tool — but the replaced block's
      // children are re-homed onto it right below, so a container tool sees
      // them and never reaches its seed path.
      origin: 'convert',
    }, blocksStore);

    // Transfer hierarchy to new block.
    //
    // Route through `BlockHierarchy.setBlockParent` rather than mutating
    // `newBlock.parentId` / `parentBlock.contentIds` directly, so that DOM
    // reparenting (into the parent's toggle-children container) and
    // collapsed-state propagation happen atomically. Direct mutation was the
    // last remaining path that could leave a replaced child inside a
    // callout/toggle rendered at the wrong DOM position until the next full
    // render pass — same architectural shape as the callout paste-ejection
    // bug family.
    //
    // Ordering concern: `setBlockParent` appends the new id to the parent's
    // contentIds[], but `replace()` must preserve the OLD block's position.
    // Capture the old index first, then run setBlockParent, then move the new
    // id back into the captured slot and drop the (now-stale) old id.
    if (oldParentId !== null) {
      this.ctx.transferParentLinkToNewBlock(liveBlock.id, newBlock, oldParentId);
    }

    /**
     * Nesting is structural (parentId/contentIds) and tool-agnostic — any block,
     * including a plain paragraph or header, can host children, which render as
     * margin-indented siblings when the tool has no children container. So "turn
     * into" keeps the children nested under the retyped block (matching Notion)
     * regardless of the target tool: just re-home them onto the new block.
     *
     * `reparentChildren` uses setBlockParent, which appends each old child id to
     * `newBlock.contentIds` while preserving children created by the replacement
     * tool's synchronous render lifecycle.
     */
    // The insert above kept only the children the new block may hold;
    // re-nesting the rest here would undo that.
    this.reparentChildren(oldContentIds.filter((childId) => {
      const child = this.repository.getBlockById(childId);

      return child !== undefined && canAdoptChild(newBlock, child);
    }), newBlock.id);

    // The insert skipped the document, which still nests a refused child here.
    for (const childId of oldContentIds) {
      const child = this.repository.getBlockById(childId);

      if (child !== undefined && child.parentId !== newBlock.id) {
        this.ctx.parentWriter(child, child.parentId);
      }
    }

    this.ctx.assertHierarchyInvariantInDev('replace');

    return newBlock;
  }

  /**
   * Route each child through `BlockHierarchy.setBlockParent` so that DOM
   * reparenting (into the new parent's toggle-children container) and
   * collapsed-state propagation run as a single atomic side effect per child.
   *
   * Direct `childBlock.parentId = ...` mutation is the same architectural bug
   * as the callout paste-ejection family: the parent/content invariant is
   * maintained but the DOM drifts from the logical tree until the next render.
   * @param childIds - Array of child block IDs to reparent
   * @param newParentId - New parent block ID
   */
  private reparentChildren(childIds: string[], newParentId: string): void {
    for (const childId of childIds) {
      const childBlock = this.repository.getBlockById(childId);

      if (childBlock !== undefined) {
        this.hierarchy.setBlockParent(childBlock, newParentId);
      }
    }
  }

  /**
   * Read a convert source (saved data + exported string) through the instance
   * that is CURRENTLY in the document, and only return a read the document
   * did not move under.
   *
   * Both reads are async. If a peer types during them, the exported string
   * predates that keystroke — and `replace()` writes the converted data back
   * key by key, where the minimal Y.Text diff DELETES the peer's characters.
   * Re-reading from the survivor narrows that window but never closes it, so
   * the read is instead VALIDATED: it is accepted only when the document's
   * copy of the block is byte-identical before and after. A drifted read is
   * retried against the fresh text, which is the conversion re-run on what the
   * peer actually typed.
   *
   * Returns null when the budget runs out — a peer typing without pause must
   * not spin here, and the caller must FAIL CLOSED rather than convert a stale
   * snapshot.
   * @param block - the source Block as last resolved
   * @param attemptsLeft - how many more times a drifted read may be retried
   * @returns the instance the data belongs to, its saved data, its exported string and the document snapshot the read was validated against; null when no read settled
   */
  private async readConvertSource(block: Block, origin: Record<string, unknown> | undefined, attemptsLeft: number): Promise<{
    block: Block;
    saved: Awaited<ReturnType<Block['save']>>;
    exported: string;
    snapshot: Record<string, unknown> | undefined;
  } | null> {
    const before = this.readDocumentData(block.id);
    const saved = await block.save();
    const exported = await block.exportDataAsString();
    const live = this.repository.getBlockById(block.id) ?? block;
    const after = this.readDocumentData(block.id);

    /**
     * Three staleness signals, and ALL must be clear:
     *
     * - the instance was SWAPPED — the reconciler replaced this Block while we
     *   read, so what `save()` returned predates the peer's keystroke;
     * - the DOCUMENT drifted DURING the read — something landed after `before`
     *   was taken, and the read straddles it;
     * - the read no longer CARRIES the document's content while the document
     *   has moved since the operation began. A remote keystroke reaches the
     *   shared document first and the DOM only when the reconciler gets to it,
     *   so `save()` can be a character behind with no swap and no drift to show
     *   for it — that is how `convert()` wrote back a truncated string and both
     *   peers converged on it.
     *
     * The last check is gated on `origin`: when nothing has touched this block
     * in the document since the operation began, the DOM is authoritative (a
     * local edit not yet flushed legitimately leads the document, and must not
     * be thrown away).
     */
    const documentMoved = !isEmpty(this.documentDrift(block.id, origin));
    const readIsFresh = !documentMoved || this.readCarriesDocumentContent(saved?.data, after);

    if (live === block && isEmpty(this.documentDrift(block.id, before)) && readIsFresh) {
      return { block: live,
        saved,
        exported,
        snapshot: after };
    }

    if (attemptsLeft <= 0) {
      return null;
    }

    return this.readConvertSource(live, origin, attemptsLeft - 1);
  }

  /**
   * Whether data read out of a Tool still carries the CONTENT the shared
   * document holds for the keys they have in common. Keys the Tool did not
   * save are ignored — a `save()` may legitimately omit defaults the document
   * still carries.
   *
   * Strings are compared as TEXT, not as markup: `a & b` and `a &amp; b` are
   * the same characters, and the DOM and the document legitimately disagree on
   * that spelling for every host-seeded block (see the note on
   * `rewrittenFromDocument` in yjs-sync.ts). Requiring byte equality made this
   * gate fire on a spelling difference and refuse a convert nobody was racing.
   * Everything that is not a string is compared whole.
   *
   * FAILURE MODE, deliberate: a peer edit that changes only MARKUP and no
   * characters — bolding a word, retargeting a link — reads as agreement, so a
   * convert may proceed and carry the pre-edit markup. That trades a
   * markup-only revert for not refusing every convert on a collaborative
   * document; character loss, which is silent and unrecoverable, still refuses.
   * @param saved - data as the Tool's `save()` returned it
   * @param document - the block's data as the shared document holds it
   * @returns true when nothing they share has moved past the read
   */
  private readCarriesDocumentContent(saved: BlockToolData | undefined, document: Record<string, unknown> | undefined): boolean {
    if (saved === undefined || document === undefined) {
      return true;
    }

    return Object.keys(document).every((key) => {
      if (!(key in saved)) {
        return true;
      }

      const mine = saved[key];
      const theirs = document[key];

      return isString(mine) && isString(theirs)
        ? textContentOf(mine) === textContentOf(theirs)
        : JSON.stringify(mine) === JSON.stringify(theirs);
    });
  }

  /**
   * Resolve the FLAT tag-rule {@link SanitizerConfig} that `clean()` needs for
   * the field of `tool` that will receive imported content on convert/merge.
   *
   * A tool's `sanitizeConfig` is keyed by DATA FIELD (`{ text: { b, i, a } }`),
   * but `clean()` expects a flat map of TAG rules (`{ b, i, a }`). When
   * `conversionConfig.import` is a STRING it names the receiving field directly,
   * so we return that field's rules. When it is a FUNCTION (e.g. the list tool)
   * there is no field name — returning the whole `{ text: {...} }` object would
   * make `clean()` treat `text` as the only allowed tag and strip every inline
   * mark (b/i/a/…). Flatten the field-level rule objects into one tag map so
   * inline formatting survives turn-into.
   * @param tool - destination tool receiving the imported content
   */
  private resolveImportSanitizeConfig(tool: BlockToolAdapter): SanitizerConfig {
    const importProp = tool.conversionConfig?.import;
    const sanitizeConfig = tool.sanitizeConfig;

    if (isString(importProp)) {
      return isObject(sanitizeConfig[importProp])
        ? sanitizeConfig[importProp] as SanitizerConfig
        : sanitizeConfig;
    }

    /**
     * Function import: flatten every field-level tag-rule object into a single
     * flat tag map. Non-object field rules (booleans/strings) can't merge into a
     * flat tag config, so they're skipped.
     */
    const flat = {} as SanitizerConfig;

    for (const field in sanitizeConfig) {
      const rule = sanitizeConfig[field];

      if (isObject(rule)) {
        Object.assign(flat, rule);
      }
    }

    return isEmpty(flat) ? sanitizeConfig : flat;
  }

  /**
   * Move a block to a new index
   * @param toIndex - Index where to move Block
   * @param fromIndex - Index of Block to move
   * @param skipDOM - If true, do not manipulate DOM
   * @param blocksStore - The blocks store to modify
   * @param skipMovedHook - If true, do not fire the moved() lifecycle hook
   * @param skipAutoHeal - If true, do not auto-heal the moved block's parentId from
   *   its destination neighbour. Callers that perform an in-container reorder of a
   *   whole subtree (keyboard moveUp/Down) must set this: their per-block lifts make
   *   a subtree's inner child briefly neighbour an unrelated block, and the heal
   *   would re-parent it to that transient neighbour, flattening the subtree.
   */
  public move(toIndex: number, fromIndex: number, skipDOM: boolean, blocksStore: BlocksStore, skipMovedHook = false, skipAutoHeal = false): void {
    // Make sure indexes are valid and within a valid range
    if (isNaN(toIndex) || isNaN(fromIndex)) {
      log(`Warning during 'move' call: incorrect indices provided.`, 'warn');

      return;
    }

    if (!this.repository.validateIndex(toIndex) || !this.repository.validateIndex(fromIndex)) {
      log(`Warning during 'move' call: indices cannot be lower than 0 or greater than the amount of blocks.`, 'warn');

      return;
    }

    // Check if the move would place a restricted tool inside a table cell
    const movingBlock = this.repository.getBlockByIndex(fromIndex);
    const neighborBlock = this.repository.getBlockByIndex(toIndex);

    if (movingBlock !== undefined && neighborBlock !== undefined &&
        isInsideTableCell(neighborBlock) && isRestrictedInTableCell(movingBlock.name)) {
      log(`Warning during 'move' call: '${movingBlock.name}' is restricted in table cells.`, 'warn');

      return;
    }

    /**
     * Defense-in-depth: capture the destination's parentId BEFORE the flat
     * reorder so we can auto-heal cross-container moves below.
     *
     * `move()` is only a flat-array reorder — it does NOT touch parentId or
     * the source/destination container `contentIds`. Without an auto-heal,
     * any caller that drags or keyboard-shuffles a block past a container
     * boundary leaves `parentId` stale: the block lands visually inside the
     * new container but still claims the old one. That's the exact drift
     * the cross-parent merge guard already blocks at the merge layer; we
     * mirror the defense here so the same bug family can never re-enter
     * via the move pipeline. DragController already calls setBlockParent
     * after move(); the auto-heal below makes that a no-op (idempotent),
     * and rescues every other caller (keyboard moveUp/Down, public api).
     */
    const destinationParentId = this.resolveMoveDestinationParent(toIndex, fromIndex, neighborBlock);

    // Snapshot: the body below opens its own move group for a reparent.
    const inCallerMoveGroup = this.dependencies.YjsManager.isInMoveGroup;

    // A slot inside the block's own subtree: Blocks.move would carry the
    // subtree straight back, and the heal would make the block its own parent.
    // A move group's caller assigns parents itself, so the heal never runs there.
    if (
      movingBlock !== undefined
      && !skipAutoHeal
      && !inCallerMoveGroup
      && this.isSelfOrDescendant(destinationParentId, movingBlock.id)
    ) {
      log(`Warning during 'move' call: a block cannot move inside its own subtree.`, 'warn');

      return;
    }

    /**
     * Structural-boundary clamp (keyboard / public-api move only).
     *
     * `move()` is a FLAT reorder. When the flat index lands beside a block in a
     * different container, the cross-container auto-heal below re-parents the
     * moved block to that neighbour's parent. For a tool-owned structure
     * (`column`/`column_list`, `table`) that is silent corruption, and it must
     * be blocked SYMMETRICALLY — both directions of the boundary:
     *
     *   - EXIT: a column's own child flat-moved beside a block in the adjacent
     *     column gets ejected into that sibling column (or a `column` moved out
     *     of its list). Block-settings "move up/down" and the keyboard shortcuts
     *     must reorder WITHIN the column only.
     *   - ENTER: an OUTSIDE block (e.g. a root paragraph) flat-moved beside a
     *     column's child gets adopted INTO that column (content jumps columns);
     *     flat-moved beside a `column` itself gets adopted as a direct child of
     *     the `column_list` — a rogue non-column child the list renders as a
     *     PHANTOM extra column. `ownsChildren` names exactly the containers whose
     *     contentIds are their own machinery (column_list, table), so entering
     *     one via a flat reorder is never legitimate.
     *
     * Only fires when the move actually CROSSES a boundary
     * (`destinationParentId !== movingBlock.parentId`), so within-container
     * reorders (two children of the same column, reordering columns inside their
     * list, plain root reordering) are never clamped. Clamp to a full no-op — NOT
     * merely skipping the auto-heal — because a bare `blocksStore.move` would
     * still strand the holder inside the foreign container (model says root, DOM
     * says column: the phantom-column divergence), so the whole reorder is refused.
     *
     * Skipped while a Yjs move group is open (the drag path): DragController
     * legitimately drags blocks across columns and assigns the parent itself.
     */
    if (
      movingBlock !== undefined
      && !inCallerMoveGroup
      && destinationParentId !== movingBlock.parentId
    ) {
      const movingParent = movingBlock.parentId !== null
        ? this.repository.getBlockById(movingBlock.parentId)
        : undefined;
      const destinationParent = destinationParentId !== null
        ? this.repository.getBlockById(destinationParentId)
        : undefined;

      const exitsColumnStructure =
        movingParent?.name === 'column' || movingParent?.name === 'column_list';
      const entersOwnedStructure =
        destinationParent !== undefined
        && (destinationParent.name === 'column'
          || destinationParent.name === 'column_list'
          || destinationParent.tool.ownsChildren);
      /**
       * Selective counterpart of `ownsChildren`: a container that declares
       * `static childTools` accepts SOME children, so the clamp fires only for a
       * block whose tool it does not permit. A demotion is impossible here — the
       * block already exists with its own data — so the reorder is refused, the
       * same resolution the table's cell restrictions use on this path.
       */
      const entersRestrictedContainer =
        !isChildToolAllowed(destinationParent, movingBlock.name);

      if (exitsColumnStructure || entersOwnedStructure || entersRestrictedContainer) {
        return;
      }
    }

    // A reparent must land in the shared document inside the same move group as
    // the reorder, or undo restores the position and leaves the old parent.
    const reparents = !skipAutoHeal
      && !inCallerMoveGroup
      && movingBlock !== undefined
      && movingBlock.parentId !== destinationParentId;

    if (reparents) {
      this.dependencies.YjsManager.transactMoves(() => {
        this.applyMove(toIndex, fromIndex, skipDOM, blocksStore, skipMovedHook, movingBlock, destinationParentId, true);
      });

      return;
    }

    this.applyMove(toIndex, fromIndex, skipDOM, blocksStore, skipMovedHook, movingBlock, destinationParentId, false);
  }

  /**
   * The flat reorder, the parent heal and the Yjs sync of one `move()` call.
   * @param toIndex - Index where to move Block
   * @param fromIndex - Index of Block to move
   * @param skipDOM - If true, do not manipulate DOM
   * @param blocksStore - The blocks store to modify
   * @param skipMovedHook - If true, do not fire the moved() lifecycle hook
   * @param movingBlock - the block at `fromIndex` before the move
   * @param destinationParentId - the parent the slot implies
   * @param reparents - true when the block takes `destinationParentId` as its new parent
   */
  private applyMove(
    toIndex: number,
    fromIndex: number,
    skipDOM: boolean,
    blocksStore: BlocksStore,
    skipMovedHook: boolean,
    movingBlock: Block | undefined,
    destinationParentId: string | null,
    reparents: boolean
  ): void {
    // Suppress stopCapturing to keep DOM + Yjs move as single undo entry
    this.ctx.suppressStopCapturing = true;
    try {
      /** Move up current Block */
      blocksStore.move(toIndex, fromIndex, skipDOM, skipMovedHook);

      /**
       * After the move, the moved block may be at a different index than toIndex
       * if nested blocks (e.g. table cell blocks) were re-sorted by resortNestedBlocks.
       * Use the saved block reference to find its actual new position.
       */
      const actualIndex = movingBlock !== undefined
        ? this.repository.getBlockIndex(movingBlock)
        : -1;
      const resolvedIndex = actualIndex >= 0 ? actualIndex : toIndex;

      this.ctx.currentBlockIndexValue = resolvedIndex;
      const movedBlock = movingBlock ?? this.ctx.currentBlock;

      if (movedBlock === undefined) {
        throw new Error(`Could not move Block. Block at index ${toIndex} is not available.`);
      }

      /**
       * SAME-parent nested reorder must ALSO re-run setBlockParent: the
       * positional `blocksStore.move()` deliberately skips the DOM for nested
       * holders (correct for table cells, which manage their own cell DOM),
       * so a within-column / within-toggle reorder via block-settings
       * "move up/down", keyboard shortcuts or the public api updates the flat
       * array while the holders stay put — the user sees no change, but the
       * saved order flips (the WYSIWYG divergence the Saver's DOM-order guard
       * now rejects). Re-asserting the unchanged parent through
       * `setBlockParent` re-mounts the holder at its flat-array position (the
       * same trick DragController uses for in-toggle reorders); for table
       * cells the anti-stealing container guard makes it a DOM no-op, so cell
       * children remain untouched. Inside a move group the caller re-mounts
       * (drag, keyboard `placeRun`).
       */
      const isSameParentNestedReorder =
        movedBlock.parentId === destinationParentId && destinationParentId !== null;

      if (isSameParentNestedReorder && !this.dependencies.YjsManager.isInMoveGroup) {
        this.hierarchy.setBlockParent(movedBlock, destinationParentId);
      }

      /**
       * Force call of didMutated event on Block movement
       */
      this.blockDidMutated(BlockMovedMutationType, movedBlock, {
        fromIndex,
        toIndex: resolvedIndex,
        parentId: reparents ? destinationParentId : movedBlock.parentId,
        oldParentId: movedBlock.parentId,
      });

      // Sync to Yjs using the actual resolved index
      this.dependencies.YjsManager.moveBlock(movedBlock.id, resolvedIndex);

      // Cross-container heal. It runs after moveBlock so the parent write
      // attaches to the move entry moveBlock just recorded.
      if (reparents) {
        this.ctx.parentWriter(movedBlock, destinationParentId);
      }

      this.ctx.assertHierarchyInvariantInDev('move');
    } finally {
      this.ctx.suppressStopCapturing = false;
    }
  }

  /**
   * The parent a block takes when `move()` puts it at `toIndex`: the parent of
   * the pre-move block at that index. A forward move lands AFTER that block, so
   * when the block that ends up next is its first child, the slot is inside it.
   * @param toIndex - Index where to move Block
   * @param fromIndex - Index of Block to move
   * @param neighborBlock - the pre-move block at `toIndex`
   */
  private resolveMoveDestinationParent(toIndex: number, fromIndex: number, neighborBlock: Block | undefined): string | null {
    if (neighborBlock === undefined) {
      return null;
    }

    const next = toIndex > fromIndex ? this.repository.getBlockByIndex(toIndex + 1) : undefined;

    return next?.parentId === neighborBlock.id ? neighborBlock.id : neighborBlock.parentId;
  }

  /**
   * Whether `candidateId` is `ancestorId` or sits under it.
   * @param candidateId - block id to test (null = root)
   * @param ancestorId - the subtree root
   */
  private isSelfOrDescendant(candidateId: string | null, ancestorId: string): boolean {
    const visited = new Set<string>();
    const walk = { id: candidateId };

    while (walk.id !== null && !visited.has(walk.id)) {
      if (walk.id === ancestorId) {
        return true;
      }
      visited.add(walk.id);
      walk.id = this.repository.getBlockById(walk.id)?.parentId ?? null;
    }

    return false;
  }

  /**
   * Merge two blocks
   * @param targetBlock - Previous block will be append to this block
   * @param blockToMerge - Block that will be merged with target block
   * @param blocksStore - The blocks store to modify
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block, blocksStore: BlocksStore): Promise<void> {
    /**
     * Layer 17: stale-source guard (regression: wrong-block-dropped family).
     *
     * `mergeBlocks` awaits `blockToMerge.data` (and `blockToMerge.exportDataAsString`
     * in the conversion path), then re-awaits `targetBlock.data` inside
     * `completeMerge`. During those awaits, either block can be removed by a
     * Yjs remote delete, undo/redo, or a tool-conversion callback. The original
     * code held closure references and used them unguarded after the awaits,
     * which drove:
     *   - `YjsManager.transact` + `updateBlockData(targetBlock.id, …)` against a
     *     dead target id (silent no-op but still a mutation attempt)
     *   - `targetBlock.mergeWith(mergeData).then(…)` on a destroyed Block where
     *     `mergeWith` returns undefined → `.then` crash
     *   - `removeBlock(blockToMerge, …)` → `Can't find a Block to remove` thrown
     *     inside a `void ... .then(...)` chain → unhandled rejection
     *   - `currentBlockIndexValue = getBlockIndex(targetBlock)` → -1, corrupting
     *     caret state downstream
     *
     * Verify both blocks are still in the store before starting and also before
     * each mutation step so a remote delete during any of the awaits aborts
     * cleanly rather than propagating the stale reference into Yjs and the DOM.
     * Verify by ID and work through the resolved instances — see `resolveLive`.
     */
    if (this.resolveLive(targetBlock) === null || this.resolveLive(blockToMerge) === null) {
      return;
    }

    /**
     * Defense-in-depth: refuse to merge across container boundaries.
     *
     * Every block belongs to a logical container identified by `parentId`
     * (null = root, or the id of a table/toggle/callout/header/database-row
     * block). Merging across containers silently mangles the hierarchy —
     * the source block's data is appended to a target in a DIFFERENT
     * container, and the source is then deleted, losing content and
     * breaking the invariant that a block lives under exactly one parent.
     *
     * keyboardNavigation already guards Backspace/Delete at cell/toggle
     * boundaries, but a missed guard (or a future composer that forgets
     * the check) must fail safe at this layer instead of corrupting data.
     * This is the root-cause fix for the "Enter-then-Backspace-inside-a-
     * table-cell" bug family — any similar bug in any nested-container
     * tool is prevented here.
     */
    if (targetBlock.parentId !== blockToMerge.parentId) {
      return;
    }

    /**
     * Complete the merge operation with the prepared data
     * Syncs to Yjs atomically, then updates DOM without re-syncing
     */
    const completeMerge = async (mergeData: BlockToolData): Promise<void> => {
      // Layer 17 re-check: post-await staleness window. Both ids must still be
      // in the store, otherwise abort before any Yjs/DOM mutation.
      const started = this.resolveLive(targetBlock);

      if (started === null || this.resolveLive(blockToMerge) === null) {
        return;
      }

      // Snapshot the document's copy of the target before the await — the loop
      // below writes every key of `mergedData` back into Yjs, so the same
      // write-back-a-snapshot flaw `composeWrite` closes for `update()` applies
      // here verbatim.
      const beforeTarget = this.readDocumentData(targetBlock.id);

      // Read the target through the live instance: a reconciled swap makes the
      // original object's data predate the peer's edit, and it is written back
      // key by key below.
      const targetData = await started.block.data;

      // Layer 17 re-check after the second await.
      const target = this.resolveLive(targetBlock);
      const merged = this.resolveLive(blockToMerge);

      if (target === null || merged === null) {
        return;
      }

      // Composed synchronously, immediately before the write — see `composeWrite`.
      const mergedData = this.composeWrite(targetBlock.id, target.block.name, targetData, beforeTarget, mergeData);

      const liveTarget = target.block;
      const liveMerged = merged.block;

      // Sync to Yjs atomically: update target + remove source as single undo entry
      this.dependencies.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(mergedData)) {
          this.dependencies.YjsManager.updateBlockData(liveTarget.id, key, value);
        }
        this.dependencies.YjsManager.removeBlock(liveMerged.id);
      });

      // DOM updates and index change (skip Yjs sync — already done above)
      // The entire operation is wrapped in withAtomicOperation to suppress stopCapturing
      // when currentBlockIndexValue is set at the end
      this.yjsSync.withAtomicOperation(() => {
        /**
         * Re-parent the merged block's nested children onto the survivor BEFORE
         * removing it. `removeBlock(blockToMerge)` runs `promoteChildrenToParent`,
         * which would otherwise re-home Tab-indented children onto the merged
         * block's parent — since the user perceives them as
         * belonging to the now-merged content. Notion re-parents them onto the
         * surviving block. Reparenting first empties `blockToMerge.contentIds`, so
         * the subsequent promote step is a no-op.
         */
        const childIdsToReparent = [...liveMerged.contentIds];

        if (childIdsToReparent.length > 0) {
          this.reparentChildren(childIdsToReparent, liveTarget.id);
        }

        void liveTarget.mergeWith(mergeData).then(() => {
          return this.ctx.removeBlock(liveMerged, true, true, blocksStore);
        });

        this.ctx.currentBlockIndexValue = this.repository.getBlockIndex(liveTarget);
      });
    };

    /**
     * We can merge:
     * 1) Blocks with the same Tool if tool provides merge method
     */
    const canMergeBlocksDirectly = targetBlock.name === blockToMerge.name && targetBlock.mergeable;
    const blockToMergeDataRaw = canMergeBlocksDirectly ? await blockToMerge.data : undefined;

    if (canMergeBlocksDirectly && isEmpty(blockToMergeDataRaw)) {
      console.error('Could not merge Block. Failed to extract original Block data.');

      return;
    }

    if (canMergeBlocksDirectly && blockToMergeDataRaw !== undefined) {
      const [cleanBlock] = sanitizeBlocks(
        [{ data: blockToMergeDataRaw, tool: blockToMerge.name }],
        targetBlock.tool.sanitizeConfig,
        this.dependencies.config.sanitizer
      );

      await completeMerge(cleanBlock.data);

      return;
    }

    /**
     * 2) Blocks with different Tools if they provides conversionConfig
     */
    if (targetBlock.mergeable && isBlockConvertable(blockToMerge, 'export') && isBlockConvertable(targetBlock, 'import')) {
      const blockToMergeDataStringified = await blockToMerge.exportDataAsString();

      /**
       * Extract the field-specific sanitize rules for the field that will receive the imported content.
       */
      const fieldSanitizeConfig = this.resolveImportSanitizeConfig(targetBlock.tool);

      const cleanData = clean(blockToMergeDataStringified, fieldSanitizeConfig);
      const blockToMergeData = convertStringToBlockData(cleanData, targetBlock.tool.conversionConfig);

      await completeMerge(blockToMergeData);
    }
  }

  /**
   * Converts passed Block to the new Tool
   * Uses Conversion Config
   * @param blockToConvert - Block that should be converted
   * @param targetToolName - Name of the Tool to convert to
   * @param blocksStore - The blocks store to modify
   * @param blockDataOverrides - Optional new Block data overrides
   * @param beforeReplace - runs inside the convert's undo entry, right before the swap
   */
  public async convert(
    blockToConvert: Block,
    targetToolName: string,
    blocksStore: BlocksStore,
    blockDataOverrides?: BlockToolData,
    beforeReplace?: () => void
  ): Promise<Block> {
    /**
     * At first, we get current Block data — through the instance that is still
     * in the document.
     *
     * `save()` and `exportDataAsString()` are async, and the Yjs reconciler
     * REPLACES the Block object (same id, a new instance) while it applies a
     * peer's edit. Data read from the pre-swap instance predates that edit, and
     * `replace()` writes it back per key, where the minimal Y.Text diff DELETES
     * the peer's characters. So re-read whenever the instance was swapped —
     * bounded, because a peer typing without pause must not spin here.
     */
    const read = await this.readConvertSource(blockToConvert, this.readDocumentData(blockToConvert.id), 3);

    /**
     * FAIL CLOSED. No read settled, so every candidate was already overwritten
     * by a peer. Converting anyway would write the stale text back and delete
     * the peer's characters — silent wrong convergence, the worst outcome.
     * Reject so the caller knows the turn-into did not happen and can retry.
     */
    if (read === null) {
      throw new Error(`Could not convert Block «${blockToConvert.id}»: it is being edited by someone else. Nothing was changed.`);
    }

    const { block: source, saved: savedBlock, exported: exportedData } = read;

    if (!savedBlock || savedBlock.data === undefined) {
      throw new Error('Could not convert Block. Failed to extract original Block data.');
    }

    /**
     * Getting a class of the replacing Tool
     */
    const replacingTool = this.factory.getTool(targetToolName);

    if (!replacingTool) {
      throw new ToolNotFoundError(targetToolName, `Could not convert Block. Tool «${targetToolName}» not found.`);
    }

    /**
     * Clean exported data with replacing sanitizer config.
     * We need to extract the field-specific sanitize rules for the field that will receive the imported content.
     * The tool's sanitizeConfig has the format { fieldName: { tagRules } }, but clean() expects just { tagRules }.
     */
    const fieldSanitizeConfig = this.resolveImportSanitizeConfig(replacingTool);

    const cleanData = clean(
      exportedData,
      composeSanitizerConfig(this.dependencies.config.sanitizer as SanitizerConfig, fieldSanitizeConfig)
    );

    /**
     * Now using Conversion Config "import" we compose a new Block data
     */
    const baseBlockData = convertStringToBlockData(cleanData, replacingTool.conversionConfig, replacingTool.settings);

    /**
     * `baseBlockData` is whatever the target tool's `conversionConfig.import()`
     * returned — the tool owns it and may return a frozen object. Build a fresh
     * object so neither the merge below nor the color/checked carry-overs write
     * into it ("object is not extensible" would abort the whole convert).
     */
    const newBlockData = { ...baseBlockData,
      ...blockDataOverrides };

    /**
     * Block-level color (textColor / backgroundColor) is a separate data field
     * that lives OUTSIDE the conversionConfig `text` export/import contract, so
     * it is never carried by the exported string and would be dropped on every
     * "turn into". Preserve it from the source block's saved data onto the
     * converted block — generically, for ANY target tool — so Notion's "color
     * survives turn-into" behavior holds. Explicit overrides win.
     */
    for (const colorField of ['textColor', 'backgroundColor'] as const) {
      const sourceValue = savedBlock.data[colorField];

      if (typeof sourceValue === 'string' && newBlockData[colorField] === undefined) {
        newBlockData[colorField] = sourceValue;
      }
    }

    /**
     * Preserve the to-do `checked` state across a turn-into round trip
     * (to-do → bulleted → to-do must come back checked).
     *
     * Unlike colors, the list `import` HARDCODES `checked: false`, so the
     * `=== undefined` guard used above never fires — the imported default would
     * always clobber the source state. Carry `checked` from the source data
     * instead, gated so it only applies when:
     *   - the destination tool's import actually declares a `checked` field
     *     (i.e. a list-family target — never leaks `checked` onto paragraphs), and
     *   - the caller didn't pass an explicit `checked` override (overrides win).
     */
    const sourceChecked = savedBlock.data.checked;

    if (
      typeof sourceChecked === 'boolean'
      && 'checked' in baseBlockData
      && blockDataOverrides?.checked === undefined
    ) {
      newBlockData.checked = sourceChecked;
    }

    /**
     * Bracket the whole convert in a single undo group.
     *
     * Two things can split a convert across multiple Cmd+Z entries if left
     * unchecked:
     *
     * 1. Container tools (callout) seed a first child paragraph inside their
     *    `rendered()` hook via `api.blocks.insertInsideParent`, which normally
     *    forces a new undo boundary via `stopCapturing()`.
     *
     * 2. ANY tool can accept `{text}` on conversion but then populate extra
     *    fields (e.g. toggle's `isOpen: true`) during its first `save()` pass.
     *    That first save is triggered by the MutationObserver watching the
     *    brand-new block's DOM, and its `syncBlockDataToYjs` would write the
     *    extra fields as a *separate* Yjs transaction — creating a phantom
     *    post-convert undo entry so Cmd+Z needs two presses.
     *
     * We solve (1) with `suppressStopCapturing` (no new undo boundary) and
     * (2) with `yjsSync.withAtomicOperation({ extendThroughRAF: true })` which
     * keeps `isSyncingFromYjs = true` through the next animation frame, so
     * mutation-triggered `syncBlockDataToYjs` calls are suppressed for
     * rendered()/first-save writes. The tool's real data persists because
     * `replace()` already wrote it into Yjs via its own transaction.
     */
    /**
     * Last gate, synchronously adjacent to the write below: `await
     * readConvertSource(...)` resolves on a task boundary, and a peer's update
     * can be applied on it. Everything between that resolution and here is
     * synchronous, so this is the only remaining place a drift can hide.
     *
     * A drift alone is not enough to refuse — this client's own flush drifts
     * the document too — so it must also have moved the CONTENT past what was
     * read. Fail closed when it has, for the same reason as above.
     */
    if (
      !isEmpty(this.documentDrift(source.id, read.snapshot))
      && !this.readCarriesDocumentContent(savedBlock.data, this.readDocumentData(source.id))
    ) {
      throw new Error(`Could not convert Block «${source.id}»: it is being edited by someone else. Nothing was changed.`);
    }

    this.dependencies.YjsManager.stopCapturing();
    const prevSuppress = this.ctx.suppressStopCapturing;

    this.ctx.suppressStopCapturing = true;

    try {
      beforeReplace?.();

      return this.yjsSync.withAtomicOperation(
        () => this.ctx.replace(source, replacingTool.name, newBlockData, blocksStore),
        { extendThroughRAF: true }
      );
    } finally {
      // Close the undo group after the sync `replace()` and any synchronous
      // `rendered()` → `insertInsideParent` have landed, but wait one microtask
      // so DOM MutationObserver-triggered Yjs writes settle inside the same
      // entry.
      queueMicrotask(() => {
        this.ctx.suppressStopCapturing = prevSuppress;
        this.dependencies.YjsManager.stopCapturing();
      });
    }
  }

  /**
   * Returns the flat-array index of the LAST block belonging to the subtree
   * rooted at `startIndex`. A block's subtree spans the contiguous run of
   * following blocks that are either:
   *   - flat-indent followers — deeper {@link getBlockNestingDepth} than the
   *     root (Notion's structural Tab nesting), or
   *   - container children — reachable from the root through the
   *     `parentId`/`contentIds` hierarchy (toggle/callout/column descendants).
   *
   * Both nesting carriers are unified here so a move treats any block plus its
   * whole subtree as one indivisible group. A root block with no descendants
   * returns `startIndex` itself.
   * @param startIndex - index of the subtree's root block
   * @returns index of the subtree's last block (>= startIndex)
   */
  private subtreeEndIndex(startIndex: number): number {
    const start = this.repository.getBlockByIndex(startIndex);

    if (start === undefined || start === null) {
      return startIndex;
    }

    const rootDepth = getBlockNestingDepth(start) ?? 0;
    const subtreeIds = new Set<string>([start.id]);
    const followers = Array.from(
      { length: this.repository.length - startIndex - 1 },
      (_, offset) => this.repository.getBlockByIndex(startIndex + 1 + offset)
    );

    // Walk the contiguous followers, growing the subtree id set as each block is
    // accepted; the first block that is neither a container child nor a deeper
    // flat-indent follower stops the run.
    const accepted = followers.reduce<{ count: number; stopped: boolean }>((acc, block) => {
      if (acc.stopped || block === undefined || block === null) {
        return { count: acc.count, stopped: true };
      }

      const isContainerChild = block.parentId !== null && subtreeIds.has(block.parentId);
      const isDepthFollower = (getBlockNestingDepth(block) ?? 0) > rootDepth;

      if (!isContainerChild && !isDepthFollower) {
        return { count: acc.count, stopped: true };
      }

      subtreeIds.add(block.id);

      return { count: acc.count + 1, stopped: false };
    }, { count: 0, stopped: false });

    return startIndex + accepted.count;
  }

  /**
   * Resolves the contiguous block group a move operates on. With no selection
   * it is the current block plus its subtree; with a block-level selection it
   * spans from the first selected block to the end of the last selected block's
   * subtree. The container is the group's shared `parentId` — moves are bounded
   * by it (a child never escapes its toggle/callout/column).
   * @param selectedBlocks - blocks under block-level selection (empty/none for caret moves)
   * @returns group span, anchor block and container parentId, or null when nothing is movable
   */
  private resolveMoveGroup(selectedBlocks: Block[] | undefined): {
    start: number;
    end: number;
    anchor: Block;
    containerParentId: string | null;
  } | null {
    const indices = (selectedBlocks ?? [])
      .map((block) => this.repository.getBlockIndex(block))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);

    if (indices.length > 0) {
      const start = indices[0];
      const anchor = this.repository.getBlockByIndex(start);

      if (anchor === undefined) {
        return null;
      }

      return {
        start,
        end: this.subtreeEndIndex(indices[indices.length - 1]),
        anchor,
        containerParentId: anchor.parentId,
      };
    }

    const start = this.ctx.currentBlockIndexValue;
    const anchor = this.ctx.currentBlock;

    if (start < 0 || anchor === undefined) {
      return null;
    }

    return {
      start,
      end: this.subtreeEndIndex(start),
      anchor,
      containerParentId: anchor.parentId,
    };
  }

  /**
   * Moves the current block (or block-level selection) up by one sibling
   * position, stepping over the previous sibling's whole subtree and staying
   * within the current container. Does nothing at the container's top edge.
   * @param blocksStore - The blocks store to modify
   * @param selectedBlocks - blocks under block-level selection (move them together)
   */
  public moveCurrentBlockUp(blocksStore: BlocksStore, selectedBlocks?: Block[]): void {
    const group = this.resolveMoveGroup(selectedBlocks);

    // Find the ROOT of the previous sibling subtree: the nearest block before the
    // group, in the SAME container, at the same/shallower depth — skipping that
    // sibling's own deeper descendants (whether nested via flat depth OR a
    // structural parentId chain) so the whole subtree is hopped. `undefined` means
    // there is no preceding sibling in the container, i.e. the group is already its
    // first child (top edge / first block of a toggle/callout/column).
    const predStart = ((): number | undefined => {
      if (group === null) {
        return undefined;
      }

      const movingDepth = getBlockNestingDepth(group.anchor) ?? 0;
      const precedingIndices = Array.from({ length: group.start }, (_, offset) => group.start - 1 - offset);

      return precedingIndices.find((index) => {
        const candidate = this.repository.getBlockByIndex(index);

        return candidate !== undefined &&
          candidate.parentId === group.containerParentId &&
          (getBlockNestingDepth(candidate) ?? 0) <= movingDepth;
      });
    })();

    // Boundary: top of document, or the group is the first child of its container.
    if (group === null || predStart === undefined) {
      announce(this.dependencies.I18n.t('a11y.atTop'), { politeness: 'polite' });

      return;
    }

    // Slide the group up so each member lands at predStart..(predStart + size).
    this.placeRun(this.blocksBetween(group.start, group.end), predStart, group.containerParentId, blocksStore);

    this.finishMove(group.anchor, selectedBlocks, 'a11y.movedUp');
  }

  /**
   * Moves the current block (or block-level selection) down by one sibling
   * position, stepping over the next sibling's whole subtree and staying within
   * the current container. Does nothing at the container's bottom edge.
   * @param blocksStore - The blocks store to modify
   * @param selectedBlocks - blocks under block-level selection (move them together)
   */
  public moveCurrentBlockDown(blocksStore: BlocksStore, selectedBlocks?: Block[]): void {
    const group = this.resolveMoveGroup(selectedBlocks);
    const successor = group !== null
      ? this.repository.getBlockByIndex(group.end + 1)
      : undefined;

    // Boundary: bottom of document, or the block below belongs to a different
    // container (the group is the last child of its toggle/callout/column).
    if (group === null || successor === undefined ||
        successor.parentId !== group.containerParentId) {
      announce(this.dependencies.I18n.t('a11y.atBottom'), { politeness: 'polite' });

      return;
    }

    // Lift the next sibling's whole subtree to just before the group, which
    // descends the group past it by one sibling position.
    const neighbourStart = group.end + 1;

    this.placeRun(
      this.blocksBetween(neighbourStart, this.subtreeEndIndex(neighbourStart)),
      group.start,
      group.containerParentId,
      blocksStore
    );

    this.finishMove(group.anchor, selectedBlocks, 'a11y.movedDown');
  }

  /**
   * Blocks at flat indices `start..end`, inclusive.
   * @param start - first index
   * @param end - last index
   */
  private blocksBetween(start: number, end: number): Block[] {
    return Array.from({ length: end - start + 1 }, (_, offset) => this.repository.getBlockByIndex(start + offset))
      .filter((block): block is Block => block !== undefined);
  }

  /**
   * Moves a contiguous run so it starts at `firstIndex`, as ONE undo step, and
   * re-mounts the container's children in the new order.
   *
   * Members are moved by identity, not by index: `Blocks.move` carries the
   * blocks nested in a moved holder along with it, so a toggle's children are
   * already in place after the toggle moves. An index loop would move the wrong
   * block into the toggle's first-child slot.
   * @param run - the blocks to move, in flat order
   * @param firstIndex - where the first block must land
   * @param containerParentId - the run's shared parent (null = root)
   * @param blocksStore - The blocks store to modify
   */
  private placeRun(run: Block[], firstIndex: number, containerParentId: string | null, blocksStore: BlocksStore): void {
    this.dependencies.YjsManager.transactMoves(() => {
      run.forEach((block, offset) => {
        const fromIndex = this.repository.getBlockIndex(block);

        if (fromIndex !== firstIndex + offset) {
          // skipAutoHeal: an in-container reorder keeps every parentId; the
          // per-block heal would re-parent a subtree's inner child to the
          // unrelated block it passes.
          this.move(firstIndex + offset, fromIndex, false, blocksStore, false, true);
        }
      });
    });

    if (containerParentId === null) {
      return;
    }

    // Blocks.move leaves nested holders where they are, so re-assert the
    // unchanged parent: setBlockParent mounts each holder before its next flat
    // sibling. Last child first, so that sibling is already in place.
    this.repository.blocks
      .filter(block => block.parentId === containerParentId)
      .reverse()
      .forEach(block => this.hierarchy.setBlockParent(block, containerParentId));
  }

  /**
   * Shared post-move bookkeeping: re-point the current index at the moved
   * anchor, restore the user's interaction mode (block selection survives so
   * the move can be repeated; otherwise the caret returns to the block), and
   * announce the result.
   * @param anchor - the group's anchor block (first block in document order)
   * @param selectedBlocks - block-level selection that drove the move, if any
   * @param messageKey - i18n key for the success announcement
   */
  private finishMove(anchor: Block, selectedBlocks: Block[] | undefined, messageKey: string): void {
    this.ctx.currentBlockIndexValue = this.repository.getBlockIndex(anchor);

    // A block-level selection must persist after the move so the user can keep
    // pressing the shortcut. Re-seating the caret (setToBlock) tears the block
    // selection down into a text caret, so skip it for selection moves and let
    // BlockManager re-apply the selection; only caret moves refocus.
    if (selectedBlocks === undefined || selectedBlocks.length === 0) {
      this.refocusCurrentBlock();
    }

    const message = this.dependencies.I18n.t(messageKey, {
      position: this.ctx.currentBlockIndexValue + 1, // 1-indexed for the user
      total: this.repository.length,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Refocuses the current block at the end position
   * Used after block movement to allow consecutive moves
   */
  private refocusCurrentBlock(): void {
    const block = this.ctx.currentBlock;

    if (block !== undefined) {
      this.dependencies.Caret.setToBlock(block, this.dependencies.Caret.positions.END);
    }
  }
}
