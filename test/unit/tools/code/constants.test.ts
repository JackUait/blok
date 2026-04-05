// test/unit/tools/code/constants.test.ts

import { describe, it, expect } from 'vitest';
import {
  TOOL_NAME, PLACEHOLDER_KEY, LANGUAGE_KEY, COPIED_KEY, COPY_CODE_KEY,
  WRAP_LINES_KEY, DEFAULT_LANGUAGE, TAB_STRING, LANGUAGES, PREVIEWABLE_LANGUAGES,
  HIGHLIGHTABLE_LANGUAGES, SHIKI_LIGHT_THEME, SHIKI_DARK_THEME, DARK_MODE_SELECTOR,
} from '../../../../src/tools/code/constants';

describe('Code Block Constants', () => {
  it('TOOL_NAME is "code"', () => {
    expect(TOOL_NAME).toBe('code');
  });

  it('i18n keys follow tools.code.* pattern', () => {
    expect(PLACEHOLDER_KEY).toBe('tools.code.placeholder');
    expect(LANGUAGE_KEY).toBe('tools.code.language');
    expect(COPIED_KEY).toBe('tools.code.copied');
    expect(COPY_CODE_KEY).toBe('tools.code.copyCode');
    expect(WRAP_LINES_KEY).toBe('tools.code.wrapLines');
  });

  it('DEFAULT_LANGUAGE is "plain text"', () => {
    expect(DEFAULT_LANGUAGE).toBe('plain text');
  });

  it('TAB_STRING is 2 spaces', () => {
    expect(TAB_STRING).toBe('  ');
    expect(TAB_STRING).toHaveLength(2);
  });

  describe('LANGUAGES', () => {
    it('is a non-empty array', () => {
      expect(LANGUAGES.length).toBeGreaterThan(0);
    });

    it('first entry is plain text', () => {
      expect(LANGUAGES[0]).toEqual({ id: 'plain text', name: 'Plain Text' });
    });

    it('every entry has id and name strings', () => {
      for (const lang of LANGUAGES) {
        expect(typeof lang.id).toBe('string');
        expect(typeof lang.name).toBe('string');
        expect(lang.id.length).toBeGreaterThan(0);
        expect(lang.name.length).toBeGreaterThan(0);
      }
    });

    it('has no duplicate ids', () => {
      const ids = LANGUAGES.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes common languages', () => {
      const ids = LANGUAGES.map((l) => l.id);
      expect(ids).toContain('javascript');
      expect(ids).toContain('typescript');
      expect(ids).toContain('python');
      expect(ids).toContain('html');
      expect(ids).toContain('css');
      expect(ids).toContain('json');
    });

    it('includes latex in the language list', () => {
      const latex = LANGUAGES.find(l => l.id === 'latex');

      expect(latex).toBeDefined();
      expect(latex!.name).toBe('LaTeX');
    });

    it('includes mermaid in the language list', () => {
      const mermaid = LANGUAGES.find(l => l.id === 'mermaid');

      expect(mermaid).toBeDefined();
      expect(mermaid!.name).toBe('Mermaid');
    });
  });

  describe('PREVIEWABLE_LANGUAGES', () => {
    it('PREVIEWABLE_LANGUAGES contains latex', () => {
      expect(PREVIEWABLE_LANGUAGES.has('latex')).toBe(true);
    });

    it('PREVIEWABLE_LANGUAGES contains mermaid', () => {
      expect(PREVIEWABLE_LANGUAGES.has('mermaid')).toBe(true);
    });

    it('PREVIEWABLE_LANGUAGES does not contain non-previewable languages', () => {
      expect(PREVIEWABLE_LANGUAGES.has('javascript')).toBe(false);
      expect(PREVIEWABLE_LANGUAGES.has('plain text')).toBe(false);
    });
  });

  describe('HIGHLIGHTABLE_LANGUAGES', () => {
    it('contains common programming languages', () => {
      expect(HIGHLIGHTABLE_LANGUAGES.has('javascript')).toBe(true);
      expect(HIGHLIGHTABLE_LANGUAGES.has('typescript')).toBe(true);
      expect(HIGHLIGHTABLE_LANGUAGES.has('python')).toBe(true);
      expect(HIGHLIGHTABLE_LANGUAGES.has('html')).toBe(true);
      expect(HIGHLIGHTABLE_LANGUAGES.has('css')).toBe(true);
    });

    it('does not contain plain text', () => {
      expect(HIGHLIGHTABLE_LANGUAGES.has('plain text')).toBe(false);
    });

    it('contains previewable languages', () => {
      expect(HIGHLIGHTABLE_LANGUAGES.has('latex')).toBe(true);
      expect(HIGHLIGHTABLE_LANGUAGES.has('mermaid')).toBe(true);
    });
  });

  describe('Shiki theme constants', () => {
    it('SHIKI_LIGHT_THEME is defined', () => {
      expect(SHIKI_LIGHT_THEME).toBe('one-light');
    });

    it('SHIKI_DARK_THEME is defined', () => {
      expect(SHIKI_DARK_THEME).toBe('vitesse-dark');
    });

    it('DARK_MODE_SELECTOR targets .dark class', () => {
      expect(DARK_MODE_SELECTOR).toBe('.dark');
    });
  });
});
