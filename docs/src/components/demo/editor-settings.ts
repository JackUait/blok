import type React from 'react';

/** Which theme the playground editor should use. */
export type PlaygroundTheme = 'site' | 'light' | 'dark';

/** The editor settings exposed in the /demo playground settings panel. */
export interface EditorSettings {
  readOnly: boolean;
  theme: PlaygroundTheme;
  width: 'narrow' | 'full';
  placeholder: string;
  contentAlign: 'left' | 'center' | 'right';
  autofocus: boolean;
  hideToolbar: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  readOnly: false,
  theme: 'site',
  width: 'narrow',
  placeholder: '',
  contentAlign: 'left',
  autofocus: false,
  hideToolbar: false,
};

interface EditorSettingsProps {
  readOnly: boolean;
  theme: 'light' | 'dark';
  width: 'narrow' | 'full';
  placeholder?: string;
  autofocus: boolean;
  hideToolbar: boolean;
  style: { contentAlign: EditorSettings['contentAlign'] };
}

/**
 * Maps panel settings to BlokEditor props. readOnly/theme/width/placeholder are
 * reactive on the React adapter and update the live editor; the rest is
 * creation-time config, so those values go into `deps` to recreate the editor.
 */
export function buildEditorSettingsProps(
  settings: EditorSettings,
  siteTheme: 'light' | 'dark'
): { props: EditorSettingsProps; deps: React.DependencyList } {
  return {
    props: {
      readOnly: settings.readOnly,
      theme: settings.theme === 'site' ? siteTheme : settings.theme,
      width: settings.width,
      placeholder: settings.placeholder.trim() === '' ? undefined : settings.placeholder,
      autofocus: settings.autofocus,
      hideToolbar: settings.hideToolbar,
      style: { contentAlign: settings.contentAlign },
    },
    deps: [settings.contentAlign, settings.autofocus, settings.hideToolbar],
  };
}

/**
 * The editor draws no background of its own, so a theme forced away from the
 * site theme would render e.g. dark-theme text on the light page. Returns
 * classes giving the editor a contrasting backdrop in that case, '' otherwise.
 */
export function editorBackdropClassName(
  settings: EditorSettings,
  siteTheme: 'light' | 'dark'
): string {
  const effectiveTheme = settings.theme === 'site' ? siteTheme : settings.theme;

  if (effectiveTheme === siteTheme) {
    return '';
  }

  return effectiveTheme === 'dark'
    ? 'demo-forced-theme rounded-2xl bg-[#191919] px-6 py-4 sm:px-10 sm:py-6'
    : 'demo-forced-theme rounded-2xl bg-white px-6 py-4 ring-1 ring-black/10 sm:px-10 sm:py-6';
}
