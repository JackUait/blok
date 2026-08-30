import { describe, it, expect } from 'vitest';
import { getTranslation } from './index';
import en from './en.json';
import ru from './ru.json';

describe('getTranslation', () => {
  it('resolves a nested key to its leaf string', () => {
    expect(getTranslation('en', 'changelog.title')).toBe(en.changelog.title);
  });

  it('resolves the Russian leaf for a key present in both locales', () => {
    expect(getTranslation('ru', 'changelog.title')).toBe(ru.changelog.title);
  });

  it('returns the key itself when nothing resolves', () => {
    expect(getTranslation('en', 'definitely.not.a.key')).toBe('definitely.not.a.key');
  });

  it('returns the key when a Russian lookup misses in both locales', () => {
    expect(getTranslation('ru', 'definitely.not.a.key')).toBe('definitely.not.a.key');
  });

  // A missing segment used to keep the PARENT node and keep walking, so a later
  // segment resolved against a shallower ancestor. `api.blockApi` has no
  // `properties` node, so every per-property lookup collapsed onto the section's
  // own `description` and every row in the Block API table rendered the section
  // blurb instead of its own text.
  it('does not resolve a missing segment against an ancestor node', () => {
    const key = 'api.blockApi.properties.id.description';

    expect(getTranslation('en', key)).toBe(key);
  });

  it('does not leak the section blurb on a Russian per-property lookup', () => {
    const key = 'api.blockApi.properties.id.description';

    expect(getTranslation('ru', key)).toBe(key);
  });

  // The same reducer short-circuited once it hit a string, so any key that
  // continued past a leaf returned that leaf.
  it('does not resolve a key that continues past a leaf string', () => {
    const key = 'changelog.title.nested';

    expect(getTranslation('en', key)).toBe(key);
  });
});

/**
 * A key present only in en.json resolves through getTranslation's English
 * fallback, so a Russian page renders the English string with no error anywhere.
 * That silent fallback is what shipped English body copy to /ru/**.
 */
const leafKeys = (node: unknown, prefix = ''): string[] => {
  if (typeof node === 'string') {
    return [prefix];
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
};

describe('catalogue parity', () => {
  it('translates every English key into Russian', () => {
    const missing = leafKeys(en).filter((key) => !leafKeys(ru).includes(key));

    expect(missing, `keys in en.json with no ru.json twin:\n${missing.join('\n')}`).toEqual([]);
  });

  // The overlay namespaces this repo added for the data modules. A copy-pasted
  // English value there is invisible at runtime — it renders as if translated.
  const OVERLAY_PREFIXES = ['server.paths.', 'server.limits.', 'presets.items.', 'tools.docs.'];

  it('holds real Russian in the data-overlay namespaces, not copied English', () => {
    const copied = leafKeys(ru)
      .filter((key) => OVERLAY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      // Two Latin words with a lower-case one among them is prose; a lone
      // product name ("Supabase", "IndexedDB") legitimately stays as it is.
      .filter((key) => {
        const value = getTranslation('ru', key);
        if (/[\u0400-\u04FF]/.test(value)) return false;
        const words = (value.match(/[A-Za-z][A-Za-z'\u2019]*/g) ?? []).filter((w) => w.length >= 2);
        return words.length >= 2 && words.some((w) => w === w.toLowerCase());
      });

    expect(copied, `overlay keys still holding English prose:\n${copied.join('\n')}`).toEqual([]);
  });
});
