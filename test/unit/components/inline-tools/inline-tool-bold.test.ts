import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

type BoldInlineToolInternals = {
  shortcutListenerRegistered: boolean;
  selectionListenerRegistered: boolean;
  inputListenerRegistered: boolean;
  instances: Set<unknown>;
  handleShortcut: EventListener;
  handleGlobalSelectionChange: EventListener;
  handleGlobalInput: EventListener;
};

const getInternals = (): BoldInlineToolInternals => {
  return BoldInlineTool as unknown as BoldInlineToolInternals;
};

const clearSelection = (): void => {
  const selection = window.getSelection();

  selection?.removeAllRanges();
};

const resetBoldInlineTool = (): void => {
  const internals = getInternals();

  document.removeEventListener('keydown', internals.handleShortcut, true);
  document.removeEventListener('selectionchange', internals.handleGlobalSelectionChange, true);
  document.removeEventListener('input', internals.handleGlobalInput, true);

  internals.shortcutListenerRegistered = false;
  internals.selectionListenerRegistered = false;
  internals.inputListenerRegistered = false;
  internals.instances.clear();
};

const setupBlok = (html: string): { block: HTMLElement } => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'blok-wrapper');

  const block = document.createElement('div');

  block.setAttribute('data-blok-component', 'paragraph');
  block.contentEditable = 'true';
  block.innerHTML = html;
  wrapper.appendChild(block);

  const toolbar = document.createElement('div');

  toolbar.setAttribute('data-blok-testid', 'inline-toolbar');

  const button = document.createElement('button');

  button.setAttribute('data-blok-item-name', 'bold');
  toolbar.appendChild(button);
  wrapper.appendChild(toolbar);

  document.body.appendChild(wrapper);

  return { block };
};

