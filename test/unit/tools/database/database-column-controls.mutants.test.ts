import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { DatabaseColumnControls } from '../../../../src/tools/database/database-column-controls';
import type { I18n } from '../../../../types';

interface Callbacks {
  onRename: Mock<(optionId: string, label: string) => void>;
  onDelete: Mock<(optionId: string) => void>;
  onRenameInput: Mock<(optionId: string, label: string) => void>;
  onRenameCommit: Mock<(optionId: string, label: string) => void>;
}

const i18n = (): I18n => ({
  // The key comes back tagged so an assertion can name it.
  t: vi.fn((key: string) => `t:${key}`),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const callbacks = (): Callbacks => ({
  onRename: vi.fn<(optionId: string, label: string) => void>(),
  onDelete: vi.fn<(optionId: string) => void>(),
  onRenameInput: vi.fn<(optionId: string, label: string) => void>(),
  onRenameCommit: vi.fn<(optionId: string, label: string) => void>(),
});

const header = (title: string | null = 'Status'): HTMLElement => {
  const host = document.createElement('div');

  if (title !== null) {
    const titleEl = document.createElement('div');

    titleEl.setAttribute('data-blok-database-column-title', '');
    titleEl.textContent = title;
    host.appendChild(titleEl);
  }
  document.body.appendChild(host);

  return host;
};

const inputIn = (host: HTMLElement): HTMLInputElement => {
  const el = host.querySelector('input');

  if (el === null) {
    throw new Error('no input in the header');
  }

  return el;
};

const titleIn = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>('[data-blok-database-column-title]');

  if (el === null) {
    throw new Error('no title in the header');
  }

  return el;
};

const click = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const type = (host: HTMLElement, value: string): void => {
  const input = inputIn(host);

  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const press = (host: HTMLElement, key: string): void => {
  inputIn(host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};

/**
 * Three survivors are equivalent.
 *
 * Two are the `?? ''` fallback on `titleEl.textContent`, once in makeEditable
 * and once in the pill click handler. `titleEl` comes from `querySelector`, so
 * its only non-null value is an Element, and `Element.textContent` is always a
 * string — null is reserved for the document and doctype nodes. The fallback
 * never runs.
 *
 * The third is `div.style.cursor` inside restoreDiv. Both the commit and the
 * cancel path re-enter makePillTitleEditable on the restored div in the same
 * synchronous turn, and that sets the same cursor again. The assertion in the
 * commit test still holds with the line blanked, which is the measurement.
 */
describe('DatabaseColumnControls mutants', () => {
  let cb: Callbacks;
  let errors: unknown[];

  // A throw inside a listener does not reach the dispatcher in jsdom — it is
  // reported to window instead. Optional-call mutants are only visible here.
  const captureError = (event: ErrorEvent): void => {
    errors.push(event.error);
    event.preventDefault();
  };

  const build = (overrides: Partial<ConstructorParameters<typeof DatabaseColumnControls>[0]> = {}): DatabaseColumnControls =>
    new DatabaseColumnControls({
      i18n: i18n(),
      onRename: cb.onRename,
      onDelete: cb.onDelete,
      onRenameInput: cb.onRenameInput,
      onRenameCommit: cb.onRenameCommit,
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    cb = callbacks();
    errors = [];
    window.addEventListener('error', captureError);
  });

  afterEach(() => {
    window.removeEventListener('error', captureError);
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('makeEditable', () => {
    it('swaps the title for a text input carrying its text, marker and width', () => {
      const host = header('Status');

      build().makeEditable(host, 'c1');

      const input = inputIn(host);

      expect(input.getAttribute('type')).toBe('text');
      expect(input.value).toBe('Status');
      expect(input.getAttribute('data-blok-database-column-title-input')).toBe('');
      expect(input.size).toBe(6);
      expect(host.querySelector('[data-blok-database-column-title]')).toBeNull();
    });

    it('widens the input on every keystroke', () => {
      const host = header('Status');

      build().makeEditable(host, 'c1');

      type(host, 'Much longer');

      expect(inputIn(host).size).toBe(11);
    });

    it('appends the delete button even when there is no title to edit', () => {
      const host = header(null);

      expect(() => build().makeEditable(host, 'c1')).not.toThrow();
      expect(host.querySelector('input')).toBeNull();
      expect(host.querySelector('[data-blok-database-delete-column]')).not.toBeNull();
    });
  });

  describe('appendDeleteButton', () => {
    it('stamps the button with an empty marker and deletes the column it names', () => {
      const host = header();

      build().appendDeleteButton(host, 'c1');

      const button = host.querySelector('button');

      expect(button?.getAttribute('data-blok-database-delete-column')).toBe('');
      expect(button?.getAttribute('data-option-id')).toBe('c1');
    });
  });

  describe('makePillTitleEditable', () => {
    it('marks the title as text and keeps its click away from the header', () => {
      const host = header('BACKLOG');
      const onHeaderClick = vi.fn<() => void>();

      host.addEventListener('click', onHeaderClick);
      build().makePillTitleEditable(host, 'c1');

      expect(titleIn(host).style.cursor).toBe('text');

      click(titleIn(host));

      expect(onHeaderClick).not.toHaveBeenCalled();
    });

    it('leaves a header with no title alone', () => {
      const host = header(null);

      expect(() => build().makePillTitleEditable(host, 'c1')).not.toThrow();
    });

    it('seeds the rename input with a label, a marker and a width', () => {
      const host = header('BACKLOG');

      build().makePillTitleEditable(host, 'c1');
      click(titleIn(host));

      const input = inputIn(host);

      expect(input.getAttribute('aria-label')).toBe('t:tools.database.renameColumn');
      expect(input.getAttribute('data-blok-database-column-title-input')).toBe('');
      expect(input.getAttribute('size')).toBe('7');
    });

    it('widens the rename input on every keystroke and reports the value', () => {
      const host = header('BACKLOG');

      build().makePillTitleEditable(host, 'c1');
      click(titleIn(host));
      type(host, 'Backlog items');

      expect(inputIn(host).getAttribute('size')).toBe('13');
      expect(cb.onRenameInput.mock.calls).toStrictEqual([['c1', 'Backlog items']]);
    });

    it('tolerates a host that wants no keystroke callback', () => {
      const host = header('BACKLOG');

      build({ onRenameInput: undefined }).makePillTitleEditable(host, 'c1');
      click(titleIn(host));
      type(host, 'Backlog items');

      expect(errors).toStrictEqual([]);
    });

    it('commits a changed label and restores a title that can be renamed again', () => {
      const host = header('BACKLOG');

      build().makePillTitleEditable(host, 'c1');
      click(titleIn(host));
      type(host, 'Done');
      press(host, 'Enter');

      expect(cb.onRenameCommit.mock.calls).toStrictEqual([['c1', 'Done']]);
      expect(cb.onRename.mock.calls).toStrictEqual([['c1', 'Done']]);

      const restored = titleIn(host);

      expect(restored.getAttribute('data-blok-database-column-title')).toBe('');
      expect(restored.style.cursor).toBe('text');
      expect(restored.textContent).toBe('Done');

      click(restored);

      expect(host.querySelector('input')).not.toBeNull();
    });

    it('tolerates a host that wants no commit callback', () => {
      const host = header('BACKLOG');

      build({ onRenameCommit: undefined }).makePillTitleEditable(host, 'c1');
      click(titleIn(host));
      type(host, 'Done');
      press(host, 'Enter');

      expect(errors).toStrictEqual([]);
      expect(cb.onRename.mock.calls).toStrictEqual([['c1', 'Done']]);
    });

    it('restores a title that can be renamed again after Escape', () => {
      const host = header('BACKLOG');

      build().makePillTitleEditable(host, 'c1');
      click(titleIn(host));
      type(host, 'Done');
      press(host, 'Escape');

      const restored = titleIn(host);

      expect(restored.textContent).toBe('BACKLOG');
      expect(cb.onRename).not.toHaveBeenCalled();

      click(restored);

      expect(host.querySelector('input')).not.toBeNull();
    });
  });
});
