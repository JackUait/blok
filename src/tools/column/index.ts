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
  private readOnly: boolean;
  private bottomZoneBound = false;
  // Latched once the column has ever held content (mounted children or a seed).
  // Distinguishes a fresh empty column (first render → seed) from one emptied
  // later by a drag-out (re-render → self-delete).
  private populated = false;

  constructor({ data, api, block, readOnly }: BlockToolConstructorOptions<ColumnData>) {
    this.api = api;
    this._data = { ...data };
    this.blockId = block.id;
    this.block = block;
    this.readOnly = readOnly;
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

    // Columns stretch to the tallest sibling, so a short column has dead space
    // under its content. That space belongs to the holder (the flex item), not
    // to the rendered wrapper — so the listener has to live on the holder.
    // rendered() re-fires on every child mount; bind only once.
    if (!this.bottomZoneBound) {
      this.block.holder.addEventListener('click', this.handleHolderClick);
      this.bottomZoneBound = true;
    }

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
   * Click in the column's dead space below its content — the per-column echo of
   * the editor's bottom zone: append an empty text block and focus it, so the
   * space is writable instead of inert.
   * @param event - the click that landed inside the column's holder
   */
  private readonly handleHolderClick = (event: MouseEvent): void => {
    if (this.readOnly || this.childContainer === null) {
      return;
    }

    // A click on a child block is the child's business, not ours.
    if (event.target instanceof Node && this.childContainer.contains(event.target)) {
      return;
    }

    // A drag-selection released in the dead space fires a click on the holder;
    // creating a block would destroy the selection the user just made.
    if (window.getSelection()?.isCollapsed === false) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);
    const lastChild = children[children.length - 1];

    // Already ends in an empty paragraph — focus it instead of stacking another.
    if (lastChild !== undefined && lastChild.isEmpty && lastChild.name === 'paragraph') {
      this.api.caret.setToBlock(lastChild.id, 'end');

      return;
    }

    const paragraph = this.api.blocks.insertInsideParent(this.blockId, this.subtreeEndIndex(this.blockId) + 1);

    this.childContainer.appendChild(paragraph.holder);
    this.api.caret.setToBlock(paragraph.id, 'start');
  };

  /**
   * Highest flat-array index occupied by a block's subtree. insertInsideParent
   * appends to the parent's contentIds but places the block at the given FLAT
   * index, so appending to a column whose last child is itself a container (a
   * toggle, a callout) must clear that container's descendants too.
   * @param blockId - root of the subtree to measure
   */
  private subtreeEndIndex(blockId: string): number {
    const index = this.api.blocks.getBlockIndex(blockId) ?? -1;

    return this.api.blocks
      .getChildren(blockId)
      .reduce((max, child) => Math.max(max, this.subtreeEndIndex(child.id)), index);
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

  /**
   * A column is pure layout with no interactive chrome of its own (the resize
   * separators belong to the parent column_list), so the in-place read-only
   * toggle needs no DOM changes beyond muting the bottom-zone click. The method
   * must still exist: the editor only takes the in-place toggle path (instead of
   * a full save/clear/render) when EVERY registered tool implements setReadOnly.
   * @param state - true when the editor is entering read-only mode
   */
  public setReadOnly(state: boolean): void {
    this.readOnly = state;
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
