/**
 * Fired when the host changes the theme mode or the width at runtime through
 * `editor.theme.set` / `editor.width.set` / `editor.width.toggle`.
 *
 * Never fired for the boot config or a value set before ready: tab sync
 * would push those onto every other open tab.
 */
export const SettingChanged = 'setting:changed';

export interface SettingChangedPayload {
  setting: 'theme' | 'width';
  value: string;
}
