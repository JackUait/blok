import type { API, BlockTool, BlockToolConstructorOptions, ToolboxConfig } from '../../../types';
import type { KanbanData, DatabaseConfig } from './types';
import { DatabaseModel } from './database-model';
import { DatabaseView } from './database-view';
import { DatabaseBackendSync } from './database-backend-sync';

/**
 * Placeholder icons until Task 12 adds the real ones.
 */
const IconDatabase = '';
const IconBoard = '';

/**
 * DatabaseTool — a Kanban board block tool for Blok.
 *
 * Orchestrates DatabaseModel (data), DatabaseView (DOM), and DatabaseBackendSync (adapter).
 * Uses event delegation on the wrapper element for all interactive elements.
 */
export class DatabaseTool implements BlockTool {
  private readonly api: API;
  private readonly readOnly: boolean;
  private readonly config: DatabaseConfig;
  private readonly model: DatabaseModel;
  private readonly view: DatabaseView;
  private readonly sync: DatabaseBackendSync;

  private element: HTMLDivElement | null = null;

  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions<KanbanData, DatabaseConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config ?? {};
    this.model = new DatabaseModel(data);
    this.view = new DatabaseView({ readOnly, i18n: api.i18n });
    this.sync = new DatabaseBackendSync(
      this.config.adapter,
      (error) => {
        this.api.notifier.show({
          message: String(error),
          style: 'error',
        });
      },
    );
  }

  static get toolbox(): ToolboxConfig {
    return [
      {
        name: 'database',
        titleKey: 'database',
        icon: IconDatabase,
        searchTerms: ['kanban', 'board', 'database', 'table'],
      },
      {
        name: 'board',
        titleKey: 'board',
        icon: IconBoard,
        searchTerms: ['kanban', 'board', 'columns'],
      },
    ];
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  render(): HTMLDivElement {
    const orderedColumns = this.model.getOrderedColumns();
    const getCards = (columnId: string): ReturnType<DatabaseModel['getOrderedCards']> =>
      this.model.getOrderedCards(columnId);

    this.element = this.view.createBoard(orderedColumns, getCards);

    if (!this.readOnly) {
      this.attachBoardListeners();
    }

    return this.element;
  }

  save(_blockContent: HTMLElement): KanbanData {
    return this.model.snapshot();
  }

  validate(savedData: KanbanData): boolean {
    return savedData.columns.length > 0;
  }

  destroy(): void {
    this.sync.flushPendingUpdates();
    this.sync.destroy();
    this.element = null;
  }

  /**
   * Attaches a single click listener on the wrapper for event delegation.
   */
  private attachBoardListeners(): void {
    if (this.element === null) {
      return;
    }

    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const addCardBtn = target.closest('[data-blok-database-add-card]');

      if (addCardBtn !== null) {
        const columnId = addCardBtn.getAttribute('data-column-id');

        if (columnId !== null) {
          this.handleAddCard(columnId);
        }

        return;
      }

      const addColumnBtn = target.closest('[data-blok-database-add-column]');

      if (addColumnBtn !== null) {
        this.handleAddColumn();

        return;
      }

      // Placeholder for Task 9: card click → peek panel
      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl !== null) {
        const _cardId = cardEl.getAttribute('data-card-id');

        // Will be wired in Task 9
      }
    });
  }

  private handleAddCard(columnId: string): void {
    if (this.element === null) {
      return;
    }

    const card = this.model.addCard(columnId, '');
    const columnEl = this.element.querySelector(`[data-column-id="${columnId}"][data-blok-database-column]`);

    if (columnEl === null) {
      return;
    }

    const cardsContainer = columnEl.querySelector('[data-blok-database-cards]');

    if (cardsContainer === null) {
      return;
    }

    this.view.appendCard(cardsContainer as HTMLElement, card);

    void this.sync.syncCreateCard({
      id: card.id,
      columnId: card.columnId,
      position: card.position,
      title: card.title,
    });
  }

  private handleAddColumn(): void {
    if (this.element === null) {
      return;
    }

    const column = this.model.addColumn(this.api.i18n.t('tools.database.newColumn'));

    this.view.appendColumn(this.element, column);

    void this.sync.syncCreateColumn({
      id: column.id,
      title: column.title,
      position: column.position,
    });
  }
}
