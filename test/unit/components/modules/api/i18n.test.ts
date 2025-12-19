import { describe, it, expect, vi } from 'vitest';

import { I18nAPI } from '../../../../../src/components/modules/api/i18n';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

const createI18nApi = (): { api: I18nAPI; i18nMock: { t: ReturnType<typeof vi.fn>; has: ReturnType<typeof vi.fn> } } => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  const api = new I18nAPI(moduleConfig);

  // Create mock I18n module
  const i18nMock = {
    t: vi.fn((key: string) => key),
    has: vi.fn(() => true),
  };

  // Set up state with mocked I18n
  api.state = {
    I18n: i18nMock,
  } as unknown as BlokModules;

  return { api, i18nMock };
};

describe('I18nAPI', () => {
  describe('methods getter', () => {
    it('translates using global dictionary access', () => {
      const { api, i18nMock } = createI18nApi();

      i18nMock.t.mockReturnValue('Translated');
      const result = api.methods.t('popover.search');

      // i18next is called directly - it returns key if missing
      expect(i18nMock.t).toHaveBeenCalledWith('popover.search');
      expect(result).toBe('Translated');
    });

    it('returns key when translation does not exist', () => {
      const { api, i18nMock } = createI18nApi();

      // i18next returns key when translation is missing
      i18nMock.t.mockReturnValue('missing.key');
      const result = api.methods.t('missing.key');

      expect(i18nMock.t).toHaveBeenCalledWith('missing.key');
      expect(result).toBe('missing.key');
    });

    it('returns memoized object on subsequent accesses', () => {
      const { api } = createI18nApi();

      const firstAccess = api.methods;
      const secondAccess = api.methods;

      expect(firstAccess).toBe(secondAccess);
    });
  });
});
