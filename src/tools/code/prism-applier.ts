/** Prism CSS class-based highlight applier.
 * Injects highlighted HTML into a <code> element and manages
 * the custom stylesheet for token colors.
 */

// eslint-disable-next-line no-restricted-syntax -- module singleton, must be reassignable
let stylesheet: CSSStyleSheet | null = null;

export const LIGHT_RULES = `
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
.blok-code .token.regex { color: #047857; }

.blok-code .token.number,
.blok-code .token.boolean,
.blok-code .token.constant,
.blok-code .token.symbol { color: #b45309; }

.blok-code .token.function,
.blok-code .token.class-name { color: #2563eb; }

.blok-code .token.builtin,
.blok-code .token.tag,
.blok-code .token.selector { color: #be185d; }

.blok-code .token.attr-name,
.blok-code .token.property,
.blok-code .token.variable { color: #c2410c; }

.blok-code .token.punctuation { color: #374151; }

/* --- Extended coverage: token classes Prism emits that the base palette missed.
 * Grouped into the same hue families above so highlighting stays coherent
 * across every supported language. (See test/unit/tools/code/prism-coverage.test.ts.) */

/* string family (green) — template/interpolated/literal string containers, imports, links, inline code */
.blok-code .token.template-string,
.blok-code .token.string-interpolation,
.blok-code .token.string-literal,
.blok-code .token.command-literal,
.blok-code .token.regex-literal,
.blok-code .token.import,
.blok-code .token.url,
.blok-code .token.code { color: #047857; }

/* function / class-name family (blue) — namespaces, definitions, code structures, types */
.blok-code .token.namespace,
.blok-code .token.method-definition,
.blok-code .token.expression,
.blok-code .token.scalar,
.blok-code .token.code-block,
.blok-code .token.base-clause,
.blok-code .token.generic-function { color: #2563eb; }

/* builtin family (pink) — decorators, package markers, markup entities */
.blok-code .token.decorator,
.blok-code .token.entity,
.blok-code .token.package { color: #be185d; }

/* attr-name / property family (orange) — interpolation, parameters, attributes, mapping keys */
.blok-code .token.interpolation,
.blok-code .token.parameter,
.blok-code .token.attribute,
.blok-code .token.atrule,
.blok-code .token.key,
.blok-code .token.property-query { color: #c2410c; }

/* keyword family (purple) — generics, at-rules, instructions, emphasis */
.blok-code .token.generics,
.blok-code .token.rule,
.blok-code .token.instruction,
.blok-code .token.code-language { color: #7c3aed; }
.blok-code .token.bold { color: #7c3aed; font-weight: 700; }
.blok-code .token.italic { color: #7c3aed; font-style: italic; }

/* pure syntax wrapper — match default text so it is covered without changing appearance */
.blok-code .token.php { color: #000000; }

/* Mermaid-specific tokens — scoped to lang-mermaid to avoid polluting other languages.
 * Colors use Atom One Light palette:
 *   @hue-1 = #0369a1  (cyan)
 *   @hue-6-2 = #8a5d01 (amber/gold — node IDs)
 *   @hue-4 = #417a40  (green — edge labels)
 */
.blok-code.lang-mermaid .token.diagram-name { color: #0369a1; }
.blok-code.lang-mermaid .token.node-bracket { color: #0369a1; }
.blok-code.lang-mermaid .token.edge-delimiter { color: #0369a1; }
.blok-code.lang-mermaid .token.edge-label { color: #417a40; }
.blok-code.lang-mermaid .token.variable { color: #8a5d01; }
.blok-code.lang-mermaid .token.keyword,
.blok-code.lang-mermaid .token.operator,
.blok-code.lang-mermaid .token.string { color: inherit; }
`;

export const DARK_RULES = `
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

/* --- Extended coverage (dark) — mirrors the light-theme groups above. */

/* string family (green) */
.dark .blok-code .token.template-string,
.dark .blok-code .token.string-interpolation,
.dark .blok-code .token.string-literal,
.dark .blok-code .token.command-literal,
.dark .blok-code .token.regex-literal,
.dark .blok-code .token.import,
.dark .blok-code .token.url,
.dark .blok-code .token.code { color: #34d399; }

/* function / class-name family (blue) */
.dark .blok-code .token.namespace,
.dark .blok-code .token.method-definition,
.dark .blok-code .token.expression,
.dark .blok-code .token.scalar,
.dark .blok-code .token.code-block,
.dark .blok-code .token.base-clause,
.dark .blok-code .token.generic-function { color: #60a5fa; }

/* builtin family (pink) */
.dark .blok-code .token.decorator,
.dark .blok-code .token.entity,
.dark .blok-code .token.package { color: #f472b6; }

/* attr-name / property family (orange) */
.dark .blok-code .token.interpolation,
.dark .blok-code .token.parameter,
.dark .blok-code .token.attribute,
.dark .blok-code .token.atrule,
.dark .blok-code .token.key,
.dark .blok-code .token.property-query { color: #fb923c; }

/* keyword family (purple) */
.dark .blok-code .token.generics,
.dark .blok-code .token.rule,
.dark .blok-code .token.instruction,
.dark .blok-code .token.code-language { color: #a78bfa; }
.dark .blok-code .token.bold { color: #a78bfa; font-weight: 700; }
.dark .blok-code .token.italic { color: #a78bfa; font-style: italic; }

/* pure syntax wrapper — match dark default text */
.dark .blok-code .token.php { color: #e2e0dc; }

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

/**
 * Re-gate the dark palette onto the selectors Blok actually uses.
 *
 * `DARK_RULES` is authored against `.dark`, but nothing in Blok ever adds that
 * class — theming runs through `[data-blok-theme]` and `prefers-color-scheme`
 * (see `src/styles/colors.css`). Every dark rule was therefore inert and dark
 * code blocks rendered the LIGHT palette, bottoming out at 1.54:1 for
 * punctuation. Emitted under both gates so an explicit theme choice beats the
 * media query, matching how colors.css orders them.
 */
const applyDarkThemeGates = (rules: string): string => {
  const mediaScoped = rules.split('.dark ').join(':root:not([data-blok-theme="light"]) ');
  const attributeScoped = rules.split('.dark ').join('[data-blok-theme="dark"] ');

  return `@media (prefers-color-scheme: dark) {\n${mediaScoped}\n}\n${attributeScoped}`;
};

/** Adopt the Prism token-color stylesheet (idempotent). */
export function ensurePrismStyles(): void {
  if (stylesheet) return;
  stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(LIGHT_RULES + applyDarkThemeGates(DARK_RULES));
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
  ensurePrismStyles();

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
