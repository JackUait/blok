import { CODE_LANGUAGE_ATTR } from './constants';

/**
 * Pre-process clipboard HTML copied out of an AI chat app (ChatGPT, Gemini)
 * before sanitization.
 *
 * These apps render an answer as a component tree, not as a document: the
 * markup that carries meaning (the LaTeX source, a code block's language) sits
 * in attributes and header chrome the sanitizer strips, while the markup that
 * carries no meaning (KaTeX's visual layout, copy buttons) is made of tags the
 * sanitizer keeps. Left alone, the meaningful half is lost and the meaningless
 * half becomes document text. This rewrites both halves into Blok's allowed
 * semantic tag set BEFORE the sanitizer runs, mirroring `preprocessNotionHtml`,
 * and is a no-op when the source is neither app.
 *
 * Claude (claude.ai) is deliberately not handled: no payload has been captured
 * from it, and the repo's fixture-provenance rule forbids writing a detector
 * against selectors nobody has verified.
 *
 * @param html - raw clipboard HTML string
 * @returns preprocessed HTML string (unchanged when not an AI chat app)
 */
export function preprocessAiChatHtml(html: string): string {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  const source = detectSource(wrapper);

  if (source === null) {
    return html;
  }

  if (source === 'chatgpt') {
    removeCitationMarkers(wrapper);
    flattenEditorCodeBlocks(wrapper);
  } else {
    rewriteGeminiCodeBlocks(wrapper);
    removeElements(wrapper, GEMINI_CHROME_SELECTOR);
  }

  // Math first: the TeX it recovers lives beside an aria-hidden render that the
  // next line would otherwise delete along with its source.
  replaceMathWithLatex(wrapper);
  removeElements(wrapper, HIDDEN_CHROME_SELECTOR);

  return wrapper.innerHTML;
}

/**
 * Centralized clipboard signatures. This is the ONE place to update when an
 * app changes its markup.
 *
 * ChatGPT stamps every rendered node with the character range it occupies in
 * the source markdown, so a `data-start`+`data-end` pair identifies it even
 * when the selection starts mid-answer and excludes the `.markdown` wrapper.
 * Gemini is an Angular app whose response tree is addressed by node path.
 */
const CHATGPT_SIGNATURE_SELECTOR = '[data-start][data-end], [data-math-source], .markdown-new-styling';
const GEMINI_SIGNATURE_SELECTOR = '[data-path-to-node], response-element, code-block, table-block';

/** Interactive chrome Gemini sweeps into the selection alongside the answer. */
const GEMINI_CHROME_SELECTOR =
  'gem-icon-button, gem-icon, gem-popover, button, [hide-from-message-actions]';

/**
 * Content that is in the DOM but not on screen, and so is never part of what a
 * user meant to copy: KaTeX's glyph layout, icon glyphs, and the speaker labels
 * ("ChatGPT said:") the apps render for screen readers — the classic first line
 * of a pasted answer.
 */
const HIDDEN_CHROME_SELECTOR = '[aria-hidden="true"], .sr-only, .cdk-visually-hidden';

type AiChatSource = 'chatgpt' | 'gemini';

/**
 * Which app produced this clipboard, or null when it is not an AI chat app.
 * ChatGPT is checked first: its signature is the more specific of the two.
 */
function detectSource(wrapper: HTMLElement): AiChatSource | null {
  if (wrapper.querySelector(CHATGPT_SIGNATURE_SELECTOR) !== null) {
    return 'chatgpt';
  }

  if (wrapper.querySelector(GEMINI_SIGNATURE_SELECTOR) !== null) {
    return 'gemini';
  }

  return null;
}

/** Remove every element matching `selector`, subtree included. */
function removeElements(wrapper: HTMLElement, selector: string): void {
  wrapper.querySelectorAll(selector).forEach((el) => el.remove());
}

/**
 * Attributes and elements that carry a rendered equation's TeX source, in the
 * order they are looked for. ChatGPT (verified) puts it in `data-math-source`;
 * `data-math` and KaTeX's MathML `<annotation>` are the other two shapes a
 * KaTeX renderer can leave behind.
 */
