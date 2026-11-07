/*
 * JSON that crosses the MCP boundary: a file, an endpoint answer, a call's arguments.
 * Every host runs these through the bundle, so Node and the ports read the same values.
 */

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

// By hand, not toWellFormed or a lookbehind regex: the ports' JS engines may lack them.
const wellFormedString = (text: string): string => {
  const out: { parts: string[]; from: number; at: number } = { parts: [], from: 0, at: 0 };

  while (out.at < text.length) {
    const unit = text.charCodeAt(out.at);

    if (isHigh(unit) && out.at + 1 < text.length && isLow(text.charCodeAt(out.at + 1))) {
      out.at += 2;
      continue;
    }
    if (isHigh(unit) || isLow(unit)) {
      out.parts.push(text.slice(out.from, out.at), '\uFFFD');
      out.from = out.at + 1;
    }
    out.at += 1;
  }
  if (out.parts.length === 0) {
    return text;
  }
  out.parts.push(text.slice(out.from));

  return out.parts.join('');
};

/**
 * The value with every lone UTF-16 surrogate, in strings and keys, as U+FFFD: what the ports'
 * JSON readers make of one. Recursive, so callers bound the depth first.
 */
const fixed = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return wellFormedString(value);
  }
  if (Array.isArray(value)) {
    return value.map(fixed);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [wellFormedString(key), fixed(item)]));
  }

  return value;
};

/** Same shape in, same shape out: only string contents change. */
export const wellFormed = <T>(value: T): T => fixed(value) as T;
