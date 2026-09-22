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

/** `MenuConfig` is a union; the equation tool always returns the children form. */
interface EquationMenu {
  children: PopoverChildren;
  isActive: (() => boolean) | boolean;
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

const dispatchChange = vi.fn();

const build = (): Harness => {
  const close = vi.fn();
  const api = {
    i18n: { t: (key: string) => key },
    inlineToolbar: { close },
    blocks: { getBlockByElement: vi.fn(() => ({ dispatchChange })) },
  };
  const tool = new EquationInlineTool({ api: api as never, config: undefined });
  const config = tool.render() as unknown as EquationMenu;
  const { children } = config;
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

  return { tool, children, isActive, wrapper, input, preview, close };
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
    vi.unstubAllGlobals();
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

      window.getSelection()?.collapseToEnd();

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

describe('the popover markup', () => {
    it('marks the wrapper, the input and the preview so hosts can find them', () => {
      const { wrapper, input, preview } = build();

      expect(wrapper.hasAttribute('data-blok-equation-tool')).toBe(true);
      expect(input.getAttribute('data-blok-testid')).toBe('inline-equation-input');
      expect(input.type).toBe('text');
      expect(input.enterKeyHint).toBe('done');
      expect(preview.hasAttribute('data-blok-equation-preview')).toBe(true);
      expect(preview.getAttribute('aria-live')).toBe('polite');
    });

    it('looks for a SPAN ancestor when deciding whether the caret is on an equation', () => {
      const { isActive } = build();

      isActive();

      expect(findParentTag).toHaveBeenCalledWith('SPAN');
    });

    it('paints the wrapper, the input and the preview with the exact class list and markers', () => {
      const { wrapper, input, preview } = build();

      expect(wrapper.className).toBe('relative flex items-center gap-2 w-[300px] h-9 pl-3 pr-[3px] rounded-[10px] border border-transparent bg-item-hover-bg transition-[background-color,border-color] duration-150 ease-out focus-within:bg-popover-bg focus-within:border-search-input-focus-border');
      expect(wrapper.getAttribute('data-blok-equation-tool')).toBe('');
      // `input.type` reads back as 'text' even when the IDL is set to '', so the
      // content attribute is the only witness that 'text' was actually written.
      expect(input.getAttribute('type')).toBe('text');
      expect(input.className).toBe('flex-1 min-w-0 m-0 p-0 font-mono text-sm leading-[22px] text-text-primary bg-transparent border-0 outline-hidden appearance-none placeholder:text-gray-text');
      expect(preview.className).toBe('sr-only');
      expect(preview.getAttribute('data-blok-equation-preview')).toBe('');
    });
  });

  describe('writing the equation into the document', () => {
    it('trims an explicit formula before storing it', async () => {
      const host = selectText('placeholder');
      const { tool } = build();

      await tool.applyEquation('  o^2  ');

      expect(host.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('o^2');
    });

    it('writes nothing for a blank formula', async () => {
      const host = selectText('placeholder');
      const { tool } = build();

      await tool.applyEquation('   ');

      expect(host.querySelector('span[data-latex]')).toBeNull();
      expect(host.textContent).toBe('placeholder');
    });

    it('replaces the selected text rather than adding to it', async () => {
      const host = selectText('replace me');
      const { tool } = build();

      await tool.applyEquation('p^2');

      expect(host.textContent).not.toContain('replace me');
      expect(host.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('p^2');
    });

    it('leaves the caret collapsed straight after the equation', async () => {
      const host = selectText('placeholder');
      const { tool } = build();

      await tool.applyEquation('q^2');

      const span = host.querySelector('span[data-latex]');
      const selection = window.getSelection();

      expect(selection?.rangeCount).toBe(1);

      const range = selection?.getRangeAt(0);

      expect(range?.collapsed).toBe(true);
      expect(range?.startContainer).toBe(span?.parentNode);
      expect(range?.startOffset).toBe(Array.from(host.childNodes).indexOf(span as ChildNode) + 1);
    });

    it('marks the rendered span mutation-free so the write is not an edit', async () => {
      const host = selectText('placeholder');
      const { tool } = build();

      await tool.applyEquation('r^2');

      expect(host.querySelector('span[data-latex]')?.getAttribute('data-blok-mutation-free')).toBe('true');
    });

    it('inserts the span already carrying its LaTeX source', async () => {
      selectText('placeholder');

      const { tool } = build();
      const inserted: (string | null)[] = [];
      const realInsertNode = Range.prototype.insertNode;
      const recordInsert = function (this: Range, node: Node): void {
        inserted.push(node instanceof HTMLElement ? node.getAttribute('data-latex') : null);

        realInsertNode.call(this, node);
      };

      Range.prototype.insertNode = recordInsert;

      try {
        await tool.applyEquation('u^2');
      } finally {
        Range.prototype.insertNode = realInsertNode;
      }

      expect(inserted).toEqual(['u^2']);
    });
  });

  describe('surviving a host without a DOM', () => {
    it('returns before touching the missing window', () => {
      findParentTag.mockReturnValue(equationSpan('v^2'));

      const { children } = build();

      save.mockImplementation(() => undefined);

      vi.stubGlobal('window', undefined);

      try {
        expect(() => children.onOpen?.()).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('returns before scheduling a timer when the document is missing', () => {
      findParentTag.mockReturnValue(equationSpan('w^2'));

      const { children, input } = build();

      save.mockImplementation(() => undefined);
      // jsdom's own focus() schedules a timer, which would drown out the one
      // under test.
      vi.spyOn(input, 'focus').mockImplementation(() => undefined);
      vi.useFakeTimers();

      vi.stubGlobal('document', undefined);

      try {
        children.onOpen?.();

        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('the Notion-style editor', () => {
    const type = async (harness: Harness, value: string): Promise<void> => {
      Object.assign(harness.input, { value });
      harness.input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    };

    const doneButton = (harness: Harness): HTMLButtonElement => {
      const button = harness.wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="inline-equation-done"]');

      if (button === null) {
        throw new Error('the equation popover has no Done button');
      }

      return button;
    };

    it('shows a Done button with the return-key hint next to the input', () => {
      const harness = build();
      const button = doneButton(harness);

      expect(button.type).toBe('button');
      expect(button.textContent).toContain('tools.equation.done');
      expect(button.querySelector('svg')).not.toBeNull();
      expect(harness.input.nextElementSibling).toBe(button);
      // Inset 4px inside a 10px-radius field, so the corners stay concentric.
      expect(button.className).toContain('h-7');
      expect(button.className).toContain('rounded-md');
    });

    it('confirms the typed formula when Done is clicked', async () => {
      const host = selectText('placeholder');

      window.getSelection()?.collapseToEnd();

      const harness = build();

      harness.children.onOpen?.();
      harness.input.value = 'y^2';
      doneButton(harness).click();
      await flush();

      expect(host.querySelector('span[data-latex]')?.getAttribute('data-latex')).toBe('y^2');
      expect(harness.close).toHaveBeenCalledTimes(1);
    });

    it('keeps the caret where it is when Done is pressed', () => {
      const harness = build();
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

      doneButton(harness).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('turns the selected text into an equation chip as soon as it opens', async () => {
      const host = selectText('a+b');
      const { children, input } = build();

      children.onOpen?.();
      await flush();

      const chip = host.querySelector('span[data-latex]');

      expect(chip?.getAttribute('data-latex')).toBe('a+b');
      expect(chip?.innerHTML).toContain('rendered:a+b');
      expect(chip?.hasAttribute('data-blok-equation-editing')).toBe(true);
      expect(input.value).toBe('a+b');
      expect(setFakeBackground).not.toHaveBeenCalled();
    });

    it('selects the formula so typing replaces it', () => {
      findParentTag.mockReturnValue(equationSpan('z^2'));

      const { children, input } = build();

      children.onOpen?.();

      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(3);
    });

    it('renders the typed formula live into the chip without storing it', async () => {
      const chip = equationSpan('c^2');

      findParentTag.mockReturnValue(chip);

      const harness = build();

      harness.children.onOpen?.();
      await type(harness, 'c^3');

      expect(chip.innerHTML).toContain('rendered:c^3');
      expect(chip.getAttribute('data-latex')).toBe('c^2');
      expect(chip.getAttribute('data-blok-mutation-free')).toBe('true');
    });

    it('stores the formula on the chip when confirmed', async () => {
      const chip = equationSpan('d^2');

      findParentTag.mockReturnValue(chip);

      const harness = build();

      harness.children.onOpen?.();
      await type(harness, 'd^3');
      doneButton(harness).click();
      await flush();

      expect(chip.getAttribute('data-latex')).toBe('d^3');
      expect(chip.innerHTML).toContain('rendered:d^3');
      expect(harness.close).toHaveBeenCalledTimes(1);
      // The span is mutation-free, so the block observer never sees this edit.
      expect(dispatchChange).toHaveBeenCalledTimes(1);

      harness.children.onClose?.();
      await flush();

      expect(chip.innerHTML).toContain('rendered:d^3');
      expect(chip.hasAttribute('data-blok-equation-editing')).toBe(false);
    });

    it('puts the chip back to its stored formula when closed without confirming', async () => {
      const chip = equationSpan('e^2');

      findParentTag.mockReturnValue(chip);

      const harness = build();

      harness.children.onOpen?.();
      expect(chip.hasAttribute('data-blok-equation-editing')).toBe(true);

      await type(harness, 'e^9');
      harness.children.onClose?.();
      await flush();

      expect(chip.innerHTML).toContain('rendered:e^2');
      expect(chip.getAttribute('data-latex')).toBe('e^2');
      expect(chip.hasAttribute('data-blok-equation-editing')).toBe(false);
      expect(dispatchChange).not.toHaveBeenCalled();
    });
  });

  describe('hydrate', () => {
    it('leaves an already-rendered span alone', async () => {
      const root = document.createElement('div');

      root.innerHTML = '<span data-latex="s^2"><span class="katex">rendered:s^2</span></span>';

      await EquationInlineTool.hydrate(root);

      expect(renderLatex).not.toHaveBeenCalled();
    });

    it('leaves a span with no stored formula alone', async () => {
      const root = document.createElement('div');

      root.innerHTML = '<span data-latex="">t^2</span>';

      await EquationInlineTool.hydrate(root);

      expect(renderLatex).not.toHaveBeenCalled();
    });

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