const MATH_SOURCE_ATTRS = ['data-math-source', 'data-math'] as const;
const MATH_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';
const MATH_ATTR_SELECTOR = MATH_SOURCE_ATTRS.map((attr) => `[${attr}]`).join(', ');
const KATEX_SELECTOR = '.katex, .katex-display';

/**
 * Swap each rendered equation for a single `<span data-latex>`, the shape
 * Blok's equation inline tool whitelists.
 *
 * The visible half of a KaTeX render is hundreds of nested layout spans that
 * survive sanitization as bare `<span>`s and flatten into unreadable runs
 * ("x=a 2 ,"), so the subtree is replaced rather than annotated. Where a
 * renderer emits MathML too, the equation would otherwise arrive twice.
 */
function replaceMathWithLatex(wrapper: HTMLElement): void {
  // Attribute-carried sources first — they sit above the render they describe.
  wrapper
    .querySelectorAll(MATH_ATTR_SELECTOR)
    .forEach((node) => replaceWithLatex(node, texSourceOf(node)));

  // Whatever KaTeX render is left had no attribute source; read its MathML.
  // Only outermost ones: `.katex-display` wraps `.katex`.
  wrapper.querySelectorAll(KATEX_SELECTOR).forEach((katex) => {
    if (katex.parentElement?.closest(KATEX_SELECTOR) === null) {
      replaceWithLatex(katex, texSourceOf(katex));
    }
  });
}

/** The TeX behind a rendered equation, or null when none was preserved. */
function texSourceOf(node: Element): string | null {
  for (const attr of MATH_SOURCE_ATTRS) {
    const value = node.getAttribute(attr);

    if (value !== null && value.trim() !== '') {
      return value;
    }
  }

  return node.querySelector(MATH_ANNOTATION_SELECTOR)?.textContent?.trim() || null;
}

/**
 * Replace a rendered equation with its source. A render whose source was not
 * preserved is dropped: its glyph layout reads as noise, not as an equation.
 */
function replaceWithLatex(node: Element, latex: string | null): void {
  if (latex === null) {
    node.remove();

    return;
  }

  const equation = document.createElement('span');

  equation.setAttribute('data-latex', latex);
  equation.textContent = latex;

  node.replaceWith(equation);
}

/**
 * Drop ChatGPT's inline source citations. They copy as empty spans, so they
 * contribute nothing but fragment the surrounding text node.
 */
function removeCitationMarkers(wrapper: HTMLElement): void {
  removeElements(wrapper, '[data-content-reference-start], [data-content-reference-end]');
}

/**
 * Collapse a code editor rendered inside a `<pre>` down to `<pre><code>`.
 *
 * ChatGPT renders code as a read-only CodeMirror instance: an outer semantic
 * `<pre>` wrapping a dozen layout divs wrapping `<pre class="cm-content">`.
 * Both `<pre>`s survive sanitization, so the paste would otherwise produce a
 * duplicate code block. The inner one holds the text, including its newlines.
 */
function flattenEditorCodeBlocks(wrapper: HTMLElement): void {
  wrapper.querySelectorAll('pre').forEach((outer) => {
    const inner = outer.querySelector('pre');

    if (inner === null) {
      return;
    }

    setCodeContent(outer, inner.textContent ?? '');
  });
}

/**
 * Rewrite Gemini's `<code-block>` component into a plain `<pre><code>` that
 * carries its language.
 *
 * The language is printed as text in a sticky header next to the download and
 * copy buttons; that header survives sanitization, so without this the language
 * lands in the document as a stray line above the code instead of on the block.
 */
function rewriteGeminiCodeBlocks(wrapper: HTMLElement): void {
  wrapper.querySelectorAll('code-block').forEach((block) => {
    const pre = block.querySelector('pre');

    if (pre === null) {
      block.remove();

      return;
    }

    const language = block.querySelector('.code-block-decoration')?.textContent?.trim() ?? '';

    if (language !== '') {
      pre.setAttribute(CODE_LANGUAGE_ATTR, language.toLowerCase());
    }

    setCodeContent(pre, pre.textContent ?? '');
    block.replaceWith(pre);
  });
}

/** Replace an element's children with a single `<code>` holding `text`. */
function setCodeContent(pre: Element, text: string): void {
  const code = document.createElement('code');

  code.textContent = text;
  pre.replaceChildren(code);
}
