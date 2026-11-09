import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseColumnControls } from '../../../../src/tools/database/database-column-controls';
import { simulateInput, simulateKeydown } from '../../../helpers/simulate';
import type { I18n } from '../../../../types';

const createMockI18n = (): I18n => ({
  t: vi.fn((key: string) => key),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const makePillHeaderEl = (title = 'BACKLOG'): HTMLElement => {
  const header = document.createElement('div');
  const pill = document.createElement('div');
  pill.setAttribute('data-blok-database-column-pill', '');
  const titleEl = document.createElement('div');
  titleEl.setAttribute('data-blok-database-column-title', '');
  titleEl.textContent = title;
  pill.appendChild(titleEl);
  header.appendChild(pill);
  return header;
};

describe('DatabaseColumnControls', () => {
  let i18n: I18n;
  let onRename: ReturnType<typeof vi.fn<(optionId: string, label: string) => void>>;
  let onRenameInput: ReturnType<typeof vi.fn<(optionId: string, label: string) => void>>;
  let onRenameCommit: ReturnType<typeof vi.fn<(optionId: string, label: string) => void>>;
  let controls: DatabaseColumnControls;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
    onRename = vi.fn<(optionId: string, label: string) => void>();
    onRenameInput = vi.fn<(optionId: string, label: string) => void>();
    onRenameCommit = vi.fn<(optionId: string, label: string) => void>();
    controls = new DatabaseColumnControls({ i18n, onRename, onRenameInput, onRenameCommit });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('makePillTitleEditable', () => {
    it('clicking the title element swaps it for an input', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      expect(headerEl.querySelector('[data-blok-database-column-title-input]')).not.toBeNull();
      expect(headerEl.querySelector('[data-blok-database-column-title]')).toBeNull();
    });

    it('input is pre-filled with the current title', () => {
      const headerEl = makePillHeaderEl('IN PROGRESS');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]');
      expect(input?.value).toBe('IN PROGRESS');
    });

    it('fires onRenameInput on every input event', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]')!;
      input.value = 'BACKLOG UPDATED';
      simulateInput(input);

      expect(onRenameInput).toHaveBeenCalledWith('opt-1', 'BACKLOG UPDATED');
    });

    it('fires onRenameCommit and restores title div on blur', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]')!;
      input.value = 'RELEASED';
      input.dispatchEvent(new Event('blur'));

      expect(onRenameCommit).toHaveBeenCalledWith('opt-1', 'RELEASED');
      expect(headerEl.querySelector('[data-blok-database-column-title]')).not.toBeNull();
      expect(headerEl.querySelector('[data-blok-database-column-title-input]')).toBeNull();
      expect(headerEl.querySelector('[data-blok-database-column-title]')?.textContent).toBe('RELEASED');
    });

    it('fires onRenameCommit and restores on Enter key', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]')!;
      input.value = 'NEW NAME';
      simulateKeydown(input, 'Enter');

      expect(onRenameCommit).toHaveBeenCalledWith('opt-1', 'NEW NAME');
    });

    it('restores original title on Escape without calling onRenameCommit', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]')!;
      input.value = 'OOPS';
      simulateKeydown(input, 'Escape');

      expect(onRenameCommit).not.toHaveBeenCalled();
      expect(headerEl.querySelector('[data-blok-database-column-title]')?.textContent).toBe('BACKLOG');
    });

    it('falls back to original title if input is empty on commit', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]')!;
      input.value = '';
      input.dispatchEvent(new Event('blur'));

      // When input is empty, falls back to original — no change, so onRenameCommit is NOT called
      expect(onRenameCommit).not.toHaveBeenCalled();
      expect(headerEl.querySelector('[data-blok-database-column-title]')?.textContent).toBe('BACKLOG');
    });

    it('does not fire onRenameCommit when title has not changed on blur', () => {
      const headerEl = makePillHeaderEl('BACKLOG');
      controls.makePillTitleEditable(headerEl, 'opt-1');

      const titleEl = headerEl.querySelector('[data-blok-database-column-title]') as HTMLElement;
      titleEl.click();

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]')!;
      // value unchanged (still 'BACKLOG')
      input.dispatchEvent(new Event('blur'));

      expect(onRenameCommit).not.toHaveBeenCalled();
    });
  });
});
