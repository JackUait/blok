import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WidthAPI } from '../../../../../src/components/modules/api/width';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

function createWidthAPI() {
  const widthManager = {
    getWidth: vi.fn().mockReturnValue('narrow'),
    setWidth: vi.fn(),
    toggle: vi.fn(),
  };

  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const api = new WidthAPI(moduleConfig);

  api.state = {
    WidthManager: widthManager,
  } as unknown as BlokModules;

  return { api, widthManager };
}

describe('WidthAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should expose get() that delegates to WidthManager.getWidth()', () => {
    const { api, widthManager } = createWidthAPI();
    const result = api.methods.get();
    expect(widthManager.getWidth).toHaveBeenCalled();
    expect(result).toBe('narrow');
  });

  it('should expose set() that delegates to WidthManager.setWidth()', () => {
    const { api, widthManager } = createWidthAPI();
    api.methods.set('full');
    expect(widthManager.setWidth).toHaveBeenCalledWith('full');
  });

  it('should expose toggle() that delegates to WidthManager.toggle()', () => {
    const { api, widthManager } = createWidthAPI();
    const result = api.methods.toggle();
    expect(widthManager.toggle).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
