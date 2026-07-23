import type { Block } from '../../../block';
import { HEADER_PATTERN, CHECKLIST_PATTERN, UNORDERED_LIST_PATTERN, ORDERED_LIST_PATTERN, ALPHA_ORDERED_LIST_PATTERN, TOGGLE_HEADER_PATTERN, TOGGLE_PATTERN, HEADER_TOOL_NAME, LIST_TOOL_NAME, TOGGLE_TOOL_NAME, DIVIDER_TOOL_NAME, DIVIDER_PATTERN, QUOTE_TOOL_NAME, QUOTE_PATTERN, CODE_TOOL_NAME, CODE_PATTERN } from '../constants';
import { hasUnsafeScheme } from '../../../utils/sanitize-url';
import { isSamePageLink } from '../../../../tools/link/registry';

import { BlockEventComposer } from './__base';

/**
 * Matches a completed `[label](url)` span ending at the caret, captured when the
 * closing `)` is typed. The label excludes `[`/`]` (no nested brackets) and the
 * url excludes whitespace and parens (so a stray `(`/`)` inside the url simply
 * stops the match rather than being misinterpreted).
 */
const LINK_MARKDOWN_PATTERN = /\[([^[\]]+)\]\(([^()\s]+)\)$/;

/**
 * Read the plain text of `container` from its start up to (node, offset),
 * across however many text nodes / inline elements the content is split into.
 * Mirrors the technique {@link MarkdownShortcuts.getCaretOffset} uses to
 * measure caret position, but returns the text itself rather than its length.
 */
const getTextBeforeCaret = (container: HTMLElement, node: Node, offset: number): string => {
  const preCaretRange = document.createRange();

  preCaretRange.selectNodeContents(container);
  preCaretRange.setEnd(node, offset);

  return preCaretRange.toString();
};

/**
 * Resolve a character offset (measured from the start of `container`'s text,
 * as returned by {@link getTextBeforeCaret}) to the concrete text node and
 * local offset it falls in. Returns null if the offset is out of range.
 */
const resolveTextOffset = (container: HTMLElement, targetOffset: number): { node: Text; offset: number } | null => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  const walk = (consumed: number): { node: Text; offset: number } | null => {
    const node = walker.nextNode() as Text | null;

    if (node === null) {
      return null;
    }

    const length = node.textContent?.length ?? 0;

    if (consumed + length >= targetOffset) {
      return { node, offset: targetOffset - consumed };
    }

    return walk(consumed + length);
  };

  return walk(0);
};

/**
 * Per-marker inline-markdown rules. `literal` is the regex-escaped marker,
 * `double` the tag for the `**`/`__`/`~~` form (null when there is none), and
 * `single` the tag for the single-marker form.
 *
 * `singleOpenGuard` is an optional regex lookbehind prepended to the single-marker
 * rule. CommonMark disallows intraword `_` emphasis (so `snake_case_` must NOT
 * italicise), while intraword `*` IS allowed — hence the guard only exists for `_`.
 */
const INLINE_RULES: Record<string, { literal: string; double: string | null; single: string; singleOpenGuard?: string }> = {
  '*': { literal: '\\*', double: 'strong', single: 'i' },
  '_': { literal: '_', double: 'strong', single: 'i', singleOpenGuard: '(?<![A-Za-z0-9])' },
  '`': { literal: '`', double: null, single: 'code' },
  '~': { literal: '~', double: 's', single: 's' },
};

interface InlineMarkdownMatch {
  /**
   * Tags the span should be wrapped in, outermost first (e.g. ['strong'] or,
   * for the triple `***…***` form, ['strong', 'i'] → `<strong><i>…</i></strong>`).
   */
  tags: string[];
  /** Text content between the markers. */
  inner: string;
  /** Length (in characters) of the full `marker + inner + marker` match. */
  length: number;
}

/**
 * Detect a completed inline-markdown span ending at the end of `text` (the text
 * just before the caret), given the closing marker character that was typed.
 *
 * Double markers (`**`, `__`, `~~`) take priority over single ones, and the
 * single form uses a negative lookbehind so a span is not detected while a
 * double-marker span is still being typed (e.g. `**bold*`). `inner` excludes the
 * marker character, so nested same-marker spans are intentionally not matched.
 * @param text - text immediately before the caret
 * @param marker - the closing marker character just inserted
 * @returns the match, or null when no complete span ends at the caret
 */
