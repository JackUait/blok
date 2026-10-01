import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nInstance } from '../../../../../src/components/utils/tools';
import { contrastInk, MARKUP_COLORS } from '../../../../../src/tools/image/markup/model';
import {
  createMarkupPanel,
  DEFAULT_MARKUP_STATE,
  defaultColorFor,
} from '../../../../../src/tools/image/darkroom/markup-panel';
import type {
  MarkupPanel,
  MarkupPanelState,
  MarkupSelectionKind,
  MarkupTool,
} from '../../../../../src/tools/image/darkroom/markup-panel';

const LABELS: Record<string, string> = {
  'tools.image.markupTools': 'Markup tools',
  'tools.image.markupSelect': 'Select',
  'tools.image.markupPen': 'Pen',
  'tools.image.markupHighlighter': 'Highlighter',
  'tools.image.markupText': 'Text',
  'tools.image.markupRectangle': 'Rectangle',
  'tools.image.markupEllipse': 'Ellipse',
  'tools.image.markupArrow': 'Arrow',
  'tools.image.markupLine': 'Line',
  'tools.image.markupEraser': 'Eraser',
  'tools.image.markupColors': 'Colors',
  'tools.image.markupColorWhite': 'White',
  'tools.image.markupColorBlack': 'Black',
  'tools.colorPicker.color.red': 'Red',
  'tools.colorPicker.color.orange': 'Orange',
  'tools.colorPicker.color.yellow': 'Yellow',
  'tools.colorPicker.color.green': 'Green',
  'tools.colorPicker.color.blue': 'Blue',
  'tools.colorPicker.color.purple': 'Purple',
  'tools.colorPicker.color.pink': 'Pink',
  'tools.image.markupSizes': 'Stroke width',
  'tools.image.markupSizeThin': 'Thin',
  'tools.image.markupSizeMedium': 'Medium',
  'tools.image.markupSizeThick': 'Thick',
  'tools.image.markupTextStyles': 'Text style',
  'tools.image.markupTextPlain': 'Plain',
  'tools.image.markupTextOutline': 'Outline',
  'tools.image.markupTextBackground': 'Background',
  'tools.image.markupFill': 'Fill',
  'tools.image.resetMarkup': 'Clear markup',
  'blockSettings.delete': 'Delete',
};

const i18n: I18nInstance = {
  has: (k) => k in LABELS,
  t: (k) => LABELS[k] ?? k,
};

/** Visual rail order, which is also the arrow-key order. */
const RAIL: MarkupTool[] = ['select', 'pen', 'highlighter', 'eraser', 'text', 'rect', 'ellipse', 'arrow', 'line'];

