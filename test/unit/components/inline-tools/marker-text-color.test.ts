import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';

/**
 * D7 proving test — Notion has a two-axis color model: inline TEXT color AND
 * highlight (background). The audit claimed Blok only had highlight. This file
 * proves the Marker inline tool ALREADY applies inline TEXT color (the `color`
 * CSS property, NOT background-color) through its public applyColor('color', …)
 * path, so no separate text-color inline tool is needed.
 */
const createMockApi = () => ({
  toolbar: {},
  inlineToolbar: { close: vi.fn() },
  notifier: {},
  i18n: { t: (key: string) => key },
  blocks: {},
  selection: {},
  caret: {},
  tools: {},
});

describe('Marker inline tool — D7 inline text color', () => {
  let tool: MarkerInlineTool;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new MarkerInlineTool({ api: createMockApi() as never, config: undefined });
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  const selectFirstWord = (): void => {
    container.innerHTML = 'hello world';
    const textNode = container.firstChild;

    if (!textNode) {
      throw new Error('Test setup failed: no text node');
    }

    const range = document.createRange();

    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    const selection = window.getSelection();

    if (!selection) {
      throw new Error('Test setup failed: no selection');
    }

    selection.removeAllRanges();
    selection.addRange(range);
  };

  it('applyColor("color", …) wraps the selection in <mark> with a TEXT color, not a highlight', () => {
    selectFirstWord();

    tool.applyColor('color', '#d44c47');

    const mark = container.querySelector('mark');

    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('hello');

    // The TEXT color axis is set...
    expect(mark?.style.color).not.toBe('');
    // ...and it is NOT a visible highlight (background stays transparent).
    expect(mark?.style.backgroundColor).toBe('transparent');
  });

  it('exposes the two-axis model: applyColor also supports the background (highlight) axis', () => {
    selectFirstWord();

    tool.applyColor('background-color', '#fbecdd');

    const mark = container.querySelector('mark');

    expect(mark?.style.backgroundColor).not.toBe('');
    expect(mark?.style.backgroundColor).not.toBe('transparent');
    // No text color was set on this axis.
    expect(mark?.style.color).toBe('');
  });
});
