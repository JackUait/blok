import type { BlokConfig } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { Block } from '../../../block';
import { Flipper } from '../../../flipper';
import { SelectionUtils } from '../../../selection';
import { keyCodes, delay, isIosDevice } from '../../../utils';
import { areBlocksMergeable } from '../../../utils/blocks';
import { findNbspAfterEmptyInline, focus, isCaretAtEndOfInput, isCaretAtStartOfInput } from '../../../utils/caret/index';
import { EDITABLE_INPUT_SELECTOR, HEADER_TOOL_NAME, LIST_TOOL_NAME, QUOTE_TOOL_NAME } from '../constants';
import { deliverOnSubmit } from '../../../utils/on-submit';
import { keyCodeFromEvent } from '../utils/keyboard';

import { BlockEventComposer } from './__base';
import { getIndentTarget, getFollowingSiblings } from './structural-siblings';

/**
 * Checks if the keyboard event is a block movement shortcut (Cmd/Ctrl+Shift+Arrow)
 * @param event - keyboard event
 * @param direction - 'up' or 'down'
 * @returns true if this is a block movement shortcut
 */
const isBlockMovementShortcut = (event: KeyboardEvent, direction: 'up' | 'down'): boolean => {
  const targetKey = direction === 'up' ? 'ArrowUp' : 'ArrowDown';

  return event.key === targetKey &&
    event.shiftKey &&
    (event.ctrlKey || event.metaKey);
};

/**
 * KeyboardNavigation Composer handles caret and block navigation via keyboard.
 *
 * Handles:
 * - Arrow keys for navigation (both horizontal and vertical)
 * - Enter key for block creation/splitting
 * - Tab key for navigating between inputs
 * - NBSP handling after empty inline elements
 * - Block merging on Backspace/Delete when at boundaries
 */
export class KeyboardNavigation extends BlockEventComposer {
  /**
   * @param Blok - Blok modules
   * @param getOnEnter - resolves the consumer-level `config.onEnter` hook at
   * call time (a getter, so the composer never holds a stale reference)
   * @param getOnSubmit - resolves the consumer-level `config.onSubmit` hook at
   * call time (same reasoning as `getOnEnter`)
   */
  constructor(
    Blok: BlokModules,
    private readonly getOnEnter: () => BlokConfig['onEnter'] = () => undefined,
    private readonly getOnSubmit: () => BlokConfig['onSubmit'] = () => undefined
  ) {
    super(Blok);
  }

  /**
   * Determine if we're using RTL layout.
   * In RTL, right/left navigation is inverted.
   */
  private get isRtl(): boolean {
    const ui = this.Blok.UI as unknown as { isRtl?: boolean };
    return ui.isRtl ?? false;
  }

  /**
   * Check if the current block is inside a table cell.
   * Used to prevent closing the toolbar when the user navigates
   * within a table — closing it makes the toolbar permanently
   * disappear because the hover controller deduplicates by block id
   * and all cells resolve to the same parent table block.
   */
  private get isCurrentBlockInsideTableCell(): boolean {
    const currentBlock = this.Blok.BlockManager.currentBlock;

    return Boolean(currentBlock?.holder?.closest('[data-blok-table-cell-blocks]'));
  }

  /**
   * Inside a table cell, a Shift+Arrow that starts from a plain caret belongs to
   * the table's rectangular CELL selection (TableCellSelection), not to the core's
   * cross-block selection — a CBS there would select the cell's child blocks and
   * fight the cell rectangle for the same gesture.
   *
   * Deferral is limited to the "starting from a caret" case: once lines inside the
   * cell are already block-selected (e.g. Cmd+A on a cell line), Shift+Arrow keeps
   * extending that intra-cell selection exactly as before.
   *
   * Every core cross-block-selection entry point must consult this guard —
   * enforced by test/unit/architecture/table-cell-keyboard-guard-law.test.ts.
   */
  private get shouldDeferSelectionToTableCell(): boolean {
    return this.isCurrentBlockInsideTableCell && !this.Blok.BlockSelection.anyBlockSelected;
  }

  /**
   * Resolve the table-cell-blocks container element that owns the given block,
   * or null if the block is not inside a table cell.
   */
  private getTableCellContainer(block: Block | null | undefined): HTMLElement | null {
    return block?.holder?.closest<HTMLElement>('[data-blok-table-cell-blocks]') ?? null;
  }

  /**
   * True when `a` and `b` live inside the same table cell (same
   * `[data-blok-table-cell-blocks]` container). Used to decide whether
   * a Backspace/Delete merge would cross a cell boundary.
   */
  private areBlocksInSameTableCell(a: Block | null | undefined, b: Block | null | undefined): boolean {
    const cellA = this.getTableCellContainer(a);
    const cellB = this.getTableCellContainer(b);

    return cellA !== null && cellA === cellB;
  }

