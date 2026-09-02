import { Dom } from '../../dom';

/**
 * Where one client's caret sits, in the only coordinate system this document
 * format can express.
 *
 * Text is stored as plain strings in Y.Maps (no Y.Text), so there are no
 * relative positions to anchor against — a caret is a plain character offset,
 * and it goes stale if the block's text changes underneath it. That is
 * deliberate and bounded: presence is ephemeral awareness data, never part of
 * the document, and concurrent editing of the SAME block already resolves
 * last-write-wins on the whole string. A caret briefly landing a few characters
 * off is strictly less surprising than the text loss that case already has.
 *
 * `inputIndex` indexes the block's own `inputs`, because one block can own
 * several editable fields (a table's cells, a caption beside a figure) and an
 * offset means nothing without saying which one it counts into.
 */
export interface CaretPosition {
  blockId: string;
  inputIndex: number;
  /** Where the selection started. Equal to `head` when the caret is collapsed. */
  anchor: number;
  /** Where the caret actually is — the end a user is moving. */
  head: number;
}

/**
 * Can a peer draw a caret inside this input?
 *
 * A native `<input>`/`<textarea>` holds its text outside the node tree, so
 * there is no Range to measure and no way to turn an offset back into a
 * position without re-implementing the browser's text metrics. Publishing an
 * offset nobody can draw would just be noise on the wire, so these are skipped
 * — the gutter face still shows the peer is in the block.
 * @param input - one of a block's editable elements
 */
const isMeasurable = (input: HTMLElement): boolean =>
  !(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement);

/**
 * Character offset of a boundary, counted from the start of `input`.
 *
 * Counted with a Range rather than by walking, so it matches
 * `Dom.getNodeByOffset` — the two run in opposite directions over the same
 * text-node concatenation, and the round trip has to be exact.
 * @param input - the element offsets are counted into
 * @param node - the boundary's container
 * @param nodeOffset - the boundary's offset inside that container
 */
const offsetWithin = (input: HTMLElement, node: Node, nodeOffset: number): number => {
  const range = document.createRange();

  range.selectNodeContents(input);
  range.setEnd(node, nodeOffset);

  return range.toString().length;
};

/**
 * Read the live selection as offsets inside one of a block's inputs, or null
 * when the caret is not somewhere this can name.
 * @param blockId - the block being reported on
 * @param inputs - that block's editable elements, in its own order
 * @param selection - the live selection, or null when there is none
 */
export const readCaretPosition = (
  blockId: string,
  inputs: HTMLElement[],
  selection: Selection | null
): CaretPosition | null => {
  const focusNode = selection?.focusNode ?? null;

  if (selection === null || focusNode === null) {
    return null;
  }

  const inputIndex = inputs.findIndex((input) => isMeasurable(input) && input.contains(focusNode));
  const input = inputs[inputIndex];

  if (input === undefined) {
    return null;
  }

  const head = offsetWithin(input, focusNode, selection.focusOffset);
  const anchorNode = selection.anchorNode;

  // A selection that started in a different input has no anchor in THIS
  // input's coordinate system, so it collapses onto the caret rather than
  // naming a character it does not mean.
  const anchor =
    anchorNode !== null && input.contains(anchorNode)
      ? offsetWithin(input, anchorNode, selection.anchorOffset)
      : head;

  return {
    blockId,
    inputIndex,
    anchor,
    head,
  };
};

/** A character offset as it may arrive from another browser. */
const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Make a caret that arrived over the wire safe to draw, or reject it whole.
 *
 * Rejected whole rather than repaired: a half-trusted position still draws,
 * just in the wrong place, and a caret pointing at the wrong character is
 * worse than no caret at all. Only the four known fields survive, so nothing
 * a peer hangs off the object reaches the drawing pass.
 * @param value - one peer's `caret` awareness field, untrusted
 */
export const readCaret = (value: unknown): CaretPosition | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { blockId, inputIndex, anchor, head } = value as Record<string, unknown>;

  if (typeof blockId !== 'string' || blockId === '' || !isOffset(inputIndex)) {
    return null;
  }

  if (!isOffset(anchor) || !isOffset(head)) {
    return null;
  }

  return {
    blockId,
    inputIndex,
    anchor,
    head,
  };
};

/**
 * Turn a published offset back into a collapsed Range, so it can be measured.
 *
 * The offset arrived from another browser and the local text may have changed
 * since it was published, so it is clamped at both ends rather than trusted.
 * @param input - the editable element the offset counts into
 * @param offset - character offset from the start of that input
 */
export const resolveCaretRange = (input: HTMLElement, offset: number): Range | null => {
  const range = document.createRange();
  const { node, offset: nodeOffset } = Dom.getNodeByOffset(input, Math.max(0, Math.trunc(offset)));

  // An input with no text node at all — an empty paragraph. The position is the
  // input itself, which is exactly where its caret would sit.
  if (node === null) {
    range.selectNodeContents(input);
    range.collapse(true);

    return range;
  }

  range.setStart(node, nodeOffset);
  range.collapse(true);

  return range;
};

/** Where a line of text is, in viewport coordinates. */
export interface LineBox {
  left: number;
  top: number;
  height: number;
}

/**
 * Measure the line a published offset sits on.
 *
 * A collapsed Range measures zero in every engine when the element it sits in
 * has no text — an empty paragraph is the ordinary case, not an edge one — so
 * the input's own box is the fallback. Shared by the caret and the gutter
 * face, so the two agree about where an empty block's first line is.
 * @param input - the editable element the offset counts into
 * @param offset - the peer's published character offset
 */
export const measureLine = (input: HTMLElement, offset: number): LineBox | null => {
  const range = resolveCaretRange(input, offset);

  if (range === null) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  const box = rect.height > 0 ? rect : input.getBoundingClientRect();

  return {
    left: box.left,
    top: box.top,
    height: box.height,
  };
};