const detectInlineMarkdown = (text: string, marker: string): InlineMarkdownMatch | null => {
  const rule = INLINE_RULES[marker];

  if (rule === undefined) {
    return null;
  }

  const { literal, double: doubleTag, single: singleTag, singleOpenGuard = '' } = rule;

  // Notion only auto-formats CONTIGUOUS spans: leading/trailing inner whitespace
  // (e.g. `** bold **`, `* x *`) is left as typed.
  const hasEdgeWhitespace = (inner: string): boolean => /^\s|\s$/.test(inner);

  // Triple markers (`***bolditalic***`) wrap the inner text as BOTH bold and
  // italic, consuming all three markers on each side. The leading `(?<!literal)`
  // also stops the double rule below from half-matching `***x**` mid-typing.
  if (doubleTag !== null && doubleTag !== singleTag) {
    const triple = new RegExp(
      `(?<!${literal})${literal}${literal}${literal}([^${marker}]+)${literal}${literal}${literal}$`
    ).exec(text);

    if (triple !== null && !hasEdgeWhitespace(triple[1])) {
      return { tags: [doubleTag, singleTag], inner: triple[1], length: triple[0].length };
    }
  }

  if (doubleTag !== null) {
    const double = new RegExp(`(?<!${literal})${literal}${literal}([^${marker}]+)${literal}${literal}$`).exec(text);

    if (double !== null && !hasEdgeWhitespace(double[1])) {
      return { tags: [doubleTag], inner: double[1], length: double[0].length };
    }
  }

  const single = new RegExp(`${singleOpenGuard}(?<!${literal})${literal}([^${marker}]+)${literal}$`).exec(text);

  if (single !== null && !hasEdgeWhitespace(single[1])) {
    return { tags: [singleTag], inner: single[1], length: single[0].length };
  }

  return null;
};

/**
 * MarkdownShortcuts Composer handles markdown-like shortcuts for auto-converting to lists or headers.
 *
 * Shortcuts are triggered by typing a space after the pattern:
 * - Lists: "- ", "* ", "1. ", "1) ", "[] ", "[x] "
 * - Headers: "# ", "## ", etc. (or custom shortcuts configured in header tool)
 *
 * Preserves HTML content and maintains caret position after conversion.
 */
export class MarkdownShortcuts extends BlockEventComposer {
  /**
   * Handle input events to detect markdown shortcuts.
   * Only processes insertText events that end with a space.
   * @param event - input event
   * @returns true if a shortcut was triggered and handled
   */
  public handleInput(event: InputEvent): boolean {
    if (event.inputType !== 'insertText') {
      return false;
    }

    /**
     * Divider shortcut triggers on the third hyphen — no space needed.
     */
    if (event.data === '-') {
      return this.handleDividerShortcut();
    }

    /**
     * Code-block shortcut triggers on the third backtick — no space needed,
     * mirroring the divider's "---" behaviour. When the text is not a bare
     * "```" the backtick falls through to inline `code` auto-formatting below.
     */
    if (event.data === '`' && this.handleCodeShortcut()) {
      return true;
    }

    /**
     * Link shortcut triggers on the closing ")" of `[label](url)` — mirrors
     * the inline-markdown auto-format below but produces an <a> instead of a
     * single wrapper tag, so it is handled as its own case.
     */
    if (event.data === ')' && this.handleLinkMarkdown()) {
      return true;
    }

    if (event.data !== ' ') {
      /**
       * Inline markdown auto-format (Notion): typing the closing marker of
       * `**bold**`, `*italic*`, `` `code` `` or `~strike~` wraps the span in
       * place. Other characters are ignored here.
       */
      return this.handleInlineMarkdown(event.data);
    }

    const handledList = this.handleListShortcut();
    const handledHeader = this.handleHeaderShortcut();
    const handledToggleHeader = this.handleToggleHeaderShortcut();
    const handledToggle = this.handleToggleShortcut();
    const handledQuote = this.handleQuoteShortcut();
    const handledCode = this.handleCodeShortcut();

    return handledList || handledHeader || handledToggleHeader || handledToggle || handledQuote || handledCode;
  }

  /**
   * Check if current block content matches a list shortcut pattern
   * and convert to appropriate list type.
   */
  private handleListShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    // List markdown triggers convert a paragraph or a quote into the list type,
    // preserving its text. A HEADING is intentionally excluded: it's a distinct
    // structural block, so typing "- " inside a heading keeps the marker as
    // literal text instead of collapsing the heading into a plain list item.
    // They must also NOT fire inside a code block or an already-list block, so
    // the gate stays an explicit allowlist rather than "anything non-default".
    const toolName = currentBlock.tool.name;
    const isListTriggerEligible = currentBlock.tool.isDefault || toolName === QUOTE_TOOL_NAME;

