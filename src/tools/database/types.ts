import type { BlockToolData, OutputData } from '../../../types';

export interface KanbanCardData {
  id: string;
  columnId: string;
  position: string;
  title: string;
  description?: OutputData;
}

export interface KanbanColumnData {
  id: string;
  title: string;
  color?: string;
  position: string;
}

export interface KanbanData extends BlockToolData {
  columns: KanbanColumnData[];
  cardMap: Record<string, KanbanCardData>;
}

export interface KanbanAdapter {
  loadBoard(): Promise<{ columns: KanbanColumnData[]; cards: KanbanCardData[] }>;
  moveCard(params: { cardId: string; toColumnId: string; position: string; fromColumnId: string }): Promise<KanbanCardData>;
  createCard(params: { id: string; columnId: string; position: string; title: string }): Promise<KanbanCardData>;
  updateCard(params: { cardId: string; changes: Partial<Pick<KanbanCardData, 'title' | 'description'>> }): Promise<KanbanCardData>;
  deleteCard(params: { cardId: string }): Promise<void>;
  createColumn(params: { id: string; title: string; position: string }): Promise<KanbanColumnData>;
  updateColumn(params: { columnId: string; changes: Partial<Pick<KanbanColumnData, 'title' | 'color'>> }): Promise<KanbanColumnData>;
  moveColumn(params: { columnId: string; position: string }): Promise<KanbanColumnData>;
  deleteColumn(params: { columnId: string }): Promise<void>;
}

export interface DatabaseConfig {
  adapter?: KanbanAdapter;
}
