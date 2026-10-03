import type { ThemeMode } from '../../../types/api/theme';
import type { EditorWidth } from '../../../types/api/width';

/**
 * Fired when the host changes the theme mode or the width at runtime through
 * `editor.theme.set` / `editor.width.set` / `editor.width.toggle`.
 *
 * Never fired for the boot config or for a value set before the modules
 * exist (replayed silently at ready): tab sync would push those onto every
 * other open tab.
 */
export const SettingChanged = 'setting:changed';

export type SettingChangedPayload =
  | { setting: 'theme'; value: ThemeMode }
  | { setting: 'width'; value: EditorWidth };
