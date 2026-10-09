import type { OutputData } from '../../../types/data-formats/output-data';
import { isObject } from '../type-guards';

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

// No crypto: this hash also runs in Jint.
const cyrb53 = (text: string): string => {
  const hash = { h1: 0xdeadbeef, h2: 0x41c6ce57, index: 0 };

  for (; hash.index < text.length; hash.index++) {
    const ch = text.charCodeAt(hash.index);

    hash.h1 = Math.imul(hash.h1 ^ ch, 2654435761);
    hash.h2 = Math.imul(hash.h2 ^ ch, 1597334677);
  }
  hash.h1 = Math.imul(hash.h1 ^ (hash.h1 >>> 16), 2246822507) ^ Math.imul(hash.h2 ^ (hash.h2 >>> 13), 3266489909);
  hash.h2 = Math.imul(hash.h2 ^ (hash.h2 >>> 16), 2246822507) ^ Math.imul(hash.h1 ^ (hash.h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & hash.h2) + (hash.h1 >>> 0)).toString(16);
};

export const contentRevision = (doc: OutputData): string => `h${cyrb53(canonicalJson(doc))}`;
