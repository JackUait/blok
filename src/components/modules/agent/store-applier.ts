import * as Y from 'yjs';

import { AGENT_HISTORY_LIMITS } from '../../../shared/agent/document-session';
import { failure } from '../../../shared/agent/errors';
import { DocSnapshot } from '../../../shared/agent/snapshot';
import { readPageFields, writePageField } from '../yjs/page-fields';
import { stripNul } from '../yjs/serializer';

import type { Edit, PlannedBlock } from '../../../../types/agent';
import type { RichText } from '../../../../types/rich-text';
import type { Attribution } from '../../../shared/agent/attribution';
import type { AgentApplier, HistoryBound, StepUnlocks } from '../../../shared/agent/executor';
import type { Plan } from '../../../shared/agent/types';
import type { DocumentStore } from '../yjs/document-store';

type StackItem = Y.UndoManager['undoStack'][number];

/** One applied batch, as history.undo and history.redo replay it. */
interface Step {
  /** The yjs entry that replays it, or null when the batch changed nothing. */
  item: StackItem | null;
  /** Blocks the batch added, removed or moved. */
  ids: Set<string>;
  /** Of those, the blocks it only moved: their content is not the step's. */
  placedOnly: Set<string>;
  /** Their parents before and after; null is the root. */
  parents: Set<string | null>;
  /** {@link StoreApplier.shape} as the step left them. */
  shape: string;
}

export class StoreApplier implements AgentApplier {
  public readonly runtime: 'node-live' = 'node-live';
  private count = 0;
  private broken = false;
  private readonly unsubscribe: () => void;
  public readonly prepareInsert: AgentApplier['prepareInsert'];
  /**
   * Tracks only this applier's batches and its own replays: a peer's update
   * carries a remote origin, and other 'local' writes to the store are not captured.
   */
  private readonly undoManager: Y.UndoManager;
  private applying = false;
  private readonly done: Step[] = [];
  private readonly undone: Step[] = [];
  /** What each step unlocks, kept on the step so the stacks cannot shift it. */
  private readonly unlocks = new WeakMap<Step, StepUnlocks>();

  public constructor(
    private readonly store: DocumentStore,
    private readonly options: {
      /** Who the writes are credited to (agentAttribution). */
      attribution: Attribution;
      richTextFieldsFor(type: string): string[];
      htmlToSegments(html: string): RichText;
      /** Set only where the host prepares inserts, such as blok-mcp creating a page's document. */
      prepareInsert?: AgentApplier['prepareInsert'];
    }
  ) {
    this.prepareInsert = options.prepareInsert;
    this.unsubscribe = store.onAnyUpdate(() => {
      this.count++;
    });
    this.undoManager = new Y.UndoManager(store.undoScope, {
      // 0: each batch is its own step, however fast the next one comes.
      captureTimeout: 0,
      trackedOrigins: new Set(['local']),
      captureTransaction: transaction => this.applying || transaction.origin === this.undoManager,
    });
  }

  public isReadOnly(): boolean {
    return this.broken;
  }

  public revision(): string {
    return `l${this.count}`;
  }

  public snapshot(): DocSnapshot {
    const blocks = this.store.toJSON().map(block => {
      const fields = this.options.richTextFieldsFor(block.type);

      return {
        ...block,
        data: Object.fromEntries(Object.entries(block.data).map(([key, value]): [string, unknown] => [
          key,
          fields.includes(key) && typeof value === 'string' ? this.options.htmlToSegments(value) : value,
        ])),
      };
    });

    return DocSnapshot.fromOutput({ ...readPageFields(this.store.page), blocks });
  }

  public apply(plan: Plan, _draft: DocSnapshot): Promise<void> {
    if (plan.commentsOnly === true) {
      return this.applyComments(plan);
    }
    const step: Step = { item: null, ids: new Set(), placedOnly: new Set(), parents: new Set(), shape: '' };
    const before = this.store.toJSON();
    const stacked = this.undoManager.undoStack.length;

    try {
      const at = Date.now();

      this.applying = true;
      this.store.transact(() => {
        for (const edit of plan.edits) {
          this.applyOne(edit, at, step);
        }
        for (const id of plan.touched) {
          if (this.store.getBlockById(id) !== undefined) {
            this.store.updateBlockMetadata(id, at, this.options.attribution.by ?? null, this.options.attribution.with);
          }
        }
      }, 'local');
    } catch (error) {
      // Yjs keeps partial writes; the executor blocks later writes.
      this.broken = true;

      return Promise.reject(error);
    } finally {
      this.applying = false;
    }

    const after = this.store.toJSON();

    for (const block of [...before, ...after]) {
      if (step.ids.has(block.id ?? '')) {
        step.parents.add(block.parent ?? null);
      }
    }
    step.item = this.undoManager.undoStack.length > stacked ? this.undoManager.undoStack.at(-1) ?? null : null;
    step.shape = this.shape(step);
    this.done.push(step);
    this.undone.length = 0;
    // A new step cleared the redo side, so only the oldest done steps can be over the limit.
    while (this.done.length > AGENT_HISTORY_LIMITS.steps) {
      const oldest = this.done.shift();
      const at = oldest?.item === null || oldest === undefined ? -1 : this.undoManager.undoStack.indexOf(oldest.item);

      if (at >= 0) {
        this.undoManager.undoStack.splice(at, 1);
      }
    }

    return Promise.resolve();
  }

