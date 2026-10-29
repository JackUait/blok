import { createHash } from 'node:crypto';

/** A stable, JSON-ready form of a library result: Maps sorted by key, bytes as sha256. */
export function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { sha256: createHash('sha256').update(value).digest('hex'), length: value.length };
  }
  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, item]: [unknown, unknown]) => [String(key), normalize(item)])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1));
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(Reflect.get(value, key))]));
  }

  return value;
}

export const OFFICE_CASES = {
  pptx: 'fixtures/office-deflated/pitch-deck.pptx',
  xlsx: 'fixtures/jszip/complex_files/AntarcticaTemps.xlsx',
  pptxImage: 'fixtures/office-deflated/pitch-deck-image.pptx',
} as const;
