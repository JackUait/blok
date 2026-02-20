import {BlockToolData, ToolConfig, ToolboxConfigEntry} from '../tools';
import {BlockTuneData} from '../block-tunes/block-tune-data';
import {SavedData} from '../data-formats';

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
}
