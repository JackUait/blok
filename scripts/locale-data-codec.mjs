/**
 * Build-time codec for the lazy locale data: UI messages and emoji names.
 *
 * Every locale of a kind has nearly the same keys, so each one ships only its
 * values, in the order of one shared key list. The key list and the decoder
 * live in one virtual module that all locale chunks of that kind import, so
 * it downloads once. The decoder rebuilds the exact object JSON.parse would
 * give, key order included (`getLocaleSync(code).dictionary` is public).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGLISH_MODULES, splitEnglish } from './english-parts.mjs';

/**
 * Rebuild an object from `[values, moves]`. `values[i]` belongs to `keys[i]`,
 * `null` for a key the locale lacks. Present keys come out in key list order,
 * then each `moves` pair `[key, after]` takes a key out and puts it right
 * after `after` (-1 = first). The plugin emits this function's source, and the
 * build checks every locale with it, so both run the same code.
 * @param {string[]} keys
 * @param {[unknown[], number[]]} payload
 * @param {(value: unknown) => unknown} decodeValue
 * @returns {Record<string, unknown>}
 */
export const decodePositional = (keys, payload, decodeValue) => {
  const values = payload[0];
  const moves = payload[1];
  const order = [];

  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) {
      order.push(i);
    }
  }

  for (let j = 0; j < moves.length; j += 2) {
    const key = moves[j];
    const after = moves[j + 1];

    order.splice(order.indexOf(key), 1);
    order.splice(after < 0 ? 0 : order.indexOf(after) + 1, 0, key);
  }

  const result = {};

  for (const i of order) {
    result[keys[i]] = decodeValue(values[i]);
  }

  return result;
};

/**
 * An emoji entry `{ n, k? }` as `[n, at, ...k]`. Most keyword lists repeat the
 * name; it is dropped and `at` records where it goes back, so search ranking
 * sees the same list. `at` is -1 when the name is not a keyword, -2 when the
 * entry has no `k`.
 */
const encodeEmojiEntry = (entry) => {
  if (entry.k === undefined) {
    return [entry.n, -2];
  }

  const at = entry.k.indexOf(entry.n);

  return at < 0
    ? [entry.n, -1, ...entry.k]
    : [entry.n, at, ...entry.k.slice(0, at), ...entry.k.slice(at + 1)];
};

const decodeEmojiEntry = (entry) => {
  const name = entry[0];
  const at = entry[1];

  if (at === -2) {
    return { n: name };
  }

  const keywords = entry.slice(2);

  if (at >= 0) {
    keywords.splice(at, 0, name);
  }

  return { n: name, k: keywords };
};

const identity = (value) => value;

/**
 * A key list as items: a string is a key, two numbers `start, length` copy
 * that run of `base`. Lazy locales use it to point at the English core keys,
 * which every editor has already loaded, instead of storing them again.
 * @param {string[]} keys
 * @param {string[]} base
 * @returns {(string | number)[]}
 */
export const encodeKeyRuns = (keys, base) => {
  const index = new Map(base.map((key, i) => [key, i]));
  const items = [];

  for (let i = 0; i < keys.length;) {
    const start = index.get(keys[i]);

    if (start === undefined) {
      items.push(keys[i]);
      i++;
      continue;
    }

    let length = 1;

    while (i + length < keys.length && index.get(keys[i + length]) === start + length) {
      length++;
    }
    items.push(start, length);
    i += length;
  }

  return items;
};

/**
 * The inverse of encodeKeyRuns. The plugin emits this function's source.
 * @param {(string | number)[]} items
 * @param {string[]} base
 * @returns {string[]}
 */
export const decodeKeyRuns = (items, base) => {
  const keys = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (typeof item === 'string') {
      keys.push(item);
    } else {
      for (let k = item, end = item + items[++i]; k < end; k++) {
        keys.push(base[k]);
      }
    }
  }

  return keys;
};

const englishCoreKeys = () => Object.keys(
  splitEnglish(JSON.parse(readFileSync(srcPath('components/i18n/locales/en.json'), 'utf8'))).core,
);

const srcPath = (...parts) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src', ...parts);

/**
 * The locale data kinds. `exclude` stays a plain object: English messages are
 * eager, so a key list would not shrink them. `base` is a module every editor
 * loads anyway; the key list copies runs of its keys instead of storing them.
 */
export const LOCALE_KINDS = [
  {
    name: 'messages',
    keysId: 'virtual:blok-message-keys',
    dir: srcPath('components/i18n/locales'),
    exclude: 'en.json',
    base: { module: ENGLISH_MODULES.core, keys: englishCoreKeys },
    encodeValue: (value) => {
      if (typeof value !== 'string') {
        throw new Error('blok:locale-data: a message value is not a string');
      }

      return value;
    },
    decodeValue: identity,
  },
  {
    name: 'emoji',
    keysId: 'virtual:blok-emoji-keys',
    dir: srcPath('components/utils/emoji/locales'),
    exclude: null,
    base: null,
    encodeValue: encodeEmojiEntry,
    decodeValue: decodeEmojiEntry,
  },
];

