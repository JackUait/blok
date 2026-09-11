import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { openAltPopover } from '../../../../src/tools/image/alt-popover';
import type { I18nInstance } from '../../../../src/components/utils/tools';

const echoI18n = (): I18nInstance => ({
  has: () => true,
  t: (key: string) => `i18n:${key}`,
});

interface Opened {
  anchor: HTMLElement;
  popover: HTMLElement;
  textarea: HTMLTextAreaElement;
  description: HTMLElement;
  onSave: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  detach: () => void;
}

const open = ({ value = 'a cat', i18n = echoI18n(), anchor = document.createElement('button') } = {}): Opened => {
  if (anchor.parentNode === null) {
    document.body.appendChild(anchor);
  }

  const onSave = vi.fn();
  const onCancel = vi.fn();
  const detach = openAltPopover({ anchor, value, onSave, onCancel, i18n });
  const popover = document.querySelector<HTMLElement>('[data-role="image-alt-popover"]');

  if (popover === null) {
    throw new Error('no popover was mounted');
  }

  const textarea = popover.querySelector('textarea');
  const description = popover.querySelector<HTMLElement>('p');

  if (textarea === null || description === null) {
    throw new Error('the popover is missing its field or description');
  }

  return { anchor, popover, textarea, description, onSave, onCancel, detach };
};

const pressEnter = (textarea: HTMLTextAreaElement, { shiftKey = false } = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true });

  textarea.dispatchEvent(event);

  return event;
};

