// test/unit/tools/code/language-picker.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { simulateInput, simulateKeydown } from '../../../helpers/simulate';
import type { LanguageEntry } from '../../../../src/tools/code/constants';
import type { LanguagePicker } from '../../../../src/tools/code/language-picker';

const MOCK_LANGUAGES: LanguageEntry[] = [
  { id: 'plain text', name: 'Plain Text' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'python', name: 'Python' },
  { id: 'java', name: 'Java' },
];

const createPicker = async (overrides: {
  onSelect?: (id: string) => void;
  activeLanguageId?: string;
} = {}): Promise<{
  picker: LanguagePicker;
  onSelect: ReturnType<typeof vi.fn>;
}> => {
  const { LanguagePicker } = await import('../../../../src/tools/code/language-picker');
  const onSelect = overrides.onSelect ? vi.fn(overrides.onSelect) : vi.fn();
  const picker = new LanguagePicker({
    languages: MOCK_LANGUAGES,
    onSelect,
    i18n: { t: (k: string) => k },
    activeLanguageId: overrides.activeLanguageId ?? 'plain text',
  });

  return { picker, onSelect };
};

describe('LanguagePicker', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeChild(container);
  });

  it('creates a hidden element on construction', async () => {
    const { picker } = await createPicker();
    const el = picker.getElement();

    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.hidden).toBe(true);
  });

  it('open() makes element visible', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    expect(picker.getElement().hidden).toBe(false);
  });

  it('close() hides element', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);
    picker.close();

    expect(picker.getElement().hidden).toBe(true);
  });

  it('clicking a language item calls onSelect with the language id', async () => {
    const { picker, onSelect } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    const items = picker.getElement().querySelectorAll('button[data-language-id]');
    const jsItem = Array.from(items).find(
      (btn) => btn.getAttribute('data-language-id') === 'javascript'
    ) as HTMLButtonElement;

    expect(jsItem).not.toBeNull();
    jsItem.click();

    expect(onSelect).toHaveBeenCalledWith('javascript');
  });

  it('clicking a language item closes the picker', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    const items = picker.getElement().querySelectorAll('button[data-language-id]');
    const firstItem = items[0] as HTMLButtonElement;

    firstItem.click();

    expect(picker.getElement().hidden).toBe(true);
  });

  it('search filters the language list', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    const searchInput = picker.getElement().querySelector(
      '[data-blok-testid="code-language-search"]'
    ) as HTMLInputElement;

    searchInput.value = 'java';
    simulateInput(searchInput);

    const visibleItems = picker.getElement().querySelectorAll('button[data-language-id]');

    // 'java' matches 'Java' and 'JavaScript'
    expect(visibleItems.length).toBe(2);

    const ids = Array.from(visibleItems).map((btn) => btn.getAttribute('data-language-id'));

    expect(ids).toContain('java');
    expect(ids).toContain('javascript');
  });

  it('search is case-insensitive', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    const searchInput = picker.getElement().querySelector(
      '[data-blok-testid="code-language-search"]'
    ) as HTMLInputElement;

    searchInput.value = 'PYTHON';
    simulateInput(searchInput);

    const visibleItems = picker.getElement().querySelectorAll('button[data-language-id]');

    expect(visibleItems.length).toBe(1);
    expect(visibleItems[0].getAttribute('data-language-id')).toBe('python');
  });

  it('empty search shows all languages', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    const searchInput = picker.getElement().querySelector(
      '[data-blok-testid="code-language-search"]'
    ) as HTMLInputElement;

    // Filter first to narrow results
    searchInput.value = 'python';
    simulateInput(searchInput);

    expect(picker.getElement().querySelectorAll('button[data-language-id]').length).toBe(1);

    // Clear filter
    searchInput.value = '';
    simulateInput(searchInput);

    const allItems = picker.getElement().querySelectorAll('button[data-language-id]');

    expect(allItems.length).toBe(MOCK_LANGUAGES.length);
  });

  it('escape key closes the picker', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    expect(picker.getElement().hidden).toBe(false);

    simulateKeydown(picker.getElement(), 'Escape');

    expect(picker.getElement().hidden).toBe(true);
  });

  it('setActiveLanguage updates the active item', async () => {
    const { picker } = await createPicker({ activeLanguageId: 'plain text' });

    container.appendChild(picker.getElement());
    picker.open(container);

    // Initially 'plain text' should be active
    const getActiveId = (): string | null => {
      const activeItem = picker.getElement().querySelector('button[data-language-id][data-active="true"]');

      return activeItem?.getAttribute('data-language-id') ?? null;
    };

    expect(getActiveId()).toBe('plain text');

    picker.setActiveLanguage('javascript');

    expect(getActiveId()).toBe('javascript');
    // Old active should no longer be active
    const oldActive = picker.getElement().querySelector('button[data-language-id="plain text"]');

    expect(oldActive?.getAttribute('data-active')).not.toBe('true');
  });

  it('has data-blok-testid on root and search input', async () => {
    const { picker } = await createPicker();
    const el = picker.getElement();

    expect(el.getAttribute('data-blok-testid')).toBe('code-language-picker');

    const searchInput = el.querySelector('[data-blok-testid="code-language-search"]');

    expect(searchInput).not.toBeNull();
    expect(searchInput?.tagName).toBe('INPUT');
  });

  it('focuses search input when opened', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());

    const searchInput = picker.getElement().querySelector(
      '[data-blok-testid="code-language-search"]'
    ) as HTMLInputElement;

    picker.open(container);

    // Verify observable state: search input should be focused
    expect(searchInput).toHaveFocus();
  });

  it('clears search input when opened', async () => {
    const { picker } = await createPicker();

    container.appendChild(picker.getElement());
    picker.open(container);

    const searchInput = picker.getElement().querySelector(
      '[data-blok-testid="code-language-search"]'
    ) as HTMLInputElement;

    searchInput.value = 'python';
    simulateInput(searchInput);
    picker.close();

    picker.open(container);

    expect(searchInput.value).toBe('');
    // All items should be visible again
    const items = picker.getElement().querySelectorAll('button[data-language-id]');

    expect(items.length).toBe(MOCK_LANGUAGES.length);
  });
});
