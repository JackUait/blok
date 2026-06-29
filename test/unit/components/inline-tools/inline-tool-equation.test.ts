import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Mock the lazy KaTeX loader so tests stay deterministic and offline.
 * renderLatex() normally dynamic-imports katex + injects CSS; here it just
 * echoes a predictable rendered string.
 */
vi.mock('../../../../src/tools/code/katex-loader', () => ({
  renderLatex: vi.fn(
    async (latex: string) => `<span class="katex">rendered:${latex}</span>`
  ),
}));

import { IconEquation } from '../../../../src/components/icons';
import { EquationInlineTool } from '../../../../src/components/inline-tools/inline-tool-equation';
import { renderLatex } from '../../../../src/tools/code/katex-loader';
import { PopoverItemType } from '../../../../src/components/utils/popover';
import type { PopoverItemHtmlParams, WithChildren } from '../../../../types/utils/popover';

const createMockApi = () => ({
  toolbar: {},
  inlineToolbar: { close: vi.fn() },
  notifier: {},
  i18n: { t: (key: string) => key },
  blocks: {},
  selection: {},
  caret: {},
  tools: {},
  config: {},
});

describe('EquationInlineTool', () => {
  let tool: EquationInlineTool;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new EquationInlineTool({ api: createMockApi() as never, config: undefined });
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and the Cmd+Shift+E shortcut', () => {
    expect(EquationInlineTool.isInline).toBe(true);
    expect(EquationInlineTool.title).toBe('Equation');
    expect(EquationInlineTool.titleKey).toBe('equation');
    expect(EquationInlineTool.shortcut).toBe('CMD+SHIFT+E');
  });

  it('sanitizer preserves span with only the data-latex attribute', () => {
    const sanitize = EquationInlineTool.sanitize;

    expect(sanitize).toHaveProperty('span');
    expect(sanitize.span).toEqual({ 'data-latex': true });
  });

  it('renders a MenuConfig with the equation icon, name and children popover', () => {
    const config = tool.render();

    expect(config).toHaveProperty('icon', IconEquation);
    expect(config).toHaveProperty('name', 'equation');
    expect(config).toHaveProperty('children');
  });

  it('children popover contains the formula input UI', () => {
    const config = tool.render() as unknown as WithChildren<{ children: { items: unknown[] } }>;
    const items = (config.children as { items: PopoverItemHtmlParams[] }).items;
    const htmlItem = items.find((item) => item.type === PopoverItemType.Html);

    expect(htmlItem).toBeDefined();

    const element = (htmlItem as PopoverItemHtmlParams).element;
    const input = element.querySelector('input');

    expect(input).not.toBeNull();
    // Placeholder must be routed through i18n (mock echoes the key)
    expect(input?.placeholder).toBe('tools.equation.placeholder');
  });

  describe('applyEquation', () => {
    const selectFirstWord = (): void => {
      container.innerHTML = 'x^2 plus one';
      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('Test setup failed: no text node');
      }

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 3);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Test setup failed: no selection');
      }

      selection.removeAllRanges();
      selection.addRange(range);
    };

    it('wraps the selected text in a span[data-latex] and renders it via KaTeX', async () => {
      selectFirstWord();

      await tool.applyEquation();

      const span = container.querySelector('span[data-latex]');

      expect(span).not.toBeNull();
      expect(span?.getAttribute('data-latex')).toBe('x^2');
      expect(renderLatex).toHaveBeenCalledWith('x^2', expect.objectContaining({ displayMode: false }));
      expect(span?.innerHTML).toContain('rendered:x^2');
    });

    it('uses an explicit latex argument over the selection text', async () => {
      selectFirstWord();

      await tool.applyEquation('\\frac{a}{b}');

      const span = container.querySelector('span[data-latex]');

      expect(span?.getAttribute('data-latex')).toBe('\\frac{a}{b}');
    });

    it('does nothing when there is no formula source', async () => {
      container.innerHTML = 'plain';
      const selection = window.getSelection();

      selection?.removeAllRanges();

      await tool.applyEquation('');

      expect(container.querySelector('span[data-latex]')).toBeNull();
    });
  });
});
