// Renders a yjs document for the engine fixtures and the replay script.
//
// `doc.toJSON()` is unusable as an oracle: a root created by integration is an
// untyped placeholder that serialises to nothing, JSON.stringify throws on a
// bigint and erases NaN/-0/Infinity/undefined, and Y.Text.toJSON drops embeds
// and formats. This walker materialises the roots it is told about and emits
// sentinels the C# engine reproduces byte-for-byte after canonicalisation.
import * as Y from 'yjs';

const ROOT_KINDS = {
  map: Y.Map,
  array: Y.Array,
  text: Y.Text,
};

/**
 * @param {number} value
 * @returns {unknown}
 */
function renderNumber(value) {
  if (Number.isNaN(value)) {
    return { $num: 'NaN' };
  }

  if (Object.is(value, -0)) {
    return { $num: '-0' };
  }

  if (value === Number.POSITIVE_INFINITY) {
    return { $num: 'Infinity' };
  }

  if (value === Number.NEGATIVE_INFINITY) {
    return { $num: '-Infinity' };
  }

  return value;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function renderValue(value) {
  if (value === undefined) {
    return { $undefined: true };
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return renderNumber(value);
  }

  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }

  if (value instanceof Uint8Array) {
    return { $u8: Buffer.from(value).toString('base64') };
  }

  if (value instanceof Y.Text) {
    return { $text: value.toDelta() };
  }

  if (value instanceof Y.XmlFragment || value instanceof Y.XmlElement || value instanceof Y.XmlText) {
    return { $xml: value.toString() };
  }

  if (value instanceof Y.Map) {
    const result = {};

    value.forEach((child, key) => {
      result[key] = renderValue(child);
    });

    return result;
  }

  if (value instanceof Y.Array) {
    return value.toArray().map(renderValue);
  }

  if (Array.isArray(value)) {
    return value.map(renderValue);
  }

  if (typeof value === 'object') {
    const result = {};

    for (const [key, child] of Object.entries(value)) {
      result[key] = renderValue(child);
    }

    return result;
  }

  throw new TypeError(`cannot render a ${typeof value}`);
}

/**
 * @param {Y.Doc} doc
 * @param {Record<string, 'map' | 'array' | 'text'>} roots
 * @returns {Record<string, unknown>}
 */
export function renderDoc(doc, roots) {
  const result = {};

  for (const [name, kind] of Object.entries(roots)) {
    const type = ROOT_KINDS[kind];

    if (type === undefined) {
      throw new TypeError(`unknown root kind "${kind}" for "${name}"`);
    }

    result[name] = renderValue(doc.get(name, type));
  }

  return result;
}

/**
 * True when yjs is still holding structs or deletions it cannot apply yet.
 * @param {Y.Doc} doc
 * @returns {boolean}
 */
export function hasPending(doc) {
  return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
}
