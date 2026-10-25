import type { BlockOrigin } from '../../../../types';
import type { AgentActor, Edit, PlannedBlock } from '../../../../types/agent';
import { AgentFailure, failure } from '../../../shared/agent/errors';
import type { AgentApplier } from '../../../shared/agent/executor';
import type { DocSnapshot } from '../../../shared/agent/snapshot';
import type { Plan } from '../../../shared/agent/types';
import type { BlokModules } from '../../../types-internal/blok-modules';
import type { Block } from '../../block';
import { ConvertConflictError } from '../../errors/convert-conflict';
import { assertCanMoveUnder, resolvePlacement, type BlockTree } from '../api/block-placement';
import type { ComposeBlockOptions } from '../blockManager/types';
import { isSelfPlacedParent } from '../blockManager/new-block-placement';
import { adjustCaretOffset, captureCaretAcrossRewrite } from '../blockManager/remote-edit-caret';
import { readCaretPosition, resolveCaretRange } from '../collaboration/caret-position';
import type { CaretHistoryEntry } from '../yjs/types';
import { createRevisionCounter, editorSnapshot } from './editor-snapshot';
import { isBlockReadOnly, carriesReadOnly } from '../../utils/read-only-blocks';

// A peer edit can make the rollback refuse. Partial writes stay, so the
// error must not promise an unchanged document (no retryable code).
/**
 * A planned block whose children the plan supplies (nested, or by a later
 * insert or move in the same plan) is not a fresh creation: the plan already
 * says what its children are. 'paste' is the restore origin for
 * exactly that, so container tools (tabs, column_list, callout) do not seed
 * defaults beside them. See BlockOrigin in types/tools/block-tool.d.ts.
 */
const originOf = (block: PlannedBlock, filled: ReadonlySet<string>): BlockOrigin =>
  (block.children.length > 0 || filled.has(block.id) ? 'paste' : 'api');

const rollbackRefused = (error: unknown): Error => {
  const cause = error instanceof AgentFailure ? error.error : undefined;
  const reason = cause?.message ?? (error instanceof Error ? error.message : String(error));

  return failure('APPLY_FAILED', `${reason} The rollback was refused after a concurrent edit. The document may be partly changed; read it again.`, {
    ...(cause !== undefined && { details: { cause } }),
  });
};

export class EditorApplier implements AgentApplier {
  public readonly runtime: 'editor' = 'editor';
  private readonly counter: ReturnType<typeof createRevisionCounter>;
  private lastToken: CaretHistoryEntry | undefined;
  private gesturesAtClose = -1;

  public constructor(
    private readonly Blok: BlokModules,
    private readonly options: {
      actor: AgentActor;
      sessionId: string;
      turnId: string;
      attributeLastEditedBy?: boolean;
      mergeSteps?: 'batch' | 'turn';
      /** Data a tool's prepareInsert answered, such as the pageId a host's create gave. */
      onPrepared?(type: string, data: Record<string, unknown>): void;
      /** A pageId this session writes into a page block. */
      onPagePointed?(pageId: string): void;
    }
  ) {
    this.counter = createRevisionCounter(Blok);
  }

  public isReadOnly(): boolean {
    return this.Blok.ReadOnly.isEnabled;
  }

