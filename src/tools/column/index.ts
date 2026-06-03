import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
} from '../../../types';
import { COLUMN_ATTR } from '../columns-shared';
import { mountChildBlocks } from '../nested-blocks';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { twMerge } from '../../components/utils/tw';
import type { ColumnData } from './types';

/**
 * Column block — a single vertical column inside a column_list.
 * Hosts arbitrary user blocks as nested children and seeds an empty
 * paragraph when created so it is never empty.
 */
export class Column implements BlockTool {
  private readonly api: API;
  private _data: ColumnData;
  private readonly blockId: string;
  private childContainer: HTMLElement | null = null;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge('flex', 'flex-col', 'min-w-0', 'basis-0');
    wrapper.setAttribute(COLUMN_ATTR, '');
    wrapper.style.flexGrow = String(this._data.widthRatio ?? 1);

    const childContainer = document.createElement('div');

    childContainer.setAttribute(DATA_ATTR.nestedBlocks, '');
    wrapper.appendChild(childContainer);

    this.childContainer = childContainer;

    return wrapper;
  }

  public rendered(): void {
    if (this.childContainer === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

      if (blockIndex !== undefined) {
        const paragraph = this.api.blocks.insertInsideParent(this.blockId, blockIndex + 1);

        this.childContainer.appendChild(paragraph.holder);
        this.api.caret.setToBlock(paragraph.id, 'start');
      }

      return;
    }

    mountChildBlocks(this.childContainer, children);
  }

  public save(): ColumnData {
    return this._data.widthRatio !== undefined
      ? { widthRatio: this._data.widthRatio }
      : {};
  }

  public validate(_data: ColumnData): boolean {
    return true;
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnData };
