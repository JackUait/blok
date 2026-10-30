import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { splitEnglish } from '../../../scripts/english-parts.mjs';
import {
  LOCALE_KINDS,
  buildKeyList,
  decodeKeyRuns,
  encodeKeyRuns,
  keyListModule,
} from '../../../scripts/locale-data-codec.mjs';

const ROOT = resolve(__dirname, '../../..');
const english = JSON.parse(readFileSync(resolve(ROOT, 'src/components/i18n/locales/en.json'), 'utf8')) as Record<string, string>;
const englishCoreKeys = Object.keys(splitEnglish(english).core);
const messages = LOCALE_KINDS.find((kind) => kind.name === 'messages');

if (messages === undefined) {
  throw new Error('no messages kind');
}

describe('message key list against the English core keys', () => {
  const keys = buildKeyList(messages);

  it('decodes back to the exact key list, order included', () => {
    expect(decodeKeyRuns(encodeKeyRuns(keys, englishCoreKeys), englishCoreKeys)).toEqual(keys);
  });

  it('stores no English core key as text', () => {
    const literals = encodeKeyRuns(keys, englishCoreKeys).filter((item) => typeof item === 'string');
    const core = new Set(englishCoreKeys);

    expect(literals.filter((key) => core.has(key))).toEqual([]);
    expect(literals.length).toBeLessThan(keys.length - 900);
  });

  it('keeps keys that are not English core keys, at their place', () => {
    const base = ['a', 'b', 'c', 'd'];

    expect(encodeKeyRuns(['x', 'b', 'c', 'y', 'a'], base)).toEqual(['x', 1, 2, 'y', 0, 1]);
    expect(decodeKeyRuns(['x', 1, 2, 'y', 0, 1], base)).toEqual(['x', 'b', 'c', 'y', 'a']);
  });

  it('builds the key list module from the English core module, without its keys', () => {
    const code = keyListModule(messages, keys);

    expect(code).toContain('english-core.ts');
    expect(code).not.toContain('blockSettings.dragToMove');
    expect(code).toContain('JSON.parse(');
  });
});
