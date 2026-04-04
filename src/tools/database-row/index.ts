import type { BlockTool, BlockToolConstructorOptions } from '../../../types/tools/block-tool';
import type { DatabaseRowData, PropertyValue } from '../database/types';

/**
 * DatabaseRowTool — lightweight block that stores a single database row.
 *
 * Not user-insertable (no toolbox entry). The parent DatabaseTool creates
 * and manages row blocks; this tool's job is to hold properties and position
 * as block data so rows participate in the block tree.
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

  public save(): DatabaseRowData {
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

  public updatePosition(position: string): void {
    this._data.position = position;
  }

  public getProperties(): Record<string, PropertyValue> {
    return this._data.properties;
  }

  public getPosition(): string {
    return this._data.position;
  }

  public static get toolbox(): undefined {
    return undefined;
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { DatabaseRowData };