  public async settle(): Promise<void> {
    for (;;) {
      await new Promise<void>(resolve => {
        this.Blok.YjsManager.onPendingBlockWritesSettled(resolve);
      });
      if (!this.Blok.BlockManager.isSyncingFromYjs) {
        return;
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }

  public snapshot(): DocSnapshot {
    return editorSnapshot(this.Blok);
  }

  public revision(): string {
    return this.counter.value();
  }

  /** The same host hook a toolbox insert waits for, e.g. a page's `create`. */
  public async prepareInsert(type: string, planned?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const data = await this.Blok.Tools.blockTools.get(type)?.prepareInsert(planned);

    if (data !== undefined) {
      this.options.onPrepared?.(type, data);
    }

    return data;
  }

  public async undo(): Promise<void> {
    const { YjsManager } = this.Blok;

    await this.settle();
    YjsManager.flushPendingBlockWrites();
    const token = YjsManager.topUndoToken();

    if (token === undefined) {
      throw failure('NOTHING_TO_UNDO', 'There is nothing to undo.');
    }
    if (YjsManager.undoStepTag(token)?.sessionId !== this.options.sessionId) {
      throw failure('UNDO_NOT_OWN', 'The last step is not this session\'s.');
    }
    if (!YjsManager.undoStep(token)) {
      throw failure('CONFLICT', 'The last step can no longer be undone. Re-read the document before retrying.');
    }
    await this.settle();
  }

  public async redo(): Promise<void> {
    const { YjsManager } = this.Blok;

    await this.settle();
    YjsManager.flushPendingBlockWrites();
    const token = YjsManager.topRedoToken();

    if (token === undefined) {
      throw failure('NOTHING_TO_UNDO', 'There is nothing to redo.');
    }
    if (YjsManager.undoStepTag(token)?.sessionId !== this.options.sessionId) {
      throw failure('UNDO_NOT_OWN', 'The next redo step is not this session\'s.');
    }
    if (!YjsManager.redoStep(token)) {
      throw failure('CONFLICT', 'The next step can no longer be redone. Re-read the document before retrying.');
    }
    await this.settle();
  }

  public async apply(plan: Plan, _draft: DocSnapshot): Promise<void> {
    if (plan.edits.length === 0) {
      return;
    }
    const { BlockManager, YjsManager } = this.Blok;
    const tag = { actorId: this.options.actor.id, sessionId: this.options.sessionId };
    const previous = YjsManager.topUndoToken();
    const previousTag = YjsManager.undoStepTag(previous);
    const joins = this.options.mergeSteps === 'turn'
      && previous !== undefined && previous === this.lastToken
      && previousTag?.actorId === tag.actorId && previousTag.sessionId === tag.sessionId
      && YjsManager.gestureCount() === this.gesturesAtClose;

    YjsManager.beginApiCall();
    // Consecutive batches can start in the same gesture task.
    YjsManager.startSubStep();
    BlockManager.beginToolTransaction();

    const before = YjsManager.topUndoToken();
    const pageIdsBefore = new Map([...plan.touched].map((id) => [id, this.pageIdOf(id)]));
    const gesturesAtOpen = YjsManager.gestureCount();
    const release = BlockManager.attributeTo({
      ids: plan.touched, actor: this.options.actor, turnId: this.options.turnId,
      stampLastEditedBy: this.options.attributeLastEditedBy !== false,
    });

    try {
      await this.applyInTransaction(plan);
    } catch (error) {
      const token = YjsManager.topUndoToken();

      release();
      if (token !== undefined && token !== before && !await this.rollBack(token, tag)) {
        // Part of the batch stays, so any pageId it wrote stays untrusted.
        this.reportPagePointers(plan.touched, pageIdsBefore);
        throw rollbackRefused(error);
      }
      throw error;
    } finally {
      release();
    }
    this.reportPagePointers(plan.touched, pageIdsBefore);

    const token = YjsManager.topUndoToken();

    if (token !== undefined && token !== before) {
      YjsManager.tagTopUndoStep(tag);
      this.lastToken = joins && previous !== undefined && before === previous
        && YjsManager.mergeTopUndoSteps(previous, token, { ...tag, gestureCount: gesturesAtOpen })
        ? previous : token;
      this.gesturesAtClose = YjsManager.gestureCount();
    }
  }

  /**
   * Agent writes stop at a block that acts read-only (BlockTool.isReadOnly).
   * A delete, a type change or a move also stops when it would carry one along.
   * A block whose own data is frozen (BlockTool.isDataReadOnly) takes no data or type write.
   */
  private refuseReadOnlyTarget(edit: Edit): void {
    if (edit.op === 'setPageField') {
      return;
    }
    const getById = (id: string): Block | undefined => this.Blok.BlockManager.getBlockById(id);
    const inside = (id: string | null): boolean => id !== null && isBlockReadOnly(getById(id), getById);
    const carried = (id: string): boolean => carriesReadOnly(getById(id), getById);
    const locked = ((): string | null | undefined => {
      switch (edit.op) {
        case 'insert':
          return inside(edit.parentId) ? edit.parentId : undefined;
        case 'move':
          if (carried(edit.id)) return edit.id;

          return inside(edit.parentId) ? edit.parentId : undefined;
        case 'remove':
          return carried(edit.id) ? edit.id : undefined;
        case 'replaceType':
          return carried(edit.id) || getById(edit.id)?.toolDataReadOnly === true ? edit.id : undefined;
        case 'setData':
        case 'setRichText':
          return inside(edit.id) || getById(edit.id)?.toolDataReadOnly === true ? edit.id : undefined;
        case 'setTunes':
          return inside(edit.id) ? edit.id : undefined;
      }
    })();

    if (locked !== undefined && locked !== null) {
      throw failure('PRECONDITION_FAILED', `Block "${locked}" is read-only here: the host does not allow editing it. Other blocks can still change.`);
    }
  }

  private async rollBack(token: CaretHistoryEntry, tag: { actorId: string; sessionId: string }): Promise<boolean> {
    this.Blok.YjsManager.tagTopUndoStep(tag);
    const rolledBack = this.Blok.YjsManager.undoStep(token);

    await this.settle();

    return rolledBack;
  }

  private pageIdOf(id: string): unknown {
    const block = this.Blok.BlockManager.getBlockById(id);

    return block?.name === 'page' ? block.preservedData.pageId : undefined;
  }

  /**
   * Reports each pageId the batch left that the block did not have before.
   * Read after the batch, so a type change earlier in it cannot hide a page.
   */
  private reportPagePointers(ids: ReadonlySet<string>, before: ReadonlyMap<string, unknown>): void {
    const report = this.options.onPagePointed;

    for (const id of ids) {
      const pageId = this.pageIdOf(id);

      if (typeof pageId === 'string' && before.get(id) !== pageId) {
        report?.(pageId);
      }
    }
  }

  public lastStepToken(): CaretHistoryEntry | undefined {
    return this.lastToken;
  }

  public dispose(): void {
    this.counter.dispose();
  }

  private async applyInTransaction(plan: Plan): Promise<void> {
    const { BlockManager } = this.Blok;

    try {
      const filled = new Set(plan.edits.flatMap(edit =>
        (edit.op === 'insert' || edit.op === 'move') && edit.parentId !== null ? [edit.parentId] : []));

      for (const edit of plan.edits) {
        // Checked live, edit by edit: an earlier edit can move a block into or out of a read-only subtree.
        this.refuseReadOnlyTarget(edit);
        await this.applyOne(edit, filled);
      }

      this.Blok.YjsManager.transact(() => {
        const at = Date.now();

        for (const id of plan.touched) {
          const block = BlockManager.getBlockById(id);

          if (block !== undefined) {
            BlockManager.stampBlockEdit(block, at);
          }
        }
      });
    } finally {
      await new Promise<void>(resolve => {
        BlockManager.endToolTransaction(resolve);
      });
    }
  }

  private get tree(): BlockTree {
    const { BlockManager } = this.Blok;

    return { blocks: BlockManager.blocks, getBlockById: id => BlockManager.getBlockById(id) };
  }

  private flattenTree(block: PlannedBlock, parentId: string | null, filled: ReadonlySet<string>): ComposeBlockOptions[] {
    return [
      {
        id: block.id, tool: block.type,
        data: this.Blok.BlocksAPI.hostDataForTool(block.type, block.data),
        tunes: block.tunes,
        parentId: parentId ?? undefined,
        contentIds: block.children.map(child => child.id),
        origin: originOf(block, filled),
      },
      ...block.children.flatMap(child => this.flattenTree(child, block.id, filled)),
    ];
  }

  private insertSelfPlacedTree(block: PlannedBlock, parentId: string, afterId: string | null, filled: ReadonlySet<string>): void {
    const { BlockManager, YjsManager } = this.Blok;
    const placement = resolvePlacement(this.tree, parentId, afterId === null ? 'start' : { after: afterId });
    const inserted = BlockManager.insertInsideParent(
      parentId, placement.index,
      this.Blok.BlocksAPI.hostDataForTool(block.type, block.data),
      block.type, { id: block.id, tunes: block.tunes, contentIds: block.children.map(child => child.id), origin: originOf(block, filled) }
    );

    for (const [name, value] of Object.entries(block.tunes ?? {})) {
      YjsManager.updateBlockTune(inserted.id, name, value);
    }

    block.children.reduce<string | null>((previous, child) => {
      this.insertSelfPlacedTree(child, inserted.id, previous, filled);

      return child.id;
    }, null);
  }

  private async keepingCaret(block: Block, write: () => Promise<unknown>): Promise<void> {
    const selection = document.getSelection();
    const restore = captureCaretAcrossRewrite(block, selection);
    const position = readCaretPosition(block.id, block.inputs, selection);
    const input = position === null ? undefined : block.inputs[position.inputIndex];
    const before = input?.textContent ?? '';
    const parent = block.holder.parentNode;
    const focused = document.activeElement === input;

    await write();

    const liveBlock = this.Blok.BlockManager.getBlockById(block.id);

    if (liveBlock === undefined) {
      return;
    }
    if (liveBlock.holder === block.holder) {
      restore?.();

      return;
    }
    if (position === null || input === undefined || input.isConnected) {
      return;
    }

    const liveSelection = document.getSelection();
    const focus = liveSelection?.focusNode ?? null;

    // Removing the old holder collapses its range onto the parent.
    if (liveSelection === null || (focus !== null && focus !== parent && !liveBlock.holder.contains(focus))) {
      return;
    }

    const newInput = liveBlock.inputs[position.inputIndex];

    if (newInput === undefined) {
      return;
    }
    const after = newInput.textContent ?? '';
    const anchor = resolveCaretRange(newInput, adjustCaretOffset(before, after, position.anchor));
    const head = resolveCaretRange(newInput, adjustCaretOffset(before, after, position.head));

    if (anchor === null || head === null) {
      return;
    }
    if (focused && document.activeElement === document.body) {
      newInput.focus({ preventScroll: true });
    }
    liveSelection.setBaseAndExtent(
      anchor.startContainer, anchor.startOffset,
      head.startContainer, head.startOffset
    );
  }

  private async applyOne(edit: Edit, filled: ReadonlySet<string>): Promise<void> {
    const { BlockManager, YjsManager } = this.Blok;
    const block = 'id' in edit ? BlockManager.getBlockById(edit.id) : undefined;

    switch (edit.op) {
      case 'insert': {
        const parent = edit.parentId === null ? undefined : BlockManager.getBlockById(edit.parentId);

        // insertMany drops a parentId it may not place itself: self-placing parents, and parents
        // whose tool ownsChildren (column_list, tabs). Those children are placed explicitly.
        if (parent !== undefined && (parent.tool.ownsChildren || isSelfPlacedParent(parent, id => BlockManager.getBlockById(id)))) {
          this.insertSelfPlacedTree(edit.block, parent.id, edit.afterId, filled);
        } else {
          const placement = resolvePlacement(this.tree, edit.parentId, edit.afterId === null ? 'start' : { after: edit.afterId });
          const blocks = this.flattenTree(edit.block, edit.parentId, filled).map(options => BlockManager.composeBlock(options));

          BlockManager.insertMany(blocks, placement.index, { notify: true, yjsSync: 'add' });
        }
        break;
      }
      case 'remove': {
        const ids = edit.withChildren ? this.snapshot().subtree(edit.id).reverse() : [edit.id];

        for (const id of ids) {
          const removed = BlockManager.getBlockById(id);

          await (removed === undefined ? undefined : BlockManager.removeBlock(removed, false));
        }
        break;
      }
      case 'move':
        if (block !== undefined) {
          assertCanMoveUnder(this.tree, block, edit.parentId, edit.afterId ?? undefined, { allowColumnMoves: true });
          YjsManager.joinMovesToStep(() => BlockManager.moveTo(block, { parentId: edit.parentId, afterId: edit.afterId }));
        }
        break;
      case 'setData':
        if (block !== undefined) {
          const kept = Object.fromEntries(Object.entries(edit.patch).filter(([, value]) => value !== null));
          const deleted = Object.entries(edit.patch).filter(([, value]) => value === null).map(([key]) => key);
          const data = this.Blok.BlocksAPI.hostDataForTool(block.name, kept);

          await this.keepingCaret(block, () => BlockManager.update(block, data, undefined, undefined, deleted));
        }
        break;
      case 'setRichText':
        if (block !== undefined) {
          const data = this.Blok.BlocksAPI.hostDataForTool(block.name, { [edit.field]: edit.value });

          await this.keepingCaret(block, () => BlockManager.update(block, data));
        }
        break;
      case 'setTunes':
        if (block !== undefined) {
          await this.keepingCaret(block, () => BlockManager.update(block, undefined, edit.tunes));
        }
        break;
      case 'replaceType':
        if (block === undefined) {
          break;
        }
        try {
          await this.keepingCaret(block, () => this.Blok.API.methods.blocks.convert(edit.id, edit.type, edit.data));
        } catch (error) {
          throw error instanceof ConvertConflictError
            ? failure('CONFLICT', `Block «${error.blockId}» is being edited by someone else. Re-read the document before retrying.`, {
              details: { blockId: error.blockId },
            })
            : error;
        }
        break;
      // Through PageTitle: a local Yjs write does not redraw the header or fire the host callbacks.
      case 'setPageField':
        if (edit.key === 'title') {
          this.Blok.PageTitle.setText(typeof edit.value === 'string' ? edit.value : '', 'api');
        } else {
          this.Blok.PageTitle.setIcon(typeof edit.value === 'string' ? null : edit.value, 'api');
        }
        break;
    }
  }
}
