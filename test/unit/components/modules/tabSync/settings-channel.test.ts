import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabSync } from '../../../../../src/components/modules/tabSync';
import { TAB_SYNC_PROTOCOL } from '../../../../../src/components/modules/tabSync/identity';
import { SETTINGS_CHANNEL, createSettingsChannel } from '../../../../../src/components/modules/tabSync/settings-channel';
import type { SettingMessage } from '../../../../../src/components/modules/tabSync/settings-channel';
import type { TabPlatform } from '../../../../../src/components/modules/tabSync/platform';
import { I18nChanged, SettingChanged } from '../../../../../src/components/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { expandPersistenceConfig } from '../../../../../src/components/utils/persistence';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlokConfig } from '../../../../../types';

import { createFakeBlok, createFakePlatform } from './fakes';

const flush = async (): Promise<void> => {
  await vi.runAllTimersAsync();
};

/**
 * One tab's end of the channel, with its own source and apply spies.
 * @param platform - shared fake platform
 * @param documentKey - this tab's document key
 */
const side = (platform: TabPlatform, documentKey?: string) => {
  const source: { emit: (s: SettingMessage) => void } = { emit: () => undefined };
  const apply = vi.fn<(s: SettingMessage) => void>();
  const channel = createSettingsChannel({
    platform,
    documentKey,
    on: (listener) => {
      source.emit = listener;

      return () => undefined;
    },
    apply,
  });

  return { change: (s: SettingMessage) => source.emit(s), apply, channel };
};

describe('settings channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a locale change in one tab applies in the other, once, without echo', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);

    a.change({ setting: 'locale', value: 'ru' });
    await flush();

    expect(b.apply).toHaveBeenCalledTimes(1);
    expect(b.apply).toHaveBeenCalledWith({ setting: 'locale', value: 'ru' });
    expect(a.apply).not.toHaveBeenCalled();
  });

  it('theme mode follows', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);

    a.change({ setting: 'theme', value: 'dark' });
    await flush();

    expect(b.apply).toHaveBeenCalledWith({ setting: 'theme', value: 'dark' });
  });

  it('width applies only to the same document', async () => {
    const platform = createFakePlatform();
    const a = side(platform, 'doc-1');
    const same = side(platform, 'doc-1');
    const other = side(platform, 'doc-2');
    const keyless = side(platform);

    a.change({ setting: 'width', value: 'full', documentKey: 'doc-1' });
    await flush();

    expect(same.apply).toHaveBeenCalledTimes(1);
    expect(same.apply).toHaveBeenCalledWith({ setting: 'width', value: 'full' });
    expect(other.apply).not.toHaveBeenCalled();
    expect(keyless.apply).not.toHaveBeenCalled();
  });

  it('a tab with no document key never sends width', async () => {
    const platform = createFakePlatform();
    const keyless = side(platform);
    const listener = vi.fn();

    platform.rawChannel(SETTINGS_CHANNEL)?.onMessage(listener);
    keyless.change({ setting: 'width', value: 'full' });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('applying a received setting never re-broadcasts', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);
    const c = side(platform);

    // I18n emits the applied locale back; theme and width setters are silent.
    b.apply.mockImplementation((s) => b.change(s));
    a.change({ setting: 'locale', value: 'ru' });
    await flush();

    expect(c.apply).toHaveBeenCalledTimes(1);
  });

  it('an echo that comes back on a later tick is swallowed too', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);
    const c = side(platform);

    // I18n.update emits I18nChanged only after its repaint resolves.
    b.apply.mockImplementation((s) => {
      setTimeout(() => b.change(s), 10);
    });
    a.change({ setting: 'locale', value: 'ru' });
    await flush();

    expect(c.apply).toHaveBeenCalledTimes(1);
  });

  it('a later change of the same setting is still sent', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);

    a.change({ setting: 'theme', value: 'dark' });
    await flush();
    b.change({ setting: 'theme', value: 'light' });
    await flush();
    b.change({ setting: 'theme', value: 'dark' });
    await flush();

    expect(a.apply).toHaveBeenNthCalledWith(1, { setting: 'theme', value: 'light' });
    expect(a.apply).toHaveBeenNthCalledWith(2, { setting: 'theme', value: 'dark' });
  });

  it('a theme received earlier never swallows a later host change to that theme', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);

    a.change({ setting: 'theme', value: 'dark' });
    await flush();
    // B's tool then sets light through api.theme.set, which emits nothing.
    // The host sets dark again: a real change, so A must hear it.
    b.change({ setting: 'theme', value: 'dark' });
    await flush();

    expect(a.apply).toHaveBeenCalledWith({ setting: 'theme', value: 'dark' });
  });

  it('a width received earlier never swallows a later host change to that width', async () => {
    const platform = createFakePlatform();
    const a = side(platform, 'doc-1');
    const b = side(platform, 'doc-1');

    a.change({ setting: 'width', value: 'full' });
    await flush();
    b.change({ setting: 'width', value: 'full' });
    await flush();

    expect(a.apply).toHaveBeenCalledWith({ setting: 'width', value: 'full' });
  });

  it('ignores malformed, foreign-protocol and out-of-range messages', async () => {
    const platform = createFakePlatform();
    const raw = platform.rawChannel(SETTINGS_CHANNEL);
    const b = side(platform, 'doc-1');

    raw?.post({ protocol: TAB_SYNC_PROTOCOL + 1, kind: 'setting', setting: 'theme', value: 'dark' });
    raw?.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: 'theme', value: 'purple' });
    raw?.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: 'width', value: 'huge', documentKey: 'doc-1' });
    raw?.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: 'readOnly', value: 'true' });
    raw?.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: 'locale', value: 7 });
    raw?.post('junk');
    raw?.post(null);
    await flush();

    expect(b.apply).not.toHaveBeenCalled();
  });

  it('a setting that arrives before this editor started is ignored without throwing', async () => {
    const platform = createFakePlatform();
    const early = platform.rawChannel(SETTINGS_CHANNEL);

    early?.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: 'locale', value: 'ru' });
    await expect(flush()).resolves.toBeUndefined();

    const late = side(platform);

    await flush();

    expect(late.apply).not.toHaveBeenCalled();
  });

  it('stops sending and receiving once closed', async () => {
    const platform = createFakePlatform();
    const a = side(platform);
    const b = side(platform);

    b.channel.close();
    a.change({ setting: 'theme', value: 'dark' });
    b.change({ setting: 'theme', value: 'light' });
    await flush();

    expect(a.apply).not.toHaveBeenCalled();
    expect(b.apply).not.toHaveBeenCalled();
  });

  it('works on its own when BroadcastChannel is missing', () => {
    const platform: TabPlatform = { ...createFakePlatform(), rawChannel: () => null };
    const lone = side(platform);

    expect(() => lone.change({ setting: 'theme', value: 'dark' })).not.toThrow();
    expect(() => lone.channel.close()).not.toThrow();
  });
});

