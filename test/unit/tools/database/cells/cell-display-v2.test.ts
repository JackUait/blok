import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { renderCellValue, openCellEditor } from '../../../../../src/tools/database/cells';
import { formatNumberValue } from '../../../../../src/tools/database/cells/number-format';
import { formatDateDisplay } from '../../../../../src/tools/database/cells/date-format';
import type { CellContext } from '../../../../../src/tools/database/cells/types';
import type { PropertyDefinition, PropertyType } from '../../../../../src/tools/database/types';
import { createDefaultStatusSettings } from '../../../../../src/tools/database/property-values';
import { makeAnchor, makeEditorContext } from './helpers';

const ctx = (overrides: Partial<CellContext> = {}): CellContext => ({
  i18n: { t: (key: string) => key },
  readOnly: false,
  locale: 'en-US',
  ...overrides,
});

const prop = (type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'p',
  name: 'P',
  type,
  position: 'a0',
  ...extra,
});

const statusProp = prop('status', {
  config: {
    options: [
      { id: 's1', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
      { id: 's3', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
    ],
  },
  status: createDefaultStatusSettings(),
});

describe('renderCellValue — new property types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('email and phone', () => {
    it('links an email with mailto: and never lets the address add headers', () => {
      const link = renderCellValue(prop('email'), 'ada@example.com?bcc=eve@evil.io', ctx()).querySelector('a');

      expect(link?.getAttribute('href')).toBe('mailto:ada@example.com%3Fbcc%3Deve@evil.io');
      expect(link?.getAttribute('href')).not.toContain('?');
      expect(link?.textContent).toBe('ada@example.com?bcc=eve@evil.io');
    });

    it('links a phone number with tel: and keeps only dialable characters', () => {
      const link = renderCellValue(prop('phone'), '+1 (555) 010-0100', ctx()).querySelector('a');

      expect(link?.getAttribute('href')).toBe('tel:+15550100100');
      expect(link?.textContent).toBe('+1 (555) 010-0100');
    });

    it('does not follow the link on a plain click while editable', () => {
      const link = renderCellValue(prop('email'), 'a@b.io', ctx()).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      link?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
    });

    it('shows a value with nothing dialable as text', () => {
      const el = renderCellValue(prop('phone'), 'call me', ctx());

      expect(el.querySelector('a')).toBeNull();
      expect(el.textContent).toBe('call me');
    });
  });

  describe('status', () => {
    it('shows a status pill with its color and group', () => {
      const pill = renderCellValue(statusProp, 's3', ctx()).querySelector('[data-blok-database-option-pill]');

      expect(pill?.textContent).toBe('Done');
      expect(pill?.getAttribute('data-color')).toBe('green');
      expect(pill?.getAttribute('data-status-group')).toBe('complete');
    });

    it('shows a checkbox, ticked in the complete group, when shown as a checkbox', () => {
      const asCheckbox: PropertyDefinition = { ...statusProp, status: { ...createDefaultStatusSettings(), showAs: 'checkbox' } };

      expect(renderCellValue(asCheckbox, 's3', ctx()).querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('checked');
      expect(renderCellValue(asCheckbox, 's1', ctx()).querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('unchecked');
    });
  });

  describe('person', () => {
    const people = [{ id: 'u1', name: 'Ada Lovelace', avatarUrl: 'https://img.example.com/a.png' }, { id: 'u2', name: 'Grace Hopper' }];

    it('shows one chip per person with the directory name and avatar', () => {
      const el = renderCellValue(prop('person'), [{ id: 'u1' }, { id: 'u2' }], ctx({ people }));
      const chips = [...el.querySelectorAll('[data-blok-database-person-chip]')];

      expect(chips.map((c) => c.textContent)).toEqual(['Ada Lovelace', 'Grace Hopper']);
      expect(chips[0].querySelector('img')?.getAttribute('src')).toBe('https://img.example.com/a.png');
      expect(chips[1].querySelector('[data-blok-database-person-initial]')?.getAttribute('data-blok-database-person-initial')).toBe('G');
    });

    it('never puts an unsafe avatar url in src', () => {
      const el = renderCellValue(prop('person'), [{ id: 'x' }], ctx({ people: [{ id: 'x', name: 'X', avatarUrl: 'javascript:alert(1)' }] }));

      expect(el.querySelector('img')).toBeNull();
    });

    it('shows an unknown person by a placeholder label', () => {
      const el = renderCellValue(prop('person'), [{ id: 'gone' }], ctx());

      expect(el.textContent).toBe('tools.database.personUnknown');
    });

    it('shows created by and last edited by as people', () => {
      expect(renderCellValue(prop('createdBy'), [{ id: 'u2' }], ctx({ people })).textContent).toBe('Grace Hopper');
      expect(renderCellValue(prop('lastEditedBy'), [], ctx({ people })).hasAttribute('data-empty')).toBe(true);
    });
  });

  describe('files', () => {
    it('shows one chip per file, linked only when the url is safe', () => {
      const el = renderCellValue(prop('files'), [
        { id: 'f1', name: 'brief.pdf', url: 'https://cdn.example.com/brief.pdf' },
        { id: 'f2', name: 'bad', url: 'javascript:alert(1)' },
      ], ctx());
      const chips = [...el.querySelectorAll('[data-blok-database-file-chip]')];

      expect(chips.map((c) => c.textContent)).toEqual(['brief.pdf', 'bad']);
      expect(chips[0].closest('a')?.getAttribute('href') ?? chips[0].querySelector('a')?.getAttribute('href')).toBe('https://cdn.example.com/brief.pdf');
      expect(el.querySelectorAll('[href]')).toHaveLength(1);
    });
  });

  describe('number', () => {
    it('formats with the property number format', () => {
      expect(renderCellValue(prop('number', { number: { format: 'dollar' } }), 1200, ctx()).textContent)
        .toBe(formatNumberValue(1200, { format: 'dollar' }, 'en-US'));
    });

    it('formats a number stored as text', () => {
      expect(renderCellValue(prop('number', { number: { format: 'percent' } }), '0.5', ctx()).textContent)
        .toBe(formatNumberValue(0.5, { format: 'percent' }, 'en-US'));
    });

    it('draws a bar filled by divide-by', () => {
      const el = renderCellValue(prop('number', { number: { showAs: 'bar', divideBy: 200, color: 'green' } }), 50, ctx());
      const bar = el.querySelector<HTMLElement>('[data-blok-database-number-bar]');

      expect(bar?.style.getPropertyValue('--blok-database-number-fill')).toBe('25%');
      expect(bar?.getAttribute('data-color')).toBe('green');
      expect(el.textContent).toBe('50');
    });

    it('draws a ring', () => {
      const el = renderCellValue(prop('number', { number: { showAs: 'ring' } }), 75, ctx());

      expect(el.querySelector<HTMLElement>('[data-blok-database-number-ring]')?.style.getPropertyValue('--blok-database-number-fill')).toBe('75%');
    });
  });

  describe('created and last edited time', () => {
    it('shows the time with the property date settings', () => {
      const iso = new Date(Date.UTC(2026, 9, 9, 12)).toISOString();
      const el = renderCellValue(prop('createdTime', { date: { dateFormat: 'year_month_day', timeFormat: 'hidden' } }), iso, ctx());

      expect(el.textContent).toBe(formatDateDisplay(iso, 'en-US', { dateFormat: 'year_month_day', timeFormat: 'hidden' }));
    });

    it('applies the date settings to a date property too', () => {
      expect(renderCellValue(prop('date', { date: { dateFormat: 'day_month_year' } }), '2026-10-09', ctx()).textContent).toBe('09/10/2026');
    });
  });

  describe('unique id', () => {
    it('shows the number after its prefix', () => {
      expect(renderCellValue(prop('uniqueId', { uniqueId: { prefix: 'TASK' } }), 12, ctx()).textContent).toBe('TASK-12');
      expect(renderCellValue(prop('uniqueId'), 3, ctx()).textContent).toBe('3');
    });
  });

  it('shows a type from a newer client as empty, without throwing', () => {
    const el = renderCellValue(prop('place' as PropertyType), { lat: 1 } as never, ctx());

    expect(el.textContent).toBe('');
  });
});

describe('openCellEditor — read-only and unknown types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each(['createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'uniqueId', 'place'])('opens nothing for %s', (type) => {
    const context = makeEditorContext();
    const handle = openCellEditor(prop(type as PropertyType), null, makeAnchor(), context);

    expect(handle.isOpen).toBe(false);
    expect(context.onCommit).not.toHaveBeenCalled();
  });

  it('edits email and phone as text', () => {
    const handle = openCellEditor(prop('email'), 'a@b.io', makeAnchor(), makeEditorContext());

    expect(handle.isOpen).toBe(true);
    handle.cancel();
  });
});
