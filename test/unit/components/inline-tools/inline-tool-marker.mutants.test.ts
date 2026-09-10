import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import type { ColorPickerHandle } from '../../../../src/components/shared/color-picker';
import type { SelectionUtils } from '../../../../src/components/selection/index';

/**
 * Menu config shape this tool actually returns. The published MenuConfig union
 * hides `children`, so the assertions below read it through this narrow shape.
 */
interface MarkerMenuItem {
  element: HTMLElement;
}

interface MarkerMenu {
  icon: string;
  name: string;
  isActive: () => boolean;
  children: {
    hideChevron?: boolean;
    isFlippable?: boolean;
    items: MarkerMenuItem[];
    onOpen: () => void;
    onClose: () => void;
  };
}

interface MarkerInternals {
  picker: ColorPickerHandle;
  selection: SelectionUtils;
}

const createApi = () => ({
  toolbar: {},
  inlineToolbar: { close: vi.fn() },
  notifier: {},
  i18n: { t: (key: string) => key, has: () => false },
  blocks: {},
  selection: {},
  caret: {},
  tools: {},
});

const menuOf = (tool: MarkerInlineTool): MarkerMenu => {
  return tool.render() as unknown as MarkerMenu;
};

const internalsOf = (tool: MarkerInlineTool): MarkerInternals => {
  return tool as unknown as MarkerInternals;
};

const requireNode = (node: Node | null): Node => {
  if (node === null) {
    throw new Error('Test setup failed: expected a node');
  }

  return node;
};

const requireElement = <T extends Element>(element: T | null): T => {
  if (element === null) {
    throw new Error('Test setup failed: expected an element');
  }

  return element;
};

/** Select [start, end) of `node`; throws when jsdom has no selection at all. */
const select = (node: Node, start: number, end: number): Range => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const sel = window.getSelection();

  if (sel === null) {
    throw new Error('Test setup failed: jsdom returned no selection');
  }

  sel.removeAllRanges();
  sel.addRange(range);

  return range;
};

const RED = (() => {
  const preset = COLOR_PRESETS.find((candidate) => candidate.name === 'red');

  if (preset === undefined) {
    throw new Error('Test setup failed: red preset missing');
  }

  return preset;
})();

/** CSSOM normalises hex to rgb(), so DOM reads must compare against this form. */
const hexToRgb = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `rgb(${r}, ${g}, ${b})`;
};

const RED_TEXT_RGB = hexToRgb(RED.text);
const RED_BG_RGB = hexToRgb(RED.bg);

