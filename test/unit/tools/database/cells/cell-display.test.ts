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

    it('a plain click follows the link when read-only', () => {
      const link = renderCellValue(prop('url'), 'https://example.com', ctx({ readOnly: true })).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
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
