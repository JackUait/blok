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
  style: { contentAlign: EditorSettings['contentAlign'] };
}

/**
 * Maps panel settings to BlokEditor props. readOnly/theme/width/placeholder are
 * reactive on the React adapter and update the live editor. contentAlign and
 * autofocus are creation-time config here, but changing them never recreates
 * the editor (deps stays empty — recreation flashes the content): EditorWrapper
 * re-applies alignment on the live DOM, and autofocus naturally applies on the
 * next load. hideToolbar is creation-time config in the core (the toolbar gate
 * and the data-blok-toolbar-hidden gutter collapse are set at init), so passing
 * it here couldn't follow live panel toggles — EditorWrapper hides the toolbar
 * with a CSS host class instead. The editor's theme always mirrors the site
 * theme.
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
      style: { contentAlign: settings.contentAlign },
    },
    deps: [],
  };
}

const SETTINGS_STORAGE_KEY = 'blok-docs-demo-editor-settings';

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

/**
 * Loads persisted playground settings, sanitizing field by field so a stale or
 * tampered payload can never produce an invalid EditorSettings.
 */
export function loadEditorSettings(): EditorSettings {
  let parsed: unknown;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_EDITOR_SETTINGS;
    }
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_EDITOR_SETTINGS;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_EDITOR_SETTINGS;
  }
  const stored = parsed as Record<string, unknown>;

  return {
    readOnly: typeof stored.readOnly === 'boolean' ? stored.readOnly : DEFAULT_EDITOR_SETTINGS.readOnly,
    width: isOneOf(stored.width, ['narrow', 'full']) ? stored.width : DEFAULT_EDITOR_SETTINGS.width,
    placeholder: typeof stored.placeholder === 'string' ? stored.placeholder : DEFAULT_EDITOR_SETTINGS.placeholder,
    contentAlign: isOneOf(stored.contentAlign, ['left', 'center', 'right'])
      ? stored.contentAlign
      : DEFAULT_EDITOR_SETTINGS.contentAlign,
    autofocus: typeof stored.autofocus === 'boolean' ? stored.autofocus : DEFAULT_EDITOR_SETTINGS.autofocus,
    hideToolbar: typeof stored.hideToolbar === 'boolean' ? stored.hideToolbar : DEFAULT_EDITOR_SETTINGS.hideToolbar,
  };
}

/** Persists playground settings; storage failures (private mode, quota) are ignored. */
export function saveEditorSettings(settings: EditorSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is best-effort — the panel keeps working from React state.
  }
}
