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
  private readonly block: BlockToolConstructorOptions<ColumnData>['block'];
  private childContainer: HTMLElement | null = null;
  // Latched once the column has ever held content (mounted children or a seed).
  // Distinguishes a fresh empty column (first render → seed) from one emptied
  // later by a drag-out (re-render → self-delete).
  private populated = false;

  constructor({ data, api, block }: BlockToolConstructorOptions<ColumnData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
    this.block = block;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    // `break-words` lets long unbreakable words reflow so a column can be
    // resized arbitrarily thin instead of being held open at its min-content
    // width. overflow-wrap is inherited, so descendant text picks it up.
    wrapper.className = twMerge('flex', 'flex-col', 'min-w-0', 'break-words');
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
    // A flex item defaults to min-width:auto (its min-content), which would
    // floor the column at the width of its widest content. Allow it to shrink
    // freely so the resizer has no min-width restriction.
    this.block.holder.style.minWidth = '0';

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length > 0) {
      this.populated = true;
      mountChildBlocks(this.childContainer, children);

      return;
    }

    // Empty AFTER having held content: the column's last block was dragged out,
    // which re-fires rendered(). A column is pure layout, never standalone — so
    // it removes itself rather than lingering as a dead, uninteractable box.
    if (this.populated) {
      this.deleteSelf();

      return;
    }

    // Empty on the FIRST render. noSeed is a one-shot creation hint: a column-list
    // wrap / add-column fills the column explicitly right afterwards, so suppress
    // the seed this once and let the follow-up render mount the moved-in blocks.
    if (this._data.noSeed === true) {
      this._data.noSeed = false;

      return;
    }

    // A fresh, unseeded column (e.g. a slash-menu preset): seed it so it is
    // never empty.
    this.seedParagraph();
    this.populated = true;
  }

  /**
   * Remove this now-childless column from its column_list. Deferred to a
   * microtask because rendered() runs inside the drop's affected-parents loop;
   * an index-based delete fired synchronously would splice the flat array
   * mid-iteration. Re-check emptiness at fire time so a column refilled before
   * the microtask runs is spared. Deleting the column triggers its own removed()
   * hook, which unwraps the column_list if this leaves a single survivor.
   */
  private deleteSelf(): void {
    queueMicrotask(() => {
      if (this.api.blocks.getChildren(this.blockId).length > 0) {
        return;
      }

      const index = this.api.blocks.getBlockIndex(this.blockId);

      if (index !== undefined) {
        void this.api.blocks.delete(index);
      }
    });
  }

  /**
   * Seed the empty column with a paragraph. The first seeded column of a freshly
   * created column_list claims the caret; siblings carry noFocus so the
   * asynchronous last column never steals it (see {@link ColumnData}).
   */
  private seedParagraph(): void {
    const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (blockIndex === undefined || this.childContainer === null) {
      return;
    }

    const paragraph = this.api.blocks.insertInsideParent(this.blockId, blockIndex + 1);

    this.childContainer.appendChild(paragraph.holder);

    if (this._data.noFocus !== true) {
      this.api.caret.setToBlock(paragraph.id, 'start');
    }
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
    // removed() runs INSIDE blocksStore.remove, BEFORE this block is spliced
    // out of the flat array. The unwrap below issues index-based deletes
    // (deleteById) of the surviving column + the column_list; running them now
    // would splice the array mid-removal, shifting indices so the outer splice
    // hits the wrong slot — the storm that drops innocent blocks when an empty
    // column collapses. Defer to a microtask so the triggering removal finishes
    // its splice first and every nested delete runs on a stable array.
    //
    // Read the LIVE parent id (off the block) at fire time, not the id captured
    // at construction: a column detached to root before deletion must skip.
    queueMicrotask(() => {
      const parentId = this.block.parentId;

      if (parentId !== null) {
        // Pass blockId as excludeId so a not-yet-spliced self is excluded from
        // the surviving-column count.
        void unwrapColumnListIfCollapsed(this.api, parentId, this.blockId);
      }
    });
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { ColumnData };
