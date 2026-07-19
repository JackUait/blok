import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconClearFormat } from '../../../../src/components/icons';
import { ClearFormatInlineTool } from '../../../../src/components/inline-tools/inline-tool-clear-format';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

describe('ClearFormatInlineTool', () => {
  let tool: ClearFormatInlineTool;
  let container: HTMLDivElement;

  const selectNodeContents = (node: Node): Range => {
    const range = document.createRange();

    range.selectNodeContents(node);

    const selection = window.getSelection();

    if (selection === null) {
      throw new Error('no selection');
    }
    selection.removeAllRanges();
    selection.addRange(range);

    return range;
  };

  const activate = (): void => {
    const config = tool.render() as PopoverItemDefaultBaseParams;

    if (typeof config.onActivate !== 'function') {
      throw new Error('no onActivate');
    }
    config.onActivate(config);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new ClearFormatInlineTool();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
    window.getSelection()?.removeAllRanges();
  });

  it('exposes inline metadata and an empty sanitizer config', () => {
    expect(ClearFormatInlineTool.isInline).toBe(true);
    expect(ClearFormatInlineTool.title).toBe('Clear formatting');
    expect(ClearFormatInlineTool.titleKey).toBe('clearFormat');
    expect(ClearFormatInlineTool.sanitize).toStrictEqual({});
  });

  it('renders menu config with the Tx icon', () => {
    const config = tool.render() as PopoverItemDefaultBaseParams;

    expect(config.icon).toBe(IconClearFormat);
    expect(config.name).toBe('clearFormat');
    expect(config.onActivate).toBeInstanceOf(Function);
  });

  it('unwraps formatting tags inside the selection', () => {
    container.innerHTML = '<b>bo</b><i>it</i><code>co</code><mark>ma</mark>';
    selectNodeContents(container);

    activate();

    expect(container.textContent).toBe('boitcoma');
    expect(container.querySelectorAll('b, i, code, mark').length).toBe(0);
  });

  it('keeps links while stripping their formatting', () => {
    container.innerHTML = '<a href="https://x.test"><b>link</b></a>';
    selectNodeContents(container);

    activate();

    expect(container.querySelectorAll('b').length).toBe(0);
    const anchor = container.querySelector('a');

    expect(anchor).not.toBeNull();
    expect(anchor?.textContent).toBe('link');
  });

  it('unwraps a formatting ancestor when the selection covers its content', () => {
    container.innerHTML = '<strong>whole</strong>';
    const strong = container.querySelector('strong');

    if (strong === null) {
      throw new Error('missing strong');
    }
    selectNodeContents(strong);

    activate();

    expect(container.textContent).toBe('whole');
    expect(container.querySelectorAll('strong').length).toBe(0);
  });

  it('does nothing for a collapsed selection', () => {
    container.innerHTML = '<b>text</b>';
    const selection = window.getSelection();
    const range = document.createRange();

    range.setStart(container, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    activate();

    expect(container.innerHTML).toBe('<b>text</b>');
  });
});
