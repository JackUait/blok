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
    const { blockEvents, listeners, onBlockMutated, getBlockIndex } = this.dependencies;

    listeners.on(block.holder, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        blockEvents.keydown(event);
      }
    });

    listeners.on(block.holder, 'keyup', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        blockEvents.keyup(event);
      }
    });

    listeners.on(block.holder, 'input', (event: Event) => {
      if (event instanceof InputEvent) {
        blockEvents.input(event);
      }
    });

    block.on('didMutated', (affectedBlock: Block) => {
      return onBlockMutated(BlockChangedMutationType, affectedBlock, {
        index: getBlockIndex(affectedBlock),
      });
    });
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
