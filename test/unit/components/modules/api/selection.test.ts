import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SelectionAPI } from '../../../../../src/components/modules/api/selection';
import type { SelectionUtils } from '../../../../../src/components/selection';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';

const createSelectionApi = (): SelectionAPI => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  return new SelectionAPI(moduleConfig);
};

describe('SelectionAPI', () => {
  let selectionApi: SelectionAPI;
  const selectionUtilsFor = (api: SelectionAPI): SelectionUtils => {
    return (api as unknown as { selectionUtils: SelectionUtils }).selectionUtils;
  };

  beforeEach(() => {
    selectionApi = createSelectionApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('methods getter', () => {
    it('exposes findParentTag and expandToTag wrappers', () => {
      const findParentSpy = vi.spyOn(selectionApi, 'findParentTag');
      const expandSpy = vi.spyOn(selectionApi, 'expandToTag');

      const element = document.createElement('span');

      selectionApi.methods.findParentTag('SPAN', 'highlight');
      selectionApi.methods.expandToTag(element);

      expect(findParentSpy).toHaveBeenCalledWith('SPAN', 'highlight');
      expect(expandSpy).toHaveBeenCalledWith(element);
    });

    it('exposes SelectionUtils passthrough methods', () => {
      const utilsInstance = selectionUtilsFor(selectionApi);
      const saveSpy = vi.spyOn(utilsInstance, 'save');
      const restoreSpy = vi.spyOn(utilsInstance, 'restore');
      const setFakeBackgroundSpy = vi.spyOn(utilsInstance, 'setFakeBackground');
      const removeFakeBackgroundSpy = vi.spyOn(utilsInstance, 'removeFakeBackground');

      selectionApi.methods.save();
      selectionApi.methods.restore();
      selectionApi.methods.setFakeBackground();
      selectionApi.methods.removeFakeBackground();

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(restoreSpy).toHaveBeenCalledTimes(1);
      expect(setFakeBackgroundSpy).toHaveBeenCalledTimes(1);
      expect(removeFakeBackgroundSpy).toHaveBeenCalled();
    });
  });

  it('delegates findParentTag to SelectionUtils instance', () => {
    const expectedElement = document.createElement('p');
    const findParentSpy = vi
      .spyOn(selectionUtilsFor(selectionApi), 'findParentTag')
      .mockReturnValue(expectedElement);

    const result = selectionApi.findParentTag('P', 'cls');

    expect(findParentSpy).toHaveBeenCalledWith('P', 'cls');
    expect(result).toBe(expectedElement);
  });

  it('delegates expandToTag to SelectionUtils instance', () => {
    const element = document.createElement('div');
    const expandSpy = vi.spyOn(selectionUtilsFor(selectionApi), 'expandToTag');

    selectionApi.expandToTag(element);

    expect(expandSpy).toHaveBeenCalledWith(element);
  });
});
