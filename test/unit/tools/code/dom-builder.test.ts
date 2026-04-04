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
    expect(result.languageButton).toBeInstanceOf(HTMLSpanElement);
    expect(result.copyButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.wrapButton).toBeInstanceOf(HTMLButtonElement);
    expect(result.preElement).toBeInstanceOf(HTMLPreElement);
    expect(result.codeElement).toBeInstanceOf(HTMLElement);
  });

  it('wrapper contains header and pre as direct children', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { wrapper, preElement, codeElement } = buildCodeDOM({
      code: '',
      languageName: 'Plain Text',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(wrapper.children).toHaveLength(2);
    // First child is the header, second is the <pre> wrapping the code element
    expect(wrapper.children[1]).toBe(preElement);
    expect(preElement.contains(codeElement)).toBe(true);
  });

  it('header contains languageButton, spacer, wrapButton, and copyButton', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { wrapper, languageButton, wrapButton, copyButton } = buildCodeDOM({
      code: '',
      languageName: 'Python',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    const header = wrapper.children[0];
    expect(header.children).toHaveLength(4);
    expect(header.children[0]).toBe(languageButton);
    // children[1] is the spacer
    expect(header.children[2]).toBe(wrapButton);
    expect(header.children[3]).toBe(copyButton);
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

    expect(codeElement.getAttribute('contenteditable')).toBe('true');
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

  it('language element is a span, not a button', async () => {
    const { buildCodeDOM } = await import('../../../../src/tools/code/dom-builder');
    const { languageButton } = buildCodeDOM({
      code: '',
      languageName: 'JavaScript',
      readOnly: false,
      copyLabel: 'Copy code',
      wrapLabel: 'Wrap lines',
    });

    expect(languageButton.tagName).toBe('SPAN');
  });
});
