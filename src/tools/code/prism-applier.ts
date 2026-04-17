/** Prism CSS class-based highlight applier.
 * Injects highlighted HTML into a <code> element and manages
 * the custom stylesheet for token colors.
 */

let stylesheet: CSSStyleSheet | null = null;

const LIGHT_RULES = `
.blok-code .token.comment,
.blok-code .token.prolog,
.blok-code .token.doctype,
.blok-code .token.cdata { color: #6b7280; }

.blok-code .token.keyword,
.blok-code .token.operator,
.blok-code .token.important { color: #7c3aed; }

.blok-code .token.string,
.blok-code .token.attr-value,
.blok-code .token.char,
.blok-code .token.regex { color: #059669; }

.blok-code .token.number,
.blok-code .token.boolean,
.blok-code .token.constant,
.blok-code .token.symbol { color: #d97706; }

.blok-code .token.function,
.blok-code .token.class-name { color: #2563eb; }

.blok-code .token.builtin,
.blok-code .token.tag,
.blok-code .token.selector { color: #db2777; }

.blok-code .token.attr-name,
.blok-code .token.property,
.blok-code .token.variable { color: #ea580c; }

.blok-code .token.punctuation { color: #374151; }
`;

const DARK_RULES = `
.dark .blok-code .token.comment,
.dark .blok-code .token.prolog,
.dark .blok-code .token.doctype,
.dark .blok-code .token.cdata { color: #9ca3af; }

.dark .blok-code .token.keyword,
.dark .blok-code .token.operator,
.dark .blok-code .token.important { color: #a78bfa; }

.dark .blok-code .token.string,
.dark .blok-code .token.attr-value,
.dark .blok-code .token.char,
.dark .blok-code .token.regex { color: #34d399; }

.dark .blok-code .token.number,
.dark .blok-code .token.boolean,
.dark .blok-code .token.constant,
.dark .blok-code .token.symbol { color: #fbbf24; }

.dark .blok-code .token.function,
.dark .blok-code .token.class-name { color: #60a5fa; }

.dark .blok-code .token.builtin,
.dark .blok-code .token.tag,
.dark .blok-code .token.selector { color: #f472b6; }

.dark .blok-code .token.attr-name,
.dark .blok-code .token.property,
.dark .blok-code .token.variable { color: #fb923c; }

.dark .blok-code .token.punctuation { color: #d1d5db; }
`;

function ensureStylesheet(): void {
  if (stylesheet) return;
  stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(LIGHT_RULES + DARK_RULES);
  const existing = document.adoptedStyleSheets ?? [];
  document.adoptedStyleSheets = [...existing, stylesheet];
}

function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return -1;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length;
}

function setCaretOffset(el: HTMLElement, offset: number): void {
  if (offset < 0) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node: Text | null = null;
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (n.length >= remaining) { node = n; break; }
    remaining -= n.length;
  }
  if (!node) return;
  const range = document.createRange();
  range.setStart(node, remaining);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Apply Prism-highlighted HTML to a code element.
 * Saves and restores caret position. Returns a dispose function
 * that reverts the element to its plain-text content.
 */
export function applyPrismHighlight(el: HTMLElement, highlightedHtml: string): () => void {
  ensureStylesheet();

  const plainText = el.textContent ?? '';
  const caretOffset = getCaretOffset(el);

  el.classList.add('blok-code');
  el.innerHTML = highlightedHtml;

  setCaretOffset(el, caretOffset);

  return () => {
    el.innerHTML = plainText;
    el.classList.remove('blok-code');
  };
}

/** Remove the injected stylesheet (call on full editor teardown) */
export function disposePrismStyles(): void {
  if (!stylesheet) return;
  const existing = document.adoptedStyleSheets ?? [];
  document.adoptedStyleSheets = existing.filter(s => s !== stylesheet);
  stylesheet = null;
}
