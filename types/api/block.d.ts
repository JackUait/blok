import {BlockToolData, ToolConfig, ToolboxConfigEntry} from '../tools';
import {BlockTuneData} from '../block-tunes/block-tune-data';
import {SavedData} from '../data-formats';

/**
 * Where to place a child among its siblings when inserting from a block.
 * Mirrors the editor-level insert vocabulary used by the framework adapters.
 */
export type BlockChildPosition = 'start' | 'end' | { before: string } | { after: string };

/**
 * @interface BlockAPI Describes Block API methods and properties
 */
export interface BlockAPI {
  /**
   * Block unique identifier
   */
  readonly id: string;

  /**
   * Tool name
   */
  readonly name: string;

  /**
   * Tool config passed on Blok's initialization
   */
  readonly config: ToolConfig;

  /**
   * Wrapper of Tool's HTML element
   */
  readonly holder: HTMLElement;

  /**
   * Id of the parent block, or null if this block has no parent
   */
  readonly parentId: string | null;

  /**
   * True if Block content is empty
   */
  readonly isEmpty: boolean;

  /**
   * True if Block is selected with Cross-Block selection
   */
  readonly selected: boolean;

  /**
   * Last successfully extracted block tool data (synchronous).
   * Useful when async save() is not feasible, e.g. during clipboard operations.
   */
  readonly preservedData: BlockToolData;

  /**
   * Last successfully extracted tune data (synchronous).
   * Useful when async save() is not feasible, e.g. during clipboard operations.
   */
  readonly preservedTunes: { [name: string]: BlockTuneData };

  /**
   * True if Block has inputs to be focused
   */
  readonly focusable: boolean;

  /**
   * Setter sets Block's stretch state
   *
   * Getter returns true if Block is stretched
   */
  stretched: boolean;

  /**
   * Call Tool method with errors handler under-the-hood
   *
   * @param {string} methodName - method to call
   * @param {object} param - object with parameters
   *
   * @return {void}
   */
  call(methodName: string, param?: object): void;

  /**
   * Save Block content
   *
   * @return {Promise<void|SavedData>}
   */
  save(): Promise<void|SavedData>;

  /**
   * Validate Block data
   *
   * @param {BlockToolData} data
   *
   * @return {Promise<boolean>}
   */
  validate(data: BlockToolData): Promise<boolean>;

  /**
   * Allows to say Blok that an element was changed. Used to manually trigger Blok's 'onChange' callback
   * Can be useful for block changes invisible for blok core.
   */
  dispatchChange(): void;

  /**
   * Tool could specify several entries to be displayed at the Toolbox (for example, "Heading 1", "Heading 2", "Heading 3")
   * This method returns the entry that is related to the Block (depended on the Block data)
   */
  getActiveToolboxEntry(): Promise<ToolboxConfigEntry | undefined>

  /**
   * Ids of this block's direct children, in order (read-only copy).
   * The block-level counterpart to the flat-with-references hierarchy model —
   * lets a container tool read its children without reaching the editor API.
   */
  readonly contentIds: readonly string[];

  /**
   * This block's direct children as BlockAPI objects, in order.
   */
  getChildren(): BlockAPI[];

  /**
   * Reparent this block under `parentId`, or to the root level with `null`.
   * Routes through core's universal `setBlockParent` chokepoint (cycle/dangling
   * guards + Yjs sync preserved).
   *
   * @param parentId - id of the new parent block, or null for root level
   */
  setParent(parentId: string | null): void;

  /**
   * Insert a child block under THIS block atomically (a single undo entry),
   * delegating to core's `insertInsideParent`. `position` places it among the
   * existing children (default 'end' = appended past the whole subtree).
   *
   * @param childData - data for the new child (defaults to an empty paragraph)
   * @param position - where among the children to insert (default 'end')
   * @return the created child, or null when unavailable (virtual block)
   */
  insertChild(childData?: BlockToolData, position?: BlockChildPosition): BlockAPI | null;

  /**
   * Move a direct child by `delta` positions among its siblings (clamped to the
   * valid range), delegating to core's `move`. A child carrying its own subtree
   * lands past the target sibling's descendants, not inside them.
   *
   * @param childId - id of the child block to move
   * @param delta - signed step (negative = toward start, positive = toward end)
   */
  moveChild(childId: string, delta: number): void;
}
