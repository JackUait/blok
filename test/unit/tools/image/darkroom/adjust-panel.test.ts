import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAdjust } from '../../../../../types/tools/image';
import type { I18nInstance } from '../../../../../src/components/utils/tools';
import { createAdjustPanel } from '../../../../../src/tools/image/darkroom/adjust-panel';

type Adjust = Required<ImageAdjust>;

const LABELS: Record<string, string> = {
  'tools.image.adjustTools': 'Adjust tools',
  'tools.image.adjustBrightness': 'Brightness',
  'tools.image.adjustContrast': 'Contrast',
  'tools.image.adjustSaturation': 'Saturation',
  'tools.image.resetBrightness': 'Reset brightness',
  'tools.image.resetContrast': 'Reset contrast',
  'tools.image.resetSaturation': 'Reset saturation',
};

const i18n: I18nInstance = {
  has: (k) => k in LABELS,
  t: (k) => LABELS[k] ?? k,
};

const ZERO: Adjust = { brightness: 0, contrast: 0, saturation: 0 };

const key = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

describe('createAdjustPanel', () => {
  let onInput: ReturnType<typeof vi.fn<(a: Adjust) => void>>;
  let onCommit: ReturnType<typeof vi.fn<(a: Adjust) => void>>;
  let panel: ReturnType<typeof createAdjustPanel>;

  const make = (value: Adjust = ZERO): ReturnType<typeof createAdjustPanel> => {
    panel = createAdjustPanel({ i18n, value, onInput, onCommit });
    document.body.appendChild(panel.el);

    return panel;
  };

  const chip = (tool: string): HTMLElement => {
    const el = panel.el.querySelector<HTMLElement>(`[data-tool="${tool}"]`);

    if (el === null) throw new Error(`no chip ${tool}`);

    return el;
  };

  const dial = (): HTMLElement => {
    const el = panel.el.querySelector<HTMLElement>('[role="slider"]');

    if (el === null) throw new Error('no dial');

    return el;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    onInput = vi.fn<(a: Adjust) => void>();
    onCommit = vi.fn<(a: Adjust) => void>();
  });

  afterEach(() => {
    panel.destroy();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is a labelled radiogroup of three tool chips plus one dial', () => {
    make();
    const group = panel.el.querySelector('[role="radiogroup"]');

    expect(group?.getAttribute('aria-label')).toBe('Adjust tools');
    const radios = [...panel.el.querySelectorAll<HTMLElement>('[role="radio"]')];

    expect(radios.map((r) => r.textContent)).toEqual(['Brightness', 'Contrast', 'Saturation']);
    radios.forEach((r) => expect(r.getAttribute('type')).toBe('button'));
    expect(panel.el.querySelectorAll('[role="slider"]')).toHaveLength(1);
  });

  it('starts on Brightness with a -100..100 dial named after it', () => {
    make({ brightness: 20, contrast: 0, saturation: 0 });

    expect(chip('brightness').getAttribute('aria-checked')).toBe('true');
    expect(chip('brightness').getAttribute('data-active')).toBe('true');
    expect(chip('brightness').getAttribute('tabindex')).toBe('0');
    expect(chip('contrast').getAttribute('aria-checked')).toBe('false');
    expect(chip('contrast').getAttribute('tabindex')).toBe('-1');
    expect(dial().getAttribute('aria-label')).toBe('Brightness');
    expect(dial().getAttribute('aria-valuemin')).toBe('-100');
    expect(dial().getAttribute('aria-valuemax')).toBe('100');
    expect(dial().getAttribute('aria-valuenow')).toBe('20');
  });

  it('a chip drives the dial with its own value and name', () => {
    make({ brightness: 20, contrast: -30, saturation: 0 });

    chip('contrast').click();
    expect(chip('contrast').getAttribute('aria-checked')).toBe('true');
    expect(chip('brightness').getAttribute('aria-checked')).toBe('false');
    expect(dial().getAttribute('aria-label')).toBe('Contrast');
    expect(dial().getAttribute('aria-valuenow')).toBe('-30');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('arrow keys move between chips (roving radiogroup)', () => {
    make();
    chip('brightness').focus();

    key(chip('brightness'), 'ArrowRight');
    expect(chip('contrast')).toHaveFocus();
    expect(dial().getAttribute('aria-label')).toBe('Contrast');
    key(chip('contrast'), 'ArrowLeft');
    key(chip('brightness'), 'ArrowLeft');
    expect(chip('saturation').getAttribute('aria-checked')).toBe('true');
  });

  it('the dial edits the selected tool and reports the whole adjust', () => {
    make({ brightness: 10, contrast: 0, saturation: 0 });
    chip('saturation').click();

    key(dial(), 'ArrowRight');
    expect(onInput).toHaveBeenLastCalledWith({ brightness: 10, contrast: 0, saturation: 1 });
    vi.advanceTimersByTime(250);
    expect(onCommit).toHaveBeenLastCalledWith({ brightness: 10, contrast: 0, saturation: 1 });
  });

  it('hands out a fresh object each time', () => {
    make();

    key(dial(), 'ArrowRight');
    key(dial(), 'ArrowRight');
    const [first, second] = onInput.mock.calls.map((c) => c[0]);

    expect(first).not.toBe(second);
    expect(first).toEqual({ brightness: 1, contrast: 0, saturation: 0 });
  });

  it('switching tool commits a pending key burst for the old tool first', () => {
    make();

    key(dial(), 'ArrowRight');
    chip('contrast').click();
    expect(onCommit).toHaveBeenCalledWith({ brightness: 1, contrast: 0, saturation: 0 });
    vi.advanceTimersByTime(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  describe('per-tool reset', () => {
    const reset = (tool: string): HTMLButtonElement => {
      const el = panel.el.querySelector<HTMLButtonElement>(`[data-role="adjust-reset"][data-tool="${tool}"]`);

      if (el === null) throw new Error(`no reset ${tool}`);

      return el;
    };
    const shown = (tool: string): string | null => reset(tool).getAttribute('data-shown');

    it('each changed tool gets its own named reset, a sibling of its radio and outside the radiogroup', () => {
      make({ brightness: 0, contrast: 5, saturation: 0 });

      expect(chip('brightness').getAttribute('data-changed')).toBe('false');
      expect(chip('contrast').getAttribute('data-changed')).toBe('true');
      expect(reset('contrast').getAttribute('aria-label')).toBe('Reset contrast');
      expect(reset('contrast').tagName).toBe('BUTTON');
      expect(chip('contrast').contains(reset('contrast'))).toBe(false);
      expect(reset('contrast').closest('[role="radiogroup"]')).toBeNull();
      expect(reset('contrast').getAttribute('role')).toBeNull();
      expect(shown('contrast')).toBe('true');
      expect(shown('brightness')).toBe('false');
      key(dial(), 'ArrowRight');
      expect(shown('brightness')).toBe('true');
      key(dial(), 'ArrowLeft');
      expect(shown('brightness')).toBe('false');
    });

    it('a reset clears only its tool, commits once, and keeps the selected tool', () => {
      make({ brightness: 10, contrast: 5, saturation: 0 });

      reset('contrast').click();

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith({ brightness: 10, contrast: 0, saturation: 0 });
      expect(chip('brightness').getAttribute('aria-checked')).toBe('true');
      expect(dial().getAttribute('aria-valuenow')).toBe('10');
      expect(shown('contrast')).toBe('false');
    });

    it('resetting the selected tool moves the dial to 0', () => {
      make({ brightness: 10, contrast: 0, saturation: 0 });

      reset('brightness').click();

      expect(dial().getAttribute('aria-valuenow')).toBe('0');
    });

    it('a pending dial key burst is its own step before a reset', () => {
      make({ brightness: 0, contrast: 5, saturation: 0 });

      key(dial(), 'ArrowRight');
      reset('contrast').click();
      vi.advanceTimersByTime(1000);

      expect(onCommit.mock.calls).toEqual([
        [{ brightness: 1, contrast: 5, saturation: 0 }],
        [{ brightness: 1, contrast: 0, saturation: 0 }],
      ]);
    });

    it('a focused reset that disappears hands focus to the dial', () => {
      make({ brightness: 0, contrast: 5, saturation: 0 });

      reset('contrast').focus();
      reset('contrast').click();

      expect(dial()).toHaveFocus();
    });

    it('the dial has no reset of its own here, but a double-click still resets the selected tool', () => {
      make({ brightness: 7, contrast: 0, saturation: 0 });

      expect(panel.el.querySelector('[data-role="dial-reset"]')).toBeNull();
      dial().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

      expect(onCommit).toHaveBeenCalledWith({ brightness: 0, contrast: 0, saturation: 0 });
    });
  });

  it('set() updates the chips and dial without callbacks', () => {
    make();

    key(dial(), 'ArrowRight');
    onInput.mockClear();
    panel.set({ brightness: -40, contrast: 0, saturation: 12 });
    vi.advanceTimersByTime(1000);
    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(dial().getAttribute('aria-valuenow')).toBe('-40');
    expect(chip('saturation').getAttribute('data-changed')).toBe('true');
    expect(chip('brightness').getAttribute('data-changed')).toBe('true');
  });

  it('flush() commits a pending key burst now', () => {
    make();

    key(dial(), 'ArrowRight');
    panel.flush();
    expect(onCommit).toHaveBeenCalledWith({ brightness: 1, contrast: 0, saturation: 0 });
  });

  it('falls back to English labels without an i18n instance', () => {
    panel = createAdjustPanel({ value: ZERO, onInput, onCommit });
    document.body.appendChild(panel.el);

    expect(panel.el.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(dial().getAttribute('aria-label')).not.toBe('');
  });

  it('destroy() drops a pending commit and the chip handlers', () => {
    make();

    key(dial(), 'ArrowRight');
    panel.destroy();
    vi.advanceTimersByTime(1000);
    chip('contrast').click();
    expect(onCommit).not.toHaveBeenCalled();
    expect(chip('contrast').getAttribute('aria-checked')).toBe('false');
  });
});