const setRange = (node: Text, start: number, end?: number): void => {
  const selection = window.getSelection();
  const range = document.createRange();

  range.setStart(node, start);

  if (typeof end === 'number') {
    range.setEnd(node, end);
  } else {
    range.collapse(true);
  }

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('BoldInlineTool', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearSelection();
    resetBoldInlineTool();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    clearSelection();
    resetBoldInlineTool();
  });

  it('describes the tool metadata', () => {
    expect(BoldInlineTool.isInline).toBe(true);
    expect(BoldInlineTool.title).toBe('Bold');
    expect(BoldInlineTool.sanitize).toEqual({
      strong: {},
      b: {},
    });

    expect(BoldInlineTool.shortcut).toBe('CMD+B');
  });

  it('wraps selected text and reports bold state', () => {
    const { block } = setupBlok('Hello world');
    const textNode = block.firstChild as Text;

    setRange(textNode, 0, 5);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    const strong = block.querySelector('strong');

    expect(strong?.textContent).toBe('Hello');
    expect(typeof menu.isActive === 'function' ? menu.isActive() : menu.isActive).toBe(true);
  });

  it('unwraps existing bold text when toggled again', () => {
    const { block } = setupBlok('<strong>Hello</strong> world');
    const strong = block.querySelector('strong');

    expect(strong).not.toBeNull();

    const textNode = strong?.firstChild as Text;

    setRange(textNode, 0, textNode.textContent?.length ?? 0);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    expect(block.querySelector('strong')).toBeNull();
    expect(typeof menu.isActive === 'function' ? menu.isActive() : menu.isActive).toBe(false);
  });

  it('starts a collapsed bold segment when caret is not inside bold', () => {
    const { block } = setupBlok('Hello');
    const textNode = block.firstChild as Text;

    setRange(textNode, 0);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    const strong = block.querySelector('strong');

    expect(strong).not.toBeNull();
    expect(strong?.getAttribute('data-blok-bold-collapsed-active')).toBe('true');
    expect(typeof menu.isActive === 'function' ? menu.isActive() : menu.isActive).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(strong?.firstChild ?? null);
  });

  it('preserves trailing space when wrapping selected text that ends with a space', () => {
    const { block } = setupBlok('text ');
    const textNode = block.firstChild as Text;

    // Select all 5 characters: 't', 'e', 'x', 't', ' '
    setRange(textNode, 0, 5);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    const strong = block.querySelector('strong');

    expect(strong?.textContent).toBe('text ');
  });

  it('converts trailing nbsp to regular space after bold normalization', () => {
    const { block } = setupBlok('text\u00A0');
    const textNode = block.firstChild as Text;

    // Select all 5 characters including the trailing \u00A0
    setRange(textNode, 0, 5);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    const strong = block.querySelector('strong');

    expect(strong).not.toBeNull();

    const lastChar = strong!.textContent.charCodeAt(strong!.textContent.length - 1);

    expect(lastChar).toBe(32);
  });

  it('converts trailing nbsp to regular space through bold → unbold → bold cycle', () => {
    const { block } = setupBlok('text\u00A0');
    const textNode = block.firstChild as Text;

    // Step 1: Select all, bold
    setRange(textNode, 0, 5);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    const strong1 = block.querySelector('strong');

    expect(strong1).not.toBeNull();
    expect(strong1!.textContent.charCodeAt(strong1!.textContent.length - 1)).toBe(32);

    // Step 2: Select all inside strong, unbold
    const boldText = strong1!.firstChild as Text;

    setRange(boldText, 0, boldText.textContent.length);
    menu.onActivate(menu);

    expect(block.querySelector('strong')).toBeNull();
    // After unbold, trailing space should be regular space
    const afterUnbold = block.textContent;

    expect(afterUnbold.charCodeAt(afterUnbold.length - 1)).toBe(32);

    // Step 3: Select all, bold again
    // After unbold, empty text nodes may exist. Normalize to merge them.
    block.normalize();
    const plainText = block.firstChild as Text;

    setRange(plainText, 0, plainText.textContent.length);
    menu.onActivate(menu);

    const strong2 = block.querySelector('strong');

    expect(strong2).not.toBeNull();
    // Trailing space should be regular space after re-bold
    expect(strong2!.textContent.charCodeAt(strong2!.textContent.length - 1)).toBe(32);
  });

  it('does not leave trailing space wrapped in bold when un-bolding partial selection', () => {
    // Reproduces the scenario where:
    // 1. Text is bolded as '<strong>hello world </strong>' (space is charCode 32 after normalization)
    // 2. User selects only 'hello world' (without trailing space, e.g. via triple-click)
    // 3. User toggles bold off
    // Expected: trailing space is not left inside a lone <strong> element
    const { block } = setupBlok('<strong>hello world </strong>');
    const strong = block.querySelector('strong') as HTMLElement;
    const textNode = strong.firstChild as Text;

    // Select only 'hello world' (11 chars), leaving the trailing space unselected
    setRange(textNode, 0, 11);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    // There should be no <strong> element containing only whitespace
    const remainingStrong = block.querySelector('strong');

    expect(remainingStrong).toBeNull();
    expect(block.textContent).toBe('hello world ');
  });

  it('exits collapsed bold when caret is inside bold content', () => {
    const { block } = setupBlok('<strong>BOLD</strong> text');
    const strong = block.querySelector('strong');

    expect(strong).not.toBeNull();

    const textNode = strong?.firstChild as Text;
    const length = textNode.textContent?.length ?? 0;

    setRange(textNode, length);

    const tool = new BoldInlineTool();
    const menu = tool.render() as PopoverItemDefaultBaseParams;

    menu.onActivate(menu);

    const strongAfter = block.querySelector('strong');

    expect(strongAfter?.getAttribute('data-blok-bold-collapsed-length')).toBe(length.toString());
    expect(strongAfter?.getAttribute('data-blok-bold-collapsed-active')).toBeNull();
    expect(typeof menu.isActive === 'function' ? menu.isActive() : menu.isActive).toBe(false);
    expect(window.getSelection()?.anchorNode?.parentNode).toBe(block);
  });
});
