/**
 * The flat neighbours a moved block had right after the index move that core
 * no longer makes. Core puts them on the moved() event under this key; the
 * list tool reads them instead of the live array, which already holds the
 * moved subtree. Not published: a symbol key never shows in the event's JSON.
 * `Symbol.for` because the list tool can be bundled apart from core.
 */
export const INDEX_MOVE_NEIGHBOURS: unique symbol = Symbol.for('blok.indexMoveNeighbours');

/** What the list's depth rules read from a neighbour. */
export interface IndexMoveNeighbour {
  id: string;
  name: string;
  holder?: { querySelector(selector: string): Element | null };
}

/** The blocks right before and after the moved block. */
export interface IndexMoveNeighbours {
  previous?: IndexMoveNeighbour;
  next?: IndexMoveNeighbour;
}

/**
 * Core sets this key on a moved() event from a reparent that keeps the block's
 * place in the flat order. A list item keeps its carried depth then: the drag
 * depth rules would read the flat neighbours, which mean nothing to a paste
 * into a table cell or a container.
 */
export const REPARENT_IN_PLACE: unique symbol = Symbol.for('blok.reparentInPlace');
