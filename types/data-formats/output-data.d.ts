import {BlockToolData} from '../tools';
import {BlockTuneData} from '../block-tunes/block-tune-data';
import { BlockId } from './block-id';

/**
 * Output of one Tool
 *
 * @template Type - the string literal describing a tool type
 * @template Data - the structure describing a data object supported by the tool
 */
export interface OutputBlockData<Type extends string = string, Data extends object = any> {
  /**
   * Unique Id of the block
   */
  id?: BlockId;
  /**
   * Tool type
   */
  type: Type;
  /**
   * Saved Block data
   */
  data: BlockToolData<Data>;

  /**
   * Block Tunes data
   */
  tunes?: {[name: string]: BlockTuneData};

  /**
   * Parent block id for hierarchical/nested blocks (Notion-like flat-with-references model).
   * When present, this block is a child of the block with the specified id.
   * Omit for root-level blocks.
   */
  parent?: BlockId;

  /**
   * Array of child block ids (Notion-like flat-with-references model).
   * References blocks that are children of this block.
   * The referenced blocks should have their `parent` field set to this block's id.
   * Omit if block has no children.
   */
  content?: BlockId[];

  /**
   * Slot index within parent container (e.g., which column in a columns block).
   * Used for container blocks that have multiple slots like columns.
   * Omit if block doesn't need slot assignment.
   */
  slot?: number;
}

export interface OutputData {
  /**
   * Blok's version
   */
  version?: string;

  /**
   * Timestamp of saving in milliseconds
   */
  time?: number;

  /**
   * Saved Blocks
   */
  blocks: OutputBlockData[];
}
