import { describe, it, expect } from 'vitest';
import { resolveMaxSize, pickDisplayMaxSize } from '../../../../src/components/utils/max-size';

const FALLBACK = 30 * 1024 * 1024;

describe('resolveMaxSize', () => {
  it('falls back to the default when config is undefined', () => {
    expect(resolveMaxSize(undefined, 'image/png', FALLBACK)).toBe(FALLBACK);
  });

  it('uses a plain number for every type', () => {
    expect(resolveMaxSize(5_000_000, 'image/png', FALLBACK)).toBe(5_000_000);
    expect(resolveMaxSize(5_000_000, 'image/gif', FALLBACK)).toBe(5_000_000);
  });

  it('looks up the exact MIME type in object form', () => {
    const config = { 'image/gif': 50_000_000, 'image/png': 5_000_000 };
    expect(resolveMaxSize(config, 'image/gif', FALLBACK)).toBe(50_000_000);
    expect(resolveMaxSize(config, 'image/png', FALLBACK)).toBe(5_000_000);
  });

  it('falls through to the "*" wildcard for unlisted types', () => {
    const config = { 'image/gif': 50_000_000, '*': 8_000_000 };
    expect(resolveMaxSize(config, 'image/webp', FALLBACK)).toBe(8_000_000);
  });

  it('falls back to the default when neither exact nor wildcard match', () => {
    const config = { 'image/gif': 50_000_000 };
    expect(resolveMaxSize(config, 'image/webp', FALLBACK)).toBe(FALLBACK);
  });

  it('treats Infinity as unlimited', () => {
    expect(resolveMaxSize(Number.POSITIVE_INFINITY, 'application/zip', FALLBACK)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('pickDisplayMaxSize', () => {
  it('returns undefined for undefined config', () => {
    expect(pickDisplayMaxSize(undefined)).toBeUndefined();
  });

  it('returns the number for plain-number config', () => {
    expect(pickDisplayMaxSize(7_000_000)).toBe(7_000_000);
  });

  it('prefers the "*" wildcard for object config', () => {
    expect(pickDisplayMaxSize({ 'image/gif': 50_000_000, '*': 8_000_000 })).toBe(8_000_000);
  });

  it('uses the largest cap when no wildcard is present', () => {
    expect(pickDisplayMaxSize({ 'image/gif': 50_000_000, 'image/png': 5_000_000 })).toBe(50_000_000);
  });

  it('returns undefined for an empty object', () => {
    expect(pickDisplayMaxSize({})).toBeUndefined();
  });
});
