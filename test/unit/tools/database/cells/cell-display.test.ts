import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { renderCellValue } from '../../../../../src/tools/database/cells';
import { OPTION_COLORS, pickOptionColor } from '../../../../../src/tools/database/cells/option-colors';
import type { CellContext } from '../../../../../src/tools/database/cells/types';
import type { PropertyDefinition, PropertyType, SelectOption } from '../../../../../src/tools/database/types';

const ctx = (overrides: Partial<CellContext> = {}): CellContext => ({
  i18n: { t: (key: string) => key },
  readOnly: false,
  locale: 'en-US',
  ...overrides,
});

const prop = (type: PropertyType, options?: SelectOption[]): PropertyDefinition => ({
  id: 'p',
  name: 'P',
  type,
  position: 'a0',
  ...(options !== undefined ? { config: { options } } : {}),
});

const options: SelectOption[] = [
  { id: 'o1', label: 'Todo', color: 'red', position: 'a0' },
  { id: 'o2', label: 'Doing', position: 'a1' },
  { id: 'o3', label: 'Done', color: 'not-a-color', position: 'a2' },
];

describe('renderCellValue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows text as plain text, never as HTML', () => {
    const el = renderCellValue(prop('text'), '<b>bold</b>', ctx());

    expect(el.textContent).toBe('<b>bold</b>');
    expect(el.querySelector('b')).toBeNull();
  });

  it('marks an empty value', () => {
    expect(renderCellValue(prop('text'), '', ctx()).hasAttribute('data-empty')).toBe(true);
    expect(renderCellValue(prop('number'), null, ctx()).hasAttribute('data-empty')).toBe(true);
    expect(renderCellValue(prop('text'), 'x', ctx()).hasAttribute('data-empty')).toBe(false);
  });

  it('shows a number', () => {
    expect(renderCellValue(prop('number'), 42.5, ctx()).textContent).toBe('42.5');
  });

  it('shows a select value as one pill with its option color', () => {
    const el = renderCellValue(prop('select', options), 'o1', ctx());
    const pills = el.querySelectorAll('[data-blok-database-option-pill]');

    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe('Todo');
    expect(pills[0].getAttribute('data-color')).toBe('red');
  });

  it('paints an option with no color, or an unknown one, as default', () => {
    const el = renderCellValue(prop('multiSelect', options), ['o2', 'o3'], ctx());
    const colors = [...el.querySelectorAll('[data-blok-database-option-pill]')].map((p) => p.getAttribute('data-color'));

    expect(colors).toEqual(['default', 'default']);
  });

  it('shows multi-select pills in value order and skips unknown ids', () => {
    const el = renderCellValue(prop('multiSelect', options), ['o2', 'gone', 'o1'], ctx());

    expect([...el.querySelectorAll('[data-blok-database-option-pill]')].map((p) => p.textContent)).toEqual(['Doing', 'Todo']);
  });

  it('reads options from the context before the property config', () => {
    const el = renderCellValue(prop('select', options), 'o1', ctx({ options: [{ id: 'o1', label: 'Live', position: 'a0' }] }));

    expect(el.textContent).toBe('Live');
  });

  it('shows a checkbox state for assistive tech', () => {
    const checked = renderCellValue(prop('checkbox'), true, ctx());
    const unchecked = renderCellValue(prop('checkbox'), false, ctx());

    expect(checked.querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('checked');
    expect(checked.textContent).toContain('tools.database.checkboxChecked');
    expect(unchecked.querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('unchecked');
  });

  it('shows a date as a long date in the locale', () => {
    expect(renderCellValue(prop('date'), '2026-10-09', ctx()).textContent).toBe('October 9, 2026');
  });

  it('shows a range with an arrow between its ends', () => {
    expect(renderCellValue(prop('date'), '2026-10-09/2026-10-12', ctx()).textContent).toBe('October 9, 2026 → October 12, 2026');
  });

  it('adds the time when the value has one', () => {
    const text = renderCellValue(prop('date'), '2026-10-09T14:05', ctx({ hourCycle: 'h23' })).textContent ?? '';

    expect(text.startsWith('October 9, 2026')).toBe(true);
    expect(text).toContain('14:05');
  });

  describe('a date with a reminder (research/17 §1c)', () => {
    it('keeps the date text and puts an alarm after it', () => {
      const cell = renderCellValue(prop('date'), '2027-06-15', ctx({ reminder: '1_day_before' }));
      const alarm = cell.querySelector('[data-blok-database-date-reminder]');

      expect(cell.textContent?.trim()).toBe('June 15, 2027');
      expect(cell.hasAttribute('data-reminder')).toBe(true);
      expect(alarm?.querySelector('svg')).not.toBeNull();
      expect(alarm?.previousSibling?.textContent).toBe('June 15, 2027');
      expect(alarm?.getAttribute('role')).toBe('img');
      expect(alarm?.getAttribute('aria-label')).toBe('tools.database.dateReminderSet');
    });

    it('shows no alarm without a reminder', () => {
      const cell = renderCellValue(prop('date'), '2027-06-15', ctx());

      expect(cell.hasAttribute('data-reminder')).toBe(false);
      expect(cell.querySelector('[data-blok-database-date-reminder]')).toBeNull();
    });

    it('shows no alarm for a reminder the value cannot take', () => {
      const cell = renderCellValue(prop('date'), '2027-06-15', ctx({ reminder: '5_minutes_before' }));

      expect(cell.querySelector('[data-blok-database-date-reminder]')).toBeNull();
    });
  });

  it('shows a value that is not a date as plain text', () => {
    expect(renderCellValue(prop('date'), 'someday', ctx()).textContent).toBe('someday');
  });

  describe('url', () => {
    it('renders a safe url as a link that opens in a new tab', () => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx()).querySelector('a');

      expect(link?.getAttribute('href')).toBe('https://example.com');
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('never puts an unsafe scheme in href', () => {
      const el = renderCellValue(prop('url'), 'java\nscript:alert(1)', ctx());

      expect(el.querySelector('a')).toBeNull();
      expect(el.querySelector('[href]')).toBeNull();
      expect(el.textContent).toBe('java\nscript:alert(1)');
    });

    it('a plain click does not follow the link, so the host can open the editor', () => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx()).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
    });

    it.each([['metaKey'], ['ctrlKey']])('a %s click follows the link', (modifier) => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx()).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
    });

    // research/22 §3: Notion links a typed "example.org" to http://example.org/.
    it('links an address typed without a scheme over http', () => {
      const link = renderCellValue(prop('url'), 'example.org', ctx()).querySelector('a');

      expect(link?.href).toBe('http://example.org/');
      expect(link?.textContent).toBe('example.org');
    });

    // A board or gallery card draws read-only: the browser follows the link, not core.
    it('a read-only link owns its clicks', () => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx({ readOnly: true })).querySelector('a');

      expect(link?.hasAttribute('data-blok-link-owner')).toBe(true);
    });

    it('a plain click follows the link when read-only', () => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx({ readOnly: true })).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
    });
  });

  // research/16 §4: the table's url, email and phone values are links a plain click follows.
  describe('followLinks (the table)', () => {
    it.each([
      ['url', 'https://example.com'],
      ['email', 'test@example.com'],
      ['phone', '+1 555 0100'],
    ] as const)('a plain click on a %s link follows it while editable', (type, value) => {
      const link = renderCellValue(prop(type), value, ctx({ followLinks: true })).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
    });

    // Core's redactor click would swallow it and window.open the href without noopener.
    it.each([
      ['url', 'https://example.com'],
      ['email', 'test@example.com'],
      ['phone', '+1 555 0100'],
    ] as const)('a %s link owns its clicks, so the browser follows it, not core', (type, value) => {
      const link = renderCellValue(prop(type), value, ctx({ followLinks: true })).querySelector('a');

      expect(link?.hasAttribute('data-blok-link-owner')).toBe(true);
    });

    it('without followLinks a link leaves its clicks to core', () => {
      expect(renderCellValue(prop('url'), 'https://example.com', ctx()).querySelector('a')?.hasAttribute('data-blok-link-owner')).toBe(false);
    });

    it.each([
      ['https://example.com', 'example.com'],
      ['https://example.com/', 'example.com/'],
      ['http://example.com', 'example.com'],
      ['https://example.com/a/b?q=1', 'example.com/a/b?q=1'],
    ])('shows %s as %s, and the href keeps the full address', (value, shown) => {
      const link = renderCellValue(prop('url'), value, ctx({ followLinks: true, shortUrls: true })).querySelector('a');

      expect(link?.textContent).toBe(shown);
      expect(link?.getAttribute('href')).toBe(value);
    });

    // research/22 §3 measured the row page link, not a shortened address.
    it('shows the full address unless shortUrls is set', () => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx({ followLinks: true, shortUrls: false })).querySelector('a');

      expect(link?.textContent).toBe('https://example.com');
    });

    it('never links an unsafe scheme, and shows it as typed', () => {
      const el = renderCellValue(prop('url'), 'javascript:alert(1)', ctx({ followLinks: true }));

      expect(el.querySelector('[href]')).toBeNull();
      expect(el.textContent).toBe('javascript:alert(1)');
    });

    it('a file chip in the table still does not follow on a plain click, so the cell edits', () => {
      const files = [{ id: 'f1', name: 'brief.pdf', url: 'https://example.com/brief.pdf' }];
      const link = renderCellValue(prop('files'), files, ctx({ followLinks: true })).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
    });
  });
});

describe('option colors', () => {
  it('lists the ten Notion option colors', () => {
    expect(OPTION_COLORS).toEqual(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
  });

  it('picks the next color in order by how many options exist, so a pick is the same on every run', () => {
    expect(pickOptionColor([])).toBe('default');
    expect(pickOptionColor(options)).toBe('orange');
    expect(pickOptionColor(Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, label: '', position: 'a0' })))).toBe('default');
  });
});
