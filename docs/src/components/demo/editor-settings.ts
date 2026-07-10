import type React from 'react';

/** The editor settings exposed in the /demo playground settings panel. */
export interface EditorSettings {
  readOnly: boolean;
  width: 'narrow' | 'full';
  placeholder: string;
  contentAlign: 'left' | 'center' | 'right';
  autofocus: boolean;
  hideToolbar: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  readOnly: false,
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
 * The editor's theme always mirrors the site theme (the panel's Theme control
 * switches the whole documentation, and the editor follows).
 */
export function buildEditorSettingsProps(
  settings: EditorSettings,
  siteTheme: 'light' | 'dark'
): { props: EditorSettingsProps; deps: React.DependencyList } {
  return {
    props: {
      readOnly: settings.readOnly,
      theme: siteTheme,
      width: settings.width,
      placeholder: settings.placeholder.trim() === '' ? undefined : settings.placeholder,
      autofocus: settings.autofocus,
      hideToolbar: settings.hideToolbar,
      style: { contentAlign: settings.contentAlign },
    },
    deps: [settings.contentAlign, settings.autofocus, settings.hideToolbar],
  };
}
