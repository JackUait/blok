import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FindBar } from '../../../../../src/components/modules/find/find-bar';
import type { FindBarCallbacks } from '../../../../../src/components/modules/find/find-bar';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : `${key}${JSON.stringify(vars)}`;

const makeCallbacks = (): { [K in keyof FindBarCallbacks]: ReturnType<typeof vi.fn> } & FindBarCallbacks => {
  const callbacks = {
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onClose: vi.fn(),
    onOptionsChange: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onSeek: vi.fn(),
  };

  return callbacks;
};

const byTestId = <T extends HTMLElement = HTMLElement>(root: HTMLElement, id: string): T => {
  const found = root.querySelector<T>(`[data-blok-testid="${id}"]`);

  if (found === null) {
    throw new Error(`No element with data-blok-testid="${id}"`);
  }

  return found;
};

const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.getAttribute('aria-label') === label);

  if (found === undefined) {
    throw new Error(`No button labelled ${label}`);
  }

  return found;
};

const press = (target: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

const type = (input: HTMLInputElement, value: string): void => {
  Object.assign(input, { value });
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('FindBar', () => {
  let callbacks: ReturnType<typeof makeCallbacks>;
  let bar: FindBar;

  const create = (isMac = true): FindBar => {
    const created = new FindBar({ t, callbacks, isMac });

    document.body.appendChild(created.element);

    return created;
  };

  const findInput = (): HTMLInputElement => byTestId<HTMLInputElement>(bar.element, 'find-input');
  const replaceInput = (): HTMLInputElement => byTestId<HTMLInputElement>(bar.element, 'find-replace-input');

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = makeCallbacks();
    bar = create();
  });

  afterEach(() => {
    bar.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('structure', () => {
    it('makes the dock a keyboard owner so Blok stands down inside it', () => {
      expect(bar.element.hasAttribute(DATA_ATTR.keyboardOwner)).toBe(true);
    });

    it('exposes the bar as a search landmark with a labelled search field', () => {
      expect(bar.element.querySelector('[role="search"]')).not.toBeNull();
      expect(findInput().type).toBe('search');
      expect(findInput().getAttribute('aria-label')).toBe('find.placeholder');
      expect(findInput().placeholder).toBe('find.placeholder');
    });

    it('labels every icon button', () => {
      for (const key of ['find.previous', 'find.next', 'find.close', 'find.matchCase', 'find.wholeWord', 'find.toggleReplace']) {
        expect(button(bar.element, key).type).toBe('button');
      }
    });

    it('announces the counter politely', () => {
      expect(byTestId(bar.element, 'find-counter').getAttribute('aria-live')).toBe('polite');
    });

    it('starts closed and hidden', () => {
      expect(bar.isOpen).toBe(false);
      expect(bar.element.hidden).toBe(true);
    });
  });

  describe('open', () => {
    it('shows the bar and focuses the find field', () => {
      bar.open({ readOnly: false });

      expect(bar.isOpen).toBe(true);
      expect(bar.element.hidden).toBe(false);
      expect(findInput()).toHaveFocus();
    });

    it('prefills the query, reports it, and selects it', () => {
      bar.open({ query: 'needle', readOnly: false });

      expect(findInput().value).toBe('needle');
      expect(bar.query).toBe('needle');
      expect(callbacks.onQueryChange).toHaveBeenCalledWith('needle');
      expect(findInput().selectionStart).toBe(0);
      expect(findInput().selectionEnd).toBe('needle'.length);
    });

    it('does not report a query when none is given', () => {
      bar.open({ readOnly: false });

      expect(callbacks.onQueryChange).not.toHaveBeenCalled();
    });

    it('when already open, refocuses and selects all without clearing', () => {
      bar.open({ readOnly: false });
      type(findInput(), 'abc');
      replaceInput().focus();

      bar.open({ readOnly: false });

      expect(findInput()).toHaveFocus();
      expect(findInput().value).toBe('abc');
      expect(findInput().selectionStart).toBe(0);
      expect(findInput().selectionEnd).toBe(3);
    });

    it('when already open, takes a new query, reports it, and selects it', () => {
      bar.open({ readOnly: false });
      type(findInput(), 'old');
      vi.clearAllMocks();

      bar.open({ query: 'new', readOnly: false });

      expect(findInput().value).toBe('new');
      expect(callbacks.onQueryChange).toHaveBeenCalledWith('new');
      expect(findInput()).toHaveFocus();
      expect(findInput().selectionStart).toBe(0);
      expect(findInput().selectionEnd).toBe('new'.length);
    });

    it('reports the kept query again when reopened', () => {
      bar.open({ query: 'kept', readOnly: false });
      bar.close();
      vi.clearAllMocks();

      bar.open({ readOnly: false });

      expect(callbacks.onQueryChange).toHaveBeenCalledWith('kept');
    });

    it('opens the replace row when asked', () => {
      bar.open({ readOnly: false });

      expect(byTestId(bar.element, 'find-replace-row').hidden).toBe(true);

      bar.open({ replace: true, readOnly: false });

      expect(byTestId(bar.element, 'find-replace-row').hidden).toBe(false);
      expect(button(bar.element, 'find.toggleReplace').getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('close', () => {
    it('is immediately closed and non-interactive', () => {
      bar.open({ readOnly: false });
      bar.close();

      expect(bar.isOpen).toBe(false);
      expect(bar.element.hasAttribute('inert')).toBe(true);
    });

    it('ends hidden once the exit animation is over', () => {
      bar.open({ readOnly: false });
      bar.close();

      // `hidden` lands at once; find.css keeps it painted through the exit.
      expect(bar.element.hidden).toBe(true);
    });

    it('stops reacting to its buttons after closing', () => {
      bar.open({ readOnly: false });
      bar.setResults({ current: 0, total: 3, positions: [0, 0.5, 1] });
      bar.close();

      button(bar.element, 'find.next').click();

      expect(callbacks.onNext).not.toHaveBeenCalled();
    });

    it('can reopen after closing', () => {
      bar.open({ readOnly: false });
      bar.close();
      bar.open({ readOnly: false });

      expect(bar.isOpen).toBe(true);
      expect(bar.element.hidden).toBe(false);
      expect(bar.element.hasAttribute('inert')).toBe(false);
    });
  });

  describe('find field keys', () => {
    beforeEach(() => {
      bar.open({ readOnly: false });
    });

    it('reports every edit', () => {
      type(findInput(), 'a');
      type(findInput(), 'ab');

      expect(callbacks.onQueryChange).toHaveBeenNthCalledWith(1, 'a');
      expect(callbacks.onQueryChange).toHaveBeenNthCalledWith(2, 'ab');
    });

    it('goes to the next match on Enter', () => {
      const event = press(findInput(), { key: 'Enter' });

      expect(callbacks.onNext).toHaveBeenCalledTimes(1);
      expect(callbacks.onPrevious).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('goes to the previous match on Shift+Enter', () => {
      press(findInput(), { key: 'Enter', shiftKey: true });

      expect(callbacks.onPrevious).toHaveBeenCalledTimes(1);
      expect(callbacks.onNext).not.toHaveBeenCalled();
    });

    it('ignores Enter while an IME is composing', () => {
      press(findInput(), { key: 'Enter', isComposing: true });

      expect(callbacks.onNext).not.toHaveBeenCalled();
    });

    it('closes on Escape', () => {
      const event = press(findInput(), { key: 'Escape' });

      expect(callbacks.onClose).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('option toggles', () => {
    beforeEach(() => {
      bar.open({ readOnly: false });
    });

    it('toggles match case from its button', () => {
      const toggle = button(bar.element, 'find.matchCase');

      toggle.click();

      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(bar.options).toEqual({ matchCase: true, wholeWord: false });
      expect(callbacks.onOptionsChange).toHaveBeenLastCalledWith({ matchCase: true, wholeWord: false });

      toggle.click();

      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(callbacks.onOptionsChange).toHaveBeenLastCalledWith({ matchCase: false, wholeWord: false });
    });

    it('toggles whole word from its button', () => {
      const toggle = button(bar.element, 'find.wholeWord');

      toggle.click();

      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(callbacks.onOptionsChange).toHaveBeenLastCalledWith({ matchCase: false, wholeWord: true });
    });

    it('reads Alt+C and Alt+W by key code, since macOS Option changes event.key', () => {
      const matchCase = press(findInput(), { key: 'ç', code: 'KeyC', altKey: true });

      expect(callbacks.onOptionsChange).toHaveBeenLastCalledWith({ matchCase: true, wholeWord: false });
      expect(matchCase.defaultPrevented).toBe(true);

      press(findInput(), { key: '∑', code: 'KeyW', altKey: true });

      expect(callbacks.onOptionsChange).toHaveBeenLastCalledWith({ matchCase: true, wholeWord: true });
      expect(button(bar.element, 'find.wholeWord').getAttribute('aria-pressed')).toBe('true');
    });

    it('also takes Alt+C from the replace field', () => {
      bar.open({ replace: true, readOnly: false });
      press(replaceInput(), { key: 'ç', code: 'KeyC', altKey: true });

      expect(callbacks.onOptionsChange).toHaveBeenLastCalledWith({ matchCase: true, wholeWord: false });
    });

    it('leaves plain C alone', () => {
      press(findInput(), { key: 'c', code: 'KeyC' });

      expect(callbacks.onOptionsChange).not.toHaveBeenCalled();
    });
  });

  describe('navigation buttons', () => {
    beforeEach(() => {
      bar.open({ readOnly: false });
    });

    it('are disabled with no matches', () => {
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(button(bar.element, 'find.next').disabled).toBe(true);
      expect(button(bar.element, 'find.previous').disabled).toBe(true);
    });

    it('call next and previous', () => {
      bar.setResults({ current: 0, total: 2, positions: [0, 1] });

      button(bar.element, 'find.next').click();
      button(bar.element, 'find.previous').click();

      expect(callbacks.onNext).toHaveBeenCalledTimes(1);
      expect(callbacks.onPrevious).toHaveBeenCalledTimes(1);
    });

    it('close from the close button', () => {
      button(bar.element, 'find.close').click();

      expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('counter', () => {
    const counter = (): string => byTestId(bar.element, 'find-counter').textContent ?? '';

    beforeEach(() => {
      bar.open({ readOnly: false });
    });

    it('is empty with no query', () => {
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(counter()).toBe('');
    });

    it('shows a one-based position out of the total', () => {
      type(findInput(), 'a');
      bar.setResults({ current: 2, total: 7, positions: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] });

      expect(counter()).toBe('find.count{"current":3,"total":7}');
    });

    it('says there are no results for a query that matches nothing', () => {
      type(findInput(), 'zzz');
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(counter()).toBe('find.noResults');
    });
  });

  describe('no-results state', () => {
    const field = (): HTMLElement => byTestId(bar.element, 'find-field');

    beforeEach(() => {
      bar.open({ readOnly: false });
      type(findInput(), 'zzz');
    });

    it('tints the field and shakes it once', () => {
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(field().hasAttribute('data-blok-find-empty')).toBe(true);
      expect(field().hasAttribute('data-blok-find-shake')).toBe(true);
      expect(findInput().getAttribute('aria-invalid')).toBe('true');
    });

    it('does not shake again while it stays at zero', () => {
      bar.setResults({ current: -1, total: 0, positions: [] });
      field().dispatchEvent(new Event('animationend'));

      expect(field().hasAttribute('data-blok-find-shake')).toBe(false);

      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(field().hasAttribute('data-blok-find-shake')).toBe(false);
    });

    it('shakes again after leaving zero and coming back', () => {
      bar.setResults({ current: -1, total: 0, positions: [] });
      field().dispatchEvent(new Event('animationend'));

      bar.setResults({ current: 0, total: 1, positions: [0.5] });

      expect(field().hasAttribute('data-blok-find-empty')).toBe(false);
      expect(findInput().hasAttribute('aria-invalid')).toBe(false);

      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(field().hasAttribute('data-blok-find-shake')).toBe(true);
    });

    it('is not a no-results state when the query is empty', () => {
      type(findInput(), '');
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(field().hasAttribute('data-blok-find-empty')).toBe(false);
      expect(field().hasAttribute('data-blok-find-shake')).toBe(false);
    });
  });

  describe('placement', () => {
    const placed = (init: Partial<ConstructorParameters<typeof FindBar>[0]>): FindBar => {
      bar.destroy();
      bar = new FindBar({ t, callbacks, isMac: true, ...init });
      document.body.appendChild(bar.element);
      bar.open({ readOnly: false });

      return bar;
    };

    it('rises into the top layer, above everything on the page', () => {
      bar.open({ readOnly: false });

      expect(bar.element.getAttribute('data-blok-top-layer')).toBe('true');
    });

    it('sits where browsers put their own find bar unless told otherwise', () => {
      bar.open({ readOnly: false });

      expect(bar.element.getAttribute('data-blok-find-placement')).toBe('top-end');
      expect(bar.element.style.getPropertyValue('--blok-find-offset-x')).toBe('');
    });

    it('takes the placement and offset the host configured', () => {
      const configured = placed({ placement: 'bottom-start', offset: { x: 24, y: 80 } });

      expect(configured.element.getAttribute('data-blok-find-placement')).toBe('bottom-start');
      expect(configured.element.style.getPropertyValue('--blok-find-offset-x')).toBe('24px');
      expect(configured.element.style.getPropertyValue('--blok-find-offset-y')).toBe('80px');
    });

    it('falls back to the default spot for a placement it does not know', () => {
      const configured = placed({ placement: 'middle' as unknown as 'top-end', offset: { x: Number.NaN } });

      expect(configured.element.getAttribute('data-blok-find-placement')).toBe('top-end');
      expect(configured.element.style.getPropertyValue('--blok-find-offset-x')).toBe('');
    });

    it('cannot be moved by the people using the editor', () => {
      bar.open({ readOnly: false });
      bar.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 800, clientY: 20 }));
      bar.element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 400 }));

      expect(bar.element.style.left).toBe('');
      expect(bar.element.style.top).toBe('');
      expect(bar.element.querySelector('[data-blok-testid="find-grip"]')).toBeNull();
    });
  });

  describe('replace', () => {
    beforeEach(() => {
      bar.open({ readOnly: false });
    });

    it('is collapsed by default and opens from its toggle', () => {
      const toggle = button(bar.element, 'find.toggleReplace');

      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      toggle.click();

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(byTestId(bar.element, 'find-replace-row').hidden).toBe(false);
      expect(replaceInput().placeholder).toBe('find.replacePlaceholder');
    });

    it('closes again from its toggle', () => {
      const toggle = button(bar.element, 'find.toggleReplace');

      toggle.click();
      toggle.click();

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(byTestId(bar.element, 'find-replace-row').hidden).toBe(true);
    });

    it.each([
      { name: 'Replace all', testId: 'find-replace-all', field: 'replace' },
      { name: 'Replace', testId: 'find-replace', field: 'replace' },
      { name: 'Next', testId: 'find-next', field: 'find' },
    ])('keeps focus in the bar when $name disables itself', ({ testId, field }) => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: 0, total: 1, positions: [0] });
      byTestId<HTMLButtonElement>(bar.element, testId).focus();

      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(field === 'replace' ? replaceInput() : findInput()).toHaveFocus();
    });

    it('disables both replace buttons with no matches', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(byTestId<HTMLButtonElement>(bar.element, 'find-replace').disabled).toBe(true);
      expect(byTestId<HTMLButtonElement>(bar.element, 'find-replace-all').disabled).toBe(true);
    });

    it('replaces from the buttons with the typed text', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: 0, total: 2, positions: [0, 1] });
      replaceInput().value = 'new';

      byTestId(bar.element, 'find-replace').click();
      byTestId(bar.element, 'find-replace-all').click();

      expect(callbacks.onReplace).toHaveBeenCalledWith('new');
      expect(callbacks.onReplaceAll).toHaveBeenCalledWith('new');
      expect(byTestId(bar.element, 'find-replace').textContent).toBe('find.replace');
      expect(byTestId(bar.element, 'find-replace-all').textContent).toBe('find.replaceAll');
    });

    it('replaces one on Enter in the replace field', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: 0, total: 2, positions: [0, 1] });
      replaceInput().value = 'x';

      press(replaceInput(), { key: 'Enter' });

      expect(callbacks.onReplace).toHaveBeenCalledWith('x');
      expect(callbacks.onReplaceAll).not.toHaveBeenCalled();
      expect(callbacks.onNext).not.toHaveBeenCalled();
    });

    it('replaces all on Cmd+Enter on a Mac', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: 0, total: 2, positions: [0, 1] });
      replaceInput().value = 'x';

      press(replaceInput(), { key: 'Enter', ctrlKey: true });

      expect(callbacks.onReplaceAll).not.toHaveBeenCalled();

      press(replaceInput(), { key: 'Enter', metaKey: true });

      expect(callbacks.onReplaceAll).toHaveBeenCalledWith('x');
      expect(callbacks.onReplace).not.toHaveBeenCalled();
    });

    it('replaces all on Ctrl+Enter elsewhere', () => {
      bar.destroy();
      bar = create(false);
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: 0, total: 2, positions: [0, 1] });
      replaceInput().value = 'x';

      press(replaceInput(), { key: 'Enter', metaKey: true });

      expect(callbacks.onReplaceAll).not.toHaveBeenCalled();

      press(replaceInput(), { key: 'Enter', ctrlKey: true });

      expect(callbacks.onReplaceAll).toHaveBeenCalledWith('x');
    });

    it('does not replace from the keyboard with no matches', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: -1, total: 0, positions: [] });

      press(replaceInput(), { key: 'Enter' });
      press(replaceInput(), { key: 'Enter', metaKey: true });

      expect(callbacks.onReplace).not.toHaveBeenCalled();
      expect(callbacks.onReplaceAll).not.toHaveBeenCalled();
    });

    it('closes on Escape in the replace field', () => {
      bar.open({ replace: true, readOnly: false });
      press(replaceInput(), { key: 'Escape' });

      expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('read-only', () => {
    it('hides the replace toggle and row when opened read-only', () => {
      bar.open({ replace: true, readOnly: true });

      expect(button(bar.element, 'find.toggleReplace').hidden).toBe(true);
      expect(byTestId(bar.element, 'find-replace-row').hidden).toBe(true);
    });

    it('hides and restores replace when switched at runtime', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setReadOnly(true);

      expect(button(bar.element, 'find.toggleReplace').hidden).toBe(true);
      expect(byTestId(bar.element, 'find-replace-row').hidden).toBe(true);

      bar.setReadOnly(false);

      expect(button(bar.element, 'find.toggleReplace').hidden).toBe(false);
    });

    it('ignores replace keys while read-only', () => {
      bar.open({ replace: true, readOnly: false });
      bar.setResults({ current: 0, total: 1, positions: [0] });
      bar.setReadOnly(true);

      press(replaceInput(), { key: 'Enter' });

      expect(callbacks.onReplace).not.toHaveBeenCalled();
    });
  });

  describe('match map', () => {
    const ticks = (): HTMLElement[] =>
      Array.from(bar.element.querySelectorAll<HTMLElement>('[data-blok-testid="find-map-tick"]'));
    const map = (): HTMLElement => byTestId(bar.element, 'find-map');

    beforeEach(() => {
      bar.open({ readOnly: false });
      type(findInput(), 'a');
    });

    it('draws one tick per match at its position', () => {
      bar.setResults({ current: 1, total: 3, positions: [0, 0.25, 1] });

      expect(ticks()).toHaveLength(3);
      expect(ticks()[1].style.left).toBe('25%');
      expect(map().hidden).toBe(false);
    });

    it('marks the active tick', () => {
      bar.setResults({ current: 1, total: 3, positions: [0, 0.25, 1] });

      expect(ticks().map((tick) => tick.hasAttribute('data-blok-find-active'))).toEqual([false, true, false]);
    });

    it('hides with no matches', () => {
      bar.setResults({ current: -1, total: 0, positions: [] });

      expect(map().hidden).toBe(true);
    });

    it('buckets a large match set to at most 200 ticks', () => {
      const positions = Array.from({ length: 1000 }, (_, i) => i / 999);

      bar.setResults({ current: 999, total: 1000, positions });

      expect(ticks().length).toBeLessThanOrEqual(200);
      expect(ticks().length).toBeGreaterThan(100);
      expect(ticks().filter((tick) => tick.hasAttribute('data-blok-find-active'))).toHaveLength(1);
    });

    it('keeps the 200 cap when positions arrive out of order', () => {
      const positions = Array.from({ length: 1000 }, (_, i) => (i * 7919 % 1000) / 999);

      bar.setResults({ current: 0, total: 1000, positions });

      expect(ticks().length).toBeLessThanOrEqual(200);
    });

    it('seeks to the match under a clicked tick', () => {
      bar.setResults({ current: 0, total: 3, positions: [0, 0.25, 1] });

      ticks()[2].click();

      expect(callbacks.onSeek).toHaveBeenCalledWith(2);
    });

    it('seeks to the nearest match when a click lands on the track', () => {
      bar.setResults({ current: 0, total: 3, positions: [0, 0.25, 1] });
      vi.spyOn(map(), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 200, 8));

      map().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100 + 200 * 0.3 }));

      expect(callbacks.onSeek).toHaveBeenCalledWith(1);
    });
  });

  describe('destroy', () => {
    it('removes the element', () => {
      bar.destroy();

      expect(bar.element.isConnected).toBe(false);
    });

    it('stops reacting to keys', () => {
      bar.open({ readOnly: false });
      const input = findInput();

      bar.destroy();
      document.body.appendChild(bar.element);
      press(input, { key: 'Enter' });

      expect(callbacks.onNext).not.toHaveBeenCalled();
    });
  });
});
