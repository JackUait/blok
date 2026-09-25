import { SanitizerConfig } from '../configs';
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

  /**
   * Plain-text and URL fields, declared PLAINTEXT so load and save never parse them as HTML
   */
  static sanitize?: SanitizerConfig;

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
   * Replace the row's data in place (undo/redo, a peer's change)
   */
  setData(data: DatabaseRowData): boolean;

  /**
   * Validate DatabaseRow block data
   */
  validate(data: DatabaseRowData): boolean;

  /**
   * Merge property changes into the row
   */
  updateProperties(changes: Record<string, PropertyValue>): void;

  /**
   * Write the row title to the top-level `title` key AND to the
   * `properties[titlePropertyId]` mirror. The property id comes from the parent
   * database's schema, so the caller passes it in.
   */
  updateTitle(param: { title: string; titlePropertyId: string }): void;

  /**
   * The row's top-level title, or undefined on a row saved before that key
   * existed (its title is in `properties`).
   */
  getTitle(): string | undefined;

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
   * Hand a copy of the row's current data to `param.receive`. Lets the parent
   * read the live row through `block.call`, which returns nothing.
   */
  readData(param: { receive: (data: DatabaseRowData) => void }): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;
}
