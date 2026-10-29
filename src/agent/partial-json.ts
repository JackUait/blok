export type PartialCommand = { name?: string; args: Record<string, unknown>; ref?: string; done: boolean };

type Scan = {
  /** Closers for the open containers, innermost last. */
  closers: string[];
  /** Per open container, where each member starts: just after the opener, then at each comma. */
  cuts: number[][];
  inString: boolean;
  /** Where an unfinished escape at the end of an open string starts, or -1. */
  cutEscape: number;
};

const HEX = /^[0-9a-fA-F]$/;

const scan = (text: string): Scan => {
  const closers: string[] = [];
  const cuts: number[][] = [];
  const state = { inString: false, escaped: false, escapeAt: -1 };
  const stringChar = (char: string, i: number): void => {
    if (state.escaped) {
      state.escaped = false;
    } else if (char === '\\') {
      state.escaped = true;
      state.escapeAt = i;
    } else if (char === '"') {
      state.inString = false;
    }
  };

  // UTF-16 units, so indexes match slice().
  text.split('').forEach((char, i) => {
    if (state.inString) {
      stringChar(char, i);
    } else if (char === '"') {
      state.inString = true;
    } else if (char === '{' || char === '[') {
      closers.push(char === '{' ? '}' : ']');
      cuts.push([i + 1]);
    } else if (char === '}' || char === ']') {
      closers.pop();
      cuts.pop();
    } else if (char === ',' && cuts.length > 0) {
      cuts[cuts.length - 1].push(i);
    }
  });

  return { closers, cuts, inString: state.inString, cutEscape: state.inString ? unfinishedEscape(text, state.escapeAt) : -1 };
};

/** A `\` or `\uXX` cut off at the end of the text. */
const unfinishedEscape = (text: string, escapeAt: number): number => {
  if (escapeAt < 0) {
    return -1;
  }
  const rest = text.slice(escapeAt + 1);

  if (rest === '') {
    return escapeAt;
  }

  return rest[0] === 'u' && rest.length < 5 && [...rest.slice(1)].every((char) => HEX.test(char)) ? escapeAt : -1;
};

const tryParse = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

/** Best-effort value of an unfinished JSON text, or undefined when nothing usable has arrived. */
export const parsePartialJson = (text: string): unknown => {
  if (text.trim() === '') {
    return undefined;
  }
  const state = scan(text);
  const closing = [...state.closers].reverse().join('');
  const body = state.cutEscape >= 0 ? text.slice(0, state.cutEscape) : text;
  const parsed = tryParse(`${body}${state.inString ? '"' : ''}${closing}`);

  if (parsed.ok) {
    return parsed.value;
  }

  // Drop the innermost container's trailing members: a key with no value, a cut literal or a dangling
  // comma. Every cut is outside a string and inside the same containers, so this one scan serves every
  // retry. Dropping members from JSON that parses leaves JSON that parses, so the longest cut that
  // parses is found by binary search; trying every cut is quadratic on a long run of bad members.
  const cuts = (state.cuts.at(-1) ?? []).filter((cut) => cut < text.length);
  const search = { low: 0, high: cuts.length - 1, value: undefined as unknown };

  while (search.low <= search.high) {
    const middle = (search.low + search.high) >> 1;
    const retried = tryParse(`${text.slice(0, cuts[middle])}${closing}`);

    if (retried.ok) {
      search.value = retried.value;
      search.low = middle + 1;
    } else {
      search.high = middle - 1;
    }
  }

  return search.value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The commands of a `blok_execute` input that is still being written. */
export const readPartialCommands = (json: string): PartialCommand[] => {
  const input = parsePartialJson(json);
  const commands = isRecord(input) && Array.isArray(input.commands) ? input.commands : [];
  const finished = tryParse(json).ok;

  return commands.filter(isRecord).map((command, index, all) => ({
    ...(typeof command.name === 'string' ? { name: command.name } : {}),
    args: isRecord(command.args) ? command.args : {},
    ...(typeof command.ref === 'string' ? { ref: command.ref } : {}),
    done: finished || index < all.length - 1,
  }));
};
