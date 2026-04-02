import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig } from '../../../types';
import type { DatabaseData, DatabaseViewData, KanbanData, DatabaseConfig } from './types';
import { DatabaseModel } from './database-model';
import { DatabaseView } from './database-view';
import { DatabaseBackendSync } from './database-backend-sync';
import { DatabaseCardDrag } from './database-card-drag';
import type { CardDragResult } from './database-card-drag';
import { DatabaseColumnDrag } from './database-column-drag';
import type { ColumnDragResult } from './database-column-drag';
import { DatabaseColumnControls } from './database-column-controls';
import { DatabaseCardDrawer } from './database-card-drawer';
import { DatabaseKeyboard } from './database-keyboard';
import { DatabaseTabBar } from './database-tab-bar';
import { IconDatabase, IconBoard } from '../../components/icons';
import { nanoid } from 'nanoid';
import { generateKeyBetween } from 'fractional-indexing';

/**
 * DatabaseTool — a multi-view Kanban board block tool for Blok.
 *
 * Orchestrates multiple DatabaseModel instances (one per view), DatabaseView (DOM),
 * DatabaseBackendSync (adapter), and a DatabaseTabBar for view switching.
 */
export class DatabaseTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly readOnly: boolean;
  private readonly config: DatabaseConfig;

  private views: DatabaseViewData[];
  private activeViewId: string;
  private viewModels: Map<string, DatabaseModel> = new Map();
  private model!: DatabaseModel;
  private view!: DatabaseView;
  private sync!: DatabaseBackendSync;

  private element: HTMLDivElement | null = null;
  private boardContainer: HTMLDivElement | null = null;
  private tabBar: DatabaseTabBar | null = null;

  private cardDrag: DatabaseCardDrag | null = null;
  private columnDrag: DatabaseColumnDrag | null = null;
  private columnControls: DatabaseColumnControls | null = null;
  private cardDrawer: DatabaseCardDrawer | null = null;
  private keyboard: DatabaseKeyboard | null = null;

  constructor({ data, config, api, block, readOnly }: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>) {
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
    this.config = config ?? {};

    // Normalise incoming data — support both DatabaseData (new) and legacy KanbanData (old)
    const incoming = data as DatabaseData | KanbanData | undefined;

    if (incoming !== undefined && 'views' in incoming && Array.isArray((incoming as DatabaseData).views) && (incoming as DatabaseData).views.length > 0) {
      const dbData = incoming as DatabaseData;
      this.views = dbData.views;
      this.activeViewId = dbData.activeViewId;
    } else {
      // Legacy path: treat the whole data object as KanbanData for a default view
      const legacyData = (incoming ?? { columns: [], cardMap: {} }) as KanbanData;
      const defaultView = this.createDefaultView(legacyData);
      this.views = [defaultView];
      this.activeViewId = defaultView.id;
    }

    // Create a DatabaseModel for every view up front
    for (const v of this.views) {
      this.viewModels.set(v.id, new DatabaseModel(v.data));
    }

    this.activateView(this.activeViewId);
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
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-blok-tool', 'database');
    wrapper.setAttribute('data-blok-database-wrapper', '');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    this.element = wrapper;

    if (!this.readOnly) {
      this.tabBar = this.createTabBar();
      wrapper.appendChild(this.tabBar.render());
    }

    const boardContainer = document.createElement('div');
    boardContainer.setAttribute('data-blok-database-board-container', '');
    boardContainer.style.overflow = 'hidden';
    boardContainer.style.position = 'relative';
    this.boardContainer = boardContainer;
    wrapper.appendChild(boardContainer);

    const boardEl = this.renderActiveBoard();
    boardContainer.appendChild(boardEl);

    if (!this.readOnly) {
      this.attachBoardListeners(boardEl);
      this.initSubsystems(boardEl);
    }

    return wrapper;
  }

  rendered(): void {
    this.block.stretched = true;
  }

  save(_blockContent: HTMLElement): DatabaseData {
    return {
      views: this.views.map((v) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        position: v.position,
        data: this.viewModels.get(v.id)?.snapshot() ?? v.data,
      })),
      activeViewId: this.activeViewId,
    };
  }

  validate(savedData: DatabaseData): boolean {
    return (
      savedData.views !== undefined &&
      savedData.views.length > 0 &&
      savedData.views.every((v) => v.data.columns.length > 0)
    );
  }

  destroy(): void {
    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.cardDrawer?.destroy();
    this.keyboard?.destroy();
    this.tabBar?.destroy();
    this.sync.flushPendingUpdates();
    this.sync.destroy();
    this.element = null;
    this.boardContainer = null;
    this.tabBar = null;
  }

  // ---------------------------------------------------------------------------
  // View management
  // ---------------------------------------------------------------------------

  private activateView(viewId: string): void {
    const view = this.views.find((v) => v.id === viewId);

    if (view === undefined) {
      return;
    }

    this.activeViewId = viewId;
    const model = this.viewModels.get(viewId);
    if (model === undefined) {
      return;
    }
    this.model = model;
    this.view = new DatabaseView({ readOnly: this.readOnly, i18n: this.api.i18n });
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

  private switchView(viewId: string): void {
    if (viewId === this.activeViewId || this.boardContainer === null) {
      return;
    }

    const oldViewData = this.views.find((v) => v.id === this.activeViewId);
    const newViewData = this.views.find((v) => v.id === viewId);

    if (newViewData === undefined) {
      return;
    }

    // Destroy subsystems for old view (but NOT cardDrawer — it belongs to the outer wrapper)
    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.keyboard?.destroy();
    this.cardDrag = null;
    this.columnDrag = null;
    this.columnControls = null;
    this.keyboard = null;

    // Flush & destroy old sync
    this.sync.flushPendingUpdates();
    this.sync.destroy();

    // Activate new view state
    this.activateView(viewId);

    // Replace old board with new one
    this.boardContainer.innerHTML = '';
    const newBoardWrapper = this.renderActiveBoard();
    this.boardContainer.appendChild(newBoardWrapper);

    // Attach subsystems for new view
    if (!this.readOnly) {
      this.attachBoardListeners(newBoardWrapper);
      this.initSubsystems(newBoardWrapper);
    }

    // Rebuild tab bar to reflect active state
    this.rebuildTabBar();
  }

  addView(type: 'board'): void {
    const sorted = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const lastView = sorted[sorted.length - 1];
    const lastPosition = lastView !== undefined ? lastView.position : null;

    const position = generateKeyBetween(lastPosition, null);
    const id = nanoid();
    const newView: DatabaseViewData = {
      id,
      name: 'Board',
      type,
      position,
      data: { columns: [], cardMap: {} },
    };

    this.views.push(newView);
    this.viewModels.set(id, new DatabaseModel(newView.data));

    this.switchView(id);
  }

  renameView(viewId: string, name: string): void {
    const view = this.views.find((v) => v.id === viewId);

    if (view !== undefined) {
      view.name = name;
    }
  }

  duplicateView(viewId: string): void {
    const sourceView = this.views.find((v) => v.id === viewId);

    if (sourceView === undefined) {
      return;
    }

    const sourceIndex = this.views.indexOf(sourceView);
    const nextView = this.views[sourceIndex + 1];
    const afterPosition = sourceView.position;
    const beforePosition = nextView?.position ?? null;
    const position = generateKeyBetween(afterPosition, beforePosition);

    const snapshot = this.viewModels.get(viewId)?.snapshot() ?? sourceView.data;
    const newId = nanoid();
    const newView: DatabaseViewData = {
      id: newId,
      name: sourceView.name,
      type: sourceView.type,
      position,
      data: JSON.parse(JSON.stringify(snapshot)) as KanbanData,
    };

    this.views.splice(sourceIndex + 1, 0, newView);
    this.viewModels.set(newId, new DatabaseModel(newView.data));

    this.switchView(newId);
  }

  deleteView(viewId: string): void {
    if (this.views.length <= 1) {
      return;
    }

    const index = this.views.findIndex((v) => v.id === viewId);

    if (index === -1) {
      return;
    }

    const wasActive = viewId === this.activeViewId;

    this.views.splice(index, 1);
    this.viewModels.delete(viewId);

    if (wasActive) {
      const neighborIndex = Math.min(index, this.views.length - 1);
      this.switchView(this.views[neighborIndex].id);
    } else {
      this.rebuildTabBar();
    }
  }

  reorderView(viewId: string, newPosition: string): void {
    const view = this.views.find((v) => v.id === viewId);

    if (view !== undefined) {
      view.position = newPosition;
    }

    this.rebuildTabBar();
  }

  private rebuildTabBar(): void {
    if (this.element === null || this.tabBar === null) {
      return;
    }

    const oldBarEl = this.element.querySelector('[data-blok-database-tab-bar]');

    this.tabBar.destroy();
    this.tabBar = this.createTabBar();
    const newBarEl = this.tabBar.render();

    if (oldBarEl !== null) {
      oldBarEl.replaceWith(newBarEl);
    } else {
      // Tab bar should be first child (before boardContainer)
      this.element.insertBefore(newBarEl, this.boardContainer);
    }
  }

  private createTabBar(): DatabaseTabBar {
    return new DatabaseTabBar({
      views: [...this.views],
      activeViewId: this.activeViewId,
      onTabClick: (viewId) => this.switchView(viewId),
      onAddView: (type) => this.addView(type),
      onRename: (viewId, name) => this.renameView(viewId, name),
      onDuplicate: (viewId) => this.duplicateView(viewId),
      onDelete: (viewId) => this.deleteView(viewId),
      onReorder: (viewId, newPosition) => this.reorderView(viewId, newPosition),
    });
  }

  // ---------------------------------------------------------------------------
  // Board rendering helpers
  // ---------------------------------------------------------------------------

  private renderActiveBoard(): HTMLDivElement {
    const orderedColumns = this.model.getOrderedColumns();
    const getCards = (columnId: string): ReturnType<DatabaseModel['getOrderedCards']> =>
      this.model.getOrderedCards(columnId);

    return this.view.createBoard(orderedColumns, getCards);
  }

  // ---------------------------------------------------------------------------
  // Event listeners & subsystems
  // ---------------------------------------------------------------------------

  /**
   * Attaches a single click listener on the board element for event delegation.
   */
  private attachBoardListeners(boardEl: HTMLDivElement): void {
    boardEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const addCardBtn = target.closest('[data-blok-database-add-card]');

      if (addCardBtn !== null) {
        const columnId = addCardBtn.getAttribute('data-column-id');

        if (columnId !== null) {
          this.handleAddCard(columnId, boardEl);
        }

        return;
      }

      const addColumnBtn = target.closest('[data-blok-database-add-column]');

      if (addColumnBtn !== null) {
        this.handleAddColumn(boardEl);

        return;
      }

      const deleteCardBtn = target.closest('[data-blok-database-delete-card]');

      if (deleteCardBtn !== null) {
        const cardId = deleteCardBtn.getAttribute('data-card-id');

        if (cardId !== null) {
          event.stopPropagation();
          this.model.deleteCard(cardId);
          this.view.removeCard(boardEl, cardId);
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

  private handleAddCard(columnId: string, boardEl: HTMLDivElement): void {
    const card = this.model.addCard(columnId, this.api.i18n.t('tools.database.newPage'));
    const columnEl = boardEl.querySelector(`[data-column-id="${columnId}"][data-blok-database-column]`);

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

  private handleAddColumn(boardEl: HTMLDivElement): void {
    const column = this.model.addColumn(this.api.i18n.t('tools.database.columnTitlePlaceholder'));

    this.view.appendColumn(boardEl, column);

    void this.sync.syncCreateColumn({
      id: column.id,
      title: column.title,
      position: column.position,
    });
  }

  /**
   * Initializes all subsystems: card drag, column drag, column controls, card drawer, keyboard.
   * boardEl is the current board element for drag/column operations.
   * cardDrawer is attached to this.element (outer wrapper) so it persists across view switches.
   */
  private initSubsystems(boardEl: HTMLDivElement): void {
    if (this.element === null) {
      return;
    }

    this.cardDrag = new DatabaseCardDrag({
      wrapper: boardEl,
      onDrop: (result) => this.handleCardDrop(result),
    });

    this.columnDrag = new DatabaseColumnDrag({
      wrapper: boardEl,
      onDrop: (result) => this.handleColumnDrop(result),
    });

    this.columnControls = new DatabaseColumnControls({
      i18n: this.api.i18n,
      onRename: (columnId, title) => this.handleColumnRename(columnId, title),
      onDelete: (columnId) => this.handleColumnDelete(columnId, boardEl),
    });

    const headers = Array.from(boardEl.querySelectorAll<HTMLElement>('[data-blok-database-column-header]'));

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

    // cardDrawer is attached to outer wrapper so it stays across view switches
    if (this.cardDrawer === null) {
      this.cardDrawer = new DatabaseCardDrawer({
        wrapper: this.element,
        readOnly: this.readOnly,
        toolsConfig: this.api.tools.getToolsConfig(),
        onTitleChange: (cardId, title) => {
          this.model.updateCard(cardId, { title });
          const currentBoard = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]');

          if (currentBoard !== null && currentBoard !== undefined) {
            this.view.updateCardTitle(currentBoard, cardId, title);
          }

          this.sync.syncUpdateCard({ cardId, changes: { title } });
        },
        onDescriptionChange: (cardId, description: OutputData) => {
          this.model.updateCard(cardId, { description });
          this.sync.syncUpdateCard({ cardId, changes: { description } });
        },
        onClose: () => { /* no-op; drawer handles its own DOM cleanup */ },
      });
    }

    this.keyboard = new DatabaseKeyboard({
      wrapper: boardEl,
      onEscape: () => {
        if (this.cardDrawer?.isOpen) {
          this.cardDrawer.close();

          return true;
        }

        return false;
      },
    });
    this.keyboard.attach();

    boardEl.addEventListener('pointerdown', (e) => {
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
    this.moveColumnInDom(columnId, beforeColumnId);

    void this.sync.syncMoveColumn({ columnId, position });
  }

  /**
   * Moves a column element to a new position in the DOM without full re-render.
   */
  private moveColumnInDom(columnId: string, beforeColumnId: string | null): void {
    const boardEl = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]');

    if (boardEl === null || boardEl === undefined) {
      return;
    }

    const columnEl = boardEl.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`);

    if (columnEl === null) {
      return;
    }

    if (beforeColumnId !== null) {
      const beforeEl = boardEl.querySelector(`[data-column-id="${beforeColumnId}"]`);

      if (beforeEl !== null) {
        boardEl.insertBefore(columnEl, beforeEl);
      }
    } else {
      const addColumnBtn = boardEl.querySelector('[data-blok-database-add-column]');

      if (addColumnBtn !== null) {
        boardEl.insertBefore(columnEl, addColumnBtn);
      } else {
        boardEl.appendChild(columnEl);
      }
    }
  }

  private handleColumnRename(columnId: string, title: string): void {
    this.model.updateColumn(columnId, { title });
    void this.sync.syncUpdateColumn({ columnId, changes: { title } });
  }

  private handleColumnDelete(columnId: string, boardEl: HTMLDivElement): void {
    if (this.model.getColumnCount() <= 1) {
      return;
    }

    const deletedCardIds = this.model.deleteColumn(columnId);

    this.view.removeColumn(boardEl, columnId);

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

    const column = this.model.getColumn(card.columnId);

    this.cardDrawer?.open(card, column);
  }

  /**
   * Full re-render of the active board: tears down subsystems, rebuilds DOM, re-inits.
   *
   * Board DOM structure:
   *   boardContainer
   *     └── boardWrapper  (div returned by createBoard / renderActiveBoard)
   *           └── boardArea  ([data-blok-database-board] — scrollable area with columns)
   */
  private rerenderBoard(): void {
    if (this.boardContainer === null) {
      return;
    }

    // The old board wrapper is the first/only direct child of boardContainer
    const oldBoardWrapper = this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]')
      ?.closest<HTMLElement>('[data-blok-tool]') ?? this.boardContainer.firstElementChild as HTMLElement | null;

    const oldBoardArea = this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]');
    const savedScrollLeft = oldBoardArea?.scrollLeft ?? 0;

    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.cardDrawer?.destroy();
    this.cardDrawer = null;
    this.keyboard?.destroy();

    const newBoardWrapper = this.renderActiveBoard();

    if (oldBoardWrapper !== null && oldBoardWrapper !== undefined) {
      oldBoardWrapper.replaceWith(newBoardWrapper);
    } else {
      this.boardContainer.appendChild(newBoardWrapper);
    }

    // Restore horizontal scroll on the new board area
    const newBoardArea = newBoardWrapper.querySelector<HTMLElement>('[data-blok-database-board]');

    if (newBoardArea !== null) {
      newBoardArea.scrollLeft = savedScrollLeft;
    }

    this.attachBoardListeners(newBoardWrapper);
    this.initSubsystems(newBoardWrapper);
  }

  // ---------------------------------------------------------------------------
  // Default view factory
  // ---------------------------------------------------------------------------

  private createDefaultView(data?: KanbanData): DatabaseViewData {
    const defaultData: KanbanData = data ?? { columns: [], cardMap: {} };

    return {
      id: nanoid(),
      name: 'Board',
      type: 'board',
      position: 'a0',
      data: defaultData,
    };
  }
}
