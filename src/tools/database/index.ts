import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig } from '../../../types';
import type { DatabaseData, DatabaseConfig, DatabaseRow, ViewType, SelectOption } from './types';
import { DatabaseModel } from './database-model';
import { DatabaseView } from './database-view';
import { DatabaseBackendSync } from './database-backend-sync';
import { DatabaseCardDrag } from './database-card-drag';
import type { CardDragResult } from './database-card-drag';
import { DatabaseColumnDrag } from './database-column-drag';
import type { GroupDragResult } from './database-column-drag';
import { DatabaseColumnControls } from './database-column-controls';
import { DatabaseCardDrawer } from './database-card-drawer';
import { DatabaseKeyboard } from './database-keyboard';
import { DatabaseTabBar } from './database-tab-bar';
import { IconDatabase, IconBoard } from '../../components/icons';
import { nanoid } from 'nanoid';

/**
 * DatabaseTool — a multi-view Kanban board block tool for Blok.
 *
 * Orchestrates a single DatabaseModel (schema + rows + view configs), DatabaseView (DOM),
 * DatabaseBackendSync (adapter), and a DatabaseTabBar for view switching.
 */
export class DatabaseTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly readOnly: boolean;
  private readonly config: DatabaseConfig;

  private activeViewId: string;
  private model: DatabaseModel;
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

    this.model = new DatabaseModel(data as DatabaseData | undefined);
    const views = this.model.getViews();
    this.activeViewId = (data as DatabaseData | undefined)?.activeViewId ?? (views.length > 0 ? views[0].id : '');

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
      ...this.model.snapshot(),
      activeViewId: this.activeViewId,
    };
  }

  validate(savedData: DatabaseData): boolean {
    const hasTitleProp = savedData.schema?.some((p) => p.type === 'title') ?? false;
    const hasViews = savedData.views !== undefined && savedData.views.length > 0;
    const boardViewsValid = savedData.views?.filter((v) => v.type === 'board')
      .every((v) => v.groupBy !== undefined) ?? true;
    return hasTitleProp && hasViews && boardViewsValid;
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
    const viewConfig = this.model.getView(viewId);

    if (viewConfig === undefined) {
      return;
    }

    this.activeViewId = viewId;
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

    // Destroy per-view subsystems (not cardDrawer)
    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.keyboard?.destroy();
    this.cardDrag = null;
    this.columnDrag = null;
    this.columnControls = null;
    this.keyboard = null;

    this.sync.flushPendingUpdates();
    this.sync.destroy();

    this.activateView(viewId);

    this.boardContainer.innerHTML = '';
    const newBoardWrapper = this.renderActiveBoard();
    this.boardContainer.appendChild(newBoardWrapper);

    if (!this.readOnly) {
      this.attachBoardListeners(newBoardWrapper);
      this.initSubsystems(newBoardWrapper);
    }

    this.rebuildTabBar();
  }

  addView(type: ViewType): void {
    const statusProp = this.model.getSchema().find((p) => p.type === 'select');
    const newView = this.model.addView('Board', type, {
      groupBy: type === 'board' ? statusProp?.id : undefined,
    });
    void this.sync.syncCreateView({ id: newView.id, name: newView.name, type: newView.type, position: newView.position, groupBy: newView.groupBy });
    this.switchView(newView.id);
  }

  renameView(viewId: string, name: string): void {
    this.model.updateView(viewId, { name });
    void this.sync.syncUpdateView({ viewId, changes: { name } });
  }

  duplicateView(viewId: string): void {
    const sourceView = this.model.getView(viewId);

    if (sourceView === undefined) {
      return;
    }

    const newView = this.model.addView(sourceView.name, sourceView.type, {
      groupBy: sourceView.groupBy,
      sorts: [...sourceView.sorts],
      filters: [...sourceView.filters],
      visibleProperties: [...sourceView.visibleProperties],
    });
    void this.sync.syncCreateView({ id: newView.id, name: newView.name, type: newView.type, position: newView.position, groupBy: newView.groupBy });
    this.switchView(newView.id);
  }

  deleteView(viewId: string): void {
    const views = this.model.getViews();

    if (views.length <= 1) {
      return;
    }

    const index = views.findIndex((v) => v.id === viewId);

    if (index === -1) {
      return;
    }

    const wasActive = viewId === this.activeViewId;

    this.model.deleteView(viewId);
    void this.sync.syncDeleteView({ viewId });

    if (wasActive) {
      const remaining = this.model.getViews();
      const neighborIndex = Math.min(index, remaining.length - 1);
      this.switchView(remaining[neighborIndex].id);
    } else {
      this.rebuildTabBar();
    }
  }

  reorderView(viewId: string, newPosition: string): void {
    this.model.updateView(viewId, { position: newPosition });
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
      views: this.model.getViews(),
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
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';

    if (groupByPropId === undefined) {
      return this.view.createBoard([], () => [], titlePropId);
    }

    const options = this.model.getSelectOptions(groupByPropId);
    const groups = this.model.getRowsGroupedBy(groupByPropId);
    return this.view.createBoard(options, (optionId) => groups.get(optionId) ?? [], titlePropId);
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
        const optionId = addCardBtn.getAttribute('data-option-id');

        if (optionId !== null) {
          this.handleAddRow(optionId, boardEl);
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
        const rowId = deleteCardBtn.getAttribute('data-row-id');

        if (rowId !== null) {
          event.stopPropagation();
          this.model.deleteRow(rowId);
          this.view.removeCard(boardEl, rowId);
          void this.sync.syncDeleteRow({ rowId });
        }

        return;
      }

      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl !== null) {
        const rowId = cardEl.getAttribute('data-row-id');

        if (rowId !== null) {
          this.handleRowClick(rowId);
        }
      }
    });
  }

  private handleAddRow(optionId: string, boardEl: HTMLDivElement): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const row = this.model.addRow({
      [titlePropId]: '',
      [groupByPropId]: optionId,
    });

    const columnEl = boardEl.querySelector(`[data-option-id="${optionId}"][data-blok-database-column]`);

    if (columnEl === null) {
      return;
    }

    const cardsContainer = columnEl.querySelector('[data-blok-database-cards]');

    if (cardsContainer === null) {
      return;
    }

    this.view.appendCard(cardsContainer as HTMLElement, row, titlePropId);

    void this.sync.syncCreateRow({
      id: row.id,
      properties: row.properties,
      position: row.position,
    });
  }

  private handleAddColumn(boardEl: HTMLDivElement): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    const existingOptions = prop.config.options;
    const lastPos = existingOptions.length > 0 ? existingOptions[existingOptions.length - 1].position : null;
    const newOption: SelectOption = {
      id: nanoid(),
      label: this.api.i18n.t('tools.database.columnTitlePlaceholder'),
      position: DatabaseModel.positionBetween(lastPos, null),
    };

    this.model.updateProperty(groupByPropId, {
      config: { options: [...existingOptions, newOption] },
    });

    this.view.appendColumn(boardEl, newOption);
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: [...existingOptions, newOption] } } });
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
      onDrop: (result) => this.handleRowDrop(result),
    });

    this.columnDrag = new DatabaseColumnDrag({
      wrapper: boardEl,
      onDrop: (result) => this.handleGroupDrop(result),
    });

    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const descriptionProp = this.model.getSchema().find((p) => p.type === 'richText');
    const descriptionPropId = descriptionProp?.id;

    this.columnControls = new DatabaseColumnControls({
      i18n: this.api.i18n,
      onRename: (optionId, label) => this.handleOptionRename(optionId, label),
      onDelete: (optionId) => this.handleOptionDelete(optionId, boardEl),
    });

    const headers = Array.from(boardEl.querySelectorAll<HTMLElement>('[data-blok-database-column-header]'));

    for (const header of headers) {
      const columnEl = header.closest<HTMLElement>('[data-blok-database-column]');

      if (columnEl === null) {
        continue;
      }

      const optId = columnEl.getAttribute('data-option-id');

      if (optId !== null) {
        this.columnControls.makeEditable(header, optId);
      }
    }

    // cardDrawer is attached to outer wrapper so it stays across view switches
    if (this.cardDrawer === null) {
      this.cardDrawer = new DatabaseCardDrawer({
        wrapper: this.element,
        readOnly: this.readOnly,
        i18n: this.api.i18n,
        toolsConfig: this.api.tools.getToolsConfig(),
        titlePropertyId: titlePropId,
        descriptionPropertyId: descriptionPropId,
        onTitleChange: (rowId, title) => {
          this.model.updateRow(rowId, { [titlePropId]: title });
          const currentBoard = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]');

          if (currentBoard !== null && currentBoard !== undefined) {
            this.view.updateCardTitle(currentBoard, rowId, title);
          }

          this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: title } });
        },
        onDescriptionChange: (rowId, description: OutputData) => {
          if (descriptionPropId !== undefined) {
            this.model.updateRow(rowId, { [descriptionPropId]: description });
            this.sync.syncUpdateRow({ rowId, properties: { [descriptionPropId]: description } });
          }
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
        const optId = columnEl?.getAttribute('data-option-id') ?? null;

        if (optId !== null) {
          e.preventDefault();
          e.stopPropagation();
          this.columnDrag?.beginTracking(optId, e.clientX, e.clientY);
        }

        return;
      }

      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl === null) {
        return;
      }

      const rowId = cardEl.getAttribute('data-row-id');

      if (rowId === null) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      this.cardDrag?.beginTracking(rowId, e.clientX, e.clientY);
    });
  }

  private handleRowDrop(result: CardDragResult): void {
    const { rowId, toOptionId, beforeRowId, afterRowId } = result;
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
    const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
    const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);

    this.model.updateRow(rowId, { [groupByPropId]: toOptionId });
    this.model.moveRow(rowId, position);
    this.rerenderBoard();

    this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: toOptionId } });
    void this.sync.syncMoveRow({ rowId, position });
  }

  private handleGroupDrop(result: GroupDragResult): void {
    const { optionId, beforeOptionId, afterOptionId } = result;
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    const options = [...prop.config.options];
    const draggedIdx = options.findIndex((o) => o.id === optionId);

    if (draggedIdx === -1) {
      return;
    }

    const beforeOpt = beforeOptionId !== null ? options.find((o) => o.id === beforeOptionId) : undefined;
    const afterOpt = afterOptionId !== null ? options.find((o) => o.id === afterOptionId) : undefined;
    const newPosition = DatabaseModel.positionBetween(afterOpt?.position ?? null, beforeOpt?.position ?? null);

    options[draggedIdx] = { ...options[draggedIdx], position: newPosition };
    this.model.updateProperty(groupByPropId, { config: { options } });

    this.moveColumnInDom(optionId, beforeOptionId);
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options } } });
  }

  /**
   * Moves a column element to a new position in the DOM without full re-render.
   */
  private moveColumnInDom(optionId: string, beforeOptionId: string | null): void {
    const boardEl = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]');

    if (boardEl === null || boardEl === undefined) {
      return;
    }

    const columnEl = boardEl.querySelector<HTMLElement>(`[data-option-id="${optionId}"]`);

    if (columnEl === null) {
      return;
    }

    if (beforeOptionId !== null) {
      const beforeEl = boardEl.querySelector(`[data-option-id="${beforeOptionId}"]`);

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

  private handleOptionRename(optionId: string, label: string): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    const options = prop.config.options.map((o) => o.id === optionId ? { ...o, label } : o);
    this.model.updateProperty(groupByPropId, { config: { options } });
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options } } });
  }

  private handleOptionDelete(optionId: string, boardEl: HTMLDivElement): void {
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    if (groupByPropId === undefined) {
      return;
    }

    const prop = this.model.getProperty(groupByPropId);

    if (prop?.config === undefined) {
      return;
    }

    if (prop.config.options.length <= 1) {
      return;
    }

    // Delete rows in this group
    const groups = this.model.getRowsGroupedBy(groupByPropId);
    const rowsInGroup = groups.get(optionId) ?? [];

    for (const row of rowsInGroup) {
      this.model.deleteRow(row.id);
      void this.sync.syncDeleteRow({ rowId: row.id });
    }

    // Remove the option
    const filteredOptions = prop.config.options.filter((o) => o.id !== optionId);
    this.model.updateProperty(groupByPropId, { config: { options: filteredOptions } });
    this.view.removeColumn(boardEl, optionId);
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: filteredOptions } } });
  }

  private handleRowClick(rowId: string): void {
    const row = this.model.getRow(rowId);

    if (row === undefined) {
      return;
    }

    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;
    const option = this.resolveRowOption(row, groupByPropId);

    this.cardDrawer?.open(row, option);
  }

  private resolveRowOption(row: DatabaseRow, groupByPropId: string | undefined): SelectOption | undefined {
    if (groupByPropId === undefined) {
      return undefined;
    }

    const optionId = row.properties[groupByPropId];

    if (typeof optionId === 'string') {
      return this.model.getSelectOptions(groupByPropId).find((o) => o.id === optionId);
    }

    return undefined;
  }

  /**
   * Full re-render of the active board: tears down subsystems, rebuilds DOM, re-inits.
   *
   * Board DOM structure:
   *   boardContainer
   *     boardWrapper  (div returned by createBoard / renderActiveBoard)
   *           boardArea  ([data-blok-database-board] — scrollable area with columns)
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
}
