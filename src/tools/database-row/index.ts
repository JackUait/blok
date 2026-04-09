import type { BlockTool, BlockToolConstructorOptions } from '../../../types/tools/block-tool';
import type { DatabaseRowData, PropertyValue } from '../database/types';

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
    this._data = {
      properties: data.properties ?? {},
      position: data.position ?? 'a0',
    };
  }

  public render(): HTMLDivElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-tool', 'database-row');

    return el;
  }

  public save(_block: HTMLElement): DatabaseRowData {
    return {
      properties: this._data.properties,
      position: this._data.position,
    };
  }

  public validate(data: DatabaseRowData): boolean {
    return data.properties !== null && data.properties !== undefined && typeof data.properties === 'object';
  }

  public updateProperties(changes: Record<string, PropertyValue>): void {
    Object.assign(this._data.properties, changes);
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
