import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import type { KanbanData, KanbanColumnData, KanbanCardData } from './types';

function comparePositions(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;

  return 0;
}

/**
 * Pure data model for the kanban board.
 * Manages columns, cards, and their fractional-index ordering.
 * No DOM, no side effects.
 */
export class DatabaseModel {
  private columns: KanbanColumnData[];
  private cardMap: Record<string, KanbanCardData>;

  constructor(data?: Partial<KanbanData>) {
    if (data?.columns && data.columns.length > 0) {
      this.columns = data.columns.map(col => ({ ...col }));
    } else {
      this.columns = [
        { id: nanoid(), title: 'Not started', color: 'gray', position: 'a0' },
        { id: nanoid(), title: 'In progress', color: 'blue', position: 'a1' },
        { id: nanoid(), title: 'Done', color: 'green', position: 'a2' },
      ];
    }

    this.cardMap = {};

    if (data?.cardMap) {
      for (const [id, card] of Object.entries(data.cardMap)) {
        this.cardMap[id] = { ...card };
      }
    }
  }

  /**
   * Returns a deep copy of the current state. Mutations to the returned object do not affect the model.
   */
  snapshot(): KanbanData {
    const columns = this.columns.map(col => ({ ...col }));
    const cardMap: Record<string, KanbanCardData> = {};

    for (const [id, card] of Object.entries(this.cardMap)) {
      cardMap[id] = {
        ...card,
        description: card.description ? structuredClone(card.description) : undefined,
      };
    }

    return { columns, cardMap };
  }

  /**
   * Returns cards for a column sorted by position (lexicographic string comparison).
   */
  getOrderedCards(columnId: string): KanbanCardData[] {
    return Object.values(this.cardMap)
      .filter(card => card.columnId === columnId)
      .sort((a, b) => comparePositions(a.position, b.position));
  }

  /**
   * Returns all columns sorted by position (lexicographic string comparison).
   */
  getOrderedColumns(): KanbanColumnData[] {
    return [...this.columns].sort((a, b) => comparePositions(a.position, b.position));
  }

  /**
   * Adds a new card to a column, positioned after all existing cards.
   */
  addCard(columnId: string, title: string): KanbanCardData {
    const existing = this.getOrderedCards(columnId);
    const lastPos = existing.length > 0 ? existing[existing.length - 1].position : null;
    const position = generateKeyBetween(lastPos, null);
    const card: KanbanCardData = {
      id: nanoid(),
      columnId,
      position,
      title,
    };

    this.cardMap[card.id] = card;

    return card;
  }

  /**
   * Moves a card to a different column at the given position.
   */
  moveCard(cardId: string, toColumnId: string, position: string): void {
    const card = this.cardMap[cardId];

    if (!card) {
      return;
    }

    card.columnId = toColumnId;
    card.position = position;
  }

  /**
   * Updates a card's title and/or description.
   */
  updateCard(cardId: string, changes: Partial<Pick<KanbanCardData, 'title' | 'description'>>): void {
    const card = this.cardMap[cardId];

    if (!card) {
      return;
    }

    if (changes.title !== undefined) {
      card.title = changes.title;
    }
    if (changes.description !== undefined) {
      card.description = changes.description;
    }
  }

  /**
   * Deletes a card from the model.
   */
  deleteCard(cardId: string): void {
    Reflect.deleteProperty(this.cardMap, cardId);
  }

  /**
   * Adds a new column, positioned after all existing columns.
   */
  addColumn(title: string): KanbanColumnData {
    const ordered = this.getOrderedColumns();
    const lastPos = ordered.length > 0 ? ordered[ordered.length - 1].position : null;
    const position = generateKeyBetween(lastPos, null);
    const column: KanbanColumnData = {
      id: nanoid(),
      title,
      position,
    };

    this.columns.push(column);

    return column;
  }

  /**
   * Updates a column's title and/or color.
   */
  updateColumn(columnId: string, changes: Partial<Pick<KanbanColumnData, 'title' | 'color'>>): void {
    const column = this.columns.find(c => c.id === columnId);

    if (!column) {
      return;
    }

    if (changes.title !== undefined) {
      column.title = changes.title;
    }
    if (changes.color !== undefined) {
      column.color = changes.color;
    }
  }

  /**
   * Updates a column's position for reordering.
   */
  moveColumn(columnId: string, position: string): void {
    const column = this.columns.find(c => c.id === columnId);

    if (!column) {
      return;
    }

    column.position = position;
  }

  /**
   * Removes a column and all its cards. Returns the IDs of deleted cards.
   */
  deleteColumn(columnId: string): string[] {
    const deletedCardIds: string[] = [];

    for (const [id, card] of Object.entries(this.cardMap)) {
      if (card.columnId === columnId) {
        deletedCardIds.push(id);
        Reflect.deleteProperty(this.cardMap, id);
      }
    }

    this.columns = this.columns.filter(c => c.id !== columnId);

    return deletedCardIds;
  }

  /**
   * Replaces all model state from adapter data.
   */
  loadFromAdapter(columns: KanbanColumnData[], cards: KanbanCardData[]): void {
    this.columns = columns.map(col => ({ ...col }));
    this.cardMap = {};

    for (const card of cards) {
      this.cardMap[card.id] = { ...card };
    }
  }

  /**
   * Generates a fractional-index key between two bounds.
   */
  static positionBetween(before: string | null, after: string | null): string {
    return generateKeyBetween(before, after);
  }

  /**
   * Returns a card by ID, or undefined if not found.
   */
  getCard(cardId: string): KanbanCardData | undefined {
    return this.cardMap[cardId];
  }

  /**
   * Returns a column by ID, or undefined if not found.
   */
  getColumn(columnId: string): KanbanColumnData | undefined {
    return this.columns.find(c => c.id === columnId);
  }

  /**
   * Returns the number of columns.
   */
  getColumnCount(): number {
    return this.columns.length;
  }
}
