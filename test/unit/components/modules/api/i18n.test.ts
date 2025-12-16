import { describe, it, expect, beforeEach, vi } from 'vitest';

import I18nAPI from '../../../../../src/components/modules/api/i18n';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';

const { translateMock, hasTranslationMock } = vi.hoisted(() => {
  return {
    translateMock: vi.fn(),
    hasTranslationMock: vi.fn(),
  };
});

vi.mock('../../../../../src/components/i18n', () => ({
  default: {
    t: translateMock,
    hasTranslation: hasTranslationMock,
  },
}));

const createI18nApi = (): I18nAPI => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  return new I18nAPI(moduleConfig);
};

describe('I18nAPI', () => {
  beforeEach(() => {
    translateMock.mockReset();
    hasTranslationMock.mockReset();
    hasTranslationMock.mockReturnValue(true);
  });

  describe('methods getter', () => {
    it('translates using global dictionary access', () => {
      const api = createI18nApi();

      translateMock.mockReturnValue('Translated');
      const result = api.methods.t('ui.toolbar.title');

      expect(hasTranslationMock).toHaveBeenCalledWith('ui.toolbar.title');
      expect(translateMock).toHaveBeenCalledWith('ui.toolbar.title');
      expect(result).toBe('Translated');
    });

    it('returns key when translation does not exist', () => {
      const api = createI18nApi();

      hasTranslationMock.mockReturnValue(false);
      const result = api.methods.t('missing.key');

      expect(hasTranslationMock).toHaveBeenCalledWith('missing.key');
      expect(translateMock).not.toHaveBeenCalled();
      expect(result).toBe('missing.key');
    });

    it('returns memoized object on subsequent accesses', () => {
      const api = createI18nApi();

      const firstAccess = api.methods;
      const secondAccess = api.methods;

      expect(firstAccess).toBe(secondAccess);
    });
  });

  describe('getMethodsForTool', () => {
    it('translates using tools namespace for regular tool', () => {
      const api = createI18nApi();
      const methods = api.getMethodsForTool('paragraph', false);

      translateMock.mockReturnValue('Label');
      const result = methods.t('label');

      expect(hasTranslationMock).toHaveBeenCalledWith('tools.paragraph.label');
      expect(translateMock).toHaveBeenCalledWith('tools.paragraph.label');
      expect(result).toBe('Label');
    });

    it('translates using blockTunes namespace for block tune', () => {
      const api = createI18nApi();
      const methods = api.getMethodsForTool('settings', true);

      translateMock.mockReturnValue('Title');
      const result = methods.t('title');

      expect(hasTranslationMock).toHaveBeenCalledWith('blockTunes.settings.title');
      expect(translateMock).toHaveBeenCalledWith('blockTunes.settings.title');
      expect(result).toBe('Title');
    });

    it('returns original dictKey when translation does not exist', () => {
      const api = createI18nApi();
      const methods = api.getMethodsForTool('paragraph', false);

      hasTranslationMock.mockReturnValue(false);
      const result = methods.t('missing key');

      expect(hasTranslationMock).toHaveBeenCalledWith('tools.paragraph.missing key');
      expect(translateMock).not.toHaveBeenCalled();
      expect(result).toBe('missing key');
    });
  });
});
