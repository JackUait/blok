import type { API, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig } from '../../../types';
import type { KanbanData, DatabaseConfig } from './types';
import { DatabaseModel } from './database-model';
import { DatabaseView } from './database-view';
import { DatabaseBackendSync } from './database-backend-sync';
import { DatabaseCardDrag } from './database-card-drag';
import type { CardDragResult } from './database-card-drag';
import { DatabaseColumnDrag } from './database-column-drag';
import type { ColumnDragResult } from './database-column-drag';
import { DatabaseColumnControls } from './database-column-controls';
import { DatabaseCardPeek } from './database-card-peek';
import { DatabaseKeyboard } from './database-keyboard';
import { IconDatabase, IconBoard } from '../../components/icons';

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
  private cardDrag: DatabaseCardDrag | null = null;
  private columnDrag: DatabaseColumnDrag | null = null;
  private columnControls: DatabaseColumnControls | null = null;
  private cardPeek: DatabaseCardPeek | null = null;
  private keyboard: DatabaseKeyboard | null = null;

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
        icon: IconDatabase,
        title: 'Database',
        titleKey: 'database',
        name: 'database',
        searchTerms: ['database', 'kanban', 'board', 'cards', 'columns'],
      },
      {
        icon: IconBoard,
        title: 'Board',
        titleKey: 'board',
        name: 'board',
        searchTerms: ['board', 'kanban', 'cards', 'columns', 'database'],
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
      this.initSubsystems();
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
    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.cardPeek?.destroy();
    this.keyboard?.destroy();
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

      const deleteCardBtn = target.closest('[data-blok-database-delete-card]');

      if (deleteCardBtn !== null) {
        const cardId = deleteCardBtn.getAttribute('data-card-id');

        if (cardId !== null && this.element !== null) {
          event.stopPropagation();
          this.model.deleteCard(cardId);
          this.view.removeCard(this.element, cardId);
          void this.sync.syncDeleteCard({ cardId });
        }

        return;
      }

      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl !== null) {
        const cardId = cardEl.getAttribute('data-card-id');

        if (cardId !== null) {
          this.handleCardClick(cardId);
        }
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

    const column = this.model.addColumn(this.api.i18n.t('tools.database.columnTitlePlaceholder'));

    this.view.appendColumn(this.element, column);

    void this.sync.syncCreateColumn({
      id: column.id,
      title: column.title,
      position: column.position,
    });
  }

  /**
   * Initializes all subsystems: card drag, column drag, column controls, card peek, keyboard.
   */
  private initSubsystems(): void {
    if (this.element === null) {
      return;
    }

    const wrapper = this.element;

    this.cardDrag = new DatabaseCardDrag({
      wrapper,
      onDrop: (result) => this.handleCardDrop(result),
    });

    this.columnDrag = new DatabaseColumnDrag({
      wrapper,
      onDrop: (result) => this.handleColumnDrop(result),
    });

    this.columnControls = new DatabaseColumnControls({
      i18n: this.api.i18n,
      onRename: (columnId, title) => this.handleColumnRename(columnId, title),
      onRecolor: (columnId, color) => this.handleColumnRecolor(columnId, color),
      onDelete: (columnId) => this.handleColumnDelete(columnId),
    });

    const headers = Array.from(wrapper.querySelectorAll<HTMLElement>('[data-blok-database-column-header]'));

    for (const header of headers) {
      const columnEl = header.closest<HTMLElement>('[data-blok-database-column]');

      if (columnEl === null) {
        continue;
      }

      const colId = columnEl.getAttribute('data-column-id');

      if (colId !== null) {
        this.columnControls.makeEditable(header, colId);
      }
    }

    this.cardPeek = new DatabaseCardPeek({
      wrapper,
      readOnly: this.readOnly,
      onTitleChange: (cardId, title) => {
        this.model.updateCard(cardId, { title });
        this.sync.syncUpdateCard({ cardId, changes: { title } });
      },
      onDescriptionChange: (cardId, description: OutputData) => {
        this.model.updateCard(cardId, { description });
        this.sync.syncUpdateCard({ cardId, changes: { description } });
      },
      onClose: () => { /* no-op; peek handles its own DOM cleanup */ },
    });

    this.keyboard = new DatabaseKeyboard({
      wrapper,
      onEscape: () => {
        if (this.cardPeek?.isOpen) {
          this.cardPeek.close();
        }
      },
    });
    this.keyboard.attach();

    wrapper.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;

      const columnHeader = target.closest('[data-blok-database-column-header]');

      if (columnHeader !== null) {
        const columnEl = columnHeader.closest<HTMLElement>('[data-blok-database-column]');
        const colId = columnEl?.getAttribute('data-column-id') ?? null;

        if (colId !== null) {
          e.preventDefault();
          e.stopPropagation();
          this.columnDrag?.beginTracking(colId, e.clientX, e.clientY);
        }

        return;
      }

      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl === null) {
        return;
      }

      const cardId = cardEl.getAttribute('data-card-id');

      if (cardId === null) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      this.cardDrag?.beginTracking(cardId, e.clientX, e.clientY);
    });
  }

  private handleCardDrop(result: CardDragResult): void {
    const { cardId, toColumnId, beforeCardId, afterCardId } = result;

    const beforeCard = beforeCardId !== null ? this.model.getCard(beforeCardId) : undefined;
    const afterCard = afterCardId !== null ? this.model.getCard(afterCardId) : undefined;

    const position = DatabaseModel.positionBetween(
      afterCard?.position ?? null,
      beforeCard?.position ?? null
    );

    const currentCard = this.model.getCard(cardId);
    const fromColumnId = currentCard?.columnId ?? toColumnId;

    this.model.moveCard(cardId, toColumnId, position);
    this.rerenderBoard();

    void this.sync.syncMoveCard({ cardId, toColumnId, position, fromColumnId });
  }

  private handleColumnDrop(result: ColumnDragResult): void {
    const { columnId, beforeColumnId, afterColumnId } = result;

    const beforeColumn = beforeColumnId !== null ? this.model.getColumn(beforeColumnId) : undefined;
    const afterColumn = afterColumnId !== null ? this.model.getColumn(afterColumnId) : undefined;

    const position = DatabaseModel.positionBetween(
      afterColumn?.position ?? null,
      beforeColumn?.position ?? null
    );

    this.model.moveColumn(columnId, position);
    this.rerenderBoard();

    void this.sync.syncMoveColumn({ columnId, position });
  }

  private handleColumnRename(columnId: string, title: string): void {
    this.model.updateColumn(columnId, { title });
    void this.sync.syncUpdateColumn({ columnId, changes: { title } });
  }

  private handleColumnRecolor(columnId: string, color: string): void {
    this.model.updateColumn(columnId, { color });
    void this.sync.syncUpdateColumn({ columnId, changes: { color } });
  }

  private handleColumnDelete(columnId: string): void {
    if (this.model.getColumnCount() <= 1) {
      return;
    }

    if (this.element === null) {
      return;
    }

    const deletedCardIds = this.model.deleteColumn(columnId);

    this.view.removeColumn(this.element, columnId);

    for (const cardId of deletedCardIds) {
      void this.sync.syncDeleteCard({ cardId });
    }

    void this.sync.syncDeleteColumn({ columnId });
  }

  private handleCardClick(cardId: string): void {
    const card = this.model.getCard(cardId);

    if (card === undefined) {
      return;
    }

    this.cardPeek?.open(card);
  }

  /**
   * Full re-render: tears down subsystems, rebuilds DOM, re-inits.
   */
  private rerenderBoard(): void {
    if (this.element === null) {
      return;
    }

    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.keyboard?.destroy();

    const orderedColumns = this.model.getOrderedColumns();
    const getCards = (columnId: string): ReturnType<DatabaseModel['getOrderedCards']> =>
      this.model.getOrderedCards(columnId);

    const newBoard = this.view.createBoard(orderedColumns, getCards);
    const parent = this.element.parentNode;

    if (parent !== null) {
      parent.replaceChild(newBoard, this.element);
    }

    this.element = newBoard;
    this.attachBoardListeners();
    this.initSubsystems();
  }
}
