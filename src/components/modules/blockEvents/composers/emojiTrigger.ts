import { getCaretOffset } from '../../../utils/caret';
import type { ProcessedEmoji } from '../../../utils/emoji/emoji-data';
import { loadEmojiData } from '../../../utils/emoji/emoji-data';
import { isExactShortcodeMatch, searchEmojisRanked } from '../../../utils/emoji/emoji-search-ranked';
import type { EmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { resolveEmojiTriggerSpan } from '../../../utils/emoji/emoji-trigger-span';
import { ScrollLocker } from '../../../utils/scroll-locker';
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
 * localStorage key the skin-tone picker's own reader
 * (`loadSkinTone` in src/tools/callout/emoji-picker/index.ts) uses. Duplicated
 * here rather than imported: that function is not exported, and that file
 * currently carries another session's large unlanded diff, so exporting it
 * is out of scope for this change — see the emoji-skin-tone note in this
 * file's task report.
 */
const SKIN_TONE_STORAGE_KEY = 'blok-emoji-skin-tone';

/** Direct index into an emoji's `skins` array (0 = default, tone-free glyph), not a Fitzpatrick number. */
function loadEmojiSkinTone(): number {
  try {
    const raw = localStorage.getItem(SKIN_TONE_STORAGE_KEY);

    if (raw === null) {
      return 0;
    }

    const parsed = parseInt(raw, 10);

    return parsed >= 0 && parsed <= 5 ? parsed : 0;
  } catch {
    return 0;
  }
}

/** The emoji's character at the user's stored skin tone, falling back to skins[0] when that tone doesn't exist for this emoji (most emoji have only one skin). */
function skinnedNative(emoji: ProcessedEmoji): string {
  const tone = loadEmojiSkinTone();

  return emoji.skins[tone] ?? emoji.skins[0] ?? emoji.native;
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
 * nothing, or the user cancels. Committing the chosen emoji (via Enter/Tab,
 * or the picker's own click) replaces the span in place — see `commit`.
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
  /**
   * The full loaded dataset — NOT the ranked results, which are capped
   * (searchEmojisRanked's default limit) while the picker's own grid is
   * not. Looking an emoji up here by native character (see
   * getHighlightedEmoji) always finds it, regardless of its rank.
   */
  private allEmojis: ProcessedEmoji[] = [];
  /** Index into the picker's rendered grid the keyboard highlight sits on, or -1 when there is nothing to highlight. */
  private highlightedIndex = -1;
  /** The rendered button the highlight is currently applied to — the source of truth for getHighlightedEmoji. */
  private highlightedButton: HTMLButtonElement | null = null;
  /**
   * Bumped once per renderMenu call. A call whose token no longer matches
   * this field after an await is stale — a later keystroke has already
   * superseded it, and applying its query would clobber the fresher one.
   * See renderMenu.
   */
  private renderToken = 0;
  /** The in-flight picker.open() for the current span, shared by every renderMenu call still waiting on it — see renderMenu. */
  private pendingOpen: Promise<void> | null = null;
  /**
   * Locks the page for the menu's open lifetime: the picker is anchored to
   * the caret's on-screen position, so a page scroll underneath it would
   * drift the picker away from the text that opened it. Locked once, in
   * renderMenu, on the same guard that flips `opened` true; unlocked once,
   * in close(), which every close path (including insertNative's commits)
   * routes through — see this file's own opened-write inventory.
   */
  private readonly scrollLocker = new ScrollLocker();

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

    // Claims this keystroke as the latest one BEFORE the first await, so a
    // slower-resolving earlier keystroke can recognize, once its own await
    // finally settles, that a later one has already superseded it — see
    // renderMenu for why this matters.
    const token = ++this.renderToken;

    // The browser already wrote the new ":" into the DOM before this input
    // event fired (same as every other character), so a CLOSING colon reads
    // here as an ordinary keystroke on a span that already existed one
    // character ago. Handle that case before resolving a span on the new
    // (now colon-terminated) text — resolveEmojiTriggerSpan would reject a
    // ":" that is itself preceded by non-whitespace, so the generic path
    // below can never see this as an open trigger on its own.
    if (event.data === ':') {
      const handledAsClosingColon = await this.commitOnClosingColon(text, caretOffset, token);

      // A stale call (superseded by a later keystroke) reports handled=true
      // without touching `opened` — report whatever it currently is rather
      // than assuming the menu closed.
      if (handledAsClosingColon) {
        return this.opened;
      }
    }

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

    if (token !== this.renderToken) {
      return this.opened;
    }

    this.allEmojis = emojis;

    const results = searchEmojisRanked(emojis, span.query);

    if (results.length === 0) {
      this.close();

      return false;
    }

    await this.renderMenu(input, span, token);

    if (token !== this.renderToken) {
      return this.opened;
    }

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
      case 'Enter':
      case 'Tab': {
        const emoji = this.getHighlightedEmoji();

        if (emoji !== null) {
          this.commit(emoji);
        }
        break;
      }
      default:
        break;
    }

    return true;
  }

  /**
   * Insert `emoji` at the ":query" span, replacing it, as one undo step.
   * Resolves the skin tone itself from the user's stored preference — this
   * is the keyboard path (Enter/Tab on the highlighted result); the picker's
   * own mouse-click `onSelect` already resolves the tone before calling back
   * and goes straight to {@link insertNative}.
   * @param emoji - the picked emoji
   */
  public commit(emoji: ProcessedEmoji): void {
    this.insertNative(skinnedNative(emoji));
  }

  /**
   * Replace the ":query" span at the caret with `native`, as one undo step,
   * mirroring MarkdownShortcuts.handleInlineMarkdown's sequence: resolve the
   * span, call `YjsManager.stopCapturing()` BEFORE the DOM write so the
   * replacement does not merge backward with the keystrokes that opened the
   * menu, then again AFTER so a keystroke typed right afterward does not
   * merge forward into it — Yjs's captureTimeout otherwise groups either
   * side into the same undo entry (see UndoHistory.stopCapturing).
   * @param native - the exact character(s) to insert
   * @param swallowClosingColon - true for the closing-colon commit: the DOM
   * already holds a trailing ":" one before the caret (the browser inserted
   * it before this event fired), so the span is resolved as it looked BEFORE
   * that colon and then extended by one to consume it. Resolving in this
   * node-local coordinate system (rather than the caller re-deriving offsets
   * from the block's plain text) is what keeps this correct when the block
   * has inline markup before the span — `range.startOffset` and a
   * block-plain-text offset only agree when the span's own text node starts
   * at the block's start.
   */
  private insertNative(native: string, swallowClosingColon = false): void {
    const currentBlock = this.Blok.BlockManager.currentBlock;
    const currentInput = currentBlock?.currentInput;

    if (currentBlock === undefined || currentInput === undefined) {
      return;
    }

    const selection = window.getSelection();

    if (selection === null || !selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType !== Node.TEXT_NODE || !currentInput.contains(node)) {
      return;
    }

    const fullText = node.textContent ?? '';
    const resolveOffset = swallowClosingColon ? range.startOffset - 1 : range.startOffset;
    const rawSpan = resolveEmojiTriggerSpan(fullText, resolveOffset);
    const span: EmojiTriggerSpan | null = rawSpan === null || !swallowClosingColon
      ? rawSpan
      : { ...rawSpan, end: rawSpan.end + 1 };

    if (span === null) {
      return;
    }

    this.Blok.YjsManager.stopCapturing();

    const before = fullText.slice(0, span.start);
    const after = fullText.slice(span.end);

    node.textContent = `${before}${native}${after}`;

    const caretRange = document.createRange();

    caretRange.setStart(node, before.length + native.length);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);

    // The DOM was mutated directly (not via a Tool re-render), so notify the
    // block to flush the change to Yjs — see the CRDT sync contract.
    currentBlock.dispatchChange();

    this.Blok.YjsManager.stopCapturing();

    this.close();
  }

  /**
   * Called from handleInput when the just-typed character is ":". Checks
   * whether the text one keystroke ago (i.e. ending right before this new
   * colon) already held a valid ":query" span — that makes this new colon a
   * CLOSING one. When it is: an exact shortcode match commits immediately,
   * swallowing the new colon; anything else just closes the menu, leaving
   * the literal text (including the new colon) untouched. Returns false when
   * no such span existed, so handleInput falls through to treating the colon
   * as an ordinary character — which is what keeps prose like "10:30" or a
   * fresh "note: " unaffected.
   * @param text - live plain text of the input, already including the new ":"
   * @param caretOffset - caret position right after the new ":"
   * @param token - this call's render generation, from handleInput's claim —
   * see renderMenu for why a stale call must not act on stale state.
   */
  private async commitOnClosingColon(text: string, caretOffset: number, token: number): Promise<boolean> {
    if (caretOffset === 0 || text.charAt(caretOffset - 1) !== ':') {
      return false;
    }

    const priorSpan = resolveEmojiTriggerSpan(text, caretOffset - 1);

    if (priorSpan === null) {
      return false;
    }

    const emojis = await loadEmojiData();

    if (token !== this.renderToken) {
      return true;
    }

    this.allEmojis = emojis;

    const lowerQuery = priorSpan.query.toLowerCase();
    // The id IS the shortcode, so an id match is the primary-key lookup and
    // always wins — a query like "fire" also happens to be an exact KEYWORD
    // of "firefighter", "candle" and "name_badge" in the real dataset, and
    // committing one of those over the "fire" emoji itself would be a guess.
    const idMatch = emojis.find(emoji => emoji.id.toLowerCase() === lowerQuery);

    // No emoji's id is the literal query (e.g. "thumbsup" isn't an id — it is
    // a keyword of "+1"). RANK_EXACT_ID ranks that keyword hit the same as an
    // id hit (see isExactShortcodeMatch), so fall back to it here — but only
    // commit when it is unique, for the same reason as above.
    const keywordMatches = idMatch === undefined
      ? emojis.filter(emoji => isExactShortcodeMatch(emoji, priorSpan.query))
      : [];
    const [onlyKeywordMatch] = keywordMatches;

    const match = idMatch ?? (keywordMatches.length === 1 ? onlyKeywordMatch : undefined);

    if (match !== undefined) {
      this.insertNative(skinnedNative(match), true);
    } else {
      this.close();
    }

    return true;
  }

  /**
   * The emoji the keyboard highlight currently sits on, or null when the
   * menu is closed or holds no results. Reads the native character off the
   * highlighted DOM node itself and looks it up in the full dataset — not
   * by indexing into the ranked results, which are capped while the
   * picker's own grid is not, and which the picker renders grouped by
   * category (reordering them relative to the flat ranked order whenever
   * categories interleave across rank tiers) — so neither array's index
   * lines up with what is actually highlighted on screen.
   */
  public getHighlightedEmoji(): ProcessedEmoji | null {
    const native = this.highlightedButton?.getAttribute('data-emoji-native') ?? null;

    if (native === null) {
      return null;
    }

    return this.allEmojis.find(emoji => emoji.native === native) ?? null;
  }

  /**
   * Moves the highlight to `index` (clamped to the rendered button count)
   * and applies it visually to the matching button in the picker's
   * rendered grid, if one exists there — the DOM write is best-effort so
   * this stays safe to call before the picker has rendered anything.
   * @param index - target index into the rendered grid; out-of-range clamps
   */
  private setHighlightedIndex(index: number): void {
    const buttons = this.picker !== null
      ? Array.from(this.picker.getElement().querySelectorAll<HTMLButtonElement>('[data-emoji-native]'))
      : [];

    if (buttons.length === 0) {
      this.highlightedIndex = -1;
      this.highlightedButton = null;

      return;
    }

    const clamped = Math.max(0, Math.min(buttons.length - 1, index));

    if (this.highlightedButton !== null) {
      this.highlightedButton.classList.remove(...EMOJI_HIGHLIGHT_CLASSES);
      this.highlightedButton.removeAttribute('aria-selected');
    }

    this.highlightedIndex = clamped;

    const current = buttons[clamped] ?? null;

    this.highlightedButton = current;

    if (current !== null) {
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
    this.scrollLocker.unlock();
    this.anchorRect = undefined;
    this.activeSpanStart = undefined;
    this.highlightedIndex = -1;
    this.highlightedButton = null;
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
   * `this.opened` only flips true once the FIRST open() resolves, so every
   * keystroke that lands before then also sees `isFreshTrigger === true`.
   * Without a guard each one would call `picker.open()` again — clearing
   * the query and re-rendering the full grid — and, since real async work
   * offers no guarantee that these resolve in the order they were issued,
   * whichever one settles last can apply a stale query over a fresher one.
   * `pendingOpen` de-duplicates the concurrent open() calls down to one,
   * and `token` (claimed by the caller, handleInput, before its own first
   * await) makes every call but the most recently issued one a no-op once
   * its await settles, so the last-typed query always wins.
   * @param input - the block's current contentEditable
   * @param span - the resolved ":query" span
   * @param token - this call's render generation, from handleInput's `renderToken` claim
   */
  private async renderMenu(input: HTMLElement, span: EmojiTriggerSpan, token: number): Promise<void> {
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
      this.pendingOpen ??= picker.open(input, anchorRect).finally(() => {
        this.pendingOpen = null;
      });
      await this.pendingOpen;
    }

    // A later keystroke already superseded this call while the picker was
    // opening — let its own render stand instead of overwriting it here.
    if (token !== this.renderToken) {
      return;
    }

    // Drives the picker's filtering with the typed query — there is no
    // visible search field to mirror it into in inline mode (see the
    // EmojiPicker `inline` option).
    picker.setQuery(span.query);

    if (!this.opened) {
      this.applyComboboxRoles(input);
      document.addEventListener('selectionchange', this.handleSelectionChange);
      this.scrollLocker.lock();
      this.opened = true;
    }
  }

  /** Builds the picker once and reuses it, mirroring Callout's own one-picker-per-tool lifecycle. */
  private ensurePicker(): EmojiPicker {
    if (this.picker !== null) {
      return this.picker;
    }

    const picker = new EmojiPicker({
      // The picker resolves the skin tone itself (getSkinnedNative) before
      // calling back, so `native` here is already final — insertNative(),
      // not commit(), which would apply the tone a second time.
      onSelect: (native) => this.insertNative(native),
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
