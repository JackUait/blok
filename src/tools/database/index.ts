import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions, OutputData, ToolboxConfig } from '../../../types';
import type { DatabaseData, DatabaseConfig, DatabaseRow, DatabaseRowData, ViewType, SelectOption, DatabaseViewConfig, PropertyValue } from './types';
import { DatabaseModel } from './database-model';
import { DatabaseBoardView } from './database-board-view';
import { DatabaseListView } from './database-list-view';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { DatabaseBackendSync } from './database-backend-sync';
import { DatabaseCardDrag } from './database-card-drag';
import type { CardDragResult } from './database-card-drag';
import { DatabaseColumnDrag } from './database-column-drag';
import type { GroupDragResult } from './database-column-drag';
import { DatabaseColumnControls } from './database-column-controls';
import { DatabaseListRowDrag } from './database-list-row-drag';
import type { ListRowDragResult } from './database-list-row-drag';
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
  private view!: DatabaseViewRenderer;
  private sync!: DatabaseBackendSync;

  private element: HTMLDivElement | null = null;
  private boardContainer: HTMLDivElement | null = null;
  private tabBar: DatabaseTabBar | null = null;

  private cardDrag: DatabaseCardDrag | null = null;
  private columnDrag: DatabaseColumnDrag | null = null;
  private columnControls: DatabaseColumnControls | null = null;
  private listRowDrag: DatabaseListRowDrag | null = null;
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

    this.syncRowsFromBlocks();
    const boardEl = this.renderActiveView();
    boardContainer.appendChild(boardEl);

    if (!this.readOnly) {
      this.attachViewListeners(boardEl);
      this.initSubsystems(boardEl);
    }

    return wrapper;
  }

  rendered(): void {
    this.block.stretched = true;

    const hadRows = this.model.getOrderedRows().length > 0;

    this.syncRowsFromBlocks();

    if (!hadRows && this.model.getOrderedRows().length > 0) {
      this.rerenderView();
    }

    if (this.config.adapter !== undefined) {
      void this.loadFromBackend();
    }
  }

  private async loadFromBackend(): Promise<void> {
    const data = await this.sync.syncLoadDatabase();

    if (data === undefined) {
      return;
    }

    this.model.hydrate(data);
    const views = this.model.getViews();

    if (views.length > 0 && !views.some((v) => v.id === this.activeViewId)) {
      this.activeViewId = views[0].id;
    }

    this.rerenderView();
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
    this.listRowDrag?.destroy();
    this.listRowDrag = null;
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
  // Row projection from child blocks
  // ---------------------------------------------------------------------------

  private syncRowsFromBlocks(): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rows: DatabaseRow[] = children
      .filter((child) => child.name === 'database-row')
      .map((child) => ({
        id: child.id,
        position: (child.preservedData as DatabaseRowData)?.position ?? '',
        properties: (child.preservedData as DatabaseRowData)?.properties ?? {},
      }));
    this.model.setRows(rows);
  }

  private deleteRowBlock(rowId: string): void {
    const blockIndex = this.api.blocks.getBlockIndex(rowId);

    if (blockIndex !== undefined) {
      void this.api.blocks.delete(blockIndex);
    }

    this.syncRowsFromBlocks();
  }

  private updateRowBlock(rowId: string, propertyChanges: Record<string, PropertyValue>): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rowBlock = children.find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updateProperties', propertyChanges);
      rowBlock.dispatchChange();
    }

    this.syncRowsFromBlocks();
  }

  private moveRowBlock(rowId: string, position: string): void {
    const children = this.api.blocks.getChildren(this.block.id);
    const rowBlock = children.find((child) => child.id === rowId);

    if (rowBlock !== undefined) {
      rowBlock.call('updatePosition', { position });
      rowBlock.dispatchChange();
    }

    this.syncRowsFromBlocks();
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
    this.listRowDrag?.destroy();
    this.keyboard?.destroy();
    this.cardDrag = null;
    this.columnDrag = null;
    this.columnControls = null;
    this.listRowDrag = null;
    this.keyboard = null;

    this.sync.flushPendingUpdates();
    this.sync.destroy();

    this.activateView(viewId);

    this.boardContainer.innerHTML = '';
    this.syncRowsFromBlocks();
    const newBoardWrapper = this.renderActiveView();
    this.boardContainer.appendChild(newBoardWrapper);

    if (!this.readOnly) {
      this.attachViewListeners(newBoardWrapper);
      this.initSubsystems(newBoardWrapper);
    }

    this.rebuildTabBar();
  }

  addView(type: ViewType): void {
    const statusProp = this.model.getSchema().find((p) => p.type === 'select');
    const defaultName = type === 'list' ? 'List' : 'Board';
    const newView = this.model.addView(defaultName, type, {
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
    void this.sync.syncUpdateView({ viewId, changes: { position: newPosition } });
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

  private renderActiveView(): HTMLDivElement {
    const viewConfig = this.model.getView(this.activeViewId);
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const groupByPropId = viewConfig?.groupBy;

    if (viewConfig?.type === 'list') {
      return this.renderListView(titlePropId, groupByPropId, viewConfig);
    }

    return this.renderBoardView(titlePropId, groupByPropId);
  }

  private renderBoardView(titlePropId: string, groupByPropId: string | undefined): HTMLDivElement {
    const options = groupByPropId !== undefined ? this.model.getSelectOptions(groupByPropId) : [];
    const groups: Map<string, DatabaseRow[]> = groupByPropId !== undefined ? this.model.getRowsGroupedBy(groupByPropId) : new Map<string, DatabaseRow[]>();

    this.view = new DatabaseBoardView({
      readOnly: this.readOnly,
      i18n: this.api.i18n,
      options,
      getRows: (optionId) => groups.get(optionId) ?? [],
      titlePropertyId: titlePropId,
    });

    return this.view.createView();
  }

  private renderListView(titlePropId: string, groupByPropId: string | undefined, viewConfig: DatabaseViewConfig): HTMLDivElement {
    const schema = this.model.getSchema();

    if (groupByPropId !== undefined) {
      const options = this.model.getSelectOptions(groupByPropId);
      const groups = this.model.getRowsGroupedBy(groupByPropId);

      this.view = new DatabaseListView({
        readOnly: this.readOnly,
        i18n: this.api.i18n,
        rows: [],
        titlePropertyId: titlePropId,
        schema,
        visiblePropertyIds: viewConfig.visibleProperties,
        options,
        getRows: (optionId) => groups.get(optionId) ?? [],
      });
    } else {
      this.view = new DatabaseListView({
        readOnly: this.readOnly,
        i18n: this.api.i18n,
        rows: this.model.getOrderedRows(),
        titlePropertyId: titlePropId,
        schema,
        visiblePropertyIds: viewConfig.visibleProperties,
      });
    }

    return this.view.createView();
  }

  // ---------------------------------------------------------------------------
  // Event listeners & subsystems
  // ---------------------------------------------------------------------------

  /**
   * Attaches a single click listener on the board element for event delegation.
   */
  private attachViewListeners(boardEl: HTMLDivElement): void {
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
          this.deleteRowBlock(rowId);
          this.view.removeRow(boardEl, rowId);
          void this.sync.syncDeleteRow({ rowId });
        }

        return;
      }

      // List: add row
      const addRowBtn = target.closest('[data-blok-database-add-row]');

      if (addRowBtn !== null) {
        const optionId = addRowBtn.getAttribute('data-option-id');
        this.handleAddListRow(optionId, boardEl);
        return;
      }

      // List: delete row
      const deleteRowBtn = target.closest('[data-blok-database-delete-row]');

      if (deleteRowBtn !== null) {
        const rowId = deleteRowBtn.getAttribute('data-row-id');

        if (rowId !== null) {
          event.stopPropagation();
          this.deleteRowBlock(rowId);
          this.view.removeRow(boardEl, rowId);
          void this.sync.syncDeleteRow({ rowId });
        }

        return;
      }

      // List: row click
      const listRowEl = target.closest('[data-blok-database-list-row]');

      if (listRowEl !== null) {
        const rowId = listRowEl.getAttribute('data-row-id');

        if (rowId !== null) {
          this.handleRowClick(rowId);
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

  private handleAddListRow(optionId: string | null, viewEl: HTMLDivElement): void {
    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const viewConfig = this.model.getView(this.activeViewId);
    const groupByPropId = viewConfig?.groupBy;

    const properties: Record<string, PropertyValue> = { [titlePropId]: '' };

    if (groupByPropId !== undefined && optionId !== null) {
      properties[groupByPropId] = optionId;
    }

    const rowData = this.model.createRowData(properties);
    const blockIndex = this.api.blocks.getBlockIndex(this.block.id) ?? 0;

    this.api.blocks.insert(
      'database-row',
      { properties: rowData.properties, position: rowData.position },
      {},
      blockIndex + 1,
      false,
      false,
      rowData.id,
    );
    this.api.blocks.setBlockParent(rowData.id, this.block.id);
    this.syncRowsFromBlocks();
    this.view.appendRow(viewEl, rowData);

    void this.sync.syncCreateRow({
      id: rowData.id,
      properties: rowData.properties,
      position: rowData.position,
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
    const rowData = this.model.createRowData({
      [titlePropId]: '',
      [groupByPropId]: optionId,
    });

    const blockIndex = this.api.blocks.getBlockIndex(this.block.id) ?? 0;

    this.api.blocks.insert(
      'database-row',
      { properties: rowData.properties, position: rowData.position },
      {},
      blockIndex + 1,
      false,
      false,
      rowData.id,
    );
    this.api.blocks.setBlockParent(rowData.id, this.block.id);
    this.syncRowsFromBlocks();

    const columnEl = boardEl.querySelector(`[data-option-id="${optionId}"][data-blok-database-column]`);

    if (columnEl === null) {
      return;
    }

    const cardsContainer = columnEl.querySelector('[data-blok-database-cards]');

    if (cardsContainer === null) {
      return;
    }

    this.view.appendRow(cardsContainer as HTMLElement, rowData);

    void this.sync.syncCreateRow({
      id: rowData.id,
      properties: rowData.properties,
      position: rowData.position,
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

    this.view.appendGroup?.(boardEl, newOption);
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

    const viewConfig = this.model.getView(this.activeViewId);
    const isList = viewConfig?.type === 'list';

    const titleProp = this.model.getSchema().find((p) => p.type === 'title');
    const titlePropId = titleProp?.id ?? '';
    const descriptionProp = this.model.getSchema().find((p) => p.type === 'richText');
    const descriptionPropId = descriptionProp?.id;

    if (isList) {
      this.listRowDrag = new DatabaseListRowDrag({
        wrapper: boardEl,
        onDrop: (result) => this.handleListRowDrop(result),
      });
    } else {
      this.cardDrag = new DatabaseCardDrag({
        wrapper: boardEl,
        onDrop: (result) => this.handleRowDrop(result),
      });

      this.columnDrag = new DatabaseColumnDrag({
        wrapper: boardEl,
        onDrop: (result) => this.handleGroupDrop(result),
      });

      this.columnControls = new DatabaseColumnControls({
        i18n: this.api.i18n,
        onRename: (optionId, label) => this.handleOptionRename(optionId, label),
        onDelete: (optionId) => this.handleOptionDelete(optionId, boardEl),
      });

      this.makeColumnHeadersEditable(boardEl);
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
        schema: this.model.getSchema(),
        onTitleChange: (rowId, title) => {
          this.updateRowBlock(rowId, { [titlePropId]: title });
          const currentView = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]')
            ?? this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-list]');

          if (currentView !== null && currentView !== undefined) {
            this.view.updateRowTitle(currentView, rowId, title);
          }

          this.sync.syncUpdateRow({ rowId, properties: { [titlePropId]: title } });
        },
        onDescriptionChange: (rowId, description: OutputData) => {
          if (descriptionPropId !== undefined) {
            this.updateRowBlock(rowId, { [descriptionPropId]: description });
            this.sync.syncUpdateRow({ rowId, properties: { [descriptionPropId]: description } });
          }
        },
        onClose: () => { /* no-op; drawer handles its own DOM cleanup */ },
        onAddProperty: (type) => {
          const prop = this.model.addProperty('Property', type);
          void this.sync.syncCreateProperty({
            id: prop.id,
            name: prop.name,
            type: prop.type,
            position: prop.position,
          });
          this.cardDrawer?.refreshSchema(this.model.getSchema());
        },
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

      // Board: column header drag
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

      // Board: card drag
      const cardEl = target.closest('[data-blok-database-card]');

      if (cardEl !== null) {
        const rowId = cardEl.getAttribute('data-row-id');

        if (rowId !== null) {
          e.preventDefault();
          e.stopPropagation();
          this.cardDrag?.beginTracking(rowId, e.clientX, e.clientY);
        }

        return;
      }

      // List: row drag
      const listRowEl = target.closest('[data-blok-database-list-row]');

      if (listRowEl !== null) {
        const rowId = listRowEl.getAttribute('data-row-id');

        if (rowId !== null) {
          e.preventDefault();
          e.stopPropagation();
          this.listRowDrag?.beginTracking(rowId, e.clientX, e.clientY);
        }
      }
    });
  }

  private makeColumnHeadersEditable(boardEl: HTMLDivElement): void {
    if (this.columnControls === null) {
      return;
    }

    const headers = Array.from(boardEl.querySelectorAll<HTMLElement>('[data-blok-database-column-header]'));

    for (const header of headers) {
      const columnEl = header.closest<HTMLElement>('[data-blok-database-column]');
      const optId = columnEl?.getAttribute('data-option-id');

      if (optId !== null && optId !== undefined) {
        this.columnControls.makeEditable(header, optId);
      }
    }
  }

  private handleListRowDrop(result: ListRowDragResult): void {
    const { rowId, beforeRowId, afterRowId } = result;

    const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
    const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
    const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);

    this.moveRowBlock(rowId, position);
    this.rerenderView();

    void this.sync.syncMoveRow({ rowId, position });
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

    this.updateRowBlock(rowId, { [groupByPropId]: toOptionId });
    this.moveRowBlock(rowId, position);
    this.rerenderView();

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
      this.deleteRowBlock(row.id);
      void this.sync.syncDeleteRow({ rowId: row.id });
    }

    // Remove the option
    const filteredOptions = prop.config.options.filter((o) => o.id !== optionId);
    this.model.updateProperty(groupByPropId, { config: { options: filteredOptions } });
    this.view.removeGroup?.(boardEl, optionId);
    void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: filteredOptions } } });
  }

  private handleRowClick(rowId: string): void {
    const row = this.model.getRow(rowId);

    if (row === undefined) {
      return;
    }

    this.cardDrawer?.open(row);
  }

  /**
   * Full re-render of the active board: tears down subsystems, rebuilds DOM, re-inits.
   *
   * Board DOM structure:
   *   boardContainer
   *     boardWrapper  (div returned by createBoard / renderActiveBoard)
   *           boardArea  ([data-blok-database-board] — scrollable area with columns)
   */
  private rerenderView(): void {
    if (this.boardContainer === null) {
      return;
    }

    // The old board wrapper is the first/only direct child of boardContainer
    const oldBoardWrapper = this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]')
      ?.closest<HTMLElement>('[data-blok-tool]')
      ?? this.boardContainer.querySelector<HTMLElement>('[data-blok-database-list]')
      ?? this.boardContainer.firstElementChild as HTMLElement | null;

    const oldBoardArea = this.boardContainer.querySelector<HTMLElement>('[data-blok-database-board]');
    const savedScrollLeft = oldBoardArea?.scrollLeft ?? 0;

    this.cardDrag?.destroy();
    this.columnDrag?.destroy();
    this.columnControls?.destroy();
    this.listRowDrag?.destroy();
    this.listRowDrag = null;
    this.cardDrawer?.destroy();
    this.cardDrawer = null;
    this.keyboard?.destroy();

    this.syncRowsFromBlocks();
    const newBoardWrapper = this.renderActiveView();

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

    this.attachViewListeners(newBoardWrapper);
    this.initSubsystems(newBoardWrapper);
  }
}
