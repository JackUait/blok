import type { ThemeMode } from '../../../../types/api/theme';
import type { EditorWidth } from '../../../../types/api/width';

import { TAB_SYNC_PROTOCOL } from './identity';
import type { TabPlatform } from './platform';

/** Site-wide: every editor on the origin listens, whatever its document. */
export const SETTINGS_CHANNEL = `blok-tab:${TAB_SYNC_PROTOCOL}:settings`;

export type SettingMessage =
  | { setting: 'locale'; value: string }
  | { setting: 'theme'; value: ThemeMode }
  | { setting: 'width'; value: EditorWidth; documentKey?: string };

interface SettingsChannelDeps {
  platform: TabPlatform;
  /** Width is per document; without a key width is neither sent nor applied. */
  documentKey?: string;
  /** Local changes to send. Returns an unsubscribe. */
  on: (listener: (setting: SettingMessage) => void) => () => void;
  /** Theme and width must not emit back through `on`; only a locale echo is caught. */
  apply: (setting: SettingMessage) => void;
}

const isThemeMode = (value: string): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'auto';

const isWidth = (value: string): value is EditorWidth => value === 'narrow' || value === 'full';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The setting inside a raw message, or null for anything malformed, from
 * another protocol version, or with a value this editor cannot take.
 * @param data - whatever arrived on the channel
 */
const decode = (data: unknown): { message: SettingMessage; documentKey: unknown } | null => {
  if (!isRecord(data) || data.protocol !== TAB_SYNC_PROTOCOL || data.kind !== 'setting' || typeof data.value !== 'string') {
    return null;
  }

  const { value, documentKey } = data;

  if (data.setting === 'locale' && value !== '') {
    return { message: { setting: 'locale', value }, documentKey };
  }
  if (data.setting === 'theme' && isThemeMode(value)) {
    return { message: { setting: 'theme', value }, documentKey };
  }
  if (data.setting === 'width' && isWidth(value)) {
    return { message: { setting: 'width', value }, documentKey };
  }

  return null;
};

/**
 * Carries locale, theme mode and width between the open tabs of the site.
 * @param deps - platform, local source and silent apply
 */
export const createSettingsChannel = (deps: SettingsChannelDeps): { close(): void } => {
  const raw = deps.platform.rawChannel(SETTINGS_CHANNEL);

  if (raw === null) {
    return { close: () => undefined };
  }

  /*
   * The locale last applied from another tab. A local emission of that same
   * locale is its echo: I18n emits after an async repaint, so a flag held only
   * while `apply` runs would miss it. Theme and width are applied through
   * silent setters, so they never echo; a memory for them would swallow a
   * later real change to the same value.
   */
  const applied: { locale: string | null } = { locale: null };
  const { documentKey } = deps;
  // A closed BroadcastChannel throws on post; a source may still emit after close.
  const state = { closed: false };

  const unsubscribe = deps.on((message) => {
    const echo = message.setting === 'locale' && applied.locale === message.value;

    if (message.setting === 'locale') {
      applied.locale = null;
    }
    if (state.closed || echo) {
      return;
    }
    if (message.setting !== 'width') {
      raw.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: message.setting, value: message.value });

      return;
    }
    if (documentKey !== undefined) {
      raw.post({ protocol: TAB_SYNC_PROTOCOL, kind: 'setting', setting: 'width', value: message.value, documentKey });
    }
  });

  const unlisten = raw.onMessage((data) => {
    const decoded = decode(data);

    if (decoded === null) {
      return;
    }
    if (decoded.message.setting === 'width' && (documentKey === undefined || decoded.documentKey !== documentKey)) {
      return;
    }
    if (decoded.message.setting === 'locale') {
      applied.locale = decoded.message.value;
    }
    deps.apply(decoded.message);
  });

  return {
    close: () => {
      state.closed = true;
      unsubscribe();
      unlisten();
      raw.close();
    },
  };
};