const COLOR_NAMES = ['White', 'Black', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'];

const RED = '#ff3b30';
const YELLOW = '#ffcc00';
const WHITE = '#ffffff';
const GREEN = '#34c759';
const BLUE = '#0a84ff';

const key = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

type OnChange = (next: MarkupPanelState, changed: keyof MarkupPanelState) => void;

describe('markup panel', () => {
  let onChange: ReturnType<typeof vi.fn<OnChange>>;
  let onDelete: ReturnType<typeof vi.fn<() => void>>;
  let onClear: ReturnType<typeof vi.fn<() => void>>;
  let panel: MarkupPanel;
  const created: MarkupPanel[] = [];

  const make = (state: Partial<MarkupPanelState> = {}): MarkupPanel => {
    panel = createMarkupPanel({ i18n, state: { ...DEFAULT_MARKUP_STATE, ...state }, onChange, onDelete, onClear });
    created.push(panel);
    document.body.appendChild(panel.el);

    return panel;
  };

  const q = (testid: string): HTMLElement => {
    const el = panel.el.querySelector<HTMLElement>(`[data-blok-testid="${testid}"]`);

    if (el === null) throw new Error(`no ${testid}`);

    return el;
  };

  const tool = (t: MarkupTool): HTMLElement => q(`markup-tool-${t}`);
  const swatch = (hex: string): HTMLElement => q(`markup-color-${hex.slice(1)}`);
  const size = (n: number): HTMLElement => q(`markup-size-${n}`);
  const textStyle = (s: string): HTMLElement => q(`markup-text-style-${s}`);
  const group = (label: string): HTMLElement => {
    const el = panel.el.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${label}"]`);

    if (el === null) throw new Error(`no group ${label}`);

    return el;
  };

  /** Shown means neither it nor an ancestor inside the panel is [hidden]. */
  const shown = (el: HTMLElement): boolean => {
    for (let n: HTMLElement | null = el; n !== null && n !== panel.el.parentElement; n = n.parentElement) {
      if (n.hidden) return false;
    }

    return true;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn<OnChange>();
    onDelete = vi.fn<() => void>();
    onClear = vi.fn<() => void>();
  });

  afterEach(() => {
    created.splice(0).forEach((p) => p.destroy());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('exports', () => {
    it('defaults to a medium red pen with outlined text and no fill', () => {
      expect(DEFAULT_MARKUP_STATE).toEqual({ tool: 'pen', color: RED, size: 1, textStyle: 'outline', fill: false });
    });

    it('gives pen red, highlighter yellow, text white, and no default for the rest', () => {
      expect(defaultColorFor('pen')).toBe(RED);
      expect(defaultColorFor('highlighter')).toBe(YELLOW);
      expect(defaultColorFor('text')).toBe(WHITE);
      (['select', 'rect', 'ellipse', 'arrow', 'line', 'eraser'] as const).forEach((t) => {
        expect(defaultColorFor(t)).toBeNull();
      });
    });
  });

  describe('render', () => {
    it('is a darkroom panel', () => {
      make();

      expect(panel.el.classList.contains('blok-darkroom__panel')).toBe(true);
      expect(panel.el.classList.contains('blok-darkroom__markup')).toBe(true);
    });

    it('renders the tool rail as a labelled radiogroup in visual order', () => {
      make();
      const rail = group('Markup tools');
      const radios = [...rail.querySelectorAll<HTMLElement>('[role="radio"]')];

      expect(radios.map((r) => r.getAttribute('data-tool'))).toEqual(RAIL);
      expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(
        ['Select', 'Pen', 'Highlighter', 'Eraser', 'Text', 'Rectangle', 'Ellipse', 'Arrow', 'Line']
      );
      radios.forEach((r) => expect(r.querySelector('svg')).not.toBeNull());
    });

    it('shows each tool shortcut letter in its title and aria-keyshortcuts', () => {
      make();
      const letters: Record<MarkupTool, string> = {
        select: 'V', pen: 'P', highlighter: 'H', eraser: 'E', text: 'T', rect: 'R', ellipse: 'O', arrow: 'A', line: 'L',
      };

      RAIL.forEach((t) => {
        expect(tool(t).getAttribute('aria-keyshortcuts')).toBe(letters[t]);
        expect(tool(t).title).toContain(letters[t]);
      });
      expect(tool('pen').title).toContain('Pen');
    });

    it('splits the rail into four groups with three hairlines', () => {
      make();
      const rail = group('Markup tools');
      const order = [...rail.children]
        .filter((c) => c.hasAttribute('data-tool') || c.classList.contains('blok-darkroom__markup-sep'))
        .map((c) => c.getAttribute('data-tool') ?? '|');

      expect(order).toEqual(['select', '|', 'pen', 'highlighter', 'eraser', '|', 'text', '|', 'rect', 'ellipse', 'arrow', 'line']);
      rail.querySelectorAll('.blok-darkroom__markup-sep').forEach((s) => expect(s.getAttribute('aria-hidden')).toBe('true'));
    });

    it('checks the current tool and parks the sliding puck on it', () => {
      make({ tool: 'text' });
      const puck = panel.el.querySelector<HTMLElement>('.blok-darkroom__markup-puck');

      expect(tool('text').getAttribute('aria-checked')).toBe('true');
      expect(tool('pen').getAttribute('aria-checked')).toBe('false');
      expect(puck?.getAttribute('aria-hidden')).toBe('true');
      // text is the 5th button after two hairlines.
      expect(group('Markup tools').style.getPropertyValue('--blok-markup-puck-i')).toBe('4');
      expect(group('Markup tools').style.getPropertyValue('--blok-markup-puck-s')).toBe('2');
    });

    it('renders nine labelled swatches in palette order', () => {
      make();
      const swatches = [...group('Colors').querySelectorAll<HTMLElement>('[role="radio"]')];

      expect(swatches.map((s) => s.getAttribute('data-color'))).toEqual([...MARKUP_COLORS]);
      expect(swatches.map((s) => s.getAttribute('aria-label'))).toEqual(COLOR_NAMES);
    });

    it('marks the selected swatch with a check in the contrasting ink', () => {
      make({ color: YELLOW });

      expect(swatch(YELLOW).getAttribute('aria-checked')).toBe('true');
      expect(swatch(RED).getAttribute('aria-checked')).toBe('false');
      expect(swatch(YELLOW).querySelector('svg')).not.toBeNull();
      expect(swatch(YELLOW).style.getPropertyValue('--blok-markup-swatch-ink')).toBe(contrastInk(YELLOW));
      expect(swatch(BLUE).style.getPropertyValue('--blok-markup-swatch')).toBe(BLUE);
    });

    it('renders three labelled sizes painted in the current colour', () => {
      make({ color: GREEN, size: 2 });
      const sizes = [...group('Stroke width').querySelectorAll<HTMLElement>('[role="radio"]')];

      expect(sizes.map((s) => s.getAttribute('data-size'))).toEqual(['0', '1', '2']);
      expect(sizes.map((s) => s.getAttribute('aria-label'))).toEqual(['Thin', 'Medium', 'Thick']);
      expect(size(2).getAttribute('aria-checked')).toBe('true');
      expect(panel.el.style.getPropertyValue('--blok-markup-color')).toBe(GREEN);
      expect(panel.el.style.getPropertyValue('--blok-markup-ink')).toBe(contrastInk(GREEN));
    });

    it('renders text styles with an Aa preview each', () => {
      make({ tool: 'text', textStyle: 'background' });
      const styles = [...group('Text style').querySelectorAll<HTMLElement>('[role="radio"]')];

      expect(styles.map((s) => s.getAttribute('data-style'))).toEqual(['plain', 'outline', 'background']);
      expect(styles.map((s) => s.getAttribute('aria-label'))).toEqual(['Plain', 'Outline', 'Background']);
      styles.forEach((s) => expect(s.textContent).toBe('Aa'));
      expect(textStyle('background').getAttribute('aria-checked')).toBe('true');
    });

    it('renders the fill toggle and delete button with names', () => {
      make({ tool: 'rect', fill: true });
      panel.setSelection('rect');

      expect(q('markup-fill').getAttribute('aria-label')).toBe('Fill');
      expect(q('markup-fill').getAttribute('aria-pressed')).toBe('true');
      expect(q('markup-delete').getAttribute('aria-label')).toBe('Delete');
      expect(q('markup-delete').querySelector('svg')).not.toBeNull();
    });

    it('renders the Clear markup reset like the other panel resets, hidden at first', () => {
      make();
      const reset = q('markup-reset');

      expect(reset.className).toBe('blok-darkroom__btn blok-darkroom__btn--ghost blok-darkroom__panel-reset');
      expect(reset.getAttribute('data-action')).toBe('reset-markup');
      expect(reset.textContent).toBe('Clear markup');
      expect(reset.getAttribute('data-shown')).toBe('false');
      expect(reset.parentElement).toBe(panel.el);
    });

    it('gives every button an accessible name and type=button', () => {
      make({ tool: 'text' });
      panel.setSelection('text');

      panel.el.querySelectorAll('button').forEach((b) => {
        expect(b.type).toBe('button');
        expect(b.getAttribute('aria-label') ?? b.textContent).not.toBe('');
      });
    });

    it('falls back to English without an i18n instance', () => {
      panel = createMarkupPanel({ state: DEFAULT_MARKUP_STATE, onChange, onDelete, onClear });
      created.push(panel);
      document.body.appendChild(panel.el);

      expect(tool('pen').getAttribute('aria-label')).toBe('Pen');
      expect(swatch(RED).getAttribute('aria-label')).toBe('Red');
    });
  });

  describe('picking', () => {
    it('reports a tool pick with the full next state', () => {
      make();
      tool('rect').click();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'rect' }, 'tool');
      expect(tool('rect').getAttribute('aria-checked')).toBe('true');
    });

    it('ignores a click on the current tool, colour or size', () => {
      make();
      tool('pen').click();
      swatch(RED).click();
      size(1).click();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('reports a colour pick', () => {
      make();
      swatch(GREEN).click();

      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MARKUP_STATE, color: GREEN }, 'color');
      expect(swatch(GREEN).getAttribute('aria-checked')).toBe('true');
      expect(panel.el.style.getPropertyValue('--blok-markup-color')).toBe(GREEN);
    });

    it('reports a size pick', () => {
      make();
      size(0).click();

      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MARKUP_STATE, size: 0 }, 'size');
    });

    it('reports a text style pick', () => {
      make({ tool: 'text', color: WHITE });
      textStyle('plain').click();

      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'text', color: WHITE, textStyle: 'plain' }, 'textStyle');
    });

    it('toggles fill both ways', () => {
      make({ tool: 'ellipse' });
      q('markup-fill').click();

      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'ellipse', fill: true }, 'fill');
      expect(q('markup-fill').getAttribute('aria-pressed')).toBe('true');
      q('markup-fill').click();
      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'ellipse', fill: false }, 'fill');
    });

    it('calls onDelete and onClear from their buttons', () => {
      make();
      panel.setSelection('pen');
      panel.setHasMarkup(true);
      q('markup-delete').click();
      q('markup-reset').click();

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('hands back a copy, so the caller cannot mutate panel state', () => {
      make();
      tool('line').click();
      const [next] = onChange.mock.calls[0];

      next.tool = 'pen';
      swatch(GREEN).click();
      expect(onChange.mock.calls[1][0].tool).toBe('line');
    });
  });

  describe('per-tool colour', () => {
    it('switches to the tool default colour when picking pen, highlighter or text', () => {
      make({ tool: 'rect', color: GREEN });
      tool('highlighter').click();

      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'highlighter', color: YELLOW }, 'tool');
      tool('text').click();
      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'text', color: WHITE }, 'tool');
      expect(swatch(WHITE).getAttribute('aria-checked')).toBe('true');
    });

    it('keeps the current colour for tools without a default', () => {
      make({ tool: 'pen', color: RED });
      tool('arrow').click();

      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MARKUP_STATE, tool: 'arrow', color: RED }, 'tool');
    });

    it('remembers the last colour the user picked for each drawing tool', () => {
      make({ tool: 'pen', color: RED });
      swatch(GREEN).click();
      tool('highlighter').click();
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'highlighter', color: YELLOW }), 'tool');
      swatch(BLUE).click();
      tool('pen').click();
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'pen', color: GREEN }), 'tool');
      tool('highlighter').click();
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'highlighter', color: BLUE }), 'tool');
    });

    it('does not learn colours from set()', () => {
      make({ tool: 'pen', color: RED });
      panel.set({ ...DEFAULT_MARKUP_STATE, tool: 'pen', color: GREEN });
      tool('rect').click();
      tool('pen').click();

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'pen', color: RED }), 'tool');
    });
  });

  describe('keyboard', () => {
    it('keeps one tab stop per group on the checked radio', () => {
      make({ tool: 'rect', color: BLUE, size: 0 });

      expect(tool('rect').getAttribute('tabindex')).toBe('0');
      expect(tool('pen').getAttribute('tabindex')).toBe('-1');
      expect(swatch(BLUE).getAttribute('tabindex')).toBe('0');
      expect(swatch(RED).getAttribute('tabindex')).toBe('-1');
      expect(size(0).getAttribute('tabindex')).toBe('0');
    });

    it('moves through the rail with arrows in visual order and reports each pick', () => {
      make({ tool: 'highlighter', color: YELLOW });
      key(tool('highlighter'), 'ArrowRight');

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'eraser' }), 'tool');
      expect(tool('eraser')).toHaveFocus();
      key(tool('eraser'), 'End');
      expect(tool('line')).toHaveFocus();
      key(tool('line'), 'ArrowRight');
      expect(tool('select')).toHaveFocus();
    });

    it('moves through swatches and sizes with arrows', () => {
      make();
      key(swatch(RED), 'ArrowLeft');

      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ color: '#111111' }), 'color');
      key(size(1), 'ArrowRight');
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ size: 2 }), 'size');
      expect(size(2)).toHaveFocus();
    });
  });

  describe('set()', () => {
    it('updates every control without calling back', () => {
      make();
      panel.set({ tool: 'text', color: BLUE, size: 2, textStyle: 'plain', fill: true });

      expect(onChange).not.toHaveBeenCalled();
      expect(tool('text').getAttribute('aria-checked')).toBe('true');
      expect(tool('text').getAttribute('tabindex')).toBe('0');
      expect(swatch(BLUE).getAttribute('aria-checked')).toBe('true');
      expect(size(2).getAttribute('aria-checked')).toBe('true');
      expect(textStyle('plain').getAttribute('aria-checked')).toBe('true');
      expect(q('markup-fill').getAttribute('aria-pressed')).toBe('true');
      expect(panel.el.style.getPropertyValue('--blok-markup-color')).toBe(BLUE);
    });
  });

  describe('contextual controls', () => {
    const colors = (): HTMLElement => group('Colors');
    const sizes = (): HTMLElement => group('Stroke width');
    const styles = (): HTMLElement => group('Text style');

    interface Case { tool: MarkupTool; sel: MarkupSelectionKind; color: boolean; style: boolean; fill: boolean; del: boolean }

    const CASES: Case[] = [
      { tool: 'pen', sel: null, color: true, style: false, fill: false, del: false },
      { tool: 'highlighter', sel: null, color: true, style: false, fill: false, del: false },
      { tool: 'eraser', sel: null, color: false, style: false, fill: false, del: false },
      { tool: 'select', sel: null, color: false, style: false, fill: false, del: false },
      { tool: 'text', sel: null, color: true, style: true, fill: false, del: false },
      { tool: 'rect', sel: null, color: true, style: false, fill: true, del: false },
      { tool: 'ellipse', sel: null, color: true, style: false, fill: true, del: false },
      { tool: 'arrow', sel: null, color: true, style: false, fill: false, del: false },
      { tool: 'line', sel: null, color: true, style: false, fill: false, del: false },
      { tool: 'select', sel: 'pen', color: true, style: false, fill: false, del: true },
      { tool: 'select', sel: 'highlighter', color: true, style: false, fill: false, del: true },
      { tool: 'select', sel: 'text', color: true, style: true, fill: false, del: true },
      { tool: 'select', sel: 'rect', color: true, style: false, fill: true, del: true },
      { tool: 'select', sel: 'ellipse', color: true, style: false, fill: true, del: true },
      { tool: 'select', sel: 'arrow', color: true, style: false, fill: false, del: true },
      { tool: 'select', sel: 'line', color: true, style: false, fill: false, del: true },
    ];

    it.each(CASES)('tool $tool, selection $sel', (c) => {
      make({ tool: c.tool });
      panel.setSelection(c.sel);

      expect(shown(colors())).toBe(c.color);
      expect(shown(sizes())).toBe(c.color);
      expect(shown(styles())).toBe(c.style);
      expect(shown(q('markup-fill'))).toBe(c.fill);
      expect(shown(q('markup-delete'))).toBe(c.del);
      expect(panel.el.hasAttribute('data-context-empty')).toBe(!c.color && !c.style && !c.fill && !c.del);
    });

    it('flags an empty context row as the user picks, so the rail can take its room', () => {
      make({ tool: 'pen' });
      expect(panel.el.hasAttribute('data-context-empty')).toBe(false);
      tool('select').click();
      expect(panel.el.hasAttribute('data-context-empty')).toBe(true);
      panel.setSelection('rect');
      expect(panel.el.hasAttribute('data-context-empty')).toBe(false);
    });

    it('follows the tool as the user picks', () => {
      make({ tool: 'pen' });
      tool('text').click();

      expect(shown(styles())).toBe(true);
      tool('eraser').click();
      expect(shown(colors())).toBe(false);
      expect(shown(styles())).toBe(false);
    });

    it('moves focus to the checked tool when a focused control hides', () => {
      make({ tool: 'select' });
      panel.setSelection('rect');
      q('markup-delete').focus();
      panel.setSelection(null);

      expect(tool('select')).toHaveFocus();
    });

    it('moves focus to the checked tool when a focused swatch hides', () => {
      make({ tool: 'select' });
      panel.setSelection('pen');
      swatch(RED).focus();
      panel.setSelection(null);

      expect(tool('select')).toHaveFocus();
    });

    it('leaves focus alone when the focused control stays', () => {
      make({ tool: 'select' });
      panel.setSelection('pen');
      swatch(RED).focus();
      panel.setSelection('arrow');

      expect(swatch(RED)).toHaveFocus();
    });
  });

  describe('setHasMarkup', () => {
    it('shows and hides the reset by data-shown', () => {
      make();
      panel.setHasMarkup(true);

      expect(q('markup-reset').getAttribute('data-shown')).toBe('true');
      panel.setHasMarkup(false);
      expect(q('markup-reset').getAttribute('data-shown')).toBe('false');
    });

    it('hands focus to the checked tool when the focused reset hides', () => {
      make({ tool: 'arrow' });
      panel.setHasMarkup(true);
      q('markup-reset').focus();
      panel.setHasMarkup(false);

      expect(tool('arrow')).toHaveFocus();
    });
  });

  describe('destroy', () => {
    it('detaches handlers', () => {
      make();
      panel.destroy();
      tool('rect').click();
      swatch(GREEN).click();
      key(size(1), 'ArrowRight');

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