  /**
   * Fully close the toolbar if the current block is NOT inside a table cell.
   * Used for destructive operations (Backspace, Delete, merge) where the
   * toolbar should be dismissed — unlike arrow navigation where
   * hideBlockActions() is preferred to allow reopening.
   */
  private closeToolbarIfNotInTableCell(): void {
    if (this.isCurrentBlockInsideTableCell) {
      return;
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Tab pressed inside a Block.
   * @param event - keydown event
   */
  public handleTab(event: KeyboardEvent): void {
    const { InlineToolbar, BlockSelection } = this.Blok;

    const isFlipperActivated = InlineToolbar.opened;

    if (isFlipperActivated) {
      return;
    }

    /**
     * Skip Tab handling for blocks inside table cells — the table's own grid-level
     * handler (setupKeyboardNavigation) manages cell-to-cell and table-exit navigation.
     */
    if (this.isCurrentBlockInsideTableCell) {
      return;
    }

    /**
     * Multi-block selections are indented/outdented by blockSelectionKeys.handleIndent,
     * which runs before this handler. If we still reach here with a selection it could
     * not act, so do nothing rather than relocate the caret.
     */
    if (BlockSelection.anyBlockSelected) {
      return;
    }

    /**
     * Notion-style indentation: Tab nests the current block under the preceding
     * sibling; Shift+Tab outdents.
     *
     * Wrap the structural reparent in a single `transactMoves` group so it lands
     * as ONE atomic, undoable entry — exactly like a drag-drop reparent. A bare
     * `setBlockParent` splits across two history stacks (the array-reorder move
     * stack plus the `parentId`/`contentIds` write on Y.UndoManager), so a single
     * Cmd+Z cannot reverse it. `transactMoves` routes the parent write through
     * `transactWithoutCapture` and attaches it to the move entry. It also keeps the
     * indent OFF the typing's Y.UndoManager entry, so one Cmd+Z reverts only the
     * indent and the text typed just before it survives.
     */
    const { YjsManager } = this.Blok;
    const outcome = { handled: false };
    const reparent = (): void => {
      outcome.handled = event.shiftKey ? this.outdentCurrentBlock() : this.indentCurrentBlock();
    };

    if (typeof YjsManager.transactMoves === 'function') {
      YjsManager.transactMoves(reparent);
    } else {
      reparent();
    }

    if (outcome.handled) {
      /**
       * The indent/outdent shifts the block horizontally. The toolbar's
       * content-relative gutter offset is cached by the positioner, so without
       * an explicit reposition the +/⋮⋮ handles keep the pre-indent offset and
       * end up jammed against the text. Re-run moveAndOpen (same call Enter
       * makes) so the positioner recomputes against the new nested geometry.
       */
      this.Blok.Toolbar.moveAndOpen(this.Blok.BlockManager.currentBlock);

      event.preventDefault();

      return;
    }

    /**
     * Indent/outdent was impossible (no preceding sibling for Tab, already at root
     * for Shift+Tab). Notion never tabs focus OUT of the editor, so a non-indentable
     * Tab must not relocate focus to an element outside Blok.
     *
     * Exception: a block with multiple inputs (e.g. a caption) should still let
     * native Tab walk between its own inputs. So if the current block has a further
     * input in the Tab direction, let native Tab move to it (it stays inside the
     * editor); otherwise preventDefault so focus stays put instead of leaving.
     */
    const { currentBlock } = this.Blok.BlockManager;
    const hasInputToMoveTo = event.shiftKey
      ? currentBlock?.previousInput !== undefined
      : currentBlock?.nextInput !== undefined;

    if (hasInputToMoveTo) {
      return;
    }

    event.preventDefault();
  }

  /**
   * Indent the current block one level deeper, nesting it structurally under the
   * immediately preceding sibling (the block right above it at the same parent
   * level) via parentId/contentIds — matching Notion's Tab rule.
   *
   * @returns true if the block was indented; false when it cannot be (no
   *   preceding sibling), so the caller can treat Tab as a no-op.
   */
  private indentCurrentBlock(): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock } = BlockManager;

    if (currentBlock === undefined) {
      return false;
    }

    /**
     * Notion's Tab nests the block as the LAST child of its preceding sibling
     * (the nearest block before it at the same level). No indent target — the
     * block is the first child of its parent (or the first block), or the
     * sibling above owns its children (a table, a column_list) and can never
     * adopt it — means there is nothing to nest under, so this is a no-op.
     */
    const indentTarget = getIndentTarget(BlockManager, currentBlock);

    if (indentTarget === null) {
      return false;
    }

    BlockManager.setBlockParent(currentBlock, indentTarget.id);

    return true;
  }

