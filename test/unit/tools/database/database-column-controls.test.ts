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
  let onRename: ReturnType<typeof vi.fn<(columnId: string, title: string) => void>>;
  let onRecolor: ReturnType<typeof vi.fn<(columnId: string, color: string) => void>>;
  let onDelete: ReturnType<typeof vi.fn<(columnId: string) => void>>;
  let controls: DatabaseColumnControls;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n = createMockI18n();
    onRename = vi.fn<(columnId: string, title: string) => void>();
    onRecolor = vi.fn<(columnId: string, color: string) => void>();
    onDelete = vi.fn<(columnId: string) => void>();
    controls = new DatabaseColumnControls({ i18n, onRename, onRecolor, onDelete });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('makeEditable', () => {
    it('calls onRename when title input fires change event', () => {
      const headerEl = makeHeaderEl('My Column');

      controls.makeEditable(headerEl, 'col-1');

      const input = headerEl.querySelector<HTMLInputElement>('[data-blok-database-column-title-input]');

      expect(input).not.toBeNull();

      if (input) {
        input.value = 'Renamed Column';
        simulateChange(input);
      }

      expect(onRename).toHaveBeenCalledWith('col-1', 'Renamed Column');
    });

    it('calls onDelete with column ID when delete button is clicked', () => {
      const headerEl = makeHeaderEl('My Column');

      controls.makeEditable(headerEl, 'col-2');

      const deleteBtn = headerEl.querySelector<HTMLButtonElement>('[data-blok-database-delete-column]');

      expect(deleteBtn).not.toBeNull();

      deleteBtn?.click();

      expect(onDelete).toHaveBeenCalledWith('col-2');
    });
  });
});
