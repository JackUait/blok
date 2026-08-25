import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { preprocessAiChatHtml } from '../../../../../src/components/modules/paste/ai-chat-preprocessor';
import { CODE_LANGUAGE_ATTR, SAFE_STRUCTURAL_TAGS } from '../../../../../src/components/modules/paste/constants';
import { clean } from '../../../../../src/components/utils/sanitizer';
import { CodeTool } from '../../../../../src/tools/code';
import { EquationInlineTool } from '../../../../../src/components/inline-tools/inline-tool-equation';

const fixture = (name: string): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/ai-chat', name),
    'utf8'
  );

const parse = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

describe('preprocessAiChatHtml', () => {
  describe('no-op safety', () => {
    /**
     * Mirrors preprocessNotionHtml: foreign clipboards must come back as the
     * identical string, so chaining this preprocessor cannot perturb any
     * other source's payload.
     */
    it.each([
      ['plain paragraph', '<p>hello world</p>'],
      ['google docs', '<b id="docs-internal-guid-x"><p dir="ltr"><span>text</span></p></b>'],
      ['notion', '<ul class="bulleted-list"><li>item</li></ul>'],
      ['browser span', '<span style="color: rgb(0,0,0)">copied</span>'],
      ['bare table', '<table><tbody><tr><td>a</td></tr></tbody></table>'],
    ])('returns %s unchanged', (_label, html) => {
      expect(preprocessAiChatHtml(html)).toBe(html);
    });
  });

  describe('ChatGPT — math', () => {
    const html = fixture('chatgpt-math.html');

    it('replaces each KaTeX subtree with a single span carrying the LaTeX source', () => {
      /**
       * ChatGPT ships the original LaTeX in data-math-source next to KaTeX's
       * aria-hidden visual layout. The layout is hundreds of nested spans that
       * sanitize down to unreadable text ("x=a 2 ,"), so the whole subtree has
       * to be replaced — stamping the attribute alone keeps the soup inside.
       */
      const root = parse(preprocessAiChatHtml(html));
      const equations = root.querySelectorAll('span[data-latex]');

      expect(equations.length).toBeGreaterThan(0);
      expect(root.querySelectorAll('[data-math-source]')).toHaveLength(0);
      expect(root.innerHTML).not.toContain('katex');

      equations.forEach((eq) => {
        expect(eq.getAttribute('data-latex')).not.toBe('');
        expect(eq.children).toHaveLength(0);
      });
    });

    it('preserves the LaTeX source verbatim, including backslash commands', () => {
      const root = parse(preprocessAiChatHtml(html));
      const latex = Array.from(root.querySelectorAll('span[data-latex]')).map((el) =>
        el.getAttribute('data-latex')
      );

      expect(latex).toContain('x = a^2,');
      expect(latex).toContain('y = \\left(\\frac{a^2 - 1}{2}\\right)^2.');
    });

    it('collapses the span explosion instead of leaking layout spans', () => {
      const before = parse(html).querySelectorAll('span').length;
      const after = parse(preprocessAiChatHtml(html)).querySelectorAll('span').length;

      expect(before).toBeGreaterThan(500);
      expect(after).toBeLessThan(before / 10);
    });
  });

  describe('ChatGPT — chrome that must not become content', () => {
    it('drops aria-hidden subtrees such as the external-link icon', () => {
      const html =
        '<p data-start="0" data-end="9">See <a data-start="4" data-end="8" href="https://x.dev">x.dev' +
        '<span aria-hidden="true"><svg><use href="#icon"></use></svg></span></a></p>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelector('a')?.textContent).toBe('x.dev');
      expect(root.querySelectorAll('svg')).toHaveLength(0);
    });

    it('drops the empty inline citation spans', () => {
      const html =
        '<p data-start="0" data-end="5">Sources: Nasdaq' +
        '<span class="contents" data-content-reference-start="10" data-content-reference-end="20">' +
        '<span data-state="closed"></span></span>.</p>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelectorAll('[data-content-reference-start]')).toHaveLength(0);
      expect(root.textContent).toBe('Sources: Nasdaq.');
    });
  });

  describe('ChatGPT — code blocks', () => {
    const html = fixture('chatgpt-code-tables.html');

    it('flattens the CodeMirror pre-inside-pre into one pre per code block', () => {
      /**
       * ChatGPT renders code as a read-only CodeMirror editor: an outer
       * semantic <pre> wrapping ~12 divs wrapping <pre class="cm-content">.
       * Both survive sanitization, so the paste yields a duplicated block.
       */
      const before = parse(html).querySelectorAll('pre').length;
      const root = parse(preprocessAiChatHtml(html));
      const pres = root.querySelectorAll('pre');

      expect(before).toBe(2);
      expect(pres).toHaveLength(1);
      expect(pres[0].querySelector('pre')).toBeNull();
    });

    it('keeps the code text and its line breaks intact', () => {
      const root = parse(preprocessAiChatHtml(html));
      const code = root.querySelector('pre')?.textContent ?? '';

      expect(code).toContain(':0F00000048656C6C6F2C20776F726C64210A005E');
      expect(code).toContain('\n:00000001FF');
    });
  });

  describe('Gemini — code blocks', () => {
    const html = fixture('gemini-response.html');

    it('moves the header language label onto the pre instead of leaving it as text', () => {
      /**
       * Gemini prints the language in a header <span> next to the download and
       * copy buttons. The span survives sanitization, so today the word "SQL"
       * lands in the document as a stray line above the code.
       */
      const root = parse(preprocessAiChatHtml(html));
      const pre = root.querySelector('pre');

      expect(pre?.getAttribute('data-blok-code-language')).toBe('sql');
      expect(root.textContent).not.toMatch(/\bSQL\b/);
    });

    it('removes the copy and download button chrome', () => {
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelectorAll('gem-icon-button')).toHaveLength(0);
      expect(root.querySelectorAll('button')).toHaveLength(0);
      expect(root.querySelectorAll('gem-icon')).toHaveLength(0);
    });

    it('keeps the code content', () => {
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelector('pre')?.textContent).toContain('SELECT');
      expect(root.querySelector('pre')?.textContent).toContain('FROM orders');
    });

    it('keeps the response table', () => {
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelectorAll('table').length).toBeGreaterThan(0);
      expect(root.querySelectorAll('td').length).toBeGreaterThan(0);
    });
  });

  describe('screen-reader and toolbar chrome', () => {
    it('drops the visually hidden speaker label', () => {
      /**
       * Selecting a whole turn picks up the label the apps render for screen
       * readers, which is why "ChatGPT said:" is the classic first line of a
       * pasted answer. Not present in the captured fixtures — those select the
       * message body alone — so this is guarded by construction, not capture.
       */
      const html =
        '<div><h6 class="sr-only">ChatGPT said:</h6>' +
        '<p data-start="0" data-end="5">Hello</p></div>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.textContent).toBe('Hello');
    });

    it('drops nodes Gemini itself marks as excluded from a copy', () => {
      const html =
        '<div data-path-to-node="0"><p>Answer</p>' +
        '<div hide-from-message-actions="" class="footer">Use code with caution.</div></div>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.textContent).toBe('Answer');
    });
  });

  describe('math sources other than ChatGPT\'s', () => {
    it('recovers TeX from a KaTeX MathML annotation', () => {
      /**
       * KaTeX in `htmlAndMathml` mode keeps the source in an annotation node
       * beside the aria-hidden layout. Selecting it yields the equation twice —
       * once as MathML text, once as glyph soup.
       */
      const html =
        '<p data-start="0" data-end="3">Let <span class="katex"><span class="katex-mathml">' +
        '<math><semantics><annotation encoding="application/x-tex">a^2</annotation>' +
        '</semantics></math></span><span class="katex-html" aria-hidden="true">a2</span></span></p>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('a^2');
      expect(root.textContent).toBe('Let a^2');
    });

    it('recovers TeX from a data-math attribute', () => {
      const html =
        '<div data-path-to-node="0"><div class="math-block" data-math="E = mc^2">' +
        '<span class="katex-html" aria-hidden="true">E=mc2</span></div></div>';
      const root = parse(preprocessAiChatHtml(html));

      expect(root.querySelector('[data-latex]')?.getAttribute('data-latex')).toBe('E = mc^2');
      expect(root.textContent).toBe('E = mc^2');
    });
  });

  describe('survives the real sanitizer', () => {
    /**
     * The whole-document pass Paste runs before any tool sees the content. Only
     * the tags and attributes composed in here live through it, so a rewrite
     * that lands outside this set is the same as no rewrite at all.
     */
    const pass1 = (html: string): string =>
      clean(html, {
        ...Object.fromEntries([...SAFE_STRUCTURAL_TAGS].map((tag) => [tag, {}])),
        ...(CodeTool.pasteConfig as { tags: Record<string, unknown>[] }).tags.reduce(
          (acc, tag) => ({ ...acc, ...lowercaseKeys(tag) }),
          {}
        ),
        ...EquationInlineTool.sanitize,
        p: {}, h3: {}, hr: {}, code: {}, strong: {}, br: {},
      });

    const lowercaseKeys = (tag: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(tag).map(([k, v]) => [k.toLowerCase(), v]));

    it('keeps the recovered LaTeX', () => {
      const cleaned = pass1(preprocessAiChatHtml(fixture('chatgpt-math.html')));

      expect(cleaned).toContain('data-latex=');
      expect(cleaned).toContain('x = a^2,');
    });

    it('keeps the recovered code language', () => {
      const cleaned = pass1(preprocessAiChatHtml(fixture('gemini-response.html')));

      expect(cleaned).toContain(`${CODE_LANGUAGE_ATTR}="sql"`);
    });

    it('leaves no KaTeX layout spans behind to flatten into text', () => {
      const before = pass1(fixture('chatgpt-math.html'));
      const after = pass1(preprocessAiChatHtml(fixture('chatgpt-math.html')));

      expect(before).toContain('<span><span>');
      expect(after).not.toContain('<span><span>');
      expect(after.length).toBeLessThan(before.length / 5);
    });
  });
});
