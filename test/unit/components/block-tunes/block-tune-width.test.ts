import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { WidthTune } from '../../../../src/components/block-tunes/block-tune-width';
import type { API } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';

type WidthMocks = {
  get: Mock<() => 'narrow' | 'full'>;
  set: Mock<(mode: 'narrow' | 'full') => void>;
  toggle: Mock<() => void>;
};

type I18nMocks = {
  t: Mock<(text: string) => string>;
};

function createWidthTune(currentMode: 'narrow' | 'full' = 'narrow') {
  const widthApi: WidthMocks = {
    get: vi.fn().mockReturnValue(currentMode),
    set: vi.fn(),
    toggle: vi.fn(),
  };

  const i18n: I18nMocks = {
    t: vi.fn((key: string) => key),
  };

  const api = {
    i18n: i18n as unknown as API['i18n'],
    width: widthApi as unknown as API['width'],
  } as API;

  const tune = new WidthTune({ api });

  return { tune, widthApi };
}

type MenuConfigItemWithActivate = Extract<MenuConfig, { onActivate: unknown }>;

describe('WidthTune', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have isTune = true', () => {
    expect(WidthTune.isTune).toBe(true);
  });

  it('render() should return a single MenuConfig item (not an array)', () => {
    const { tune } = createWidthTune();
    const item = tune.render();
    expect(Array.isArray(item)).toBe(false);
  });

  it('should use name "toggle-width"', () => {
    const { tune } = createWidthTune();
    const item = tune.render() as MenuConfigItemWithActivate;
    expect(item.name).toBe('toggle-width');
  });

  it('isActive should be false when current mode is narrow', () => {
    const { tune } = createWidthTune('narrow');
    const item = tune.render() as MenuConfigItemWithActivate;
    expect(item.isActive).toBe(false);
  });

  it('isActive should be true when current mode is full', () => {
    const { tune } = createWidthTune('full');
    const item = tune.render() as MenuConfigItemWithActivate;
    expect(item.isActive).toBe(true);
  });

  it('onActivate should call api.width.toggle()', () => {
    const { tune, widthApi } = createWidthTune();
    const item = tune.render() as MenuConfigItemWithActivate;
    item.onActivate?.(item);
    expect(widthApi.toggle).toHaveBeenCalledTimes(1);
  });

  it('closeOnActivate should be true', () => {
    const { tune } = createWidthTune();
    const item = tune.render() as MenuConfigItemWithActivate;
    expect(item.closeOnActivate).toBe(true);
  });

  it('toggle should be true', () => {
    const { tune } = createWidthTune();
    const item = tune.render() as MenuConfigItemWithActivate;
    expect(item.toggle).toBe(true);
  });
});