describe('MarkerInlineTool — mutation targets', () => {
  let tool: MarkerInlineTool;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new MarkerInlineTool({ api: createApi() as never, config: undefined });
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  describe('render() menu config', () => {
    it('hides the chevron and disables flipping for the inline picker', () => {
      const menu = menuOf(tool);

      expect(menu.children.hideChevron).toBe(true);
      expect(menu.children.isFlippable).toBe(false);
    });

    it('does not throw in isActive() when the document has no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const menu = menuOf(tool);

      expect(() => menu.isActive()).not.toThrow();
      expect(menu.isActive()).toBe(false);
    });

    it('does not throw in isActive() when the selection holds no range', () => {
      const sel = window.getSelection();

      if (sel === null) {
        throw new Error('Test setup failed: no selection');
      }

      sel.removeAllRanges();

      const menu = menuOf(tool);

      expect(() => menu.isActive()).not.toThrow();
      expect(menu.isActive()).toBe(false);
    });

    it('resets the toolbar button when the range starts outside every mark', () => {
      const btn = document.createElement('button');

      btn.setAttribute('data-blok-item-name', 'marker');
      btn.style.color = 'rgb(1, 2, 3)';
      document.body.appendChild(btn);

      container.innerHTML = '<div><mark style="color: #d44c47">inside a mark</mark></div>';
      // The range start is the wrapper, so no mark is an ancestor of the start node
      // even though every text node it covers sits inside one.
      select(requireNode(container.firstChild), 0, 1);

      const menu = menuOf(tool);

      expect(menu.isActive()).toBe(true);
      expect(() => menu.isActive()).not.toThrow();
      // No mark at the start -> no colours to report -> the reset path must run.
      expect(btn.style.color).toBe('');

      btn.remove();
    });

    it('leaves the toolbar button untouched when the selection carries no mark', () => {
      const btn = document.createElement('button');

      btn.setAttribute('data-blok-item-name', 'marker');
      btn.style.color = 'rgb(1, 2, 3)';
      document.body.appendChild(btn);

      container.innerHTML = 'plain text, no mark here';
      select(requireNode(container.firstChild), 0, 5);

      const menu = menuOf(tool);

      expect(menu.isActive()).toBe(false);
      // No mark -> no colour read -> the indicator must keep its previous value.
      expect(btn.style.color).toBe('rgb(1, 2, 3)');

      btn.remove();
    });

    it('focuses the selected picker tab with preventScroll once the popover opens', async () => {
      const pickerEl = internalsOf(tool).picker.element;

      document.body.appendChild(pickerEl);

      const selectedTab = pickerEl.querySelector('[role="tab"][aria-selected="true"]');

      expect(selectedTab).not.toBeNull();

      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

      menuOf(tool).children.onOpen();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

      pickerEl.remove();
    });

    it('does not touch focus when the picker has no selected tab', async () => {
      const pickerEl = internalsOf(tool).picker.element;

      document.body.appendChild(pickerEl);

      vi.spyOn(pickerEl, 'querySelector').mockReturnValue(null);

      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      const uncaught: unknown[] = [];
      const collect = (error: unknown): void => {
        uncaught.push(error);
      };

      process.on('uncaughtException', collect);

      try {
        menuOf(tool).children.onOpen();
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off('uncaughtException', collect);
        pickerEl.remove();
      }

      expect(uncaught).toStrictEqual([]);
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('applyShortcut', () => {
    afterEach(() => {
      (MarkerInlineTool as unknown as { lastColor: unknown }).lastColor = null;
    });

    it('records the default highlight as the last-used color on first use', () => {
      container.innerHTML = 'shortcut target';
      select(requireNode(container.firstChild), 0, 8);

      tool.applyShortcut();

      const lastColor = (MarkerInlineTool as unknown as {
        lastColor: { mode: string; value: string } | null;
      }).lastColor;

      expect(lastColor).toStrictEqual({
        mode: 'background-color',
        value: 'var(--blok-color-yellow-bg)',
      });
    });
  });

  describe('applyColor', () => {
    it('returns without throwing when the document has no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => tool.applyColor('color', '#d44c47')).not.toThrow();
      expect(container.querySelector('mark')).toBeNull();
    });

    it('returns without throwing for an empty selection range', () => {
      container.innerHTML = 'abc';
      const sel = window.getSelection();

      if (sel === null) {
        throw new Error('Test setup failed: no selection');
      }

      sel.removeAllRanges();

      expect(() => tool.applyColor('color', '#d44c47')).not.toThrow();
      expect(container.querySelector('mark')).toBeNull();
    });

    it('does not wrap anything for a collapsed range', () => {
      container.innerHTML = 'collapsed caret sits here';
      select(requireNode(container.firstChild), 4, 4);

      tool.applyColor('color', '#d44c47');

      // Equivalence note: dropping the `range.collapsed` early return changes
      // nothing — applyMarkWithinHost returns [] for a collapsed range itself.
      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('collapsed caret sits here');
    });

    it('keeps a CSS keyword color that maps to no preset instead of inventing one', () => {
      container.innerHTML = 'keyword colour';
      select(requireNode(container.firstChild), 0, 7);

      tool.applyColor('color', 'red');

      const mark = requireElement(container.querySelector('mark'));

      expect(mark.style.getPropertyValue('color')).toBe('red');
      expect(mark.style.getPropertyValue('color')).not.toBe('var(--blok-color-null-text)');
    });

    it('passes an already-var() value through unchanged', () => {
      container.innerHTML = 'already a var';
      select(requireNode(container.firstChild), 0, 7);

      tool.applyColor('color', 'var(--blok-color-red-text)');

      const mark = requireElement(container.querySelector('mark'));

      // Equivalence note: dropping the `startsWith('var(')` early return still
      // yields the same string, because mapToNearestPresetName returns null for
      // any value parseColor cannot read and the fallback returns the input.
      expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
    });

    it('gives a text-coloured mark an explicit transparent background', () => {
      container.innerHTML = 'needs the transparent override';
      select(requireNode(container.firstChild), 0, 5);

      tool.applyColor('color', '#d44c47');

      const mark = requireElement(container.querySelector('mark'));

      // Without this the browser's default yellow <mark> background shows through.
      expect(mark.style.getPropertyValue('background-color')).toBe('transparent');
    });
  });

  describe('removeColor', () => {
    it('returns without throwing when the document has no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => tool.removeColor('color')).not.toThrow();
    });

    it('returns without throwing for an empty selection range', () => {
      const sel = window.getSelection();

      if (sel === null) {
        throw new Error('Test setup failed: no selection');
      }

      sel.removeAllRanges();

      expect(() => tool.removeColor('color')).not.toThrow();
    });

    it('restores a saved range before clearing it', () => {
      container.innerHTML = 'restore me';
      const savedRange = select(requireNode(container.firstChild), 0, 4);
      const sel = internalsOf(tool).selection;

      sel.savedSelectionRange = savedRange;

      const removeFakeBgSpy = vi.spyOn(sel, 'removeFakeBackground');
      const restoreSpy = vi.spyOn(sel, 'restore');

      tool.removeColor('color');

      expect(removeFakeBgSpy).toHaveBeenCalledTimes(1);
      expect(restoreSpy).toHaveBeenCalledTimes(1);
      // The saved range must be consumed, not left behind for the next edit.
      expect(sel.savedSelectionRange).toBeNull();
    });

    it('leaves the live selection alone when nothing was saved', () => {
      const sel = internalsOf(tool).selection;

      sel.savedSelectionRange = null;

      const removeFakeBgSpy = vi.spyOn(sel, 'removeFakeBackground');
      const restoreSpy = vi.spyOn(sel, 'restore');
      const clearSavedSpy = vi.spyOn(sel, 'clearSaved');

      tool.removeColor('color');

      expect(restoreSpy).not.toHaveBeenCalled();
      expect(removeFakeBgSpy).not.toHaveBeenCalled();
      expect(clearSavedSpy).not.toHaveBeenCalled();
    });

    it('drops the text color from the mark when the Default swatch is picked', () => {
      container.innerHTML = 'recolor me';
      select(requireNode(container.firstChild), 0, 6);

      tool.applyColor('color', '#d44c47');

      const mark = requireElement(container.querySelector('mark'));

      expect(mark.style.getPropertyValue('color')).not.toBe('');

      const pickerEl = internalsOf(tool).picker.element;

      document.body.appendChild(pickerEl);

      requireElement(
        pickerEl.querySelector<HTMLElement>('[data-blok-testid="marker-swatch-color-default"]')
      ).click();

      expect(mark.style.getPropertyValue('color')).toBe('');

      pickerEl.remove();
    });
  });

  describe('picker selection state', () => {
    let markerBtn: HTMLButtonElement;
    let pickerEl: HTMLElement;

    const makeMarkerButton = (withRect: boolean): HTMLButtonElement => {
      const btn = document.createElement('button');

      btn.setAttribute('data-blok-item-name', 'marker');

      if (withRect) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

        svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
        btn.appendChild(svg);
      }

      document.body.appendChild(btn);

      return btn;
    };

    const clickSwatch = (testId: string): void => {
      requireElement(pickerEl.querySelector<HTMLElement>(`[data-blok-testid="${testId}"]`)).click();
    };

    beforeEach(() => {
      markerBtn = makeMarkerButton(true);
      pickerEl = internalsOf(tool).picker.element;
      document.body.appendChild(pickerEl);
    });

    afterEach(() => {
      markerBtn.remove();
      pickerEl.remove();
    });

    it('resets the picker and saves the selection when the popover opens', () => {
      const sel = internalsOf(tool).selection;

      container.innerHTML = 'opened with no mark';
      select(requireNode(container.firstChild), 0, 4);

      const resetSpy = vi.spyOn(internalsOf(tool).picker, 'reset');
      const fakeBgSpy = vi.spyOn(sel, 'setFakeBackground');
      const saveSpy = vi.spyOn(sel, 'save');

      menuOf(tool).children.onOpen();

      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(fakeBgSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('does not invent an active swatch when there is no selection at all', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      expect(() => menuOf(tool).children.onOpen()).not.toThrow();
      expect(setActiveSpy).not.toHaveBeenCalled();
    });

    it('does not invent an active swatch when the selection holds no range', () => {
      const sel = window.getSelection();

      if (sel === null) {
        throw new Error('Test setup failed: no selection');
      }

      sel.removeAllRanges();

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      expect(() => menuOf(tool).children.onOpen()).not.toThrow();
      expect(setActiveSpy).not.toHaveBeenCalled();
    });

    it('does not invent an active swatch when the range start is outside every mark', () => {
      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      container.innerHTML = '<div><mark style="color: #d44c47">inside</mark></div>';
      // Range start is the wrapper element, so no mark is an ancestor of the start
      // node even though every text node in the range sits inside one.
      select(requireNode(container.firstChild), 0, 1);

      expect(() => menuOf(tool).children.onOpen()).not.toThrow();
      expect(setActiveSpy).not.toHaveBeenCalledWith(expect.anything(), 'color');
      expect(setActiveSpy).not.toHaveBeenCalledWith(expect.anything(), 'background-color');
    });

    it('activates only the background swatch for a background-only mark', () => {
      container.innerHTML = '<mark style="background-color: #fbecdd">bg only</mark>';

      const mark = requireElement(container.querySelector('mark'));
      const textNode = requireNode(mark.firstChild);
      const originalGetComputedStyle = window.getComputedStyle.bind(window);

      vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
        if (element === mark) {
          return {
            getPropertyValue: (prop: string) => (prop === 'background-color' ? 'rgb(251, 236, 221)' : ''),
          } as unknown as CSSStyleDeclaration;
        }

        return originalGetComputedStyle(element);
      });

      select(textNode, 0, 3);

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      menuOf(tool).children.onOpen();

      expect(setActiveSpy).toHaveBeenCalledWith('rgb(251, 236, 221)', 'background-color');
      expect(setActiveSpy).not.toHaveBeenCalledWith(null, 'color');
      expect(setActiveSpy).not.toHaveBeenCalledWith(null, 'background-color');
    });

    it('activates only the text swatch for a text-only mark', () => {
      container.innerHTML = '<mark style="color: #d44c47">text only</mark>';

      const mark = requireElement(container.querySelector('mark'));
      const textNode = requireNode(mark.firstChild);
      const originalGetComputedStyle = window.getComputedStyle.bind(window);

      vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
        if (element === mark) {
          return {
            getPropertyValue: (prop: string) => (prop === 'color' ? 'rgb(212, 76, 71)' : ''),
          } as unknown as CSSStyleDeclaration;
        }

        return originalGetComputedStyle(element);
      });

      select(textNode, 0, 4);

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      menuOf(tool).children.onOpen();

      expect(setActiveSpy).toHaveBeenCalledWith('rgb(212, 76, 71)', 'color');
      expect(setActiveSpy).not.toHaveBeenCalledWith(null, 'background-color');
    });

    it('treats a transparent computed value as no color at all', () => {
      container.innerHTML = '<mark style="color: #d44c47">faded</mark>';

      const mark = requireElement(container.querySelector('mark'));
      const textNode = requireNode(mark.firstChild);
      const originalGetComputedStyle = window.getComputedStyle.bind(window);

      vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
        if (element === mark) {
          return {
            getPropertyValue: (prop: string) => (prop === 'color' ? 'transparent' : ''),
          } as unknown as CSSStyleDeclaration;
        }

        return originalGetComputedStyle(element);
      });

      select(textNode, 0, 3);

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      menuOf(tool).children.onOpen();

      expect(setActiveSpy).not.toHaveBeenCalledWith('transparent', 'color');
      expect(setActiveSpy).toHaveBeenCalledTimes(0);
    });

    it('treats an inline transparent value as no color at all', () => {
      container.innerHTML = '<mark style="color: transparent">faded</mark>';

      const mark = requireElement(container.querySelector('mark'));
      const textNode = requireNode(mark.firstChild);
      const originalGetComputedStyle = window.getComputedStyle.bind(window);

      vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
        if (element === mark) {
          return {
            getPropertyValue: (prop: string) => (prop === 'color' ? 'rgb(9, 9, 9)' : ''),
          } as unknown as CSSStyleDeclaration;
        }

        return originalGetComputedStyle(element);
      });

      select(textNode, 0, 3);

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');

      menuOf(tool).children.onOpen();

      expect(setActiveSpy).not.toHaveBeenCalledWith('rgb(9, 9, 9)', 'color');
    });

    it('rewrites the toolbar indicator when the picker opens on an unformatted selection', () => {
      markerBtn.style.color = 'rgb(1, 2, 3)';

      container.innerHTML = 'unformatted';
      select(requireNode(container.firstChild), 0, 4);

      menuOf(tool).children.onOpen();

      expect(markerBtn.style.getPropertyValue('color')).toBe('');
    });

    it('activates the picked color and saves the selection on swatch click', () => {
      const sel = internalsOf(tool).selection;

      container.innerHTML = 'swatch click';
      select(requireNode(container.firstChild), 0, 5);

      const setActiveSpy = vi.spyOn(internalsOf(tool).picker, 'setActiveColor');
      const fakeBgSpy = vi.spyOn(sel, 'setFakeBackground');
      const saveSpy = vi.spyOn(sel, 'save');

      clickSwatch('marker-swatch-color-red');

      expect(setActiveSpy).toHaveBeenCalledWith(RED.text, 'color');
      expect(fakeBgSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('paints the button with the neutral text token for a background-only color', () => {
      container.innerHTML = 'bg paint';
      select(requireNode(container.firstChild), 0, 3);

      clickSwatch('marker-swatch-background-color-red');

      // Only a background is set, so the text token suppresses the active-state blue.
      expect(markerBtn.style.getPropertyValue('color')).toBe('var(--blok-text-primary)');
      // The colour itself is clipped to the rounded square via the SVG rect.
      expect(requireElement(markerBtn.querySelector<SVGRectElement>('svg rect')).style.fill).toBe(RED_BG_RGB);
      expect(markerBtn.style.getPropertyValue('background-color')).toBe('transparent');
    });

    it('paints the button with a neutral rect fill for a text-only color', () => {
      container.innerHTML = 'text paint';
      select(requireNode(container.firstChild), 0, 3);

      clickSwatch('marker-swatch-color-red');

      expect(markerBtn.style.getPropertyValue('color')).toBe(RED_TEXT_RGB);
      expect(requireElement(markerBtn.querySelector<SVGRectElement>('svg rect')).style.fill).toBe(
        'var(--blok-swatch-neutral-bg)'
      );
      expect(markerBtn.style.getPropertyValue('background-color')).toBe('transparent');
    });

    it('clears both the inline color and the rect fill when the Default swatch resets it', () => {
      container.innerHTML = 'reset paint';
      select(requireNode(container.firstChild), 0, 4);

      clickSwatch('marker-swatch-background-color-red');

      const rect = requireElement(markerBtn.querySelector<SVGRectElement>('svg rect'));

      expect(rect.style.fill).toBe(RED_BG_RGB);

      clickSwatch('marker-swatch-background-color-default');

      expect(rect.style.fill).toBe('');
      expect(markerBtn.style.getPropertyValue('background-color')).toBe('');
    });

    it('tolerates a toolbar button with no SVG rect (background color)', () => {
      markerBtn.remove();
      markerBtn = makeMarkerButton(false);

      container.innerHTML = 'no rect bg';
      select(requireNode(container.firstChild), 0, 3);

      expect(() => clickSwatch('marker-swatch-background-color-red')).not.toThrow();
      expect(markerBtn.style.getPropertyValue('background-color')).toBe('transparent');
    });

    it('tolerates a toolbar button with no SVG rect (text color)', () => {
      markerBtn.remove();
      markerBtn = makeMarkerButton(false);

      container.innerHTML = 'no rect text';
      select(requireNode(container.firstChild), 0, 3);

      expect(() => clickSwatch('marker-swatch-color-red')).not.toThrow();
      expect(markerBtn.style.getPropertyValue('color')).toBe(RED_TEXT_RGB);
    });

    it('tolerates a toolbar button with no SVG rect when resetting', () => {
      markerBtn.remove();
      markerBtn = makeMarkerButton(false);

      container.innerHTML = 'no rect reset';
      select(requireNode(container.firstChild), 0, 3);

      expect(() => menuOf(tool).children.onOpen()).not.toThrow();
      expect(markerBtn.style.getPropertyValue('color')).toBe('');
    });

    it('tolerates a toolbar button with no SVG rect when only a text color is active', () => {
      markerBtn.remove();
      markerBtn = makeMarkerButton(false);

      container.innerHTML = '<mark style="color: #d44c47">no rect text active</mark>';
      const mark = requireElement(container.querySelector('mark'));

      select(requireNode(mark.firstChild), 0, 4);

      // isActive reads the mark's colours and paints the button synchronously.
      expect(() => menuOf(tool).isActive()).not.toThrow();
      expect(markerBtn.style.getPropertyValue('color')).not.toBe('');
    });

    it('restores the selection and clears the saved range when the picker closes', () => {
      const sel = internalsOf(tool).selection;

      container.innerHTML = 'close me';
      sel.savedSelectionRange = select(requireNode(container.firstChild), 0, 5);

      const removeFakeBgSpy = vi.spyOn(sel, 'removeFakeBackground');
      const restoreSpy = vi.spyOn(sel, 'restore');

      menuOf(tool).children.onClose();

      expect(removeFakeBgSpy).toHaveBeenCalledTimes(1);
      expect(restoreSpy).toHaveBeenCalledTimes(1);
      expect(sel.savedSelectionRange).toBeNull();
    });

    it('tears down the fake background exactly once when nothing was saved', () => {
      const sel = internalsOf(tool).selection;

      sel.savedSelectionRange = null;

      const removeFakeBgSpy = vi.spyOn(sel, 'removeFakeBackground');
      const restoreSpy = vi.spyOn(sel, 'restore');

      menuOf(tool).children.onClose();

      expect(removeFakeBgSpy).toHaveBeenCalledTimes(1);
      expect(restoreSpy).not.toHaveBeenCalled();
      expect(sel.savedSelectionRange).toBeNull();
    });
  });
});
