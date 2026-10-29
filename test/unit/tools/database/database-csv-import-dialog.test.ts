import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { openCsvImportDialog } from '../../../../src/tools/database/database-csv-import-dialog';
import type { CsvColumnTarget, CsvImportSettings, CsvMergeTarget } from '../../../../src/tools/database/database-csv';
import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { IconChevronUpDown, IconPageEmpty } from '../../../../src/components/icons';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

/** An icon string as the DOM serializes it once it is set as innerHTML. */
const markup = (svg: string): string => Object.assign(document.createElement('span'), { innerHTML: svg }).innerHTML;

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
  const onImport = vi.fn<(file: { name: string; text: string }, targets: CsvColumnTarget[], settings: CsvImportSettings) => void>();
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
    // A value, not a shortcut: secondaryLabel would draw glyphs and set aria-keyshortcuts.
    expect(item('database-csv-type-title')?.querySelector('[data-blok-popover-item-value]')?.textContent).toBe('tools.database.propertyTypeTitle');
    expect(item('database-csv-type-title')?.hasAttribute('aria-keyshortcuts')).toBe(false);
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

  describe('right-hand preview (research/26 §2, research/27 §2, research/30 §9)', () => {
    const preview = (): HTMLElement | null => byTestId('database-csv-preview');
    const previewTitle = (): string => preview()?.querySelector('[data-blok-database-csv-preview-title]')?.textContent ?? '';
    const headerCells = (): string[] => [...(preview()?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim() ?? '');
    const column = (index: number): string[] => [...(preview()?.querySelectorAll('tbody tr') ?? [])]
      .map((tr) => tr.querySelectorAll('td')[index]?.textContent?.trim() ?? '');

    it('is a skeleton titled "New table" before a file, then titled with the file name without its extension', async () => {
      open();

      expect(previewTitle()).toBe('tools.database.csvNewTable');
      expect(preview()?.querySelector('[data-blok-database-csv-skeleton]')).not.toBeNull();
      expect(preview()?.getAttribute('aria-hidden')).toBe('true');

      await choose(R27, 'blok-r27.csv');

      expect(previewTitle()).toBe('blok-r27');
      expect(preview()?.querySelector('[data-blok-database-csv-skeleton]')).not.toBeNull();
    });

    it('shows the table the import will make on "Setup CSV columns", in file order', async () => {
      open();
      await choose(R27, 'blok-r27.csv');
      byTestId('database-csv-map')?.click();

      expect(previewTitle()).toBe('blok-r27');
      expect(preview()?.querySelector('[data-blok-database-csv-skeleton]')).toBeNull();
      expect(headerCells()).toEqual(['Name', 'Due', 'Amount', 'Site', 'Email', 'Done', 'Stage']);
      expect(column(0)).toEqual(['Alpha', 'Bravo', 'Charlie']);
      expect(column(1)).toEqual(['March 4, 2026', 'March 5, 2026', 'March 6, 2026']);
    });

    // notion-spec-2 §18.1: a title shows Notion's pageEmpty, a page with no text lines.
    it('draws the empty page before each title', async () => {
      open();
      await choose(R27, 'blok-r27.csv');
      byTestId('database-csv-map')?.click();
      const titleIcons = [...(preview()?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelector('td svg')?.outerHTML);

      expect(titleIcons).toEqual(Array(3).fill(markup(IconPageEmpty).trim()));
    });

    it('follows the mapping: a skipped column leaves, a Person column empties', async () => {
      open(true);
      await choose(R27, 'blok-r27.csv');
      byTestId('database-csv-map')?.click();
      const buttons = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')];

      buttons()[3].click();
      await flush();
      item('database-csv-type-skip')?.click();
      await flush();
      buttons()[6].click();
      await flush();
      item('database-csv-type-new')?.click();
      await flush();
      item('database-csv-type-new-person')?.click();
      await flush();

      expect(headerCells()).toEqual(['Name', 'Due', 'Amount', 'Email', 'Done', 'Stage']);
      expect(column(5)).toEqual(['', '', '']);
    });
  });

  describe('"Use first row as headers" (research/27 §2, research/30 §9c)', () => {
    const toggle = (): HTMLElement | null => byTestId('database-csv-headers');

    it('is a switch, on by default, on "Setup CSV columns"', async () => {
      open();
      await choose(R27, 'blok-r27.csv');
      byTestId('database-csv-map')?.click();

      expect(toggle()?.getAttribute('role')).toBe('switch');
      expect(toggle()?.getAttribute('aria-checked')).toBe('true');
      expect(toggle()?.textContent).toContain('tools.database.csvFirstRowHeaders');
      // The shared switch CSS styles only a direct-child track.
      expect(toggle()?.querySelector(':scope > [data-blok-database-switch-track]')).not.toBeNull();
    });

    it('off: columns read "Column N", the header line becomes a row, and the chosen types stay', async () => {
      open();
      await choose(R27, 'blok-r27.csv');
      byTestId('database-csv-map')?.click();
      const labelsBefore = typeLabels().slice(1);

      toggle()?.click();

      expect(toggle()?.getAttribute('aria-checked')).toBe('false');
      expect([...document.querySelectorAll('[data-blok-testid="database-csv-column"]')].map((el) => el.textContent?.trim()))
        .toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `tools.database.csvUntitledColumn ${n}`));
      expect(typeLabels().slice(1)).toEqual(labelsBefore);
      expect([...(byTestId('database-csv-preview')?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelector('td')?.textContent?.trim()))
        .toEqual(['Name', 'Alpha', 'Bravo', 'Charlie']);

      byTestId('database-csv-import')?.click();

      expect(onImport.mock.calls[0][2]).toEqual(expect.objectContaining({ headers: false }));
    });
  });

  describe('the Date type\'s date-format submenu (research/30 §9b)', () => {
    const DMY = 'Name,When\nAlpha,03/04/2026\nBravo,03/05/2026';
    const openDateFormats = async (): Promise<void> => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
      document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')[1].click();
      await flush();
      item('database-csv-type-new')?.click();
      await flush();
      // A hover opens the formats; a click picks Date. The popover ignores hovers until the pointer moves.
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
      item('database-csv-type-new-date')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 50 }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      await flush();
    };

    it('lists the five formats a CSV date can be read in, with no checkmark', async () => {
      open();
      await choose(DMY, 'dates.csv');
      byTestId('database-csv-map')?.click();
      await openDateFormats();

      const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-item-name^="database-csv-date-"]')];

      expect(rows.map((row) => row.getAttribute('data-blok-item-name'))).toEqual(
        ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day'].map((format) => `database-csv-date-${format}`)
      );
      expect(rows.map((row) => row.textContent?.trim())).toEqual(
        ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day'].map((format) => `tools.database.dateFormat.${format}`)
      );
      expect(rows.some((row) => row.getAttribute('aria-checked') === 'true' || row.querySelector('[data-blok-popover-item-secondary-title], [data-blok-popover-item-trailing-icon] svg') !== null)).toBe(false);
    });

    it('Day/Month/Year reads 03/04/2026 as April 3 in the preview and the import', async () => {
      open();
      await choose(DMY, 'dates.csv');
      byTestId('database-csv-map')?.click();
      await openDateFormats();
      item('database-csv-date-day_month_year')?.click();
      await flush();

      expect(typeLabels()[1]).toBe('tools.database.propertyTypeDate • tools.database.dateFormat.day_month_year');
      expect([...(byTestId('database-csv-preview')?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelectorAll('td')[1]?.textContent?.trim()))
        .toEqual(['April 3, 2026', 'May 3, 2026']);

      byTestId('database-csv-import')?.click();

      expect(onImport.mock.calls[0][1]).toEqual(['title', 'date']);
      expect(onImport.mock.calls[0][2]).toEqual({ headers: true, dateFormats: [undefined, 'day_month_year'] });
    });

    // Notion: a click on the Date row picks Date at once; only hover and ArrowRight open the formats.
    it('a click on the Date row picks Date with Full date and closes the menu', async () => {
      open();
      await choose('Name,Count\nAlpha,1', 'n.csv');
      byTestId('database-csv-map')?.click();
      document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')[1].click();
      await flush();
      item('database-csv-type-new')?.click();
      await flush();
      item('database-csv-type-new-date')?.click();
      await flush();

      expect(typeLabels()[1]).toBe('tools.database.propertyTypeDate • tools.database.dateFormat.full');
      expect(item('database-csv-type-new-date')).toBeNull();
      expect(item('database-csv-date-full')).toBeNull();

      byTestId('database-csv-import')?.click();

      expect(onImport.mock.calls[0][1]).toEqual(['title', 'date']);
      expect(onImport.mock.calls[0][2]).toEqual({ headers: true, dateFormats: [undefined, 'full'] });
    });

    it('Year/Month/Day leaves those cells empty', async () => {
      open();
      await choose(DMY, 'dates.csv');
      byTestId('database-csv-map')?.click();
      await openDateFormats();
      item('database-csv-date-year_month_day')?.click();
      await flush();

      expect([...(byTestId('database-csv-preview')?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelectorAll('td')[1]?.textContent?.trim()))
        .toEqual(['', '']);
    });
  });

  // research/30 §9a: a title column headed "Title" read "Name"; §9c: so did the title with headers off.
  it('names the title "Name" when its column is headed "Title", and when the first row is not headers', async () => {
    open();
    await choose('Title,Notes\nAlpha,x', 'neutral.csv');
    byTestId('database-csv-map')?.click();

    expect(typeLabels()[0]).toBe('tools.database.defaultSourceTitleProperty');
    expect(byTestId('database-csv-preview')?.querySelector('th')?.textContent?.trim()).toBe('tools.database.defaultSourceTitleProperty');

    byTestId('database-csv-cancel')?.click();
    open();
    await choose('Task,Notes\nAlpha,x', 'tasks.csv');
    byTestId('database-csv-map')?.click();
    expect(typeLabels()[0]).toBe('Task');
    byTestId('database-csv-headers')?.click();
    expect(typeLabels()[0]).toBe('tools.database.defaultSourceTitleProperty');
  });

  describe('Merge with CSV (research/30 §9f)', () => {
    const MERGE = 'Name,Due,Extra\nR1,2026-03-04,x1\nR9,2026-03-05,x9';
    const schema: PropertyDefinition[] = [
      { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
      { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
      { id: 'p-total', name: 'Total', type: 'formula', position: 'a2' },
      { id: 'p-tag', name: 'Tag', type: 'select', position: 'a3', config: { options: [{ id: 'o1', label: 'Red', position: 'a0' }] } },
      { id: 'p-where', name: 'Where', type: 'place', position: 'a4' },
    ];
    const onMerge = vi.fn<(file: { name: string; text: string }, targets: CsvMergeTarget[], settings: CsvImportSettings) => void>();
    const openMerge = (): ReturnType<typeof openCsvImportDialog> =>
      openCsvImportDialog({ t, hasPeople: false, merge: { location: 'Tasks', schema, onMerge } });
    const buttons = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-testid="database-csv-type"]')];
    const mapped = async (): Promise<void> => {
      openMerge();
      await choose(MERGE, 'blok-r30-merge.csv');
      byTestId('database-csv-map')?.click();
    };

    it('shows "Import Location" on the file step: the database, faded and disabled', () => {
      openMerge();
      const location = byTestId('database-csv-location');

      expect(location?.previousElementSibling?.textContent).toBe('tools.database.csvImportLocation');
      expect(location?.textContent?.trim()).toBe('Tasks');
      expect(location?.getAttribute('aria-disabled')).toBe('true');
    });

    // research/31 §5a: the field ends in an up/down chevron, like a select.
    it('ends "Import Location" with an up/down chevron', () => {
      openMerge();

      expect(byTestId('database-csv-location')?.lastElementChild?.innerHTML).toBe(markup(IconChevronUpDown));
    });

    it('has no "Import Location" on a new import', () => {
      open();

      expect(byTestId('database-csv-location')).toBeNull();
    });

    it('says it can merge only when it merges (research/31 §5a); a new import keeps the short subtitle', () => {
      openMerge();
      expect(document.querySelector('[data-blok-database-csv-text]')?.textContent).toBe('tools.database.csvMergeDescription');
      document.body.innerHTML = '';

      open();
      expect(document.querySelector('[data-blok-database-csv-text]')?.textContent).toBe('tools.database.csvImportDescription');
    });

    it('maps a header onto the property it names, showing that property\'s name; the rest go to a new property', async () => {
      await mapped();

      expect(typeLabels()).toEqual(['Name', 'Due', 'tools.database.propertyTypeText']);
      expect([...(byTestId('database-csv-preview')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim())).toEqual(['Name', 'Due', 'Extra']);
      expect([...(byTestId('database-csv-preview')?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.querySelectorAll('td')[1]?.textContent?.trim()))
        .toEqual(['March 4, 2026', 'March 5, 2026']);
    });

    it('maps a header onto the property it names in another case (research/31 §5b)', async () => {
      openMerge();
      await choose('name,due,TAG\nR1,2026-03-04,Red', 'a.csv');
      byTestId('database-csv-map')?.click();

      expect(typeLabels()).toEqual(['Name', 'Due', 'Tag']);
    });

    it('maps a header naming a property by its saved name, while the button shows the name this person reads', async () => {
      const stored: PropertyDefinition[] = [{ id: 'p-t', name: 'Title', type: 'title', position: 'a0' }];

      openCsvImportDialog({ t, hasPeople: false, merge: { location: 'Tasks', schema: [{ ...stored[0], name: 'Titel' }], stored, onMerge } });
      await choose('Title\nA', 'a.csv');
      byTestId('database-csv-map')?.click();

      expect(typeLabels()).toEqual(['Titel']);
    });

    // research/35 §8: Notion listed Who (Person) and left out Att (Files & media) and Fx (Formula).
    it('lists a Person property under "Existing property", but not Files & media', async () => {
      const people: PropertyDefinition[] = [
        { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-who', name: 'Who', type: 'person', position: 'a1' },
        { id: 'p-att', name: 'Att', type: 'files', position: 'a2' },
      ];

      openCsvImportDialog({ t, hasPeople: true, merge: { location: 'Tasks', schema: people, onMerge } });
      await choose('Name,Extra Col\nM1,Ada', 'a.csv');
      byTestId('database-csv-map')?.click();
      buttons()[1].click();
      await flush();

      expect(item('database-csv-type-existing-p-who')).not.toBeNull();
      expect(item('database-csv-type-existing-p-att')).toBeNull();
    });

    // research/31 §5b: Where (Place) is never listed.
    it('lists every property a CSV can fill under "Existing property" but Place, with a check on the current one', async () => {
      await mapped();
      buttons()[1].click();
      await flush();

      const names = [...document.querySelectorAll<HTMLElement>('[data-blok-item-name^="database-csv-type-"]')]
        .map((el) => el.getAttribute('data-blok-item-name'));

      expect(names).toEqual(['database-csv-type-skip', 'database-csv-type-existing-p-name', 'database-csv-type-existing-p-due', 'database-csv-type-existing-p-tag', 'database-csv-type-new']);
      expect(item('database-csv-type-existing-p-name')?.textContent).toContain('tools.database.propertyTypeTitle');
      expect(item('database-csv-type-existing-p-due')?.querySelector('[data-blok-testid="popover-item-trailing-icon"]')).not.toBeNull();
      expect(item('database-csv-type-existing-p-name')?.querySelector('[data-blok-testid="popover-item-trailing-icon"]')).toBeNull();
    });

    it('merges with the mapping; a property picked for a second column leaves the first, which goes back to a new property', async () => {
      await mapped();
      buttons()[2].click();
      await flush();
      item('database-csv-type-existing-p-due')?.click();
      await flush();

      expect(typeLabels()).toEqual(['Name', 'tools.database.propertyTypeDate • tools.database.dateFormat.full', 'Due']);

      byTestId('database-csv-import')?.click();

      expect(onMerge).toHaveBeenCalledTimes(1);
      expect(onMerge.mock.calls[0][0]).toEqual({ name: 'blok-r30-merge.csv', text: MERGE });
      expect(onMerge.mock.calls[0][1]).toEqual([{ property: 'p-name' }, 'date', { property: 'p-due' }]);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
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
