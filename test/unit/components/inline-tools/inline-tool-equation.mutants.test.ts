import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../../src/shared/katex', () => ({
  renderLatex: vi.fn(async (latex: string) => `<span class="katex">rendered:${latex}</span>`),
}));

import { EquationInlineTool } from '../../../../src/components/inline-tools/inline-tool-equation';
import { renderLatex } from '../../../../src/shared/katex';
import { SelectionUtils } from '../../../../src/components/selection/index';
import { PopoverItemType } from '../../../../src/components/utils/popover';
import type { PopoverItemHtmlParams } from '../../../../types/utils/popover';

interface PopoverChildren {
  hideChevron?: boolean;
  items: PopoverItemHtmlParams[];
  onOpen?: () => void;
  onClose?: () => void;
}

interface Harness {
  tool: EquationInlineTool;
  children: PopoverChildren;
  isActive: () => boolean;
  wrapper: HTMLElement;
  input: HTMLInputElement;
  preview: HTMLElement;
  close: ReturnType<typeof vi.fn>;
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const build = (): Harness => {
  const close = vi.fn();
  const api = {
    i18n: { t: (key: string) => key },
    inlineToolbar: { close },
  };
  const tool = new EquationInlineTool({ api: api as never, config: undefined });
  const config = tool.render();
  const children = config.children as unknown as PopoverChildren;
  const htmlItem = children.items.find((item) => item.type === PopoverItemType.Html);

  if (htmlItem === undefined) {
    throw new Error('the equation popover has no html item');
  }

  const wrapper = htmlItem.element;

  document.body.appendChild(wrapper);

  const input = wrapper.querySelector('input');
  const preview = wrapper.querySelector<HTMLElement>('[data-blok-equation-preview]');

  if (input === null || preview === null) {
    throw new Error('the equation popover has no input or preview');
  }

  const { isActive } = config;

  if (typeof isActive !== 'function') {
    throw new Error('isActive is not a predicate');
  }

  return { tool, children, isActive: isActive as () => boolean, wrapper, input, preview, close };
};

/** A span carrying a stored formula, as `findParentTag` would return it. */
const equationSpan = (latex: string | null): HTMLElement => {
  const span = document.createElement('span');

  if (latex !== null) {
    span.setAttribute('data-latex', latex);
  }

  return span;
};

const selectText = (text: string): HTMLElement => {
  const host = document.createElement('div');

  host.contentEditable = 'true';
  host.textContent = text;
  document.body.appendChild(host);

  const node = host.firstChild;

  if (node === null) {
    throw new Error('no text node to select');
  }

  const range = document.createRange();

  range.setStart(node, 0);
  range.setEnd(node, text.length);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);

  return host;
};

