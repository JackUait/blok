import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { DatabaseRowData, PropertyValue } from './database';

/**
 * DatabaseRow Tool constructor options
 */
export type DatabaseRowConstructorOptions = BlockToolConstructorOptions<DatabaseRowData>;

/**
 * DatabaseRow Tool for the Blok Editor.
 *
 * A row of a Database block: a child block whose `data.properties` conform to
 * the parent database's schema. This is the block tool class — distinct from
 * the `DatabaseRow` row-shape interface exported by `./database`.
 */
export declare class DatabaseRow implements BlockTool {
  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  constructor(options: DatabaseRowConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLDivElement;

  /**
   * Extract Tool's data from the view
   */
  save(block: HTMLElement): DatabaseRowData;

  /**
   * Validate DatabaseRow block data
   */
  validate(data: DatabaseRowData): boolean;

  /**
   * Merge property changes into the row
   */
  updateProperties(changes: Record<string, PropertyValue>): void;

  /**
   * Update the row's fractional-index position
   */
  updatePosition(param: { position: string }): void;

  /**
   * Current property values
   */
  getProperties(): Record<string, PropertyValue>;

  /**
   * Current fractional-index position
   */
  getPosition(): string;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;
}
