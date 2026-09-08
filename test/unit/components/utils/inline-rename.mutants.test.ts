import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { startInlineRename, type StartInlineRenameParams } from '../../../../src/components/utils/inline-rename';

interface Handles {
  host: HTMLElement;
  input: HTMLInputElement;
  onCommit: Mock<(value: string) => void>;
  onCancel: Mock<() => void>;
  onInput: Mock<(value: string) => void>;
  restored: () => HTMLElement;
}

const div = (): HTMLElement => document.createElement('div');

const start = (
  overrides: Partial<StartInlineRenameParams> = {},
  built: () => HTMLElement = div
): Handles => {
  const host = document.createElement('div');
  const target = document.createElement('span');

  host.appendChild(target);
  document.body.appendChild(host);

  const onCommit = vi.fn<(value: string) => void>();
  const onCancel = vi.fn<() => void>();
  const onInput = vi.fn<(value: string) => void>();

  startInlineRename({
    target,
    currentValue: 'Backlog',
    label: 'Rename column',
    onCommit,
    onCancel,
    onInput,
    buildRestored: (value) => {
      const el = built();

      el.setAttribute('data-restored', value);

      return el;
    },
    ...overrides,
  });

  const input = host.querySelector('input');

  if (input === null) {
    throw new Error('the target was not swapped for an input');
  }

  return {
    host,
    input,
    onCommit,
    onCancel,
    onInput,
    restored: () => {
      const el = host.querySelector<HTMLElement>('[data-restored]');

      if (el === null) {
        throw new Error('nothing was swapped back in');
      }

      return el;
    },
  };
};

const press = (input: HTMLInputElement, key: string): void => {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};

/**
 * One survivor is equivalent: seeding the guard as `{}` instead of
 * `{ done: false }`. The field is only ever read in boolean context before it
 * is assigned, and `undefined` and `false` are both falsy there.
 */
describe('startInlineRename mutants', () => {
  let errors: unknown[];

  // jsdom reports a throw inside a listener to window rather than to the code
  // that dispatched the event, so an optional-call mutant is invisible without
  // this.
  const captureError = (event: ErrorEvent): void => {
    errors.push(event.error);
    event.preventDefault();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    errors = [];
    window.addEventListener('error', captureError);
  });

  afterEach(() => {
    window.removeEventListener('error', captureError);
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('the input it swaps in', () => {
    it('is a focused text field seeded with the current value', () => {
      const { input } = start();

      expect(input.getAttribute('type')).toBe('text');
      expect(input.value).toBe('Backlog');
      expect(input.getAttribute('aria-label')).toBe('Rename column');
      expect(input).toHaveFocus();
    });

    it('reports keystrokes, and stays quiet when nobody asked for them', () => {
      const withCallback = start();

      withCallback.input.value = 'Done';
      withCallback.input.dispatchEvent(new Event('input'));

      expect(withCallback.onInput.mock.calls).toStrictEqual([['Done']]);

      const without = start({ onInput: undefined });

      without.input.dispatchEvent(new Event('input'));

      expect(errors).toStrictEqual([]);
    });

    it('keeps its keydown away from the surrounding tree', () => {
      const { host, input } = start();
      const onHostKeydown = vi.fn<() => void>();

      host.addEventListener('keydown', onHostKeydown);
      press(input, 'a');

      expect(onHostKeydown).not.toHaveBeenCalled();
    });

    it('ignores a key that is neither Enter nor Escape', () => {
      const { host, input, onCancel, onCommit } = start();

      press(input, 'a');

      expect(onCancel).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(host.querySelector('input')).toBe(input);
    });
  });

  describe('handing focus to the element it swaps back', () => {
    it('makes a plain element focusable first', () => {
      const handles = start();

      press(handles.input, 'Enter');

      const restored = handles.restored();

      expect(restored.getAttribute('tabindex')).toBe('-1');
      expect(restored).toHaveFocus();
    });

    it('leaves a natively focusable element alone', () => {
      const handles = start({}, () => document.createElement('button'));

      press(handles.input, 'Enter');

      expect(handles.restored().hasAttribute('tabindex')).toBe(false);
    });

    it('treats a link as focusable only when it has an href', () => {
      const withHref = start({}, () => {
        const anchor = document.createElement('a');

        anchor.setAttribute('href', '#');

        return anchor;
      });

      press(withHref.input, 'Enter');

      expect(withHref.restored().hasAttribute('tabindex')).toBe(false);

      const bare = start({}, () => document.createElement('a'));

      press(bare.input, 'Enter');

      expect(bare.restored().getAttribute('tabindex')).toBe('-1');
    });

    // A div carrying href is the only shape that separates the tag test from
    // the attribute test: neither half alone answers the same way.
    it('does not mistake an href on a non-link for focusability', () => {
      const handles = start({}, () => {
        const el = div();

        el.setAttribute('href', '#');

        return el;
      });

      press(handles.input, 'Enter');

      expect(handles.restored().getAttribute('tabindex')).toBe('-1');
    });

    it('keeps a tabindex the element already declares', () => {
      const handles = start({}, () => {
        const el = div();

        el.setAttribute('tabindex', '0');

        return el;
      });

      press(handles.input, 'Enter');

      expect(handles.restored().getAttribute('tabindex')).toBe('0');
    });

    // Blur is also the commit trigger, so the guard has to read focus
    // ownership before the swap, not after.
    it('leaves focus alone when the input lost it before committing', () => {
      const handles = start();

      handles.input.blur();

      expect(handles.onCommit.mock.calls).toStrictEqual([['Backlog']]);
      expect(handles.restored()).not.toHaveFocus();
    });
  });

  describe('the single-commit guard', () => {
    it('ignores an Escape that follows a commit', () => {
      const { input, onCancel } = start();

      press(input, 'Enter');
      press(input, 'Escape');

      expect(onCancel).not.toHaveBeenCalled();
    });

    it('ignores an Enter that follows a cancel', () => {
      const { input, onCommit, onCancel } = start();

      press(input, 'Escape');
      press(input, 'Enter');

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('drops the blur commit when Escape wins', () => {
      const removals = vi.spyOn(HTMLInputElement.prototype, 'removeEventListener');
      const { input } = start();

      press(input, 'Escape');

      expect(removals.mock.calls.map(([name]) => name)).toStrictEqual(['blur']);
    });
  });
});
