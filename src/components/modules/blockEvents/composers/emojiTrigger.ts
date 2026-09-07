import type { Block } from '../../../block';
import { isMobileScreen } from '../../../utils';
import { getCaretOffset } from '../../../utils/caret';
import type { ProcessedEmoji } from '../../../utils/emoji/emoji-data';
import { loadEmojiData } from '../../../utils/emoji/emoji-data';
import { searchEmojisRanked } from '../../../utils/emoji/emoji-search-ranked';
import type { EmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { resolveEmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import type { Popover } from '../../../utils/popover';
import { PopoverDesktop, PopoverMobile } from '../../../utils/popover';
import { isTextLikeBlock } from '../utils/text-like-block';

import { prefetchEmojiPickerData } from '../../../../tools/callout/emoji-picker';

import type { PopoverItemParams, PopoverPositionUpdate } from '@/types';
import { PopoverEvent } from '@/types/utils/popover/popover-event';

import { BlockEventComposer } from './__base';

/**
 * Stable id applied to the popover's listbox container, mirroring the
 * Toolbox's TOOLBOX_POPOVER_ID (only one emoji menu is ever open at a time).
 */
const EMOJI_MENU_LISTBOX_ID = 'blok-emoji-menu';

/** Keys the open menu claims so they don't fall through to block navigation. */
const CLAIMED_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Tab']);

function isInsertOrDeleteText(inputType: string): boolean {
  return inputType.startsWith('insert') || inputType.startsWith('delete');
}

/**
 * Locate the text node and local offset `targetOffset` (measured from the
 * start of `container`'s plain text) falls in. Mirrors the technique
 * MarkdownShortcuts uses to resolve a plain-text offset back into the DOM.
 */
function resolveTextPosition(container: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  const walk = (consumed: number): { node: Text; offset: number } | null => {
    const node = walker.nextNode() as Text | null;

    if (node === null) {
      return null;
    }

    if (consumed + node.length >= targetOffset) {
      return { node, offset: targetOffset - consumed };
    }

    return walk(consumed + node.length);
  };

  return walk(0);
}

/** Bounding rect of the single character at `offset` in `container`'s plain text. */
function rectAtOffset(container: HTMLElement, offset: number): DOMRect | undefined {
  const position = resolveTextPosition(container, offset);

  if (position === null) {
    return undefined;
  }

  const range = document.createRange();
  const end = Math.min(position.offset + 1, position.node.length);

  range.setStart(position.node, position.offset);
  range.setEnd(position.node, end);

  return range.getBoundingClientRect();
}

/**
 * Maps ranked emoji results to popover items. Selecting an item only closes
 * the menu for now — inserting the emoji at the trigger span is Task 7.
 */
function buildMenuItems(emojis: ProcessedEmoji[], onSelect: () => void): PopoverItemParams[] {
  return emojis.map(emoji => ({
    title: emoji.name,
    icon: emoji.native,
    name: emoji.id,
    onActivate: onSelect,
  }));
}

/**
 * Detects a ":query" span at the caret in a text-like block and opens a
 * ranked emoji menu, closing it when the span disappears, the query matches
 * nothing, or the user cancels. Inserting the chosen emoji (Task 7) and the
 * closing-colon shortcut (Task 8) are built on top of this.
 */
export class EmojiTrigger extends BlockEventComposer {
  public opened = false;

  private popover: Popover | null = null;
  private anchorRect: DOMRect | undefined;
  private comboboxHost: HTMLElement | null = null;
  private previousAriaLabel: string | null = null;
  private hasPrefetched = false;

  /**
   * Handle an input event: resolve the ":query" span at the caret and open,
   * update or close the menu accordingly.
   * @param event - input event
   * @returns true when the menu is open after handling this event
   */
  public async handleInput(event: InputEvent): Promise<boolean> {
    if (event.isComposing || !isInsertOrDeleteText(event.inputType)) {
      return false;
    }

    const block = this.Blok.BlockManager.currentBlock;

    if (block === undefined || !isTextLikeBlock(block.tool)) {
      return false;
    }

    const input = block.currentInput;

    if (input === undefined) {
      return false;
    }

    const text = input.textContent ?? '';
    const caretOffset = getCaretOffset(input);
    const span = resolveEmojiTriggerSpan(text, caretOffset);

    if (span === null) {
      this.close();

      return false;
    }

    // Warm the dataset once per composer lifetime — repeated warm-up calls on
    // every keystroke would be wasted work once the real load is in flight.
    if (!this.hasPrefetched) {
      this.hasPrefetched = true;
      prefetchEmojiPickerData(this.Blok.I18n.getLocale());
    }

    const emojis = await loadEmojiData();
    const results = searchEmojisRanked(emojis, span.query);

    if (results.length === 0) {
      this.close();

      return false;
    }

    this.renderMenu(results, block, input, span);

    return true;
  }

  /**
   * Handle a keydown while the menu may be open. Escape closes it; the other
   * claimed keys are only reported as handled so BlockEvents does not also
   * run block splitting, indenting or caret navigation for them — the actual
   * highlight movement is the popover's own Flipper, wired via
   * `handleContentEditableNavigation`.
   * @param event - keydown event
   * @returns true when this event was claimed by the open menu
   */
  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.opened) {
      return false;
    }

    if (event.key === 'Escape') {
      this.close();

      return true;
    }

    if (!CLAIMED_KEYS.has(event.key)) {
      return false;
    }

    event.preventDefault();

    return true;
  }

  /**
   * Close the menu, if open, and restore the block's contentEditable to a
   * plain editor element. Safe to call when the menu is already closed.
   */
  public close(): void {
    if (!this.opened) {
      return;
    }

    if (this.popover !== null) {
      this.popover.off(PopoverEvent.Closed, this.handlePopoverClosed);
      this.popover.hide();
      this.popover.destroy();
      this.popover = null;
    }

    this.removeComboboxRoles();
    this.anchorRect = undefined;
    this.opened = false;
  }

  /**
   * Reacts to the popover closing itself (e.g. an outside click). Detached
   * from the listener before our own hide()/destroy() calls in close() and
   * renderMenu(), so this only fires for a close we did not initiate.
   */
  private readonly handlePopoverClosed = (): void => {
    this.close();
  };

  /**
   * Build (or rebuild) the popover with the current ranked results.
   *
   * The anchor rect is computed once, from the ":" character's position at
   * the moment the menu first opens, and reused on every later keystroke —
   * recomputing it as the query grows would walk the menu across the screen
   * as characters are typed.
   * @param results - ranked emoji matches, already known to be non-empty
   * @param block - the block being typed into
   * @param input - the block's current contentEditable
   * @param span - the resolved ":query" span
   */
  private renderMenu(results: ProcessedEmoji[], block: Block, input: HTMLElement, span: EmojiTriggerSpan): void {
    if (!this.opened) {
      this.anchorRect = rectAtOffset(input, span.start) ?? input.getBoundingClientRect();
    }

    const anchorRect = this.anchorRect;

    if (anchorRect === undefined) {
      return;
    }

    if (this.popover !== null) {
      this.popover.off(PopoverEvent.Closed, this.handlePopoverClosed);
      this.popover.hide();
      this.popover.destroy();
      this.popover = null;
    }

    // Track the class actually picked (not `instanceof`, which the desktop
    // popover mock in tests does not satisfy) to decide whether updatePosition
    // — a desktop-only method — is safe to call.
    const isDesktop = !isMobileScreen();
    const PopoverClass = isDesktop ? PopoverDesktop : PopoverMobile;

    const popover = new PopoverClass({
      trigger: input,
      items: buildMenuItems(results, () => this.close()),
      // ARIA listbox (options), not a menu — same combobox surface the
      // Toolbox's inline slash search uses.
      listbox: true,
      listboxId: EMOJI_MENU_LISTBOX_ID,
      handleContentEditableNavigation: true,
      // The contentEditable keeps DOM focus throughout — the user is still
      // typing the query — so the first item must not steal it.
      autoFocusFirstItem: false,
      messages: {
        search: this.Blok.I18n.t('emoji.search'),
        nothingFound: this.Blok.I18n.t('emoji.nothingFound'),
      },
    });

    popover.on(PopoverEvent.Closed, this.handlePopoverClosed);
    popover.getElement().setAttribute('data-blok-testid', 'emoji-menu');

    this.popover = popover;

    if (isDesktop) {
      const positionUpdate: PopoverPositionUpdate = { positionContext: block.holder };

      (popover as PopoverDesktop).updatePosition(anchorRect, positionUpdate);
    }

    popover.show();

    if (!this.opened) {
      this.applyComboboxRoles(input);
      this.opened = true;
    }
  }

  /**
   * Exposes the block's contentEditable as the ARIA combobox that owns the
   * open menu's listbox, mirroring Toolbox#applyComboboxRoles.
   * @param host - the block's contentEditable element
   */
  private applyComboboxRoles(host: HTMLElement): void {
    host.setAttribute('role', 'combobox');
    host.setAttribute('aria-expanded', 'true');
    host.setAttribute('aria-autocomplete', 'list');
    host.setAttribute('aria-haspopup', 'listbox');
    this.previousAriaLabel = host.getAttribute('aria-label');
    host.setAttribute('aria-label', this.Blok.I18n.t('emoji.search'));
    host.setAttribute('aria-controls', EMOJI_MENU_LISTBOX_ID);
    this.comboboxHost = host;
  }

  /** Restores the contentEditable's previous ARIA state, mirroring Toolbox#removeComboboxRoles. */
  private removeComboboxRoles(): void {
    const host = this.comboboxHost;

    if (host === null) {
      return;
    }

    host.removeAttribute('role');
    host.removeAttribute('aria-expanded');
    host.removeAttribute('aria-autocomplete');
    host.removeAttribute('aria-haspopup');

    if (this.previousAriaLabel === null) {
      host.removeAttribute('aria-label');
    } else {
      host.setAttribute('aria-label', this.previousAriaLabel);
    }

    host.removeAttribute('aria-controls');
    this.previousAriaLabel = null;
    this.comboboxHost = null;
  }
}
