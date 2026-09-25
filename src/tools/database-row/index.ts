import type { BlockTool, BlockToolConstructorOptions } from '../../../types/tools/block-tool';
import type { SanitizerConfig } from '../../../types';
import { PLAINTEXT } from '../../components/utils/sanitizer';
import type { DatabaseRowData, PropertyValue } from '../database/types';

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
  private _data: DatabaseRowData;

  constructor({ data }: BlockToolConstructorOptions<DatabaseRowData>) {
    this._data = toRowData(data);
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
      properties: { ...this._data.properties },
      position: this._data.position,
    };

    if (this._data.title !== undefined) {
      saved.title = this._data.title;
    }

    return saved;
  }

  /**
   * Take undo/redo or a peer's data in place. The row has no DOM to rebuild,
   * so recreating the block for it would only churn the parent's board.
   */
  public setData(data: DatabaseRowData): boolean {
    this._data = toRowData(data);

    return true;
  }

  public validate(data: DatabaseRowData): boolean {
    return data.properties !== null && data.properties !== undefined && typeof data.properties === 'object';
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

  public getTitle(): string | undefined {
    return this._data.title;
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
    return {
      title: PLAINTEXT,
      properties: PLAINTEXT,
      position: PLAINTEXT,
    };
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
