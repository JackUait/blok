import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeAPI } from '../../../../../src/components/modules/api/theme';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

function createThemeAPI() {
  const themeManager = {
    getMode: vi.fn().mockReturnValue('auto'),
    setMode: vi.fn(),
    getResolved: vi.fn().mockReturnValue('light'),
  };

  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const api = new ThemeAPI(moduleConfig);

  api.state = {
    ThemeManager: themeManager,
  } as unknown as BlokModules;

  return { api, themeManager };
}

describe('ThemeAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should expose get() that delegates to ThemeManager.getMode()', () => {
    const { api, themeManager } = createThemeAPI();
    const result = api.methods.get();
    expect(themeManager.getMode).toHaveBeenCalled();
    expect(result).toBe('auto');
  });

  it('should expose set() that delegates to ThemeManager.setMode()', () => {
    const { api, themeManager } = createThemeAPI();
    api.methods.set('dark');
    expect(themeManager.setMode).toHaveBeenCalledWith('dark');
  });

  it('should expose getResolved() that delegates to ThemeManager.getResolved()', () => {
    const { api, themeManager } = createThemeAPI();
    const result = api.methods.getResolved();
    expect(themeManager.getResolved).toHaveBeenCalled();
    expect(result).toBe('light');
  });
});