describe('image alt popover mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('what it puts on screen', () => {
    it('seeds the field with the current alt text and parks the caret at its end', () => {
      const { textarea } = open({ value: 'a cat' });

      expect(textarea.value).toBe('a cat');
      expect(textarea.rows).toBe(2);
      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });

    it('routes its description, placeholder and label through i18n', () => {
      const { textarea, description } = open();

      expect(description.textContent).toBe('i18n:tools.image.altDescription');
      expect(textarea.placeholder).toBe('i18n:tools.image.altPlaceholder');
    });

    it('names the popover and its field for the stylesheet', () => {
      const { popover, textarea, description } = open();

      expect(popover.className).toBe('blok-image-alt-popover');
      expect(textarea.className).toContain('blok-image-alt-popover__input');
      expect(description.className).toBe('blok-image-alt-popover__description');
    });

    it('opens as a labelled dialog with the field focused', () => {
      const { popover, textarea } = open();
      const dialog = popover.closest('[role="dialog"]') ?? popover.parentElement;

      expect(dialog?.getAttribute('role')).toBe('dialog');
      expect(dialog?.getAttribute('aria-label')).toBe('i18n:tools.image.altEdit');
      expect(textarea).toHaveFocus();
    });

    it('parks the caret at the end rather than trusting the browser default', () => {
      const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');

      open({ value: 'a cat' });

      expect(setSelectionRange).toHaveBeenCalledWith(5, 5);
    });

    it('anchors itself below the trigger', () => {
      const { popover } = open();

      expect(popover.style.position).toBe('fixed');
      expect(popover.getAttribute('data-side')).toBe('bottom');
    });

    it('counts description ids upward', () => {
      const first = open();
      const firstNumber = Number(/-(\d+)$/.exec(first.description.id)?.[1] ?? NaN);

      first.detach();

      const second = open({ anchor: document.createElement('button') });
      const secondNumber = Number(/-(\d+)$/.exec(second.description.id)?.[1] ?? NaN);

      expect(firstNumber).not.toBeNaN();
      expect(secondNumber).toBe(firstNumber + 1);
    });

    it('describes the dialog by the paragraph it just minted', () => {
      const { popover, description } = open();
      const dialog = popover.closest('[role="dialog"]') ?? popover.parentElement;

      expect(description.id).not.toBe('');
      expect(dialog?.getAttribute('aria-describedby')).toBe(description.id);
    });

    it('mints a fresh description id for every popover', () => {
      const first = open();
      const firstId = first.description.id;

      first.detach();

      const second = open({ anchor: document.createElement('button') });

      expect(second.description.id).not.toBe(firstId);
    });
  });

  describe('committing', () => {
    it('saves the typed text on Enter and swallows the keystroke', () => {
      const { textarea, onSave, onCancel } = open({ value: 'old' });

      textarea.value = 'new alt';

      const event = pressEnter(textarea);

      expect(onSave).toHaveBeenCalledWith('new alt');
      expect(onCancel).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(document.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    });

    it('lets Shift+Enter through as a newline', () => {
      const { textarea, onSave } = open();

      const event = pressEnter(textarea, { shiftKey: true });

      expect(onSave).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(document.querySelector('[data-role="image-alt-popover"]')).not.toBeNull();
    });

    it('ignores every other key', () => {
      const { textarea, onSave } = open();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));

      expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps the Enter keystroke from reaching the page behind it', () => {
      const { textarea } = open();
      const seen = vi.fn();

      document.addEventListener('keydown', seen);

      try {
        pressEnter(textarea);
      } finally {
        document.removeEventListener('keydown', seen);
      }

      expect(seen).not.toHaveBeenCalled();
    });

    it('saves only once however many times Enter is pressed', () => {
      const { textarea, onSave } = open();

      pressEnter(textarea);
      pressEnter(textarea);

      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('detaching', () => {
    it('closes without saving or cancelling', () => {
      const { detach, onSave, onCancel } = open();

      detach();

      expect(onSave).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(document.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    });

    it('is safe to call twice', () => {
      const { detach } = open();

      detach();

      expect(() => detach()).not.toThrow();
    });

    it('tears the dialog down once however many times the handle is called', () => {
      const remove = vi.spyOn(Element.prototype, 'remove');
      const { detach } = open();

      detach();
      detach();
      detach();

      expect(remove.mock.calls.length).toBe(1);
    });

    it('stops a later Enter from saving', () => {
      const { textarea, detach, onSave } = open();

      detach();
      pressEnter(textarea);

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('dismissal', () => {
    it('discards the edit when Escape closes it', () => {
      const { textarea, onSave, onCancel } = open({ value: 'old' });

      textarea.value = 'edited';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
      expect(document.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    });

    it('ignores events that arrive after the caller already detached it', () => {
      const { detach, onCancel, onSave } = open({ value: 'old' });

      detach();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(onCancel).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('commits the edit when a press outside closes it', () => {
      const { textarea, onSave, onCancel } = open({ value: 'old' });

      textarea.value = 'edited';
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      expect(onSave).toHaveBeenCalledWith('edited');
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('swallows the click that follows an outside dismissal on the same trigger', () => {
      const anchor = document.createElement('button');

      document.body.appendChild(anchor);

      const first = open({ anchor });

      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(first.onSave).toHaveBeenCalledTimes(1);

      const onSave = vi.fn();
      const onCancel = vi.fn();

      openAltPopover({ anchor, value: 'x', onSave, onCancel, i18n: echoI18n() });

      expect(document.querySelector('[data-role="image-alt-popover"]')).toBeNull();
    });

    it('lets a different trigger open straight away', () => {
      const anchor = document.createElement('button');

      document.body.appendChild(anchor);
      open({ anchor });
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      const other = document.createElement('button');

      document.body.appendChild(other);
      openAltPopover({ anchor: other, value: 'x', onSave: vi.fn(), onCancel: vi.fn(), i18n: echoI18n() });

      expect(document.querySelector('[data-role="image-alt-popover"]')).not.toBeNull();
    });

    it('still swallows a re-open at exactly the end of the bounce window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const anchor = document.createElement('button');

      document.body.appendChild(anchor);
      open({ anchor });
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      vi.setSystemTime(new Date('2026-01-01T00:00:00.199Z'));
      openAltPopover({ anchor, value: 'x', onSave: vi.fn(), onCancel: vi.fn(), i18n: echoI18n() });

      expect(document.querySelector('[data-role="image-alt-popover"]')).toBeNull();

      vi.setSystemTime(new Date('2026-01-01T00:00:00.200Z'));
      openAltPopover({ anchor, value: 'x', onSave: vi.fn(), onCancel: vi.fn(), i18n: echoI18n() });

      expect(document.querySelector('[data-role="image-alt-popover"]')).not.toBeNull();
    });

    it('lets the same trigger open again once the bounce window has passed', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const anchor = document.createElement('button');

      document.body.appendChild(anchor);
      open({ anchor });
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'));

      openAltPopover({ anchor, value: 'x', onSave: vi.fn(), onCancel: vi.fn(), i18n: echoI18n() });

      expect(document.querySelector('[data-role="image-alt-popover"]')).not.toBeNull();
    });
  });

  describe('staying anchored', () => {
    it('mints description ids as one dash plus a run of digits', () => {
      const first = open();
      const firstNumber = Number(/-(\d+)$/.exec(first.description.id)?.[1] ?? NaN);

      first.detach();

      const second = open({ anchor: document.createElement('button') });
      const secondNumber = Number(/-(\d+)$/.exec(second.description.id)?.[1] ?? NaN);

      expect(first.description.id).toMatch(/^blok-image-alt-popover-description-\d+$/);
      expect(second.description.id).toMatch(/^blok-image-alt-popover-description-\d+$/);
      expect(secondNumber).toBeGreaterThan(firstNumber);
    });

    it('re-measures the anchor when the page scrolls or resizes', () => {
      const anchor = document.createElement('button');

      document.body.appendChild(anchor);

      const measure = vi.spyOn(anchor, 'getBoundingClientRect');

      open({ anchor });

      const afterOpen = measure.mock.calls.length;

      expect(afterOpen).toBe(1);

      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));

      expect(measure.mock.calls.length).toBe(afterOpen + 2);
    });

    it('unhooks the window listeners it installed when it closes', () => {
      const added = vi.spyOn(window, 'addEventListener');
      const removed = vi.spyOn(window, 'removeEventListener');
      const anchor = document.createElement('button');

      document.body.appendChild(anchor);

      const { detach } = open({ anchor });

      const scrollHandler = added.mock.calls.find((call) => call[0] === 'scroll')?.[1];
      const resizeHandler = added.mock.calls.find((call) => call[0] === 'resize')?.[1];

      expect(scrollHandler).toBeDefined();
      expect(resizeHandler).toBeDefined();

      detach();

      expect(removed.mock.calls.some((call) => call[0] === 'scroll' && call[1] === scrollHandler)).toBe(true);
      expect(removed.mock.calls.some((call) => call[0] === 'resize' && call[1] === resizeHandler)).toBe(true);
    });
  });
});
