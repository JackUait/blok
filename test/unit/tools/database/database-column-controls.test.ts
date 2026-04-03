import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseColumnControls } from '../../../../src/tools/database/database-column-controls';
import { simulateChange } from '../../../helpers/simulate';
import type { I18n } from '../../../../types';

const createMockI18n = (): I18n => ({
  t: vi.fn((key: string) => key),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const makeHeaderEl = (title = 'My Column'): HTMLElement => {
  const header = document.createElement('div');
  const titleEl = document.createElement('div');

  titleEl.setAttribute('data-blok-database-column-title', '');
  titleEl.textContent = title;
  header.appendChild(titleEl);

  return header;
};

describe('DatabaseColumnControls', () => {
  let i18n: I18n;
  let onRename: ReturnType<typeof vi.fn<(optionId: string, label: string) => void>>;
  let onDelete: ReturnType<typeof vi.fn<(optionId: string) => void>>;
  let controls: DatabaseColumnControls;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
    onRename = vi.fn<(optionId: string, label: string) => void>();
    onDelete = vi.fn<(optionId: string) => void>();
    controls = new DatabaseColumnControls({ i18n, onRename, onDelete });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('makeEditable', () => {
    it('calls onRename when title input fires change event', () => {
      const headerEl = makeHeaderEl('My Column');

      controls.makeEditable(headerEl, 'opt-1');

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]');

      expect(input).not.toBeNull();

      if (input) {
        input.value = 'Renamed Column';
        simulateChange(input);
      }

      expect(onRename).toHaveBeenCalledWith('opt-1', 'Renamed Column');
    });

    it('calls onDelete with option ID when delete button is clicked', () => {
      const headerEl = makeHeaderEl('My Column');

      controls.makeEditable(headerEl, 'opt-2');

      const deleteBtn = headerEl.querySelector<HTMLButtonElement>('[data-blok-database-delete-column]');

      expect(deleteBtn).not.toBeNull();

      deleteBtn?.click();

      expect(onDelete).toHaveBeenCalledWith('opt-2');
    });

    describe('accessibility', () => {
      it('delete button has aria-label with translated text', () => {
        const headerEl = makeHeaderEl('My Column');

        controls.makeEditable(headerEl, 'opt-1');

        const deleteBtn = headerEl.querySelector<HTMLButtonElement>('[data-blok-database-delete-column]');

        expect(deleteBtn).not.toBeNull();
        expect(deleteBtn?.getAttribute('aria-label')).toBe('tools.database.deleteColumn');
        expect(i18n.t).toHaveBeenCalledWith('tools.database.deleteColumn');
      });

      it('rename input has aria-label with translated text', () => {
        const headerEl = makeHeaderEl('My Column');

        controls.makeEditable(headerEl, 'opt-1');

        const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]');

        expect(input).not.toBeNull();
        expect(input?.getAttribute('aria-label')).toBe('tools.database.renameColumn');
        expect(i18n.t).toHaveBeenCalledWith('tools.database.renameColumn');
      });
    });
  });
});
