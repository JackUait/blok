/**
 * @class BlockEventBinder
 * @classdesc Handles event binding/unbinding for blocks
 * @module BlockEventBinder
 */
import type { BlockMutationType } from '../../../../types/events/block';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import type { Block } from '../../block';
import type { BlokEventMap } from '../../events';
import type { EventsDispatcher } from '../../utils/events';
import type { BlockEvents } from '../blockEvents';

import type { BlockMutationEventDetailWithoutTarget } from './types';


/**
 * Callback for when a block is mutated
 */
type BlockMutationCallback = <Type extends BlockMutationType>(
  mutationType: Type,
  block: Block,
  detailData: BlockMutationEventDetailWithoutTarget<Type>
) => Block;

/**
 * Module listeners interface for event binding
 */
export interface ModuleListeners {
  /** Bind event listener */
  on: (
    element: EventTarget,
    eventType: string,
    handler: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ) => void;
  /** Clear all mutable listeners */
  clearAll: () => void;
}

/**
 * Dependencies needed by BlockEventBinder
 */
export interface BlockEventBinderDependencies {
  /** BlockEvents module for handling block-level events */
  blockEvents: BlockEvents;
  /** Mutable listeners that can be cleared in read-only mode */
  listeners: ModuleListeners;
  /** Events dispatcher for emitting mutation events */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
  /** Callback to get block index */
  getBlockIndex: (block: Block) => number;
  /** Callback when block is mutated */
  onBlockMutated: BlockMutationCallback;
  /** Check if an event should be handled by this editor instance */
  shouldHandleEvent?: (event: Event) => boolean;
}

/**
 * BlockEventBinder handles event binding/unbinding for blocks
 *
 * Responsibilities:
 * - Bind/unbind block-level events (keydown, keyup, input, didMutated)
 * - Bind/unbind document-level events (cut)
 * - Enable/disable all bindings for read-only mode
 */
export class BlockEventBinder {
  private readonly dependencies: BlockEventBinderDependencies;

  /**
   * Events whose block-level pipeline has already run this dispatch.
   *
   * Every block holder carries its own listener, and a NESTED block's holder
   * sits inside its container's, so one keystroke bubbles through a listener
   * per nesting level. The handlers ignore which block they were bound to —
   * BlockEvents resolves the current block from the caret — so the extra runs
   * were pure duplication: Shift+ArrowDown inside a toggle extended the
   * selection by one row per ANCESTOR, not per press. The innermost listener
   * fires first (bubble phase), so first-one-wins keeps the deepest block's
   * dispatch.
   */
  private readonly dispatchedEvents = new WeakSet<Event>();

  /**
   * @param dependencies - Required dependencies
   */
  constructor(dependencies: BlockEventBinderDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Bind event handlers to a single block
   * @param block - Block to bind events to
   */
  public bindBlockEvents(block: Block): void {
    const { blockEvents, listeners, onBlockMutated, getBlockIndex, shouldHandleEvent } = this.dependencies;

    listeners.on(block.holder, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (shouldHandleEvent && !shouldHandleEvent(event)) {
          return;
        }
        if (this.claimDispatch(event)) {
          blockEvents.keydown(event);
        }
      }
    });

    listeners.on(block.holder, 'keyup', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (shouldHandleEvent && !shouldHandleEvent(event)) {
          return;
        }
        if (this.claimDispatch(event)) {
          blockEvents.keyup(event);
        }
      }
    });

    listeners.on(block.holder, 'input', (event: Event) => {
      if (event instanceof InputEvent) {
        if (shouldHandleEvent && !shouldHandleEvent(event)) {
          return;
        }
        if (this.claimDispatch(event)) {
          blockEvents.input(event);
        }
      }
    });

    block.on('didMutated', (affectedBlock: Block) => {
      return onBlockMutated(BlockChangedMutationType, affectedBlock, {
        index: getBlockIndex(affectedBlock),
      });
    });
  }

  /**
   * Claim this event for the block-level pipeline, returning false when an
   * inner block's listener already ran it. See {@link dispatchedEvents}.
   * @param event - the bubbling DOM event
   */
  private claimDispatch(event: Event): boolean {
    if (this.dispatchedEvents.has(event)) {
      return false;
    }

    this.dispatchedEvents.add(event);

    return true;
  }

  /**
   * Enable all event bindings for multiple blocks
   * Binds document-level cut event and block-level events
   * @param blocks - Blocks to bind events to
   */
  public enableBindings(blocks: Block[]): void {
    const { blockEvents, listeners } = this.dependencies;

    // Bind document cut event
    listeners.on(document, 'cut', (event: Event) => {
      blockEvents.handleCommandX(event as ClipboardEvent);
    });

    // Bind events to all blocks
    for (const block of blocks) {
      this.bindBlockEvents(block);
    }
  }

  /**
   * Disable all event bindings
   * Clears all mutable listeners
   */
  public disableBindings(): void {
    this.dependencies.listeners.clearAll();
  }
}
