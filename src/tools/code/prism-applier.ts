/** Prism CSS class-based highlight applier.
 * Injects highlighted HTML into a <code> element and manages
 * the custom stylesheet for token colors.
 */

// eslint-disable-next-line no-restricted-syntax -- module singleton, must be reassignable
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

/* Mermaid-specific tokens — scoped to lang-mermaid to avoid polluting other languages.
 * Colors use Atom One Light palette:
 *   @hue-1 = #0184bc  (cyan)
 *   @hue-6-2 = #c18401 (amber/gold — node IDs)
 *   @hue-4 = #50a14f  (green — edge labels)
 */
.blok-code.lang-mermaid .token.diagram-name { color: #0184bc; }
.blok-code.lang-mermaid .token.node-bracket { color: #0184bc; }
.blok-code.lang-mermaid .token.edge-delimiter { color: #0184bc; }
.blok-code.lang-mermaid .token.edge-label { color: #50a14f; }
.blok-code.lang-mermaid .token.variable { color: #c18401; }
.blok-code.lang-mermaid .token.keyword,
.blok-code.lang-mermaid .token.operator,
.blok-code.lang-mermaid .token.string { color: inherit; }
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

/* Mermaid-specific tokens — dark mode.
 * Colors use Atom One Dark palette:
 *   @hue-1 = #56b5c2  (cyan)
 *   @hue-6-2 = #e4bf7a (amber/yellow — node IDs)
 *   @hue-4 = #97c279  (green — edge labels)
 */
.dark .blok-code.lang-mermaid .token.diagram-name { color: #56b5c2; }
.dark .blok-code.lang-mermaid .token.node-bracket { color: #56b5c2; }
.dark .blok-code.lang-mermaid .token.edge-delimiter { color: #56b5c2; }
.dark .blok-code.lang-mermaid .token.edge-label { color: #97c279; }
.dark .blok-code.lang-mermaid .token.variable { color: #e4bf7a; }
.dark .blok-code.lang-mermaid .token.keyword,
.dark .blok-code.lang-mermaid .token.operator,
.dark .blok-code.lang-mermaid .token.string { color: inherit; }
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
  // eslint-disable-next-line no-restricted-syntax -- TreeWalker requires iteration with nextNode()
  let remaining = offset;
  // eslint-disable-next-line no-restricted-syntax -- accumulator updated inside TreeWalker loop
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
 * The optional `lang` parameter adds a `lang-{language}` class used
 * to scope language-specific CSS rules (e.g. Mermaid token colors).
 */
export function applyPrismHighlight(el: HTMLElement, highlightedHtml: string, lang?: string): () => void {
  ensureStylesheet();

  const plainText = el.textContent ?? '';
  const caretOffset = getCaretOffset(el);

  el.classList.add('blok-code');
  if (lang) {
    el.classList.add(`lang-${lang}`);
  }
  // eslint-disable-next-line no-param-reassign -- intentional DOM mutation to apply highlighting
  el.innerHTML = highlightedHtml;

  setCaretOffset(el, caretOffset);

  return () => {
    // eslint-disable-next-line no-param-reassign -- intentional DOM mutation to restore plain text
    el.innerHTML = plainText;
    el.classList.remove('blok-code');
    if (lang) {
      el.classList.remove(`lang-${lang}`);
    }
  };
}

/** Remove the injected stylesheet (call on full editor teardown) */
export function disposePrismStyles(): void {
  if (!stylesheet) return;
  const existing = document.adoptedStyleSheets ?? [];
  document.adoptedStyleSheets = existing.filter(s => s !== stylesheet);
  stylesheet = null;
}
