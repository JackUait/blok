/**
 * @class BlockFactory
 * @classdesc Creates Block instances with proper configuration
 * @module BlockFactory
 */
import { Block } from '../../block';
import type { BlokEventMap } from '../../events';
import type { BlockToolAdapter } from '../../tools/block';
import type { ToolsCollection } from '../../tools/collection';
import type { EventsDispatcher } from '../../utils/events';
import type { API } from '../api';

import type { ComposeBlockOptions } from './types';

/**
 * Dependencies needed by BlockFactory
 */
export interface BlockFactoryDependencies {
  /** Blok API instance */
  API: API;
  /** Events dispatcher */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
  /** Read-only state flag */
  readOnly: boolean;
  /** Map of available block tools */
  tools: ToolsCollection<BlockToolAdapter>;
}

/**
 * BlockFactory creates Block instances with proper configuration
 */
export class BlockFactory {
  private readonly dependencies: BlockFactoryDependencies;
  private readonly bindBlockEvents: (block: Block) => void;
  private readOnlyState: boolean;

  /**
   * @param dependencies - Required dependencies
   * @param bindBlockEvents - Function to bind events to a block
   */
  constructor(dependencies: BlockFactoryDependencies, bindBlockEvents: (block: Block) => void) {
    this.dependencies = dependencies;
    this.bindBlockEvents = bindBlockEvents;
    this.readOnlyState = dependencies.readOnly;
  }

  /**
   * Creates Block instance by tool name
   * @param options - block creation options
   * @returns {Block}
   */
  public composeBlock(options: ComposeBlockOptions): Block {
    const {
      tool: name,
      data = {},
      id,
      tunes: tunesData = {},
      parentId,
      contentIds,
      bindEventsImmediately = false,
    } = options;

    const tool = this.dependencies.tools.get(name);

    if (tool === undefined) {
      throw new Error(`Could not compose Block. Tool «${name}» not found.`);
    }

    const block = new Block({
      id,
      data,
      tool,
      api: this.dependencies.API,
      readOnly: this.readOnlyState,
      tunesData,
      parentId,
      contentIds,
      bindMutationWatchersImmediately: bindEventsImmediately,
    }, this.dependencies.eventsDispatcher);

    if (this.readOnlyState) {
      return block;
    }

    if (bindEventsImmediately) {
      this.bindBlockEvents(block);
    } else {
      window.requestIdleCallback(() => {
        this.bindBlockEvents(block);
      }, { timeout: 2000 });
    }

    return block;
  }

  /**
   * Check if a tool exists
   * @param name - tool name
   * @returns true if tool exists
   */
  public hasTool(name: string): boolean {
    return this.dependencies.tools.has(name);
  }

  /**
   * Get a tool by name
   * @param name - tool name
   * @returns tool or undefined
   */
  public getTool(name: string): ReturnType<BlockFactoryDependencies['tools']['get']> {
    return this.dependencies.tools.get(name);
  }

  /**
   * Update read-only state for factory
   * @param readOnly - new read-only state
   */
  public setReadOnly(readOnly: boolean): void {
    this.readOnlyState = readOnly;
  }
}
