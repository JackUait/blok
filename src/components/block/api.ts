import type { BlockAPI as BlockAPIInterface, InsertChildOptions } from '../../../types/api';
import type { SavedData } from '../../../types/data-formats';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { BlockToolData, ToolConfig, ToolboxConfigEntry } from '../../../types/tools';
import type { API as ApiModules } from '../modules/api';
import {
  resolveInsertIndex,
  resolveMoveIndex,
  type IndexReader,
  type InsertPosition,
} from '../utils/blocks-tree';

import type { Block } from './index';

/**
 * Adapt the editor-level blocks API to the IndexReader the shared tree helpers
 * expect, so flat insert/move indices resolve through the SAME logic the React
 * and Vue `useBlocks` adapters use (author once, reuse everywhere).
 */
const readerFor = (api: ApiModules): IndexReader => {
  const blocks = api.methods.blocks;

  return {
    getBlocksCount: () => blocks.getBlocksCount(),
    getBlockByIndex: (i: number) => {
      const b = blocks.getBlockByIndex(i);

      return b === undefined ? undefined : { id: b.id, name: b.name, parentId: b.parentId };
    },
    getBlockIndex: (id: string) => blocks.getBlockIndex(id),
  };
};

/**
 * Flat index of a block by id, without `blocks.getBlockIndex`'s `warn` for an
 * unknown id — used by the insert-if-absent probe, where "absent" is the
 * expected happy path.
 * @param reader - flat-array reader over the live block list
 * @param id - block id to look for
 * @returns the flat index, or undefined when no block carries that id
 */
const findFlatIndexById = (reader: IndexReader, id: string): number | undefined => {
  const index = Array.from({ length: reader.getBlocksCount() }, (_unused, i) => i)
    .find((i) => reader.getBlockByIndex(i)?.id === id);

  return index;
};

/**
 * Constructs new BlockAPI object
 * @class
 * @param {Block} block - Block to expose
 * @param {ApiModules} api - editor API module backing the connection methods
 *   (getChildren/setParent/insertChild/moveChild). REQUIRED: an instance built
 *   without it answers `[]` from getChildren() and no-ops on every mutation,
 *   silently orphaning content. Keeping it mandatory makes tsc — not vigilance
 *   — reject a new detached construction site.
 */
