// test/unit/tools/code/dom-builder.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('buildCodeDOM', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns wrapper, languageButton, copyButton, preElement, and codeElement', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const result = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
    });

    expect(result.wrapper).toBeInstanceOf(HTMLElement);
    expect(result.languageButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.copyButton).toBeInstanceOf(HTMLButtonElement);
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
    });

    expect(wrapper.children).toHaveLength(2);
    // First child is the header, second is the code body (gutter + pre)
    const codeBody = wrapper.children[1];
    expect(codeBody.contains(gutterElement)).toBe(true);
    expect(codeBody.contains(preElement)).toBe(true);
    expect(preElement.contains(codeElement)).toBe(true);
  });

  it('header contains languageButton, spacer, and controls container', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { wrapper, languageButton } = buildCodeDOM({
      code: '',
      languageName: 'Python',
      readOnly: false,
      copyLabel: 'Copy code',
    });

    const header = wrapper.children[0];
    // [language] [spacer] [controls]
    expect(header.children).toHaveLength(3);
    expect(header.children[0]).toBe(languageButton);
  });

  it('language button displays the language name in a text span', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'TypeScript',
      readOnly: false,
      copyLabel: 'Copy code',
    });

    // Language name is in the first span child
    expect(languageButton.querySelector('span')!.textContent).toBe('TypeScript');
  });

  it('language button contains a chevron-down SVG icon', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'TypeScript',
      readOnly: false,
      copyLabel: 'Copy code',
    });

    expect(languageButton.querySelector('svg')).toBeTruthy();
  });

  it('code element renders initial code text', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: 'console.log("hello");',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
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
    });

    expect(copyButton.getAttribute('aria-label')).toBe('Copy code');
  });

  it('all interactive elements have data-blok-testid attributes', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton, copyButton, codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
    });

    expect(languageButton.getAttribute('data-blok-testid')).toBe('code-language-btn');
    expect(copyButton.getAttribute('data-blok-testid')).toBe('code-copy-btn');
    expect(codeElement.getAttribute('data-blok-testid')).toBe('code-content');
  });

  it('code element is a <code> tag', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { codeElement } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
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
    });

    expect(preElement.tagName).toBe('PRE');
    expect(codeElement.parentElement).toBe(preElement);
  });

  it('copy button has type="button"', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { copyButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
    });

    expect(copyButton.type).toBe('button');
  });

  it('language element is a button', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
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
    });

    expect(languageButton.getAttribute('aria-haspopup')).toBe('listbox');
  });

  describe('preview support', () => {
    it('includes preview toggle button when previewable is true', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'E = mc^2',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        previewable: true,
        previewToggleLabel: 'Preview',
      });

      expect(result.previewToggleButton).toBeInstanceOf(HTMLButtonElement);
      expect(result.previewToggleButton!.getAttribute('data-blok-testid')).toBe('code-preview-toggle-btn');
    });

    it('includes preview container when previewable is true', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'E = mc^2',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        previewable: true,
        previewToggleLabel: 'Preview',
      });

      expect(result.previewElement).toBeInstanceOf(HTMLDivElement);
      expect(result.previewElement!.getAttribute('data-blok-testid')).toBe('code-preview');
    });

    it('does not include preview toggle when previewable is false', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'const x = 1;',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
        previewable: false,
      });

      expect(result.previewToggleButton).toBeNull();
      expect(result.previewElement).toBeNull();
    });

    it('does not include preview toggle when previewable is omitted', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const result = buildCodeDOM({
        code: 'const x = 1;',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
      });

      expect(result.previewToggleButton).toBeNull();
      expect(result.previewElement).toBeNull();
    });

    it('preview toggle button is in the controls before copy button', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { wrapper, previewToggleButton, copyButton } = buildCodeDOM({
        code: '',
        languageName: 'LaTeX',
        readOnly: false,
        copyLabel: 'Copy code',
        previewable: true,
        previewToggleLabel: 'Preview',
      });

      const header = wrapper.children[0];
      // Controls container is the last child of header
      const controls = header.children[2];
      const children = Array.from(controls.children);
      const toggleIndex = children.indexOf(previewToggleButton!);
      const copyIndex = children.indexOf(copyButton);

      expect(toggleIndex).toBeGreaterThanOrEqual(0);
      expect(toggleIndex).toBeLessThan(copyIndex);
    });
  });

  describe('wrapper container styling', () => {
    it('wrapper has a visible border class for the rounded container', async () => {
      const { WRAPPER_STYLES } = await import('../../../../src/tools/code/constants');

      expect(WRAPPER_STYLES).toContain('border');
      expect(WRAPPER_STYLES).toContain('border-border-secondary');
    });

    it('wrapper has a background color class', async () => {
      const { WRAPPER_STYLES } = await import('../../../../src/tools/code/constants');

      expect(WRAPPER_STYLES).toContain('bg-bg-secondary');
    });

    it('wrapper has rounded corners and overflow hidden', async () => {
      const { WRAPPER_STYLES } = await import('../../../../src/tools/code/constants');

      expect(WRAPPER_STYLES).toContain('rounded-xl');
      expect(WRAPPER_STYLES).toContain('overflow-hidden');
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
      });

      expect(gutterElement.children).toHaveLength(7);
      expect(gutterElement.children[6].textContent).toBe('7');
    });

    it('wrapper has header and code body as direct children', async () => {
      const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
      const { wrapper, gutterElement } = buildCodeDOM({
        code: 'hello',
        languageName: 'JavaScript',
        readOnly: false,
        copyLabel: 'Copy code',
      });

      // wrapper has: header, codeBody (which contains gutter + pre)
      expect(wrapper.children).toHaveLength(2);
      // Second child should be the code body container, not directly the pre
      expect(wrapper.children[1]).toBe(gutterElement.parentElement);
    });
  });
});