/**
 * @param {string} file - a module id without its query
 * @returns {(typeof LOCALE_KINDS)[number] | null}
 */
export const localeKindOf = (file) => LOCALE_KINDS.find((kind) =>
  path.dirname(file) === kind.dir && file.endsWith('.json') && path.basename(file) !== kind.exclude,
) ?? null;

/**
 * The shared key list: the order of the locale with the most keys (most
 * locales share it, so few keys need a move), then every other key after its
 * predecessor. Files are read sorted, so every build emits the same bytes.
 * @param {(typeof LOCALE_KINDS)[number]} kind
 * @returns {string[]}
 */
export const buildKeyList = (kind) => {
  const locales = readdirSync(kind.dir)
    .filter((name) => name.endsWith('.json') && name !== kind.exclude)
    .sort()
    .map((name) => Object.keys(JSON.parse(readFileSync(path.join(kind.dir, name), 'utf8'))));
  const base = locales.reduce((best, keys) => (keys.length > best.length ? keys : best), []);
  const keys = [...base];
  const known = new Set(keys);

  for (const localeKeys of locales) {
    let previous = null;

    for (const key of localeKeys) {
      if (!known.has(key)) {
        keys.splice(previous === null ? 0 : keys.indexOf(previous) + 1, 0, key);
        known.add(key);
      }
      previous = key;
    }
  }

  return keys;
};

/** Indices of a longest increasing subsequence of `sequence`. */
const longestIncreasing = (sequence) => {
  const tails = [];
  const previous = new Array(sequence.length).fill(-1);

  sequence.forEach((value, i) => {
    let low = 0;
    let high = tails.length;

    while (low < high) {
      const mid = (low + high) >> 1;

      if (sequence[tails[mid]] < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    previous[i] = low > 0 ? tails[low - 1] : -1;
    tails[low] = i;
  });

  const kept = new Set();

  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i !== -1; i = previous[i]) {
    kept.add(i);
  }

  return kept;
};

/**
 * Encode one locale. Throws when the result would not decode to the source
 * byte for byte, so a data shape the codec does not cover fails the build.
 * @param {(typeof LOCALE_KINDS)[number]} kind
 * @param {string[]} keys - from buildKeyList
 * @param {Record<string, unknown>} data - the parsed locale JSON
 * @returns {[unknown[], number[]]}
 */
export const encodeLocale = (kind, keys, data) => {
  const index = new Map(keys.map((key, i) => [key, i]));
  const target = Object.keys(data).map((key) => {
    if (key === '__proto__' || !index.has(key)) {
      throw new Error(`blok:locale-data: cannot encode ${kind.name} key ${JSON.stringify(key)}`);
    }

    return index.get(key);
  });
  const values = new Array(target.length > 0 ? Math.max(...target) + 1 : 0).fill(null);

  for (const i of target) {
    values[i] = kind.encodeValue(data[keys[i]]);
  }

  const kept = longestIncreasing(target);
  const moves = [];

  target.forEach((key, position) => {
    if (!kept.has(position)) {
      moves.push(key, position === 0 ? -1 : target[position - 1]);
    }
  });

  const payload = [values, moves];

  if (JSON.stringify(decodePositional(keys, payload, kind.decodeValue)) !== JSON.stringify(data)) {
    throw new Error(`blok:locale-data: a ${kind.name} locale does not decode to its source`);
  }

  return payload;
};

/**
 * Source of a virtual key-list module.
 * @param {(typeof LOCALE_KINDS)[number]} kind
 * @param {string[]} keys
 * @returns {string}
 */
export const keyListModule = (kind, keys) => {
  const data = (value) => `/* @__PURE__ */ JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
  const decoder = [
    `const decodePositional = ${decodePositional.toString()};`,
    `const decodeValue = ${kind.decodeValue.toString()};`,
    'export default (payload) => decodePositional(keys, payload, decodeValue);',
  ];

  if (kind.base === null) {
    return [`const keys = ${data(keys)};`, ...decoder].join('\n');
  }

  const base = kind.base.keys();
  const items = encodeKeyRuns(keys, base);

  if (JSON.stringify(decodeKeyRuns(items, base)) !== JSON.stringify(keys)) {
    throw new Error(`blok:locale-data: the ${kind.name} key list does not decode to itself`);
  }

  // Object.keys of the built English core gives `base` in this order: the
  // build emits that module from the same splitEnglish result.
  return [
    `import base from ${JSON.stringify(kind.base.module)};`,
    `const decodeKeyRuns = ${decodeKeyRuns.toString()};`,
    `const keys = /* @__PURE__ */ decodeKeyRuns(${data(items)}, Object.keys(base));`,
    ...decoder,
  ].join('\n');
};
