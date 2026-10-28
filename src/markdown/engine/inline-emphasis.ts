import type { DelimItem, Item, SpanType } from './inline-items';

/**
 * Pairs `*`/`_` runs into emphasis and strong, and `~` runs into delete,
 * after the scan. The two kinds run as separate passes, as the old parser
 * ran them: the kind used first in the leaf goes first, and a span one pass
 * makes confines the other pass, so spans never cross. Inside a link,
 * strikethrough goes first.
 *
 * A pair only records itself on its two runs (`opens`, `closes`); the tree
 * is built from those marks afterwards.
 */

export type DelimKind = 'attention' | 'strike';

const kindOf = (delim: DelimItem): DelimKind => (delim.char === '~' ? 'strike' : 'attention');

/** The live runs of one pass, as a linked list over the pass's array. */
class RunList {
  public readonly prev: number[];
  public readonly next: number[];

  /** @param size - number of runs */
  constructor(size: number) {
    this.prev = Array.from({ length: size }, (_, index) => index - 1);
    this.next = Array.from({ length: size }, (_, index) => index + 1);
  }

  /**
   * Drop one run.
   * @param index - the run
   */
  public unlink(index: number): void {
    const before = this.prev[index];
    const after = this.next[index];

    if (before >= 0) {
      this.next[before] = after;
    }

    if (after < this.next.length) {
      this.prev[after] = before;
    }

    this.prev[index] = -2;
  }

  /**
   * Drop every run strictly between two live runs.
   * @param from - the earlier run
   * @param to - the later run
   */
  public unlinkBetween(from: number, to: number): void {
    const cursor = { at: this.next[from] };

    while (cursor.at !== to) {
      const after = this.next[cursor.at];

      this.unlink(cursor.at);
      cursor.at = after;
    }
  }
}

/**
 * Rule of 3: when either run could both open and close, a pair whose sizes
 * add up to a multiple of 3 is refused unless both are. Remaining sizes
 * count, not sizes as written, as before.
 * @param opener - candidate opener
 * @param closer - the closer
 */
const refusedByRuleOfThree = (opener: DelimItem, closer: DelimItem): boolean =>
  (opener.canClose || closer.canOpen) && closer.rest % 3 !== 0 && (opener.rest + closer.rest) % 3 === 0;

/**
 * `*` and `_` pairing, as CommonMark's "process emphasis". `floors` keeps
 * the search linear: below a floor, no opener fits a closer of that key.
 * @param runs - the pass's runs in order
 */
