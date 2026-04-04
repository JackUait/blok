// test/unit/tools/code/constants.test.ts

import { describe, it, expect } from 'vitest';
import {
  TOOL_NAME,
  PLACEHOLDER_KEY,
  LANGUAGE_KEY,
  COPIED_KEY,
  COPY_CODE_KEY,
  WRAP_LINES_KEY,
  DEFAULT_LANGUAGE,
  TAB_STRING,
  LANGUAGES,
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
  });
});
