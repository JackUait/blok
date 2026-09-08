import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOB_SCHEME_PATTERN,
  DATA_SCHEME_PATTERN,
  SCRIPT_CAPABLE_SCHEME_PATTERN,
  hasUnsafeUrlProtocol,
} from '../../../src/shared/url-policy';

/**
 * Mutation-coverage tests for `src/shared/url-policy.ts`.
 *
 * No mutants are left alive in this file.
 *
 * All three dropped the start anchor from a scheme pattern, turning "starts
 * with this scheme" into "mentions it anywhere". A denylist without the anchor
 * condemns ordinary links whose path or query happens to contain the word, so
 * every case below pairs the real scheme with an http(s) URL carrying the same
 * text further along.
 */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('url-policy mutants - scheme patterns are anchored', () => {
  it('matches a script-capable scheme only at the start', () => {
    expect(SCRIPT_CAPABLE_SCHEME_PATTERN.test('javascript:alert(1)')).toBe(true);
    expect(SCRIPT_CAPABLE_SCHEME_PATTERN.test('VBScript:msgbox')).toBe(true);
    expect(SCRIPT_CAPABLE_SCHEME_PATTERN.test('https://host.test/javascript:alert(1)')).toBe(false);
    expect(SCRIPT_CAPABLE_SCHEME_PATTERN.test('x-vbscript:msgbox')).toBe(false);
  });

  it('matches the data scheme only at the start', () => {
    expect(DATA_SCHEME_PATTERN.test('data:text/html,x')).toBe(true);
    expect(DATA_SCHEME_PATTERN.test('https://host.test/metadata:1')).toBe(false);
  });

  it('matches the blob scheme only at the start', () => {
    expect(BLOB_SCHEME_PATTERN.test('blob:https://host.test/id')).toBe(true);
    expect(BLOB_SCHEME_PATTERN.test('https://host.test/blob:id')).toBe(false);
  });
});

describe('url-policy mutants - hasUnsafeUrlProtocol', () => {
  it('rejects script-capable schemes, however they are spelled', () => {
    expect(hasUnsafeUrlProtocol('javascript:alert(1)', 'href')).toBe(true);
    expect(hasUnsafeUrlProtocol('java\nscript:alert(1)', 'href')).toBe(true);
    expect(hasUnsafeUrlProtocol('vbscript:msgbox', 'src')).toBe(true);
  });

  it('accepts an http URL whose path merely spells a dangerous scheme', () => {
    expect(hasUnsafeUrlProtocol('https://host.test/javascript:alert(1)', 'href')).toBe(false);
    expect(hasUnsafeUrlProtocol('https://host.test/docs/vbscript:notes', 'href')).toBe(false);
  });

  it('accepts an http URL whose query mentions the data scheme', () => {
    expect(hasUnsafeUrlProtocol('https://host.test/?next=data:text/html,x', 'href')).toBe(false);
    expect(hasUnsafeUrlProtocol('https://host.test/metadata:9', 'src')).toBe(false);
  });

  it('accepts an http URL whose path mentions the blob scheme', () => {
    expect(hasUnsafeUrlProtocol('https://host.test/blob:abc', 'href')).toBe(false);
  });

  it('still rejects the real data and blob schemes', () => {
    expect(hasUnsafeUrlProtocol('data:text/html,<script>x</script>', 'src')).toBe(true);
    expect(hasUnsafeUrlProtocol('data:image/png;base64,AAAA', 'src')).toBe(false);
    expect(hasUnsafeUrlProtocol('data:image/png;base64,AAAA', 'href')).toBe(true);
    expect(hasUnsafeUrlProtocol('blob:https://host.test/id', 'href')).toBe(true);
    expect(hasUnsafeUrlProtocol('blob:https://host.test/id', 'src')).toBe(false);
  });

  it('accepts an empty or missing value', () => {
    expect(hasUnsafeUrlProtocol('', 'href')).toBe(false);
    expect(hasUnsafeUrlProtocol(null, 'src')).toBe(false);
  });
});
