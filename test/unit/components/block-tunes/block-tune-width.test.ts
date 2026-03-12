import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { WidthTune } from '../../../../src/components/block-tunes/block-tune-width';
import type { API } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';

type WidthMocks = {
  get: Mock<() => 'narrow' | 'full'>;
  set: Mock<(mode: 'narrow' | 'full') => void>;
};

type I18nMocks = {
  t: Mock<(text: string) => string>;
};

function createWidthTune(currentMode: 'narrow' | 'full' = 'narrow') {
  const widthApi: WidthMocks = {
    get: vi.fn().mockReturnValue(currentMode),
    set: vi.fn(),
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

  it('render() should return an array with two MenuConfig items', () => {
    const { tune } = createWidthTune();
    const items = tune.render() as MenuConfigItemWithActivate[];
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('first item should be the narrow option', () => {
    const { tune } = createWidthTune();
    const items = tune.render() as MenuConfigItemWithActivate[];
    expect(items[0].name).toBe('width-narrow');
  });

  it('second item should be the full width option', () => {
    const { tune } = createWidthTune();
    const items = tune.render() as MenuConfigItemWithActivate[];
    expect(items[1].name).toBe('width-full');
  });

  it('narrow item should be active when current mode is narrow', () => {
    const { tune } = createWidthTune('narrow');
    const items = tune.render() as MenuConfigItemWithActivate[];
    expect(items[0].isActive).toBe(true);
    expect(items[1].isActive).toBe(false);
  });

  it('full item should be active when current mode is full', () => {
    const { tune } = createWidthTune('full');
    const items = tune.render() as MenuConfigItemWithActivate[];
    expect(items[0].isActive).toBe(false);
    expect(items[1].isActive).toBe(true);
  });

  it('onActivate of narrow item should call api.width.set("narrow")', () => {
    const { tune, widthApi } = createWidthTune();
    const items = tune.render() as MenuConfigItemWithActivate[];
    items[0].onActivate?.(items[0]);
    expect(widthApi.set).toHaveBeenCalledWith('narrow');
  });

  it('onActivate of full item should call api.width.set("full")', () => {
    const { tune, widthApi } = createWidthTune();
    const items = tune.render() as MenuConfigItemWithActivate[];
    items[1].onActivate?.(items[1]);
    expect(widthApi.set).toHaveBeenCalledWith('full');
  });
});
