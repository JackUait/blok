import { DATA_ATTR } from '../../constants/data-attributes';

/**
 * Space held open next to a block holder, shared by the Ask AI bar and the live
 * preview. The space is a margin on the holder, which is inert (child-holder
 * decoration law); nothing is ever put between holders.
 *
 * `end` is the space below the holder, `start` the space above it.
 */
export type GapSide = 'end' | 'start';

const VARIABLE: Record<GapSide, string> = { end: '--blok-ai-gap', start: '--blok-ai-gap-start' };

/** Per holder and side: key → px, in insertion order. */
const registry = new WeakMap<HTMLElement, Record<GapSide, Map<string, number>>>();

const keysOf = (holder: HTMLElement): Record<GapSide, Map<string, number>> => {
  const known = registry.get(holder);

  if (known) {
    return known;
  }
  const fresh = { end: new Map<string, number>(), start: new Map<string, number>() };

  registry.set(holder, fresh);

  return fresh;
};

/** Shared by every editor on the page; a listener filters by holder. */
const listeners = new Set<(holders: HTMLElement[]) => void>();

/** Holders changed inside holdGapChanges, told to listeners once it ends. */
const held: { depth: number; holders: Set<HTMLElement> } = { depth: 0, holders: new Set() };

/** Calls `listener` after gaps change size or order, with the holders that changed. Returns the unsubscribe. */
export const onGapChange = (listener: (holders: HTMLElement[]) => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const notify = (holders: HTMLElement[]): void => {
  listeners.forEach((listener) => listener(holders));
};

/** Runs `write`, then tells listeners once: a listener reads layout, and must not do it between writes. */
export const holdGapChanges = (write: () => void): void => {
  held.depth += 1;
  try {
    write();
  } finally {
    held.depth -= 1;
    if (held.depth === 0 && held.holders.size > 0) {
      const holders = [...held.holders];

      held.holders.clear();
      notify(holders);
    }
  }
};

const sum = (keys: Map<string, number>): number => [...keys.values()].reduce((total, px) => total + px, 0);

const paint = (holder: HTMLElement): void => {
  const keys = keysOf(holder);
  const sides = (['end', 'start'] as const).filter((side) => keys[side].size > 0);

  (['end', 'start'] as const).forEach((side) => {
    if (keys[side].size > 0) {
      holder.style.setProperty(VARIABLE[side], `${sum(keys[side])}px`);
    } else {
      holder.style.removeProperty(VARIABLE[side]);
    }
  });

  if (sides.length > 0) {
    holder.setAttribute(DATA_ATTR.aiGap, sides.join(' '));
  } else {
    holder.removeAttribute(DATA_ATTR.aiGap);
  }
  if (held.depth > 0) {
    held.holders.add(holder);
  } else {
    notify([holder]);
  }
};

/** Total px held on one side of a holder. */
export const gapSize = (holder: HTMLElement, side: GapSide = 'end'): number => sum(keysOf(holder)[side]);

/**
 * Hold `px` for `key` next to `holder`. Returns the key's offset inside the gap:
 * keys stack in the order they were first reserved, and a repeat call only resizes.
 * `first` puts a new key nearest the holder, above the keys already there.
 */
export const reserveGap = (holder: HTMLElement, key: string, px: number, side: GapSide = 'end', first = false): number => {
  const all = keysOf(holder);
  const known = all[side];
  const size = Math.max(0, px);
  const unchanged = known.get(key) === size;
  const keys = first && !known.has(key) ? new Map([[key, 0], ...known]) : known;

  all[side] = keys;
  keys.set(key, size);
  // No repaint for a repeat: a listener that re-reserves on change would loop.
  if (!unchanged) {
    paint(holder);
  }

  const before = [...keys.keys()].indexOf(key);

  return [...keys.values()].slice(0, before).reduce((total, size) => total + size, 0);
};

export const releaseGap = (holder: HTMLElement, key: string, side: GapSide = 'end'): void => {
  if (keysOf(holder)[side].delete(key)) {
    paint(holder);
  }
};