    if (!isListTriggerEligible) {
      return false;
    }

    const listTool = Tools.blockTools.get(LIST_TOOL_NAME);

    if (!listTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';

    const depthAttr = currentBlock.holder.getAttribute('data-blok-depth');
    const depth = depthAttr ? parseInt(depthAttr, 10) : 0;

    const checklistMatch = CHECKLIST_PATTERN.exec(textContent);

    if (checklistMatch) {
      this.Blok.YjsManager.stopCapturing();

      const isChecked = checklistMatch[1]?.toLowerCase() === 'x';
      const shortcutLength = checklistMatch[1] !== undefined ? 4 : 3;
      const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
      const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

      const newBlock = BlockManager.replace(currentBlock, LIST_TOOL_NAME, {
        text: remainingHtml,
        style: 'checklist',
        checked: isChecked,
        ...(depth > 0 ? { depth } : {}),
      });

      this.setCaretAfterConversion(newBlock, caretOffset);

      this.Blok.YjsManager.stopCapturing();

      return true;
    }

    const unorderedMatch = UNORDERED_LIST_PATTERN.exec(textContent);

    if (unorderedMatch) {
      this.Blok.YjsManager.stopCapturing();

      const shortcutLength = 2;
      const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
      const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

      const newBlock = BlockManager.replace(currentBlock, LIST_TOOL_NAME, {
        text: remainingHtml,
        style: 'unordered',
        checked: false,
        ...(depth > 0 ? { depth } : {}),
      });

      this.setCaretAfterConversion(newBlock, caretOffset);

      this.Blok.YjsManager.stopCapturing();

      return true;
    }

    const orderedMatch = ORDERED_LIST_PATTERN.exec(textContent);
    const alphaMatch = orderedMatch ? null : ALPHA_ORDERED_LIST_PATTERN.exec(textContent);
    const listMatch = orderedMatch ?? alphaMatch;

    if (!listMatch) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const marker = listMatch[1];
    // Numeric markers ("5. ") start at their value; the alpha/roman aliases
    // ("a. " / "i. ") both start at 1 — their glyph is depth-driven, not the letter.
    const startNumber = orderedMatch ? parseInt(marker, 10) : 1;
    const shortcutLength = marker.length + 2;
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

    const listData: { text: string; style: string; checked: boolean; start?: number; depth?: number } = {
      text: remainingHtml,
      style: 'ordered',
      checked: false,
    };

    if (startNumber !== 1) {
      listData.start = startNumber;
    }

    if (depth > 0) {
      listData.depth = depth;
    }

    const newBlock = BlockManager.replace(currentBlock, LIST_TOOL_NAME, listData);

    this.setCaretAfterConversion(newBlock, caretOffset);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Inline markdown auto-format. Triggered when the user types a closing marker
   * character (`*`, `_`, `` ` `` or `~`). Detects a completed `**bold**`,
   * `*italic*`, `` `code` `` or `~strike~` span ending at the caret — within the
   * single text node the caret sits in — and replaces it with the editor's
   * inline markup (`<strong>` / `<i>` / `<code>` / `<s>`), keeping the caret
   * after the new span. Operating on one text node keeps this safe: the markers
   * were just typed, so they are plain text, never split across existing marks.
   * @param closingChar - the character that was just inserted
   * @returns true if a span was auto-formatted
   */
  private handleInlineMarkdown(closingChar: string | null): boolean {
    if (closingChar === null || INLINE_RULES[closingChar] === undefined) {
      return false;
    }

    const currentBlock = this.Blok.BlockManager.currentBlock;
    const currentInput = currentBlock?.currentInput;

    if (!currentBlock || !currentInput) {
      return false;
    }

    const selection = window.getSelection();

    if (selection === null || !selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const caretOffset = range.startOffset;

    if (node.nodeType !== Node.TEXT_NODE || !currentInput.contains(node)) {
      return false;
    }

    // Never auto-format inside an existing code span — its content is literal.
    if (node.parentElement?.closest('code')) {
      return false;
    }

    const textBeforeCaret = (node.textContent ?? '').slice(0, caretOffset);
    const match = detectInlineMarkdown(textBeforeCaret, closingChar);

    if (match === null) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const fullText = node.textContent ?? '';
    const matchStart = caretOffset - match.length;
    const beforeText = fullText.slice(0, matchStart);
    const afterText = fullText.slice(caretOffset);

    const fragment = document.createDocumentFragment();

    if (beforeText.length > 0) {
      fragment.appendChild(document.createTextNode(beforeText));
    }

    // Build the (possibly nested) wrapper, outermost tag first. For the triple
    // `***…***` form this yields `<strong><i>…</i></strong>`.
    const wrapper = document.createElement(match.tags[0]);
    const innermost = match.tags.slice(1).reduce<HTMLElement>((parent, tag) => {
      const child = document.createElement(tag);

      parent.appendChild(child);

      return child;
    }, wrapper);

    innermost.textContent = match.inner;
    fragment.appendChild(wrapper);

    const afterNode = afterText.length > 0 ? document.createTextNode(afterText) : null;

    if (afterNode !== null) {
      fragment.appendChild(afterNode);
    }

    const parent = node.parentNode;

    if (parent === null) {
      return false;
    }

    parent.replaceChild(fragment, node);

    // Place the caret right after the new span so typing continues unformatted.
    const caretRange = document.createRange();

    if (afterNode !== null) {
      caretRange.setStart(afterNode, 0);
    } else {
      caretRange.setStartAfter(wrapper);
    }
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);

    // The DOM was mutated directly (not via a Tool re-render), so notify the
    // block to flush the change to Yjs — see the CRDT sync contract.
    currentBlock.dispatchChange();

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Link markdown auto-format. Triggered when the user types the closing `)` of
   * a `[label](url)` span. Detects a completed span ending at the caret — within
   * the single text node the caret sits in — and replaces it with an `<a>` tag,
   * keeping the caret after the new link. Mirrors {@link handleInlineMarkdown}'s
   * DOM-replacement approach, but builds an anchor instead of a wrapper tag.
   * @returns true if a link was auto-formatted
   */
  private handleLinkMarkdown(): boolean {
    const currentBlock = this.Blok.BlockManager.currentBlock;
    const currentInput = currentBlock?.currentInput;

    if (!currentBlock || !currentInput) {
      return false;
    }

    const selection = window.getSelection();

    if (selection === null || !selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const caretNode = range.startContainer;
    const caretOffset = range.startOffset;

    if (caretNode.nodeType !== Node.TEXT_NODE || !currentInput.contains(caretNode)) {
      return false;
    }

    // Never auto-format inside an existing code span — its content is literal.
    if (caretNode.parentElement?.closest('code')) {
      return false;
    }

    // Read the text preceding the caret across the WHOLE input, not just the
    // caret's own text node. "/" is intercepted by the slash-command keydown
    // handler and inserted via a separate DOM-mutation path (see
    // blockEvents/index.ts `slashPressed`), which splits a typed URL like
    // "https://blok.dev" into several sibling text nodes by the time ")" is
    // typed. Matching only the caret's node would miss the opening "[".
    const textBeforeCaret = getTextBeforeCaret(currentInput, caretNode, caretOffset);
    const match = LINK_MARKDOWN_PATTERN.exec(textBeforeCaret);

    if (match === null) {
      return false;
    }

    const [fullMatch, label, url] = match;

    // Reject script-capable schemes (javascript:, data:, etc.) — same allowlist
    // the Link inline tool uses for manually-entered URLs.
    if (hasUnsafeScheme(url)) {
      return false;
    }

    const matchStartOffset = textBeforeCaret.length - fullMatch.length;
    const matchStart = resolveTextOffset(currentInput, matchStartOffset);

    if (matchStart === null) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    // Delete the matched markdown span — which may cross several text nodes —
    // and insert the anchor in its place via the Range API, so the replacement
    // is correct regardless of how many nodes the span is fragmented across.
    const matchRange = document.createRange();

    matchRange.setStart(matchStart.node, matchStart.offset);
    matchRange.setEnd(caretNode, caretOffset);
    matchRange.deleteContents();

    const anchor = document.createElement('a');

    anchor.href = url;
    // Same-page destinations (#anchors or same origin+pathname) open in the same
    // window; everything else keeps the new-tab default used by the Link tool.
    anchor.target = isSamePageLink(url) ? '_self' : '_blank';
    anchor.rel = 'nofollow';
    anchor.textContent = label;

    matchRange.insertNode(anchor);

    // Place the caret right after the new link so typing continues unformatted.
    const caretRange = document.createRange();

    caretRange.setStartAfter(anchor);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);

    // The DOM was mutated directly (not via a Tool re-render), so notify the
    // block to flush the change to Yjs — see the CRDT sync contract.
    currentBlock.dispatchChange();

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block matches a header shortcut pattern and convert it.
   */
  private handleHeaderShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    // Check if inside table cell
    const isInsideTableCell = currentBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

    if (isInsideTableCell) {
      return false; // Don't convert to header
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const headerTool = Tools.blockTools.get(HEADER_TOOL_NAME);

    if (!headerTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';
    const { levels, shortcuts } = headerTool.settings as { levels?: number[]; shortcuts?: Record<number, string> };
    const match = shortcuts === undefined
      ? this.matchDefaultHeaderShortcut(textContent)
      : this.matchCustomHeaderShortcut(textContent, shortcuts);

    if (!match || (levels && !levels.includes(match.level))) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const remainingHtml = this.extractRemainingHtml(currentInput, match.shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - match.shortcutLength;

    const newBlock = BlockManager.replace(currentBlock, HEADER_TOOL_NAME, {
      text: remainingHtml,
      level: match.level,
    });

    this.setCaretAfterConversion(newBlock, caretOffset);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block matches a toggle header shortcut pattern ("># ", ">## ", etc.)
   * and convert it to a header with isToggleable: true.
   */
  private handleToggleHeaderShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    // Check if inside table cell
    const isInsideTableCell = currentBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

    if (isInsideTableCell) {
      return false;
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const headerTool = Tools.blockTools.get(HEADER_TOOL_NAME);

    if (!headerTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';
    const match = TOGGLE_HEADER_PATTERN.exec(textContent);

    if (!match) {
      return false;
    }

    const level = match[1].length;
    const { levels } = headerTool.settings as { levels?: number[] };

    if (levels && !levels.includes(level)) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const shortcutLength = 1 + level + 1; // ">" + hashes + " "
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

    const newBlock = BlockManager.replace(currentBlock, HEADER_TOOL_NAME, {
      text: remainingHtml,
      level,
      isToggleable: true,
    });

    if (caretOffset > 0) {
      this.setCaretAfterConversion(newBlock, caretOffset);
    } else {
      this.setCaretAfterToggleArrow(newBlock);
    }

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block matches a toggle shortcut pattern ("> ") and convert it.
   */
  private handleToggleShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    // Check if inside table cell
    const isInsideTableCell = currentBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

    if (isInsideTableCell) {
      return false;
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const toggleTool = Tools.blockTools.get(TOGGLE_TOOL_NAME);

    if (!toggleTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';
    const match = TOGGLE_PATTERN.exec(textContent);

    if (!match) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const shortcutLength = 2; // "> "
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

    const newBlock = BlockManager.replace(currentBlock, TOGGLE_TOOL_NAME, {
      text: remainingHtml,
    });

    this.setCaretAfterConversion(newBlock, caretOffset);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block content is exactly "---" and convert to divider.
   * Unlike other shortcuts, this triggers on the third hyphen keystroke — no space needed.
   */
  private handleDividerShortcut(): boolean {
    const { BlockManager, Tools, Caret } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const dividerTool = Tools.blockTools.get(DIVIDER_TOOL_NAME);

    if (!dividerTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';

    if (!DIVIDER_PATTERN.test(textContent)) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const newBlock = BlockManager.replace(currentBlock, DIVIDER_TOOL_NAME, {});

    /**
     * Insert an empty paragraph after the divider and set caret there,
     * so the user can continue typing.
     */
    const newBlockIndex = BlockManager.getBlockIndex(newBlock);
    const paragraphBlock = BlockManager.insertDefaultBlockAtIndex(newBlockIndex + 1);

    Caret.setToBlock(paragraphBlock, Caret.positions.START);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block matches a quote shortcut pattern (" ") and convert it.
   */
  private handleQuoteShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const quoteTool = Tools.blockTools.get(QUOTE_TOOL_NAME);

    if (!quoteTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';
    const match = QUOTE_PATTERN.exec(textContent);

    if (!match) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const shortcutLength = 2; // " " + space
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

    const newBlock = BlockManager.replace(currentBlock, QUOTE_TOOL_NAME, {
      text: remainingHtml,
    });

    this.setCaretAfterConversion(newBlock, caretOffset);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block matches a code shortcut pattern ("``` ") and convert it.
   */
  private handleCodeShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const codeTool = Tools.blockTools.get(CODE_TOOL_NAME);

    if (!codeTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';
    const match = CODE_PATTERN.exec(textContent);

    if (!match) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    // "```" alone removes 3 chars; "``` …" removes the backticks plus the space.
    const remainingText = match[1] ?? '';
    const shortcutLength = textContent.length - remainingText.length;
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);

    const newBlock = BlockManager.replace(currentBlock, CODE_TOOL_NAME, {
      code: remainingHtml,
    });

    this.setCaretAfterConversion(newBlock, 0);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Match default header shortcuts like "# ", "## ", etc.
   */
  private matchDefaultHeaderShortcut(text: string): { level: number; shortcutLength: number } | null {
    const match = HEADER_PATTERN.exec(text);

    return match ? { level: match[1].length, shortcutLength: match[1].length + 1 } : null;
  }

  /**
   * Match custom header shortcuts configured in the header tool.
   */
  private matchCustomHeaderShortcut(
    text: string,
    shortcuts: Record<number, string>
  ): { level: number; shortcutLength: number } | null {
    for (const [levelStr, prefix] of Object.entries(shortcuts).sort((a, b) => b[1].length - a[1].length)) {
      if (text.length <= prefix.length || !text.startsWith(prefix)) {
        continue;
      }

      const charAfterPrefix = text.charCodeAt(prefix.length);

      if (charAfterPrefix === 32 || charAfterPrefix === 160) {
        return { level: parseInt(levelStr, 10), shortcutLength: prefix.length + 1 };
      }
    }

    return null;
  }

  /**
   * Place caret right after the toggle arrow element in a toggle header block.
   * The arrow is a contentEditable="false" span prepended inside the editable heading,
   * so the generic setToBlock(START) descends into it. This method positions the caret
   * directly after the arrow node without inserting any DOM nodes.
   */
  private setCaretAfterToggleArrow(block: Block): void {
    const { Caret } = this.Blok;
    const input = block.firstInput;

    if (!input?.firstChild) {
      Caret.setToBlock(block, Caret.positions.START);

      return;
    }

    const range = document.createRange();

    range.setStartAfter(input.firstChild);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /**
   * Extract HTML content after a shortcut prefix.
   */
  private extractRemainingHtml(input: HTMLElement, shortcutLength: number): string {
    const innerHTML = input.innerHTML || '';

    const temp = document.createElement('div');

    temp.innerHTML = innerHTML;

    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);
    const nodesToModify = this.collectNodesToModify(walker, shortcutLength);

    for (const { node, removeCount } of nodesToModify) {
      const text = node.textContent || '';

      if (removeCount >= text.length) {
        node.remove();
      } else {
        node.textContent = text.slice(removeCount);
      }
    }

    return temp.innerHTML;
  }

  /**
   * Collect text nodes that need modification to remove shortcut characters.
   */
  private collectNodesToModify(
    walker: TreeWalker,
    charsToRemove: number
  ): Array<{ node: Text; removeCount: number }> {
    const result: Array<{ node: Text; removeCount: number }> = [];

    if (charsToRemove <= 0 || !walker.nextNode()) {
      return result;
    }

    const textNode = walker.currentNode as Text;
    const nodeLength = textNode.textContent?.length || 0;

    if (nodeLength <= charsToRemove) {
      result.push({ node: textNode, removeCount: nodeLength });

      return result.concat(this.collectNodesToModify(walker, charsToRemove - nodeLength));
    }

    result.push({ node: textNode, removeCount: charsToRemove });

    return result;
  }

  /**
   * Get the current caret offset within the input element.
   */
  private getCaretOffset(input: HTMLElement): number {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return 0;
    }

    const range = selection.getRangeAt(0);

    const preCaretRange = document.createRange();

    preCaretRange.selectNodeContents(input);
    preCaretRange.setEnd(range.startContainer, range.startOffset);

    return preCaretRange.toString().length;
  }

  /**
   * Set caret position in the new block after conversion.
   */
  private setCaretAfterConversion(block: Block, offset: number): void {
    const { Caret } = this.Blok;

    if (offset <= 0) {
      Caret.setToBlock(block, Caret.positions.START);

      return;
    }

    Caret.setToBlock(block, Caret.positions.DEFAULT, offset);
  }
}
