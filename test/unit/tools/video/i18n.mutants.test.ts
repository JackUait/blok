import { describe, it, expect, vi } from 'vitest';

import { tr } from '../../../../src/tools/video/i18n';
import type { I18nInstance } from '../../../../src/components/utils/tools';

const i18n = (keys: Record<string, string>): I18nInstance => ({
  has: vi.fn((key: string) => key in keys),
  t: vi.fn((key: string, vars?: Record<string, string | number>) =>
    keys[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ''))),
});

describe('video i18n mutants', () => {
  it('prefers a registered message', () => {
    expect(tr(i18n({ 'k': 'Registered {n}' }), 'k', 'Fallback {n}', { n: 2 })).toBe('Registered 2');
  });

  it('interpolates the fallback when the key is not registered', () => {
    expect(tr(undefined, 'k', 'Fallback {n}', { n: 2 })).toBe('Fallback 2');
  });

  // With no variables at all the fallback is handed back untouched: running the
  // interpolation would read off nothing.
  it('returns the fallback verbatim when there are no variables', () => {
    expect(tr(undefined, 'k', 'Fallback {n}')).toBe('Fallback {n}');
  });

  it('leaves a placeholder no variable answers exactly as it was', () => {
    expect(tr(undefined, 'k', 'Hi {a} and {b}', { a: 'x' })).toBe('Hi x and {b}');
  });
});
