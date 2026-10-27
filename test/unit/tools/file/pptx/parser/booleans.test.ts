// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import { parseOoxmlBool } from '../../../../../../src/tools/file/pptx/parser/booleans';

describe('parseOoxmlBool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses xsd:boolean and ST_OnOff true aliases case-insensitively', () => {
    expect(['1', 'true', 'TRUE', 't', 'on', ' On '].map((value) => parseOoxmlBool(value))).toEqual(
      [true, true, true, true, true, true],
    );
  });

  it('parses xsd:boolean and ST_OnOff false aliases case-insensitively', () => {
    expect(
      ['0', 'false', 'FALSE', 'f', 'off', ' Off '].map((value) => parseOoxmlBool(value, true)),
    ).toEqual([false, false, false, false, false, false]);
  });

  it('returns the caller default for missing or unrecognized values', () => {
    expect(parseOoxmlBool(undefined)).toBe(false);
    expect(parseOoxmlBool(undefined, true)).toBe(true);
    expect(parseOoxmlBool('maybe')).toBe(false);
    expect(parseOoxmlBool('maybe', true)).toBe(true);
  });
});