describe('TabSync — settings', () => {
  type FakePlatform = ReturnType<typeof createFakePlatform>;

  const makeTab = (platform: FakePlatform, overrides: Partial<BlokConfig> = {}, minted = false) => {
    const fake = {
      ...createFakeBlok({ minted }),
      I18n: { getLocale: vi.fn(() => 'en'), update: vi.fn(async (_options: { locale: string }): Promise<void> => undefined) },
      ThemeManager: { setMode: vi.fn() },
      UI: { setWidthMode: vi.fn() },
    };
    const config = expandPersistenceConfig({
      documentId: 'doc',
      persistence: { load: async () => null, save: vi.fn(async () => ({ version: 'v-next' })) },
      ...overrides,
    });
    const bus = new EventsDispatcher<BlokEventMap>();
    const sync = new TabSync({ config, eventsDispatcher: bus });

    sync.state = fake as unknown as BlokModules;
    sync.setPlatform(platform);

    return { sync, fake, bus, config };
  };

  const CONTEXT = { loadedFromPersistence: true, isEmpty: false };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('carries locale, theme mode and width from one editor to the other', async () => {
    const platform = createFakePlatform();
    const a = makeTab(platform);
    const b = makeTab(platform);

    await a.sync.start(CONTEXT);
    await b.sync.start(CONTEXT);
    await flush();

    a.bus.emit(I18nChanged, { locale: 'ru', direction: 'ltr' });
    a.bus.emit(SettingChanged, { setting: 'theme', value: 'dark' });
    a.bus.emit(SettingChanged, { setting: 'width', value: 'full' });
    await flush();

    expect(b.fake.I18n.update).toHaveBeenCalledWith({ locale: 'ru' });
    expect(b.fake.ThemeManager.setMode).toHaveBeenCalledWith('dark');
    expect(b.fake.UI.setWidthMode).toHaveBeenCalledWith('full');
    a.sync.destroy();
    b.sync.destroy();
  });

  it('keeps settings on while another document is open in the other tab, except width', async () => {
    const platform = createFakePlatform();
    const a = makeTab(platform);
    const b = makeTab(platform, { documentId: 'other' });

    await a.sync.start(CONTEXT);
    await b.sync.start(CONTEXT);
    await flush();

    a.bus.emit(SettingChanged, { setting: 'theme', value: 'dark' });
    a.bus.emit(SettingChanged, { setting: 'width', value: 'full' });
    await flush();

    expect(b.fake.ThemeManager.setMode).toHaveBeenCalledWith('dark');
    expect(b.fake.UI.setWidthMode).not.toHaveBeenCalled();
    a.sync.destroy();
    b.sync.destroy();
  });

  it('a TabSync with settings: false opens no settings channel', async () => {
    const platform = createFakePlatform();
    const spy = vi.spyOn(platform, 'rawChannel');
    const { sync } = makeTab(platform, { tabSync: { settings: false } });

    await sync.start(CONTEXT);
    await flush();

    expect(spy).not.toHaveBeenCalledWith(SETTINGS_CHANNEL);
    sync.destroy();
  });

  it('opens no settings channel with tabSync: false or with collaboration', async () => {
    const platform = createFakePlatform();
    const spy = vi.spyOn(platform, 'rawChannel');
    const off = makeTab(platform, { tabSync: false });
    const collab = makeTab(platform, { collaboration: { url: 'ws://x', doc: 'd' } as unknown as BlokConfig['collaboration'] });

    await off.sync.start(CONTEXT);
    await collab.sync.start(CONTEXT);
    await flush();

    expect(spy).not.toHaveBeenCalledWith(SETTINGS_CHANNEL);
  });

  it('opens the settings channel even with no document key, and closes it on destroy', async () => {
    const platform = createFakePlatform();
    const { sync } = makeTab(platform, { documentId: undefined });

    await sync.start({ loadedFromPersistence: false, isEmpty: true });
    await flush();

    expect(platform.openChannels(SETTINGS_CHANNEL)).toBe(1);
    sync.destroy();
    expect(platform.openChannels(SETTINGS_CHANNEL)).toBe(0);
  });

  it('width starts to follow once a minted id gets its key at the first save', async () => {
    const platform = createFakePlatform();
    const minted = makeTab(platform, { documentId: undefined }, true);
    const loaded = makeTab(platform, { documentId: undefined });

    await minted.sync.start({ loadedFromPersistence: false, isEmpty: false });
    await loaded.sync.start(CONTEXT);
    await flush();
    await minted.config.onSave?.({ blocks: [] }, {} as unknown as API);
    await flush();

    minted.bus.emit(SettingChanged, { setting: 'width', value: 'full' });
    await flush();

    expect(loaded.fake.UI.setWidthMode).toHaveBeenCalledWith('full');
    expect(platform.openChannels(SETTINGS_CHANNEL)).toBe(2);
    minted.sync.destroy();
    loaded.sync.destroy();
  });

  it('sends the locale only when it changed, not on a messages-only or direction-only update', async () => {
    const platform = createFakePlatform();
    const a = makeTab(platform);
    const listener = vi.fn();

    await a.sync.start(CONTEXT);
    await flush();
    platform.rawChannel(SETTINGS_CHANNEL)?.onMessage(listener);

    // The editor already runs in 'en' (an adapter re-applies its config on mount).
    a.bus.emit(I18nChanged, { locale: 'en', direction: 'ltr' });
    a.bus.emit(I18nChanged, { locale: 'en', direction: 'rtl' });
    await flush();

    expect(listener).not.toHaveBeenCalled();

    a.bus.emit(I18nChanged, { locale: 'ru', direction: 'ltr' });
    a.bus.emit(I18nChanged, { locale: 'ru', direction: 'ltr' });
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ setting: 'locale', value: 'ru' }));
    a.sync.destroy();
  });

  it('a received setting does not go back out', async () => {
    const platform = createFakePlatform();
    const a = makeTab(platform);
    const b = makeTab(platform);
    const c = makeTab(platform);

    // The real I18n emits I18nChanged after every applied update.
    b.fake.I18n.update.mockImplementation(async ({ locale }: { locale: string }) => {
      b.bus.emit(I18nChanged, { locale, direction: 'ltr' });
    });
    await a.sync.start(CONTEXT);
    await b.sync.start(CONTEXT);
    await c.sync.start(CONTEXT);
    await flush();

    a.bus.emit(I18nChanged, { locale: 'ru', direction: 'ltr' });
    await flush();

    expect(c.fake.I18n.update).toHaveBeenCalledTimes(1);
    a.sync.destroy();
    b.sync.destroy();
    c.sync.destroy();
  });
});
