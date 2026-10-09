import type { I18n, OutputData } from '../../../types';
import type { Events } from '../../../types/api/events';
import type { ToolsConfig } from '../../../types/api/tools';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import type { DatabaseRow, DatabaseRowPages, PropertyDefinition, PropertyType, PropertyValue, SelectOption } from './types';
import { openCellEditor, renderCellValue } from './cells';
import type { CellContext , CellEditorHandle } from './cells';
import { isReadOnlyType, readPropertyValue } from './property-values';
import { IconChevronRight } from '../../components/icons';
import { getElementDirection } from '../../components/utils/direction';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { DatabasePropertyTypePopover } from './database-property-type-popover';
import { outputBlocksToHtml, outputBlocksToSegments } from '../../shared/rich-text/block-data';
import type { FieldsResolver } from '../../shared/rich-text/block-data';
import { htmlToSegmentsDom } from '../../components/utils/rich-text-dom';
import { declaredRichTextFields } from '../../components/tools/base';

/** Must stay longer than the drawer's `transition: transform` in database.css. */
const DRAWER_TRANSITION_FALLBACK_MS = 300;

/**
 * Runs `done` once, when the drawer's slide ends. Reduced motion turns that
 * transition off, and then no transitionend ever comes.
 */
const afterSlide = (drawer: HTMLElement, done: () => void): void => {
  const state = { finished: false };
  const finish = (): void => {
    if (state.finished) {
      return;
    }
    state.finished = true;
    done();
  };

  drawer.addEventListener('transitionend', finish, { once: true });
  window.setTimeout(finish, DRAWER_TRANSITION_FALLBACK_MS);
};

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
  i18n: { update(options: { direction: 'ltr' | 'rtl' }): Promise<void> };
}

export interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  i18n?: I18n;
  /** The outer editor's events, so the page body follows its direction flips. */
  events?: Pick<Events, 'on' | 'off'>;
  toolsConfig?: ToolsConfig;
  rowPages?: DatabaseRowPages;
  titlePropertyId: string;
  descriptionPropertyId?: string;
  schema: PropertyDefinition[];
  onTitleChange: (rowId: string, title: string) => void;
  onDescriptionChange: (rowId: string, description: OutputData) => void;
  onClose: () => void;
  /** "+ Add a property": the chosen type and the name typed above it ('' when left empty). */
  onAddProperty?: (type: PropertyType, name: string) => void;
  /** A property label was clicked: open its property menu under `anchor`. */
  onOpenPropertyMenu?: (propertyId: string, anchor: HTMLElement) => void;
  /** Offer Person when adding a property. */
  hasPeople?: boolean;
  /** What every cell needs from the host beyond i18n: people, uploads, locale. */
  cellContext?: () => Partial<CellContext>;
  /** A property value edited in the drawer. Without it, values stay read-only. */
  onPropertyValueChange?: (rowId: string, propertyId: string, value: PropertyValue) => void;
  /** The whole new option list of a select property, with saved labels. */
  onOptionsChange?: (propertyId: string, options: SelectOption[]) => void;
  /**
   * The saved options of a property. `schema` holds localized labels; option
   * edits put the saved label back on every option the user did not rename,
   * so a translation never lands in saved data.
   */
  savedOptionsOf?: (propertyId: string) => SelectOption[] | undefined;
  /**
   * The page beside the side peek (the editor wrapper). It narrows by the part
   * the half-viewport drawer covers, as Notion's page does (research/08).
   */
  peekHost?: () => HTMLElement | null;
}

const isEmptyValue = (value: PropertyValue): boolean =>
  value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** Notion's per-property page visibility: always show, hide when empty, always hide. */
const isShownOnPage = (property: PropertyDefinition, value: PropertyValue): boolean => {
  if (property.pageVisibility === 'hidden') return false;

  return property.pageVisibility !== 'hideWhenEmpty' || !isEmptyValue(value);
};

/**
 * Rich fields of the body editor's tools, as the editor's adapter reads them:
 * a configured tool's static `richTextFields`, else none. An unconfigured type
 * renders as the stub, which has none, so its data is never rewritten.
 */
