import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1' },
];

/** A ru editor in an en-US browser: dates must read in Russian. */
const build = (type: 'calendar' | 'gallery' | 'list'): HTMLElement => {
  const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', due: '2026-10-22' }, 'a0')]);

  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
  Object.assign(doc.api.i18n, { getLocale: () => 'ru' });
  const { tool, el } = buildTool(doc, {}, tableData(SCHEMA, { type, ...(type === 'calendar' ? { calendarBy: 'due' } : {}) }));

  built.push(tool);

  return el;
};

const built: Array<{ destroy: () => void }> = [];

describe('DatabaseTool — views write dates in the editor\'s locale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 22, 12));
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('the calendar names its month in the editor\'s language', () => {
    const el = build('calendar');

    expect(el.querySelector('[data-blok-database-calendar-title]')?.textContent).toBe('октябрь 2026 г.');
  });

  it.each(['gallery', 'list'] as const)('a %s date cell reads in the editor\'s language', (type) => {
    const el = build(type);

    expect(el.querySelector('[data-blok-database-cell="date"]')?.textContent).toBe('22 октября 2026 г.');
  });
});
