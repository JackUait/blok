export interface SimpleDiff {
  index: number;
  remove: number;
  insert: string;
}

const HIGH_SURROGATE = /[\uD800-\uDBFF]/;
const LOW_SURROGATE = /[\uDC00-\uDFFF]/;

/**
 * The one region that differs between two strings: the common prefix and
 * suffix are kept, the middle is replaced. Counted in UTF-16 code units, and
 * each end is rolled back off a surrogate pair so the region never starts or
 * ends inside a character. Same output as lib0's `simpleDiffString`.
 * @param before - the old string
 * @param after - the new string
 */
export const simpleDiffString = (before: string, after: string): SimpleDiff => {
  /* eslint-disable no-restricted-syntax -- two cursors, one from each end; kept in lib0's shape so the parity test maps line to line */
  let left = 0;
  let right = 0;
  /* eslint-enable no-restricted-syntax */

  while (left < before.length && left < after.length && before[left] === after[left]) {
    left++;
  }

  if (left > 0 && HIGH_SURROGATE.test(before[left - 1])) {
    left--;
  }

  while (
    right + left < before.length &&
    right + left < after.length &&
    before[before.length - right - 1] === after[after.length - right - 1]
  ) {
    right++;
  }

  if (right > 0 && LOW_SURROGATE.test(before[before.length - right])) {
    right--;
  }

  return {
    index: left,
    remove: before.length - left - right,
    insert: after.slice(left, after.length - right),
  };
};