const richFieldsOf = (tools: ToolsConfig['tools']): FieldsResolver => (type) => {
  const entry = tools?.[type];

  return declaredRichTextFields(typeof entry === 'function' ? entry : entry?.class);
};

/**
 * Compare key of a page body. `time`, `version` and the per-block edit stamps
 * change on every save, so they are left out: writing a body that differs
 * only there is a new undo step for nothing. Rich fields compare as segments:
 * the body editor saves segments while the row holds HTML.
 */
const bodyKey = (data: OutputData | undefined, fieldsOf: FieldsResolver): string =>
  JSON.stringify(outputBlocksToSegments(data?.blocks ?? [], fieldsOf, htmlToSegmentsDom)
    .map(({ lastEditedAt: _at, lastEditedBy: _by, createdAt: _cat, createdBy: _cby, ...block }) => block));

/**
 * Returns a check that is true when a saved body differs from the last one
 * written (starting from `initial`); that body then becomes the last written.
 */
const createBodyChangeCheck = (initial: OutputData | undefined, fieldsOf: FieldsResolver): ((data: OutputData) => boolean) => {
  const last = { key: bodyKey(initial, fieldsOf) };

  return (data) => {
    const key = bodyKey(data, fieldsOf);
    const changed = key !== last.key;

    last.key = key;

    return changed;
  };
};

/**
 * Side drawer that opens when a kanban card is clicked.
 * Sits beside the board as a flex sibling, taking layout space.
 * Contains a title input, status property, and a nested Blok editor for the card description.
 */
export class DatabaseCardDrawer {
  private readonly wrapper: HTMLElement;
  private readonly findPeekHost: (() => HTMLElement | null) | undefined;
  /** The element the open drawer inset, so close and destroy undo that one. */
  private peekHost: HTMLElement | null = null;
  private readonly readOnly: boolean;
  private readonly i18n: I18n | undefined;
  private readonly toolsConfig: ToolsConfig | undefined;
  private readonly rowPages: DatabaseRowPages | undefined;
  private readonly titlePropertyId: string;
  private descriptionPropertyId: string | undefined;
  private schema: PropertyDefinition[];
  private readonly onTitleChange: (rowId: string, title: string) => void;
  private readonly onDescriptionChange: (rowId: string, description: OutputData) => void;
  private readonly onClose: () => void;
  private readonly onAddProperty: CardDrawerOptions['onAddProperty'];
  private readonly onOpenPropertyMenu: CardDrawerOptions['onOpenPropertyMenu'];
  private readonly hasPeople: boolean;
  private readonly cellContext: () => Partial<CellContext>;
  private readonly onPropertyValueChange: CardDrawerOptions['onPropertyValueChange'];
  private readonly onOptionsChange: CardDrawerOptions['onOptionsChange'];
  private readonly savedOptionsOf: CardDrawerOptions['savedOptionsOf'];
  private cellEditor: CellEditorHandle | null = null;
  private readonly events: Pick<Events, 'on' | 'off'> | undefined;

  private drawer: HTMLDivElement | null = null;
  private currentRowId: string | null = null;
  private currentRow: DatabaseRow | null = null;
  private editorInitVersion = 0;
  private blokInstance: BlokInstance | null = null;
  private pageMount: { destroy(): void } | null = null;
  /** The page the holder shows or failed to mount. Kept while a peer's save drops `pageId`. */
  private mountedPageId: string | undefined = undefined;
  private readonly pendingBodyRows = new Set<string>();
  /** Rows waiting for the host to say whether they have a page. */
  private readonly lookupRows = new Set<string>();
  /** Rows whose page the host could not resolve. */
  private readonly failedLookupRows = new Set<string>();
  private isBodyChanged: ((data: OutputData) => boolean) | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private propertyTypePopover: DatabasePropertyTypePopover | null = null;

