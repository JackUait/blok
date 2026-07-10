import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EDITOR_SETTINGS,
  buildEditorSettingsProps,
  editorBackdropClassName,
  type EditorSettings,
} from './editor-settings';

describe('buildEditorSettingsProps', () => {
  it('maps the defaults to the current demo behavior', () => {
    const { props } = buildEditorSettingsProps(DEFAULT_EDITOR_SETTINGS, 'light');

    expect(props.readOnly).toBe(false);
    expect(props.theme).toBe('light');
    expect(props.width).toBe('narrow');
    expect(props.autofocus).toBe(false);
    expect(props.hideToolbar).toBe(false);
    expect(props.style).toEqual({ contentAlign: 'left' });
    expect(props.placeholder).toBeUndefined();
  });

  it('follows the site theme when theme is "site"', () => {
    const { props } = buildEditorSettingsProps(DEFAULT_EDITOR_SETTINGS, 'dark');

    expect(props.theme).toBe('dark');
  });

  it('overrides the site theme when a forced theme is chosen', () => {
    const settings: EditorSettings = { ...DEFAULT_EDITOR_SETTINGS, theme: 'light' };

    const { props } = buildEditorSettingsProps(settings, 'dark');

    expect(props.theme).toBe('light');
  });

  it('passes readOnly, width and contentAlign through', () => {
    const settings: EditorSettings = {
      ...DEFAULT_EDITOR_SETTINGS,
      readOnly: true,
      width: 'full',
      contentAlign: 'center',
    };

    const { props } = buildEditorSettingsProps(settings, 'light');

    expect(props.readOnly).toBe(true);
    expect(props.width).toBe('full');
    expect(props.style).toEqual({ contentAlign: 'center' });
  });

  it('passes a non-empty placeholder and omits a blank one', () => {
    const withText = buildEditorSettingsProps(
      { ...DEFAULT_EDITOR_SETTINGS, placeholder: 'Write here…' },
      'light'
    );
    const blank = buildEditorSettingsProps(
      { ...DEFAULT_EDITOR_SETTINGS, placeholder: '   ' },
      'light'
    );

    expect(withText.props.placeholder).toBe('Write here…');
    expect(blank.props.placeholder).toBeUndefined();
  });

  describe('editorBackdropClassName', () => {
    it('adds no backdrop when the editor follows the site theme', () => {
      expect(editorBackdropClassName(DEFAULT_EDITOR_SETTINGS, 'light')).toBe('');
      expect(editorBackdropClassName(DEFAULT_EDITOR_SETTINGS, 'dark')).toBe('');
    });

    it('adds no backdrop when the forced theme matches the site theme', () => {
      expect(editorBackdropClassName({ ...DEFAULT_EDITOR_SETTINGS, theme: 'light' }, 'light')).toBe('');
      expect(editorBackdropClassName({ ...DEFAULT_EDITOR_SETTINGS, theme: 'dark' }, 'dark')).toBe('');
    });

    it('adds a contrasting backdrop when the forced theme differs from the site theme', () => {
      const darkOnLight = editorBackdropClassName({ ...DEFAULT_EDITOR_SETTINGS, theme: 'dark' }, 'light');
      const lightOnDark = editorBackdropClassName({ ...DEFAULT_EDITOR_SETTINGS, theme: 'light' }, 'dark');

      expect(darkOnLight).toContain('demo-forced-theme');
      expect(darkOnLight).toMatch(/bg-/);
      expect(lightOnDark).toContain('demo-forced-theme');
      expect(lightOnDark).toMatch(/bg-/);
      expect(darkOnLight).not.toBe(lightOnDark);
    });
  });

  describe('deps (settings that require recreating the editor)', () => {
    it('is stable across reactive-only changes (readOnly, theme, width, placeholder)', () => {
      const base = buildEditorSettingsProps(DEFAULT_EDITOR_SETTINGS, 'light');
      const changed = buildEditorSettingsProps(
        {
          ...DEFAULT_EDITOR_SETTINGS,
          readOnly: true,
          theme: 'dark',
          width: 'full',
          placeholder: 'hi',
        },
        'dark'
      );

      expect(changed.deps).toEqual(base.deps);
    });

    it.each([
      ['contentAlign', { contentAlign: 'right' as const }],
      ['autofocus', { autofocus: true }],
      ['hideToolbar', { hideToolbar: true }],
    ])('changes when %s changes', (_name, override) => {
      const base = buildEditorSettingsProps(DEFAULT_EDITOR_SETTINGS, 'light');
      const changed = buildEditorSettingsProps(
        { ...DEFAULT_EDITOR_SETTINGS, ...override },
        'light'
      );

      expect(changed.deps).not.toEqual(base.deps);
    });
  });
});
