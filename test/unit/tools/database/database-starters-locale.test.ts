import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { I18n } from '../../../../src/components/modules/i18n';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { createStarterBuilder } from '../../../../src/tools/database/database-starter-build';
import { DATABASE_STARTERS } from '../../../../src/tools/database/database-starters';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import { readPropertyValue } from '../../../../src/tools/database/property-values';
import type { SupportedLocale } from '../../../../types/configs/i18n-config';

const buildStarter = createStarterBuilder(DATABASE_STARTERS);

/** Days open builds its "N days" text from a localized pattern through Blok's own translator. */
describe('Issue Tracking Days open in a non-English locale (research/33 §3.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<SupportedLocale>(['ru', 'de', 'ar'])('%s: reads the localized day count and closed text', async (locale) => {
    const i18n = new I18n({ config: {}, eventsDispatcher: new EventsDispatcher() });

    await i18n.prepare();
    await i18n.setLocale(locale);
    const t = (key: string, vars?: Record<string, string>): string => i18n.t(key, vars);
    const ids = { next: 0 };
    const made = buildStarter('issues', {
      t, newId: () => `id${(ids.next += 1)}`, titleId: 'title', features: new Set(['daysOpen']),
    });
    const status = made.schema.find((p) => p.type === 'status');
    const days = made.schema.find((p) => p.type === 'formula');

    if (status === undefined || days === undefined) throw new Error('missing property');
    const open = status.config?.options[1].id ?? '';
    const done = status.config?.options[6].id ?? '';
    const now = new Date('2026-10-21T12:00:00Z');
    const row = (id: string, state: string, age: number): { id: string; position: string; properties: Record<string, string>; meta: { createdAt: number } } =>
      ({ id, position: id, properties: { [status.id]: state }, meta: { createdAt: now.getTime() - age * 86_400_000 } });
    const rows = new ComputedProperties('db').apply(made.schema, [row('a', open, 1), row('b', open, 5), row('c', done, 5)], { databaseId: 'db', now, timeZone: 'UTC' });

    expect(rows.map((r) => readPropertyValue(r, days))).toEqual([
      i18n.t('tools.database.starterOneDay'),
      i18n.t('tools.database.starterDaysCount', { count: '5' }),
      i18n.t('tools.database.starterIssueClosed'),
    ]);
    expect(i18n.t('tools.database.starterDaysCount', { count: '5' })).not.toContain('{count}');
    expect(i18n.t('tools.database.starterIssueClosed')).not.toBe('Issue Closed');
  });
});
