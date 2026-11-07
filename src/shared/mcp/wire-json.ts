import { surfaceError, type McpSurfaceError } from './errors';

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

/**
 * The deepest nesting of objects and arrays Blok MCP takes, in a call's arguments, a document it
 * reads, and a document it saves. The ports' JS engines refuse JSON past 64 levels, and wrap a
 * document or arguments in up to about 4 more levels when they hand them over (agentExecute's
 * input, a history step, an answer echoing a block's data). Measured: a port failed one write
 * on a 62-level file. 48 keeps every host clear of that, with room for shapes not measured.
 */
export const MAX_JSON_DEPTH = 48;

/** Whether a parsed value nests deeper than `limit`. Stops at the first level past it, so the stack stays small. */
export const nestsDeeperThan = (value: unknown, limit: number): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (limit === 0) {
    return true;
  }

  return Object.values(value).some(item => nestsDeeperThan(item, limit - 1));
};

/** Whether JSON text nests deeper than `limit`. Brackets inside strings do not count. Valid JSON is not checked here. */
export const textNestsDeeperThan = (text: string, limit: number): boolean => {
  const scan = { depth: 0, inString: false, at: 0 };

  while (scan.at < text.length) {
    const char = text[scan.at];

    if (scan.inString) {
      // Skips the escaped char, so \" does not end the string.
      scan.at += char === '\\' ? 1 : 0;
      scan.inString = char !== '"';
    } else if (char === '"') {
      scan.inString = true;
    } else if (char === '{' || char === '[') {
      scan.depth += 1;
    } else if (char === '}' || char === ']') {
      scan.depth -= 1;
    }
    if (scan.depth > limit) {
      return true;
    }
    scan.at += 1;
  }

  return false;
};

/** The refusal for a batch whose document would nest past MAX_JSON_DEPTH; null when it fits. Checked before any save. */
export const tooDeepToSave = (document: unknown): McpSurfaceError | null => nestsDeeperThan(document, MAX_JSON_DEPTH)
  ? surfaceError('INVALID_ARGS', `This batch would nest the document deeper than ${MAX_JSON_DEPTH} levels of objects and arrays, so nothing was saved. Send flatter data.`)
  : null;