  /**
   * Outdent the current block one structural level. The block becomes a sibling
   * of its former parent (a child of the grandparent), and — matching Notion's
   * outliner — adopts its following same-parent siblings as its own children.
   *
   * @returns true if the block was outdented; false when it cannot be (already
   *   at root), so the caller can treat Shift+Tab as a no-op.
   */
  private outdentCurrentBlock(): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock } = BlockManager;

    if (currentBlock === undefined) {
      return false;
    }

    if (currentBlock.parentId === null) {
      return false;
    }

    const parent = BlockManager.getBlockById(currentBlock.parentId);

    if (parent === undefined) {
      return false;
    }

    const grandparentId = parent.parentId;

    /**
     * Capture the following siblings BEFORE any reparent (reparenting mutates
     * the parent's contentIds), then adopt them under the outdented block so the
     * content that used to sit below it stays nested beneath it.
     */
    const followingSiblings = getFollowingSiblings(BlockManager, currentBlock);

    for (const sibling of followingSiblings) {
      BlockManager.setBlockParent(sibling, currentBlock.id);
    }

    BlockManager.setBlockParent(currentBlock, grandparentId);

    return true;
  }

  /**
   * ENTER pressed on block
   * @param event - keydown event
   */
  public handleEnter(event: KeyboardEvent): void {
    const { BlockManager, UI } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (currentBlock === undefined) {
      return;
    }

    /**
     * An Enter that commits an IME composition (CJK/accent input) fires keydown
     * with `isComposing` true. It belongs to the input method, not to blok —
     * splitting the block or invoking `onEnter` here would fire mid-word and
     * swallow the browser's composition commit. Bail before any Enter handling.
     */
    if (event.isComposing) {
      return;
    }

    /**
     * Don't handle Enter keydowns when Tool sets enableLineBreaks to true.
     * Uses for Tools like <code> where line breaks should be handled by default behaviour.
     */
    if (currentBlock.tool.isLineBreaksEnabled) {
      return;
    }

    /**
     * Opened Toolbars uses Flipper with own Enter handling
     * Allow split block when no one button in Flipper is focused
     */
    if (UI.someToolbarOpened && UI.someFlipperButtonFocused) {
      return;
    }

    /**
     * Allow to create line breaks by Shift+Enter
     *
     * Note. On iOS devices, Safari automatically treats enter after a period+space (". |") as Shift+Enter
     * (it used for capitalizing of the first letter of the next sentence)
     * We don't need to lead soft line break in this case — new block should be created
     */
    if (event.shiftKey && !isIosDevice) {
      return;
    }

    /**
     * Consumer-level Enter hook (`config.onEnter`). Runs after the built-in
     * escapes above (enableLineBreaks, flipper, Shift+Enter) so those behaviors
     * stay untouched. Returning `true` means "handled": blok suppresses its
     * default block split/create but still prevents the browser's native newline.
     */
    const onEnter = this.getOnEnter();

    if (typeof onEnter === 'function' && onEnter(event, this.Blok.API.methods) === true) {
      event.preventDefault();

      return;
    }

    /**
     * Consumer-level submit hook (`config.onSubmit`) — the "Enter sends"
     * gesture. Runs after `onEnter` (a handled `onEnter` takes precedence) and
     * inherits the same escapes above (enableLineBreaks, flipper, Shift+Enter,
     * IME), so it only fires on the Enter that would otherwise create a block.
     * It serializes the document and hands it to the consumer, and suppresses
     * the default block split/create (Enter submits, it does not insert a line).
     */
    const onSubmit = this.getOnSubmit();

    if (typeof onSubmit === 'function') {
      event.preventDefault();
      deliverOnSubmit(() => this.Blok.Saver.save(), this.Blok.API.methods, onSubmit);

      return;
    }

    /**
     * Capture caret position before block creation so undo can restore it.
     * Must run before stopCapturing/block insertion since the keyboard capture
     * handler fires AFTER handleEnter (document capture runs before redactor capture).
     */
    this.Blok.YjsManager.markCaretBeforeChange();

    /**
     * Use transactForTool to keep the entire Enter operation in a single undo entry:
     * 1. Calls stopCapturing() to separate from previous typing
     * 2. Suppresses stopCapturing during block creation + caret movement
     *    (prevents currentBlockIndex setter from splitting the undo entry
     *    before async table cell content sync completes)
     * 3. Calls stopCapturing() in rAF after all async syncs complete
     */
    this.Blok.BlockManager.transactForTool(() => {
      const blockToFocus = this.createBlockOnEnter(currentBlock);

      this.Blok.Caret.setToBlock(blockToFocus);

      /**
       * Refresh the "after" caret snapshot now that focus has moved to the new
       * block. Yjs `stack-item-added` fires inside createBlockOnEnter (the split
       * / insert transaction) BEFORE setToBlock runs, so the snapshot captured
       * there still points at the original block. Without this, redo restores
       * the caret to the old block instead of the newly created one.
       */
      this.Blok.YjsManager.updateLastCaretAfterPosition();

      /**
       * Show Toolbar
       */
      this.Blok.Toolbar.moveAndOpen(blockToFocus);
    });

    event.preventDefault();
  }

  /**
   * Determines which block to create when Enter is pressed and returns the block to focus.
   * Handles three cases:
   * 1. Caret at start of block → insert empty block above, focus stays on current
   * 2. Caret at end of block → insert empty block below, focus moves to new block
   * 3. Caret in middle → split block, focus moves to new block
   *
   * @param currentBlock - the block where Enter was pressed
   * @returns the block that should receive focus after the operation
   */
  /**
   * If the current block is an empty last child of a toggle, promotes it to a
   * sibling after the toggle (like pressing Enter on an empty last list item).
   * Returns the promoted block, or null if no promotion occurred.
   */
  /**
   * Whether a nested block should stepwise-outdent — used both for Enter on an
   * empty nested block and for Backspace at the start of a nested block (the
   * "remove one indent level" gesture). True only for blocks structurally nested
   * under a PLAIN parent (e.g. a paragraph indented under another paragraph via
   * Tab). Special containers — toggles, columns and callouts — manage their own
   * child behaviour and are excluded, as are table cells and lists (lists handle
   * their own keydowns).
   * @param block - the nested block where Enter/Backspace was pressed
   */
  /**
   * True when `block`'s immediate parent is a toggle container — the toggle tool
   * or a toggle heading, both of which render the `data-blok-toggle-open` marker on
   * their wrapper. Column and callout containers do not render it, so they keep
   * their own empty-child behaviour. Used to decide whether a no-previous-sibling
   * Backspace should outdent the child out of the toggle (Notion parity).
   * @param block - the block whose parent is inspected
   */
  private hasToggleParent(block: Block): boolean {
    if (block.parentId === null) {
      return false;
    }

    const parent = this.Blok.BlockManager.getBlockById(block.parentId);

    return parent !== undefined && parent.holder.querySelector('[data-blok-toggle-open]') !== null;
  }

  private shouldOutdentNestedBlock(block: Block): boolean {
    if (block.parentId == null || block.name === LIST_TOOL_NAME || this.isCurrentBlockInsideTableCell) {
      return false;
    }

    const parent = this.Blok.BlockManager.getBlockById(block.parentId);

    if (parent === undefined) {
      return false;
    }

    /**
     * Container tools (toggle, callout, column) render a dedicated nested-blocks
     * area in their holder and own their empty-child Enter behaviour. A plain
     * structural parent (a paragraph/header with Tab-nested children) renders no
     * such area — only that case should stepwise-outdent.
     */
    const hasNestedBlocksContainer = parent.holder.querySelector(
      '[data-blok-toggle-open], [data-blok-toggle-children], [data-blok-nested-blocks]'
    ) !== null;

    if (hasNestedBlocksContainer || parent.name === 'column' || parent.name === 'column_list') {
      return false;
    }

    return true;
  }

  private promoteLastEmptyToggleChild(currentBlock: Block): Block | null {
    if (!currentBlock.isEmpty || currentBlock.parentId == null || this.isCurrentBlockInsideTableCell) {
      return null;
    }

    const parentBlock = this.Blok.BlockManager.getBlockById(currentBlock.parentId);
    const isLastChild = parentBlock !== undefined &&
      parentBlock.contentIds[parentBlock.contentIds.length - 1] === currentBlock.id;

    if (!isLastChild || parentBlock === undefined) {
      return null;
    }

    const isToggleParent = parentBlock.holder.querySelector('[data-blok-toggle-open]') !== null;

    if (isToggleParent) {
      /**
       * Toggle children should never be promoted out — pressing Enter on an
       * empty last child creates a new sibling inside the toggle instead.
       * The caller (createBlockOnEnter) handles this via the normal Case 2
       * path: insertDefaultBlockAtIndex + setBlockParent to inherit the parent.
       */
      return null;
    }

    /**
     * Columns must never be unwrapped by Enter. A 'column' is a single-child
     * non-toggle container whose own parent is a 'column_list'. Promoting its
     * empty sole child after the parent index would insert a new block at the
     * document root (parentId=null), escaping the column and stranding the
     * holder at the workingArea root. Returning null falls through to the
     * normal Case 2 path, which re-parents the new sibling into the same
     * column and leaves the column_list intact.
     */
    if (parentBlock.name === 'column' || parentBlock.name === 'column_list') {
      return null;
    }

    /**
     * Non-toggle containers (e.g. callout): when the only child is empty,
     * exit by inserting a new block after the container. The container and
     * its child are preserved so the user can return to it.
     */
    if (parentBlock.contentIds.length !== 1) {
      return null;
    }

    const parentIndex = this.Blok.BlockManager.getBlockIndex(parentBlock);

    return this.Blok.BlockManager.insertDefaultBlockAtIndex(parentIndex + 1);
  }

  private createBlockOnEnter(currentBlock: Block): Block {
    /**
     * When the current block is top-level (parentId === null), pass forceTopLevel
     * so the new block's DOM holder is anchored at workingArea root level even if
     * the previous block in the flat array is nested inside a callout/toggle/table.
     * Without this, insertAdjacentElement('afterend', previousBlock.holder) drops
     * the new holder inside the nested container — the Enter-after-callout bug.
     */
    const isCurrentTopLevel = currentBlock.parentId === null;

    /**
     * Empty styled block + Enter: convert the block to a plain paragraph IN PLACE
     * (preserving its position), instead of leaving the empty styled block behind.
     * The caret stays in the now-paragraph. Covers headings and quotes — the same
     * styled blocks the Backspace path resets to text. Toggle headings are excluded
     * — their open state nests a new child via the Case 2 toggle path below.
     */
    const isToggleHeading = currentBlock.holder.querySelector('[data-blok-toggle-open]') !== null;
    const resetsToTextOnEmptyEnter = currentBlock.name === HEADER_TOOL_NAME || currentBlock.name === QUOTE_TOOL_NAME;

    if (currentBlock.isEmpty && resetsToTextOnEmptyEnter && !isToggleHeading) {
      return this.Blok.BlockManager.replace(currentBlock, this.Blok.Tools.defaultTool.name, { text: '' });
    }

    /**
     * Empty nested block + Enter: stepwise outdent (Notion). Instead of creating a
     * new sibling below, promote THIS block one structural level (to its grandparent,
     * adopting its following siblings — the same as Shift+Tab) and keep the caret in
     * it. Repeated Enter steps it out until it reaches the top level, where the normal
     * Case 2 path then creates a new block. Special containers (toggle, column,
     * callout) are excluded — they keep their own empty-child Enter behaviour below.
     */
    if (currentBlock.isEmpty && this.shouldOutdentNestedBlock(currentBlock)) {
      this.outdentCurrentBlock();

      return currentBlock;
    }

    /**
     * Case 1: Caret at start - insert block above.
     *
     * For an EMPTY non-default block (e.g. a heading), inserting above and keeping
     * the caret would trap it in the still-empty heading. Notion instead exits the
     * heading: a new default paragraph is created below and the caret moves into it.
     * So empty non-default blocks skip Case 1 and fall through to Case 2.
     * (An empty default paragraph keeps Case 1 — inserting above with the caret on
     * the now-lower block is equivalent to inserting below and moving down.)
     */
    const isEmptyNonDefaultBlock = currentBlock.isEmpty && !currentBlock.tool.isDefault;

    if (currentBlock.currentInput !== undefined && isCaretAtStartOfInput(currentBlock.currentInput) && !currentBlock.hasMedia && (currentBlock.parentId === null || !currentBlock.isEmpty) && !isEmptyNonDefaultBlock) {
      const newBlock = this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex, false, false, isCurrentTopLevel);

      /**
       * When the current block is a child of a toggle, the new block inserted above
       * should also be a child of the same parent.
       */
      if (currentBlock.parentId !== null) {
        this.Blok.BlockManager.setBlockParent(newBlock, currentBlock.parentId);
      }

      return currentBlock;
    }

    // Case 2: Caret at end - insert block below
    if (currentBlock.currentInput && isCaretAtEndOfInput(currentBlock.currentInput)) {
      /**
       * When the current block is an empty last child of a toggle, pressing Enter
       * should exit the toggle — promote the block to be a sibling after the toggle,
       * similar to how pressing Enter on an empty list item exits the list.
       */
      const promotedBlock = this.promoteLastEmptyToggleChild(currentBlock);

      if (promotedBlock !== null) {
        return promotedBlock;
      }

      /**
       * When the current block is an open toggle (heading or list item),
       * the new block should become a child of the toggle rather than a sibling.
       * Detect via the data-blok-toggle-open DOM attribute set by toggle tools.
       *
       * forceTopLevel is safe to pass only when the current block is top-level
       * AND is not an open toggle (which intentionally nests the new block as its child).
       */
      const toggleWrapper = currentBlock.holder.querySelector('[data-blok-toggle-open]');
      const isToggleOpen = toggleWrapper?.getAttribute('data-blok-toggle-open') === 'true';
      const forceTopLevelCase2 = isCurrentTopLevel && !isToggleOpen;

      const newBlock = this.Blok.BlockManager.insertDefaultBlockAtIndex(this.Blok.BlockManager.currentBlockIndex + 1, false, false, forceTopLevelCase2);

      if (isToggleOpen) {
        this.Blok.BlockManager.setBlockParent(newBlock, currentBlock.id);
      } else if (currentBlock.parentId !== null && newBlock.parentId !== currentBlock.parentId) {
        /**
         * A nested block's new sibling keeps the same parent — Notion creates the
         * new line at the same nesting level, not at root.
         */
        this.Blok.BlockManager.setBlockParent(newBlock, currentBlock.parentId);
      }

      return newBlock;
    }

    // Case 3: Caret in middle - split block
    return this.Blok.BlockManager.split();
  }

  /**
   * Handle backspace keydown on Block
   * @param event - keydown event
   */
  public handleBackspace(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Blok;
    const { currentBlock, previousBlock } = BlockManager;

    if (currentBlock === undefined) {
      return;
    }

    /**
     * If some fragment is selected, leave native behaviour
     */
    if (!SelectionUtils.isCollapsed) {
      return;
    }

    /**
     * If caret is not at the start, leave native behaviour
     */
    if (!currentBlock.currentInput || !isCaretAtStartOfInput(currentBlock.currentInput)) {
      return;
    }

    /**
     * All the cases below have custom behaviour, so we don't need a native one
     */
    event.preventDefault();

    this.closeToolbarIfNotInTableCell();

    const isFirstInputFocused = currentBlock.currentInput === currentBlock.firstInput;

    /**
     * For example, caret at the start of the Quote second input (caption) — just navigate previous input
     */
    if (!isFirstInputFocused) {
      Caret.navigatePrevious();

      return;
    }

    /**
     * When the caret is at the start of a toggle child block, keep navigation
     * within the toggle rather than promoting (un-nesting) the block to root level.
     *
     * If there is no previous sibling in the same parent (i.e. this is the first
     * or only child):
     *   - If the block is empty and a next sibling exists in the same parent,
     *     remove it and focus the next sibling (acts like deleting an empty line).
     *   - Otherwise do nothing — the block must stay inside the toggle.
     * If a previous sibling exists in the same parent, fall through to the
     * normal merge/remove logic below so the interaction stays within the toggle.
     *
     * Skip this guard for table cell blocks — they use a separate mechanism.
     */
    const hasNoPreviousSiblingInParent = previousBlock === null ||
      previousBlock.parentId !== currentBlock.parentId;

    if (currentBlock.parentId != null && !this.isCurrentBlockInsideTableCell && hasNoPreviousSiblingInParent) {
      /**
       * Notion parity — "remove the indent with Backspace". When the block is
       * nested under a PLAIN structural parent (a paragraph/header indented under
       * another block via Tab) and the block immediately above is that parent,
       * Backspace at the start removes ONE indent level: the block outdents to a
       * sibling of its former parent (adopting its following siblings, like
       * Shift+Tab) while keeping its content — instead of doing nothing or merging
       * into the parent. Repeated Backspace steps it out until it reaches root,
       * where the normal merge/remove logic below takes over.
       *
       * Container parents (toggle, column, callout) are excluded by
       * shouldOutdentNestedBlock and keep their own empty-child behaviour below.
       */
      if (this.shouldOutdentNestedBlock(currentBlock)) {
        this.outdentNestedBlockOnBackspace(currentBlock);

        return;
      }

      /**
       * Notion parity — a NON-EMPTY first/only child of a toggle outdents OUT of
       * the toggle to become a following sibling at the toggle's level, preserving
       * its text. This mirrors the plain-parent "Backspace removes the indent"
       * behaviour above; it is NOT a cross-container merge (the previous toggle's
       * content is untouched). Only toggle containers (the toggle tool and toggle
       * headings, both detected via the `data-blok-toggle-open` marker) take this
       * path — column/callout keep their own empty-child handling below. Empty
       * children still fall through to remove-and-focus-next.
       */
      if (!currentBlock.isEmpty && this.hasToggleParent(currentBlock)) {
        this.outdentNestedBlockOnBackspace(currentBlock);

        return;
      }

      // A column's sole empty child collapses the column itself; otherwise
      // fall back to the toggle-child behaviour (remove + focus next sibling).
      if (!this.removeSoleEmptyColumnChild(currentBlock)) {
        this.removeEmptyToggleChildAndFocusNext(currentBlock);
      }

      return;
    }
    // Previous sibling exists in the same parent — fall through to merge/remove logic

    /**
     * Don't merge across table cell boundaries.
     * When the caret is at the start of the FIRST block in a table cell, Backspace
     * must be a no-op rather than merging the previous cell's last block into the
     * current cell. Merges within the same cell (e.g. the user hit Enter to split a
     * paragraph and now wants to undo it) must still work.
     */
    if (this.isCurrentBlockInsideTableCell && !this.areBlocksInSameTableCell(currentBlock, previousBlock)) {
      return;
    }

    /**
     * Notion-style "reset block type to text first" cascade.
     *
     * Pressing Backspace at the start of a styled single-line text block converts
     * it to a plain paragraph — preserving its text and inline formatting —
     * instead of merging into the previous block or deleting an empty block. A
     * subsequent Backspace then runs the normal merge/remove logic on the
     * now-paragraph block.
     *
     * This central handler covers the styled blocks whose own tools do NOT already
     * reset to text on Backspace: headings and quotes. The list, callout and
     * toggle tools self-convert to a paragraph in their own keydown handlers
     * (which preventDefault), so they never reach here.
     *
     * Toggle headings are excluded: their own element-level keydown handler resets
     * the toggle state first (and preventDefault()s, so this central handler does
     * not run for the empty case). They are detected via the toggle-open marker the
     * header tool renders on its holder.
     */
    const isToggleHeading = currentBlock.holder.querySelector('[data-blok-toggle-open]') !== null;
    const resetsToTextOnBackspace = currentBlock.name === HEADER_TOOL_NAME || currentBlock.name === QUOTE_TOOL_NAME;

    if (resetsToTextOnBackspace && !isToggleHeading) {
      const defaultToolName = this.Blok.Tools.defaultTool.name;
      const text = currentBlock.currentInput.innerHTML;
      const newBlock = BlockManager.replace(currentBlock, defaultToolName, { text });

      Caret.setToBlock(newBlock, Caret.positions.START);

      return;
    }

    /**
     * Backspace at the start of the first Block should do nothing
     */
    if (previousBlock === null) {
      return;
    }

    /**
     * If prev Block is empty, it should be removed just like a character.
     *
     * Exception (Notion parity): when the empty previous block is a STYLED block
     * (heading/quote/list — anything that isn't the plain default paragraph) and
     * the current block has text, the text is absorbed INTO the previous block
     * and adopts its type — the destination type wins. Only a plain empty
     * paragraph above is deleted like a line break.
     */
    if (previousBlock.isEmpty) {
      if (!currentBlock.isEmpty && !previousBlock.tool.isDefault && areBlocksMergeable(previousBlock, currentBlock)) {
        this.mergeBlocks(previousBlock, currentBlock);

        return;
      }

      void BlockManager.removeBlock(previousBlock);

      return;
    }

    /**
     * If current Block is empty, just remove it and set cursor to the previous Block (like we're removing line break char)
     */
    if (currentBlock.isEmpty) {
      void BlockManager.removeBlock(currentBlock);

      const newCurrentBlock = BlockManager.currentBlock;

      newCurrentBlock && Caret.setToBlock(newCurrentBlock, Caret.positions.END);

      return;
    }

    const bothBlocksMergeable = areBlocksMergeable(previousBlock, currentBlock);

    /**
     * If Blocks could be merged, do it.
     *
     * Otherwise the previous block cannot absorb this one (e.g. an image or other
     * non-mergeable block). Notion SELECTS that previous block so a second
     * Backspace deletes it, rather than silently parking the caret at its end.
     */
    if (bothBlocksMergeable) {
      this.mergeBlocks(previousBlock, currentBlock);
    } else {
      this.Blok.BlockSelection.selectBlock(previousBlock);
    }
  }

  /**
   * Handles delete keydown on Block
   * Removes char after the caret.
   * If caret is at the end of the block, merge next block with current
   * @param event - keydown event
   */
  public handleDelete(event: KeyboardEvent): void {
    const { BlockManager, Caret } = this.Blok;
    const { currentBlock, nextBlock } = BlockManager;

    if (currentBlock === undefined) {
      return;
    }

    /**
     * If some fragment is selected, leave native behaviour
     */
    if (!SelectionUtils.isCollapsed) {
      return;
    }

    /**
     * If caret is not at the end, leave native behaviour
     */
    if (!currentBlock.currentInput || !isCaretAtEndOfInput(currentBlock.currentInput)) {
      return;
    }

    /**
     * All the cases below have custom behaviour, so we don't need a native one
     */
    event.preventDefault();

    this.closeToolbarIfNotInTableCell();

    const isLastInputFocused = currentBlock.currentInput === currentBlock.lastInput;

    /**
     * For example, caret at the end of the Quote first input (quote text) — just navigate next input (caption)
     */
    if (!isLastInputFocused) {
      Caret.navigateNext();

      return;
    }

    /**
     * Delete at the end of the last Block should do nothing
     */
    if (nextBlock === null) {
      return;
    }

    /**
     * Don't cross parent block boundaries (e.g., don't operate on blocks outside a toggle).
     * When the next block is in a different parent context, treat it as if there's no next block.
     */
    if (nextBlock.parentId !== currentBlock.parentId) {
      return;
    }

    /**
     * Don't merge across table cell boundaries.
     * When the caret is at the end of the LAST block in a table cell, Delete must
     * be a no-op rather than pulling the next cell's first block into the current
     * cell. Merges within the same cell must still work.
     */
    if (this.isCurrentBlockInsideTableCell && !this.areBlocksInSameTableCell(currentBlock, nextBlock)) {
      return;
    }

    /**
     * If next Block is empty, it should be removed just like a character
     */
    if (nextBlock.isEmpty) {
      void BlockManager.removeBlock(nextBlock);

      return;
    }

    /**
     * Notion parity — the UPPER block's type always wins on a forward-Delete
     * merge, symmetric with Backspace (which already demotes a heading into a
     * preceding paragraph). When the current (upper) block is EMPTY and the next
     * block has mergeable text, the next block's text is pulled UP into the current
     * block, adopting the current block's type. This holds even when the empty
     * upper block is the plain default paragraph (the next styled block is demoted
     * to text) — previously default paragraphs fell through to line-break removal,
     * which let the LOWER block's type win (the m2 divergence).
     *
     * Restricted to TOP-LEVEL blocks: an empty CONTAINER child (toggle/callout/
     * column row) shares its parentId with the next sibling, so this branch would
     * otherwise absorb the sibling's text and delete it. Container children must
     * fall through to the container-aware empty-block handling below (remove self
     * when a previous sibling exists, no-op for a lone first child).
     */
    if (currentBlock.parentId === null && currentBlock.isEmpty && areBlocksMergeable(currentBlock, nextBlock)) {
      // The empty upper block absorbs the next block's text, so the caret belongs
      // at the START of the merged content (the empty input the pre-merge focus()
      // anchored to is replaced when the merge re-renders — re-anchor after it).
      this.mergeBlocks(currentBlock, nextBlock, true);

      return;
    }

    /**
     * If current Block is empty, just remove it and set cursor to the next Block (like we're removing line break char)
     */
    if (currentBlock.isEmpty) {
      /**
       * If the current block is inside a parent (e.g., toggle), keep navigation within that parent.
       * When there is no previous sibling in the same parent, do nothing to prevent the cursor
       * from exiting the toggle after the flat-array index is decremented past the parent block.
       */
      const prevBlock = BlockManager.previousBlock;

      const hasNoPrevSiblingInParent = prevBlock === null || prevBlock.parentId !== currentBlock.parentId;

      if (currentBlock.parentId !== null && hasNoPrevSiblingInParent) {
        // A column's sole empty child collapses the column itself rather than
        // being a no-op like a toggle child.
        const collapsed = this.removeSoleEmptyColumnChild(currentBlock);

        collapsed && this.closeToolbarIfNotInTableCell();

        return;
      }

      void BlockManager.removeBlock(currentBlock);

      /**
       * After removing current block, the next block (if any) should become current.
       * Use Caret to position cursor at the start of the next block.
       * Then close toolbar to prevent it from staying open on the removed block.
       */
      const newCurrentBlock = BlockManager.currentBlock;

      newCurrentBlock && Caret.setToBlock(newCurrentBlock, Caret.positions.START);
      this.closeToolbarIfNotInTableCell();

      return;
    }

    const bothBlocksMergeable = areBlocksMergeable(currentBlock, nextBlock);

    /**
     * If Blocks could be merged, do it
     * Otherwise, just navigate to the next block
     */
    if (bothBlocksMergeable) {
      this.mergeBlocks(currentBlock, nextBlock);
    } else {
      Caret.setToBlock(nextBlock, Caret.positions.START);
    }
  }

  /**
   * Merge passed Blocks
   * @param targetBlock - to which Block we want to merge
   * @param blockToMerge - what Block we want to merge
   */
  private mergeBlocks(targetBlock: Block, blockToMerge: Block, restoreCaretToStart = false): void {
    const { BlockManager, Caret } = this.Blok;

    if (targetBlock.lastInput === undefined) {
      return;
    }

    focus(targetBlock.lastInput, false);

    BlockManager
      .mergeBlocks(targetBlock, blockToMerge)
      .then(() => {
        // For a merge INTO an empty target (forward-Delete "upper wins"), the
        // pre-merge focus() anchored the caret on the empty input that the merge
        // then replaced, so re-anchor it on the merged block's fresh DOM.
        if (restoreCaretToStart) {
          Caret.setToBlock(targetBlock, Caret.positions.START);
        }

        this.closeToolbarIfNotInTableCell();
      })
      .catch(() => {
        // Error handling for mergeBlocks
      });
  }

  /**
   * Handle right and down keyboard keys
   * @param event - keyboard event
   */
  public handleArrowRightAndDown(event: KeyboardEvent): void {
    const keyCode = keyCodeFromEvent(event);

    if (keyCode === null) {
      return;
    }

    /**
     * Skip handling if this is a block movement shortcut (Cmd/Ctrl+Shift+Down)
     * Let the shortcut system handle it instead
     */
    if (isBlockMovementShortcut(event, 'down')) {
      return;
    }

    const isFlipperCombination = Flipper.usedKeys.includes(keyCode) &&
      (!event.shiftKey || keyCode === keyCodes.TAB);

    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by DOWN and disallow by RIGHT
     */
    if (this.Blok.UI.someToolbarOpened && isFlipperCombination) {
      return;
    }

    /**
     * Close Toolbar when user moves cursor, but keep toolbars open if the user
     * is extending selection with the Shift key so inline interactions remain available.
     * Skip closing when inside a table cell — the toolbar belongs to the parent
     * table block and the hover controller won't re-emit BlockHovered for it.
     */
    if (!event.shiftKey && !this.isCurrentBlockInsideTableCell) {
      this.Blok.InlineToolbar.close();
    }

    const selection = SelectionUtils.get();

    if (selection?.anchorNode && !this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(selection.anchorNode);
    }

    const { currentBlock } = this.Blok.BlockManager;
    const eventTarget = event.target as HTMLElement | null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackInputCandidates: Array<HTMLElement | undefined | null> = [
      currentBlock?.inputs.find((input) => eventTarget !== null && input.contains(eventTarget)),
      currentBlock?.inputs.find((input) => activeElement !== null && input.contains(activeElement)),
      eventTarget?.closest(EDITABLE_INPUT_SELECTOR),
      activeElement?.closest(EDITABLE_INPUT_SELECTOR),
    ];
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement
    );
    const caretAtEnd = caretInput !== undefined ? isCaretAtEndOfInput(caretInput) : undefined;
    const shouldEnableCBS =
      (caretAtEnd || this.Blok.BlockSelection.anyBlockSelected) && !this.shouldDeferSelectionToTableCell;

    const isShiftDownKey = event.shiftKey && keyCode === keyCodes.DOWN;

    if (isShiftDownKey && shouldEnableCBS) {
      this.Blok.CrossBlockSelection.toggleBlockSelectedState();

      return;
    }

    /**
     * Shift+ArrowRight at the END of a block extends the selection into the next
     * block (cross-block selection) — the same path as Shift+ArrowDown — instead
     * of collapsing the caret into the adjacent block. Only fires at the boundary
     * (caret at end, or a block selection already in progress); elsewhere the
     * native within-block shift-extend is left intact.
     */
    const isShiftRightKey = event.shiftKey && keyCode === keyCodes.RIGHT && !this.isRtl;

    if (isShiftRightKey && shouldEnableCBS) {
      this.Blok.CrossBlockSelection.toggleBlockSelectedState();

      return;
    }

    if (isShiftDownKey) {
      void this.Blok.InlineToolbar.tryToShow();
    }

    const isPlainRightKey = keyCode === keyCodes.RIGHT && !event.shiftKey && !this.isRtl;

    const nbpsTarget = isPlainRightKey && caretInput instanceof HTMLElement
      ? findNbspAfterEmptyInline(caretInput)
      : null;

    if (nbpsTarget !== null) {
      SelectionUtils.setCursor(nbpsTarget.node as unknown as HTMLElement, nbpsTarget.offset);
      event.preventDefault();

      return;
    }

    /**
     * Determine navigation type based on key pressed:
     * - Arrow Down: use vertical navigation (Notion-style line-by-line)
     * - Arrow Right: use horizontal navigation (character-by-character)
     *
     * Plain (no Cmd/Ctrl/Alt) vertical navigation only — symmetric with isRightKey
     * below. A modifier+ArrowDown is a native gesture (Cmd = doc/line end, Ctrl/Alt =
     * paragraph/word) and must fall through to the browser; without this guard Blok
     * half-intercepts it, crossing blocks at a boundary or leaving the caret stuck
     * mid-block in a wrapped paragraph.
     */
    const isDownKey =
      keyCode === keyCodes.DOWN &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;
    /**
     * Horizontal navigation flag for ArrowRight. Only plain ArrowRight qualifies;
     * Ctrl/Alt (word nav), Shift (handled above as cross-block selection) and Cmd
     * (line-end) do not.
     *
     * Cmd+ArrowRight is the macOS line-end gesture and must stay fully native
     * (symmetric with isDownKey above, which also excludes metaKey): within a
     * multi-line block it moves to the visual line end, and at the block's absolute
     * end the native gesture keeps the caret inside the block — it never crosses into
     * the next block (Notion parity: Cmd+Right is a within-line move / boundary
     * no-op, not a cross-block arrow).
     */
    const isRightKey =
      keyCode === keyCodes.RIGHT &&
      !this.isRtl &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;

    const isNavigated = (() => {
      if (isDownKey) {
        /**
         * Arrow Down: Notion-style vertical navigation
         * Only navigate to next block when caret is at the last line.
         * Pass allowBlockCreation=false so arrowing past the last block never
         * spawns a trailing paragraph (only Enter creates blocks, like Notion).
         */
        return this.Blok.Caret.navigateVerticalNext(false);
      }

      if (isRightKey) {
        /**
         * Arrow Right: horizontal navigation
         * Navigate to next block when caret is at the end of input. Block creation
         * is disabled so the caret never spawns a trailing paragraph on Arrow Right.
         */
        return this.Blok.Caret.navigateNext(false, false);
      }

      return false;
    })();

    if (isNavigated) {
      /**
       * Default behaviour moves cursor by 1 character, we need to prevent it
       */
      event.preventDefault();

      /**
       * Reposition the toolbar at the new block, but keep the block-action gutter
       * (plus button + settings toggler) hidden — caret navigation should not pop
       * the handles, matching Notion where they appear on hover only. Positioning
       * still happens so a later hover/click lands at the right place.
       */
      this.Blok.Toolbar.moveAndOpen(this.Blok.BlockManager.currentBlock);
      this.Blok.Toolbar.hideBlockActions();

      return;
    }

    /**
     * After caret is set, update Block input index
     */
    delay(() => {
      /** Check currentBlock for case when user moves selection out of Blok */
      if (this.Blok.BlockManager.currentBlock) {
        this.Blok.BlockManager.currentBlock.updateCurrentInput();
      }

    }, 20)();

    /**
     * Clear blocks selection by arrows
     */
    this.Blok.BlockSelection.clearSelection(event);
  }

  /**
   * Handle left and up keyboard keys
   * @param event - keyboard event
   */
  public handleArrowLeftAndUp(event: KeyboardEvent): void {
    /**
     * Arrows might be handled on toolbars by flipper
     * Check for Flipper.usedKeys to allow navigate by UP and disallow by LEFT
     */
    const toolbarOpened = this.Blok.UI.someToolbarOpened;

    const keyCode = keyCodeFromEvent(event);

    if (keyCode === null) {
      return;
    }

    /**
     * Skip handling if this is a block movement shortcut (Cmd/Ctrl+Shift+Up)
     * Let the shortcut system handle it instead
     */
    if (isBlockMovementShortcut(event, 'up')) {
      return;
    }

    if (toolbarOpened && Flipper.usedKeys.includes(keyCode) && (!event.shiftKey || keyCode === keyCodes.TAB)) {
      return;
    }

    if (toolbarOpened && !this.isCurrentBlockInsideTableCell) {
      this.Blok.UI.closeAllToolbars();
    }

    /**
     * Close Toolbar when user moves cursor, but preserve it for Shift-based selection changes.
     * Skip closing when inside a table cell — the toolbar belongs to the parent
     * table block and the hover controller won't re-emit BlockHovered for it.
     */
    if (!event.shiftKey && !this.isCurrentBlockInsideTableCell) {
      this.Blok.InlineToolbar.close();
    }

    const selection = window.getSelection();

    if (selection?.anchorNode && !this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(selection.anchorNode);
    }

    const { currentBlock } = this.Blok.BlockManager;
    const eventTarget = event.target as HTMLElement | null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackInputCandidates: Array<HTMLElement | undefined | null> = [
      currentBlock?.inputs.find((input) => eventTarget !== null && input.contains(eventTarget)),
      currentBlock?.inputs.find((input) => activeElement !== null && input.contains(activeElement)),
      eventTarget?.closest(EDITABLE_INPUT_SELECTOR),
      activeElement?.closest(EDITABLE_INPUT_SELECTOR),
    ];
    const caretInput = currentBlock?.currentInput ?? fallbackInputCandidates.find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement
    );
    const caretAtStart = caretInput !== undefined ? isCaretAtStartOfInput(caretInput) : undefined;
    const shouldEnableCBS =
      (caretAtStart || this.Blok.BlockSelection.anyBlockSelected) && !this.shouldDeferSelectionToTableCell;

    const isShiftUpKey = event.shiftKey && keyCode === keyCodes.UP;

    if (isShiftUpKey && shouldEnableCBS) {
      this.Blok.CrossBlockSelection.toggleBlockSelectedState(false);

      return;
    }

    /**
     * Shift+ArrowLeft at the START of a block extends the selection into the
     * previous block (cross-block selection) — the same path as Shift+ArrowUp —
     * instead of collapsing the caret into the adjacent block. Only fires at the
     * boundary (caret at start, or a block selection already in progress);
     * elsewhere the native within-block shift-extend is left intact.
     */
    const isShiftLeftKey = event.shiftKey && keyCode === keyCodes.LEFT && !this.isRtl;

    if (isShiftLeftKey && shouldEnableCBS) {
      this.Blok.CrossBlockSelection.toggleBlockSelectedState(false);

      return;
    }

    if (isShiftUpKey) {
      void this.Blok.InlineToolbar.tryToShow();
    }

    /**
     * Determine navigation type based on key pressed:
     * - Arrow Up: use vertical navigation (Notion-style line-by-line)
     * - Arrow Left: use horizontal navigation (character-by-character)
     *
     * Plain (no Cmd/Ctrl/Alt) vertical navigation only — symmetric with isLeftKey
     * below. A modifier+ArrowUp is a native gesture (Cmd = doc/line start, Ctrl/Alt =
     * paragraph/word) and must fall through to the browser; without this guard Blok
     * half-intercepts it, crossing blocks at a boundary or leaving the caret stuck
     * mid-block in a wrapped paragraph.
     */
    const isUpKey =
      keyCode === keyCodes.UP &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;
    /**
     * Horizontal navigation flag for ArrowLeft. Only plain ArrowLeft qualifies;
     * Ctrl/Alt (word nav), Shift (handled above as cross-block selection) and Cmd
     * (line-start) do not.
     *
     * Cmd+ArrowLeft is the macOS line-start gesture and must stay fully native
     * (symmetric with isUpKey above, which also excludes metaKey): within a
     * multi-line block it moves to the visual line start, and at the block's absolute
     * start the native gesture keeps the caret inside the block — it never crosses
     * into the previous block (Notion parity: Cmd+Left is a within-line move /
     * boundary no-op, not a cross-block arrow).
     */
    const isLeftKey =
      keyCode === keyCodes.LEFT &&
      !this.isRtl &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;

    const isNavigated = (() => {
      if (isUpKey) {
        /**
         * Arrow Up: Notion-style vertical navigation
         * Only navigate to previous block when caret is at the first line
         */
        return this.Blok.Caret.navigateVerticalPrevious();
      }

      if (isLeftKey) {
        /**
         * Arrow Left: horizontal navigation
         * Navigate to previous block when caret is at the start of input
         */
        return this.Blok.Caret.navigatePrevious();
      }

      return false;
    })();

    if (isNavigated) {
      /**
       * Default behaviour moves cursor by 1 character, we need to prevent it
       */
      event.preventDefault();

      /**
       * Reposition the toolbar at the new block, but keep the block-action gutter
       * (plus button + settings toggler) hidden — caret navigation should not pop
       * the handles, matching Notion where they appear on hover only. Positioning
       * still happens so a later hover/click lands at the right place.
       */
      this.Blok.Toolbar.moveAndOpen(this.Blok.BlockManager.currentBlock);
      this.Blok.Toolbar.hideBlockActions();

      return;
    }

    /**
     * After caret is set, update Block input index
     */
    delay(() => {
      /** Check currentBlock for case when user ends selection out of Blok and then press arrow-key */
      if (this.Blok.BlockManager.currentBlock) {
        this.Blok.BlockManager.currentBlock.updateCurrentInput();
      }

    }, 20)();

    /**
     * Clear blocks selection by arrows
     */
    this.Blok.BlockSelection.clearSelection(event);
  }

  /**
   * When Backspace is pressed at the start of an empty toggle child block that has no
   * previous sibling in the same parent, remove the block and move the caret to the
   * next sibling (if one exists in the same parent).
   */
  private removeEmptyToggleChildAndFocusNext(block: Block): void {
    if (!block.isEmpty) {
      return;
    }

    const { BlockManager, Caret } = this.Blok;
    const nextBlock = BlockManager.nextBlock;

    if (nextBlock !== null && nextBlock.parentId === block.parentId) {
      void BlockManager.removeBlock(block);
      Caret.setToBlock(nextBlock, Caret.positions.START);
    }
  }

  /**
   * When `block` is the SOLE child of a `column` and is empty, remove it so the
   * now-empty column is dropped: a column is pure layout and must not linger
   * empty. BlockManager.removeBlock cascades — deleting the last child removes
   * the column, which unwraps the column_list if it collapses to one column.
   *
   * Returns true when it handled the removal. A column with OTHER children is
   * left to the generic empty-child path so the column survives, so this only
   * fires for the sole-child case (returns false otherwise — including for
   * non-column parents such as toggles/callouts).
   */
  private removeSoleEmptyColumnChild(block: Block): boolean {
    if (!block.isEmpty || block.parentId === null) {
      return false;
    }

    const parentBlock = this.Blok.BlockManager.getBlockById(block.parentId);

    if (parentBlock === undefined || parentBlock.name !== 'column' || parentBlock.contentIds.length > 1) {
      return false;
    }

    const { BlockManager, Caret } = this.Blok;

    void BlockManager.removeBlock(block);

    const newCurrentBlock = BlockManager.currentBlock;

    if (newCurrentBlock) {
      Caret.setToBlock(newCurrentBlock, Caret.positions.END);
    }

    return true;
  }

  /**
   * Backspace "remove one indent level": outdent a block nested under a plain
   * structural parent by one level, preserving its content and keeping the caret
   * at its start. Mirrors the Tab handler — the reparent runs inside a single
   * `transactMoves` group so one Cmd+Z reverses it, and the toolbar is
   * repositioned against the new (shallower) geometry.
   * @param block - the current block being outdented (BlockManager.currentBlock)
   */
  private outdentNestedBlockOnBackspace(block: Block): void {
    const { YjsManager, Caret, Toolbar } = this.Blok;

    const reparent = (): void => {
      this.outdentCurrentBlock();
    };

    if (typeof YjsManager.transactMoves === 'function') {
      YjsManager.transactMoves(reparent);
    } else {
      reparent();
    }

    Caret.setToBlock(block, Caret.positions.START);
    Toolbar.moveAndOpen(block);
  }

}
