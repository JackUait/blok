import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { preprocessAiChatHtml } from '../../../../../src/components/modules/paste/ai-chat-preprocessor';
import { CODE_LANGUAGE_ATTR } from '../../../../../src/components/modules/paste/constants';

/**
 * Mutant-directed cases for `preprocessAiChatHtml`. Each one drives a decision
 * the behavioural suite reaches but never observes, so mutating that decision
 * changes the output.
 *
 * Seven mutants in this module are provably equivalent and are deliberately not
 * chased:
 *
 * 1. `detectSource` returning `'gemini'`. The caller compares the result only
 *    against `null` and `'chatgpt'`, and takes the Gemini branch for everything
 *    else, so any other non-null string routes identically.
 * 2-3. Both guards in the outermost-KaTeX loop — forcing the condition true, and
 *    dropping the `?.` on `katex.parentElement`. `querySelectorAll` yields
 *    ancestors before descendants, and `remove()`/`replaceWith()` detach only
 *    the node they are called on. So (a) every element the guard skips has an
 *    ancestor that was already replaced or removed, which detached the whole
 *    subtree — processing it anyway edits an orphan and cannot reach
 *    `wrapper.innerHTML`; and (b) no element in the list ever has a null
 *    `parentElement`, because the only node a pass detaches is the one being
 *    visited, and it is visited once. The nested-KaTeX case below exercises the
 *    skip branch and shows the output is the same either way.
 * 4-7. Four `Element.textContent` fallbacks: the second `?.` in the annotation
 *    chain and in the code-language chain, and the `?? ''` defaults in both
 *    `setCodeContent` calls. `textContent` is nullable only on Document and
 *    DocumentType nodes; on an Element it is always a string, so none of those
 *    right-hand sides is reachable.
 */

/** Re-parse output into a live tree so structure can be asserted, not matched. */
const parse = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

/** Assert-and-narrow, so a missing node fails loudly instead of via `?.`. */
const requireElement = (root: HTMLElement, selector: string): Element => {
  const found = root.querySelector(selector);

  if (found === null) {
    throw new Error(`expected the output to contain ${selector}`);
  }

  return found;
};

describe('preprocessAiChatHtml — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a clipboard from neither app is handed back untouched', () => {
    it('returns the caller string, not the re-serialized parse', () => {
      // Single quotes stay single quotes: re-serializing would hand the rest of
      // the paste pipeline a rewritten payload for every non-AI source.
      const html = "<p class='x'>hi</p>";

      expect(preprocessAiChatHtml(html)).toBe(html);
    });

    it('does not apply the Gemini chrome sweep to it', () => {
      // <button> is Gemini chrome. In a foreign clipboard it is content.
      const html = '<p>hi</p><button>Send</button>';

      expect(preprocessAiChatHtml(html)).toBe(html);
    });
  });

  describe('picking the TeX source out of the candidate attributes', () => {
    it('skips a blank attribute and falls through to the next one', () => {
      const html = '<span data-math-source="   " data-math="a^2">rendered</span>';
      const equation = requireElement(parse(preprocessAiChatHtml(html)), '[data-latex]');

      expect(equation.getAttribute('data-latex')).toBe('a^2');
    });

    it('trims the TeX read out of a MathML annotation', () => {
      const html =
        '<p data-start="0" data-end="3"><span class="katex"><span class="katex-mathml">' +
        '<math><semantics><annotation encoding="application/x-tex">  a^2  </annotation>' +
        '</semantics></math></span></span></p>';
      const equation = requireElement(parse(preprocessAiChatHtml(html)), '[data-latex]');

      expect(equation.getAttribute('data-latex')).toBe('a^2');
    });
  });

  describe('a rendered equation whose source was not preserved', () => {
    it('drops the render instead of keeping it or emitting an empty equation', () => {
      const html =
        '<p data-start="0" data-end="3">Let <span class="katex">' +
        '<span class="katex-html" aria-hidden="true">a2</span></span></p>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelectorAll('.katex')).toHaveLength(0);
      expect(root.querySelector('[data-latex]')).toBeNull();
      expect(root.textContent).toBe('Let ');
    });
  });

  describe('nested KaTeX renders', () => {
    it('emits one equation for a display wrapper around an inline render', () => {
      const html =
        '<p data-start="0" data-end="3"><span class="katex-display"><span class="katex">' +
        '<math><semantics><annotation encoding="application/x-tex">a^2</annotation>' +
        '</semantics></math></span></span></p>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelectorAll('[data-latex]')).toHaveLength(1);
      expect(root.textContent).toBe('a^2');
    });
  });

  describe('a Gemini code-block component with no code in it', () => {
    it('drops the component instead of working on a missing pre', () => {
      const html =
        '<div data-path-to-node="0"><code-block>orphan chrome</code-block><p>after</p></div>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelectorAll('code-block')).toHaveLength(0);
      expect(root.textContent).toBe('after');
    });
  });

  describe('a Gemini code-block with no language header', () => {
    it('leaves the language attribute off rather than stamping an empty one', () => {
      const html = '<div data-path-to-node="0"><code-block><pre>SELECT 1</pre></code-block></div>';
      const root = parse(preprocessAiChatHtml(html));
      const pre = requireElement(root, 'pre');

      expect(pre.getAttribute(CODE_LANGUAGE_ATTR)).toBeNull();
      expect(root.querySelectorAll('code-block')).toHaveLength(0);
      expect(pre.textContent).toBe('SELECT 1');
    });
  });

  describe('a Gemini code-block whose header label carries padding', () => {
    it('trims the label before lowercasing it onto the pre', () => {
      const html =
        '<div data-path-to-node="0"><code-block>' +
        '<div class="code-block-decoration">  SQL  </div><pre>SELECT 1</pre>' +
        '</code-block></div>';
      const root = parse(preprocessAiChatHtml(html));

      expect(requireElement(root, 'pre').getAttribute(CODE_LANGUAGE_ATTR)).toBe('sql');
      expect(root.textContent).toBe('SELECT 1');
    });
  });
});