const attentionPass = (runs: DelimItem[]): void => {
  const list = new RunList(runs.length);
  const floors = new Map<string, number>();

  const findOpener = (closerIndex: number, floor: number): number => {
    const closer = runs[closerIndex];
    const cursor = { at: list.prev[closerIndex] };

    while (cursor.at > floor) {
      const opener = runs[cursor.at];

      if (opener.char === closer.char && opener.canOpen && opener.rest > 0 && !refusedByRuleOfThree(opener, closer)) {
        return cursor.at;
      }

      cursor.at = list.prev[cursor.at];
    }

    return -1;
  };

  const pair = (openerIndex: number, closerIndex: number): void => {
    const opener = runs[openerIndex];
    const closer = runs[closerIndex];
    const use = opener.rest > 1 && closer.rest > 1 ? 2 : 1;
    const type: SpanType = use === 2 ? 'strong' : 'emphasis';

    opener.rest -= use;
    closer.rest -= use;
    opener.opens.push(type);
    closer.closes.push(type);
    list.unlinkBetween(openerIndex, closerIndex);

    if (opener.rest === 0) {
      list.unlink(openerIndex);

      return;
    }

    // The opener's size changed, so it may now fit closers it did not before.
    for (const [key, floor] of floors) {
      floors.set(key, Math.min(floor, openerIndex - 1));
    }
  };

  const pairOnce = (closerIndex: number): boolean => {
    const closer = runs[closerIndex];
    const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.rest % 3}`;
    const opener = findOpener(closerIndex, floors.get(key) ?? -1);

    if (opener === -1) {
      floors.set(key, closerIndex - 1);

      return false;
    }

    pair(opener, closerIndex);

    return true;
  };

  const close = (closerIndex: number): void => {
    const closer = runs[closerIndex];

    while (closer.rest > 0) {
      if (!pairOnce(closerIndex)) {
        break;
      }
    }

    // A closer left over may still open a later span.
    if (closer.rest === 0 || !closer.canOpen) {
      list.unlink(closerIndex);
    }
  };

  runs.forEach((run, index) => {
    if (run.canClose && run.rest > 0 && list.prev[index] !== -2) {
      close(index);
    }
  });
};

/**
 * `~` pairing: a closer takes the nearest opener of the same size, whole.
 * @param runs - the pass's runs in order
 */
const strikePass = (runs: DelimItem[]): void => {
  const list = new RunList(runs.length);
  const floors = new Map<number, number>();

  const findOpener = (closerIndex: number): number => {
    const closer = runs[closerIndex];
    const floor = floors.get(closer.size) ?? -1;
    const cursor = { at: list.prev[closerIndex] };

    while (cursor.at > floor) {
      const opener = runs[cursor.at];

      if (opener.canOpen && opener.rest > 0 && opener.size === closer.size) {
        return cursor.at;
      }

      cursor.at = list.prev[cursor.at];
    }

    return -1;
  };

  runs.forEach((_, closerIndex) => {
    const closer = runs[closerIndex];

    if (!closer.canClose || closer.rest === 0 || list.prev[closerIndex] === -2) {
      return;
    }

    const openerIndex = findOpener(closerIndex);

    if (openerIndex === -1) {
      floors.set(closer.size, closerIndex - 1);

      if (!closer.canOpen) {
        list.unlink(closerIndex);
      }

      return;
    }

    const opener = runs[openerIndex];

    opener.rest = 0;
    closer.rest = 0;
    opener.opens.push('delete');
    closer.closes.push('delete');
    list.unlinkBetween(openerIndex, closerIndex);
    list.unlink(openerIndex);
    list.unlink(closerIndex);
  });
};

const PASSES: Record<DelimKind, (runs: DelimItem[]) => void> = { attention: attentionPass, strike: strikePass };

/**
 * Both passes over one container's runs. The second pass runs once per span
 * of the first, so it never pairs across one.
 * @param runs - the container's runs in order, both kinds
 * @param order - which kind goes first
 */
const resolveContainer = (runs: DelimItem[], order: DelimKind[]): void => {
  const [first, second] = order;

  PASSES[first](runs.filter((run) => kindOf(run) === first));

  if (second === undefined) {
    return;
  }

  const groups = new Map<number, DelimItem[]>([[0, []]]);
  const spans: number[] = [0];

  for (const run of runs) {
    if (kindOf(run) === first) {
      spans.length -= run.closes.length;
      run.opens.forEach(() => {
        spans.push(groups.size);
        groups.set(groups.size, []);
      });
      continue;
    }

    groups.get(spans[spans.length - 1])?.push(run);
  }

  for (const group of groups.values()) {
    PASSES[second](group);
  }
};

/**
 * Resolve every run in the scanned items. Each link or image is its own
 * container: its runs pair only among themselves.
 * @param items - scanned items, changed in place
 * @param topOrder - pass order at the top level
 * @param linkOrder - pass order inside a link or image
 */
export const resolveEmphasis = (items: Item[], topOrder: DelimKind[], linkOrder: DelimKind[]): void => {
  const top: DelimItem[] = [];
  const containers: DelimItem[][] = [top];
  const open: DelimItem[][] = [top];

  for (const item of items) {
    if (item.kind === 'bracket' && item.target !== undefined) {
      const inner: DelimItem[] = [];

      containers.push(inner);
      open.push(inner);
    } else if (item.kind === 'close') {
      open.pop();
    } else if (item.kind === 'delim') {
      open[open.length - 1].push(item);
    }
  }

  containers.forEach((runs, index) => resolveContainer(runs, index === 0 ? topOrder : linkOrder));
};
