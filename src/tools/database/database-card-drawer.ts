import type { I18n, OutputData } from '../../../types';
import type { Events } from '../../../types/api/events';
import type { ToolsConfig } from '../../../types/api/tools';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import type { DatabaseRow, DatabaseRowPages, DateReminderOffset, OpenPagesIn, PageVisibility, PropertyDefinition, PropertyType, PropertyValue, SelectOption } from './types';
import { openCellEditor, renderCellValue } from './cells';
import type { CellContext , CellEditorHandle } from './cells';
import type { DateDisplayChange } from './cells/date-format';
import { isReadOnlyType, readPropertyValue } from './property-values';
import { cellText } from './database-table-clipboard';
import { rowCellContext } from './reminders';
import { IconArrowDiagonal, IconCheck, IconCopy, IconEmojiSmile, IconImage, IconMenu, IconMessage, IconPlus, IconChevronDown, IconChevronLeft, IconChevronRight, IconDotsHorizontal, IconEmojiStar, IconStarFilled, IconLink, IconPage, IconPageLayout, IconPlayerTheater, IconSidebarRight, IconSplitView, IconChevronDoubleRight, IconExpandDiagonal, IconPeekCenter, IconPeekFull, IconPeekSide, IconSliders } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { getUserOS } from '../../components/utils/browser';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { DATABASE_HEADER_MENU_CLASS, rowActionItems } from './database-table-menus';
import type { RowActionContext, RowFavorite } from './database-table-menus';
import { hide as hideTooltip, onHover, show as showTooltip } from '../../components/utils/tooltip';
import { onPropertyHover } from './property-hint';
import { createTooltipContent } from '../../components/modules/toolbar/tooltip';
import { createHeadingToggle } from '../table/table-heading-toggle';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { EmojiPicker } from '../callout/emoji-picker';
import { loadEmojiGrid } from '../../components/utils/emoji/emoji-data';
import { fileChipIcon } from './page-icon';
import { openCoverPicker, validateCoverFile } from '../audio/cover-picker';
import type { CoverPickerHandle } from '../audio/cover-picker';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import { isEscapeConsumed } from '../../components/utils/consumed-escape';
import { getElementDirection, logicalArrow } from '../../components/utils/direction';
import { prefersReducedMotion } from '../../components/utils/reduced-motion';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { isPromotedToTopLayer, overlayMountFor, promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { DatabasePropertyTypePopover } from './database-property-type-popover';
import { propertyTypeMeta } from './database-property-types';
import { rowDescription } from './row-body';
import { outputBlocksToHtml, outputBlocksToSegments } from '../../shared/rich-text/block-data';
import type { FieldsResolver } from '../../shared/rich-text/block-data';
import { htmlToSegmentsDom } from '../../components/utils/rich-text-dom';
import { declaredRichTextFields } from '../../components/tools/base';
import { DatabaseDropLine } from './database-drop-line';
import {
  addModule,
  applyDraft,
  arrangeSection,
  groupFirst,
  isDraftEmpty,
  pageLayoutOf,
  pinFirst,
  resetPageLayout,
  resolvePageLayout,
  sectionFirst,
  inTabOrder,
} from './page-layout';
import type { PageLayoutData, PageLayoutDraft, PageLayoutOp, ResolvedPageLayout } from './page-layout';
import { nanoid } from 'nanoid';
import { PageLayoutBuilder } from './page-layout-builder';
import { OverflowList, tabsThatFit } from '../../components/utils/overflow-list';
import type { BuilderTabs, PageLayoutModuleEntry } from './page-layout-builder';

/** Where a property made from a builder menu goes. */
type AddedPlace = 'pin' | 'group' | 'page' | 'panel' | { sectionId: string };

/** A press on a property's ⋮⋮ becomes a drag past this many pixels; less is a click. */
const PROPERTY_DRAG_THRESHOLD = 4;

/** Must stay longer than the drawer's `transition: transform` in database.css. */
const DRAWER_TRANSITION_FALLBACK_MS = 300;
/** The full-page details panel's width (research/09 §9). Must match database.css. */
const DETAILS_DOCK_WIDTH = 385;
/** Space between the narrowed full page and the panel. Blok's; Notion's page padding was 96px. */
const DETAILS_DOCK_GAP = 24;
/** Side peek width and drag limits (research/22 §10). */
const PEEK_WIDTH = 756;
const PEEK_MIN_WIDTH = 564;
const PEEK_MAX_WIDTH = 1008;
/** The side peek's details panel. It widens the peek by its own width. Must match database.css. */
const PEEK_DETAILS_WIDTH = 280;
/** Arrow-key step. The column resizer's. */
const PEEK_RESIZE_STEP = 16;
/** Notion's persistence was not measured: Blok keeps it per viewer, for every database. */
const PEEK_WIDTH_KEY = 'blok:database-peek-width';
/** Notion's pin arrows scroll 400px per click (research/09 §4). */
const PIN_SCROLL_STEP = 400;
const PEEK_MODE_ICONS: Record<OpenPagesIn, string> = { side: IconPeekSide, center: IconPeekCenter, full: IconPeekFull };
/** One peek per page: opening one closes the other database's. */
const openPeek: { drawer: DatabaseCardDrawer | null } = { drawer: null };
/** The drawer whose inset a page shows; a peek still sliding out must not undo a newer one's. */
const peekHostOwners = new WeakMap<HTMLElement, DatabaseCardDrawer>();

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

/**
 * Previous (-1) or next (1) row from a key press: Ctrl+Shift+K/J on a Mac,
 * Ctrl+K/J elsewhere (research/03 §1.4). Off a Mac, Ctrl+K in a text field is
 * the link shortcut, so the field keeps it.
 */
const stepOf = (event: KeyboardEvent): 1 | -1 | null => {
  const mac = getUserOS().mac;
  const step = ({ KeyJ: 1, KeyK: -1 } as const)[event.code as 'KeyJ' | 'KeyK'] ?? null;

  if (step === null || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey !== mac) {
    return null;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  const inField = target !== null && (target.isContentEditable || target.matches('input, textarea, select'));

  return mac || !inField ? step : null;
};

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
  i18n: { update(options: { direction: 'ltr' | 'rtl' }): Promise<void> };
}

/** A tab of the layout tabs block. Content holds no database; its '' title reads as the "Content" label. */
export interface LayoutTab {
  id: string;
  title: string;
  /** Holds a linked database. Content is the tab that does not. */
  view: boolean;
}

/** View tab edits of an open Customize layout, applied with the layout. */
export interface LayoutTabsDraft {
  /** Blocks made while customizing: tabs, or a whole tabs block. */
  made: string[];
  /** Saved tabs deleted while customizing. */
  removed: string[];
  /** Saved tabs renamed while customizing. */
  titles: ReadonlyMap<string, string>;
  /** The view tabs as reordered while customizing, by id. */
  order?: string[];
  /** Reset: the view tabs go with the rest of the layout. */
  reset?: boolean;
}

/**
 * The row page's view tabs: a `tabs` block under the database, each `tab`
 * holding a linked database (plan 11 §2.1). The drawer draws its own strip
 * from them and borrows the shown tab's database holder.
 */
export interface LayoutTabsHost {
  /** The tabs tools are registered and the database can be written. */
  canEdit(): boolean;
  list(): LayoutTab[];
  /** Databases a view tab can show. */
  sources(): Array<{ id: string; title: string }>;
  /** Makes a view tab at once, with no undo step. `made` is what Discard deletes. */
  add(sourceId: string, title: string): { tabId: string; made: string; contentId: string | null } | null;
  /** Relations to other databases the Add tab menu offers (research/13 §1b). */
  related(): Array<{ propertyId: string; title: string }>;
  /** Like `add`: a view tab of the related database, filtered to the row page shown. */
  addRelated(propertyId: string): { tabId: string; made: string; contentId: string | null } | null;
  /** Another database of this document, which a new relation can point to. */
  canRelate(sourceId: string): boolean;
  /** A database's property names, as saved. */
  propertyNames?(sourceId: string): string[];
  /**
   * research/13 §2: a two-way relation to `sourceId` (its mirror named
   * `relatedName`) and a view tab filtered by the mirror. The properties save
   * at once; `propertyId` is what Discard removes.
   */
  addWithRelation(sourceId: string, name: string, relatedName: string): { tabId: string; made: string; contentId: string | null; propertyId: string } | null;
  /** Deletes a relation made while customizing and its mirror. */
  removeRelation(propertyId: string): void;
  /** Copies a view tab to the end of the bar as `title`, with its own view ids. Like `add`. */
  duplicate(tabId: string, title: string): { tabId: string; made: string; contentId: string | null } | null;
  /** Makes the tabs block with only Content, with no undo step. Null when it exists. */
  ensure(): { contentId: string; made: string } | null;
  /** Renames a tab made while customizing, with no undo step. */
  renameMade(tabId: string, title: string): void;
  /** Deletes blocks made while customizing, with no undo step. */
  discard(made: string[]): void;
  /** Moves the tab's database holder into `host`, shown on row `rowId`. False when it cannot. */
  attach(tabId: string, host: HTMLElement, rowId: string): boolean;
  detach(): void;
  notify(message: string): void;
}

const LINK_TYPES: ReadonlySet<string> = new Set(['url', 'email', 'phone']);
/** feel/findings-rowpage R16: Notion's Comment and Copy pill shows on every filled value it copies, not only links. */
const COPY_TYPES: ReadonlySet<string> = new Set([...LINK_TYPES, 'text', 'number']);

/** View tab edits of the open draft. `made` are the blocks Discard deletes; `fresh` every tab made now. */
class PageLayoutTabEdits {
  made: string[] = [];
  readonly fresh = new Set<string>();
  readonly removed = new Set<string>();
  readonly titles = new Map<string, string>();
  /** Relations "Add new relation" made: Discard deletes them, like other builder-made properties. */
  readonly relations: string[] = [];
  /** The view tabs dragged in "N more…", by id. Null: not reordered. */
  order: string[] | null = null;

  static empty(): PageLayoutTabEdits {
    return new PageLayoutTabEdits();
  }

  get isEmpty(): boolean {
    return this.made.length === 0 && this.removed.size === 0 && this.titles.size === 0 && this.order === null;
  }
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
  /**
   * "+ Add a property": the database's add-property menu under `anchor`. Wins over `onAddProperty`.
   * `onAdded` gets the new property's id after the schema refresh.
   */
  onOpenAddProperty?: (anchor: HTMLElement, onAdded?: (propertyId: string) => void) => void;
  /** Discard in Customize layout: delete a property made while customizing. */
  onDeleteProperty?: (propertyId: string) => void;
  /**
   * A property label was clicked: open its property menu under `anchor`.
   * `onCustomizeLayout` is set when the page can be customized: the menu ends with "Customize layout".
   */
  onOpenPropertyMenu?: (propertyId: string, anchor: HTMLElement, onCustomizeLayout?: () => void, extras?: { onComment?: () => void }) => void;
  /** Offer Person when adding a property. */
  hasPeople?: boolean;
  /** What every cell needs from the host beyond i18n: people, uploads, locale. */
  cellContext?: () => Partial<CellContext>;
  /** A property value edited in the drawer. Without it, values stay read-only. */
  onPropertyValueChange?: (rowId: string, propertyId: string, value: PropertyValue) => void;
  /** A date's Remind choice, null for None. Without it the date picker has no Remind row. */
  onReminderChange?: (rowId: string, propertyId: string, reminder: DateReminderOffset | null) => void;
  /** The date picker's format rows. Returns undefined where the property may not change: no rows then. */
  dateDisplayChanger?: (propertyId: string) => ((change: DateDisplayChange) => void) | undefined;
  /** The whole new option list of a select property, with saved labels. */
  onOptionsChange?: (propertyId: string, options: SelectOption[]) => void;
  /**
   * The saved options of a property. `schema` holds localized labels; option
   * edits put the saved label back on every option the user did not rename,
   * so a translation never lands in saved data.
   */
  savedOptionsOf?: (propertyId: string) => SelectOption[] | undefined;
  /**
   * Shows the row's own child blocks as the page body: moves the row holder
   * into `host` and returns true. False keeps the nested editor (a host page,
   * or a legacy body a read-only viewer cannot convert).
   */
  rowBody?: {
    attach(rowId: string, host: HTMLElement): boolean;
    detach(rowId: string): void;
    /** Enter on the title: the highlighted template pick, otherwise the caret in the body (adding its first paragraph when empty). */
    start(rowId: string): void;
    /** ↑/↓ on the title move through the empty page's template picker. False when there is none. */
    move?(rowId: string, step: 1 | -1): boolean;
  };
  /** A page cover set (an image URL) or removed (null). */
  onCoverChange?: (rowId: string, cover: string | null) => void;
  /** Uploads a picked cover file and gives its URL. Without it, a cover comes from a link only. */
  uploadCover?: (file: File) => Promise<string>;
  /** Escape closed the page of this row. */
  onEscapeClose?: (rowId: string) => void;
  /** "Copy link to view" on a row page's view tab. Without it, the tab menu has no such item. */
  onCopyViewLink?: (rowId: string, tabId: string) => void;
  /** A page icon picked (an emoji) or removed (null). */
  onIconChange?: (rowId: string, icon: string | null) => void;
  /**
   * The row actions of the page's "•••" menu (research/09 §1b). Undefined for a
   * page they cannot act on, such as a template.
   */
  rowActions?: (rowId: string) => Omit<RowActionContext, 'i18n'> | undefined;
  /** The host's favorites, asked on each open. Undefined: no star (no lever, or a template's page). */
  favorite?: (rowId: string) => RowFavorite | undefined;
  /** The page's own Full width set, or null to follow the layout again. */
  onFullWidthChange?: (rowId: string, fullWidth: boolean | null) => void;
  /** The row before (-1) or after (1) the open one in the view, if any. */
  adjacentRow?: (rowId: string, direction: 1 | -1) => DatabaseRow | undefined;
  /** The view's rows in its order, for the layout builder's Preview switch. */
  viewRows?: () => DatabaseRow[];
  /** "Edit view default" in the mode menu: the view's Layout settings. Without it there is no such item. */
  onEditViewDefault?: (anchor: HTMLElement) => void;
  /** The expand button. True when the host took the page (its full page); else the drawer goes full. */
  onExpand?: (rowId: string) => boolean;
  /**
   * The page beside the side peek (the editor wrapper). It narrows by the part
   * the half-viewport drawer covers, as Notion's page does (research/08).
   */
  peekHost?: () => HTMLElement | null;
  /**
   * "Apply to all pages" or a reset. The tool applies the edit to the model's
   * own layout, so a peer's change the drawer has not seen yet survives.
   * Apply also hands the eye edits, which write each property; both are one
   * undo step. `edit` is null when only the eye changed.
   */
  onPageLayoutChange?: (edit: PageLayoutOp | null, visibility?: ReadonlyMap<string, PageVisibility>, tabs?: LayoutTabsDraft) => void;
  /** The row page's view tabs. Without it a Tabbed page shows Content only. */
  layoutTabs?: LayoutTabsHost;
  /** Customize layout opened: write the empty layout lists before any edit. */
  onPageLayoutBirth?: () => void;
  /** A locked database keeps its layout. */
  databaseLocked?: () => boolean;
  /** The database's name, for the layout builder's top bar. */
  databaseTitle?: () => string;
  /** The database block's id. Section folds are kept per database in this browser; without it they last the session. */
  databaseId?: string;
  /** The pages that mention the row, asked each time its page head is drawn. */
  backlinks?: (rowId: string) => readonly DrawerBacklink[];
  /** The row's built-in "Comments" section under the properties, or null when comments are the host's or off. */
  comments?: (rowId: string) => HTMLElement | null;
  /** A url, email or phone value's Comment button (research/22 §3). Without it the button is not drawn. */
  onCommentProperty?: (rowId: string, propertyId: string, anchor: HTMLElement) => void;
  /** Shows a toast, such as "Copied property to clipboard". */
  notify?: (message: string) => void;
}

/** A page that mentions the open row (research/17 §2). */
export interface DrawerBacklink {
  /** One per page. */
  key: string;
  title: string;
  /** The titles above the page, top first. */
  path: readonly string[];
  /** The page's emoji. */
  icon?: string;
  /** Mentions on this page, 1 when absent. The button counts mentions, the list pages (research/23 §4). */
  mentions?: number;
  /** Goes to the block holding the mention. */
  open(): void;
}

const backlinksKey = (rowId: string, items: readonly DrawerBacklink[]): string =>
  JSON.stringify([rowId, items.map((item) => [item.key, item.title, item.path, item.icon ?? '', item.mentions ?? 1])]);

const mentionCount = (items: readonly DrawerBacklink[]): number =>
  items.reduce((sum, item) => sum + (item.mentions ?? 1), 0);

/** An icon constant as a node. Its indent text would join the label's text. */
const iconNode = (markup: string): Element => {
  const template = document.createElement('template');

  // A trusted constant from the icon module.
  template.innerHTML = markup.trim().replace(/>\s+</g, '><');

  return template.content.firstElementChild ?? document.createElement('span');
};

/** Null when there is no key, nothing stored, or storage is blocked. */
const readStorage = (key: string | null): string | null => {
  try {
    return key === null ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const clampPeekWidth = (width: number): number => Math.round(Math.min(PEEK_MAX_WIDTH, Math.max(PEEK_MIN_WIDTH, width)));

const storedPeekWidth = (): number => {
  const stored = Number.parseFloat(readStorage(PEEK_WIDTH_KEY) ?? '');

  return Number.isFinite(stored) ? clampPeekWidth(stored) : PEEK_WIDTH;
};

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
  private readonly onCopyViewLink: CardDrawerOptions['onCopyViewLink'];
  private readonly onAddProperty: CardDrawerOptions['onAddProperty'];
  private readonly onOpenPropertyMenu: CardDrawerOptions['onOpenPropertyMenu'];
  private readonly onOpenAddProperty: CardDrawerOptions['onOpenAddProperty'];
  private readonly onDeleteProperty: CardDrawerOptions['onDeleteProperty'];
  private readonly hasPeople: boolean;
  private readonly cellContext: () => Partial<CellContext>;
  private readonly onPropertyValueChange: CardDrawerOptions['onPropertyValueChange'];
  private readonly onOptionsChange: CardDrawerOptions['onOptionsChange'];
  private readonly onReminderChange: CardDrawerOptions['onReminderChange'];
  private readonly dateDisplayChanger: CardDrawerOptions['dateDisplayChanger'];
  private readonly savedOptionsOf: CardDrawerOptions['savedOptionsOf'];
  private readonly rowBody: CardDrawerOptions['rowBody'];
  private readonly adjacentRow: CardDrawerOptions['adjacentRow'];
  private readonly viewRows: CardDrawerOptions['viewRows'];
  /** The builder's "New page" preview when the database has no rows (research/09 §1). No drawer is open then. */
  private placeholder: DatabaseRow | null = null;
  private readonly onEditViewDefault: CardDrawerOptions['onEditViewDefault'];
  private readonly onExpand: CardDrawerOptions['onExpand'];
  private readonly onIconChange: CardDrawerOptions['onIconChange'];
  private readonly backlinks: CardDrawerOptions['backlinks'];
  private readonly comments: CardDrawerOptions['comments'];
  private readonly onCommentProperty: CardDrawerOptions['onCommentProperty'];
  private readonly notify: CardDrawerOptions['notify'];
  /** The open "Linked to this page" list; it shares the mode menu's slot. */
  private backlinksMenu: PopoverDesktop | null = null;
  /** What the drawn "N backlinks" lists, to skip a redraw that changes nothing. */
  private backlinksShown: string | null = null;
  private readonly rowActions: CardDrawerOptions['rowActions'];
  private readonly favorite: CardDrawerOptions['favorite'];
  private readonly onFullWidthChange: CardDrawerOptions['onFullWidthChange'];
  private readonly onEscapeClose: CardDrawerOptions['onEscapeClose'];
  private readonly onCoverChange: CardDrawerOptions['onCoverChange'];
  private readonly uploadCover: CardDrawerOptions['uploadCover'];
  private readonly onPageLayoutChange: CardDrawerOptions['onPageLayoutChange'];
  private readonly onPageLayoutBirth: CardDrawerOptions['onPageLayoutBirth'];
  private readonly layoutTabs: CardDrawerOptions['layoutTabs'];
  /** View tab edits of the open draft. */
  private tabDraft = PageLayoutTabEdits.empty();
  private readonly databaseLocked: () => boolean;
  private readonly databaseTitle: () => string;
  /** The edits of an open Customize layout, or null when not customizing. */
  private draft: PageLayoutDraft | null = null;
  /** Open exactly while `draft` is. It makes the rest of the page inert, so every exit must close it. */
  private builder: PageLayoutBuilder | null = null;
  /** Watches the pins scroller for overflow. Replaced on every redraw. */
  private pinsObserver: ResizeObserver | null = null;
  /** Fits the tab bar into its width. Replaced on every redraw. */
  private tabsObserver: ResizeObserver | null = null;
  private tabsOverflow: OverflowList | null = null;
  /** The resolved layout's "Property icons", read while drawing property rows. */
  private propertyIcons = true;
  /** The layout's "Property labels". Off drops the pins' labels (research/10 §4). */
  private propertyLabels = true;
  /** "View details". Closed on every open, as in Notion (research/09 §9). */
  private detailsOpen = false;
  /** The side peek's width, with the panel's 280px while it widens the peek. */
  private peekWidth = PEEK_WIDTH;
  private peekWidened = false;
  /** Folds of this session. Local storage holds them across reloads when it can (plan Q3). */
  private readonly collapsedSections = new Set<string>();
  private readonly databaseId: string | undefined;
  /** The open tab of a Tabbed page: 'content' or a tab block id. Kept across rows (research/11 §4). */
  private activeTab = 'content';
  /** The tab drawn: `activeTab` while it exists, else Content. */
  private shownTab = 'content';
  private coverPicker: CoverPickerHandle | null = null;
  private emojiPicker: EmojiPicker | null = null;
  /** The properties section is folded away. Session only. */
  private propsCollapsed = false;
  /** Properties the page hides are shown for now. Kept across rows; a reload resets it (research/09 "Other checks"). */
  private showHiddenProps = false;
  private mode: OpenPagesIn = 'side';
  private backdrop: HTMLElement | null = null;
  private modeMenu: PopoverDesktop | null = null;
  /** The row whose holder is the shown page body. */
  private attachedBodyRowId: string | null = null;
  /** A body still in a side peek that is sliding out. */
  private leavingBodyRowId: string | null = null;
  private cellEditor: CellEditorHandle | null = null;
  /** Window-capture Tab while a value editor is open: editors live in a body popover the drawer never sees. */
  private editorTab: ((event: KeyboardEvent) => void) | null = null;
  private readonly events: Pick<Events, 'on' | 'off'> | undefined;

  private drawer: HTMLDivElement | null = null;
  private currentRowId: string | null = null;
  private templateRepeatOpen: ((anchor: HTMLElement) => void) | null = null;
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
  private resizeHandler: (() => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private propertyTypePopover: DatabasePropertyTypePopover | null = null;
  /** Where the built-in type menu places what it adds, when a builder menu opened it. */
  private nextAddedPlace: AddedPlace | null = null;

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
    this.onCopyViewLink = options.onCopyViewLink;
    this.onAddProperty = options.onAddProperty;
    this.onOpenPropertyMenu = options.onOpenPropertyMenu;
    this.onOpenAddProperty = options.onOpenAddProperty;
    this.onDeleteProperty = options.onDeleteProperty;
    this.hasPeople = options.hasPeople === true;
    this.cellContext = options.cellContext ?? ((): Partial<CellContext> => ({}));
    this.onPropertyValueChange = options.onPropertyValueChange;
    this.onOptionsChange = options.onOptionsChange;
    this.onReminderChange = options.onReminderChange;
    this.dateDisplayChanger = options.dateDisplayChanger;
    this.savedOptionsOf = options.savedOptionsOf;
    this.rowBody = options.rowBody;
    this.adjacentRow = options.adjacentRow;
    this.viewRows = options.viewRows;
    this.onEditViewDefault = options.onEditViewDefault;
    this.onExpand = options.onExpand;
    this.onIconChange = options.onIconChange;
    this.backlinks = options.backlinks;
    this.comments = options.comments;
    this.onCommentProperty = options.onCommentProperty;
    this.notify = options.notify;
    this.rowActions = options.rowActions;
    this.favorite = options.favorite;
    this.onFullWidthChange = options.onFullWidthChange;
    this.onEscapeClose = options.onEscapeClose;
    this.onCoverChange = options.onCoverChange;
    this.uploadCover = options.uploadCover;
    this.onPageLayoutChange = options.onPageLayoutChange;
    this.onPageLayoutBirth = options.onPageLayoutBirth;
    this.layoutTabs = options.layoutTabs;
    this.databaseLocked = options.databaseLocked ?? ((): boolean => false);
    this.databaseTitle = options.databaseTitle ?? ((): string => '');
    this.databaseId = options.databaseId;
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
    return rowDescription(row, this.schema, this.descriptionPropertyId);
  }

  /** How the open page shows: side peek, center peek or full page. */
  get openMode(): OpenPagesIn {
    return this.mode;
  }

  open(row: DatabaseRow, mode: OpenPagesIn = this.drawer === null ? 'side' : this.mode): void {
    if (this.drawer) {
      if (mode !== this.mode) {
        this.applyMode(mode);
      }
      if (row.id === this.currentRowId) {
        return;
      }

      this.detailsOpen = false;
      this.loadCard(row);

      return;
    }

    if (openPeek.drawer !== null && openPeek.drawer !== this) {
      openPeek.drawer.close();
    }
    openPeek.drawer = this;

    // Remove any drawer still animating out from a previous close
    const exiting = this.wrapper.querySelector('[data-blok-database-drawer]');

    this.releaseLeavingBody();
    exiting?.remove();

    this.detailsOpen = false;
    this.peekWidth = storedPeekWidth();
    this.peekWidened = false;
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

    closeBtn.type = 'button';
    closeBtn.setAttribute('data-blok-database-drawer-close', '');
    closeBtn.addEventListener('click', () => {
      this.close();
    });
    toolbar.append(closeBtn, ...this.createHeaderControls());

    drawer.appendChild(toolbar);

    // --- Scrollable content ---
    const content = document.createElement('div');

    content.setAttribute('data-blok-database-drawer-content', '');

    content.appendChild(this.buildPageHead(row));

    // --- Title input ---
    const titleInput = document.createElement('textarea');

    titleInput.setAttribute('data-blok-database-drawer-title', '');
    titleInput.setAttribute('aria-label', this.i18n?.t('tools.database.cardTitle') ?? 'tools.database.cardTitle');
    // R25: Notion's empty row page title reads "New page".
    titleInput.placeholder = this.i18n?.t('tools.database.layoutNewPage') ?? 'New page';
    titleInput.value = title;
    titleInput.rows = 1;
    titleInput.readOnly = this.readOnly;
    titleInput.addEventListener('input', () => {
      if (this.currentRowId !== null) {
        this.onTitleChange(this.currentRowId, titleInput.value);
      }
      this.autoResizeTitle(titleInput);
      this.syncCrumbs();
    });
    titleInput.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.isComposing && !this.readOnly && this.attachedBodyRowId !== null
        && this.rowBody?.move?.(this.attachedBodyRowId, e.key === 'ArrowDown' ? 1 : -1) === true) {
        e.preventDefault();
        e.stopPropagation();

        return;
      }
      // R22: one Tab from the title opens the first value's editor.
      if (e.key === 'Tab' && !e.shiftKey && !e.isComposing && !this.readOnly && this.tabbableValues().length > 0) {
        e.preventDefault();
        this.openNextEditor(null, 1);

        return;
      }
      if (e.key !== 'Enter' || e.isComposing) {
        return;
      }
      e.preventDefault();
      // "Press Enter to continue with an empty page".
      if (!this.readOnly && this.attachedBodyRowId !== null) {
        this.rowBody?.start(this.attachedBodyRowId);
        // R24: Notion scrolls the peek so the caret's block shows.
        requestAnimationFrame(() => {
          const focused = document.activeElement;

          if (focused instanceof HTMLElement && this.drawer?.querySelector('[data-blok-database-drawer-editor]')?.contains(focused) === true) {
            focused.scrollIntoView({ block: 'nearest' });
          }
        });
      }
    });
    content.appendChild(titleInput);

    const comments = this.comments?.(row.id) ?? null;

    if (comments !== null) content.appendChild(comments);

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
    drawer.appendChild(this.buildPeekResizeHandle(drawer));
    this.wrapper.appendChild(drawer);
    this.drawer = drawer;
    this.setPeekWidth(this.peekWidth);
    this.renderRegions(row);
    this.applyMode(mode);

    requestAnimationFrame(() => {
      drawer.setAttribute('data-open', '');
      if (this.drawer === drawer && this.mode === 'side') {
        this.narrowPeekHost();
      }
      afterSlide(drawer, () => {
        this.autoResizeTitle(titleInput);

        if (!title) {
          titleInput.focus();
        }
      });
    });

    this.initNestedEditor(editorHolder, row);

    this.escapeHandler = (e: KeyboardEvent): void => {
      const step = stepOf(e);

      if (step !== null) {
        e.preventDefault();
        this.step(step);

        return;
      }
      // A full page is left with its back button, not Escape. Customize layout is left with Cancel or Apply (research/10 §2).
      if (e.key !== 'Escape' || this.mode === 'full' || this.draft !== null) {
        return;
      }

      // A popover closed on this press already. One Escape = one layer.
      if (isEscapeConsumed(e)) {
        return;
      }

      const target = e.target as Node | null;
      const activeHolder = this.drawer?.querySelector('[data-blok-database-drawer-editor]');

      if (target && activeHolder?.contains(target)) {
        return;
      }
      const rowId = this.currentRowId;

      this.close();
      if (rowId !== null) {
        this.onEscapeClose?.(rowId);
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
    this.resizeHandler = (): void => this.syncDetailsDock();
    window.addEventListener('resize', this.resizeHandler);

    this.outsideClickHandler = (e: MouseEvent): void => {
      const target = e.target as Node | null;

      // Only the center peek closes on a click outside; the page beside a side peek stays usable.
      if ((target && drawer.contains(target)) || this.mode !== 'center' || (target !== null && this.builder?.contains(target) === true)) {
        return;
      }

      /**
       * Toolbox and other popovers are portaled to document.body,
       * so they sit outside the drawer DOM tree. Without this check,
       * clicking a popover item would be treated as an "outside click"
       * and close the drawer.
       */
      if (target instanceof Element && target.closest('[data-blok-popover-opened], [data-blok-emoji-picker], [data-blok-emoji-picker-backdrop], [data-role="audio-cover-picker"]') !== null) {
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

      // The tab bar's "N more…" list mounts on body too.
      if (target !== null && this.tabsOverflow?.contains(target) === true) {
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
    this.syncStepButtons();
    this.syncActionsButton();
    this.syncFavoriteButton();
    this.syncCopyLinkButton();

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

    this.drawer.querySelector('[data-blok-database-drawer-page-head]')?.replaceWith(this.buildPageHead(row));
    this.syncCrumbs();

    // Reinitialize editor
    const editorHolder = this.drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

    if (editorHolder !== null) {
      editorHolder.innerHTML = '';
      const nextHolder = editorHolder.cloneNode(false) as HTMLElement;

      editorHolder.replaceWith(nextHolder);
      this.initNestedEditor(nextHolder, row);
    }
    this.renderRegions(row);
  }

  close(): void {
    const wasOpen = this.drawer !== null;
    // The side peek slides out with its body still in it; the body goes back
    // to the pool once the slide ends.
    const sliding = this.drawer !== null && this.mode === 'side' ? this.attachedBodyRowId : null;

    if (sliding !== null) {
      this.attachedBodyRowId = null;
      this.leavingBodyRowId = sliding;
    }
    this.updateActiveCard(null);
    this.cleanupListeners();
    this.cleanupEditor();
    this.closeModeMenu();
    this.stopWatchingPins();
    // Closing mid-draft is a discard: tabs and relations made in it go (research/11 §1).
    if (this.draft !== null) this.discardTabDraft();
    this.layoutTabs?.detach();
    this.draft = null;
    this.placeholder = null;
    this.closeBuilder();
    this.emojiPicker?.close();
    this.emojiPicker?.getElement().remove();
    this.emojiPicker = null;
    this.coverPicker?.close();
    this.coverPicker = null;
    this.removeBackdrop();
    this.wrapper.removeAttribute('data-blok-database-full-page');

    // Only the side peek slides out; center and full page leave at once.
    if (this.drawer !== null && this.mode !== 'side') {
      this.drawer.remove();
      this.drawer = null;
    }

    if (this.drawer) {
      const drawer = this.drawer;

      this.drawer = null;
      drawer.removeAttribute('data-open');
      this.peekHost?.style.setProperty('--_blok-peek-inset', '0px');
      afterSlide(drawer, () => {
        this.releaseLeavingBody();
        drawer.remove();

        // A drawer opened meanwhile owns the inset now.
        if (this.drawer === null) {
          this.releasePeekHost();
        }
      });
    }

    this.currentRowId = null;
    this.currentRow = null;
    if (openPeek.drawer === this) {
      openPeek.drawer = null;
    }

    if (wasOpen) {
      this.onClose();
    }
  }

  destroy(): void {
    this.events?.off('i18n:changed', this.followOuterDirection);
    this.stopWatchingPins();
    this.releasePeekHost();
    this.closeModeMenu();
    // Destroyed mid-draft is a discard too (research/11 §1).
    if (this.draft !== null) this.discardTabDraft();
    this.layoutTabs?.detach();
    this.draft = null;
    this.placeholder = null;
    this.closeBuilder();
    this.emojiPicker?.close();
    this.emojiPicker?.getElement().remove();
    this.emojiPicker = null;
    this.coverPicker?.close();
    this.coverPicker = null;
    this.removeBackdrop();
    this.wrapper.removeAttribute('data-blok-database-full-page');
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

    this.releaseLeavingBody();
    exiting?.remove();

    this.currentRowId = null;
    this.currentRow = null;
    if (openPeek.drawer === this) {
      openPeek.drawer = null;
    }
  }

  /** The 12px col-resize handle on the side peek's inner edge (research/22 §10). */
  private buildPeekResizeHandle(drawer: HTMLElement): HTMLElement {
    const handle = document.createElement('div');

    handle.setAttribute('data-blok-database-peek-resize', '');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    // A window splitter is named after the pane it sizes (WAI-ARIA APG).
    handle.setAttribute('aria-label', this.label('tools.database.openPagesSide'));
    handle.setAttribute('aria-valuemin', String(PEEK_MIN_WIDTH));
    handle.setAttribute('aria-valuemax', String(PEEK_MAX_WIDTH));
    handle.tabIndex = 0;

    handle.addEventListener('keydown', (event) => {
      const arrow = logicalArrow(event.key, getElementDirection(drawer));
      const next = ({ Home: PEEK_MIN_WIDTH, End: PEEK_MAX_WIDTH } as Record<string, number | undefined>)[event.key]
        ?? (arrow === null ? null : this.peekWidth + (arrow === 'backward' ? PEEK_RESIZE_STEP : -PEEK_RESIZE_STEP));

      if (next === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.setPeekWidth(next, true);
    });

    this.bindPeekHandleHint(handle, drawer);

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      hideTooltip();
      event.preventDefault();
      if (typeof handle.setPointerCapture === 'function') {
        handle.setPointerCapture(event.pointerId);
      }
      // The page beside the peek follows the pointer at once, not over its 200ms ease.
      this.peekHost?.setAttribute('data-blok-database-peek-resizing', '');
      const press = { moved: false };
      const onMove = (move: PointerEvent): void => {
        const rect = drawer.getBoundingClientRect();

        press.moved = true;

        this.setPeekWidth(getElementDirection(drawer) === 'rtl' ? move.clientX - rect.left : rect.right - move.clientX);
      };
      const onEnd = (end: PointerEvent): void => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        this.peekHost?.removeAttribute('data-blok-database-peek-resizing');
        // research/35 §12: only a press with no pointer move closes; any move, even 0px, resized.
        if (end.type === 'pointerup' && !press.moved) {
          this.close();

          return;
        }
        this.savePeekWidth();
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });

    return handle;
  }

  /**
   * research/30 B24: hovering the handle shows "Close · Click" and "Resize · Drag"
   * beside it, level with the pointer. Notion's "or ⌘\" is left out: in the web
   * app ⌘\ toggles the sidebar, not the peek (research/31 §2).
   */
  private bindPeekHandleHint(handle: HTMLElement, drawer: HTMLElement): void {
    // The tooltip places itself against this 0px-tall anchor, so it follows the pointer's height.
    const hintAnchor = document.createElement('div');

    hintAnchor.setAttribute('data-blok-database-peek-hint-anchor', '');
    hintAnchor.setAttribute('aria-hidden', 'true');
    Object.assign(hintAnchor.style, { position: 'absolute', insetInline: '0', height: '0', pointerEvents: 'none' });
    handle.appendChild(hintAnchor);

    const content = createTooltipContent([[
      { text: this.label('tools.database.close'), highlight: true },
      { text: ' ', highlight: false },
      { text: this.label('blockSettings.clickAction'), highlight: false },
    ], [
      { text: this.label('tools.database.peekResizeHint'), highlight: true },
      { text: ' ', highlight: false },
      { text: this.label('tools.database.peekResizeHintAction'), highlight: false },
    ]]);
    const place = (event: PointerEvent): { placement: string } => {
      hintAnchor.style.top = `${event.clientY - handle.getBoundingClientRect().top}px`;

      return { placement: getElementDirection(drawer) === 'rtl' ? 'right' : 'left' };
    };

    handle.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') showTooltip(hintAnchor, content, place(event));
    });
    handle.addEventListener('pointermove', (event) => {
      const options = place(event);

      // Re-showing while the delay runs would restart it; once shown, it moves at once.
      if (hintAnchor.hasAttribute('aria-describedby')) showTooltip(hintAnchor, content, options);
    });
    handle.addEventListener('pointerleave', () => hideTooltip());
  }

  private setPeekWidth(width: number, save = false): void {
    this.peekWidth = clampPeekWidth(width);
    this.drawer?.style.setProperty('--_blok-peek-width', `${this.peekWidth}px`);
    this.drawer?.querySelector('[data-blok-database-peek-resize]')?.setAttribute('aria-valuenow', String(this.peekWidth));
    if (this.mode === 'side' && this.drawer?.hasAttribute('data-open') === true) {
      this.narrowPeekHost();
    }
    if (save) {
      this.savePeekWidth();
    }
  }

  /** Saves the width the peek has with the panel closed, so a reopened peek is not left wide. */
  private savePeekWidth(): void {
    const width = this.peekWidened ? clampPeekWidth(this.peekWidth - PEEK_DETAILS_WIDTH) : this.peekWidth;

    try {
      window.localStorage.setItem(PEEK_WIDTH_KEY, String(width));
    } catch {
      // Blocked storage: the width holds for this session only.
    }
  }

  /**
   * An open details panel widens the side peek by its 280px, up to the max.
   * Closing takes 280px back, down to the min: from 756 it lands on 728, as measured (research/22 §10).
   */
  private syncPeekWidening(drawer: HTMLElement): void {
    const widen = this.mode === 'side' && drawer.hasAttribute('data-details-open');

    if (widen === this.peekWidened) {
      return;
    }
    this.peekWidened = widen;
    this.setPeekWidth(this.peekWidth + (widen ? PEEK_DETAILS_WIDTH : -PEEK_DETAILS_WIDTH), !widen);
  }

  /**
   * Insets the page by the part the drawer (at the inline end) covers. database.css turns the inset into padding that eases with the slide.
   */
  private narrowPeekHost(): void {
    const host = this.findPeekHost?.() ?? null;

    if (host === null) {
      return;
    }
    const width = Math.min(this.peekWidth, window.innerWidth);
    const rect = host.getBoundingClientRect();
    const covered = getElementDirection(this.wrapper) === 'rtl' ? width - rect.left : rect.right - (window.innerWidth - width);

    this.peekHost = host;
    peekHostOwners.set(host, this);
    host.setAttribute('data-blok-database-peek', '');
    host.style.setProperty('--_blok-peek-inset', `${Math.max(0, Math.round(covered))}px`);
  }

  private releasePeekHost(): void {
    if (this.peekHost !== null && peekHostOwners.get(this.peekHost) !== this) {
      this.peekHost = null;

      return;
    }
    this.peekHost?.removeAttribute('data-blok-database-peek');
    this.peekHost?.removeAttribute('data-blok-database-peek-resizing');
    this.peekHost?.style.removeProperty('--_blok-peek-inset');
    this.peekHost = null;
  }

  /** Icon row above the title: the page icon, or "Add icon" for a writer. */
  private buildPageHead(row: DatabaseRow): HTMLElement {
    const head = document.createElement('div');

    head.setAttribute('data-blok-database-drawer-page-head', '');
    const src = row.cover === undefined ? null : safeImageSrc(row.cover);
    const backlinks = this.buildBacklinks(row.id);

    if (src !== null) {
      const cover = document.createElement('div');
      const img = document.createElement('img');

      cover.setAttribute('data-blok-database-drawer-cover', '');
      img.alt = '';
      img.src = src;
      cover.appendChild(img);
      if (!this.readOnly && this.onCoverChange !== undefined) {
        const change = document.createElement('button');

        change.type = 'button';
        change.setAttribute('data-blok-database-drawer-change-cover', '');
        change.textContent = this.label('tools.database.changeCover');
        change.addEventListener('click', () => this.openCover(row.id, change));
        cover.appendChild(change);
      }
      head.appendChild(cover);
    }
    if (backlinks !== null) {
      head.appendChild(backlinks);
    }
    // R10: Add icon · Add cover · Customize layout, each with its glyph.
    if (row.icon !== undefined) {
      const icon = document.createElement('button');

      icon.type = 'button';
      icon.setAttribute('data-blok-database-drawer-icon', '');
      icon.setAttribute('aria-label', this.label('tools.database.changeIcon'));
      icon.textContent = row.icon;
      icon.disabled = this.readOnly;
      icon.addEventListener('click', () => this.openIconPicker(row.id, icon));
      head.appendChild(icon);
    } else if (!this.readOnly && this.onIconChange !== undefined) {
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-drawer-add-icon', '');
      add.innerHTML = IconEmojiSmile;
      add.append(this.label('tools.database.addIcon'));
      add.addEventListener('click', () => this.addRandomIcon(row.id, add));
      head.appendChild(add);
    }
    if (src === null && !this.readOnly && this.onCoverChange !== undefined) {
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-drawer-add-cover', '');
      add.innerHTML = IconImage;
      add.append(this.label('tools.database.addCover'));
      add.addEventListener('click', () => this.openCover(row.id, add));
      head.appendChild(add);
    }
    if (this.customizable) {
      const customize = this.textButton('data-blok-database-drawer-customize', 'tools.database.layoutCustomize', () => this.startCustomizing());

      customize.insertAdjacentHTML('afterbegin', IconPageLayout);
      head.appendChild(customize);
    }

    return head;
  }

  /** "N backlinks", or null when no page mentions the row: Notion draws nothing then (research/17 §2a). */
  private buildBacklinks(rowId: string, items = this.backlinks?.(rowId) ?? []): HTMLButtonElement | null {
    if (this.backlinksMenu !== null && this.modeMenu === this.backlinksMenu) {
      this.closeModeMenu();
    }
    this.backlinksShown = backlinksKey(rowId, items);
    if (items.length === 0) {
      return null;
    }
    const button = document.createElement('button');
    const icon = document.createElement('span');

    button.type = 'button';
    button.setAttribute('data-blok-database-drawer-backlinks', '');
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    icon.setAttribute('data-blok-database-backlinks-icon', '');
    icon.append(iconNode(IconArrowDiagonal));
    button.append(icon, this.backlinksLabel(mentionCount(items)));
    button.addEventListener('click', () => this.openBacklinks(button, rowId));

    return button;
  }

  private backlinksLabel(count: number): string {
    if (count === 0) return this.label('tools.database.backlinksNone');

    return this.label(count === 1 ? 'tools.database.backlinksOne' : 'tools.database.backlinks').replace('{count}', String(count));
  }

  /** Redraws "N backlinks" for the open row after a mention came or went. */
  refreshBacklinks(): void {
    const head = this.drawer?.querySelector('[data-blok-database-drawer-page-head]');
    const rowId = this.currentRowId;

    if (head === null || head === undefined || rowId === null) {
      return;
    }
    const items = this.backlinks?.(rowId) ?? [];

    // Same pages: keep the item, so an open list stays open.
    if (backlinksKey(rowId, items) === this.backlinksShown) {
      return;
    }
    const next = this.buildBacklinks(rowId, items);
    const current = head.querySelector('[data-blok-database-drawer-backlinks]');

    if (current !== null && next !== null) {
      current.replaceWith(next);
    } else if (current !== null) {
      current.remove();
    } else if (next !== null) {
      const cover = head.querySelector('[data-blok-database-drawer-cover]');

      // A null sibling appends: the cover may be the head's last child.
      head.insertBefore(next, cover === null ? head.firstChild : cover.nextSibling);
    }
  }

  /** "Linked to this page": each mentioning page, its path in grey (research/17 §2d). */
  private openBacklinks(anchor: HTMLElement, rowId: string): void {
    this.closeModeMenu();
    const items = this.backlinks?.(rowId) ?? [];
    const heading = document.createElement('div');

    heading.setAttribute('data-blok-database-backlinks-heading', '');
    heading.textContent = this.label('tools.database.backlinksTitle');
    const menu = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      // Notion's list is 500 wide; a phone keeps a 16px gutter.
      minWidth: `${Math.max(0, Math.min(500, window.innerWidth - 32))}px`,
      items: [
        { type: PopoverItemType.Html, element: heading },
        ...items.map((item): PopoverItemParams => ({
          type: PopoverItemType.Default,
          name: `backlink-${item.key}`,
          dataset: { 'blok-database-backlink': '' },
          title: item.title,
          // Not secondaryLabel: that draws a keyboard shortcut from markup.
          titleEl: this.backlinkTitle(item),
          icon: this.backlinkIcon(item),
          closeOnActivate: true,
          onActivate: () => item.open(),
        })),
      ],
    });

    menu.on(PopoverEvent.Closed, () => {
      anchor.setAttribute('aria-expanded', 'false');
      if (this.modeMenu === menu) {
        this.modeMenu = null;
        this.backlinksMenu = null;
        menu.destroy();
      }
    });
    this.modeMenu = menu;
    this.backlinksMenu = menu;
    menu.show();
    anchor.setAttribute('aria-expanded', 'true');
  }

  /** The page's title, then its path in grey. */
  private backlinkTitle(item: DrawerBacklink): HTMLElement {
    const line = document.createElement('span');
    const title = document.createElement('span');

    line.setAttribute('data-blok-database-backlink-line', '');
    title.setAttribute('data-blok-database-backlink-title', '');
    title.textContent = item.title;
    line.appendChild(title);
    if (item.path.length > 0) {
      const path = document.createElement('span');

      const [first, ...rest] = item.path;
      const head = document.createElement('span');

      path.setAttribute('data-blok-database-backlink-path', '');
      head.setAttribute('data-blok-database-backlink-path-first', '');
      head.textContent = first;
      path.appendChild(head);
      if (rest.length > 0) {
        const tail = document.createElement('span');

        // Notion keeps only the parent after the first page: "first / ... / parent" (research/23 §4).
        tail.textContent = rest.length > 1 ? ` / ... / ${rest[rest.length - 1]}` : ` / ${rest[0]}`;
        path.appendChild(tail);
      }
      line.appendChild(path);
    }

    return line;
  }

  /** The arrow, then the page's emoji or the page glyph. */
  private backlinkIcon(item: DrawerBacklink): HTMLElement {
    const icon = document.createElement('span');
    const arrow = document.createElement('span');
    const page = document.createElement('span');

    icon.setAttribute('data-blok-database-backlink-icon', '');
    arrow.setAttribute('data-blok-database-backlinks-icon', '');
    arrow.append(iconNode(IconArrowDiagonal));
    if (item.icon === undefined) {
      page.append(iconNode(IconPage));
    } else {
      page.textContent = item.icon;
    }
    icon.append(arrow, page);

    return icon;
  }

  /** The shared cover picker (upload or link), anchored on the cover button. */
  private openCover(rowId: string, anchor: HTMLElement): void {
    const onCoverChange = this.onCoverChange;

    if (this.readOnly || onCoverChange === undefined) {
      return;
    }
    this.coverPicker?.close();
    const picker = openCoverPicker({
      anchor,
      ...(this.i18n !== undefined ? { i18n: this.i18n } : {}),
      onUrl: (url) => {
        if (safeImageSrc(url) === null) {
          picker.setError(this.label('tools.database.coverInvalid'));

          return;
        }
        onCoverChange(rowId, url);
        picker.close();
      },
      onFile: (file) => {
        const error = validateCoverFile(file, this.i18n);
        const upload = this.uploadCover;

        if (error !== null || upload === undefined) {
          picker.setError(error ?? this.label('tools.database.coverNoUpload'));

          return;
        }
        void upload(file).then((url) => {
          onCoverChange(rowId, url);
          picker.close();
        }).catch(() => picker.setError(this.label('tools.database.coverNoUpload')));
      },
      onClose: () => {
        if (this.coverPicker === picker) {
          this.coverPicker = null;
        }
      },
    });

    this.coverPicker = picker;
  }

  /** The row menu's "Edit icon": the picker under the open page's icon. */
  editIcon(): void {
    const anchor = this.drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-icon], [data-blok-database-drawer-add-icon]');

    if (this.currentRowId !== null && anchor !== null && anchor !== undefined) {
      this.openIconPicker(this.currentRowId, anchor);
    }
  }

  /** The row menu's "Edit property ›": that value's editor on the open page, hidden properties shown first. */
  editProperty(propertyId: string): void {
    const slot = (): HTMLElement | null => this.drawer?.querySelector<HTMLElement>(`[data-blok-database-drawer-prop-value][data-property-id="${CSS.escape(propertyId)}"]`) ?? null;

    if (slot() === null && this.draft === null) {
      this.showHiddenProps = true;
      this.propsCollapsed = false;
      this.refreshSchema(this.schema);
    }
    const found = slot();

    if (found !== null) {
      this.openValueEditor(found, propertyId);
    }
  }

  /** R33: Notion sets a random emoji at once, then opens the picker under the new icon. */
  private addRandomIcon(rowId: string, button: HTMLElement): void {
    const onIconChange = this.onIconChange;

    if (this.readOnly || onIconChange === undefined) return;
    void loadEmojiGrid().then((emojis) => {
      const pick = emojis[Math.floor(Math.random() * emojis.length)]?.native;

      // The page moved on or got an icon meanwhile.
      if (pick === undefined || this.currentRowId !== rowId || this.currentRow?.icon !== undefined) return;
      onIconChange(rowId, pick);
      const icon = this.drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-icon]');

      this.openIconPicker(rowId, icon ?? button);
    }, () => this.openIconPicker(rowId, button));
  }

  private openIconPicker(rowId: string, anchor: HTMLElement): void {
    const onIconChange = this.onIconChange;
    const i18n = this.i18n;

    if (this.readOnly || onIconChange === undefined || i18n === undefined) {
      return;
    }
    const handlers = {
      onSelect: (native: string): void => onIconChange(rowId, native),
      onRemove: (): void => onIconChange(rowId, null),
    };

    if (this.emojiPicker === null) {
      this.emojiPicker = new EmojiPicker({ ...handlers, i18n, locale: i18n.getLocale() });
    }
    const element = this.emojiPicker.getElement();

    if (!element.isConnected) {
      overlayMountFor(anchor).appendChild(element);
    }
    void this.emojiPicker.open(anchor, undefined, handlers);
  }

  /** "Properties" with a caret that folds the section away. */
  private buildPropsToggle(): HTMLElement {
    const toggle = document.createElement('button');

    toggle.type = 'button';
    toggle.setAttribute('data-blok-database-drawer-props-toggle', '');
    toggle.disabled = this.draft !== null;
    toggle.setAttribute('aria-expanded', String(this.draft !== null || !this.propsCollapsed));
    toggle.innerHTML = IconChevronDown;
    toggle.append(this.label('tools.database.propertiesSection'));
    toggle.addEventListener('click', () => {
      this.propsCollapsed = !this.propsCollapsed;
      toggle.setAttribute('aria-expanded', String(!this.propsCollapsed));
      const section = this.drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-props]');

      if (section !== null && section !== undefined) {
        section.hidden = this.propsCollapsed;
      }
    });

    return toggle;
  }

  /**
   * Header controls after close, in Notion's order (feel/findings-rowpage R03, R05):
   * expand | mode | previous, next, then Copy link, Page info, Favorite and "•••" at the end.
   */
  private createHeaderControls(): HTMLElement[] {
    const button = (attr: string, labelKey: string, icon: string, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement => {
      const el = document.createElement('button');

      el.type = 'button';
      el.setAttribute(attr, '');
      el.setAttribute('aria-label', this.label(labelKey));
      el.innerHTML = icon;
      el.addEventListener('click', () => onClick(el));

      return el;
    };
    const hinted = (el: HTMLButtonElement, labelKey: string): HTMLButtonElement => {
      onHover(el, this.label(labelKey));

      return el;
    };
    const separator = (): HTMLElement => {
      const el = document.createElement('span');

      el.setAttribute('data-blok-database-peek-separator', '');
      el.setAttribute('aria-hidden', 'true');

      return el;
    };

    return [
      hinted(button('data-blok-database-peek-expand', 'tools.database.peekExpand', IconExpandDiagonal, () => this.expand()), 'tools.database.peekExpand'),
      separator(),
      // No hint on mode, previous and next, as in Notion: their names are their aria-labels.
      button('data-blok-database-peek-mode', 'tools.database.settingsOpenPagesIn', IconPeekSide, (el) => this.openModeMenu(el)),
      separator(),
      button('data-blok-database-peek-prev', 'tools.database.peekPrevious', IconChevronDown, () => this.step(-1)),
      button('data-blok-database-peek-next', 'tools.database.peekNext', IconChevronDown, () => this.step(1)),
      this.buildCrumbs(),
      hinted(button('data-blok-database-peek-copy-link', 'tools.database.tableCopyLink', IconLink, () => this.copyLink()), 'tools.database.tableCopyLink'),
      // research/10 §10: shown only while the layout uses the details panel (syncPageInfo).
      button('data-blok-database-peek-page-info', 'tools.database.layoutPageInfo', IconSidebarRight, () => this.setDetailsOpen(!this.detailsOpen)),
      // research/21 §5: Favorite is a star right before "•••", not an item in its menu.
      this.favoriteButton(button),
      // research/09 §1b: "•••" ends the bar, in a peek too (side peek: 30-row-page-actions-menu.png).
      hinted(button('data-blok-database-peek-actions', 'tools.database.peekActionsHint', IconDotsHorizontal, (el) => this.openActionsMenu(el)), 'tools.database.peekActionsHint'),
    ];
  }

  /** A full page's "database / page" path (feel/findings-rowpage R17). The database crumb goes back. */
  private buildCrumbs(): HTMLElement {
    const crumbs = document.createElement('span');
    const database = document.createElement('button');
    const slash = document.createElement('span');
    const page = document.createElement('span');

    crumbs.setAttribute('data-blok-database-peek-crumbs', '');
    crumbs.hidden = true;
    database.type = 'button';
    database.setAttribute('data-blok-database-peek-crumb', 'database');
    database.addEventListener('click', () => this.close());
    slash.setAttribute('data-blok-database-peek-crumb-slash', '');
    slash.setAttribute('aria-hidden', 'true');
    slash.textContent = '/';
    page.setAttribute('data-blok-database-peek-crumb', 'page');
    crumbs.append(database, slash, page);

    return crumbs;
  }

  private syncCrumbs(): void {
    const crumbs = this.drawer?.querySelector<HTMLElement>('[data-blok-database-peek-crumbs]');

    if (crumbs === null || crumbs === undefined) return;
    crumbs.hidden = this.mode !== 'full';
    const database = crumbs.querySelector<HTMLElement>('[data-blok-database-peek-crumb="database"]');
    const page = crumbs.querySelector<HTMLElement>('[data-blok-database-peek-crumb="page"]');
    const title = this.drawer?.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]')?.value ?? '';

    if (database !== null) {
      const name = this.databaseTitle() || this.label('tools.database.titlePlaceholder');

      database.textContent = name;
      onHover(database, name);
    }
    if (page !== null) page.textContent = title;
  }

  private copyLink(): void {
    const rowId = this.currentRowId;

    if (rowId !== null) this.rowActions?.(rowId)?.onCopyLink();
  }

  /** Copy link copies through the row menu's lever, so it shows only where that menu has one. */
  private syncCopyLinkButton(): void {
    const rowId = this.currentRowId;

    this.drawer?.querySelector<HTMLElement>('[data-blok-database-peek-copy-link]')
      ?.toggleAttribute('hidden', rowId === null || this.rowActions?.(rowId) === undefined);
  }

  private favoriteButton(button: (attr: string, labelKey: string, icon: string, onClick: (el: HTMLButtonElement) => void) => HTMLButtonElement): HTMLButtonElement {
    const el = button('data-blok-database-peek-favorite', 'tools.database.peekFavorite', IconEmojiStar, () => {
      const rowId = this.currentRowId;

      if (rowId !== null) this.favorite?.(rowId)?.onToggle();
      // Re-ask the host: its answer, not a guess, sets the state.
      this.syncFavoriteButton();
    });

    return el;
  }

  /** Asks the host again; the row menu calls it too, since its toggle can change the open page's star. */
  public syncFavoriteButton(): void {
    const button = this.drawer?.querySelector<HTMLElement>('[data-blok-database-peek-favorite]');
    const rowId = this.currentRowId;
    const favorite = rowId === null ? undefined : this.favorite?.(rowId);

    const on = favorite?.on === true;

    button?.toggleAttribute('hidden', favorite === undefined);
    button?.setAttribute('aria-pressed', String(on));
    if (button === null || button === undefined) return;
    // research/22 §14: a filled star and the "Remove" hint once favorited.
    button.innerHTML = on ? IconStarFilled : IconEmojiStar;
    onHover(button, this.label(on ? 'tools.database.peekUnfavoriteHint' : 'tools.database.peekFavoriteHint'));
  }

  /** Shows the row before or after the open one, keeping the mode. */
  private step(direction: 1 | -1): void {
    const rowId = this.currentRowId;
    const next = rowId === null ? undefined : this.adjacentRow?.(rowId, direction);

    if (next !== undefined) {
      this.open(next);
    }
  }

  private syncStepButtons(): void {
    const rowId = this.currentRowId;

    (['prev', 'next'] as const).forEach((which) => {
      const el = this.drawer?.querySelector<HTMLButtonElement>(`[data-blok-database-peek-${which}]`);

      if (el !== null && el !== undefined) {
        el.disabled = rowId === null || this.adjacentRow?.(rowId, which === 'next' ? 1 : -1) === undefined;
      }
    });
  }

  private expand(): void {
    const rowId = this.currentRowId;

    if (rowId !== null && this.onExpand?.(rowId) === true) {
      return;
    }
    this.switchMode('full');
  }

  private switchMode(mode: OpenPagesIn): void {
    if (this.drawer !== null && mode !== this.mode) {
      this.applyMode(mode);
    }
  }

  /**
   * feel/findings-rowpage R19: titles only, 220 wide. A pick changes this peek only;
   * "Edit view default" opens the view's Layout settings, where the default lives.
   */
  private openModeMenu(anchor: HTMLElement): void {
    this.closeModeMenu();
    const editDefault = this.onEditViewDefault;
    const items: PopoverItemParams[] = (['side', 'center', 'full'] as const).map((mode) => ({
      type: PopoverItemType.Default,
      title: this.label(`tools.database.openPages${({ side: 'Side', center: 'Center', full: 'Full' } as const)[mode]}`),
      icon: PEEK_MODE_ICONS[mode],
      ...(mode === this.mode ? { trailingIcon: IconCheck } : {}),
      closeOnActivate: true,
      // A full page goes to the host's page when it has one, as the expand button does.
      onActivate: () => (mode === 'full' ? this.expand() : this.switchMode(mode)),
    }));
    const menu = new PopoverDesktop({
      // Notion's 28px rows.
      class: DATABASE_HEADER_MENU_CLASS,
      trigger: anchor,
      width: '220px',
      autoFocusFirstItem: false,
      items: editDefault === undefined || this.readOnly ? items : [
        ...items,
        { type: PopoverItemType.Separator },
        {
          type: PopoverItemType.Default,
          name: 'row-page-edit-view-default',
          title: this.label('tools.database.peekEditViewDefault'),
          icon: IconSliders,
          closeOnActivate: true,
          onActivate: () => editDefault(anchor),
        },
      ],
    });

    menu.on(PopoverEvent.Closed, () => {
      if (this.modeMenu === menu) {
        this.modeMenu = null;
        menu.destroy();
      }
    });
    this.modeMenu = menu;
    menu.show();
  }

  /** A row page's selected view tab opens a menu: Customize layout, Copy link to view, or both. */
  private get rowTabMenu(): boolean {
    return this.customizable || (!this.readOnly && this.onCopyViewLink !== undefined);
  }

  /**
   * The row page's view tab menu. Notion also has "Display as"; Blok has no per-tab icons.
   * Shares the mode menu's slot, so closing the page closes it too.
   */
  private openRowTabMenu(anchor: HTMLElement, tabId: string): void {
    this.closeModeMenu();
    const rowId = this.openRowId;
    const copyLink = this.onCopyViewLink;
    const menu = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '240px',
      items: [
        ...(this.customizable ? [{
          type: PopoverItemType.Default as const,
          name: 'row-tab-customize-layout',
          title: this.label('tools.database.layoutCustomize'),
          icon: IconPageLayout,
          closeOnActivate: true,
          onActivate: () => this.startCustomizing(),
        }] : []),
        ...(copyLink !== undefined && rowId !== null ? [{
          type: PopoverItemType.Default as const,
          name: 'row-tab-copy-link-to-view',
          title: this.label('tools.database.layoutCopyLinkToView'),
          icon: IconLink,
          closeOnActivate: true,
          onActivate: () => copyLink(rowId, tabId),
        }] : []),
      ],
    });

    menu.on(PopoverEvent.Closed, () => {
      anchor.setAttribute('aria-expanded', 'false');
      if (this.modeMenu === menu) {
        this.modeMenu = null;
        menu.destroy();
      }
    });
    this.modeMenu = menu;
    menu.show();
    anchor.setAttribute('aria-expanded', 'true');
  }

  /** The page's "•••" menu, in Notion's order (research/12, 15-row-page-actions.png). Shares the mode menu's slot. */
  private openActionsMenu(anchor: HTMLElement): void {
    this.closeModeMenu();
    const row = this.currentRow;
    const items = row === null ? [] : this.actionItems(row);

    if (items.length === 0) {
      return;
    }
    const menu = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '240px',
      autoFocusFirstItem: false,
      searchable: true,
      messages: { search: this.label('tools.database.searchActions') },
      items,
    });

    menu.on(PopoverEvent.Closed, () => {
      anchor.setAttribute('aria-expanded', 'false');
      if (this.modeMenu === menu) {
        this.modeMenu = null;
        menu.destroy();
      }
    });
    this.modeMenu = menu;
    menu.show();
    anchor.setAttribute('aria-expanded', 'true');
  }

  private actionItems(row: DatabaseRow): PopoverItemParams[] {
    const actions = this.rowActions?.(row.id);
    const rowItems = actions === undefined ? [] : rowActionItems({ ...actions, i18n: { t: (key: string) => this.label(key) } }, { trashShortcut: false });
    const pageItems: PopoverItemParams[] = [
      ...(!this.readOnly && this.onFullWidthChange !== undefined ? [this.fullWidthItem(row)] : []),
      ...(this.customizable ? [{
        type: PopoverItemType.Default as const,
        name: 'row-page-customize-layout',
        title: this.label('tools.database.layoutCustomize'),
        icon: IconPageLayout,
        closeOnActivate: true,
        onActivate: () => this.startCustomizing(),
      }] : []),
    ];

    return rowItems.length > 0 && pageItems.length > 0
      ? [...rowItems, { type: PopoverItemType.Separator }, ...pageItems]
      : [...rowItems, ...pageItems];
  }

  /** A switch: the page's own Full width, or the layout's while the page has none (research/09 §9). */
  private fullWidthItem(row: DatabaseRow): PopoverItemParams {
    // A named literal with onActivate: the agent-coverage scan lists menu items by that shape.
    const toggle = { name: 'database-row-full-width', onActivate: (on: boolean): void => this.setPageFullWidth(row.id, on) };

    return {
      type: PopoverItemType.Html,
      name: toggle.name,
      element: createHeadingToggle({ icon: IconPlayerTheater, label: this.label('tools.database.layoutFullWidth'), isActive: this.pageFullWidth(row), onToggle: toggle.onActivate }),
    };
  }

  /** The page's own value wins; a page without one follows the layout. */
  private pageFullWidth(row: DatabaseRow): boolean {
    return row.fullWidth ?? pageLayoutOf(this.schema.find((p) => p.type === 'title')).fullWidth;
  }

  /** Back at the layout's width, the page drops its own value and follows later layout changes again. */
  private setPageFullWidth(rowId: string, on: boolean): void {
    const layout = pageLayoutOf(this.schema.find((p) => p.type === 'title')).fullWidth;

    this.onFullWidthChange?.(rowId, on === layout ? null : on);
  }

  /** Only a full page widens; the CSS leaves both peeks alone (research/09 §9). */
  private syncFullWidth(row: DatabaseRow): void {
    this.drawer?.toggleAttribute('data-full-width', this.pageFullWidth(row));
  }

  private syncActionsButton(): void {
    const button = this.drawer?.querySelector<HTMLElement>('[data-blok-database-peek-actions]');
    const row = this.currentRow;

    button?.toggleAttribute('hidden', row === null || (this.rowActions?.(row.id) === undefined && (this.readOnly || this.onFullWidthChange === undefined) && !this.customizable));
  }

  private closeModeMenu(): void {
    const menu = this.modeMenu;

    this.modeMenu = null;
    menu?.destroy();
  }

  /**
   * Side: a complementary panel at the inline end, the page beside it inset.
   * Center: a modal over a backdrop, with no open animation (research/08).
   * Full: the page takes the database's place; its close button reads "Back".
   */
  private applyMode(mode: OpenPagesIn): void {
    const drawer = this.drawer;

    this.mode = mode;
    if (drawer === null) {
      return;
    }
    drawer.setAttribute('data-peek-mode', mode);
    drawer.setAttribute('role', ({ side: 'complementary', center: 'dialog', full: 'region' } as const)[mode]);
    drawer.toggleAttribute('aria-modal', false);
    if (mode === 'center') {
      drawer.setAttribute('aria-modal', 'true');
    }
    this.wrapper.toggleAttribute('data-blok-database-full-page', mode === 'full');

    if (mode === 'center') {
      this.ensureBackdrop(drawer);
    } else {
      this.removeBackdrop();
    }
    // Peeks go to the top layer, above host chrome and out of any transformed ancestor's containing block.
    if (mode === 'full') {
      removeFromTopLayer(drawer);
    } else if (!isPromotedToTopLayer(drawer)) {
      promoteToTopLayer(drawer);
    }
    if (mode === 'side' && drawer.hasAttribute('data-open')) {
      this.narrowPeekHost();
    }
    if (mode !== 'side') {
      this.releasePeekHost();
    }

    const close = drawer.querySelector<HTMLElement>('[data-blok-database-drawer-close]');

    if (close !== null) {
      close.innerHTML = mode === 'full' ? IconChevronLeft : IconChevronDoubleRight;
      close.setAttribute('aria-label', this.label(mode === 'full' ? 'tools.database.peekBack' : 'tools.database.close'));
      // Notion's center peek has no close button: Escape and the backdrop close it (R18).
      close.hidden = mode === 'center';
      // "Close · Esc" (R06); a full page's Back has no shortcut.
      onHover(close, mode === 'full' ? this.label('tools.database.peekBack') : createTooltipContent([[
        { text: this.label('tools.database.close'), highlight: true },
        { text: ' ', highlight: false },
        { text: 'Esc', highlight: false, direction: 'ltr' },
      ]]));
    }
    const modeButton = drawer.querySelector<HTMLElement>('[data-blok-database-peek-mode]');

    if (modeButton !== null) modeButton.innerHTML = PEEK_MODE_ICONS[mode];
    // The title is 40px on a full page and in the center peek, 32px in the side peek.
    const titleInput = drawer.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    if (titleInput !== null) this.autoResizeTitle(titleInput);
    // A full page has no mode switcher and no row steps (R17).
    drawer.querySelectorAll<HTMLElement>('[data-blok-database-peek-mode], [data-blok-database-peek-separator], [data-blok-database-peek-prev], [data-blok-database-peek-next]')
      .forEach((el) => el.toggleAttribute('hidden', mode === 'full'));
    this.syncCrumbs();
    this.syncCopyLinkButton();
    drawer.querySelector<HTMLElement>('[data-blok-database-peek-expand]')?.toggleAttribute('hidden', mode === 'full');
    drawer.querySelector<HTMLElement>('[data-blok-database-peek-resize]')?.toggleAttribute('hidden', mode !== 'side');
    this.syncStepButtons();
    this.syncActionsButton();
    this.syncFavoriteButton();
    this.syncDetailsDock();
  }

  private ensureBackdrop(drawer: HTMLElement): void {
    if (this.backdrop === null) {
      const backdrop = document.createElement('div');

      backdrop.setAttribute('data-blok-database-peek-backdrop', '');
      this.backdrop = backdrop;
    }
    drawer.before(this.backdrop);
    if (isPromotedToTopLayer(this.backdrop)) {
      return;
    }
    // The top layer stacks in show order: the peek leaves it and comes back above the backdrop.
    removeFromTopLayer(drawer);
    promoteToTopLayer(this.backdrop);
  }

  private removeBackdrop(): void {
    this.backdrop?.remove();
    this.backdrop = null;
  }

  /** Row whose holder the drawer shows as the page body, or null. */
  get bodyRowId(): string | null {
    return this.attachedBodyRowId ?? this.leavingBodyRowId;
  }

  /** Id of the row the drawer shows, or null when closed. */
  get openRowId(): string | null {
    return this.drawer === null ? null : this.currentRowId;
  }

  /** Shows a view tab (a link to it). An id with no tab shows Content, as a tab gone for now does. */
  showTab(tabId: string): void {
    this.activeTab = tabId;
    this.rerender();
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
   * Marks the open page as a template being edited: a banner above the page
   * head, as Notion shows, with its "Duplicate every…" button when `repeat`
   * is given. A banner already shown is updated in place, so a popover
   * anchored on the button stays put. Null takes it away.
   */
  setTemplateBanner(banner: { text: string; repeat?: { label: string; open: (anchor: HTMLElement) => void } } | null): void {
    const content = this.drawer?.querySelector('[data-blok-database-drawer-content]');
    const shown = content?.querySelector<HTMLElement>('[data-blok-database-template-banner]');

    if (content === null || content === undefined || banner === null) {
      shown?.remove();
      this.templateRepeatOpen = null;

      return;
    }
    const el = shown ?? document.createElement('div');
    const existingText = el.querySelector('[data-blok-database-template-banner-text]');
    const text = existingText ?? document.createElement('span');

    // Writes only on change: a rewritten status region is read out again on every sync.
    if (existingText === null) {
      text.setAttribute('data-blok-database-template-banner-text', '');
      text.setAttribute('role', 'status');
      el.setAttribute('data-blok-database-template-banner', '');
      el.prepend(text);
    }
    if (text.textContent !== banner.text) text.textContent = banner.text;
    this.templateRepeatOpen = banner.repeat?.open ?? null;
    const existing = el.querySelector<HTMLButtonElement>('[data-blok-database-template-repeat]');

    if (banner.repeat === undefined) {
      existing?.remove();
    } else {
      const button = existing ?? document.createElement('button');

      if (existing === null) {
        button.type = 'button';
        button.setAttribute('data-blok-database-template-repeat', '');
        button.setAttribute('aria-haspopup', 'menu');
        button.addEventListener('click', () => this.templateRepeatOpen?.(button));
        // No whitespace text in the icon: the button's text is its label alone.
        button.append(document.createElement('span'), Object.assign(document.createElement('span'), { innerHTML: IconChevronDown.replace(/>\s+</g, '><').trim() }));
        button.lastElementChild?.setAttribute('data-blok-database-template-repeat-chevron', '');
        el.append(button);
      }
      const label = button.firstElementChild;

      if (label !== null && label.textContent !== banner.repeat.label) label.textContent = banner.repeat.label;
    }
    if (shown === null || shown === undefined) content.prepend(el);
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
    this.syncFullWidth(row);

    const titleInput = this.drawer.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');
    const title = (row.properties[this.titlePropertyId] as string | undefined) ?? '';

    if (titleInput !== null && titleInput.value !== title) {
      const { selectionStart, selectionEnd } = titleInput;

      titleInput.value = title;
      titleInput.setSelectionRange(Math.min(selectionStart, title.length), Math.min(selectionEnd, title.length));
      this.autoResizeTitle(titleInput);
    }

    this.refreshSchema(this.schema);
    this.drawer.querySelector('[data-blok-database-drawer-page-head]')?.replaceWith(this.buildPageHead(row));
    this.syncCrumbs();

    if (this.attachedBodyRowId === row.id) {
      return;
    }

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

    if (this.drawer !== null || this.placeholder !== null) {
      this.rerender();
    }
  }

  /**
   * Builds a `[data-blok-database-drawer-props]` section: the property group,
   * its loose properties first, then each named section.
   */
  private buildPropsSection(layout: ResolvedPageLayout, row: DatabaseRow, foldable = true): HTMLDivElement {
    const propsSection = document.createElement('div');

    propsSection.setAttribute('data-blok-database-drawer-props', '');

    propsSection.hidden = foldable && this.draft === null && this.propsCollapsed;
    // While customizing, the eye's draft value hides at once (research/09 §5).
    const hidden = (def: PropertyDefinition): boolean =>
      !isShownOnPage({ ...def, pageVisibility: this.pageVisibility(def.id) }, readPropertyValue(row, def) ?? null);
    const expanded = this.draft === null && this.showHiddenProps;
    const shown = (def: PropertyDefinition): boolean => expanded || !hidden(def);
    const hiddenCount = [...layout.group, ...layout.sections.flatMap((s) => s.properties)].filter(hidden).length;

    for (const def of layout.group.filter(shown)) {
      propsSection.appendChild(this.createPropertyRow(def, readPropertyValue(row, def) ?? null));
    }
    for (const { section, properties } of layout.sections) {
      propsSection.appendChild(this.buildSection(section.id, section.name, properties.filter(shown), row));
    }

    // Notion gathers hidden properties into one item at the bottom; a click shows them, another folds them back.
    // In the builder it does not expand (research/09 §5 L75).
    if (hiddenCount > 0) {
      const reveal = document.createElement('button');
      const [one, many] = expanded
        ? ['tools.database.layoutHideMorePropertiesOne', 'tools.database.layoutHideMoreProperties']
        : ['tools.database.layoutMorePropertiesOne', 'tools.database.layoutMoreProperties'];
      const key = hiddenCount === 1 ? one : many;

      reveal.type = 'button';
      reveal.setAttribute('data-blok-database-drawer-hidden-props', '');
      reveal.setAttribute('aria-expanded', String(expanded));
      reveal.disabled = this.draft !== null;
      reveal.textContent = this.label(key).replace('{count}', String(hiddenCount));
      reveal.addEventListener('click', () => {
        this.showHiddenProps = !this.showHiddenProps;
        this.refreshSchema(this.schema);
      });
      propsSection.appendChild(reveal);
    }

    // research/09 §1: a property group with nothing in it reads "Empty" in the builder.
    if (this.draft !== null && layout.group.length === 0 && layout.sections.length === 0) {
      const empty = document.createElement('div');

      empty.setAttribute('data-blok-database-layout-group-empty', '');
      empty.textContent = this.label('tools.database.cellEmpty');
      propsSection.appendChild(empty);
    }

    if (!this.readOnly) {
      const addBtn = document.createElement('button');

      addBtn.setAttribute('data-blok-database-drawer-add-prop', '');
      // R13: a plus glyph replaces the "+ " every locale's label starts with; the builder still shows the label as is.
      addBtn.innerHTML = IconPlus;
      addBtn.append(this.t('tools.database.addProperty').replace(/^\+\s*/, ''));
      addBtn.addEventListener('click', () => this.openAddProperty(addBtn, null));
      propsSection.appendChild(addBtn);
    }

    return propsSection;
  }

  /**
   * "+ Add a property". From a builder menu the new property goes first among the
   * pins or at the top of the group, as a draft edit; the property itself is written at once.
   */
  private openAddProperty(anchor: HTMLElement, place: AddedPlace | null): void {
    if (this.onOpenAddProperty !== undefined) {
      this.onOpenAddProperty(anchor, place !== null || this.draft !== null ? (id) => this.addedWhileCustomizing(id, place) : undefined);

      return;
    }
    this.nextAddedPlace = place;
    if (this.propertyTypePopover === null) {
      this.propertyTypePopover = new DatabasePropertyTypePopover({
        onSelect: (type, name) => {
          const before = new Set(this.schema.map((p) => p.id));

          this.onAddProperty?.(type, name);
          // onAddProperty refreshes the schema synchronously, so the new property is there now.
          const added = this.schema.find((p) => !before.has(p.id));

          if (added !== undefined) this.addedWhileCustomizing(added.id, this.nextAddedPlace);
          this.propertyTypePopover?.close();
        },
        i18n: this.i18n,
        hasPeople: this.hasPeople,
        withNameField: true,
      });
    }

    this.propertyTypePopover.open(anchor);
  }

  private addedWhileCustomizing(id: string, place: AddedPlace | null): void {
    if (typeof place === 'object' && place !== null) {
      // A section's own add on the row page writes at once, like the property itself.
      if (this.draft === null) {
        this.onPageLayoutChange?.(sectionFirst(id, place.sectionId));
      } else {
        this.draft.madeProperties.push(id);
        this.editLayout(sectionFirst(id, place.sectionId));
      }

      return;
    }
    this.draft?.madeProperties.push(id);
    // research/10 §7 and research/09 §3 L57.
    if (place === 'pin') this.editLayout(pinFirst(id));
    if (place === 'group') this.editLayout(groupFirst(id));
    // A relation made from "Add to panel" stays in the group: it cannot sit in the panel.
    if (place === 'page' || place === 'panel') this.editLayout(addModule(id, place, this.schema.find((def) => def.id === id)));
  }

  /** A property's page visibility, with the open draft's eye edit if any. */
  private pageVisibility(id: string): PageVisibility {
    return this.draft?.visibility.get(id) ?? this.schema.find((def) => def.id === id)?.pageVisibility ?? 'always';
  }

  /** An eye edit. Setting the saved value back drops the edit. */
  private setPageVisibility(id: string, visibility: PageVisibility): void {
    if (this.draft === null) return;
    if (visibility === (this.schema.find((def) => def.id === id)?.pageVisibility ?? 'always')) {
      this.draft.visibility.delete(id);
    } else {
      this.draft.visibility.set(id, visibility);
    }
    this.rerender();
  }

  /**
   * A named section of the property group. On the row page its header folds it
   * (this viewer's own) and it ends with its own "+ Add a property" (research/10
   * §2b). In the builder the header is only its name: a click opens the group's
   * menu, and an empty section reads "Empty" (research/10 §3).
   */
  private buildSection(id: string, name: string, properties: PropertyDefinition[], row: DatabaseRow): HTMLElement {
    const section = document.createElement('div');
    const header = document.createElement('div');
    const body = document.createElement('div');
    const collapsed = this.draft === null && this.isSectionFolded(id);

    section.setAttribute('data-blok-database-drawer-section', '');
    section.setAttribute('data-section-id', id);
    header.setAttribute('data-blok-database-drawer-section-header', '');
    body.setAttribute('data-blok-database-drawer-section-body', '');
    body.hidden = collapsed;

    if (this.draft !== null) {
      const label = document.createElement('span');

      label.setAttribute('data-blok-database-drawer-section-name', '');
      label.textContent = name;
      header.innerHTML = IconChevronDown;
      header.appendChild(label);
    } else {
      const toggle = document.createElement('button');

      toggle.type = 'button';
      toggle.setAttribute('data-blok-database-drawer-section-toggle', '');
      toggle.setAttribute('data-section-id', id);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.innerHTML = IconChevronDown;
      toggle.append(name);
      toggle.addEventListener('click', () => {
        const open = body.hidden;

        body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        this.setSectionFolded(id, !open);
      });
      header.appendChild(toggle);
    }
    for (const def of properties) {
      body.appendChild(this.createPropertyRow(def, readPropertyValue(row, def) ?? null));
    }
    if (this.draft !== null && properties.length === 0) {
      const empty = document.createElement('div');

      empty.setAttribute('data-blok-database-layout-section-empty', '');
      empty.textContent = this.label('tools.database.cellEmpty');
      body.appendChild(empty);
    }
    if (this.draft === null && !this.readOnly) {
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-drawer-section-add', '');
      add.textContent = this.label('tools.database.addProperty');
      add.addEventListener('click', () => this.openAddProperty(add, { sectionId: id }));
      body.appendChild(add);
    }
    section.append(header, body);

    return section;
  }

  private sectionFoldKey(id: string): string | null {
    return this.databaseId === undefined ? null : `blok:database-section-fold:${this.databaseId}:${id}`;
  }

  private isSectionFolded(id: string): boolean {
    const stored = readStorage(this.sectionFoldKey(id));

    return stored === null ? this.collapsedSections.has(id) : stored === '1';
  }

  private setSectionFolded(id: string, folded: boolean): void {
    const key = this.sectionFoldKey(id);

    if (folded) {
      this.collapsedSections.add(id);
    } else {
      this.collapsedSections.delete(id);
    }
    if (key === null) return;
    try {
      if (folded) {
        window.localStorage.setItem(key, '1');
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Blocked storage: the session set still holds it.
    }
  }

  // ─── Page layout ───

  private get customizable(): boolean {
    return !this.readOnly && this.onPageLayoutChange !== undefined && !this.databaseLocked();
  }

  /** The saved layout, with an open draft's edits replayed on top. */
  /** The saved layout, with the draft applied while customizing. */
  private draftLayout(): PageLayoutData {
    const saved = pageLayoutOf(this.schema.find((p) => p.type === 'title'));

    return this.draft === null ? saved : applyDraft(this.draft, saved);
  }

  private resolvedLayout(): ResolvedPageLayout {
    return resolvePageLayout(this.draftLayout(), this.getRenderableSchema());
  }

  /**
   * Draws every layout region between the title and the body divider. With no
   * layout the regions are the "Properties" toggle and the property group.
   */
  private renderRegions(row: DatabaseRow): void {
    const content = this.drawer?.querySelector('[data-blok-database-drawer-content]') ?? null;
    const divider = content?.querySelector<HTMLElement>(':scope > hr') ?? null;

    // The saved layout, not the draft: Full width never changes the builder (research/09 §9).
    this.syncFullWidth(row);
    this.syncBuilder();
    const builder = this.builder;

    // The placeholder draws into the builder only: there is no page behind it.
    if (builder === null && (content === null || divider === null)) {
      return;
    }
    // Before its panel goes: the shown view's database holder goes back to its tab.
    this.layoutTabs?.detach();
    content?.querySelectorAll(':scope > [data-blok-database-drawer-region]').forEach((el) => el.remove());
    this.drawer?.removeAttribute('data-details-open');
    this.stopWatchingPins();
    const layout = this.resolvedLayout();

    this.propertyIcons = layout.propertyIcons;
    this.propertyLabels = this.draftLayout().propertyLabels;
    const regions: HTMLElement[] = [];
    const tabs = layout.structure === 'tabbed' ? this.viewTabs() : null;

    // A tab that is gone for now (undo, a peer) shows Content; the choice is kept for when it is back.
    this.shownTab = tabs !== null && tabs.views.some((tab) => tab.id === this.activeTab) ? this.activeTab : 'content';
    const pins = layout.heading.length > 0 || this.draft !== null ? this.buildPinsRow(layout.heading, row) : null;

    if (pins !== null) {
      regions.push(pins);
    }
    if (tabs !== null) {
      regions.push(this.buildTabs(tabs));
    }
    const onContent = this.shownTab === 'content';

    if (divider !== null) {
      divider.hidden = !onContent;
    }
    const editor = content?.querySelector<HTMLElement>(':scope > [data-blok-database-drawer-editor]');

    if (editor !== null && editor !== undefined) {
      editor.hidden = !onContent;
    }
    const panel = onContent ? null : this.tabPanel();

    if (panel !== null) {
      regions.push(panel);
    }
    // The builder draws the group and the modules into their own cards (fillBuilder).
    if (onContent && builder === null) {
      // R11: Notion names the group "Properties" only once the layout has sections (research/09 §3).
      const group = layout.sections.length > 0 ? [this.buildPropsToggle(), this.buildPropsSection(layout, row)] : [this.buildPropsSection(layout, row, false)];
      const page: HTMLElement[] = layout.groupIn === 'page' ? group : [];

      if (layout.pageModules.length > 0) {
        page.push(this.moduleList('data-blok-database-drawer-modules', 'page', layout.pageModules, row));
      }
      if (layout.groupIn === 'panel' || layout.panelModules.length > 0) {
        // The panel's "Properties" header names the group, so it has no fold of its own there.
        const [toggle, panel] = this.buildDetails(layout, layout.groupIn === 'panel' ? [this.buildPropsSection(layout, row, false)] : [], row);

        regions.push(toggle, page.length > 0 ? this.buildColumns(page, panel) : panel);
      } else {
        regions.push(...page);
      }
    }
    for (const region of regions) {
      region.setAttribute('data-blok-database-drawer-region', '');
    }
    if (builder !== null) {
      this.fillBuilder(builder, layout, row, regions);
    } else if (content !== null && divider !== null) {
      for (const region of regions) content.insertBefore(region, divider);
    }
    // Comments sit under the properties, on the content tab (research/10 §128, §168).
    const comments = content?.querySelector<HTMLElement>(':scope > [data-blok-database-comments-section]');

    if (comments !== null && comments !== undefined && divider !== null) {
      content?.insertBefore(comments, divider);
      comments.hidden = !onContent;
    }
    // Once the panel is in the page: the tab's database renders where it is shown.
    if (panel !== null) {
      this.layoutTabs?.attach(this.shownTab, panel, row.id);
    }
    this.syncPageInfo();
    this.syncDetailsDock();
  }

  /** "Page info" shows only when the page has a details panel, outside Customize layout. Its target is redrawn each render. */
  private syncPageInfo(): void {
    const info = this.drawer?.querySelector<HTMLButtonElement>('[data-blok-database-peek-page-info]');
    const panel = this.drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-content] [data-blok-database-drawer-details]');

    if (info === null || info === undefined) {
      return;
    }
    info.hidden = this.draft !== null || panel === null || panel === undefined;
    info.setAttribute('aria-expanded', String(!info.hidden && this.detailsOpen));
    if (panel !== null && panel !== undefined) {
      info.setAttribute('aria-controls', panel.id);
    } else {
      info.removeAttribute('aria-controls');
    }
  }

  /** The one way the details panel opens or closes: View details, Page info and Close panel all land here. */
  private setDetailsOpen(open: boolean): void {
    const drawer = this.drawer;
    const panel = drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-content] [data-blok-database-drawer-details]');
    const toggle = drawer?.querySelector<HTMLElement>('[data-blok-database-drawer-content] [data-blok-database-drawer-details-toggle]');

    if (drawer === null || drawer === undefined || this.draft !== null || panel === null || panel === undefined) {
      return;
    }
    this.detailsOpen = open;
    panel.hidden = !open;
    drawer.toggleAttribute('data-details-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    const text = toggle?.querySelector('[data-blok-database-drawer-details-label]');

    if (text !== null && text !== undefined) {
      text.textContent = this.detailsLabel(open);
    }
    this.syncPageInfo();
    this.syncDetailsDock();
  }

  /** "View details" / "Hide details" (research/10 §10). It follows the viewer's state: the builder always reads "View details". */
  private detailsLabel(open: boolean): string {
    return this.label(open ? 'tools.database.layoutHideDetails' : 'tools.database.layoutViewDetails');
  }

  /**
   * The builder draws each module apart: pins, tabs and "View details" in the
   * Heading (research/10 §8 L172), the group, and one card per page or panel
   * module (research/09 anatomy L39-40).
   */
  private fillBuilder(builder: PageLayoutBuilder, layout: ResolvedPageLayout, row: DatabaseRow, regions: HTMLElement[]): void {
    const title = document.createElement('h1');
    const name = (row.properties[this.titlePropertyId] as string | undefined) ?? '';
    const body: HTMLElement[] = [];
    const onContent = this.shownTab === 'content';
    const heading = [title, ...regions.filter((region) => region.matches('[data-blok-database-drawer-pins-row], [data-blok-database-drawer-tabs], [data-blok-database-drawer-tab-panel]'))];
    const entry = (def: PropertyDefinition): PageLayoutModuleEntry => ({ def, element: this.createPropertyRow(def, readPropertyValue(row, def) ?? null) });

    // research/09 §6: the builder always shows the count, "No backlinks" at zero.
    const backlinks = document.createElement('div');
    const icon = document.createElement('span');

    backlinks.setAttribute('data-blok-database-layout-backlinks', '');
    icon.setAttribute('data-blok-database-backlinks-icon', '');
    icon.append(iconNode(IconArrowDiagonal));
    backlinks.append(icon, this.backlinksLabel(this.placeholder === null ? mentionCount(this.backlinks?.(row.id) ?? []) : 0));
    heading.unshift(backlinks);
    title.setAttribute('data-blok-database-layout-canvas-title', '');
    title.textContent = name.trim() !== '' ? name : this.label('tools.database.layoutNewPage');
    title.toggleAttribute('data-placeholder', name.trim() === '');
    if (onContent && (layout.groupIn === 'panel' || layout.panelModules.length > 0)) {
      heading.push(this.buildDetails(layout, [], row)[0]);
    }
    // research/09 §1: the placeholder page's Content reads "Empty".
    if (this.placeholder !== null) {
      const empty = document.createElement('div');

      empty.setAttribute('data-blok-database-layout-canvas-content', '');
      empty.textContent = this.label('tools.database.cellEmpty');
      body.push(empty);
    }
    builder.fill({
      heading,
      group: onContent ? [this.buildPropsToggle(), this.buildPropsSection(layout, row)] : [],
      page: onContent ? layout.pageModules.map(entry) : [],
      panel: onContent ? layout.panelModules.map(entry) : [],
      content: body,
    });
  }

  /**
   * The details panel docks at the window's edge on a full page and inside the
   * center peek's modal (research/09 §9). The full page narrows so the panel
   * does not cover it; the center panel starts below the peek's toolbar.
   */
  private syncDetailsDock(): void {
    const drawer = this.drawer;

    if (drawer === null) {
      return;
    }
    this.syncPeekWidening(drawer);
    drawer.style.removeProperty('padding-inline-end');
    const toolbar = drawer.querySelector<HTMLElement>('[data-blok-database-drawer-toolbar]');

    drawer.style.setProperty('--_blok-peek-toolbar-size', `${toolbar?.offsetHeight ?? 0}px`);
    if (this.mode !== 'full' || !drawer.hasAttribute('data-details-open')) {
      return;
    }
    const rect = drawer.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const covered = getElementDirection(drawer) === 'rtl'
      ? DETAILS_DOCK_WIDTH - rect.left
      : rect.right - (viewport - DETAILS_DOCK_WIDTH);

    if (covered > 0) {
      drawer.style.paddingInlineEnd = `${covered + DETAILS_DOCK_GAP}px`;
    }
  }

  /**
   * Content, then the view tabs of the layout tabs block, with the draft's
   * deletes and renames. With no block yet Content stands alone.
   */
  private viewTabs(): { contentId: string | null; content: string; views: LayoutTab[] } {
    const all = this.layoutTabs?.list() ?? [];
    const first = all.find((tab) => !tab.view);
    const title = (tab: LayoutTab): string => this.tabDraft.titles.get(tab.id) ?? tab.title;
    const content = first === undefined ? '' : title(first);
    const views = all.filter((tab) => tab.view && !this.tabDraft.removed.has(tab.id));
    const byId = new Map(views.map((tab) => [tab.id, tab]));
    const order = this.tabDraft.order;
    const ordered = order === null ? views : inTabOrder(views.map((tab) => tab.id), order).flatMap((id) => byId.get(id) ?? []);

    return {
      contentId: first?.id ?? null,
      content: content !== '' ? content : this.label('tools.database.layoutContentTab'),
      views: ordered.map((tab) => ({ ...tab, title: title(tab) })),
    };
  }

  private buildTabs(tabs: { contentId: string | null; content: string; views: LayoutTab[] }): HTMLElement {
    const bar = document.createElement('div');
    const builder = this.builder;
    const editable = builder !== null && this.layoutTabs?.canEdit() === true;

    const list = document.createElement('div');

    bar.setAttribute('data-blok-database-drawer-tabs', '');
    // The tablist owns only tabs: Add tab sits beside it, in the bar.
    list.setAttribute('role', 'tablist');
    bar.appendChild(list);
    const tab = (id: string, text: string): HTMLButtonElement => {
      const el = document.createElement('button');

      el.type = 'button';
      el.setAttribute('role', 'tab');
      el.setAttribute('data-tab-id', id);
      el.setAttribute('aria-selected', String(this.shownTab === id));
      el.tabIndex = this.shownTab === id ? 0 : -1;
      el.textContent = text;
      // On a row page the selected view tab opens its menu.
      if (builder === null && id !== 'content' && this.shownTab === id && this.rowTabMenu) {
        el.setAttribute('aria-haspopup', 'menu');
        el.setAttribute('aria-expanded', 'false');
      }
      el.addEventListener('click', () => {
        // research/10 §2: clicking the selected tab in the builder opens its menu.
        if (editable && this.shownTab === id) {
          builder.openTabMenu(el, { id, title: text, content: id === 'content' }, this.builderTabs());

          return;
        }
        // research/11 §4, research/13 §3b: on a row page the selected view tab opens its own menu.
        if (builder === null && id !== 'content' && this.shownTab === id && this.rowTabMenu) {
          this.openRowTabMenu(el, id);

          return;
        }
        this.activeTab = id;
        this.rerender();
        (this.builder?.element ?? this.drawer)?.querySelector<HTMLElement>(`[data-blok-database-drawer-tabs] [data-tab-id="${CSS.escape(id)}"]`)?.focus();
      });
      el.addEventListener('keydown', (event) => {
        const step = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[event.key];

        if (step === undefined) return;
        event.preventDefault();
        // Tabs folded into "N more…" are hidden and out of the arrow order.
        const all = [...bar.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((tab) => !tab.hidden);
        const rtl = getElementDirection(bar) === 'rtl' ? -1 : 1;

        all[(all.indexOf(el) + step * rtl + all.length) % all.length]?.click();
      });

      return el;
    };

    list.append(tab('content', tabs.content), ...tabs.views.map((view) => tab(view.id, view.title)));
    if (editable) {
      bar.appendChild(builder.addTabButton(this.builderTabs()));
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.tabsObserver?.disconnect();
      this.tabsObserver = new ResizeObserver(() => this.fitTabs(bar, list, editable));
      this.tabsObserver.observe(bar);
    }

    return bar;
  }

  /** The builder's view tab edits. Made tabs write at once; saved ones wait for Apply. */
  private builderTabs(): BuilderTabs {
    return {
      sources: () => this.layoutTabs?.sources() ?? [],
      related: () => this.layoutTabs?.related() ?? [],
      thisDatabase: () => this.databaseTitle(),
      propertyNames: (sourceId) => this.layoutTabs?.propertyNames?.(sourceId) ?? [],
      addRelated: (propertyId) => this.addedTab(this.layoutTabs?.addRelated(propertyId) ?? null),
      add: (sourceId, name) => this.addedTab(this.layoutTabs?.add(sourceId, name) ?? null),
      canRelate: (sourceId) => this.layoutTabs?.canRelate(sourceId) ?? false,
      duplicate: (tabId) => {
        const tabs = this.viewTabs().views;
        const name = tabs.find((tab) => tab.id === tabId)?.title ?? '';
        const taken = new Set(tabs.map((tab) => tab.title));
        // One pass with a function: a name's own "$&" or "{count}" stays literal.
        // Notion's "Roadmap (1)": the same in every language, so no translated string.
        const copyName = (count: number): string => `${name} (${count})`;
        // research/13 §3c: " (1)", then the lowest number not shown yet.
        const count = Array.from({ length: tabs.length + 1 }, (_, i) => i + 1).find((n) => !taken.has(copyName(n))) ?? tabs.length + 1;

        this.addedTab(this.layoutTabs?.duplicate(tabId, copyName(count)) ?? null);
      },
      addWithRelation: (sourceId, name, relatedName) => {
        const added = this.layoutTabs?.addWithRelation(sourceId, name, relatedName) ?? null;

        if (added !== null) this.tabDraft.relations.push(added.propertyId);
        this.addedTab(added);
      },
      rename: (tabId, title) => {
        const id = tabId === 'content' ? this.contentTabId() : tabId;

        if (id === null) return;
        if (this.tabDraft.fresh.has(id)) {
          this.layoutTabs?.renameMade(id, title);
        } else {
          this.tabDraft.titles.set(id, title);
        }
        this.rerender();
      },
      remove: (tabId, name) => {
        if (this.tabDraft.fresh.has(tabId)) {
          this.layoutTabs?.discard([tabId]);
          this.tabDraft.made = this.tabDraft.made.filter((id) => id !== tabId);
          this.tabDraft.fresh.delete(tabId);
        } else {
          this.tabDraft.removed.add(tabId);
        }
        this.activeTab = 'content';
        this.rerender();
        this.layoutTabs?.notify(this.label('tools.database.layoutViewDeleted').replace('{name}', () => name));
      },
    };
  }

  /** A view tab dropped between two others in "N more…"; it waits for Apply like a rename. */
  private reorderTab(id: string, afterId: string | null, beforeId: string | null): void {
    const order = this.viewTabs().views.map((tab) => tab.id).filter((each) => each !== id);
    const before = beforeId === null ? 0 : order.indexOf(beforeId);
    const at = afterId === null ? before : order.indexOf(afterId) + 1;

    order.splice(Math.max(0, at), 0, id);
    // The saved order again: no edit, so Cancel does not ask.
    const saved = (this.layoutTabs?.list() ?? []).filter((tab) => tab.view && !this.tabDraft.removed.has(tab.id)).map((tab) => tab.id);

    this.tabDraft.order = order.join('\n') === saved.join('\n') ? null : order;
  }

  /** A tab made in the draft: Discard deletes it, and it is selected (research/10 §2). */
  private addedTab(added: { tabId: string; made: string; contentId: string | null } | null): void {
    if (added === null) return;
    this.tabDraft.made.push(added.made);
    this.tabDraft.fresh.add(added.tabId);
    if (added.contentId !== null) this.tabDraft.fresh.add(added.contentId);
    this.activeTab = added.tabId;
    this.rerender();
  }

  /** The Content tab's block, made now when there is none (a rename needs one). */
  private contentTabId(): string | null {
    const first = this.layoutTabs?.list().find((tab) => !tab.view);

    if (first !== undefined) return first.id;
    const made = this.layoutTabs?.ensure() ?? null;

    if (made === null) return null;
    this.tabDraft.made.push(made.made);
    this.tabDraft.fresh.add(made.contentId);

    return made.contentId;
  }

  /** The open view tab's panel. The tool moves the tab's database holder into it. */
  private tabPanel(): HTMLElement {
    const panel = document.createElement('div');

    panel.setAttribute('data-blok-database-drawer-tab-panel', '');
    panel.setAttribute('role', 'tabpanel');
    // The builder only previews the view: it mounts on body, outside the editor.
    panel.toggleAttribute('inert', this.draft !== null);

    return panel;
  }

  /**
   * The pins scroller. Outside the builder, < > arrows step 400px; inside it
   * there is only the edge fade (research/09 §4).
   */
  private buildPinsRow(pins: PropertyDefinition[], row: DatabaseRow): HTMLElement {
    const wrap = document.createElement('div');
    const scroller = this.moduleList('data-blok-database-drawer-pins', 'heading', pins, row);
    // RTL scrolls toward negative scrollLeft, so the distance from the start is its absolute value.
    const sync = (): void => {
      const start = Math.abs(scroller.scrollLeft);
      const overflow = scroller.scrollWidth - scroller.clientWidth > 1;

      wrap.toggleAttribute('data-scroll-back', overflow && start > 1);
      wrap.toggleAttribute('data-scroll-forward', overflow && start + scroller.clientWidth < scroller.scrollWidth - 1);
    };

    wrap.setAttribute('data-blok-database-drawer-pins-row', '');
    scroller.addEventListener('scroll', sync, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.pinsObserver = new ResizeObserver(sync);
      this.pinsObserver.observe(scroller);
    }
    if (this.draft !== null) {
      wrap.append(scroller);

      return wrap;
    }
    const scrollPins = (step: 1 | -1): void => {
      const rtl = getElementDirection(scroller) === 'rtl' ? -1 : 1;
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const next = Math.min(max, Math.max(0, Math.abs(scroller.scrollLeft) + step * PIN_SCROLL_STEP));

      scroller.scrollTo({ left: rtl * next, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };

    wrap.append(
      this.iconButton('data-blok-database-drawer-pins-back', 'tools.database.layoutPinsBack', IconChevronLeft, () => scrollPins(-1)),
      scroller,
      this.iconButton('data-blok-database-drawer-pins-forward', 'tools.database.layoutPinsForward', IconChevronRight, () => scrollPins(1))
    );

    return wrap;
  }

  private stopWatchingPins(): void {
    this.pinsObserver?.disconnect();
    this.pinsObserver = null;
    this.tabsObserver?.disconnect();
    this.tabsObserver = null;
    this.tabsOverflow?.close();
  }

  /**
   * research/13 §3a: tabs that do not fit leave the bar for a "N more…"
   * list. As in the database view tabs, the trailing ones go, but the open
   * tab stays.
   */
  private fitTabs(bar: HTMLElement, list: HTMLElement, editable: boolean): void {
    const all = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];

    all.forEach((tab) => tab.toggleAttribute('hidden', false));
    bar.querySelector('[data-blok-database-tab-more]')?.remove();

    const width = bar.clientWidth;
    const px = (value: string): number => Number.parseFloat(value) || 0;
    const barGap = px(getComputedStyle(bar).columnGap);
    const gap = px(getComputedStyle(list).columnGap);
    const add = bar.querySelector<HTMLElement>('[data-blok-database-layout-add-tab]');
    const reserved = add === null ? 0 : add.offsetWidth + barGap;
    const widths = all.map((tab) => tab.offsetWidth);
    const current = all.findIndex((tab) => tab.getAttribute('data-tab-id') === this.shownTab);

    // Zero: a bar that mounts hidden measures nothing yet.
    if (width === 0 || tabsThatFit(widths, current, width - reserved, gap).length === all.length) {
      return;
    }

    const more = document.createElement('button');

    more.type = 'button';
    more.setAttribute('data-blok-database-tab-more', '');
    more.setAttribute('aria-haspopup', 'dialog');
    // Measured with the widest count it can show.
    more.textContent = this.label('tools.database.moreViews').replace('{count}', () => String(all.length));
    list.after(more);

    const shown = tabsThatFit(widths, current, width - reserved - more.offsetWidth - barGap, gap);

    all.forEach((tab, index) => tab.toggleAttribute('hidden', !shown.includes(index)));
    more.textContent = this.label('tools.database.moreViews').replace('{count}', () => String(all.length - shown.length));
    more.addEventListener('click', () => {
      if (this.tabsOverflow === null) {
        this.openTabsOverflow(more, all, editable);
      } else {
        this.tabsOverflow.close();
      }
    });
  }

  /** On a row page the rows only switch tabs (research/13 §3b): no rename, duplicate or delete there. */
  private openTabsOverflow(anchor: HTMLElement, tabs: HTMLElement[], editable: boolean): void {
    const builder = this.builder;
    const add = anchor.parentElement?.querySelector<HTMLElement>('[data-blok-database-layout-add-tab]') ?? null;
    const titles = new Map(tabs.map((tab) => [tab.getAttribute('data-tab-id') ?? '', tab.textContent ?? '']));
    const state = { reordered: false };
    const overflow: OverflowList = new OverflowList({
      anchor,
      prefix: 'data-blok-database-tab-overflow',
      idAttribute: 'data-view-id',
      // Blok draws Content first, so it stays there (Notion shows a handle on it too).
      rows: [...titles].map(([id, name]) => ({ id, name, icon: { text: '' }, active: id === this.shownTab, fixed: id === 'content' })),
      labels: {
        search: this.label('tools.database.searchViews'),
        handle: this.label('tools.database.settingsDragToReorder'),
        menu: this.label('tools.database.tableMoreActions'),
        newItem: this.label('tools.database.newView'),
        noResults: this.label('find.noResults'),
      },
      readOnly: !editable || builder === null,
      onSelect: (id) => {
        if (id === this.shownTab) return;
        this.activeTab = id;
        this.rerender();
      },
      // The list shows the new order at once; the bar follows when it closes.
      onReorder: (id, afterId, beforeId) => {
        state.reordered = true;
        this.reorderTab(id, afterId === 'content' ? null : afterId, beforeId);
      },
      // The tab is hidden, so its menu hangs from "N more…".
      onMenu: (_button, id) => {
        overflow.close();
        builder?.openTabMenu(anchor, { id, title: titles.get(id) ?? '', content: id === 'content' }, this.builderTabs());
      },
      ...(add === null ? {} : { onNew: () => add.click() }),
      ownsNode: () => false,
      closeLayer: () => false,
      ownsEscape: () => false,
      onClose: () => {
        anchor.removeAttribute('aria-expanded');
        if (this.tabsOverflow === overflow) this.tabsOverflow = null;
        if (state.reordered && this.draft !== null) this.rerender();
      },
    });

    this.tabsOverflow = overflow;
    anchor.setAttribute('aria-expanded', 'true');
    overflow.open();
  }

  /** Pins in the heading, or single-property modules in the page or the panel. */
  private moduleList(attr: string, place: 'heading' | 'page' | 'panel', properties: PropertyDefinition[], row: DatabaseRow): HTMLElement {
    const list = document.createElement('div');

    list.setAttribute(attr, '');
    for (const def of properties) {
      const item = this.createPropertyRow(def, readPropertyValue(row, def) ?? null, place === 'heading' && !this.propertyLabels);

      item.setAttribute(place === 'heading' ? 'data-blok-database-drawer-pin' : 'data-blok-database-drawer-module', '');
      // The builder reads a pin's id here: a pin may have no label.
      if (place === 'heading') item.setAttribute('data-property-id', def.id);
      list.appendChild(item);
    }

    return list;
  }

  /** The page column, then the details panel at its inline end. The panel comes second in focus order. */
  private buildColumns(page: HTMLElement[], panel: HTMLElement): HTMLElement {
    const columns = document.createElement('div');
    const main = document.createElement('div');

    columns.setAttribute('data-blok-database-drawer-columns', '');
    main.setAttribute('data-blok-database-drawer-main', '');
    main.append(...page);
    columns.append(main, panel);

    return columns;
  }

  /** "View details" and the panel it opens and closes. Open or closed is this viewer's own. */
  private buildDetails(layout: ResolvedPageLayout, group: HTMLElement[], row: DatabaseRow): [HTMLElement, HTMLElement] {
    const toggle = document.createElement('button');
    const panel = document.createElement('div');

    toggle.type = 'button';
    toggle.setAttribute('data-blok-database-drawer-details-toggle', '');
    toggle.disabled = this.draft !== null;
    toggle.setAttribute('aria-expanded', String(this.draft !== null || this.detailsOpen));
    const text = document.createElement('span');

    text.setAttribute('data-blok-database-drawer-details-label', '');
    text.textContent = this.detailsLabel(this.draft === null && this.detailsOpen);
    toggle.innerHTML = IconSplitView;
    toggle.append(text);
    panel.setAttribute('data-blok-database-drawer-details', '');
    panel.id = `blok-database-details-${nanoid()}`;
    toggle.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', this.label('tools.database.layoutDetailsPanel'));
    panel.hidden = this.draft === null && !this.detailsOpen;
    // While customizing the panel is in the builder's canvas, so the page must not dock it.
    this.drawer?.toggleAttribute('data-details-open', this.draft === null && !panel.hidden);
    panel.append(this.buildDetailsHeader(toggle), ...group);
    if (layout.panelModules.length > 0) {
      panel.appendChild(this.moduleList('data-blok-database-drawer-panel-modules', 'panel', layout.panelModules, row));
    }
    toggle.addEventListener('click', () => this.setDetailsOpen(!this.detailsOpen));

    return [toggle, panel];
  }

  /** research/10 §10: a round "Close panel" at the panel's top, then "Properties". */
  private buildDetailsHeader(toggle: HTMLElement): HTMLElement {
    const header = document.createElement('div');
    const close = document.createElement('button');
    const title = document.createElement('span');

    header.setAttribute('data-blok-database-drawer-details-header', '');
    close.type = 'button';
    close.setAttribute('data-blok-database-drawer-details-close', '');
    close.setAttribute('aria-label', this.label('tools.database.layoutClosePanel'));
    close.innerHTML = IconChevronRight + IconChevronRight;
    // Focus would fall to the body with the panel hidden.
    close.addEventListener('click', () => {
      this.setDetailsOpen(false);
      toggle.focus();
    });
    title.setAttribute('data-blok-database-drawer-details-title', '');
    title.textContent = this.label('tools.database.propertiesSection');
    header.append(close, title);

    return header;
  }

  /** Blocks the open Customize layout made: no one may move them before its Apply or Discard. */
  get draftTabBlocks(): readonly string[] {
    return this.draft === null ? [] : this.tabDraft.made;
  }

  startCustomizing(): void {
    if (!this.customizable || this.draft !== null || this.currentRow === null) {
      return;
    }
    this.onPageLayoutBirth?.();
    this.draft = { ops: [], visibility: new Map(), madeProperties: [] };
    this.tabDraft = PageLayoutTabEdits.empty();
    this.renderRegions(this.currentRow);
  }

  /** With no rows the builder still opens, on a "New page" placeholder (research/09 §1). */
  customizeNewPage(): void {
    if (!this.customizable || this.draft !== null || this.drawer !== null) {
      return;
    }
    this.onPageLayoutBirth?.();
    this.placeholder = { id: '', position: '', properties: {} };
    this.draft = { ops: [], visibility: new Map(), madeProperties: [] };
    this.tabDraft = PageLayoutTabEdits.empty();
    this.rerender();
  }

  /** Redraws the regions of the page in view: the open row, or the builder's placeholder. */
  private rerender(): void {
    const row = this.currentRow ?? this.placeholder;

    if (row !== null) this.renderRegions(row);
  }

  private editLayout(op: PageLayoutOp): void {
    if (this.draft === null) {
      return;
    }
    this.draft.ops.push(op);
    this.rerender();
  }

  /** Leaves Customize layout. With `apply`, replays the edits on the newest saved layout. */
  private finishCustomizing(apply: boolean): void {
    const draft = this.draft;
    const tabs = this.takeTabDraft();

    this.draft = null;
    if (apply && draft !== null && (draft.ops.length > 0 || draft.visibility.size > 0 || !tabs.isEmpty)) {
      this.onPageLayoutChange?.(draft.ops.length > 0 ? (layout) => applyDraft(draft, layout) : null, draft.visibility, tabs.isEmpty ? undefined : this.tabsDraftOf(tabs));
    } else if (!apply) {
      // research/11 §1: Discard removes the view tabs made in the session.
      this.layoutTabs?.discard(tabs.made);
    }
    this.rerender();
  }

  /** Discard's tab half: the tabs and the "Add new relation" relations made in the draft. */
  private discardTabDraft(): void {
    const tabs = this.takeTabDraft();

    this.layoutTabs?.discard(tabs.made);
    for (const id of tabs.relations) this.layoutTabs?.removeRelation(id);
  }

  private takeTabDraft(): PageLayoutTabEdits {
    const tabs = this.tabDraft;

    this.tabDraft = PageLayoutTabEdits.empty();

    return tabs;
  }

  private tabsDraftOf(tabs: PageLayoutTabEdits, reset = false): LayoutTabsDraft {
    return {
      made: [...tabs.made],
      removed: [...tabs.removed],
      titles: new Map(tabs.titles),
      ...(tabs.order === null || reset ? {} : { order: [...tabs.order] }),
      ...(reset ? { reset } : {}),
    };
  }

  /** Discard drops the draft and deletes the properties made meanwhile (research/09 §3b). */
  private discardCustomizing(): void {
    const made = this.draft?.madeProperties ?? [];
    const relations = [...this.tabDraft.relations];

    this.finishCustomizing(false);
    for (const id of made) this.onDeleteProperty?.(id);
    for (const id of relations) this.layoutTabs?.removeRelation(id);
  }

  /** Opens the full-window builder while a draft is open, and closes it once the draft is gone. */
  private syncBuilder(): void {
    if (this.draft === null) {
      this.placeholder = null;
      this.closeBuilder();

      return;
    }
    const previewed = this.currentRow ?? this.placeholder;
    const previewTitle = (previewed?.properties[this.titlePropertyId] as string | undefined) ?? '';

    if (this.builder !== null) {
      // The host refreshes the drawer after a rename (setData), so the title can change while open.
      this.builder.setTitle(this.databaseTitle());
      this.builder.setPreview(previewTitle);
      this.builder.refresh();

      return;
    }
    this.builder = new PageLayoutBuilder({
      i18n: this.i18n,
      title: this.databaseTitle(),
      directionSource: this.drawer ?? this.wrapper,
      anchor: this.wrapper,
      hasEdits: () => this.draft !== null && (!isDraftEmpty(this.draft) || !this.tabDraft.isEmpty),
      onApply: () => this.finishCustomizing(true),
      onDiscard: () => this.discardCustomizing(),
      onReset: () => this.resetLayout(),
      layout: () => this.draftLayout(),
      edit: (op) => this.editLayout(op),
      pages: () => this.previewRows().map((row) => ({ id: row.id, title: (row.properties[this.titlePropertyId] as string | undefined) ?? '' })),
      previewId: () => this.currentRowId,
      properties: () => this.getRenderableSchema(),
      onAddPin: (anchor) => this.openAddProperty(anchor, 'pin'),
      onAddToGroup: (anchor) => this.openAddProperty(anchor, 'group'),
      onAddToSection: (anchor, sectionId) => this.openAddProperty(anchor, { sectionId }),
      onAddModule: (anchor, place) => this.openAddProperty(anchor, place),
      visibility: (id) => this.pageVisibility(id),
      setVisibility: (id, visibility) => this.setPageVisibility(id, visibility),
      onPreview: (id) => {
        const row = this.previewRows().find((candidate) => candidate.id === id);

        // The same path as the prev / next arrows, so the draft stays.
        if (row !== undefined && this.drawer !== null) this.open(row);
      },
    });
    this.builder.setPreview(previewTitle);
  }

  private previewRows(): DatabaseRow[] {
    if (this.viewRows !== undefined) return this.viewRows();

    return this.currentRow === null ? [] : [this.currentRow];
  }

  private closeBuilder(): void {
    const builder = this.builder;

    this.builder = null;
    builder?.close();
  }

  private textButton(attr: string, key: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attr, '');
    button.textContent = this.label(key);
    button.addEventListener('click', onClick);

    return button;
  }

  private iconButton(attr: string, key: string, icon: string, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attr, '');
    button.setAttribute('aria-label', this.label(key));
    button.innerHTML = icon;
    button.addEventListener('click', () => onClick(button));

    return button;
  }

  /**
   * "Reset to original page layout" writes at once. No property is deleted.
   * The old pins and sections are the ones the canvas showed, so the draft is
   * replayed on the newest layout first.
   */
  private resetLayout(): void {
    const draft = this.draft;
    const tabs = this.takeTabDraft();

    this.draft = null;
    // research/11 §2b: Reset takes the view tabs away too.
    this.onPageLayoutChange?.((layout) => resetPageLayout()(draft === null ? layout : applyDraft(draft, layout)), undefined, this.tabsDraftOf(tabs, true));
    this.rerender();
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
    for (const label of this.drawer?.querySelectorAll<HTMLElement>('[data-blok-database-drawer-prop-label][data-property-id]') ?? []) {
      const name = schema.find((p) => p.id === label.getAttribute('data-property-id'))?.name;

      if (name !== undefined && label.textContent !== name) label.textContent = name;
    }
  }

  private t(key: string): string {
    return this.i18n?.t(key) ?? key;
  }

  /** Chrome labels fall back to bundled English, as the close button always did. */
  private label(key: string): string {
    return this.i18n?.t(key) ?? (englishDictionary as Record<string, string>)[key] ?? key;
  }

  /** Draws a value into its slot. The drawer pill attribute shipped in v1.16.1, so it stays. */
  private paintValue(slot: HTMLElement, def: PropertyDefinition, value: PropertyValue | undefined): void {
    const cell = renderCellValue(def, value, {
      ...this.cellContext(),
      i18n: { t: (key) => this.t(key) },
      readOnly: this.readOnly,
      followLinks: true,
      ...rowCellContext(this.currentRow ?? undefined, def.id),
    });

    cell.querySelectorAll('[data-blok-database-option-pill]').forEach((pill) => pill.setAttribute('data-blok-database-drawer-prop-pill', ''));
    // R29: the page glyph before a file name, as the table draws it.
    cell.querySelectorAll('[data-blok-database-file-chip]').forEach((chip) => chip.prepend(fileChipIcon()));
    if (cell.hasAttribute('data-empty')) {
      cell.textContent = this.t('tools.database.cellEmpty');
    }
    // A pin with no label names itself while empty (research/10 §4).
    if (cell.hasAttribute('data-empty') && slot.hasAttribute('data-labelless')) {
      const placeholder = document.createElement('span');

      placeholder.setAttribute('data-blok-database-drawer-prop-placeholder', '');
      if (this.propertyIcons) placeholder.appendChild(this.propertyIcon(def));
      placeholder.append(def.name);
      cell.replaceChildren(placeholder);
    }
    slot.replaceChildren(cell);
    const filled = !cell.hasAttribute('data-empty');

    slot.toggleAttribute('data-link', LINK_TYPES.has(def.type) && filled);
    if (COPY_TYPES.has(def.type) && filled) {
      slot.appendChild(this.createLinkActions(def));
    }
  }

  /** research/22 §3: a filled url, email or phone value's Comment and Copy to Clipboard, as in the table. */
  private createLinkActions(def: PropertyDefinition): HTMLElement {
    const actions = document.createElement('span');
    const entries: Array<[action: string, key: string, icon: string]> = [['copy', 'tools.database.cellCopy', IconCopy]];

    if (this.onCommentProperty !== undefined) {
      entries.unshift(['comment', 'tools.database.tableComment', IconMessage]);
    }
    actions.setAttribute('data-blok-database-drawer-prop-actions', '');
    for (const [action, key, icon] of entries) {
      const button = document.createElement('button');

      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('data-blok-database-table-cell-action', action);
      button.setAttribute('aria-label', this.t(key));
      // No whitespace text: the value's own text stays its textContent.
      button.innerHTML = icon.replace(/>\s+</g, '><').trim();
      onHover(button, this.t(key));
      button.addEventListener('click', (event) => {
        // The value under it would open its editor.
        event.stopPropagation();
        this.runLinkAction(action, def, actions.parentElement);
      });
      actions.appendChild(button);
    }

    return actions;
  }

  private runLinkAction(action: string, def: PropertyDefinition, slot: HTMLElement | null): void {
    const row = this.currentRow;

    if (row === null || slot === null) return;
    if (action === 'comment') {
      this.onCommentProperty?.(row.id, def.id, slot);

      return;
    }
    const text = cellText(def, readPropertyValue(row, def), this.cellContext());

    if (text === '') return;
    void navigator.clipboard?.writeText(text).then(
      () => this.notify?.(this.t('tools.database.cellCopied')),
      () => undefined
    );
  }

  private propertyIcon(def: PropertyDefinition): HTMLElement {
    const icon = document.createElement('span');

    icon.setAttribute('data-blok-database-drawer-prop-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    if (def.icon !== undefined && def.icon !== '') {
      icon.textContent = def.icon;
    } else {
      icon.innerHTML = propertyTypeMeta(def.type).icon;
    }

    return icon;
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
    const onReminderChange = this.onReminderChange;
    const reminder = row.reminders?.[propertyId]?.remind;
    const onDateDisplayChange = def.type === 'date' && !this.readOnly ? this.dateDisplayChanger?.(propertyId) : undefined;

    this.cellEditor = openCellEditor(def, readPropertyValue(row, def), slot, {
      ...this.cellContext(),
      i18n: { t: (key) => this.t(key) },
      readOnly: this.readOnly,
      options: shownOptions.list,
      // Every editor opens over its value, so the value seems to turn editable in place.
      coverCell: true,
      ...(reminder !== undefined ? { reminder } : {}),
      ...(onDateDisplayChange !== undefined ? { onDateDisplayChange } : {}),
      ...(def.type === 'date' && onReminderChange !== undefined
        ? {
          onReminderChange: (next: DateReminderOffset | null): void => {
            if (this.currentRow?.id === rowId) {
              const { [propertyId]: _old, ...others } = this.currentRow.reminders ?? {};

              this.currentRow = { ...this.currentRow, reminders: next === null ? others : { ...others, [propertyId]: { remind: next } } };
            }
            onReminderChange(rowId, propertyId, next);
          },
        }
        : {}),
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
          // The host drops a cleared date's reminder in the same write.
          const { [propertyId]: _dropped, ...reminders } = this.currentRow.reminders ?? {};

          this.currentRow = {
            ...this.currentRow,
            properties: { ...this.currentRow.properties, [propertyId]: value },
            ...(value === null ? { reminders } : {}),
          };
        }
        this.onPropertyValueChange?.(rowId, propertyId, value);
        const current = this.schema.find((p) => p.id === propertyId);

        if (slot.isConnected && current !== undefined) {
          this.paintValue(slot, current, value);
        }
      },
      onClose: () => {
        this.cellEditor = null;
        this.releaseEditorTab();
        const current = this.schema.find((p) => p.id === propertyId);

        if (slot.isConnected && current !== undefined && this.currentRow?.id === rowId) {
          this.paintValue(slot, current, readPropertyValue(this.currentRow, current));
        }
      },
    });
    if (!this.cellEditor.isOpen) {
      this.cellEditor = null;

      return;
    }
    this.watchEditorTab(slot);
  }

  /** research R21: Tab commits and opens the next value's editor, Shift+Tab the previous; focus stays in the page. */
  private watchEditorTab(slot: HTMLElement): void {
    this.releaseEditorTab();
    const editor = this.cellEditor;
    const onTab = (event: KeyboardEvent): void => {
      if (this.cellEditor !== editor || editor === null || this.drawer?.isConnected !== true) {
        this.releaseEditorTab();

        return;
      }
      // The option delete prompt keeps its own Tab loop.
      if (event.key !== 'Tab' || event.isComposing || (event.target instanceof Element && event.target.closest('[role="alertdialog"]') !== null)) return;
      event.preventDefault();
      event.stopPropagation();
      this.openNextEditor(slot, event.shiftKey ? -1 : 1);
    };

    this.editorTab = onTab;
    window.addEventListener('keydown', onTab, true);
  }

  private releaseEditorTab(): void {
    if (this.editorTab !== null) window.removeEventListener('keydown', this.editorTab, true);
    this.editorTab = null;
  }

  /** Values Tab walks through. A checkbox is skipped: opening its editor would toggle it. */
  private tabbableValues(): HTMLElement[] {
    return [...this.drawer?.querySelectorAll<HTMLElement>('[data-blok-database-drawer-prop-value][role="button"]') ?? []]
      .filter((el) => this.schema.find((p) => p.id === el.getAttribute('data-property-id'))?.type !== 'checkbox');
  }

  /** `from` null: the title, so the first value. */
  private openNextEditor(from: HTMLElement | null, step: 1 | -1): boolean {
    const values = this.tabbableValues();
    const nextId = (from === null ? values[0] : values[values.indexOf(from) + step])?.getAttribute('data-property-id') ?? null;

    this.closeCellEditor();
    // The commit may repaint the page, so find the next value again by its id.
    const next = nextId === null ? null : this.tabbableValues().find((el) => el.getAttribute('data-property-id') === nextId) ?? null;

    if (next === null) {
      if (from?.isConnected === true) from.focus();

      return false;
    }
    next.focus();
    this.openValueEditor(next, nextId as string);

    return true;
  }

  private closeCellEditor(): void {
    const editor = this.cellEditor;

    this.cellEditor = null;
    this.releaseEditorTab();
    editor?.close();
  }

  /** Teardown drops a draft: the block may be going read-only or away, and must not be written. */
  private cancelCellEditor(): void {
    const editor = this.cellEditor;

    this.cellEditor = null;
    this.releaseEditorTab();
    editor?.cancel();
  }

  /**
   * One label + value row. The value is a button that opens the cell editor
   * for its type; read-only values are plain text.
   */
  /** `labelless`: a pin with Property labels off. It shows its value alone, and names itself only while empty. */
  private createPropertyRow(def: PropertyDefinition, value: PropertyValue, labelless = false): HTMLDivElement {
    const row = document.createElement('div');

    row.setAttribute('data-blok-database-drawer-prop-row', '');
    if (labelless) {
      row.setAttribute('data-labelless', '');
      // No visible name, so the name is for assistive tech only. No title: Notion shows no tooltip.
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', def.name);
    }

    const label = document.createElement('span');

    label.setAttribute('data-blok-database-drawer-prop-label', '');
    label.setAttribute('data-property-id', def.id);
    label.textContent = def.name;
    // research/35 §4: the name, plus the description, on the label's inline-start side.
    onPropertyHover(label, def.name, def.description);
    const head = document.createElement('div');
    const valueEl = document.createElement('div');

    head.setAttribute('data-blok-database-drawer-prop-head', '');
    // Outside the label: callers read the label's text as the property name.
    if (this.propertyIcons) {
      head.appendChild(this.propertyIcon(def));
    }
    head.appendChild(label);
    // The live property menu writes at once, so it would skip the draft.
    if (!this.readOnly && this.onOpenPropertyMenu !== undefined && this.draft === null) {
      const openMenu = this.onOpenPropertyMenu;

      label.setAttribute('role', 'button');
      label.tabIndex = 0;
      // research/09 §1b: a row page property menu ends with "Customize layout".
      const customize = this.customizable ? (): void => this.startCustomizing() : undefined;
      const open = (): void => openMenu(def.id, head, customize, this.propertyMenuExtras(def.id, valueEl));

      label.addEventListener('click', open);
      label.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
    if (this.customizable && this.draft === null && !labelless) {
      head.prepend(this.dragHandle(def.id, row, label));
    }
    if (!labelless) row.appendChild(head);

    valueEl.setAttribute('data-blok-database-drawer-prop-value', '');
    valueEl.setAttribute('data-property-id', def.id);
    valueEl.toggleAttribute('data-labelless', labelless);
    this.paintValue(valueEl, def, value);

    // The placeholder page is no row, so it has no value to edit.
    if (!this.readOnly && this.onPropertyValueChange !== undefined && !isReadOnlyType(def.type) && this.placeholder === null) {
      valueEl.setAttribute('role', 'button');
      valueEl.tabIndex = 0;
      valueEl.setAttribute('aria-label', def.name);
      valueEl.addEventListener('click', (event) => {
        // research/22 §3: a click on a url, email or phone link follows it; beside it, edits. Cmd/Ctrl follows any link.
        const anchor = event.target instanceof Element ? event.target.closest('a') : null;

        if (anchor !== null && (anchor.hasAttribute('data-blok-database-cell-link') || event.metaKey || event.ctrlKey)) {
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

  /** R09: the ⋮⋮ that shows over the glyph on row hover. A drag reorders; a click opens the property menu. */
  private dragHandle(id: string, row: HTMLElement, label: HTMLElement): HTMLElement {
    const handle = document.createElement('span');
    const dragged = { value: false };

    handle.setAttribute('data-blok-database-drawer-prop-handle', '');
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = IconMenu;
    handle.addEventListener('pointerdown', (event) => {
      dragged.value = false;
      this.startPropertyDrag(event, id, row, () => {
        dragged.value = true;
      });
    });
    handle.addEventListener('click', () => {
      if (!dragged.value) label.click();
    });

    return handle;
  }

  /** Drags a property row within its list (the group or a section) and writes that list's order. */
  private startPropertyDrag(event: PointerEvent, id: string, source: HTMLElement, onDrag: () => void): void {
    const list = source.parentElement;

    if (event.button !== 0 || list === null) return;
    event.preventDefault();
    const line = new DatabaseDropLine(this.drawer ?? undefined);
    const state: { dragging: boolean; order: string[] | null } = { dragging: false, order: null };
    const move = (moveEvent: PointerEvent): void => {
      if (!state.dragging && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < PROPERTY_DRAG_THRESHOLD) return;
      state.dragging = true;
      onDrag();
      source.setAttribute('data-dragging', '');
      const rows = [...list.querySelectorAll<HTMLElement>(':scope > [data-blok-database-drawer-prop-row]')].filter((row) => row !== source);
      const before = rows.find((row) => {
        const box = row.getBoundingClientRect();

        return moveEvent.clientY < box.top + box.height / 2;
      });
      const box = list.getBoundingClientRect();
      const order = rows.map((row) => row.querySelector('[data-property-id]')?.getAttribute('data-property-id') ?? '');

      order.splice(before === undefined ? order.length : rows.indexOf(before), 0, id);
      state.order = order;
      line.showHorizontal({ left: box.left, width: box.width, centerY: before?.getBoundingClientRect().top ?? rows.at(-1)?.getBoundingClientRect().bottom ?? box.top });
    };
    const end = (drop: boolean): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      line.destroy();
      source.removeAttribute('data-dragging');
      if (drop && state.dragging && state.order !== null) {
        this.onPageLayoutChange?.(arrangeSection(id, list.closest('[data-blok-database-drawer-section]')?.getAttribute('data-section-id') ?? null, state.order));
      }
    };
    const up = (): void => end(true);
    const cancel = (): void => end(false);

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }

  /** Notion's row page menu has Comment only on a filled value (research/09:93, research/36:261). */
  private propertyMenuExtras(propertyId: string, slot: HTMLElement): { onComment?: () => void } {
    const row = this.currentRow;
    const onComment = this.onCommentProperty;
    const filled = slot.firstElementChild !== null && !slot.firstElementChild.hasAttribute('data-empty');

    if (row === null || onComment === undefined || !filled) return {};

    return { onComment: () => onComment(row.id, propertyId, slot) };
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
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  /** The body editor's host save holds segments; the row stores HTML, as every tool's data does. */
  private bodyAsHtml(data: OutputData): OutputData {
    return { ...data, blocks: outputBlocksToHtml(data.blocks, richFieldsOf(this.toolsConfig?.tools)) };
  }

  private cleanupEditor(): void {
    this.closeCellEditor();
    this.detachBody();
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

  /** Puts back a body left in a side peek that slid out. */
  private releaseLeavingBody(): void {
    const rowId = this.leavingBodyRowId;

    this.leavingBodyRowId = null;
    if (rowId !== null && rowId !== this.attachedBodyRowId) {
      this.rowBody?.detach(rowId);
    }
  }

  private detachBody(): void {
    const rowId = this.attachedBodyRowId;

    // Cleared first: the detach puts every row but the open one back in the pool.
    this.attachedBodyRowId = null;
    if (rowId !== null) {
      this.rowBody?.detach(rowId);
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
    if (this.rowPages === undefined && this.rowBody !== undefined) {
      this.attachedBodyRowId = row.id;
      if (this.rowBody.attach(row.id, editorHolder)) {
        return;
      }
      this.attachedBodyRowId = null;
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