  constructor(options: CardDrawerOptions) {
    this.wrapper = options.wrapper;
    this.findPeekHost = options.peekHost;
    this.readOnly = options.readOnly;
    this.i18n = options.i18n;
    this.toolsConfig = options.toolsConfig;
    this.rowPages = options.rowPages;
    this.titlePropertyId = options.titlePropertyId;
    this.descriptionPropertyId = options.descriptionPropertyId;
    this.schema = options.schema;
    this.onTitleChange = options.onTitleChange;
    this.onDescriptionChange = options.onDescriptionChange;
    this.onClose = options.onClose;
    this.onAddProperty = options.onAddProperty;
    this.onOpenPropertyMenu = options.onOpenPropertyMenu;
    this.hasPeople = options.hasPeople === true;
    this.cellContext = options.cellContext ?? ((): Partial<CellContext> => ({}));
    this.onPropertyValueChange = options.onPropertyValueChange;
    this.onOptionsChange = options.onOptionsChange;
    this.savedOptionsOf = options.savedOptionsOf;
    this.events = options.events;
    this.events?.on('i18n:changed', this.followOuterDirection);
  }

  /**
   * The page body is its own editor, so it does not inherit a runtime flip
   * of the outer one.
   */
  private readonly followOuterDirection = (): void => {
    const holder = this.drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');
    const instance = this.blokInstance;

    if (holder === null || holder === undefined || instance === null) {
      return;
    }

    const direction = getElementDirection(holder);
    // Not yet mounted: the queued update lands once the editor is ready.
    const current = holder.querySelector(`[${DATA_ATTR.editor}]`)?.getAttribute('dir');

    // Any update rebuilds the toolbox, so skip one that changes nothing.
    if (current !== direction) {
      void instance.i18n.update({ direction });
    }
  };

  get isOpen(): boolean {
    return this.drawer !== null;
  }

  setDescriptionPropertyId(propertyId: string): void {
    this.descriptionPropertyId = propertyId;
  }

  private descriptionFor(row: DatabaseRow): OutputData | undefined {
    const hasBody = (value: PropertyValue | undefined): value is OutputData =>
      value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray(value.blocks) && value.blocks.length > 0;
    const designated = this.schema.find((property) => property.id === this.descriptionPropertyId);
    const designatedValue = this.descriptionPropertyId === undefined
      ? undefined
      : row.properties[this.descriptionPropertyId];

    // An explicit empty body must not revive an older body column.
    if (designatedValue !== undefined) {
      return designatedValue === null ? undefined : designatedValue as OutputData;
    }

    // Peers can create duplicate body columns with the same name.
    for (const property of this.schema) {
      const value = row.properties[property.id];

      if (property.type === 'richText' && property.name === designated?.name && hasBody(value)) {
        return value;
      }
    }

    // A backend-omitted column can still hold the row's saved body.
    // New edits append a property key, so the latest orphan comes first.
    for (const [propertyId, value] of Object.entries(row.properties).reverse()) {
      if (!this.schema.some((property) => property.id === propertyId) && hasBody(value)) {
        return value;
      }
    }

    return this.descriptionPropertyId === undefined
      ? undefined
      : row.properties[this.descriptionPropertyId] as OutputData | undefined;
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
    drawer.setAttribute('aria-label', this.i18n?.t('tools.database.cardDetails') ?? 'tools.database.cardDetails');

    // --- Top toolbar ---
    const toolbar = document.createElement('div');

    toolbar.setAttribute('data-blok-database-drawer-toolbar', '');

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-drawer-close', '');
    closeBtn.setAttribute(
      'aria-label',
      this.i18n?.t('tools.database.close') ?? englishDictionary['tools.database.close']
    );
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
    titleInput.setAttribute('aria-label', this.i18n?.t('tools.database.cardTitle') ?? 'tools.database.cardTitle');
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
    // The page body saves through onDescriptionChange. Its own DOM churn
    // (a direction flip, toolbox rebuilds) is not a change to this block.
    editorHolder.setAttribute('data-blok-mutation-free', 'true');
    content.appendChild(editorHolder);

    drawer.appendChild(content);
    this.wrapper.appendChild(drawer);
    this.drawer = drawer;

    requestAnimationFrame(() => {
      drawer.setAttribute('data-open', '');
      this.narrowPeekHost();
      afterSlide(drawer, () => {
        this.autoResizeTitle(titleInput);

        if (!title) {
          titleInput.focus();
        }
      });
    });

    this.initNestedEditor(editorHolder, row);

    this.escapeHandler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }

      const target = e.target as Node | null;
      const activeHolder = this.drawer?.querySelector('[data-blok-database-drawer-editor]');

      if (target && activeHolder?.contains(target)) {
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
      const nextHolder = editorHolder.cloneNode(false) as HTMLElement;

      editorHolder.replaceWith(nextHolder);
      this.initNestedEditor(nextHolder, row);
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
      drawer.removeAttribute('data-open');
      this.peekHost?.style.setProperty('--_blok-peek-inset', '0px');
      afterSlide(drawer, () => {
        drawer.remove();

        // A drawer opened meanwhile owns the inset now.
        if (this.drawer === null) {
          this.releasePeekHost();
        }
      });
    }

    this.currentRowId = null;
    this.currentRow = null;

    if (wasOpen) {
      this.onClose();
    }
  }

  destroy(): void {
    this.events?.off('i18n:changed', this.followOuterDirection);
    this.releasePeekHost();
    this.cancelCellEditor();
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
   * Insets the page by the part the drawer (half the viewport, at the inline
   * end) covers. database.css turns the inset into padding that eases with the slide.
   */
  private narrowPeekHost(): void {
    const host = this.findPeekHost?.() ?? null;

    if (host === null) {
      return;
    }
    const half = window.innerWidth / 2;
    const rect = host.getBoundingClientRect();
    const covered = getElementDirection(this.wrapper) === 'rtl' ? half - rect.left : rect.right - half;

    this.peekHost = host;
    host.setAttribute('data-blok-database-peek', '');
    host.style.setProperty('--_blok-peek-inset', `${Math.max(0, Math.round(covered))}px`);
  }

  private releasePeekHost(): void {
    this.peekHost?.removeAttribute('data-blok-database-peek');
    this.peekHost?.style.removeProperty('--_blok-peek-inset');
    this.peekHost = null;
  }

  /** Id of the row the drawer shows, or null when closed. */
  get openRowId(): string | null {
    return this.drawer === null ? null : this.currentRowId;
  }

  setBodyMigrationPending(rowId: string, pending: boolean): void {
    if (pending) {
      this.pendingBodyRows.add(rowId);
    } else {
      this.pendingBodyRows.delete(rowId);
    }
    if (this.currentRowId !== rowId) return;
    this.drawer?.querySelector('[data-blok-database-drawer-editor]')?.toggleAttribute('inert', pending);
  }

  /**
   * Hold the body while the host looks the row's page up, show a failure when
   * the lookup failed, or let the body load. A row the host may have moved
   * must not open the legacy editor: its body there is stale.
   */
  setRowPageLookup(rowId: string, state: 'pending' | 'done' | 'failed'): void {
    this.lookupRows.delete(rowId);
    this.failedLookupRows.delete(rowId);
    if (state === 'pending') this.lookupRows.add(rowId);
    if (state === 'failed') this.failedLookupRows.add(rowId);
    if (this.currentRowId !== rowId || this.currentRow === null || this.mountedPageId !== undefined) return;
    const editorHolder = this.drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

    if (editorHolder === null || editorHolder === undefined) return;
    // Discard, not save: the legacy body may be stale.
    this.blokInstance?.destroy();
    this.blokInstance = null;
    this.isBodyChanged = null;
    editorHolder.replaceChildren();
    this.initNestedEditor(editorHolder, this.currentRow);
  }

  /**
   * Show the open row's data after undo, redo or a peer changed it, or close
   * when the row is gone. A stale title or body would be written back over
   * the change on the next keystroke.
   */
  syncOpenRow(row: DatabaseRow | undefined): void {
    if (this.drawer === null || (row !== undefined && row.id !== this.currentRowId)) {
      return;
    }

    if (row === undefined) {
      this.close();

      return;
    }

    this.currentRow = row;

    const titleInput = this.drawer.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');
    const title = (row.properties[this.titlePropertyId] as string | undefined) ?? '';

    if (titleInput !== null && titleInput.value !== title) {
      const { selectionStart, selectionEnd } = titleInput;

      titleInput.value = title;
      titleInput.setSelectionRange(Math.min(selectionStart, title.length), Math.min(selectionEnd, title.length));
      this.autoResizeTitle(titleInput);
    }

    this.refreshSchema(this.schema);

    const description = this.descriptionFor(row);
    const editorHolder = this.drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

    // An old client's save drops `pageId`; the page stays the body.
    const shownPageId = row.pageId ?? (this.rowPages === undefined ? undefined : this.mountedPageId);

    if (editorHolder !== null && shownPageId !== this.mountedPageId) {
      this.blokInstance?.destroy();
      this.blokInstance = null;
      this.isBodyChanged = null;
      this.pageMount?.destroy();
      this.pageMount = null;
      this.mountedPageId = undefined;
      editorHolder.replaceChildren();
      this.initNestedEditor(editorHolder, row);
      return;
    }

    // Discard, not save: saving the old editor would write the stale body
    // back over the change.
    if (editorHolder !== null && this.mountedPageId === undefined && this.isBodyChanged?.(description ?? { blocks: [] }) === true) {
      this.blokInstance?.destroy();
      this.blokInstance = null;
      this.isBodyChanged = null;
      editorHolder.innerHTML = '';
      this.initNestedEditor(editorHolder, row);
    }
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
      const value = readPropertyValue(row, def) ?? null;

      if (isShownOnPage(def, value)) {
        propsSection.appendChild(this.createPropertyRow(def, value));
      }
    }

    if (!this.readOnly) {
      const addBtn = document.createElement('button');

      addBtn.setAttribute('data-blok-database-drawer-add-prop', '');
      addBtn.textContent = this.t('tools.database.addProperty');
      addBtn.addEventListener('click', () => {
        if (this.propertyTypePopover === null) {
          this.propertyTypePopover = new DatabasePropertyTypePopover({
            onSelect: (type, name) => {
              this.onAddProperty?.(type, name);
              this.propertyTypePopover?.close();
            },
            i18n: this.i18n,
            hasPeople: this.hasPeople,
            withNameField: true,
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

  /** Replaces the schema without rebuilding the open properties, so an open cell editor keeps its anchor. */
  setSchema(schema: PropertyDefinition[]): void {
    this.schema = schema;
  }

  private t(key: string): string {
    return this.i18n?.t(key) ?? key;
  }

  /** Draws a value into its slot. The drawer pill attribute shipped in v1.16.1, so it stays. */
  private paintValue(slot: HTMLElement, def: PropertyDefinition, value: PropertyValue | undefined): void {
    const cell = renderCellValue(def, value, { ...this.cellContext(), i18n: { t: (key) => this.t(key) }, readOnly: this.readOnly });

    cell.querySelectorAll('[data-blok-database-option-pill]').forEach((pill) => pill.setAttribute('data-blok-database-drawer-prop-pill', ''));
    if (cell.hasAttribute('data-empty')) {
      cell.textContent = this.t('tools.database.cellEmpty');
    }
    slot.replaceChildren(cell);
  }

  /** Puts the saved label back on each option whose shown (localized) label the user kept. */
  private withSavedLabels(propertyId: string, shown: SelectOption[], next: SelectOption[]): SelectOption[] {
    const saved = this.savedOptionsOf?.(propertyId) ?? [];

    return next.map((option) => {
      const before = shown.find((o) => o.id === option.id);
      const savedOption = saved.find((o) => o.id === option.id);

      return before !== undefined && savedOption !== undefined && before.label === option.label
        ? { ...option, label: savedOption.label }
        : option;
    });
  }

  private openValueEditor(slot: HTMLElement, propertyId: string): void {
    const def = this.schema.find((p) => p.id === propertyId);
    const row = this.currentRow;

    if (def === undefined || row === null || this.onPropertyValueChange === undefined) {
      return;
    }
    this.closeCellEditor();
    const rowId = row.id;
    const shownOptions = { list: def.config?.options ?? [] };
    const onOptionsChange = this.onOptionsChange;

    this.cellEditor = openCellEditor(def, readPropertyValue(row, def), slot, {
      ...this.cellContext(),
      i18n: { t: (key) => this.t(key) },
      readOnly: this.readOnly,
      options: shownOptions.list,
      ...(onOptionsChange !== undefined
        ? {
          onOptionsChange: (next: SelectOption[]): void => {
            const saved = this.withSavedLabels(propertyId, shownOptions.list, next);

            shownOptions.list = next;
            this.schema = this.schema.map((p) => (p.id === propertyId ? { ...p, config: { ...p.config, options: next } } : p));
            onOptionsChange(propertyId, saved);
          },
        }
        : {}),
      onCommit: (value) => {
        if (this.currentRow?.id === rowId) {
          this.currentRow = { ...this.currentRow, properties: { ...this.currentRow.properties, [propertyId]: value } };
        }
        this.onPropertyValueChange?.(rowId, propertyId, value);
        const current = this.schema.find((p) => p.id === propertyId);

        if (slot.isConnected && current !== undefined) {
          this.paintValue(slot, current, value);
        }
      },
      onClose: () => {
        this.cellEditor = null;
        const current = this.schema.find((p) => p.id === propertyId);

        if (slot.isConnected && current !== undefined && this.currentRow?.id === rowId) {
          this.paintValue(slot, current, this.currentRow.properties[propertyId]);
        }
      },
    });
    if (!this.cellEditor.isOpen) {
      this.cellEditor = null;
    }
  }

  private closeCellEditor(): void {
    const editor = this.cellEditor;

    this.cellEditor = null;
    editor?.close();
  }

  /** Teardown drops a draft: the block may be going read-only or away, and must not be written. */
  private cancelCellEditor(): void {
    const editor = this.cellEditor;

    this.cellEditor = null;
    editor?.cancel();
  }

  /**
   * One label + value row. The value is a button that opens the cell editor
   * for its type; read-only values are plain text.
   */
  private createPropertyRow(def: PropertyDefinition, value: PropertyValue): HTMLDivElement {
    const row = document.createElement('div');

    row.setAttribute('data-blok-database-drawer-prop-row', '');

    const label = document.createElement('span');

    label.setAttribute('data-blok-database-drawer-prop-label', '');
    label.setAttribute('data-property-id', def.id);
    label.textContent = def.name;
    if (!this.readOnly && this.onOpenPropertyMenu !== undefined) {
      const openMenu = this.onOpenPropertyMenu;

      label.setAttribute('role', 'button');
      label.tabIndex = 0;
      label.addEventListener('click', () => openMenu(def.id, label));
      label.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openMenu(def.id, label);
        }
      });
    }
    row.appendChild(label);

    const valueEl = document.createElement('div');

    valueEl.setAttribute('data-blok-database-drawer-prop-value', '');
    valueEl.setAttribute('data-property-id', def.id);
    this.paintValue(valueEl, def, value);

    if (!this.readOnly && this.onPropertyValueChange !== undefined && !isReadOnlyType(def.type)) {
      valueEl.setAttribute('role', 'button');
      valueEl.tabIndex = 0;
      valueEl.setAttribute('aria-label', def.name);
      valueEl.addEventListener('click', (event) => {
        // Cmd/Ctrl-click on a url follows the link instead.
        if (event.target instanceof Element && event.target.closest('a') !== null && (event.metaKey || event.ctrlKey)) {
          return;
        }
        this.openValueEditor(valueEl, def.id);
      });
      valueEl.addEventListener('keydown', (event) => {
        if (event.target !== valueEl || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        this.openValueEditor(valueEl, def.id);
      });
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

  /** The body editor's host save holds segments; the row stores HTML, as every tool's data does. */
  private bodyAsHtml(data: OutputData): OutputData {
    return { ...data, blocks: outputBlocksToHtml(data.blocks, richFieldsOf(this.toolsConfig?.tools)) };
  }

  private cleanupEditor(): void {
    this.closeCellEditor();
    this.pageMount?.destroy();
    this.pageMount = null;
    this.mountedPageId = undefined;
    if (this.blokInstance) {
      const instance = this.blokInstance;

      try {
        const rowId = this.currentRowId;
        const migrationPending = rowId !== null && this.pendingBodyRows.has(rowId);
        const isBodyChanged = this.isBodyChanged;

        instance.save().then((data) => {
          if (rowId !== null && !migrationPending && !this.pendingBodyRows.has(rowId) && isBodyChanged?.(data) === true) {
            this.onDescriptionChange(rowId, this.bodyAsHtml(data));
          }
          instance.destroy();
        }).catch(() => {
          instance.destroy();
        });
      } catch {
        (instance as Partial<BlokInstance>).destroy?.();
      }
      this.blokInstance = null;
      this.isBodyChanged = null;
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
    const initVersion = ++this.editorInitVersion;

    editorHolder.toggleAttribute('inert', this.pendingBodyRows.has(row.id));
    if (row.pageId !== undefined && this.rowPages !== undefined) {
      // Set even when mounting fails, so a later sync does not retry it.
      this.mountedPageId = row.pageId;
      try {
        this.pageMount = this.rowPages.mount(row.pageId, editorHolder);
      } catch {
        this.showPageFailure(editorHolder);
      }
      return;
    }
    if (this.rowPages !== undefined && this.failedLookupRows.has(row.id)) {
      this.showPageFailure(editorHolder);
      return;
    }
    if (this.rowPages !== undefined && this.lookupRows.has(row.id)) {
      editorHolder.toggleAttribute('inert', true);
      return;
    }

    import('../../blok').then(({ Blok }) => {
      const rowId = row.id;

      if (this.currentRowId !== rowId || this.editorInitVersion !== initVersion) {
        return;
      }

      // The row may have changed while the editor loaded.
      const latest = this.currentRow ?? row;

      if (this.rowPages !== undefined && (latest.pageId !== undefined
        || this.lookupRows.has(rowId) || this.failedLookupRows.has(rowId))) {
        return;
      }
      const description = this.descriptionFor(latest);
      const isBodyChanged = createBodyChangeCheck(description, richFieldsOf(this.toolsConfig?.tools));
      const saveState: {
        started: number;
        inFlight: number;
        best: { order: number; data: OutputData } | null;
      } = { started: 0, inFlight: 0, best: null };
      const blok = new Blok({
        ...this.toolsConfig,
        holder: editorHolder,
        data: description,
        readOnly: this.readOnly,
        // The card body belongs to the host's document; it must not sync or lead on its own.
        tabSync: false,
        // A fresh editor defaults to LTR; the page body reads like its database.
        i18n: { direction: getElementDirection(editorHolder) },
        onChange: async () => {
          if (this.pendingBodyRows.has(rowId)) return;
          const save = ++saveState.started;

          saveState.inFlight++;
          try {
            const data = await instance.save();

            if (saveState.best === null || save > saveState.best.order) {
              saveState.best = { order: save, data };
            }
          } catch {
            // save may fail if editor is being destroyed
          }

          saveState.inFlight--;
          if (saveState.inFlight === 0) {
            const best = saveState.best;

            saveState.best = null;
            if (best !== null && !this.pendingBodyRows.has(rowId) && isBodyChanged(best.data)) {
              this.onDescriptionChange(rowId, this.bodyAsHtml(best.data));
            }
          }
        },
      });

      const instance = blok as unknown as BlokInstance;

      this.blokInstance = instance;
      this.isBodyChanged = isBodyChanged;
    }).catch(() => {
      // Blok import may fail in unit tests (jsdom), drawer still works for title
    });
  }

  private showPageFailure(editorHolder: HTMLElement): void {
    const failure = document.createElement('p');

    failure.setAttribute('role', 'alert');
    failure.textContent = this.i18n?.t('tools.stub.error') ?? englishDictionary['tools.stub.error'];
    editorHolder.replaceChildren(failure);
  }
}
