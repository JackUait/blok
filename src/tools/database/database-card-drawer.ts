import type { I18n, OutputData } from '../../../types';
import type { ToolsConfig } from '../../../types/api/tools';
import type { DatabaseRow, PropertyDefinition, PropertyType, PropertyValue } from './types';
import { IconChevronRight } from '../../components/icons';
import { DatabasePropertyTypePopover } from './database-property-type-popover';

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
}

export interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  i18n?: I18n;
  toolsConfig?: ToolsConfig;
  titlePropertyId: string;
  descriptionPropertyId?: string;
  schema: PropertyDefinition[];
  onTitleChange: (rowId: string, title: string) => void;
  onDescriptionChange: (rowId: string, description: OutputData) => void;
  onClose: () => void;
  onAddProperty?: (type: PropertyType) => void;
}

/**
 * Side drawer that opens when a kanban card is clicked.
 * Sits beside the board as a flex sibling, taking layout space.
 * Contains a title input, status property, and a nested Blok editor for the card description.
 */
export class DatabaseCardDrawer {
  private readonly wrapper: HTMLElement;
  private readonly readOnly: boolean;
  private readonly i18n: I18n | undefined;
  private readonly toolsConfig: ToolsConfig | undefined;
  private readonly titlePropertyId: string;
  private readonly descriptionPropertyId: string | undefined;
  private schema: PropertyDefinition[];
  private readonly onTitleChange: (rowId: string, title: string) => void;
  private readonly onDescriptionChange: (rowId: string, description: OutputData) => void;
  private readonly onClose: () => void;
  private readonly onAddProperty: ((type: PropertyType) => void) | undefined;

  private drawer: HTMLDivElement | null = null;
  private currentRowId: string | null = null;
  private currentRow: DatabaseRow | null = null;
  private blokInstance: BlokInstance | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private propertyTypePopover: DatabasePropertyTypePopover | null = null;

  constructor(options: CardDrawerOptions) {
    this.wrapper = options.wrapper;
    this.readOnly = options.readOnly;
    this.i18n = options.i18n;
    this.toolsConfig = options.toolsConfig;
    this.titlePropertyId = options.titlePropertyId;
    this.descriptionPropertyId = options.descriptionPropertyId;
    this.schema = options.schema;
    this.onTitleChange = options.onTitleChange;
    this.onDescriptionChange = options.onDescriptionChange;
    this.onClose = options.onClose;
    this.onAddProperty = options.onAddProperty;
  }

  get isOpen(): boolean {
    return this.drawer !== null;
  }

  open(row: DatabaseRow): void {
    if (this.drawer) {
      if (row.id === this.currentRowId) {
        return;
      }

      this.loadCard(row);

      return;
    }

    // Remove any drawer still animating out from a previous close
    const exiting = this.wrapper.querySelector('[data-blok-database-drawer]');

    exiting?.remove();

    this.currentRowId = row.id;
    this.currentRow = row;
    this.updateActiveCard(row.id);

    const title = (row.properties[this.titlePropertyId] as string) ?? '';

    const drawer = document.createElement('div');

    drawer.setAttribute('data-blok-database-drawer', '');
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Card details');

    // --- Top toolbar ---
    const toolbar = document.createElement('div');

    toolbar.setAttribute('data-blok-database-drawer-toolbar', '');

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-drawer-close', '');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = IconChevronRight + IconChevronRight;
    closeBtn.addEventListener('click', () => {
      this.close();
    });
    toolbar.appendChild(closeBtn);

    drawer.appendChild(toolbar);

    // --- Scrollable content ---
    const content = document.createElement('div');

    content.setAttribute('data-blok-database-drawer-content', '');

    // --- Title input ---
    const titleInput = document.createElement('textarea');

    titleInput.setAttribute('data-blok-database-drawer-title', '');
    titleInput.setAttribute('aria-label', 'Card title');
    titleInput.placeholder = this.i18n?.t('tools.database.cardTitlePlaceholder') ?? 'Empty page';
    titleInput.value = title;
    titleInput.rows = 1;
    titleInput.readOnly = this.readOnly;
    titleInput.addEventListener('input', () => {
      if (this.currentRowId !== null) {
        this.onTitleChange(this.currentRowId, titleInput.value);
      }
      this.autoResizeTitle(titleInput);
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
      }
    });
    content.appendChild(titleInput);

    // --- Properties section ---
    const renderableSchema = this.getRenderableSchema();

    content.appendChild(this.buildPropsSection(renderableSchema, row));

    // --- Divider ---
    const divider = document.createElement('hr');

    content.appendChild(divider);

    // --- Editor holder ---
    const editorHolder = document.createElement('div');

    editorHolder.setAttribute('data-blok-database-drawer-editor', '');
    content.appendChild(editorHolder);

    drawer.appendChild(content);
    this.wrapper.appendChild(drawer);
    this.drawer = drawer;