const BlockAPIConstructor = function BlockAPI(
  this: BlockAPIInterface,
  block: Block,
  api: ApiModules
): BlockAPIInterface {
  const blockAPI: BlockAPIInterface = {
    /**
     * Block id
     * @returns {string}
     */
    get id(): string {
      return block.id;
    },
    /**
     * Tool name
     * @returns {string}
     */
    get name(): string {
      return block.name;
    },

    /**
     * Tool config passed on Blok's initialization
     * @returns {ToolConfig}
     */
    get config(): ToolConfig {
      return block.config;
    },

    /**
     * Element, that wraps plugin contents
     * @returns {HTMLElement}
     */
    get holder(): HTMLElement {
      return block.holder;
    },

    /**
     * Id of the parent block, or null if this block has no parent
     * @returns {string | null}
     */
    get parentId(): string | null {
      return block.parentId;
    },

    /**
     * True if Block content is empty
     * @returns {boolean}
     */
    get isEmpty(): boolean {
      return block.isEmpty;
    },

    /**
     * True if Block is selected with Cross-Block selection
     * @returns {boolean}
     */
    get selected(): boolean {
      return block.selected;
    },

    /**
     * Last successfully extracted block tool data (synchronous)
     * @returns {BlockToolData}
     */
    get preservedData(): BlockToolData {
      return block.preservedData;
    },

    /**
     * Last successfully extracted tune data (synchronous)
     * @returns {{ [name: string]: BlockTuneData }}
     */
    get preservedTunes(): { [name: string]: BlockTuneData } {
      return block.preservedTunes;
    },

    /**
     * Set Block's stretch state
     * @param {boolean} state — state to set
     */
    set stretched(state: boolean) {
      block.setStretchState(state);
    },

    /**
     * True if Block is stretched
     * @returns {boolean}
     */
    get stretched(): boolean {
      return block.stretched;
    },

    /**
     * True if Block has inputs to be focused
     */
    get focusable(): boolean {
      return block.focusable;
    },

    /**
     * Call Tool method with errors handler under-the-hood
     * @param {string} methodName - method to call
     * @param {object} param - object with parameters
     * @returns {unknown}
     */
    call(methodName: string, param?: Record<string, unknown>): unknown {
      return block.call(methodName, param);
    },

    /**
     * Save Block content
     * @returns {Promise<void|SavedData>}
     */
    save(): Promise<void|SavedData> {
      return block.save();
    },

    /**
     * Validate Block data
     * @param {BlockToolData} data - data to validate
     * @returns {Promise<boolean>}
     */
    validate(data: BlockToolData): Promise<boolean> {
      return block.validate(data);
    },

    /**
     * Allows to say Blok that Block was changed. Used to manually trigger Blok's 'onChange' callback
     * Can be useful for block changes invisible for blok core.
     */
    dispatchChange(): void {
      block.dispatchChange();
    },

    /**
     * Tool could specify several entries to be displayed at the Toolbox (for example, "Heading 1", "Heading 2", "Heading 3")
     * This method returns the entry that is related to the Block (depended on the Block data)
     */
    getActiveToolboxEntry(): Promise<ToolboxConfigEntry | undefined> {
      return block.getActiveToolboxEntry();
    },

    /**
     * Ids of this block's direct children, in order (read-only copy).
     * @returns {readonly string[]}
     */
    get contentIds(): readonly string[] {
      return [...block.contentIds];
    },

    /**
     * Direct children of this block as BlockAPI objects, in order.
     * @returns {BlockAPIInterface[]}
     */
    getChildren(): BlockAPIInterface[] {
      return api.methods.blocks.getChildren(block.id);
    },

    /**
     * Reparent this block under `parentId` (or to root with `null`). Routes
     * through core's `setBlockParent` chokepoint, preserving the cycle/dangling
     * guards and Yjs sync.
     * @param {string | null} parentId - new parent id, or null for root level
     */
    setParent(parentId: string | null): void {
      api.methods.blocks.setBlockParent(block.id, parentId);
    },

    /**
     * Insert a child block under THIS block, atomically (one undo entry).
     * `position` places it among the existing children using the same
     * vocabulary as the editor insert API ('start' | 'end' | { before } |
     * { after }); it defaults to 'end' (append past the whole subtree). The
     * flat insert index is resolved by the shared tree helper, so nested
     * descendants are handled correctly.
     *
     * `options` carries the same `{ focus, caret, id, tunes, replace }` the
     * framework adapters' rich `insert` spec does, so a container tool inserting
     * THROUGH its own block gets the same power as one inserting at a flat index
     * — no hand-rolled caret placement, no follow-up `update` to apply tunes.
     * @param {BlockToolData} [childData] - data for the new child
     * @param {InsertPosition} [position] - where among children (default 'end')
     * @param {string} [toolName] - tool to create (default `config.defaultBlock`)
     * @param {InsertChildOptions} [options] - focus/caret/id/tunes/replace
     * @returns {BlockAPIInterface} the created child (or, for an `id` that already
     *   exists, that existing child — nothing is inserted)
     */
    insertChild(
      childData?: BlockToolData,
      position: InsertPosition = 'end',
      toolName?: string,
      options: InsertChildOptions = {}
    ): BlockAPIInterface {
      const { focus = false, caret, id, tunes, replace = false } = options;
      const blocks = api.methods.blocks;
      const reader = readerFor(api);

      /**
       * Insert-if-absent, matching the adapters' `insert({ id })`: a stable id
       * that already exists returns the existing child and creates nothing, so a
       * container tool re-running its seeding logic can't duplicate rows. Probed
       * by scanning the flat array rather than `getBlockIndex`, which logs a
       * `warn` for an unknown id — noise on this expected-absent happy path.
       * Skipped under `replace`, which is an explicit overwrite.
       */
      if (id !== undefined && !replace) {
        const existingIndex = findFlatIndexById(reader, id);

        if (existingIndex !== undefined) {
          return blocks.getBlockByIndex(existingIndex) as BlockAPIInterface;
        }
      }

      /**
       * A replace overwrites the child named by an object `position` — with
       * 'start'/'end' there is no target, and silently overwriting whatever
       * happens to occupy the resolved slot would be a data-loss footgun.
       */
      if (replace && typeof position !== 'object') {
        throw new Error(
          'Could not replace child Block: `replace` needs a position naming the child to overwrite, ' +
            'e.g. { before: childId }.'
        );
      }

      const insertIndex = resolveInsertIndex(reader, block.id, position, replace);

      const runInsert = (): BlockAPIInterface => {
        if (!replace) {
          return blocks.insertInsideParent(block.id, insertIndex, childData, toolName, {
            ...(focus && { focus }),
            ...(id !== undefined && { id }),
            ...(tunes !== undefined && { tunes }),
          });
        }

        /**
         * Route the replace through the generic flat-index insert, which already
         * owns the whole overwrite choreography (parent-link transfer, re-homing
         * the replaced block's children, Yjs). `insertInsideParent` writes to Yjs
         * BEFORE the DOM insert and has no removal counterpart, so teaching IT to
         * replace would mean a second, divergent implementation of that dance.
         * Re-assert the parent afterwards so the replacement stays in this
         * container.
         */
        const created = blocks.insert(
          toolName,
          childData ?? (toolName === undefined ? { text: '' } : {}),
          {},
          insertIndex,
          focus,
          true,
          id,
          tunes
        );

        blocks.setBlockParent(created.id, block.id);

        return created;
      };

      /**
       * The replace path is two operations (insert + reparent); group them so one
       * CMD+Z reverses the whole swap. A plain insert is already atomic inside
       * `insertInsideParent`, so it opens no extra transaction.
       */
      const child = replace && typeof blocks.transact === 'function'
        ? ((): BlockAPIInterface => {
            const out: { child: BlockAPIInterface | null } = { child: null };

            blocks.transact(() => {
              out.child = runInsert();
            });

            return out.child as unknown as BlockAPIInterface;
          })()
        : runInsert();

      if (caret !== undefined) {
        api.methods.caret.setToBlock(child.id, caret.position ?? 'default', caret.offset ?? 0);
      }

      return child;
    },

    /**
     * Move a direct child by `delta` positions among its siblings (clamped to
     * the valid range). Delegates to the editor `move`, resolving the flat
     * target index through the shared helper so a child with its own subtree
     * lands past the target sibling's descendants, not inside them.
     * @param {string} childId - id of the child to move
     * @param {number} delta - signed step (negative = up, positive = down)
     */
    moveChild(childId: string, delta: number): void {
      if (delta === 0) {
        return;
      }

      const childIds = block.contentIds;
      const fromPos = childIds.indexOf(childId);

      if (fromPos === -1) {
        return;
      }

      const toPos = Math.min(Math.max(fromPos + delta, 0), childIds.length - 1);

      if (toPos === fromPos) {
        return;
      }

      const reader = readerFor(api);
      const fromIndex = reader.getBlockIndex(childId);

      if (fromIndex === undefined) {
        return;
      }

      const targetSibling = childIds[toPos];
      const toIndex = resolveMoveIndex(
        reader,
        delta > 0 ? { after: targetSibling } : { before: targetSibling }
      );

      api.methods.blocks.move(toIndex, fromIndex);
    },
  };

  Object.setPrototypeOf(this, blockAPI);

  Object.defineProperties(this, {
    id: {
      get(): string {
        return block.id;
      },
      enumerable: true,
      configurable: true,
    },
    name: {
      get(): string {
        return block.name;
      },
      enumerable: true,
      configurable: true,
    },
  });

  return this;
};

// Export BlockAPI with proper constructor type
export const BlockAPI = BlockAPIConstructor as unknown as {
  new (block: Block, api: ApiModules): BlockAPIInterface;
};
