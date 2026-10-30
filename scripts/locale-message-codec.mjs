/**
 * Build-time codec for the lazy UI message locales.
 *
 * Every locale has nearly the same keys, so each one ships only its values,
 * in the order of one shared key list. The key list and the decoder live in
 * one virtual module that all locale chunks import, so it downloads once.
 * The decoder rebuilds the exact object JSON.parse would give, key order
 * included (`getLocaleSync(code).dictionary` is public).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const MESSAGE_KEYS_ID = 'virtual:blok-message-keys';

/** English stays a plain object: it is eager, so a key list would not shrink it. */
export const isLazyMessageLocale = (file) => {
  const normalized = file.split(path.sep).join('/');

  return /\/src\/components\/i18n\/locales\/[^/]+\.json$/.test(normalized) && !normalized.endsWith('/en.json');
};

/**
 * The shared key list: the order of the locale with the most keys (most
 * locales share it, so few keys need a move), then every other key after its
 * predecessor. Files are read sorted, so every build emits the same bytes.
 * @param {string} dir - the locales directory
 * @returns {string[]}
 */
export const buildKeyList = (dir) => {
  const locales = readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'en.json')
    .sort()
    .map((name) => Object.keys(JSON.parse(readFileSync(path.join(dir, name), 'utf8'))));
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

/**
 * Rebuild a dictionary from `[values, moves]`. `values[i]` belongs to
 * `keys[i]`, `null` for a key the locale lacks. Present keys come out in key
 * list order, then each `moves` pair `[key, after]` takes a key out and puts
 * it right after `after` (-1 = first). Kept as source so the plugin can emit
 * it and the build can check every locale with the same function.
 * @param {string[]} keys
 * @param {[Array<string | null>, number[]]} payload
 * @returns {Record<string, string>}
 */
export const decodeMessages = (keys, payload) => {
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

  const dictionary = {};

  for (const i of order) {
    dictionary[keys[i]] = values[i];
  }

  return dictionary;
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
 * @param {string[]} keys - from buildKeyList
 * @param {Record<string, unknown>} dictionary - the parsed locale JSON
 * @returns {[Array<string | null>, number[]]}
 */
export const encodeMessages = (keys, dictionary) => {
  const index = new Map(keys.map((key, i) => [key, i]));
  const target = Object.keys(dictionary).map((key) => {
    const value = dictionary[key];

    if (typeof value !== 'string' || key === '__proto__' || !index.has(key)) {
      throw new Error(`blok:messages: cannot encode key ${JSON.stringify(key)}`);
    }

    return index.get(key);
  });
  const length = target.length > 0 ? Math.max(...target) + 1 : 0;
  const values = new Array(length).fill(null);

  for (const i of target) {
    values[i] = dictionary[keys[i]];
  }

  const kept = longestIncreasing(target);
  const moves = [];

  target.forEach((key, position) => {
    if (!kept.has(position)) {
      moves.push(key, position === 0 ? -1 : target[position - 1]);
    }
  });

  const payload = [values, moves];

  if (JSON.stringify(decodeMessages(keys, payload)) !== JSON.stringify(dictionary)) {
    throw new Error('blok:messages: encoded locale does not decode to its source');
  }

  return payload;
};

/**
 * Source of the virtual key-list module.
 * @param {string[]} keys
 * @returns {string}
 */
export const keyListModule = (keys) => [
  `const keys = /* @__PURE__ */ JSON.parse(${JSON.stringify(JSON.stringify(keys))});`,
  `const decodeMessages = ${decodeMessages.toString()};`,
  'export default (payload) => decodeMessages(keys, payload);',
].join('\n');