    requestAnimationFrame(() => {
      drawer.style.width = '45%';
      drawer.addEventListener('transitionend', () => {
        this.autoResizeTitle(titleInput);

        if (!title) {
          titleInput.focus();
        }
      }, { once: true });
    });

    this.initNestedEditor(editorHolder, row);

    this.escapeHandler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }

      const target = e.target as Node | null;

      if (target && editorHolder.contains(target)) {
        return;
      }

      this.close();
    };
    document.addEventListener('keydown', this.escapeHandler);

    this.outsideClickHandler = (e: MouseEvent): void => {
      const target = e.target as Node | null;

      if (target && drawer.contains(target)) {
        return;
      }

      /**
       * Toolbox and other popovers are portaled to document.body,
       * so they sit outside the drawer DOM tree. Without this check,
       * clicking a popover item would be treated as an "outside click"
       * and close the drawer.
       */
      if (target instanceof Element && target.closest('[data-blok-popover-opened]') !== null) {
        return;
      }

      /**
       * The tab bar lives outside the drawer DOM tree, so clicking a
       * tab to switch views would be treated as an outside click and
       * close the drawer before switchView() runs.
       */
      if (target instanceof Element && target.closest('[data-blok-database-tab-bar]') !== null) {
        return;
      }

      this.close();
    };
    document.addEventListener('mousedown', this.outsideClickHandler);

    titleInput.focus();
  }

  /**
   * Swaps content in the already-open drawer to show a different card
   * without closing/reopening the drawer panel.
   */
  private loadCard(row: DatabaseRow): void {
    if (this.drawer === null) {
      return;
    }

    this.cleanupEditor();

    this.currentRowId = row.id;
    this.currentRow = row;
    this.updateActiveCard(row.id);

    const title = (row.properties[this.titlePropertyId] as string) ?? '';

    // Update title
    const titleInput = this.drawer.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    if (titleInput !== null) {
      titleInput.value = title;
      this.autoResizeTitle(titleInput);

      if (!title) {
        titleInput.focus();
      }
    }

    // Replace properties section
    this.drawer.querySelector('[data-blok-database-drawer-props]')?.remove();

    const renderableSchema = this.getRenderableSchema();
    const content = this.drawer.querySelector('[data-blok-database-drawer-content]');
    const divider = content?.querySelector('hr') ?? null;

    if (content !== null) {
      content.insertBefore(this.buildPropsSection(renderableSchema, row), divider);
    }

    // Reinitialize editor
    const editorHolder = this.drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

    if (editorHolder !== null) {
      editorHolder.innerHTML = '';
      this.initNestedEditor(editorHolder, row);
    }
  }

  close(): void {
    const wasOpen = this.drawer !== null;

    this.updateActiveCard(null);
    this.cleanupListeners();
    this.cleanupEditor();

    if (this.drawer) {
      const drawer = this.drawer;

      this.drawer = null;
      drawer.style.width = '0px';
      drawer.addEventListener('transitionend', () => {
        drawer.remove();
      }, { once: true });
    }

    this.currentRowId = null;
    this.currentRow = null;

    if (wasOpen) {
      this.onClose();
    }
  }

  destroy(): void {
    this.cleanupListeners();
    this.cleanupEditor();
    this.propertyTypePopover?.destroy();
    this.propertyTypePopover = null;

    if (this.drawer) {
      this.drawer.remove();
      this.drawer = null;
    }

    // Remove any drawer still animating out
    const exiting = this.wrapper.querySelector('[data-blok-database-drawer]');

    exiting?.remove();

    this.currentRowId = null;
    this.currentRow = null;
  }

  /**
   * Updates the schema and, if the drawer is currently open, rebuilds the
   * properties section in-place using the current row's data.
   */
  refreshSchema(schema: PropertyDefinition[]): void {
    this.schema = schema;

    if (this.drawer === null || this.currentRow === null) {
      return;
    }

    this.drawer.querySelector('[data-blok-database-drawer-props]')?.remove();

    const renderableSchema = this.getRenderableSchema();
    const content = this.drawer.querySelector('[data-blok-database-drawer-content]');
    const divider = content?.querySelector('hr') ?? null;

    if (content !== null) {
      content.insertBefore(this.buildPropsSection(renderableSchema, this.currentRow), divider);
    }
  }

  /**
   * Builds a `[data-blok-database-drawer-props]` section element with one row per
   * renderable schema property.
   */
  private buildPropsSection(renderableSchema: PropertyDefinition[], row: DatabaseRow): HTMLDivElement {
    const propsSection = document.createElement('div');

    propsSection.setAttribute('data-blok-database-drawer-props', '');

    for (const def of renderableSchema) {
      propsSection.appendChild(this.createPropertyRow(def, row.properties[def.id] ?? null));
    }

    if (!this.readOnly) {
      const addBtn = document.createElement('button');

      addBtn.setAttribute('data-blok-database-drawer-add-prop', '');
      addBtn.textContent = '+ Add a property';
      addBtn.addEventListener('click', () => {
        if (this.propertyTypePopover === null) {
          this.propertyTypePopover = new DatabasePropertyTypePopover({
            onSelect: (type) => {
              this.onAddProperty?.(type);
              this.propertyTypePopover?.close();
            },
          });
        }

        this.propertyTypePopover.open(addBtn);
      });
      propsSection.appendChild(addBtn);
    }

    return propsSection;
  }

  /**
   * Returns schema properties that should be shown in the properties section,
   * sorted by position. Excludes 'title' and 'richText' (rendered separately).
   */
  private getRenderableSchema(): PropertyDefinition[] {
    return [...this.schema]
      .filter((def) => def.type !== 'title' && def.type !== 'richText')
      .sort((a, b) => {
        if (a.position < b.position) return -1;
        if (a.position > b.position) return 1;

        return 0;
      });
  }

  /**
   * Creates a pill badge element for a select option.
   */
  private createSelectPill(option: { label: string; color?: string }): HTMLSpanElement {
    const pill = document.createElement('span');

    pill.setAttribute('data-blok-database-drawer-prop-pill', '');

    if (option.color !== undefined) {
      pill.style.backgroundColor = `var(--blok-color-${option.color}-bg)`;
      pill.style.color = `var(--blok-color-${option.color}-text)`;

      const dot = document.createElement('span');

      dot.setAttribute('data-blok-database-drawer-prop-dot', '');
      dot.style.backgroundColor = `var(--blok-color-${option.color}-text)`;
      pill.appendChild(dot);
    }

    const pillText = document.createElement('span');

    pillText.textContent = option.label;
    pill.appendChild(pillText);

    return pill;
  }

  /**
   * Creates a property row that dispatches on the property type to render
   * the appropriate value representation.
   */
  private createPropertyRow(def: PropertyDefinition, value: PropertyValue): HTMLDivElement {
    const row = document.createElement('div');

    row.setAttribute('data-blok-database-drawer-prop-row', '');

    const label = document.createElement('span');

    label.setAttribute('data-blok-database-drawer-prop-label', '');
    label.textContent = def.name;
    row.appendChild(label);

    const valueEl = document.createElement('span');

    valueEl.setAttribute('data-blok-database-drawer-prop-value', '');

    if (def.type === 'select') {
      const config = def.config;
      const optionId = typeof value === 'string' ? value : null;
      const option = config?.options.find((o) => o.id === optionId);

      if (option !== undefined) {
        valueEl.appendChild(this.createSelectPill(option));
      }
    } else if (def.type === 'multiSelect') {
      const config = def.config;
      const selectedIds = Array.isArray(value) ? value : [];

      selectedIds
        .map((id) => config?.options.find((o) => o.id === id))
        .filter((opt): opt is NonNullable<typeof opt> => opt !== undefined)
        .forEach((opt) => valueEl.appendChild(this.createSelectPill(opt)));
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      valueEl.textContent = String(value);
    }

    row.appendChild(valueEl);

    return row;
  }

  private updateActiveCard(rowId: string | null): void {
    const prev = this.wrapper.querySelector('[data-blok-database-card-active]');

    prev?.removeAttribute('data-blok-database-card-active');

    if (rowId !== null) {
      const cardEl = this.wrapper.querySelector(`[data-blok-database-card][data-row-id="${rowId}"]`);

      cardEl?.setAttribute('data-blok-database-card-active', '');
    }
  }

  private cleanupListeners(): void {
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    if (this.outsideClickHandler) {
      document.removeEventListener('mousedown', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private cleanupEditor(): void {
    if (this.blokInstance) {
      try {
        const instance = this.blokInstance;
        const rowId = this.currentRowId;

        instance.save().then((data) => {
          if (rowId !== null) {
            this.onDescriptionChange(rowId, data);
          }
          instance.destroy();
        }).catch(() => {
          instance.destroy();
        });
      } catch {
        // Blok may already be destroyed
      }
      this.blokInstance = null;
    }
  }

  private autoResizeTitle(textarea: HTMLTextAreaElement): void {
    const { style } = textarea;

    style.height = 'auto';

    if (textarea.scrollHeight > 0) {
      style.height = `${textarea.scrollHeight}px`;
    }
  }

  private initNestedEditor(editorHolder: HTMLElement, row: DatabaseRow): void {
    import('../../blok').then(({ Blok }) => {
      const rowId = row.id;
      const description = this.descriptionPropertyId !== undefined
        ? row.properties[this.descriptionPropertyId]
        : undefined;
      const blok = new Blok({
        ...this.toolsConfig,
        holder: editorHolder,
        data: description as OutputData | undefined,
        readOnly: this.readOnly,
        onChange: async () => {
          try {
            const data = await this.blokInstance?.save();

            if (data !== undefined) {
              this.onDescriptionChange(rowId, data);
            }
          } catch {
            // save may fail if editor is being destroyed
          }
        },
      });

      this.blokInstance = blok as unknown as BlokInstance;
    }).catch(() => {
      // Blok import may fail in unit tests (jsdom), drawer still works for title
    });
  }
}
