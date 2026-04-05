// test/unit/tools/code/code-keyboard.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TAB_STRING } from '../../../../src/tools/code/constants';

/**
 * Helper: create a code element with text content and place the caret at a given offset.
 */
function setupCodeElement(text: string, caretOffset?: number): HTMLElement {
  const el = document.createElement('code');
  el.contentEditable = 'true';
  document.body.appendChild(el);

  if (text) {
    el.textContent = text;
  }

  if (caretOffset !== undefined) {
    const range = document.createRange();
    const textNode = el.firstChild;
    if (textNode) {
      range.setStart(textNode, caretOffset);
      range.collapse(true);
    } else {
      range.setStart(el, 0);
      range.collapse(true);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return el;
}

describe('handleCodeKeydown', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('calls onExit and returns true for Shift+Enter', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello');
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });

    const handled = handleCodeKeydown(event, codeElement, onExit);

    expect(handled).toBe(true);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('inserts a newline for Enter (no shift) and returns true', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('line1', 5);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    const handled = handleCodeKeydown(event, codeElement, onExit);

    expect(handled).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    expect(codeElement.textContent).toContain('\n');
  });

  it('inserts a tab (2 spaces) for Tab and returns true', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello', 5);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Tab' });

    const handled = handleCodeKeydown(event, codeElement, onExit);

    expect(handled).toBe(true);
    expect(codeElement.textContent).toBe('hello' + TAB_STRING);
  });

  it('removes leading spaces for Shift+Tab and returns true', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const text = TAB_STRING + 'hello';
    const codeElement = setupCodeElement(text, TAB_STRING.length);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });

    const handled = handleCodeKeydown(event, codeElement, onExit);

    expect(handled).toBe(true);
    expect(codeElement.textContent).toBe('hello');
  });

  it('returns false for unhandled keys', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello', 0);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'a' });

    const handled = handleCodeKeydown(event, codeElement, onExit);

    expect(handled).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Shift+Tab does nothing when no leading spaces on line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello', 0);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });

    const handled = handleCodeKeydown(event, codeElement, onExit);

    expect(handled).toBe(true);
    expect(codeElement.textContent).toBe('hello');
  });

  it('Tab inserts at caret position in the middle of text', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('ab', 1);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Tab' });

    handleCodeKeydown(event, codeElement, onExit);

    expect(codeElement.textContent).toBe('a' + TAB_STRING + 'b');
  });

  it('Enter inserts newline at caret position', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('ab', 1);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, onExit);

    expect(codeElement.textContent).toBe('a\nb');
  });

  it('Enter at end of line places caret on the new line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello', 5);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, onExit);

    expect(codeElement.textContent).toBe('hello\n');

    // Caret should be at offset 6 (after the newline)
    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(codeElement);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const caretOffset = preCaretRange.toString().length;

    expect(caretOffset).toBe(6);
  });

  it('Enter at end places caret in a usable text node, not after a trailing newline node', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello', 5);
    const onExit = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, onExit);

    // The caret's container should be a text node (not the element itself)
    // so the browser can render the cursor on the new visual line
    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0);

    expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE);
  });
});
