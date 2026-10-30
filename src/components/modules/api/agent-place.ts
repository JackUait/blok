import type { BlokModules } from '../../../types-internal/blok-modules';

/** Where the user is: the text for the model and the blocks it names. */
export interface UserPlace {
  text: string;
  blockIds: string[];
}

export const NOWHERE: UserPlace = { text: '', blockIds: [] };

/**
 * Where the user is, for the first message. The document view never carries
 * the selection, so it travels as text. Sync, so it reads the selection before focus leaves.
 * @param blok - the editor's modules
 */
export const describeUserPlace = (blok: BlokModules): UserPlace => {
  const selectedBlocks = blok.BlockSelection.selectedBlocks;

  // A block selection leaves no native range, or a stray one.
  if (selectedBlocks.length > 0) {
    const ids = selectedBlocks.map((block) => block.id);

    return {
      text: `(Editor context: the user selected whole blocks ${ids.join(', ')}. "This" in the request means those blocks.)`,
      blockIds: ids,
    };
  }

  const quotes = new Map<string, string[]>();

  // An empty share is a triple-click's end at the start of the next block.
  blok.CrossBlockSelection.textSelection?.subRanges
    .map(({ block, range }) => ({ id: block.id, text: range.toString() }))
    .filter(({ text }) => text !== '')
    .forEach(({ id, text }) => quotes.set(id, [...quotes.get(id) ?? [], text]));

  if (quotes.size > 1) {
    const ids = [...quotes.keys()];
    const quoted = [...quotes].map(([id, parts]) => `In block ${id}: ${JSON.stringify(parts.join('\n'))}.`).join(' ');

    return {
      text: `(Editor context: the user selected text across blocks ${ids.join(', ')}. ${quoted} "This" in the request means that text.)`,
      blockIds: ids,
    };
  }

  const selection = document.getSelection();
  const anchor = selection?.anchorNode ?? null;

  if (selection === null || anchor === null || !blok.UI.nodes.wrapper.contains(anchor)) {
    return NOWHERE;
  }

  const block = blok.BlockManager.getBlockByChildNode(anchor);

  if (block === undefined) {
    return NOWHERE;
  }

  const selected = selection.isCollapsed ? '' : selection.toString();
  const text = selected === ''
    ? `(Editor context: the user's caret is in block ${block.id}.) Write new content right after this block unless the request names another place.`
    : `(Editor context: the user selected this text in block ${block.id}: ${JSON.stringify(selected)}. "This" in the request means that text.)`;

  return { text, blockIds: [block.id] };
};
