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

    const tool = new BoldInlineTool();

    expect(tool.shortcut).toBe('CMD+B');
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