describe('EquationInlineTool mutants', () => {
  let findParentTag: ReturnType<typeof vi.spyOn>;
  let setFakeBackground: ReturnType<typeof vi.spyOn>;
  let removeFakeBackground: ReturnType<typeof vi.spyOn>;
  let save: ReturnType<typeof vi.spyOn>;
  let restore: ReturnType<typeof vi.spyOn>;
  let clearSaved: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    findParentTag = vi.spyOn(SelectionUtils.prototype, 'findParentTag').mockReturnValue(null);
    setFakeBackground = vi.spyOn(SelectionUtils.prototype, 'setFakeBackground').mockImplementation(() => undefined);
    removeFakeBackground = vi.spyOn(SelectionUtils.prototype, 'removeFakeBackground').mockImplementation(() => undefined);
    // save/restore call through: only the real pair puts a range on the tool's
    // own SelectionUtils and puts it back, which is what applyEquation reads.
    save = vi.spyOn(SelectionUtils.prototype, 'save');
    restore = vi.spyOn(SelectionUtils.prototype, 'restore');
    clearSaved = vi.spyOn(SelectionUtils.prototype, 'clearSaved').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  describe('render', () => {
    it('is active on a span that stores a formula', () => {
      findParentTag.mockReturnValue(equationSpan('x^2'));

      expect(build().isActive()).toBe(true);
    });

    it('is inactive on a span with no stored formula', () => {
      findParentTag.mockReturnValue(equationSpan(null));

      expect(build().isActive()).toBe(false);
    });

    it('is inactive with no span above the caret', () => {
      findParentTag.mockReturnValue(null);

      const { isActive } = build();

      expect(() => isActive()).not.toThrow();
      expect(isActive()).toBe(false);
    });

    it('hides the popover chevron', () => {
      expect(build().children.hideChevron).toBe(true);
    });
  });

  describe('opening the popover', () => {
    it('seeds the input from the formula already under the caret', () => {
      findParentTag.mockReturnValue(equationSpan('a^2'));
      selectText('other text');

      const { children, input } = build();

      children.onOpen?.();

      expect(input.value).toBe('a^2');
      expect(findParentTag).toHaveBeenCalledWith('SPAN');
    });

    it('seeds the input from the selected text when no formula is stored', () => {
      selectText('b^2');

      const { children, input } = build();

      children.onOpen?.();

      expect(input.value).toBe('b^2');
    });

    it('seeds an empty input when there is no selection at all', () => {
      const { children, input } = build();

      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      children.onOpen?.();

      expect(input.value).toBe('');
    });

    it('previews the seeded formula', async () => {
      findParentTag.mockReturnValue(equationSpan('c^2'));

      const { children, preview } = build();

      children.onOpen?.();
      await flush();

      expect(preview.innerHTML).toContain('rendered:c^2');
    });

    it('paints and saves the selection so it survives the focus move', () => {
      const { children } = build();

      children.onOpen?.();

      expect(setFakeBackground).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('focuses the formula input', () => {
      const { children, input } = build();

      children.onOpen?.();

      expect(input).toHaveFocus();
    });

    it('reclaims focus on the next tick when the popover steals it', () => {
      vi.useFakeTimers();

      const { children, input, wrapper } = build();
      const thief = document.createElement('input');

      wrapper.appendChild(thief);
      children.onOpen?.();
      thief.focus();

      expect(thief).toHaveFocus();

      vi.advanceTimersByTime(0);

      expect(input).toHaveFocus();
    });

    it('leaves focus alone on the next tick when the input still holds it', () => {
      vi.useFakeTimers();

      const { children, input } = build();
      const focus = vi.spyOn(input, 'focus');

      children.onOpen?.();
      expect(focus).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(0);

      expect(focus).toHaveBeenCalledTimes(1);
    });
  });

  describe('closing the popover', () => {
    it('clears the painted selection, the input and the preview', async () => {
      findParentTag.mockReturnValue(equationSpan('d^2'));

      const { children, input, preview } = build();

      children.onOpen?.();
      await flush();

      expect(input.value).toBe('d^2');
      expect(preview.innerHTML).not.toBe('');

      children.onClose?.();

      expect(input.value).toBe('');
      expect(preview.textContent).toBe('');
      expect(removeFakeBackground).toHaveBeenCalled();
      expect(clearSaved).toHaveBeenCalledTimes(1);
    });
  });

  describe('live preview', () => {
    const type = async (harness: Harness, value: string): Promise<void> => {
      const { input } = harness;

      Object.assign(input, { value });
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    };

    it('renders the trimmed formula', async () => {
      const harness = build();

      await type(harness, '  e^2  ');

      expect(renderLatex).toHaveBeenCalledWith('e^2', { displayMode: false });
      expect(harness.preview.innerHTML).toContain('rendered:e^2');
    });

    it('clears the preview for a blank formula without rendering', async () => {
      const harness = build();

      await type(harness, 'f^2');
      expect(harness.preview.innerHTML).toContain('rendered:f^2');

      vi.mocked(renderLatex).mockClear();
      await type(harness, '   ');

      expect(renderLatex).not.toHaveBeenCalled();
      expect(harness.preview.textContent).toBe('');
      expect(harness.preview.innerHTML).toBe('');
    });
  });

  describe('confirming with Enter', () => {
    const pressEnter = (harness: Harness): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      harness.input.dispatchEvent(event);

      return event;
    };

    it('swallows the keystroke and applies the typed formula', async () => {
      const host = selectText('placeholder');
      const harness = build();

      harness.input.value = '  g^2  ';

      const event = pressEnter(harness);

      await flush();

      expect(host.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('g^2');
      expect(event.defaultPrevented).toBe(true);
      expect(harness.close).toHaveBeenCalledTimes(1);
      expect(removeFakeBackground).toHaveBeenCalled();
      expect(restore).toHaveBeenCalled();
    });

    it('ignores every other key', () => {
      const harness = build();

      harness.input.value = 'h^2';
      harness.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));

      expect(harness.close).not.toHaveBeenCalled();
    });

    it('just closes on a blank formula, touching neither the selection nor the document', async () => {
      const host = selectText('placeholder');
      const harness = build();

      harness.input.value = '   ';
      pressEnter(harness);
      await flush();

      expect(removeFakeBackground).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
      expect(host.querySelector('span[data-latex]')).toBeNull();
      expect(harness.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyEquation', () => {
    it('restores a saved selection before writing', async () => {
      const host = selectText('i^2');
      const { tool, children } = build();

      // Opening the popover is the only path that saves a range.
      children.onOpen?.();
      removeFakeBackground.mockClear();
      restore.mockClear();

      await tool.applyEquation('j^2');

      expect(removeFakeBackground).toHaveBeenCalled();
      expect(restore).toHaveBeenCalled();
      expect(host.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('j^2');
    });

    it('leaves the selection alone when nothing was saved', async () => {
      selectText('k^2');

      const { tool } = build();

      await tool.applyEquation('l^2');

      expect(removeFakeBackground).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
    });
  });

  describe('hydrate', () => {
    it('renders every unrendered equation span in a block', async () => {
      const root = document.createElement('div');

      root.innerHTML = '<span data-latex="m^2">m^2</span><span data-latex="n^2">n^2</span>';

      await EquationInlineTool.hydrate(root);

      const spans = root.querySelectorAll('span[data-latex]');

      expect(spans[0].innerHTML).toContain('rendered:m^2');
      expect(spans[1].innerHTML).toContain('rendered:n^2');
    });
  });
});
