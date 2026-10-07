/**
 * First slot in `tails` whose position is >= `position`, or `tails.length`.
 * `>=` keeps the run strictly increasing.
 */
const firstTailAtLeast = (positions: readonly number[], tails: number[], position: number, low: number, high: number): number => {
  if (low >= high) {
    return low;
  }

  const middle = (low + high) >> 1;

  return positions[tails[middle]] >= position
    ? firstTailAtLeast(positions, tails, position, low, middle)
    : firstTailAtLeast(positions, tails, position, middle + 1, high);
};

/**
 * Indexes of the longest strictly increasing run of `positions`.
 * Tie-breaks must match the C# restore planner (CollabLongestKeptOrder):
 * both run test/fixtures/version-history/lis-cases.json.
 */
export const longestKeptOrder = (positions: readonly number[]): number[] => {
  const tails: number[] = [];
  const back: Array<number | undefined> = [];

  positions.forEach((position, index) => {
    const slot = firstTailAtLeast(positions, tails, position, 0, tails.length);

    back[index] = slot > 0 ? tails[slot - 1] : undefined;
    tails[slot] = index;
  });

  const kept: number[] = [];

  // The back-links from the last tail form a chain of exactly tails.length steps.
  tails.forEach(() => {
    const previous = kept.length > 0 ? kept[kept.length - 1] : undefined;
    const next = previous === undefined ? tails[tails.length - 1] : back[previous];

    if (next !== undefined) {
      kept.push(next);
    }
  });

  return kept.reverse();
};
