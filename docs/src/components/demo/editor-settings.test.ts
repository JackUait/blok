import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_EDITOR_SETTINGS,
  buildEditorSettingsProps,
  loadEditorSettings,
  saveEditorSettings,
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

  it('always follows the site theme', () => {
    const { props } = buildEditorSettingsProps(DEFAULT_EDITOR_SETTINGS, 'dark');

    expect(props.theme).toBe('dark');
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

  describe('localStorage persistence', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('returns the defaults when nothing is stored', () => {
      expect(loadEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);
    });

    it('round-trips saved settings', () => {
      const settings: EditorSettings = {
        ...DEFAULT_EDITOR_SETTINGS,
        readOnly: true,
        width: 'full',
        placeholder: 'Write…',
      };

      saveEditorSettings(settings);

      expect(loadEditorSettings()).toEqual(settings);
    });

    it('falls back to the defaults on corrupt JSON', () => {
      localStorage.setItem('blok-docs-demo-editor-settings', '{not json');

      expect(loadEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);
    });

    it('sanitizes invalid values field by field', () => {
      localStorage.setItem(
        'blok-docs-demo-editor-settings',
        JSON.stringify({ readOnly: 'yes', width: 'huge', contentAlign: 'center', placeholder: 42 })
      );

      expect(loadEditorSettings()).toEqual({
        ...DEFAULT_EDITOR_SETTINGS,
        contentAlign: 'center',
      });
    });
  });

  describe('deps (settings that require recreating the editor)', () => {
    it('is stable across reactive-only changes (readOnly, width, placeholder)', () => {
      const base = buildEditorSettingsProps(DEFAULT_EDITOR_SETTINGS, 'light');
      const changed = buildEditorSettingsProps(
        {
          ...DEFAULT_EDITOR_SETTINGS,
          readOnly: true,
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
