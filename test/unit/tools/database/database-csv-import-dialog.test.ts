import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { openCsvImportDialog } from '../../../../src/tools/database/database-csv-import-dialog';
import type { CsvColumnTarget } from '../../../../src/tools/database/database-csv';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

const R27 = [
  'Name,Due,Amount,Site,Email,Done,Stage',
  'Alpha,2026-03-04,12,https://example.com,a@example.com,Yes,Todo',
  'Bravo,2026-03-05,7.5,https://example.org,b@example.com,No,Doing',
  'Charlie,2026-03-06,100,https://example.net,c@example.com,Yes,Todo',
].join('\n');

const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`;

const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-blok-testid="${id}"]`);

const flush = async (): Promise<void> => {
  for (const _ of [0, 1, 2, 3]) await new Promise((resolve) => setTimeout(resolve, 0));
};

const choose = async (text: string, name: string): Promise<void> => {
  const input = document.querySelector<HTMLInputElement>('[data-blok-database-csv-input]');

  if (input === null) throw new Error('no file input');
  Object.defineProperty(input, 'files', { value: [new File([text], name, { type: 'text/csv' })], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
};

const typeLabels = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')]
  .map((el) => el.textContent?.trim() ?? '');

const escape = (): void => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

const item = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

describe('openCsvImportDialog (research/26 §2, research/27 §2)', () => {
  const onImport = vi.fn<(file: { name: string; text: string }, targets: CsvColumnTarget[]) => void>();
  const onClose = vi.fn();
  const open = (hasPeople = false): ReturnType<typeof openCsvImportDialog> => openCsvImportDialog({ t, hasPeople, onImport, onClose });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('"Learn about imports" (research/26 §2)', () => {
    const help = (): HTMLAnchorElement | null => document.querySelector<HTMLAnchorElement>('[data-blok-database-csv-help]');

    it('sits right under Map CSV headers on the file step and opens the host URL in a new tab', () => {
      openCsvImportDialog({ t, hasPeople: false, onImport, helpUrl: 'https://example.com/help/imports' });

      expect(help()?.previousElementSibling).toBe(byTestId('database-csv-map'));
      expect(help()?.getAttribute('href')).toBe('https://example.com/help/imports');
      expect(help()?.target).toBe('_blank');
      expect(help()?.rel).toBe('noopener noreferrer');
      expect(help()?.textContent?.trim()).toBe('tools.database.csvImportsHelp');
    });

    it('shows nothing without the host URL', () => {
      open();

      expect(help()).toBeNull();
    });

    // The Setup step was not measured.
    it('is not on the Setup step', async () => {
      openCsvImportDialog({ t, hasPeople: false, onImport, helpUrl: 'https://example.com/help/imports' });
      await choose(R27, 'blok-r27.csv');
      byTestId('database-csv-map')?.click();

      expect(byTestId('database-csv-import')).not.toBeNull();
      expect(help()).toBeNull();
    });
  });

  it('opens on the file step: Map CSV headers is disabled until a file is chosen, the close button has focus', async () => {
    open();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(byTestId('database-csv-map')?.getAttribute('aria-disabled')).toBe('true');
    expect(byTestId('database-csv-close')).toHaveFocus();
    byTestId('database-csv-map')?.click();
    expect(byTestId('database-csv-setup')).toBeNull();

    await choose(R27, 'blok-r27.csv');

    expect(byTestId('database-csv-file')?.textContent).toContain('blok-r27.csv');
    expect(byTestId('database-csv-map')?.getAttribute('aria-disabled')).toBe('false');
  });

  it('"Clear file" takes the file back and disables Map CSV headers again', async () => {
    open();
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-clear-file')?.click();

    expect(byTestId('database-csv-file')).toBeNull();
    expect(byTestId('database-csv-choose-file')).not.toBeNull();
    expect(byTestId('database-csv-map')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('"Setup CSV columns" lists one row per column with the detected type, as Notion detected them', async () => {
    open();
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();

    expect(document.querySelector('[data-blok-database-csv-title]')?.textContent).toBe('tools.database.csvSetupTitle');
    expect(byTestId('database-csv-setup')).not.toBeNull();
    expect([...document.querySelectorAll('[data-blok-testid="database-csv-column"]')].map((el) => el.textContent?.trim()))
      .toEqual(['Name', 'Due', 'Amount', 'Site', 'Email', 'Done', 'Stage']);
    expect(typeLabels()).toEqual([
      'Name',
      'tools.database.propertyTypeDate • tools.database.dateFormat.full',
      'tools.database.propertyTypeNumber',
      'tools.database.propertyTypeUrl',
      'tools.database.propertyTypeEmail',
      'tools.database.propertyTypeCheckbox',
      'tools.database.propertyTypeText',
    ]);
  });

  it('the type picker offers Don\'t import, the title and "Add new property" with the 11 measured types', async () => {
    open(true);
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();
    document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')[6].click();
    await flush();

    expect(item('database-csv-type-skip')).not.toBeNull();
    expect(item('database-csv-type-title')?.textContent).toContain('Name');
    expect(item('database-csv-type-title')?.textContent).toContain('tools.database.propertyTypeTitle');
    item('database-csv-type-new')?.click();
    await flush();

    expect([...document.querySelectorAll<HTMLElement>('[data-blok-item-name^="database-csv-type-new-"]')].map((el) => el.getAttribute('data-blok-item-name')))
      .toEqual(['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person'].map((type) => `database-csv-type-new-${type}`));
  });

  it('imports with the picked types; picking the title for another column moves it there', async () => {
    open();
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();
    const buttons = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')];

    buttons()[6].click();
    await flush();
    item('database-csv-type-new')?.click();
    await flush();
    item('database-csv-type-new-select')?.click();
    await flush();
    buttons()[3].click();
    await flush();
    item('database-csv-type-skip')?.click();
    await flush();
    buttons()[4].click();
    await flush();
    item('database-csv-type-title')?.click();
    await flush();
    byTestId('database-csv-import')?.click();

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toEqual({ name: 'blok-r27.csv', text: R27 });
    expect(onImport.mock.calls[0][1]).toEqual(['text', 'date', 'number', 'skip', 'title', 'checkbox', 'select']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back returns to the file step with the file kept', async () => {
    open();
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();
    byTestId('database-csv-back')?.click();

    expect(byTestId('database-csv-setup')).toBeNull();
    expect(byTestId('database-csv-file')?.textContent).toContain('blok-r27.csv');
  });

  // research/27 §2: Escape on the mapping step closes the whole import.
  it('one Escape on the mapping step closes the whole import without importing', async () => {
    open();
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();
    byTestId('database-csv-import')?.focus();
    escape();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without importing', async () => {
    open();
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();
    byTestId('database-csv-cancel')?.click();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('hides Person without a people directory', async () => {
    open(false);
    await choose(R27, 'blok-r27.csv');
    byTestId('database-csv-map')?.click();
    document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')[6].click();
    await flush();
    item('database-csv-type-new')?.click();
    await flush();

    expect(item('database-csv-type-new-person')).toBeNull();
    expect(item('database-csv-type-new-phone')).not.toBeNull();
  });
});
