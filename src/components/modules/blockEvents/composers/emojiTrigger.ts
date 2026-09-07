import { getCaretOffset } from '../../../utils/caret';
import { loadEmojiData } from '../../../utils/emoji/emoji-data';
import { searchEmojisRanked } from '../../../utils/emoji/emoji-search-ranked';
import type { EmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { resolveEmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { isTextLikeBlock } from '../utils/text-like-block';

import { EmojiPicker, prefetchEmojiPickerData } from '../../../../tools/callout/emoji-picker';

import { BlockEventComposer } from './__base';

/**
 * Stable id applied to the picker element, mirroring the Toolbox's
 * TOOLBOX_POPOVER_ID (only one emoji menu is ever open at a time). Also
 * what the combobox host's aria-controls resolves to.
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
 * Detects a ":query" span at the caret in a text-like block and opens a
 * ranked emoji menu, closing it when the span disappears, the query matches
 * nothing, or the user cancels. Inserting the chosen emoji (Task 7) and the
 * closing-colon shortcut (Task 8) are built on top of this.
 */
export class EmojiTrigger extends BlockEventComposer {
  public opened = false;

  /** Lazily created on first use and reused for the composer's lifetime, like Callout's own picker. */
  private picker: EmojiPicker | null = null;
  private anchorRect: DOMRect | undefined;
  /** Plain-text offset of the ":" that opened the current menu (see renderMenu). */
  private activeSpanStart: number | undefined;
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

    await this.renderMenu(input, span);

    return true;
  }

  /**
   * Handle a keydown while the menu may be open. Escape closes it; the other
   * claimed keys are only reported as handled so BlockEvents does not also
   * run block splitting, indenting or caret navigation for them.
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

    this.picker?.close();

    document.removeEventListener('selectionchange', this.handleSelectionChange);
    this.removeComboboxRoles();
    this.anchorRect = undefined;
    this.activeSpanStart = undefined;
    this.opened = false;
  }

  /**
   * Closes the menu when the caret leaves the ":query" span WITHOUT a text
   * mutation — arrowing or clicking elsewhere in the block. `handleInput`
   * only re-evaluates on an input event, so nothing else catches this: the
   * picker itself has no click-outside detection in inline mode (it does not
   * block the page with a backdrop — see EmojiPicker's `inline` option), and
   * clicking inside the same block never fires an input event either.
   * Registered on open, removed in close().
   */
  private readonly handleSelectionChange = (): void => {
    if (!this.opened) {
      return;
    }

    const input = this.Blok.BlockManager.currentBlock?.currentInput;

    if (input === undefined || !EmojiTrigger.isSelectionInside(input)) {
      this.close();

      return;
    }

    const text = input.textContent ?? '';
    const caretOffset = getCaretOffset(input);
    const span = resolveEmojiTriggerSpan(text, caretOffset);

    if (span === null || span.start !== this.activeSpanStart) {
      this.close();
    }
  };

  /** True when the live selection's anchor sits inside `input`. */
  private static isSelectionInside(input: HTMLElement): boolean {
    const node = window.getSelection()?.anchorNode;

    return node !== null && node !== undefined && input.contains(node);
  }

  /**
   * Open (or update) the picker with the current query.
   *
   * The anchor rect is computed once, from the ":" character's position at
   * the moment the menu first opens for a given span, and reused on every
   * later keystroke within that same span — recomputing it as the query
   * grows would walk the menu across the screen as characters are typed. A
   * `span.start` that differs from the active one means the caret jumped to
   * a different ":" in the same block (e.g. navigated there and typed), so
   * the anchor is recomputed and the picker re-opened for that new span.
   * Picking an emoji only closes the menu for now — inserting it at the
   * trigger span is Task 7.
   * @param input - the block's current contentEditable
   * @param span - the resolved ":query" span
   */
  private async renderMenu(input: HTMLElement, span: EmojiTriggerSpan): Promise<void> {
    const isFreshTrigger = !this.opened || span.start !== this.activeSpanStart;

    if (isFreshTrigger) {
      this.anchorRect = rectAtOffset(input, span.start) ?? input.getBoundingClientRect();
      this.activeSpanStart = span.start;
    }

    const anchorRect = this.anchorRect;

    if (anchorRect === undefined) {
      return;
    }

    const picker = this.ensurePicker();

    if (isFreshTrigger) {
      await picker.open(input, anchorRect);
    }

    // Mirrors the typed query into the picker's own search field on every
    // keystroke — see the plan's "decision already made" on this.
    picker.setQuery(span.query);

    if (!this.opened) {
      this.applyComboboxRoles(input);
      document.addEventListener('selectionchange', this.handleSelectionChange);
      this.opened = true;
    }
  }

  /** Builds the picker once and reuses it, mirroring Callout's own one-picker-per-tool lifecycle. */
  private ensurePicker(): EmojiPicker {
    if (this.picker !== null) {
      return this.picker;
    }

    const picker = new EmojiPicker({
      // Task 7 replaces both with real commit(); for now, picking or
      // removing just closes the menu, same as Task 6's flat list did.
      onSelect: () => this.close(),
      onRemove: () => this.close(),
      i18n: { t: (key: string): string => this.Blok.I18n.t(key) },
      locale: this.Blok.I18n.getLocale(),
      inline: true,
    });

    picker.getElement().setAttribute('data-blok-testid', 'emoji-menu');
    picker.getElement().id = EMOJI_MENU_LISTBOX_ID;
    document.body.appendChild(picker.getElement());
    this.picker = picker;

    return picker;
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
