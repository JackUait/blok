// test/unit/tools/code/dom-builder.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('buildCodeDOM', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns wrapper, languageButton, copyButton, wrapButton, preElement, and codeElement', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const result = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(result.wrapper).toBeInstanceOf(HTMLElement);
    expect(result.languageButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.copyButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.wrapButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.preElement).toBeInstanceOf(HTMLPreElement);
    expect(result.codeElement).toBeInstanceOf(HTMLElement);
  });

  it('wrapper contains header and code body as direct children', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { wrapper, preElement, codeElement, gutterElement } = buildCodeDOM({
      code: '',
      languageName: 'Plain Text',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(wrapper.children).toHaveLength(2);
    // First child is the header, second is the code body (gutter + pre)
    const codeBody = wrapper.children[1];
    expect(codeBody.contains(gutterElement)).toBe(true);
    expect(codeBody.contains(preElement)).toBe(true);
    expect(preElement.contains(codeElement)).toBe(true);
  });

  it('header contains languageButton, spacer, lineNumbersButton, wrapButton, and copyButton', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { wrapper, languageButton, lineNumbersButton, wrapButton, copyButton } = buildCodeDOM({
      code: '',
      languageName: 'Python',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    const header = wrapper.children[0];
    expect(header.children).toHaveLength(5);
    expect(header.children[0]).toBe(languageButton);
    // children[1] is the spacer
    expect(header.children[2]).toBe(lineNumbersButton);
    expect(header.children[3]).toBe(wrapButton);
    expect(header.children[4]).toBe(copyButton);
  });

  it('language button displays the language name', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'TypeScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(languageButton.textContent).toBe('TypeScript');
  });

  it('code element renders initial code text', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: 'console.log("hello");',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(codeElement.textContent).toBe('console.log("hello");');
  });

  it('code element is empty when code is empty string', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(codeElement.textContent).toBe('');
  });

  it('code element is contentEditable when not readOnly', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(codeElement.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(codeElement.getAttribute('spellcheck')).toBe('false');
  });

  it('code element is not contentEditable in readOnly mode', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: 'const x = 1;',
      languageName: 'JavaScript',
      readOnly: true,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(codeElement.getAttribute('contenteditable')).toBeNull();
    expect(codeElement.getAttribute('spellcheck')).toBeNull();
  });

  it('copy button has aria-label from copyLabel option', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { copyButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(copyButton.getAttribute('aria-label')).toBe('Copy code');
  });

  it('wrap button has aria-label from wrapLabel option', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { wrapButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(wrapButton.getAttribute('aria-label')).toBe('Wrap lines');
  });

  it('all interactive elements have data-blok-testid attributes', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton, copyButton, wrapButton, codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(languageButton.getAttribute('data-blok-testid')).toBe('code-language-btn');
    expect(copyButton.getAttribute('data-blok-testid')).toBe('code-copy-btn');
    expect(wrapButton.getAttribute('data-blok-testid')).toBe('code-wrap-btn');
    expect(codeElement.getAttribute('data-blok-testid')).toBe('code-content');
  });

  it('code element is a <code> tag', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(codeElement.tagName).toBe('CODE');
  });

  it('code element is wrapped in a <pre> tag', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { preElement, codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(preElement.tagName).toBe('PRE');
    expect(codeElement.parentElement).toBe(preElement);
  });

  it('actual buttons have type="button"', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { copyButton, wrapButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(copyButton.type).toBe('button');
    expect(wrapButton.type).toBe('button');
  });

  it('language element is a button', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(languageButton.tagName).toBe('BUTTON');
    expect(languageButton.type).toBe('button');
  });

  it('language button has aria-haspopup for accessibility', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(languageButton.getAttribute('aria-haspopup')).toBe('listbox');
  });

  describe('preview support', () => {
    it('includes tab buttons when previewable is true', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'E = mc^2',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
        previewable: true,
        codeTabLabel: 'Code',
        previewTabLabel: 'Preview',
      });

      expect(result.codeTab).toBeInstanceOf(HTMLButtonElement);
      expect(result.previewTab).toBeInstanceOf(HTMLButtonElement);
      expect(result.codeTab!.textContent).toBe('Code');
      expect(result.previewTab!.textContent).toBe('Preview');
    });

    it('includes preview container when previewable is true', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'E = mc^2',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
        previewable: true,
        codeTabLabel: 'Code',
        previewTabLabel: 'Preview',
      });

      expect(result.previewElement).toBeInstanceOf(HTMLDivElement);
      expect(result.previewElement!.getAttribute('data-blok-testid')).toBe('code-preview');
    });

    it('does not include tab buttons when previewable is false', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'const x = 1;',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
        previewable: false,
        codeTabLabel: 'Code',
        previewTabLabel: 'Preview',
      });

      expect(result.codeTab).toBeNull();
      expect(result.previewTab).toBeNull();
      expect(result.previewElement).toBeNull();
    });

    it('does not include tab buttons when previewable is omitted', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'const x = 1;',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(result.codeTab).toBeNull();
      expect(result.previewTab).toBeNull();
      expect(result.previewElement).toBeNull();
    });

    it('tab buttons have data-blok-testid attributes', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: '',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
        previewable: true,
        codeTabLabel: 'Code',
        previewTabLabel: 'Preview',
      });

      expect(result.codeTab!.getAttribute('data-blok-testid')).toBe('code-code-tab');
      expect(result.previewTab!.getAttribute('data-blok-testid')).toBe('code-preview-tab');
    });

    it('tab buttons are in the header between spacer and wrap button', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { wrapper, codeTab, wrapButton } = buildCodeDOM({
        code: '',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
        previewable: true,
        codeTabLabel: 'Code',
        previewTabLabel: 'Preview',
      });

      const header = wrapper.children[0];
      const children = Array.from(header.children);
      const codeTabIndex = children.indexOf(codeTab!);
      const wrapIndex = children.indexOf(wrapButton);

      expect(codeTabIndex).toBeGreaterThan(1); // after language + spacer
      expect(codeTabIndex).toBeLessThan(wrapIndex);
    });
  });

  describe('line numbers gutter', () => {
    it('returns gutterElement in CodeDOMRefs', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'line 1\nline 2\nline 3',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(result.gutterElement).toBeInstanceOf(HTMLElement);
    });

    it('gutter element has aria-hidden for accessibility', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { gutterElement } = buildCodeDOM({
        code: 'line 1',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(gutterElement.getAttribute('aria-hidden')).toBe('true');
    });

    it('gutter element has data-blok-testid', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { gutterElement } = buildCodeDOM({
        code: '',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(gutterElement.getAttribute('data-blok-testid')).toBe('code-gutter');
    });

    it('gutter and pre are wrapped in a flex container', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { gutterElement, preElement } = buildCodeDOM({
        code: 'hello',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      // Both share the same parent (the code body flex container)
      expect(gutterElement.parentElement).toBe(preElement.parentElement);
      expect(gutterElement.parentElement).not.toBeNull();
    });

    it('gutter is the first child and pre is the second child of code body', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { gutterElement, preElement } = buildCodeDOM({
        code: 'hello',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      const codeBody = gutterElement.parentElement!;
      expect(codeBody.children[0]).toBe(gutterElement);
      expect(codeBody.children[1]).toBe(preElement);
    });

    it('gutter renders one child div per line of code', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { gutterElement } = buildCodeDOM({
        code: 'a\nb\nc',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(gutterElement.children).toHaveLength(3);
      expect(gutterElement.children[0].textContent).toBe('1');
      expect(gutterElement.children[1].textContent).toBe('2');
      expect(gutterElement.children[2].textContent).toBe('3');
    });

    it('gutter renders one line for empty code', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { gutterElement } = buildCodeDOM({
        code: '',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(gutterElement.children).toHaveLength(1);
      expect(gutterElement.children[0].textContent).toBe('1');
    });

    it('gutter renders 7 lines for the Maxwell equations LaTeX demo', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');

      // The LaTeX demo in index.html must have 7 logical lines so that
      // each visual row gets its own line number (no confusing wrapping).
      const latexCode = [
        '\\begin{aligned}',
        '  e^{i\\pi} + 1 &= 0 \\\\',
        '  x &= \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\\\',
        '  \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\',
        '  \\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0',
        '    \\frac{\\partial \\mathbf{E}}{\\partial t}',
        '\\end{aligned}',
      ].join('\n');

      const { gutterElement } = buildCodeDOM({
        code: latexCode,
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      expect(gutterElement.children).toHaveLength(7);
      expect(gutterElement.children[6].textContent).toBe('7');
    });

    it('wrapper has header and code body as direct children (no longer header + pre)', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { wrapper, gutterElement } = buildCodeDOM({
        code: 'hello',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        wrapLabel: 'Wrap lines',
      });

      // wrapper has: header, codeBody (which contains gutter + pre)
      expect(wrapper.children).toHaveLength(2);
      // Second child should be the code body container, not directly the pre
      expect(wrapper.children[1]).toBe(gutterElement.parentElement);
    });
  });
});
