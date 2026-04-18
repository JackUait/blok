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

function selectRange(el: HTMLElement, start: number, end: number): void {
  const textNode = el.firstChild;

  if (!textNode) {
    return;
  }
  const range = document.createRange();

  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretOffsetIn(el: HTMLElement): number {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return -1;
  }
  const range = selection.getRangeAt(0);
  const pre = range.cloneRange();

  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);

  return pre.toString().length;
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

describe('handleCodeKeydown — Enter auto-indent', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('preserves leading spaces of the current line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('    hello', 9);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('    hello\n    ');
    expect(caretOffsetIn(codeElement)).toBe(14);
  });

  it('preserves leading tab of the current line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('\thello', 6);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('\thello\n\t');
    expect(caretOffsetIn(codeElement)).toBe(8);
  });

  it('uses the indent of the line where the caret is, not line 1', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    // line 1: "no indent"
    // line 2: "    indented"  <- caret at end of this line
    const codeElement = setupCodeElement('no indent\n    indented', 22);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('no indent\n    indented\n    ');
    expect(caretOffsetIn(codeElement)).toBe(27);
  });

  it('does not add indent when current line has none', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('hello', 5);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('hello\n');
    expect(caretOffsetIn(codeElement)).toBe(6);
  });

  it('preserves indent when caret is in the middle of an indented line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    // "  hello world" — caret after "hello"
    const codeElement = setupCodeElement('  hello world', 7);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('  hello\n   world');
    expect(caretOffsetIn(codeElement)).toBe(10);
  });
});

describe('handleCodeKeydown — Enter bracket expansion', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('expands curly braces with caret on indented middle line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('{}', 1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe(`{\n${TAB_STRING}\n}`);
    expect(caretOffsetIn(codeElement)).toBe(2 + TAB_STRING.length);
  });

  it('expands parentheses', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('()', 1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe(`(\n${TAB_STRING}\n)`);
    expect(caretOffsetIn(codeElement)).toBe(2 + TAB_STRING.length);
  });

  it('expands square brackets', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('[]', 1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe(`[\n${TAB_STRING}\n]`);
    expect(caretOffsetIn(codeElement)).toBe(2 + TAB_STRING.length);
  });

  it('preserves outer indent when expanding brackets on an indented line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    // "  if (x) {}" — caret between { and }
    const codeElement = setupCodeElement('  if (x) {}', 10);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe(`  if (x) {\n  ${TAB_STRING}\n  }`);
    expect(caretOffsetIn(codeElement)).toBe(11 + 2 + TAB_STRING.length);
  });

  it('does not expand when char after caret is not the matching closer', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    // "{abc}" — caret after the opening "{" (offset 1)
    const codeElement = setupCodeElement('{abc}', 1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    // Falls through to "deeper indent after opener" rule
    expect(codeElement.textContent).toBe(`{\n${TAB_STRING}abc}`);
    expect(caretOffsetIn(codeElement)).toBe(2 + TAB_STRING.length);
  });

  it('does not expand when bracket types do not match (e.g. {] )', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('{]', 1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    // Deeper indent after opener applies; closer just stays where it was
    expect(codeElement.textContent).toBe(`{\n${TAB_STRING}]`);
  });
});

describe('handleCodeKeydown — Enter deeper indent after opener', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('adds one indent unit after a line ending with {', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    // "if (x) {" caret at end (offset 8)
    const codeElement = setupCodeElement('if (x) {', 8);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe(`if (x) {\n${TAB_STRING}`);
    expect(caretOffsetIn(codeElement)).toBe(9 + TAB_STRING.length);
  });

  it('combines existing indent with one extra unit', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    // "  fn(" caret at end (offset 5)
    const codeElement = setupCodeElement('  fn(', 5);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe(`  fn(\n  ${TAB_STRING}`);
    expect(caretOffsetIn(codeElement)).toBe(6 + 2 + TAB_STRING.length);
  });
});

describe('handleCodeKeydown — Enter with non-collapsed selection', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('replaces the selection with a newline', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('helloXXXworld');

    selectRange(codeElement, 5, 8); // select "XXX"
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('hello\nworld');
    expect(caretOffsetIn(codeElement)).toBe(6);
  });

  it('replaces selection AND preserves indent of the current line', async () => {
    const { handleCodeKeydown } = await import('../../../../src/tools/code/code-keyboard');
    const codeElement = setupCodeElement('  helloXXXworld');

    selectRange(codeElement, 7, 10); // select "XXX"
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    handleCodeKeydown(event, codeElement, vi.fn());

    expect(codeElement.textContent).toBe('  hello\n  world');
    expect(caretOffsetIn(codeElement)).toBe(10);
  });
});
