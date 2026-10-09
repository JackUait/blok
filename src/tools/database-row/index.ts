import { describeDatabaseRow } from '../../shared/tool-descriptions/database-row';
import { databaseRowSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { BlockTool, BlockToolConstructorOptions } from '../../../types/tools/block-tool';
import type { SanitizerConfig } from '../../../types';
import type { ConvertedValue, DatabaseRowData, PropertyValue } from '../database/types';

const KNOWN_KEYS: ReadonlySet<string> = new Set(['properties', 'position', 'title', 'pageId']);

/**
 * Top-level keys this version does not know, kept as they came. A full save
 * prunes every key it leaves out from the shared document, so dropping a
 * newer version's key here would delete it for every client.
 */
const unknownKeys = (data: DatabaseRowData): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !KNOWN_KEYS.has(key)));

const toRowData = (data: DatabaseRowData): DatabaseRowData => {
  const row: DatabaseRowData = {
    properties: { ...data.properties },
    position: data.position ?? 'a0',
  };

  // Only carry `title` when the stored row already has one. A row written
  // before this key existed must NOT gain it on load: inventing it here is a
  // whole-key write of a value nobody typed, and it would race a peer.
  if (typeof data.title === 'string') {
    row.title = data.title;
  }
  if (typeof data.pageId === 'string' && data.pageId.length > 0) {
    row.pageId = data.pageId;
  }

  return row;
};

/**
 * DatabaseRowTool — lightweight block that stores a single database row.
 *
 * Not user-insertable (no toolbox entry). The parent DatabaseTool creates
 * and manages row blocks; this tool's job is to hold properties and position
 * as block data so rows participate in the block tree.
 *
 * Custom methods (updateProperties, updatePosition, getProperties, getPosition)
 * are accessed by the parent DatabaseTool via block.call('methodName', params),
 * which invokes tool instance methods by name through the Block adapter.
 */
export class DatabaseRowTool implements BlockTool {
  public static describe = describeDatabaseRow;

  private _data: DatabaseRowData;
  private unknown: Record<string, unknown>;

  constructor({ data }: BlockToolConstructorOptions<DatabaseRowData>) {
    this._data = toRowData(data);
    this.unknown = unknownKeys(data);
  }

  public render(): HTMLDivElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-tool', 'database-row');

    return el;
  }

  public save(_block: HTMLElement): DatabaseRowData {
    return this.snapshot();
  }

  private snapshot(): DatabaseRowData {
    const saved: DatabaseRowData = {
      ...structuredClone(this.unknown),
      properties: { ...this._data.properties },
      position: this._data.position,
    };

    if (this._data.title !== undefined) {
      saved.title = this._data.title;
    }
    if (this._data.pageId !== undefined) {
      saved.pageId = this._data.pageId;
    }

    return saved;
  }

  /**
   * Take undo/redo or a peer's data in place. The row has no DOM to rebuild,
   * so recreating the block for it would only churn the parent's board.
   */
  public setData(data: DatabaseRowData): boolean {
    this._data = toRowData(data);
    this.unknown = unknownKeys(data);

    return true;
  }

  public validate(data: DatabaseRowData): boolean {
    return data.properties !== null && data.properties !== undefined && typeof data.properties === 'object'
      && (data.pageId === undefined || (typeof data.pageId === 'string' && data.pageId.length > 0));
  }

  public updateProperties(changes: Record<string, PropertyValue>): void {
    Object.assign(this._data.properties, changes);
  }

  /**
   * Write the row title to BOTH places it lives.
   *
   * `title` is top-level, so the CRDT stores it as a Y.Text and two people
   * typing at once merge per character. `properties[titlePropertyId]` is the
   * published copy consumers and the backend adapter read, so it keeps being
   * written — it is a mirror of the merged value, not a second source.
   *
   * The row cannot work the property id out on its own: it lives in the PARENT
   * database block's schema, so the parent passes it in.
   */
  public updateTitle(param: { title: string; titlePropertyId: string }): void {
    this._data.title = param.title;

    if (param.titlePropertyId !== '') {
      this._data.properties[param.titlePropertyId] = param.title;
    }
  }

  /**
   * Keep or clear the originals a type change could not carry over. `null`
   * clears one. Stored as a top-level `convertedValues` map keyed by property
   * id, so two peers' entries merge key by key.
   */
  public updateConvertedValues(changes: Record<string, ConvertedValue | null>): void {
    const before = (this.unknown.convertedValues ?? {}) as Record<string, ConvertedValue>;
    const added = Object.entries(changes)
      .filter((entry): entry is [string, ConvertedValue] => entry[1] !== null)
      .map(([id, value]): [string, ConvertedValue] => [id, structuredClone(value)]);
    const kept: Record<string, ConvertedValue> = Object.fromEntries([
      ...Object.entries(before).filter(([propertyId]) => !(propertyId in changes)),
      ...added,
    ]);
    const { convertedValues: _old, ...rest } = this.unknown;

    this.unknown = Object.keys(kept).length === 0 ? rest : { ...rest, convertedValues: kept };
  }

  public getTitle(): string | undefined {
    return this._data.title;
  }

  public updatePageId(param: { pageId: string }): void {
    if (param.pageId.length > 0) {
      this._data.pageId = param.pageId;
    }
  }

  public updatePosition(param: { position: string }): void {
    this._data.position = param.position;
  }

  public getProperties(): Record<string, PropertyValue> {
    return this._data.properties;
  }

  public getPosition(): string {
    return this._data.position;
  }

  /**
   * Hand a copy of the row's current data to `param.receive`.
   *
   * The parent reads rows through `block.call`, which drops return values, so
   * the copy goes to the callback it passes. The block's `preservedData` is
   * no substitute: it is the last SAVED data and lags every write.
   */
  public readData(param: { receive: (data: DatabaseRowData) => void }): void {
    param.receive(this.snapshot());
  }

  /**
   * Plain text and bare URLs: an HTML parse would cut text at `<` and turn `&` into `&amp;`.
   */
  public static get sanitize(): SanitizerConfig {
    return databaseRowSanitize();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * No-op: DatabaseRowTool renders an invisible div with no interactive elements.
   * Implementing this method enables the fast-path in-place read-only toggle in
   * the ReadOnly module (which requires ALL tools to have setReadOnly()).
   */
  public setReadOnly(_state: boolean): void {
    // intentionally empty
  }
}

export type { DatabaseRowData };
