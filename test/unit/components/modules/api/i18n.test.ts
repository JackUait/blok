import { describe, it, expect, beforeEach, vi } from 'vitest';

import I18nAPI from '../../../../../src/components/modules/api/i18n';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';

type EsModuleKey = '__esModule';
type EsModule<T extends object> = T & { [K in EsModuleKey]: true };
type WithEsModuleFlag = <T extends object>(moduleMock: T) => EsModule<T>;

/**
 *
 * @param moduleMock - The module object to add the ES module flag to
 */
const withEsModuleFlag: WithEsModuleFlag = vi.hoisted(() => {
  return (<T extends object>(moduleMock: T): EsModule<T> => {
    return Object.defineProperty(moduleMock, '__esModule', {
      configurable: true,
      enumerable: true,
      value: true,
    }) as EsModule<T>;
  });
});

const { logLabeledMock, translateMock } = vi.hoisted(() => {
  return {
    logLabeledMock: vi.fn(),
    translateMock: vi.fn(),
  };
});

vi.mock('../../../../../src/components/utils', () =>
  withEsModuleFlag({
    logLabeled: logLabeledMock,
  })
);

vi.mock('../../../../../src/components/i18n', () =>
  withEsModuleFlag({
    default: {
      t: translateMock,
    },
  })
);

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
    logLabeledMock.mockReset();
    translateMock.mockReset();
  });

  it('warns and returns an empty string when calling global t()', () => {
    const api = createI18nApi();

    const result = api.methods.t('global');

    expect(result).toBe('');
    expect(logLabeledMock).toHaveBeenCalledWith(
      'I18n.t() method can be accessed only from Tools',
      'warn'
    );
  });

  it('translates using tools namespace for regular tool', () => {
    const api = createI18nApi();
    const methods = api.getMethodsForTool('paragraph', false);

    methods.t('label');

    expect(translateMock).toHaveBeenCalledWith('tools.paragraph.label');
  });

  it('translates using blockTunes namespace for block tune', () => {
    const api = createI18nApi();
    const methods = api.getMethodsForTool('settings', true);

    methods.t('title');

    expect(translateMock).toHaveBeenCalledWith('blockTunes.settings.title');
  });
});

