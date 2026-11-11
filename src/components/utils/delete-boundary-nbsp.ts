const NBSP = ' ';

const DELETE_TYPES = new Set([
  'deleteByCut',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
]);

/** Stands for a <br> in the flat text, so an nbsp next to one never counts as lone. */
const BREAK = '\n';

interface Pending {
  inputType: string;
  /** How many nbsp the editable holds once the deleted text is gone, if the browser adds none. */
  expected: number;
}

const pending = new WeakMap<HTMLElement, Pending>();

const countNbsp = (text: string): number => text.split(NBSP).length - 1;

const deletedText = (event: InputEvent): string => {
  const target = typeof event.getTargetRanges === 'function' ? event.getTargetRanges()[0] : undefined;

  if (target !== undefined) {
    const range = document.createRange();

    range.setStart(target.startContainer, target.startOffset);
    range.setEnd(target.endContainer, target.endOffset);

    return range.toString();
  }

  const selection = window.getSelection();

  return selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).toString() : '';
};

/**
 * Remember, before a native delete, how many nbsp the editable should hold
 * after it. Chrome turns a space at a new inline boundary into an nbsp; the
 * count is how {@link restoreDeletedBoundarySpace} tells that nbsp from one the
 * text already had.
 * @param event - the beforeinput event
 * @param editable - the editing host the delete runs in
 */
export const noteDeleteForNbsp = (event: InputEvent, editable: HTMLElement): void => {
  if (!DELETE_TYPES.has(event.inputType) || event.isComposing) {
    pending.delete(editable);

    return;
  }

  pending.set(editable, {
    inputType: event.inputType,
    expected: countNbsp(editable.textContent ?? '') - countNbsp(deletedText(event)),
  });
};

interface Piece {
  node: Node;
  start: number;
  value: string;
}

/** Text nodes and <br>s, in visible order. */
const atomsOf = (node: Node): Node[] => Array.from(node.childNodes).flatMap((child): Node[] =>
  child instanceof Text || child.nodeName === 'BR' ? [child] : atomsOf(child));

const piecesOf = (editable: HTMLElement): Piece[] => atomsOf(editable).reduce<Piece[]>((pieces, node) => {
  const last = pieces[pieces.length - 1];

  pieces.push({
    node,
    start: last === undefined ? 0 : last.start + last.value.length,
    value: node instanceof Text ? node.data : BREAK,
  });

  return pieces;
}, []);

const caretIndexIn = (pieces: Piece[], editable: HTMLElement, caret: Range): number => {
  const own = pieces.find(piece => piece.node === caret.startContainer);

  if (own !== undefined) {
    return own.start + caret.startOffset;
  }

  const before = document.createRange();

  before.setStart(editable, 0);
  before.setEnd(caret.startContainer, caret.startOffset);

  const passed = pieces.filter(piece => before.intersectsNode(piece.node));
  const last = passed[passed.length - 1];

  return last === undefined ? 0 : last.start + last.value.length;
};

const isLoneNbsp = (text: string, index: number): boolean =>
  text[index] === NBSP
  && index > 0
  && index < text.length - 1
  && !/\s/.test(text[index - 1])
  && !/\s/.test(text[index + 1]);

/**
 * After a native delete, turn back into a space the nbsp Chrome wrote next to
 * the caret. Only a lone nbsp between two visible characters is touched: there
 * a space draws the same. An nbsp the text had before the delete is kept.
 * @param event - the input event
 * @param editable - the editing host the delete ran in
 */
export const restoreDeletedBoundarySpace = (event: InputEvent, editable: HTMLElement): void => {
  const note = pending.get(editable);

  pending.delete(editable);

  if (note === undefined || note.inputType !== event.inputType) {
    return;
  }

  const extra = countNbsp(editable.textContent ?? '') - note.expected;
  const selection = window.getSelection();

  if (extra <= 0 || selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
    return;
  }

  const caret = selection.getRangeAt(0);
  const { startContainer, startOffset } = caret;

  if (!editable.contains(startContainer)) {
    return;
  }

  const pieces = piecesOf(editable);
  const text = pieces.map(piece => piece.value).join('');
  const caretIndex = caretIndexIn(pieces, editable, caret);
  const targets = [caretIndex, caretIndex - 1]
    .filter(index => isLoneNbsp(text, index))
    .map(index => ({ index, piece: pieces.find(piece => index >= piece.start && index < piece.start + piece.value.length) }))
    .filter(({ piece }) => piece !== undefined && piece.node instanceof Text && (piece.node.parentElement?.closest('code, pre') ?? null) === null)
    .slice(0, extra);

  if (targets.length === 0) {
    return;
  }

  targets.forEach(({ index, piece }) => {
    if (piece !== undefined && piece.node instanceof Text) {
      piece.node.replaceData(index - piece.start, 1, ' ');
    }
  });

  // replaceData pulls a caret right after the replaced char back before it.
  selection.setBaseAndExtent(startContainer, startOffset, startContainer, startOffset);
};