  /** As a person's comment (database-comments-store.ts): written outside undo, so no step and no undo of it. */
  private applyComments(plan: Plan): Promise<void> {
    const at = Date.now();
    const scratch: Step = { item: null, ids: new Set(), placedOnly: new Set(), parents: new Set(), shape: '' };

    try {
      this.store.transactWithoutCapture(() => {
        for (const edit of plan.edits) {
          this.applyOne(edit, at, scratch);
        }
        for (const id of plan.touched) {
          if (this.store.getBlockById(id) !== undefined) {
            this.store.updateBlockMetadata(id, at, this.options.attribution.by ?? null, this.options.attribution.with);
          }
        }
      });
    } catch (error) {
      this.broken = true;

      return Promise.reject(error);
    }

    return Promise.resolve();
  }

  public recordUnlocks(unlocks: StepUnlocks): void {
    const step = this.done.at(-1);

    if (step !== undefined) {
      this.unlocks.set(step, unlocks);
    }
  }

  public pendingUnlocks(name: 'history.undo' | 'history.redo'): readonly string[] | undefined {
    const step = name === 'history.undo' ? this.done.at(-1) : this.undone.at(-1);

    if (step === undefined) {
      return [];
    }
    const known = this.unlocks.get(step);

    if (known === undefined) {
      return undefined;
    }

    return name === 'history.undo' ? known.backward : known.forward;
  }

  public historyStepId(name: 'history.undo' | 'history.redo'): unknown {
    return name === 'history.undo' ? this.done.at(-1) : this.undone.at(-1);
  }

  public undo(bound?: HistoryBound): Promise<void> {
    const step = this.done.at(-1);

    if (bound !== undefined && step !== bound.expected) {
      return Promise.reject(failure('STALE', 'Another step is the last one now, so nothing was undone. Read the document again, then retry.'));
    }
    if (step === undefined) {
      return Promise.reject(failure('NOTHING_TO_UNDO', 'This session has no step to undo.'));
    }
    this.replay(step, 'undo');
    this.undone.push(step);
    this.done.pop();

    return Promise.resolve();
  }

  public redo(bound?: HistoryBound): Promise<void> {
    const step = this.undone.at(-1);

    if (bound !== undefined && step !== bound.expected) {
      return Promise.reject(failure('STALE', 'Another step is next now, so nothing was redone. Read the document again, then retry.'));
    }
    if (step === undefined) {
      return Promise.reject(failure('NOTHING_TO_REDO', 'This session has no undone step to redo.'));
    }
    this.replay(step, 'redo');
    this.done.push(step);
    this.undone.pop();

    return Promise.resolve();
  }

  public dispose(): void {
    this.unsubscribe();
    this.undoManager.destroy();
  }

  /**
   * Yjs merges a replay with a peer's text and map writes, so those stay. It does not for
   * structure: removing a block takes a peer's writes inside it, and replaying a move a
   * peer redid lists the block twice. So a peer change to the step's blocks refuses it.
   */
  private replay(step: Step, direction: 'undo' | 'redo'): void {
    const from = direction === 'undo' ? this.undoManager.undoStack : this.undoManager.redoStack;
    const to = direction === 'undo' ? this.undoManager.redoStack : this.undoManager.undoStack;

    if (this.shape(step) !== step.shape || (step.item !== null && from.at(-1) !== step.item)) {
      throw failure('CONFLICT', `Someone else changed the blocks this step added, removed or moved, so it can no longer be ${direction === 'undo' ? 'undone' : 'redone'}. Re-read the document before retrying.`);
    }
    if (step.item !== null) {
      const stacked = to.length;

      if (direction === 'undo') {
        this.undoManager.undo();
      } else {
        this.undoManager.redo();
      }
      // A replay that applied nothing leaves no entry to replay back.
      // eslint-disable-next-line no-param-reassign -- the step moves to the other stack
      step.item = to.length > stacked ? to.at(-1) ?? null : null;
    }
    // eslint-disable-next-line no-param-reassign -- the step moves to the other stack
    step.shape = this.shape(step);
  }

