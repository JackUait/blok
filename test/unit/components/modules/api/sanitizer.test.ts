import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventsDispatcher from '../../../../../src/components/utils/events';
import SanitizerAPI from '../../../../../src/components/modules/api/sanitizer';
import * as sanitizerUtils from '../../../../../src/components/utils/sanitizer';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { SanitizerConfig } from '../../../../../types/configs';

const createSanitizerApi = (): SanitizerAPI => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  return new SanitizerAPI(moduleConfig);
};

describe('SanitizerAPI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes clean method via methods getter', () => {
    const sanitizerApi = createSanitizerApi();
    const cleanSpy = vi.spyOn(sanitizerApi, 'clean').mockReturnValue('cleaned');
    const config = { strong: {} } as SanitizerConfig;
    const taint = '<strong>text</strong>';

    const result = sanitizerApi.methods.clean(taint, config);

    expect(cleanSpy).toHaveBeenCalledWith(taint, config);
    expect(result).toBe('cleaned');
  });

  it('delegates clean implementation to sanitizer utils', () => {
    const sanitizerApi = createSanitizerApi();
    const cleanSpy = vi.spyOn(sanitizerUtils, 'clean').mockReturnValue('utility-result');
    const config = { strong: {} } as SanitizerConfig;
    const taint = '<strong>text</strong>';

    const result = sanitizerApi.clean(taint, config);

    expect(cleanSpy).toHaveBeenCalledWith(taint, config);
    expect(result).toBe('utility-result');
  });
});
