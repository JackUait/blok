import { getCaretOffset } from '../../../utils/caret';
import type { ProcessedEmoji } from '../../../utils/emoji/emoji-data';
import { loadEmojiData } from '../../../utils/emoji/emoji-data';
import { searchEmojisRanked } from '../../../utils/emoji/emoji-search-ranked';
import type { EmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { resolveEmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { isTextLikeBlock } from '../utils/text-like-block';

import { EmojiPicker, prefetchEmojiPickerData } from '../../../../tools/callout/emoji-picker';

import { BlockEventComposer } from './__base';

/**
 * Prefix for the id applied to the picker element — also what the combobox
 * host's aria-controls resolves to. Unlike the Toolbox's TOOLBOX_POPOVER_ID
 * (a single constant, safe because that popover is built and destroyed per
 * open), each EmojiTrigger keeps one persistent EmojiPicker element resident
 * in the DOM for its whole lifetime (see ensurePicker) — a page with more
 * than one editor would leave two hidden nodes sharing an id. `nextMenuId`
 * makes it unique per instance instead.
 */
const EMOJI_MENU_ID_PREFIX = 'blok-emoji-menu';

const emojiMenuIdState = { count: 0 };

function nextMenuId(): string {
  emojiMenuIdState.count += 1;

  return `${EMOJI_MENU_ID_PREFIX}-${emojiMenuIdState.count}`;
}

/** Keys the open menu claims so they don't fall through to block navigation. */
const CLAIMED_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Tab']);

/**
 * Matches EmojiPicker's grid ("grid-cols-10" in
 * src/tools/callout/emoji-picker/index.ts) — Up/Down step by a row. The
 * caret must stay in the block in inline mode (see EmojiPicker's `inline`
 * option), so this reads the picker's rendered grid from outside rather
 * than the picker driving its own keyboard navigation via focus.
 */
const EMOJI_GRID_COLUMNS = 10;

/** Same visual treatment as the picker's own skin-tone "active" state. */
const EMOJI_HIGHLIGHT_CLASSES = ['bg-neutral-100', 'theme-dark:bg-neutral-800', 'ring-2', 'ring-neutral-300/60', 'theme-dark:ring-neutral-600/60'];

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
  /** Unique per instance — see EMOJI_MENU_ID_PREFIX. */
  private readonly menuId = nextMenuId();
  private anchorRect: DOMRect | undefined;
  /** Plain-text offset of the ":" that opened the current menu (see renderMenu). */
  private activeSpanStart: number | undefined;
  private comboboxHost: HTMLElement | null = null;
  private previousAriaLabel: string | null = null;
  private hasPrefetched = false;
  /** The last ranked results rendered, in the same order as the picker's grid. */
  private currentResults: ProcessedEmoji[] = [];
  /** Index into currentResults the keyboard highlight sits on, or -1 when there is nothing to highlight. */
  private highlightedIndex = -1;

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

    this.currentResults = results;
    await this.renderMenu(input, span);
    // Every keystroke re-ranks the results, so the highlight goes back to
    // the top one — matching what Enter should commit without ever arrowing.
    this.setHighlightedIndex(0);

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

    switch (event.key) {
      case 'ArrowLeft':
        this.setHighlightedIndex(this.highlightedIndex - 1);
        break;
      case 'ArrowRight':
        this.setHighlightedIndex(this.highlightedIndex + 1);
        break;
      case 'ArrowUp':
        this.setHighlightedIndex(this.highlightedIndex - EMOJI_GRID_COLUMNS);
        break;
      case 'ArrowDown':
        this.setHighlightedIndex(this.highlightedIndex + EMOJI_GRID_COLUMNS);
        break;
      case 'Home':
        this.setHighlightedIndex(0);
        break;
      case 'End':
        // Clamped inside setHighlightedIndex to the last result.
        this.setHighlightedIndex(Number.MAX_SAFE_INTEGER);
        break;
      default:
        // Enter/Tab: stay claimed here (preventDefault above); committing
        // the highlighted emoji is a later task.
        break;
    }

    return true;
  }

  /** The emoji the keyboard highlight currently sits on, or null when the menu is closed or holds no results. */
  public getHighlightedEmoji(): ProcessedEmoji | null {
    return this.currentResults[this.highlightedIndex] ?? null;
  }

  /**
   * Moves the highlight to `index` (clamped to the current results) and
   * applies it visually to the matching button in the picker's rendered
   * grid, if one exists there — the DOM write is best-effort so this stays
   * safe to call before the picker has rendered anything.
   * @param index - target index into currentResults; out-of-range clamps
   */
  private setHighlightedIndex(index: number): void {
    if (this.currentResults.length === 0) {
      this.highlightedIndex = -1;

      return;
    }

    const clamped = Math.max(0, Math.min(this.currentResults.length - 1, index));
    const buttons = this.picker !== null
      ? Array.from(this.picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'))
      : [];
    const previous = buttons[this.highlightedIndex];

    if (previous !== undefined) {
      previous.classList.remove(...EMOJI_HIGHLIGHT_CLASSES);
      previous.removeAttribute('aria-selected');
    }

    this.highlightedIndex = clamped;

    const current = buttons[clamped];

    if (current !== undefined) {
      current.classList.add(...EMOJI_HIGHLIGHT_CLASSES);
      current.setAttribute('aria-selected', 'true');
      current.scrollIntoView?.({ block: 'nearest' });
    }
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
    this.currentResults = [];
    this.highlightedIndex = -1;
    this.opened = false;
  }

  /**
   * Tears down the picker entirely: close() only hides it, but it stays
   * resident in `document.body` (see ensurePicker) for the composer's whole
   * lifetime, so the editor's own destroy() must remove it — otherwise a
   * destroyed editor leaves a permanent, hidden, id-bearing orphan node.
   */
  public destroy(): void {
    this.close();
    this.picker?.getElement().remove();
    this.picker = null;
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

    // Clicking the picker's own search field fires selectionchange too —
    // <input> elements move the document Selection's anchor into themselves
    // on click, and that anchor is what isSelectionInside checks. This is
    // the user interacting with the menu, not leaving the ":query" span.
    if (this.isSelectionInsidePicker()) {
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

  /** True when the live selection's anchor sits inside the open picker's own element. */
  private isSelectionInsidePicker(): boolean {
    if (this.picker === null) {
      return false;
    }

    const node = window.getSelection()?.anchorNode;

    return node !== null && node !== undefined && this.picker.getElement().contains(node);
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
    picker.getElement().id = this.menuId;
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
    host.setAttribute('aria-controls', this.menuId);
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
