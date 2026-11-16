/**
 * @class BlockFactory
 * @classdesc Creates Block instances with proper configuration
 * @module BlockFactory
 */
import type { BlokModules } from '../../../types-internal/blok-modules';
import { Block } from '../../block';
import { ToolNotFoundError } from '../../errors/tool-not-found';
import type { BlokEventMap } from '../../events';
import type { BlockToolAdapter } from '../../tools/block';
import type { ToolsCollection } from '../../tools/collection';
import type { EventsDispatcher } from '../../utils/events';
import { log } from '../../utils';
import { applyBlockMigration } from '../../migration/block-migrations';
import type { BlockMigrations } from '../../migration/block-migrations';
import { richTextInputToHtml } from '../../utils/rich-text-input';
import type { API } from '../api';

import type { BlockOrigin } from '../../../../types';
import type { ComposeBlockOptions } from './types';

/**
 * Dependencies needed by BlockFactory
 */
export interface BlockFactoryDependencies {
  /** Blok API instance */
  API: API;
  /** Events dispatcher */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
  /** Map of available block tools */
  tools: ToolsCollection<BlockToolAdapter>;
  /** All module instances */
  moduleInstances: BlokModules;
  /**
   * Host-supplied per-type block-migration rules from editor config
   * (`config.migrations`). Applied at load, after each Tool's own `upgradeData`.
   */
  migrations?: BlockMigrations;
  /** Called with every Block built here, before it joins the document. */
  onComposed?: (block: Block, origin: BlockOrigin) => void;
  getBlockById?: (id: string) => Block | undefined;
}

/**
 * BlockFactory creates Block instances with proper configuration
 */
export class BlockFactory {
  private readonly dependencies: BlockFactoryDependencies;
  private readonly bindBlockEvents: (block: Block) => void;
  private readonly bindBlockChanges: (block: Block) => void;

  /**
   * Get the current read-only state from ReadOnly module
   */
  private get readOnlyState(): boolean {
    return this.dependencies.moduleInstances.ReadOnly.isEnabled;
  }

  /** Row metadata stays live; only content below a closed row defers its tool DOM. */
  private isClosedRowBody(parentId: string | null | undefined): boolean {
    const modules = this.dependencies.moduleInstances;
    const seen = new Set<string>();
    const cursor = { id: parentId };

    while (typeof cursor.id === 'string' && !seen.has(cursor.id)) {
      const id = cursor.id;
      seen.add(id);
      const live = this.dependencies.getBlockById?.(id) ?? modules.BlockManager?.getBlockById?.(id);
      const record = live === undefined ? modules.YjsManager?.getBlockById?.(id) : undefined;
      const name = live?.name ?? record?.get('type');

      if (name === 'database-row' && (live === undefined || live.holder.classList.contains('hidden'))) return true;
      const parent: unknown = live?.parentId ?? record?.get('parentId');

      cursor.id = typeof parent === 'string' ? parent : undefined;
    }

    return false;
  }

  /**
   * @param dependencies - Required dependencies
   * @param bindBlockEvents - Function to bind events to a block
   * @param bindBlockChanges - Function to subscribe to a block's changes; runs at once
   */
  constructor(
    dependencies: BlockFactoryDependencies,
    bindBlockEvents: (block: Block) => void,
    bindBlockChanges: (block: Block) => void
  ) {
    this.dependencies = dependencies;
    this.bindBlockEvents = bindBlockEvents;
    this.bindBlockChanges = bindBlockChanges;
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
      lastEditedAt,
      lastEditedBy,
      lastEditedWith,
      createdAt,
      createdBy,
      createdWith,
      origin = 'api',
      replaySource,
      deferRender,
      renderedBarrier,
    } = options;

    const tool = this.dependencies.tools.get(name);

    if (tool === undefined) {
      throw new ToolNotFoundError(name, `Could not compose Block. Tool «${name}» not found.`);
    }

    // Give the Tool a chance to upgrade a legacy data shape it once wrote into
    // the shape it reads today — the per-tool migration core's global grammar
    // cannot know about (columns, custom media). No-op unless the Tool declares
    // a static `upgradeData`; a throwing hook falls back to the stored data.
    const resolveTool = (toolName: string): BlockToolAdapter | undefined => this.dependencies.tools.get(toolName);
    const upgradedData = tool.upgradeData(richTextInputToHtml(tool, data ?? {}, resolveTool));

    // Apply the host's own config-level migration for this type on top of the
    // Tool's `upgradeData` — the rules a host declares from the OUTSIDE for a
    // tool it doesn't own (or its own tool without editing the class). A
    // throwing rule falls back to the pre-migration data, never a blank editor.
    // Converted again: a host migration may itself return segments.
    const migratedData = richTextInputToHtml(tool, applyBlockMigration(
      name,
      upgradedData,
      this.dependencies.migrations,
      (migratedType, error) => log(`Migration for block «${migratedType}» threw; loading the block with its stored data instead.`, 'warn', error)
    ), resolveTool);

    const block: Block = new Block({
      id,
      // Wire DTOs (e.g. Editor.js backends) may carry `data: null`; the
      // destructuring default above only covers `undefined`.
      data: migratedData,
      tool,
      api: this.dependencies.API,
      readOnly: this.readOnlyState,
      tunesData,
      parentId,
      contentIds,
      bindMutationWatchersImmediately: bindEventsImmediately,
      lastEditedAt,
      lastEditedBy,
      lastEditedWith,
      createdAt,
      createdBy,
      createdWith,
      origin,
      replaySource,
      // Paste waits for ready before onPaste can import its DOM; it must not
      // wait indefinitely behind a closed row.
      deferRender: name !== 'database-row' && origin !== 'paste' && (deferRender ?? this.isClosedRowBody(parentId)),
      shouldDeferRender: () => this.isClosedRowBody(block.parentId),
      renderDeferredWithoutCapture: (render) => this.dependencies.moduleInstances.YjsManager.transactWithoutCapture(() => {
        render();
        this.dependencies.moduleInstances.Renderer?.normalizeRenderedDom?.(block.holder);
      }),
      renderedBarrier,
    }, this.dependencies.eventsDispatcher);

    // Closed until its database explicitly opens it. This must already hold
    // while a large load is between composition and the database's hooks.
    if (name === 'database-row' && parentId !== undefined) block.holder.classList.add('hidden');

    this.dependencies.onComposed?.(block, origin);

    if (this.readOnlyState) {
      return block;
    }

    // Only the DOM listeners wait for idle (one scan of the listener list per
    // block). A change the tool dispatches meanwhile would be lost.
    this.bindBlockChanges(block);

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
}
