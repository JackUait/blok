import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { I18nAPI } from '../../../../../src/components/modules/api/i18n';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Mock } from 'vitest';

/**
 * Mutant notes for src/components/modules/api/i18n.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type I18nModuleMock = {
  t: Mock<(key: string, vars?: Record<string, string | number>) => string>;
  has: Mock<(key: string) => boolean>;
  getEnglishTranslation: Mock<(key: string) => string>;
  getLocale: Mock<() => string>;
};

const makeApi = (): { api: I18nAPI; i18n: I18nModuleMock } => {
  const i18n: I18nModuleMock = {
    t: vi.fn((key: string) => `translated:${key}`),
    has: vi.fn(() => true),
    getEnglishTranslation: vi.fn(() => 'Bold'),
    getLocale: vi.fn(() => 'ru'),
  };

  const api = new I18nAPI({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  // Only the I18n module is reachable from the methods under test.
  api.state = { I18n: i18n } as unknown as BlokModules;

  return { api,
    i18n };
};

describe('I18nAPI methods', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('reports whether a key exists', () => {
    const { api, i18n } = makeApi();

    expect(api.methods.has('tools.link.addLink')).toBe(true);
    expect(i18n.has.mock.calls).toStrictEqual([['tools.link.addLink']]);
  });

  it('returns the English translation of a key', () => {
    const { api, i18n } = makeApi();

    expect(api.methods.getEnglishTranslation('toolNames.bold')).toBe('Bold');
    expect(i18n.getEnglishTranslation.mock.calls).toStrictEqual([['toolNames.bold']]);
  });

  it('translates with and without variables', () => {
    const { api, i18n } = makeApi();

    expect(api.methods.t('notifier.ok')).toBe('translated:notifier.ok');
    api.methods.t('notifier.ok', { count: 2 });

    expect(i18n.t.mock.calls).toStrictEqual([['notifier.ok'], ['notifier.ok', { count: 2 }]]);
  });

  it('returns the active locale', () => {
    const { api } = makeApi();

    expect(api.methods.getLocale()).toBe('ru');
  });
});
