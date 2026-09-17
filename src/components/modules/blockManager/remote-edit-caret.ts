/**
 * Keeping the local caret alive across a remote peer's edit.
 *
 * A remote update is applied by handing the whole data blob to `block.setData`,
 * which rewrites the tool's content (paragraph assigns `innerHTML`, header,
 * list, toggle, code and table rebuild their own). Every text node the
 * selection anchored into is detached, so the browser collapses the caret onto
 * the surviving parent at offset 0 — the local user loses their place because
 * somebody else typed.
 */
import { readCaretPosition, resolveCaretRange } from '../collaboration/caret-position';

/** The part of a Block this needs — kept narrow so it is testable on its own. */
export interface CaretOwner {
  id: string;
  inputs: HTMLElement[];
  holder: HTMLElement;
}

/** Length of the text both strings start with. */
const commonPrefixLength = (before: string, after: string): number => {
  const limit = Math.min(before.length, after.length);
  const firstDifference = Array.from({ length: limit }, (_unused, index) => index)
    .findIndex((index) => before[index] !== after[index]);

  return firstDifference === -1 ? limit : firstDifference;
};

/**
 * Length of the text both strings end with, never reaching back past the
 * common prefix. Without the cap the two can claim the same characters —
 * "aaa" -> "a" would report prefix 1 AND suffix 1 — so the changed region
 * runs backwards and an offset sitting inside it is treated as if the edit
 * had happened entirely before it.
 */
const commonSuffixLength = (before: string, after: string, prefix: number): number => {
  const limit = Math.min(before.length, after.length) - prefix;
  const firstDifference = Array.from({ length: limit }, (_unused, index) => index)
    .findIndex((index) => before[before.length - 1 - index] !== after[after.length - 1 - index]);

  return firstDifference === -1 ? limit : firstDifference;
};

/**
 * Where an offset into `before` should sit in `after`.
 *
 * Best effort, and that is the honest ceiling here: text is stored as a plain
 * string (no Y.Text), so a remote update carries no CRDT positions to map
 * against — only the two strings. A common prefix/suffix diff names ONE changed
 * region, which is right for the one-peer-typing case and cannot represent an
 * edit that straddles the caret: the character the caret sat on no longer
 * exists, so it parks at the start of the changed region instead — unless the
 * replacement is the same length, where its own number is still a position
 * and moving it backwards would help nobody.
 *
 * Requires `offset <= before.length`; a larger one is returned unclamped,
 * because the only caller reads it off the same element with the same range
 * arithmetic and `resolveCaretRange` clamps on the way back.
 * @param before - the text the caret offset was read against
 * @param after - the text now in the input
 * @param offset - character offset into `before`
 */
export const adjustCaretOffset = (before: string, after: string, offset: number): number => {
  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, prefix);

  // The peer edited at or after the caret: the characters before it are
  // untouched, so the caret keeps its number.
  if (offset <= prefix) {
    return offset;
  }

  // The peer edited entirely before the caret: every character it counts past
  // is still there, shifted by the length the edit added or removed.
  if (offset >= before.length - suffix) {
    return offset + (after.length - before.length);
  }

  // The edit straddles the caret. An equal-length replacement leaves the
  // number valid, so keep it; otherwise the character is gone and the start
  // of the changed region is the least surprising place left.
  return after.length === before.length ? offset : prefix;
};

/**
 * Read the local caret out of `block`, returning a callback that puts it back
 * after the block's text has been rewritten. Null when the caret is not in
 * this block — there is then nothing to preserve and nothing to steal.
 * @param block - the block about to be rewritten
 * @param selection - the live selection
 */
export const captureCaretAcrossRewrite = (
  block: CaretOwner,
  selection: Selection | null
): (() => void) | null => {
  const position = readCaretPosition(block.id, block.inputs, selection);

  if (position === null) {
    return null;
  }

  // The ELEMENT, not its index: `findAllInputs` walks the whole holder, so a
  // container's inputs interleave its own fields with its children's, and a
  // tool that gains or loses a field renumbers everything after it. Restoring
  // by index would then type the caret into a different field.
  const input = block.inputs[position.inputIndex];

  if (input === undefined) {
    return null;
  }

  const before = input.textContent ?? '';

  return (): void => {
    const live = document.getSelection();

    if (live === null) {
      return;
    }

    // The rewrite collapses the selection onto the tool root, so it is still
    // inside the block. Anywhere else means the user moved on while the
    // update was being applied, and restoring would steal their caret back.
    if (live.focusNode !== null && !block.holder.contains(live.focusNode)) {
      return;
    }

    // The field can be gone (a tool that rebuilt its DOM rather than its
    // text): refuse rather than guess which of the survivors replaced it.
    if (!input.isConnected || !block.holder.contains(input)) {
      return;
    }

    const after = input.textContent ?? '';
    const anchorRange = resolveCaretRange(input, adjustCaretOffset(before, after, position.anchor));
    const headRange = resolveCaretRange(input, adjustCaretOffset(before, after, position.head));

    if (anchorRange === null || headRange === null) {
      return;
    }

    live.setBaseAndExtent(
      anchorRange.startContainer,
      anchorRange.startOffset,
      headRange.startContainer,
      headRange.startOffset
    );
  };
};
