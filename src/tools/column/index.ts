import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
} from '../../../types';
import { COLUMN_ATTR, unwrapColumnListIfCollapsed } from '../columns-shared';
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
  private readonly parentId: string | null;
  private readonly block: BlockToolConstructorOptions<ColumnData>['block'];
  private childContainer: HTMLElement | null = null;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
    this.parentId = block.parentId;
    this.block = block;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge('flex', 'flex-col', 'min-w-0');
    wrapper.setAttribute(COLUMN_ATTR, '');

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

    // The flex item is the block holder, not the rendered wrapper, and the
    // holder only exists once the block is composed (post-render). Grow it so
    // sibling columns split the row evenly; widthRatio biases the split.
    this.block.holder.style.flexGrow = String(this._data.widthRatio ?? 1);

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
    // The resizer mutates the holder's flex-grow live, so the holder is the
    // source of truth once rendered. Fall back to the seeded data before the
    // holder exists. An even-split grow of 1 is the default — omit it.
    const liveGrow = this.block.holder?.style.flexGrow;
    const ratio = liveGrow !== undefined && liveGrow !== ''
      ? Number(liveGrow)
      : this._data.widthRatio;

    return ratio !== undefined && ratio !== 1
      ? { widthRatio: ratio }
      : {};
  }

  public validate(_data: ColumnData): boolean {
    return true;
  }

  public removed(): void {
    if (this.parentId !== null) {
      // Fire-and-forget: the lifecycle hook is synchronous, the unwrap is not.
      // Pass blockId as excludeId: removed() fires before the flat array splice,
      // so getChildren still includes this block; exclude it for the count check.
      void unwrapColumnListIfCollapsed(this.api, this.parentId, this.blockId);
    }
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnData };
