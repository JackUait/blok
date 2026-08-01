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