  /** The step's blocks as the document has them now (a moved one by its slot), with each parent's order of them. */
  private shape(step: Step): string {
    const blocks = new Map(this.store.toJSON().map(block => [block.id, block]));
    const roots = [...blocks.values()].filter(block => block.parent === undefined).map(block => block.id);
    const orderIn = (parent: string | null): Array<string | undefined> | null => {
      const order = parent === null ? roots : blocks.get(parent)?.content;

      return order === undefined ? null : order.filter(id => id !== undefined && step.ids.has(id));
    };

    return JSON.stringify({
      blocks: [...step.ids].sort().map(id => {
        const block = blocks.get(id);

        if (block === undefined) {
          return 'gone';
        }

        // The slot too: replaying a move a peer redid in the same parent lists the block twice.
        return step.placedOnly.has(id) ? this.store.getPlacement(id) : block;
      }),
      parents: [...step.parents].map(parent => [parent, orderIn(parent)]).sort(),
    });
  }

  private insertTree(block: PlannedBlock, parentId: string | null, afterId: string | null, at: number, step: Step): void {
    step.ids.add(block.id);
    // Same rule as YjsManager.withCreationStamp: an anonymous answer and its body name no creator.
    const anonymous = (block.type === 'database-row' && block.data.anonymous === true)
      || this.store.isInAnonymousAnswer(undefined, parentId);
    const { by, with: coAuthor } = this.options.attribution;

    this.store.addBlockAt({
      id: block.id,
      type: block.type,
      data: block.data,
      ...(block.tunes === undefined ? {} : { tunes: block.tunes }),
      createdAt: at,
      ...(anonymous || by === undefined ? {} : { createdBy: by, ...(coAuthor !== undefined && { createdWith: coAuthor }) }),
    }, { parentId, afterId });

    for (const [index, child] of block.children.entries()) {
      this.insertTree(child, block.id, block.children[index - 1]?.id ?? null, at, step);
    }
  }

  private childrenOf(id: string): string[] {
    return this.store.toJSON().find(block => block.id === id)?.content ?? [];
  }

  private applyOne(edit: Edit, at: number, step: Step): void {
    const moved = (id: string): void => {
      if (!step.ids.has(id)) {
        step.ids.add(id);
        step.placedOnly.add(id);
      }
    };
    const removed = (id: string): void => {
      step.ids.add(id);
      step.placedOnly.delete(id);
    };

    switch (edit.op) {
      case 'insert':
        this.insertTree(edit.block, edit.parentId, edit.afterId, at, step);
        break;
      case 'remove': {
        if (edit.withChildren) {
          const walk = (id: string): string[] => [...this.childrenOf(id).flatMap(walk), id];

          walk(edit.id).forEach(id => {
            removed(id);
            this.store.removeBlock(id);
          });
          break;
        }

        const placement = this.store.getPlacement(edit.id);
        const children = this.childrenOf(edit.id);

        for (const [index, child] of children.entries()) {
          moved(child);
          this.store.moveBlockTo(child, {
            parentId: placement?.parentId ?? null,
            afterId: index === 0 ? placement?.afterId ?? null : children[index - 1] ?? null,
          });
        }
        removed(edit.id);
        this.store.removeBlock(edit.id);
        break;
      }
      case 'move':
        moved(edit.id);
        this.store.moveBlockTo(edit.id, { parentId: edit.parentId, afterId: edit.afterId });
        break;
      case 'setData':
        for (const [key, value] of Object.entries(edit.patch)) {
          this.store.updateBlockData(edit.id, key, value === null ? undefined : value);
        }
        break;
      case 'setRichText':
        this.store.updateBlockData(edit.id, edit.field, edit.value);
        break;
      case 'setTunes':
        Object.entries(edit.tunes).forEach(([name, value]) => {
          if (value === null) {
            // Native tune updates store null instead of deleting the key.
            const tunes: unknown = this.store.getBlockById(edit.id)?.get('tunes');

            if (tunes instanceof Y.Map) {
              tunes.delete(stripNul(name));
            }
          } else {
            this.store.updateBlockTune(edit.id, name, value);
          }
        });
        break;
      case 'replaceType':
        this.store.replaceBlockContent(edit.id, edit.type, edit.data);
        break;
      case 'setPageField':
        writePageField(this.store.page, edit.key, edit.value);
        break;
    }
  }
}
