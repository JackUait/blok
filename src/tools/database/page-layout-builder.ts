import { nanoid } from 'nanoid';
import type { I18n } from '../../../types';
import { databaseEnglish } from './database-english';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconArrowDiagonal, IconArrowUp, IconCheck, IconCopy, IconChevronDown, IconChevronLeft, IconChevronRight, IconCross, IconDatabase, IconDotsHorizontal, IconEyeClosed, IconEyeSlash, IconInfo, IconMenu, IconMinus, IconMoveDown, IconPage, IconPencil, IconPin, IconPinFilled, IconPlus, IconPreview, IconSplitView, IconTabs, IconTrash, IconUndo } from '../../components/icons';
import { holdLeave } from '../../components/utils/leave-guards';
import { openModalDialog } from '../../components/utils/modal-dialog';
import { onHover } from '../../components/utils/tooltip';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { DatabaseDropLine } from './database-drop-line';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { DatabasePanel, panelInput, panelLabel, panelRow, panelSeparator, panelSwitch } from './database-panel';
import type { PanelPage } from './database-panel';
import { propertyTypeMeta } from './database-property-types';
import {
  PAGE_LAYOUT_PIN_LIMIT,
  addModule,
  addSection,
  arrangeSection,
  canPlaceInPanel,
  deleteSection,
  moveInPlace,
  moveSection,
  moveToSection,
  pin,
  placeBefore,
  removeFromLayout,
  renameSection,
  resolvePageLayout,
  setFullWidth,
  setGroupIn,
  setPropertyIcons,
  setPropertyLabels,
  setStructure,
  setTemplates,
} from './page-layout';
import { freePropertyName } from '../../shared/database/schema-ops';
import type { PageLayoutData, PageLayoutOp, ResolvedPageLayout } from './page-layout';
import type { PageVisibility, PropertyDefinition } from './types';

/** A page the Preview switch offers. */
export interface PreviewPage {
  id: string;
  title: string;
}

/** The builder's view tab edits; the drawer keeps them in the draft. */
export interface BuilderTabs {
  sources(): Array<{ id: string; title: string }>;
  add(sourceId: string, name: string): void;
  /** Relations to other databases: each one is a one-click tab (research/13 §1b). */
  related(): Array<{ propertyId: string; title: string }>;
  /** This database's name, for the "Related to" heading. */
  thisDatabase(): string;
  /** A source's property names, so the related name placeholder can dodge a clash. */
  propertyNames?(sourceId: string): string[];
  addRelated(propertyId: string): void;
  /** A source "Add new relation" can relate to: another database of this document. */
  canRelate(sourceId: string): boolean;
  /** research/13 §2: a two-way relation to `sourceId` and a tab filtered by its mirror. */
  addWithRelation(sourceId: string, name: string, relatedName: string): void;
  rename(tabId: string, title: string): void;
  remove(tabId: string, name: string): void;
  /** research/13 §3c: a copy at the end of the bar, named "<name> (n)", selected. */
  duplicate(tabId: string): void;
}

export interface PageLayoutBuilderOptions {
  i18n?: I18n;
  /** The database's name for the top bar. Empty shows the new-database placeholder. */
  title: string;
  /** The live element whose direction the builder takes: it mounts outside the editor. */
  directionSource: Element | null;
  /** An element inside the editor: `blok.confirmLeave()` asks this builder only from that editor. */
  anchor: Element;
  /** Whether the open draft holds any edit. Cancel asks first when it does. */
  hasEdits: () => boolean;
  onApply: () => void;
  /** Cancel, after the discard question when there were edits. */
  onDiscard: () => void;
  onReset: () => void;
  /** The layout with the draft applied. */
  layout: () => PageLayoutData;
  /** One draft edit. */
  edit: (op: PageLayoutOp) => void;
  /** Every page, in view order. Empty when the database has no rows. */
  pages: () => PreviewPage[];
  /** The page in the canvas. Null is the "New page" placeholder. */
  previewId: () => string | null;
  onPreview: (id: string) => void;
  /** The properties the layout places, in schema order. */
  properties: () => PropertyDefinition[];
  /** "+ Add a property" in the Heading menu. The new property is pinned first. */
  onAddPin: (anchor: HTMLElement) => void;
  /** "+ Add a property" in the Property group menu. The new property goes to the top of the group. */
  onAddToGroup: (anchor: HTMLElement) => void;
  /** A section's own "+ Add a property". The new property goes first in that section. */
  onAddToSection: (anchor: HTMLElement, sectionId: string) => void;
  /** A property's page visibility, with the draft's eye edit if any. */
  visibility: (id: string) => PageVisibility;
  /** An eye edit. It is a draft: Apply writes it on the property. */
  setVisibility: (id: string, visibility: PageVisibility) => void;
  /** "Create new property" from "+" or "Add to panel". The new property becomes a module there. */
  onAddModule: (anchor: HTMLElement, place: 'page' | 'panel') => void;
}

/** A single-property module and its drawn property row. */
export interface PageLayoutModuleEntry {
  def: PropertyDefinition;
  element: HTMLElement;
}

/** What the drawer draws for the previewed page, module by module. */
export interface PageLayoutRegions {
  heading: HTMLElement[];
  group: HTMLElement[];
  content: HTMLElement[];
  /** Modules in the page, in layout order. */
  page: PageLayoutModuleEntry[];
  /** Modules in the side panel, in layout order. */
  panel: PageLayoutModuleEntry[];
}

/** The canvas modules (research/09 anatomy L39). Page discussions is skipped (plan §2.4). */
export type PageLayoutModule = 'heading' | 'group' | 'content';

/** `window.navigation`, where the browser has the Navigation API. */
const navigationOf = (): Navigation | undefined => ('navigation' in window ? window.navigation : undefined);

const MODULE_NAMES: Record<PageLayoutModule, string> = {
  heading: 'tools.database.layoutModuleHeading',
  group: 'tools.database.layoutModuleGroup',
  content: 'tools.database.layoutModuleContent',
};

/** A property module's key in the module maps. */
const propertyKey = (id: string): string => `property:${id}`;

/**
 * research/09 §10 L164 shows the column collapsed at 756px and open at 1512px.
 * Notion's breakpoint was not measured; 1000px leaves the canvas room beside both columns.
 */
const NARROW_BUILDER = '(max-width: 1000px)';

/** A pointer must travel this far before a press on a handle becomes a drag. */
const DRAG_THRESHOLD = 4;

/** Half the gap between module cards, where the drop line sits. */
const CARD_GAP_HALF = 6;

/** research/09 §5: Notion's `eyeFill`, `eyeSlash`, `eyeClosed`. */
const EYE: Record<PageVisibility, string> = { always: IconPreview, hideWhenEmpty: IconEyeSlash, hidden: IconEyeClosed };

/** A click on one of these inside a module is the control's own, not a module pick. */
const MODULE_CONTROL = 'button, input, select, textarea, a[href], [role="button"], [tabindex]';

/**
 * The full-window "Customize page layout" builder (research/09 §1, §10). UI
 * only: the drawer owns the draft and draws the page regions into `canvas`.
 */
export class PageLayoutBuilder {
  readonly canvas: HTMLElement;
  /**
   * Module cards are built once (property modules on first sight), so a menu's
   * trigger outlives a redraw. The drawer fills their bodies. Keyed by
   * PageLayoutModule or `propertyKey(id)`.
   */
  private readonly modules = new Map<string, { card: HTMLElement; body: HTMLElement; menu: HTMLButtonElement | null }>();
  /** The one open builder menu: a module's •••, "+" or "Add to panel". */
  private moduleMenu: { key: string; anchor: HTMLElement; panel: DatabasePanel } | null = null;
  private readonly addModuleButton: HTMLButtonElement;
  private readonly panelColumn: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly panelToggle: HTMLButtonElement;
  private readonly addToPanelButton: HTMLButtonElement;
  private unwatchNarrow: () => void = () => undefined;
  private menuQuery = '';
  /** The section whose name is being edited in the group menu, and the text typed so far. */
  private renaming: { id: string; value: string } | null = null;
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly options: PageLayoutBuilderOptions;
  private readonly dialog: ModalDialogHandle;
  private menu: PopoverDesktop | null = null;
  /** The discard question; closing the builder closes it too. */
  private confirm: AbortController | null = null;
  /** Page settings controls, built once and updated in place so focus stays put. */
  private readonly settings: Array<{ control: HTMLElement; state: 'aria-pressed' | 'aria-checked'; on: (layout: PageLayoutData) => boolean }> = [];
  /** A page load with a draft asks "Leave site?" (research/23 §7). Each builder checks only its own draft. */
  private readonly holdLeave = (event: BeforeUnloadEvent): void => {
    if (this.options.hasEdits()) event.preventDefault();
  };
  private readonly releaseLeave: () => void;
  /**
   * Holds a same-document Back while the draft has edits, then asks.
   * The spec makes a traversal cancelable only in a top-level page, same-document,
   * and (for the browser's own Back) after a user gesture; `cancelable` says which.
   */
  private readonly holdTraverse = (event: NavigateEvent): void => {
    if (event.navigationType !== 'traverse' || !event.cancelable || !event.destination.sameDocument || !this.options.hasEdits()) return;
    const key = event.destination.key;

    event.preventDefault();
    void this.askDiscard().then((discard) => {
      const navigation = navigationOf();

      if (!discard || navigation === undefined) return;
      const result = navigation.traverseTo(key);

      // Both reject when the host aborts the traversal; that is not an error here.
      result.committed?.catch(() => undefined);
      result.finished?.catch(() => undefined);
    });
  };

  constructor(options: PageLayoutBuilderOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.setAttribute('data-blok-interface', 'database-layout-builder');
    this.root.setAttribute('data-blok-database-layout-builder', '');
    // Without it the editor's document keydown turns Tab into block navigation.
    this.root.setAttribute(DATA_ATTR.keyboardOwner, '');

    const bar = document.createElement('div');
    const heading = document.createElement('div');
    const name = document.createElement('div');
    const title = document.createElement('span');
    const actions = document.createElement('div');
    const split = document.createElement('div');
    const more = this.button('data-blok-database-layout-more-save', IconChevronDown, null, (el) => this.openMoreSave(el));

    bar.setAttribute('data-blok-database-layout-topbar', '');
    heading.setAttribute('data-blok-database-layout-heading', '');
    name.setAttribute('data-blok-database-layout-heading-name', '');
    name.innerHTML = IconDatabase;
    title.setAttribute('data-blok-database-layout-title', '');
    this.title = title;
    this.setTitle(options.title);
    name.appendChild(title);
    // research/09 §2: the Preview switch, centered under the database title.
    const preview = this.button('data-blok-database-layout-preview', null, null, (el) => this.openPreview(el));

    this.preview = document.createElement('span');
    preview.setAttribute('aria-haspopup', 'menu');
    preview.append(this.preview);
    preview.insertAdjacentHTML('beforeend', IconChevronDown);
    heading.append(name, preview);
    actions.setAttribute('data-blok-database-layout-actions', '');
    split.setAttribute('data-blok-database-layout-apply-split', '');
    more.setAttribute('aria-label', this.label('tools.database.layoutMoreSaveOptions'));
    more.setAttribute('aria-haspopup', 'menu');
    split.append(this.button('data-blok-database-layout-apply', IconCheck, 'tools.database.layoutApply', () => options.onApply()), more);
    actions.append(this.button('data-blok-database-layout-cancel', IconCross, 'tools.database.layoutCancel', () => this.cancel()), split);
    bar.append(heading, actions);

    const body = document.createElement('div');
    const side = document.createElement('div');

    body.setAttribute('data-blok-database-layout-body', '');
    this.canvas = document.createElement('div');
    this.canvas.setAttribute('data-blok-database-layout-canvas', '');
    for (const kind of ['heading', 'group', 'content'] as const) this.module(kind);
    this.addModuleButton = this.button('data-blok-database-layout-add-module', IconPlus, null, (el) => this.toggleAddMenu('page', el));
    this.addModuleButton.setAttribute('aria-label', this.label('tools.database.layoutAddModule'));
    this.addModuleButton.setAttribute('aria-expanded', 'false');
    this.canvas.append(...['heading', 'group'].map((key) => this.cardOf(key)), this.addModuleButton, this.cardOf('content'));
    this.panelColumn = document.createElement('div');
    this.panelBody = document.createElement('div');
    this.panelToggle = this.button('data-blok-database-layout-panel-toggle', null, null, () => this.setSidebar(!this.panelColumn.hasAttribute('data-collapsed')));
    this.addToPanelButton = this.button('data-blok-database-layout-add-to-panel', IconPlus, 'tools.database.layoutAddToPanel', (el) => this.toggleAddMenu('panel', el));
    this.addToPanelButton.setAttribute('aria-expanded', 'false');
    this.panelColumn.setAttribute('data-blok-database-layout-panel-column', '');
    this.panelBody.setAttribute('data-blok-database-layout-panel-body', '');
    this.panelBody.id = `blok-database-layout-panel-${nanoid()}`;
    this.panelToggle.setAttribute('aria-controls', this.panelBody.id);
    this.panelBody.append(this.addToPanelButton);
    this.panelColumn.append(this.panelToggle, this.panelBody);
    this.watchNarrow();
    side.setAttribute('data-blok-database-layout-side', '');
    side.setAttribute('data-blok-database-layout-settings-column', '');
    side.append(...this.pageSettings());
    body.append(this.canvas, this.panelColumn, side);
    this.root.append(bar, body);

    // Escape never closes the builder; only Cancel and Apply do (research/10 §9).
    // Joins Escape so a toast below can't take it; the dialog closes an owned menu first.
    this.dialog = openModalDialog({
      content: this.root,
      label: this.label('tools.database.layoutCustomizePage'),
      directionSource: options.directionSource,
      escape: true,
      outside: false,
      onDismiss: () => undefined,
    });
    window.addEventListener('beforeunload', this.holdLeave);
    navigationOf()?.addEventListener('navigate', this.holdTraverse);
    this.releaseLeave = holdLeave(options.anchor, () => (this.options.hasEdits() ? this.askDiscard() : Promise.resolve(true)));
  }

  /** The database's name. Empty shows the new-database placeholder. */
  setTitle(title: string): void {
    this.title.textContent = title.trim() !== '' ? title : this.label('tools.database.titlePlaceholder');
  }

  /** The page in the canvas. Empty shows the "New page" placeholder. */
  setPreview(title: string): void {
    this.preview.textContent = this.label('tools.database.layoutPreview', { page: this.pageTitle(title) });
  }

  /** Shows the draft layout in Page settings. */
  refresh(): void {
    const layout = this.options.layout();

    for (const { control, state, on } of this.settings) control.setAttribute(state, String(on(layout)));
    // A tab's menu holds the field being typed in: a rebuild would replace it
    // mid-word, and the modal's focus trap would then close the menu.
    if (this.moduleMenu?.key.startsWith('tab:') !== true && this.moduleMenu?.key !== 'add-tab') this.moduleMenu?.panel.refresh();
  }

  /** Is `target` inside the builder or one of its menus? */
  get element(): HTMLElement {
    return this.root;
  }

  contains(target: Node): boolean {
    return this.root.contains(target);
  }

  close(): void {
    window.removeEventListener('beforeunload', this.holdLeave);
    navigationOf()?.removeEventListener('navigate', this.holdTraverse);
    this.releaseLeave();
    this.confirm?.abort();
    this.confirm = null;
    this.unwatchNarrow();
    this.closeMenu();
    this.closeModuleMenu();
    this.dialog.close();
  }

  /**
   * Puts the drawn regions of the previewed page into the module cards. Page
   * modules sit between the group and "+"; the group sits in the side panel
   * column when the layout puts it there (research/09 anatomy L39-40).
   */
  fill(regions: PageLayoutRegions): void {
    for (const kind of ['heading', 'group', 'content'] as const) this.modules.get(kind)?.body.replaceChildren(...regions[kind]);
    for (const pinEl of this.modules.get('heading')?.body.querySelectorAll<HTMLElement>('[data-blok-database-drawer-pin]') ?? []) {
      const id = pinEl.getAttribute('data-property-id');
      // A pin drags by its label; with Property labels off it has none, so by itself.
      const handle = pinEl.querySelector('[data-blok-database-drawer-prop-head]') ?? pinEl;

      handle.addEventListener('pointerdown', (event) => {
        if (id !== null) this.startDrag(event as PointerEvent, id, 'heading', pinEl);
      });
    }
    const live = new Set<string>();
    const cards = (entries: PageLayoutModuleEntry[], place: 'page' | 'panel'): HTMLElement[] => entries.map(({ def, element }) => {
      const key = propertyKey(def.id);
      const module = this.modules.get(key) ?? this.propertyModule(def);
      const name = module.card.querySelector('[data-blok-database-layout-module-name]');

      live.add(key);
      if (name !== null) name.textContent = def.name;
      module.card.setAttribute('data-place', place);
      module.body.replaceChildren(element);

      return module.card;
    });
    const pageCards = cards(regions.page, 'page');
    const panelCards = cards(regions.panel, 'panel');

    for (const [key, { card }] of this.modules) {
      if (!key.startsWith('property:') || live.has(key)) continue;
      if (this.moduleMenu?.key === key) this.closeModuleMenu();
      card.remove();
      this.modules.delete(key);
    }
    const inPanel = this.options.layout().groupIn === 'panel';
    const group = inPanel ? [] : [this.cardOf('group')];

    syncChildren(this.canvas, [this.cardOf('heading'), ...group, ...pageCards, this.addModuleButton, this.cardOf('content')]);
    syncChildren(this.panelBody, [...(inPanel ? [this.cardOf('group')] : []), ...panelCards, this.addToPanelButton]);
  }

  private cardOf(key: string): HTMLElement {
    const module = this.modules.get(key);

    if (module === undefined) throw new Error(`no ${key} module`);

    return module.card;
  }

  /** research/09 anatomy L39: Heading, Property group and Content. Content has no menu (not measured). */
  private module(kind: PageLayoutModule): void {
    this.card(kind, kind, this.label(MODULE_NAMES[kind]), kind !== 'content', null);
  }

  /** A single-property module: a ⠿ handle, the property's name and a ••• menu. */
  private propertyModule(def: PropertyDefinition): { card: HTMLElement; body: HTMLElement; menu: HTMLButtonElement | null } {
    const handle = document.createElement('span');
    const key = propertyKey(def.id);

    // research/10 §9 L71: only the ••• is a tab stop. Move up / Move down are the keyboard path.
    handle.setAttribute('data-blok-database-layout-module-handle', '');
    handle.setAttribute('data-blok-testid', `database-layout-module-handle-${def.id}`);
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = IconMenu;
    const module = this.card(key, 'property', def.name, true, handle);

    module.card.setAttribute('data-property-id', def.id);
    handle.addEventListener('pointerdown', (event) => this.startDrag(event, def.id, 'module', module.card));

    return module;
  }

  /** A card with a header strip; a click anywhere in it selects it and opens its menu (research/10 §8). */
  private card(key: string, kind: string, title: string, withMenu: boolean, handle: HTMLElement | null): { card: HTMLElement; body: HTMLElement; menu: HTMLButtonElement | null } {
    const card = document.createElement('section');
    const header = document.createElement('div');
    const name = document.createElement('span');
    const body = document.createElement('div');
    const menu = withMenu ? this.button('data-blok-database-layout-module-menu', IconDotsHorizontal, null, () => this.toggleModuleMenu(key)) : null;

    card.setAttribute('data-blok-database-layout-module', kind);
    header.setAttribute('data-blok-database-layout-module-header', '');
    name.setAttribute('data-blok-database-layout-module-name', '');
    name.textContent = title;
    body.setAttribute('data-blok-database-layout-module-body', '');
    if (handle !== null) header.append(handle);
    header.append(name);
    if (menu !== null) {
      menu.setAttribute('aria-label', this.label('tools.database.layoutModuleMenu'));
      menu.setAttribute('aria-expanded', 'false');
      header.append(menu);
    }
    card.append(header, body);
    card.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest(MODULE_CONTROL) !== null) return;
      this.select(key);
      if (menu !== null && this.moduleMenu?.key !== key) this.openModuleMenu(key);
    });
    const module = { card, body, menu };

    this.modules.set(key, module);

    return module;
  }

  private select(key: string): void {
    for (const [other, { card }] of this.modules) card.toggleAttribute('data-selected', other === key);
    if (this.moduleMenu !== null && this.moduleMenu.key !== key) this.closeModuleMenu();
  }

  private toggleModuleMenu(key: string): void {
    if (this.moduleMenu?.key === key) {
      this.closeModuleMenu();

      return;
    }
    this.select(key);
    this.openModuleMenu(key);
  }

  /** research/09 §3: each module's ••• menu has a header, a focused property search, and its lists. */
  private openModuleMenu(key: string): void {
    const anchor = this.modules.get(key)?.menu ?? null;

    if (anchor === null) return;
    const id = key.startsWith('property:') ? key.slice('property:'.length) : null;
    const pages: Record<string, () => PanelPage> = {
      heading: () => ({ title: this.label('tools.database.layoutModuleHeading'), build: (panel) => this.headingMenuPage(panel) }),
      group: () => ({
        title: this.label('tools.database.layoutModuleGroup'),
        headerAction: () => this.button('data-blok-database-layout-add-section', IconPlus, 'tools.database.layoutAddSection', () => {
          const sectionId = nanoid();
          const name = this.label('tools.database.layoutNewSection');

          // research/10 §3: the new section's name opens for editing, all of it selected.
          this.renaming = { id: sectionId, value: name };
          this.options.edit(addSection(sectionId, name, this.options.properties().map((def) => def.id)));
          this.focusRename();
        }),
        build: (panel) => this.groupMenuPage(panel),
      }),
    };
    const root: PanelPage = id === null
      ? pages[key]()
      : { title: this.options.properties().find((def) => def.id === id)?.name ?? '', build: () => this.propertyMenuPage(id) };

    this.openPanel(key, anchor, id !== null ? 'database-layout-module-menu' : `database-layout-${key}-menu`, root);
    // The panel focuses its first control, which in the group menu is the header's Add section.
    this.moduleMenu?.panel.root.querySelector<HTMLElement>('[data-blok-database-panel-input]')?.focus();
  }

  /** Opens one builder menu on `anchor`, closing any other. */
  private openPanel(key: string, anchor: HTMLElement, testId: string, root: PanelPage): void {
    this.closeMenu();
    this.closeModuleMenu();
    const panel = new DatabasePanel({
      anchor,
      testId,
      width: 290,
      backLabel: this.label('tools.database.settingsBack'),
      root,
      onClose: () => {
        if (this.moduleMenu?.panel !== panel) return;
        this.moduleMenu = null;
        anchor.setAttribute('aria-expanded', 'false');
      },
    });

    this.menuQuery = '';
    this.renaming = null;
    this.moduleMenu = { key, anchor, panel };
    anchor.setAttribute('aria-expanded', 'true');
    panel.open();
  }

  /** Closes the open module menu, if any. The drawer's canvas ⋯ menu calls it, so only one menu is open. */
  closeModuleMenu(): void {
    const menu = this.moduleMenu;

    this.moduleMenu = null;
    if (menu === null) return;
    menu.anchor.setAttribute('aria-expanded', 'false');
    menu.panel.close();
  }

  /**
   * A property module's ••• menu: Move up / Move down (the keyboard path of the
   * drag), Move to panel or page, and Remove, which returns it to the group.
   */
  private propertyMenuPage(id: string): HTMLElement[] {
    const resolved = resolvePageLayout(this.options.layout(), this.options.properties());
    const place = resolved.pageModules.some((def) => def.id === id) ? 'page' : 'panel';
    const list = place === 'page' ? resolved.pageModules : resolved.panelModules;
    const at = list.findIndex((def) => def.id === id);
    const def = list[at];

    if (def === undefined) return [];
    const rows: HTMLElement[] = [
      panelRow({ label: this.label('tools.database.layoutMoveUp'), testId: 'database-layout-module-move-up', icon: IconArrowUp, disabled: at === 0, onClick: () => this.options.edit(moveInPlace(id, -1)) }),
      panelRow({ label: this.label('tools.database.layoutMoveDown'), testId: 'database-layout-module-move-down', icon: IconMoveDown, disabled: at === list.length - 1, onClick: () => this.options.edit(moveInPlace(id, 1)) }),
    ];

    if (place === 'panel' || canPlaceInPanel(def)) {
      const to = place === 'page' ? 'panel' : 'page';

      rows.push(panelRow({
        label: this.label(to === 'panel' ? 'tools.database.layoutMoveToPanel' : 'tools.database.layoutMoveToPage'),
        testId: 'database-layout-module-move-panel',
        icon: IconSplitView,
        onClick: () => this.options.edit(addModule(id, to, def)),
      }));
    }
    rows.push(panelSeparator(), panelRow({
      label: this.label('tools.database.layoutRemove'),
      testId: 'database-layout-module-remove',
      icon: IconMinus,
      onClick: () => {
        this.closeModuleMenu();
        this.options.edit(removeFromLayout(id));
      },
    }));

    return rows;
  }

  private toggleAddMenu(place: 'page' | 'panel', anchor: HTMLElement): void {
    const key = `add-${place}`;

    if (this.moduleMenu?.key === key) {
      this.closeModuleMenu();

      return;
    }
    this.openPanel(key, anchor, place === 'page' ? 'database-layout-add-module-menu' : 'database-layout-add-panel-menu', {
      title: this.label(place === 'page' ? 'tools.database.layoutAddToPage' : 'tools.database.layoutAddToPanel'),
      build: () => this.addMenuPage(place, anchor),
    });
  }

  /**
   * research/09 §3b L65: "Use an existing property", then "Create new property".
   * Existing ones are those still in the group; a relation never goes to the panel.
   */
  private addMenuPage(place: 'page' | 'panel', anchor: HTMLElement): HTMLElement[] {
    const resolved = resolvePageLayout(this.options.layout(), this.options.properties());
    const existing = [...resolved.group, ...resolved.sections.flatMap((entry) => entry.properties)]
      .filter((def) => place === 'page' || canPlaceInPanel(def));
    const rows: HTMLElement[] = existing.length === 0 ? [] : [
      panelLabel(this.label('tools.database.layoutUseExisting')),
      ...existing.map((def) => panelRow({
        label: def.name,
        testId: `database-layout-add-existing-${def.id}`,
        ...(def.icon !== undefined && def.icon !== '' ? { iconText: def.icon } : { icon: propertyTypeMeta(def.type).icon }),
        onClick: () => {
          this.closeModuleMenu();
          this.options.edit(addModule(def.id, place, def));
        },
      })),
      panelSeparator(),
    ];

    return [...rows, panelRow({
      label: this.label('tools.database.layoutCreateNew'),
      testId: 'database-layout-create-module',
      icon: IconPlus,
      onClick: () => {
        this.closeModuleMenu();
        // The persistent button, so the type menu still has an anchor after the redraw.
        this.options.onAddModule(anchor, place);
      },
    })];
  }

  /** research/09 anatomy L40: "»" Hide sidebar; collapsed, the column is a "«" button. */
  private setSidebar(collapsed: boolean): void {
    if (collapsed && this.moduleMenu?.key === 'add-panel') this.closeModuleMenu();
    this.panelColumn.toggleAttribute('data-collapsed', collapsed);
    this.panelBody.hidden = collapsed;
    this.panelToggle.innerHTML = collapsed ? IconChevronLeft : IconChevronRight;
    this.panelToggle.setAttribute('aria-label', this.label(collapsed ? 'tools.database.layoutShowSidebar' : 'tools.database.layoutHideSidebar'));
    this.panelToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  /** research/09 §10 L164: the column collapses on a narrow window. A later widening opens it again. */
  private watchNarrow(): void {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_BUILDER) : null;
    const onChange = (event: { matches: boolean }): void => this.setSidebar(event.matches);

    this.setSidebar(query?.matches === true);
    if (query === null) return;
    query.addEventListener('change', onChange);
    this.unwatchNarrow = () => query.removeEventListener('change', onChange);
  }

  /**
   * Pointer drag from a module's ⠿ or a pin's label (research/09 anatomy L39,
   * §8 L83). A module lands in the canvas or the side panel column, a pin among
   * the pins; the drop line marks where. A press that does not travel is a click.
   */
  private startDrag(event: PointerEvent, id: string, kind: 'module' | 'heading', source: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const def = this.options.properties().find((candidate) => candidate.id === id);
    const line = new DatabaseDropLine(this.root, this.root);
    const state: { dragging: boolean; target: { place: 'heading' | 'page' | 'panel'; beforeId: string | null } | null } = { dragging: false, target: null };
    const move = (moveEvent: PointerEvent): void => {
      if (!state.dragging && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < DRAG_THRESHOLD) return;
      state.dragging = true;
      source.setAttribute('data-dragging', '');
      state.target = kind === 'heading' ? this.pinTarget(moveEvent, id, line) : this.moduleTarget(moveEvent, def, line);
    };
    const end = (drop: boolean): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      line.destroy();
      source.removeAttribute('data-dragging');
      if (!state.dragging) return;
      this.swallowClick();
      if (drop && state.target !== null) this.options.edit(placeBefore(id, state.target.place, state.target.beforeId, def));
    };
    const up = (): void => end(true);
    const cancel = (): void => end(false);

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }

  /** The column under the pointer, and the module card the dragged one lands before. */
  private moduleTarget(event: PointerEvent, def: PropertyDefinition | undefined, line: DatabaseDropLine): { place: 'page' | 'panel'; beforeId: string | null } | null {
    const rect = this.panelColumn.getBoundingClientRect();
    const place = !this.panelBody.hidden && event.clientX >= rect.left && event.clientX <= rect.right ? 'panel' : 'page';

    if (def === undefined || (place === 'panel' && !canPlaceInPanel(def))) {
      line.hide();

      return null;
    }
    const container = place === 'panel' ? this.panelBody : this.canvas;
    const cards = [...container.querySelectorAll<HTMLElement>(':scope > [data-blok-database-layout-module="property"]')]
      .filter((card) => card.getAttribute('data-property-id') !== def.id);
    const before = cards.find((card) => {
      const box = card.getBoundingClientRect();

      return event.clientY < box.top + box.height / 2;
    });
    const end = place === 'panel' ? this.addToPanelButton : this.addModuleButton;
    const edge = before?.getBoundingClientRect().top ?? (cards.at(-1)?.getBoundingClientRect().bottom ?? end.getBoundingClientRect().top);
    const span = (place === 'panel' ? this.panelBody : this.cardOf('heading')).getBoundingClientRect();

    line.showHorizontal({ left: span.left, width: span.width, centerY: before === undefined && cards.length > 0 ? edge + CARD_GAP_HALF : edge - CARD_GAP_HALF });

    return { place, beforeId: before?.getAttribute('data-property-id') ?? null };
  }

  /** The pin the dragged one lands before, along the strip's reading direction. */
  private pinTarget(event: PointerEvent, id: string, line: DatabaseDropLine): { place: 'heading'; beforeId: string | null } {
    const rtl = getComputedStyle(this.canvas).direction === 'rtl';
    const pins = [...this.cardOf('heading').querySelectorAll<HTMLElement>('[data-blok-database-drawer-pin]')]
      .filter((pinEl) => pinEl.getAttribute('data-property-id') !== id);
    const before = pins.find((pinEl) => {
      const box = pinEl.getBoundingClientRect();
      const middle = box.left + box.width / 2;

      return rtl ? event.clientX > middle : event.clientX < middle;
    });
    const last = pins.at(-1)?.getBoundingClientRect();
    const box = before?.getBoundingClientRect() ?? last;

    if (box !== undefined) {
      const startEdge = rtl ? box.right : box.left;
      const endEdge = rtl ? box.left : box.right;

      line.showVertical({ centerX: before !== undefined ? startEdge : endEdge, top: box.top, height: box.height });
    }

    return { place: 'heading', beforeId: before?.getAttribute('data-property-id') ?? null };
  }

  /** The click that ends a drag is not a module pick. */
  private swallowClick(): void {
    const stop = (click: Event): void => {
      click.stopPropagation();
      click.preventDefault();
    };

    this.root.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => this.root.removeEventListener('click', stop, { capture: true }), 0);
  }

  /** The menu's property search. It filters `rows` by name, live, and keeps focus. */
  private menuSearch(testId: string, rows: HTMLElement[]): HTMLInputElement {
    const filter = (): void => {
      for (const row of rows) row.hidden = !(row.getAttribute('data-name') ?? '').includes(this.menuQuery.trim().toLowerCase());
    };
    const search = panelInput({
      value: this.menuQuery,
      placeholder: this.label('tools.database.layoutSearchProperties'),
      testId,
      label: this.label('tools.database.layoutSearchProperties'),
      onInput: (value) => {
        this.menuQuery = value;
        filter();
      },
    });

    search.type = 'search';
    filter();

    return search;
  }

  /**
   * research/09 §3 L56, research/10 §3: search, the group's properties (pins
   * not) with an eye each, then each section with its own rows and "+ Add a
   * property", then the group's "+ Add a property" and Move to panel or page.
   */
  private groupMenuPage(panel: DatabasePanel): HTMLElement[] {
    const layout = this.options.layout();
    const resolved = resolvePageLayout(layout, this.options.properties());
    const list = document.createElement('div');
    const loose = document.createElement('div');
    const rows = resolved.group.map((def) => this.groupRow(def, panel, resolved));
    const add = this.button('data-blok-database-layout-add-group-property', null, 'tools.database.addProperty', (el) => {
      this.closeModuleMenu();
      this.options.onAddToGroup(this.modules.get('group')?.menu ?? el);
    });
    const toPanel = layout.groupIn === 'page';

    list.setAttribute('data-blok-database-layout-group-list', '');
    loose.setAttribute('data-blok-database-layout-menu-group', '');
    loose.append(...rows);
    list.append(loose);
    resolved.sections.forEach(({ section, properties }, index) => {
      const block = document.createElement('div');
      const sectionRows = properties.map((def) => this.groupRow(def, panel, resolved));
      const addHere = this.button('data-blok-database-layout-add-section-property', null, 'tools.database.addProperty', (el) => {
        this.closeModuleMenu();
        this.options.onAddToSection(this.modules.get('group')?.menu ?? el, section.id);
      });

      block.setAttribute('data-blok-database-layout-menu-section', '');
      block.setAttribute('data-section-id', section.id);
      addHere.setAttribute('data-section-id', section.id);
      block.append(this.renaming?.id === section.id ? this.renameField(section.id, panel) : this.sectionRow(section.id, section.name, index, resolved.sections.length, panel), ...sectionRows, addHere);
      rows.push(...sectionRows);
      list.append(block);
    });

    return [
      this.menuSearch('database-layout-group-search', rows),
      list,
      add,
      panelSeparator(),
      panelRow({
        label: this.label(toPanel ? 'tools.database.layoutMoveToPanel' : 'tools.database.layoutMoveToPage'),
        testId: 'database-layout-group-move',
        icon: IconSplitView,
        onClick: () => this.options.edit(setGroupIn(toPanel ? 'panel' : 'page')),
      }),
    ];
  }

  /** research/10 §3: ⠿ + name. A click opens Rename · Move up / Move down (valid ones only) · Delete. */
  private sectionRow(id: string, name: string, index: number, count: number, panel: DatabasePanel): HTMLElement {
    const testId = `database-layout-section-${id}`;
    const row = this.button('data-blok-database-layout-section-row', null, null, () => panel.push({
      title: name,
      returnFocus: testId,
      build: () => {
        const rows = [panelRow({ label: this.label('tools.database.layoutRenameSection'), testId: 'database-layout-section-rename', icon: IconPencil, onClick: () => {
          panel.back();
          this.renaming = { id, value: name };
          panel.refresh();
          this.focusRename();
        } })];
        const move = (step: 1 | -1): void => {
          panel.back();
          this.options.edit(moveSection(id, step));
        };

        if (index > 0) rows.push(panelRow({ label: this.label('tools.database.layoutMoveUp'), testId: 'database-layout-section-move-up', icon: IconArrowUp, onClick: () => move(-1) }));
        if (index < count - 1) rows.push(panelRow({ label: this.label('tools.database.layoutMoveDown'), testId: 'database-layout-section-move-down', icon: IconMoveDown, onClick: () => move(1) }));
        rows.push(panelRow({
          label: this.label('tools.database.layoutDeleteSection'),
          description: this.label('tools.database.layoutDeleteSectionHint'),
          testId: 'database-layout-section-delete',
          icon: IconTrash,
          onClick: () => {
            panel.back();
            this.options.edit(deleteSection(id));
          },
        }));

        return rows;
      },
    }));
    const handle = document.createElement('span');
    const label = document.createElement('span');

    row.setAttribute('data-blok-testid', testId);
    handle.setAttribute('data-blok-database-layout-section-handle', '');
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = IconMenu;
    label.textContent = name;
    row.append(handle, label);

    return row;
  }

  /** The section name field with "Done" (research/10 §3). Done or Enter commits; Escape closes the menu. */
  private renameField(id: string, panel: DatabasePanel): HTMLElement {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    const commit = (): void => {
      const value = this.renaming?.value.trim() ?? '';
      const current = this.options.layout().sections.find((section) => section.id === id)?.name;

      this.renaming = null;
      if (value !== '' && value !== current) {
        this.options.edit(renameSection(id, value));
      } else {
        panel.refresh();
      }
      panel.root.querySelector<HTMLElement>(`[data-blok-testid="database-layout-section-${CSS.escape(id)}"]`)?.focus();
    };

    wrap.setAttribute('data-blok-database-layout-section-rename', '');
    input.type = 'text';
    input.value = this.renaming?.value ?? '';
    input.setAttribute('aria-label', this.label('tools.database.layoutSectionName'));
    input.setAttribute('data-blok-testid', `database-layout-section-name-${id}`);
    input.addEventListener('input', () => {
      if (this.renaming !== null) this.renaming.value = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      commit();
    });
    wrap.append(input, this.button('data-blok-database-layout-section-done', null, 'tools.database.layoutSectionDone', commit));

    return wrap;
  }

  private focusRename(): void {
    const input = this.moduleMenu?.panel.root.querySelector<HTMLInputElement>('[data-blok-database-layout-section-rename] input');

    input?.focus();
    input?.select();
  }

  /**
   * research/09 §5: ⠿, type glyph, name, and an always-visible eye whose glyph
   * shows the state. With sections, the name opens Move to {section} / Remove
   * from section: the keyboard path of the drag (research/10 §3).
   */
  private groupRow(def: PropertyDefinition, panel: DatabasePanel, resolved: ResolvedPageLayout): HTMLElement {
    const row = document.createElement('div');
    const handle = document.createElement('span');
    const name = resolved.sections.length > 0 ? this.button('data-blok-database-layout-group-name', null, null, () => panel.push({
      title: def.name,
      returnFocus: `database-layout-group-name-${def.id}`,
      build: () => this.sectionMovesPage(def.id, panel),
    })) : document.createElement('span');
    const visibility = this.options.visibility(def.id);
    const eyeId = `database-layout-eye-${def.id}`;
    const eye = this.button('data-blok-database-layout-eye', EYE[visibility], null, () => panel.push({
      title: def.name,
      returnFocus: eyeId,
      build: () => (['always', 'hideWhenEmpty', 'hidden'] as const).map((choice) => panelRow({
        label: this.label(`tools.database.pageVisibility.${choice}`),
        testId: `database-layout-visibility-${choice}`,
        icon: EYE[choice],
        checked: this.options.visibility(def.id) === choice,
        onClick: () => {
          panel.back();
          this.options.setVisibility(def.id, choice);
        },
      })),
    }));

    row.setAttribute('data-blok-database-layout-group-row', '');
    row.setAttribute('data-property-id', def.id);
    row.setAttribute('data-name', def.name.toLowerCase());
    handle.setAttribute('data-blok-database-layout-group-handle', '');
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = IconMenu;
    handle.addEventListener('pointerdown', (event) => this.startRowDrag(event, def.id, row));
    name.setAttribute('data-blok-database-layout-group-name', '');
    name.setAttribute('data-blok-testid', `database-layout-group-name-${def.id}`);
    name.textContent = def.name;
    eye.setAttribute('data-blok-testid', eyeId);
    eye.setAttribute('data-visibility', visibility);
    eye.setAttribute('aria-label', this.label('tools.database.layoutVisibilityAria', { name: def.name }));
    row.append(handle, this.typeIcon(def, 'data-blok-database-layout-group-icon'), name, eye);

    return row;
  }

  private sectionMovesPage(id: string, panel: DatabasePanel): HTMLElement[] {
    const resolved = resolvePageLayout(this.options.layout(), this.options.properties());
    const current = resolved.sections.find((entry) => entry.properties.some((def) => def.id === id))?.section;
    const move = (sectionId: string | null): void => {
      panel.back();
      this.options.edit(moveToSection(id, sectionId));
    };
    const rows = resolved.sections
      .filter(({ section }) => section.id !== current?.id)
      .map(({ section }) => panelRow({
        label: this.label('tools.database.layoutMoveToSection', { name: section.name }),
        testId: `database-layout-move-to-section-${section.id}`,
        onClick: () => move(section.id),
      }));

    if (current !== undefined) {
      rows.push(panelRow({ label: this.label('tools.database.layoutLeaveSection'), testId: 'database-layout-leave-section', onClick: () => move(null) }));
    }

    return rows;
  }

  /**
   * Drags a property row in the group menu into a section, or into the group
   * outside them (research/10 §3). The line mounts in the menu: it is in the
   * top layer, above the builder.
   */
  private startRowDrag(event: PointerEvent, id: string, source: HTMLElement): void {
    const menu = this.moduleMenu?.panel.root;

    if (event.button !== 0 || menu === undefined) return;
    event.preventDefault();
    const line = new DatabaseDropLine(this.root, menu);
    const state: { dragging: boolean; target: { sectionId: string | null; order: string[] } | null } = { dragging: false, target: null };
    const move = (moveEvent: PointerEvent): void => {
      if (!state.dragging && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < DRAG_THRESHOLD) return;
      state.dragging = true;
      source.setAttribute('data-dragging', '');
      state.target = this.rowTarget(moveEvent, id, menu, line);
    };
    const end = (drop: boolean): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      line.destroy();
      source.removeAttribute('data-dragging');
      if (drop && state.dragging && state.target !== null) this.options.edit(arrangeSection(id, state.target.sectionId, state.target.order));
    };
    const up = (): void => end(true);
    const cancel = (): void => end(false);

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }

  /** The list under the pointer (the group or a section) and its order with the dragged row dropped in. */
  private rowTarget(event: PointerEvent, id: string, menu: HTMLElement, line: DatabaseDropLine): { sectionId: string | null; order: string[] } | null {
    const blocks = [...menu.querySelectorAll<HTMLElement>('[data-blok-database-layout-menu-group], [data-blok-database-layout-menu-section]')]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0);
    const distance = (box: DOMRect): number => Math.max(box.top - event.clientY, event.clientY - box.bottom, 0);
    const block = blocks.reduce<(typeof blocks)[number] | undefined>((best, next) => (best === undefined || distance(next.box) < distance(best.box) ? next : best), undefined);

    if (block === undefined) {
      line.hide();

      return null;
    }
    const rows = [...block.el.querySelectorAll<HTMLElement>('[data-blok-database-layout-group-row]')]
      .filter((row) => !row.hidden && row.getAttribute('data-property-id') !== id);
    const before = rows.find((row) => {
      const box = row.getBoundingClientRect();

      return event.clientY < box.top + box.height / 2;
    });
    const header = block.el.querySelector<HTMLElement>('[data-blok-database-layout-section-row], [data-blok-database-layout-section-rename]');
    const edge = before?.getBoundingClientRect().top ?? rows.at(-1)?.getBoundingClientRect().bottom ?? header?.getBoundingClientRect().bottom ?? block.box.top;
    const order = rows.map((row) => row.getAttribute('data-property-id') ?? '');
    const at = before === undefined ? order.length : rows.indexOf(before);

    line.showHorizontal({ left: block.box.left, width: block.box.width, centerY: edge });
    order.splice(at, 0, id);

    return { sectionId: block.el.getAttribute('data-section-id'), order };
  }

  /** The property's own icon, else its type glyph. Builder menus keep it whatever Property icons says (research/09 §8). */
  private typeIcon(def: PropertyDefinition, attr: string): HTMLElement {
    const icon = document.createElement('span');

    icon.setAttribute(attr, '');
    icon.setAttribute('aria-hidden', 'true');
    if (def.icon !== undefined && def.icon !== '') {
      icon.textContent = def.icon;
    } else {
      icon.innerHTML = propertyTypeMeta(def.type).icon;
    }

    return icon;
  }

  private headingMenuPage(panel: DatabasePanel): HTMLElement[] {
    const layout = this.options.layout();
    const properties = this.options.properties();
    // Counts every pin, so a search that hides some never lifts the limit.
    const pinned = resolvePageLayout(layout, properties).heading;
    const pinnedIds = new Set(pinned.map((def) => def.id));
    const full = pinned.length >= PAGE_LAYOUT_PIN_LIMIT;
    const rows: HTMLElement[] = [];
    const list = (kind: 'pinned' | 'unpinned', defs: PropertyDefinition[]): HTMLElement => {
      const el = document.createElement('div');

      el.setAttribute('data-blok-database-layout-pin-list', kind);
      for (const def of defs) {
        const row = this.pinRow(def, kind === 'pinned' ? panel : null, kind === 'unpinned' && full);

        rows.push(row);
        el.appendChild(row);
      }

      return el;
    };
    const pinnedList = list('pinned', pinned);
    const unpinnedList = list('unpinned', properties.filter((def) => !pinnedIds.has(def.id)));
    const add = this.button('data-blok-database-layout-add-pin', null, 'tools.database.addProperty', (el) => {
      this.closeModuleMenu();
      this.options.onAddPin(this.modules.get('heading')?.menu ?? el);
    });

    add.disabled = full;
    pinnedList.appendChild(add);

    return [
      this.menuSearch('database-layout-heading-search', rows),
      panelLabel(this.label('tools.database.layoutPinnedProperties')),
      pinnedList,
      panelLabel(this.label('tools.database.layoutUnpinnedProperties')),
      unpinnedList,
      panelLabel(this.label('tools.database.layoutOptions')),
      panelSwitch({
        label: this.label('tools.database.layoutPropertyLabels'),
        testId: 'database-layout-option-layoutPropertyLabels',
        checked: layout.propertyLabels,
        onToggle: (next) => this.options.edit(setPropertyLabels(next)),
      }),
    ];
  }

  /**
   * research/09 §3: type glyph, name, and an always-visible pin button. A pin's
   * name opens Move up / Move down, the keyboard path of the pin drag.
   */
  private pinRow(def: PropertyDefinition, panel: DatabasePanel | null, disabled: boolean): HTMLElement {
    const pinned = panel !== null;
    const row = document.createElement('div');
    const name = panel === null ? document.createElement('span') : this.button('data-blok-database-layout-pin-name', null, null, () => panel.push({
      title: def.name,
      returnFocus: `database-layout-pin-name-${def.id}`,
      build: () => this.pinMovesPage(def.id, panel),
    }));
    const toggle = this.button('data-blok-database-layout-pin-toggle', pinned ? IconPinFilled : IconPin, null, () => {
      this.options.edit(pinned ? removeFromLayout(def.id) : pin(def.id));
    });

    row.setAttribute('data-blok-database-layout-pin-row', '');
    row.setAttribute('data-property-id', def.id);
    row.setAttribute('data-name', def.name.toLowerCase());
    name.setAttribute('data-blok-database-layout-pin-name', '');
    if (pinned) name.setAttribute('data-blok-testid', `database-layout-pin-name-${def.id}`);
    name.textContent = def.name;
    toggle.setAttribute('data-blok-testid', `database-layout-pin-${def.id}`);
    toggle.setAttribute('aria-label', this.label(pinned ? 'tools.database.layoutUnpinAria' : 'tools.database.layoutPinAria', { name: def.name }));
    toggle.toggleAttribute('data-pinned', pinned);
    toggle.disabled = disabled;
    row.append(this.typeIcon(def, 'data-blok-database-layout-pin-icon'), name, toggle);

    return row;
  }

  private pinMovesPage(id: string, panel: DatabasePanel): HTMLElement[] {
    const pins = resolvePageLayout(this.options.layout(), this.options.properties()).heading;
    const at = pins.findIndex((def) => def.id === id);
    const move = (step: 1 | -1): void => {
      panel.back();
      this.options.edit(moveInPlace(id, step));
    };
    const rows: HTMLElement[] = [];

    if (at > 0) rows.push(panelRow({ label: this.label('tools.database.layoutMoveUp'), testId: 'database-layout-pin-move-up', icon: IconArrowUp, onClick: () => move(-1) }));
    if (at !== -1 && at < pins.length - 1) rows.push(panelRow({ label: this.label('tools.database.layoutMoveDown'), testId: 'database-layout-pin-move-down', icon: IconMoveDown, onClick: () => move(1) }));

    return rows;
  }

  /**
   * research/09 §10, research/10 §2: Structure cards, then Options switches.
   * Property labels sits in the Heading menu, not here (research/10 §3).
   */
  private pageSettings(): HTMLElement[] {
    const title = document.createElement('h2');
    const structure = document.createElement('div');
    const optionsTitle = document.createElement('h3');
    const options = document.createElement('div');

    title.setAttribute('data-blok-database-layout-settings-title', '');
    title.textContent = this.label('tools.database.layoutPageSettings');
    structure.setAttribute('data-blok-database-layout-structure', '');
    structure.setAttribute('role', 'group');
    structure.setAttribute('aria-label', this.label('tools.database.layoutStructure'));
    // Tabbed only sets the structure here; tabs as blocks come later (plan Phase 12).
    structure.append(
      this.structureCard('simple', IconSplitView, 'tools.database.layoutStructureSimple'),
      this.structureCard('tabbed', IconTabs, 'tools.database.layoutStructureTabbed')
    );
    optionsTitle.setAttribute('data-blok-database-layout-options-title', '');
    optionsTitle.textContent = this.label('tools.database.layoutOptions');
    options.setAttribute('data-blok-database-layout-options', '');
    options.append(
      this.option('tools.database.layoutPropertyIcons', null, (layout) => layout.propertyIcons, setPropertyIcons),
      this.option('tools.database.layoutFullWidth', 'tools.database.layoutFullWidthHint', (layout) => layout.fullWidth, setFullWidth),
      this.option('tools.database.layoutTemplates', 'tools.database.layoutTemplatesHint', (layout) => layout.templates, setTemplates)
    );
    this.refresh();

    return [title, structure, optionsTitle, options];
  }

  private structureCard(structure: PageLayoutData['structure'], icon: string, key: string): HTMLButtonElement {
    const card = this.button('data-blok-database-layout-structure-card', null, null, () => this.options.edit(setStructure(structure)));
    const art = document.createElement('span');
    const name = document.createElement('span');

    art.setAttribute('data-blok-database-layout-structure-art', '');
    art.innerHTML = icon;
    name.textContent = this.label(key);
    card.append(art, name);
    this.settings.push({ control: card, state: 'aria-pressed', on: (layout) => layout.structure === structure });

    return card;
  }

  /**
   * An (i) whose hint shows on hover only (hint law), and the same text for
   * keyboard and screen reader users: the (i) takes no focus, so `toggle`
   * is described by it instead.
   */
  private hintParts(toggle: HTMLElement, hint: string): { info: HTMLElement; description: HTMLElement } {
    const info = document.createElement('span');
    const description = document.createElement('span');

    info.setAttribute('data-blok-database-layout-hint', '');
    info.innerHTML = IconInfo;
    onHover(info, hint);
    description.id = `blok-database-layout-hint-${nanoid()}`;
    description.setAttribute('data-blok-database-sr-only', '');
    description.textContent = hint;
    toggle.setAttribute('aria-describedby', description.id);

    return { info, description };
  }

  /**
   * A disabled switch with a hint. Some browsers fire no mouse events inside a
   * disabled button, so the label and the (i) sit outside it, in the row, and
   * the button keeps only the track.
   */
  private lockedSwitch(toggle: HTMLButtonElement, hint: string): HTMLElement {
    const row = document.createElement('div');
    const label = toggle.querySelector('[data-blok-database-panel-label]');
    const { info, description } = this.hintParts(toggle, hint);

    row.setAttribute('data-blok-database-panel-row', '');
    row.setAttribute('data-blok-database-layout-locked', '');
    toggle.setAttribute('aria-label', label?.textContent ?? '');
    if (label !== null) row.append(label);
    row.append(info, toggle, description);

    return row;
  }

  /** A switch row; a hint shows on hovering its (i) only (hint law). */
  private option(key: string, hintKey: string | null, on: (layout: PageLayoutData) => boolean, op: (next: boolean) => PageLayoutOp): HTMLElement {
    const row = document.createElement('div');
    const toggle = panelSwitch({
      label: this.label(key),
      testId: `database-layout-option-${key.slice(key.lastIndexOf('.') + 1)}`,
      checked: false,
      onToggle: (next) => this.options.edit(op(next)),
    });

    row.setAttribute('data-blok-database-layout-option', '');
    row.append(toggle);
    this.settings.push({ control: toggle, state: 'aria-checked', on });
    if (hintKey === null) return row;
    const { info, description } = this.hintParts(toggle, this.label(hintKey));

    toggle.querySelector('[data-blok-database-panel-label]')?.after(info);
    row.append(description);

    return row;
  }

  /**
   * The tab bar's "Add tab". Notion adds it on hover only; here it stays in
   * the DOM so keyboard and touch reach it, and CSS shows it on hover or focus.
   */
  addTabButton(tabs: BuilderTabs): HTMLButtonElement {
    const add = this.button('data-blok-database-layout-add-tab', IconPlus, null, (el) => this.openAddTab(el, tabs));

    add.setAttribute('aria-label', this.label('tools.database.layoutAddTab'));
    add.setAttribute('aria-haspopup', 'menu');

    return add;
  }

  /** research/10 §2: Add tab > Link existing data source > a database > View name > Add view. */
  private openAddTab(anchor: HTMLElement, tabs: BuilderTabs): void {
    const form = (source: { id: string; title: string }): PanelPage => {
      const state = { name: source.title, relation: false, relatedName: '', built: false };

      return {
        title: this.label('tools.database.layoutLinkDataSource'),
        build: (panel) => {
          // research/14 §5: the database name, suffixed " N" only when the source has it; the same in every language.
          const relatedPlaceholder = freePropertyName(tabs.propertyNames?.(source.id) ?? [], tabs.thisDatabase() !== '' ? tabs.thisDatabase() : this.label('tools.database.relationUntitledDatabase'));
          const nameLabel = this.label(state.relation ? 'tools.database.layoutViewRelationName' : 'tools.database.layoutViewName');
          const field = panelInput({
            value: state.name,
            placeholder: nameLabel,
            testId: 'database-layout-view-name',
            label: nameLabel,
            onInput: (value) => {
              state.name = value;
            },
          });
          const submit = (): void => {
            const name = state.name.trim() !== '' ? state.name.trim() : source.title;

            panel.close();
            if (state.relation) {
              // research/13 §2: a field left empty takes its placeholder.
              tabs.addWithRelation(source.id, name, state.relatedName.trim() !== '' ? state.relatedName.trim() : relatedPlaceholder);
            } else {
              tabs.add(source.id, name);
            }
          };
          const onEnter = (input: HTMLInputElement): void => input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              submit();
            }
          });
          // research/13 §1d: "View of" names the source. Changing it from here is unmeasured, so the row is not a control.
          const viewOf = document.createElement('div');
          const viewOfLabel = document.createElement('span');
          const viewOfValue = document.createElement('span');

          viewOf.setAttribute('data-blok-database-panel-row', '');
          viewOf.setAttribute('data-blok-testid', 'database-layout-view-of');
          viewOfLabel.setAttribute('data-blok-database-panel-label', '');
          viewOfLabel.textContent = this.label('tools.database.layoutViewOf');
          viewOfValue.setAttribute('data-blok-database-panel-value', '');
          viewOfValue.textContent = source.title;
          viewOf.append(viewOfLabel, viewOfValue);
          onEnter(field);
          // First build only: a rebuild (the switch) must not select what was typed.
          if (!state.built) queueMicrotask(() => field.select());
          state.built = true;
          const relationRows: HTMLElement[] = [];

          if (tabs.canRelate(source.id)) {
            relationRows.push(panelSwitch({
              label: this.label('tools.database.layoutAddNewRelation'),
              testId: 'database-layout-add-relation',
              checked: state.relation,
              onToggle: (next) => {
                state.relation = next;
                panel.refresh();
              },
            }));
          }
          if (state.relation) {
            // Locked on: tabbed views need a two-way relation (research/13 §2).
            const twoWay = panelSwitch({ label: this.label('tools.database.layoutTwoWayRelation'), testId: 'database-layout-two-way', checked: true, disabled: true, onToggle: () => undefined });
            const related = panelInput({
              value: state.relatedName,
              placeholder: relatedPlaceholder,
              testId: 'database-layout-related-name',
              label: this.label('tools.database.layoutRelatedPropertyName'),
              onInput: (value) => {
                state.relatedName = value;
              },
            });

            onEnter(related);
            relationRows.push(this.lockedSwitch(twoWay, this.label('tools.database.layoutTwoWayRelationHint')), panelLabel(this.label('tools.database.layoutRelatedPropertyName')), related);
          }

          return [
            panelLabel(nameLabel),
            field,
            viewOf,
            ...relationRows,
            panelRow({ label: this.label(state.relation ? 'tools.database.layoutAddViewRelation' : 'tools.database.layoutAddView'), testId: 'database-layout-add-view', icon: IconPlus, onClick: submit }),
          ];
        },
      };
    };
    const picker: PanelPage = {
      title: this.label('tools.database.layoutLinkDataSource'),
      build: (panel) => {
        const rows = tabs.sources().map((source) => {
          const title = source.title !== '' ? source.title : this.label('tools.database.relationUntitledDatabase');
          const row = panelRow({ label: title, testId: `database-layout-source-${source.id}`, icon: IconDatabase, onClick: () => panel.push(form({ id: source.id, title })) });

          row.setAttribute('data-name', title.toLowerCase());

          return row;
        });
        const search = this.menuSearch('database-layout-source-search', rows);

        search.placeholder = this.label('tools.database.layoutLinkDataSourceSearch');
        search.setAttribute('aria-label', this.label('tools.database.layoutLinkDataSourceSearch'));

        return [search, panelLabel(this.label('tools.database.layoutExistingDataSources')), ...rows];
      },
    };

    this.openPanel('add-tab', anchor, 'database-layout-add-tab-menu', {
      build: (panel) => {
        const related = tabs.related();
        const link = panelRow({ label: this.label('tools.database.layoutLinkDataSource'), testId: 'database-layout-link-data-source', icon: IconDatabase, onClick: () => panel.push(picker) });

        if (related.length === 0) return [link];
        const name = tabs.thisDatabase();

        return [
          panelLabel(this.label('tools.database.layoutRelatedTo', { name: name !== '' ? name : this.label('tools.database.relationUntitledDatabase') })),
          ...related.map((relation) => panelRow({
            label: relation.title !== '' ? relation.title : this.label('tools.database.relationUntitledDatabase'),
            testId: `database-layout-related-${relation.propertyId}`,
            icon: IconArrowDiagonal,
            onClick: () => {
              panel.close();
              tabs.addRelated(relation.propertyId);
            },
          })),
          panelSeparator(),
          link,
        ];
      },
    });
  }

  /**
   * Clicking the selected tab (research/10 §2): its name, and for a view tab
   * "Delete view" behind "Delete this view?". Content has no delete.
   */
  openTabMenu(anchor: HTMLElement, tab: { id: string; title: string; content: boolean }, tabs: BuilderTabs): void {
    const current = { title: tab.title };

    this.openPanel(`tab:${tab.id}`, anchor, 'database-layout-tab-menu', {
      title: this.label('tools.database.settingsTitle'),
      build: (panel) => {
        const field = panelInput({
          value: tab.title,
          placeholder: this.label('tools.database.layoutViewName'),
          testId: 'database-layout-tab-name',
          label: this.label('tools.database.layoutViewName'),
          onInput: (value) => {
            current.title = value;
            tabs.rename(tab.id, value);
          },
        });

        if (tab.content) return [field];

        return [field, panelSeparator(), panelRow({
          label: this.label('tools.database.layoutDuplicateView'),
          testId: 'database-layout-duplicate-view',
          icon: IconCopy,
          onClick: () => {
            panel.close();
            tabs.duplicate(tab.id);
          },
        }), panelRow({
          label: this.label('tools.database.layoutDeleteView'),
          testId: 'database-layout-delete-view',
          icon: IconTrash,
          danger: true,
          onClick: () => {
            panel.close();
            this.askDeleteView(tab.id, current.title, tabs);
          },
        })];
      },
    });
  }

  private askDeleteView(tabId: string, name: string, tabs: BuilderTabs): void {
    const confirm = new AbortController();

    this.confirm = confirm;
    void openDatabaseConfirm({
      title: this.label('tools.database.layoutDeleteViewTitle'),
      confirmLabel: this.label('tools.database.layoutDeleteView'),
      cancelLabel: this.label('tools.database.layoutCancel'),
      destructive: true,
      directionSource: this.root,
      // Over this modal: two focus traps on body would pull focus back and forth.
      container: this.root,
      signal: confirm.signal,
    }).then((ok) => {
      if (this.confirm !== confirm) return;
      this.confirm = null;
      if (ok) tabs.remove(tabId, name);
    });
  }

  /** Cancel: with edits, asks first (research/09 §3b). */
  private cancel(): void {
    if (!this.options.hasEdits()) {
      this.options.onDiscard();

      return;
    }
    void this.askDiscard();
  }

  /**
   * "Discard all layout changes?"; Discard drops the draft.
   * @returns true when the user discarded; false on Cancel, or when the question was replaced or the builder closed
   */
  private askDiscard(): Promise<boolean> {
    const confirm = new AbortController();

    this.closeMenu();
    this.closeModuleMenu();
    // A second ask replaces the open question; the first resolves false.
    this.confirm?.abort();
    this.confirm = confirm;

    return openDatabaseConfirm({
      title: this.label('tools.database.layoutDiscardTitle'),
      confirmLabel: this.label('tools.database.layoutDiscard'),
      cancelLabel: this.label('tools.database.layoutCancel'),
      destructive: true,
      filled: true,
      directionSource: this.root,
      // Over this modal: two focus traps on body would pull focus back and forth.
      container: this.root,
      signal: confirm.signal,
    }).then((discard) => {
      if (this.confirm !== confirm) return false;
      this.confirm = null;
      if (discard) this.options.onDiscard();

      return discard;
    });
  }

  /** research/10 §5: Reset asks first, then applies at once. */
  private askReset(): void {
    const confirm = new AbortController();

    this.closeMenu();
    this.closeModuleMenu();
    this.confirm = confirm;
    void openDatabaseConfirm({
      title: this.label('tools.database.layoutResetConfirmTitle'),
      description: this.label('tools.database.layoutResetConfirmBody'),
      confirmLabel: this.label('tools.database.layoutResetConfirm'),
      cancelLabel: this.label('tools.database.layoutCancel'),
      destructive: true,
      filled: true,
      art: [IconUndo],
      closeLabel: this.label('tools.database.close'),
      largeTitle: true,
      small: true,
      quietCancel: true,
      directionSource: this.root,
      // Over this modal: two focus traps on body would pull focus back and forth.
      container: this.root,
      signal: confirm.signal,
    }).then((reset) => {
      if (this.confirm !== confirm) return;
      this.confirm = null;
      if (reset) this.options.onReset();
    });
  }

  /**
   * research/09 §2: a focused "Search pages…" field over every page. The
   * previewed one has a trailing check and no fill. Pages come in view order (Q4).
   */
  private openPreview(anchor: HTMLElement): void {
    const pages = this.options.pages();
    const current = this.options.previewId();
    const empty = document.createElement('div');

    empty.setAttribute('data-blok-database-layout-preview-empty', '');
    empty.textContent = this.label('tools.database.layoutPreviewEmpty');
    const items: PopoverItemParams[] = pages.length === 0
      ? [{ type: PopoverItemType.Html, element: empty }]
      : pages.map((page) => ({
        type: PopoverItemType.Default,
        name: `preview-${page.id}`,
        title: this.pageTitle(page.title),
        icon: IconPage,
        ...(page.id === current ? { trailingIcon: IconCheck } : {}),
        closeOnActivate: true,
        onActivate: () => this.options.onPreview(page.id),
      }));

    this.showMenu(new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '300px',
      searchable: true,
      messages: {
        search: this.label('tools.database.layoutPreviewSearch'),
        nothingFound: this.label('tools.database.layoutPreviewEmpty'),
      },
      items,
    }));
  }

  /** Apply's chevron half: "Reset to original page layout" (research/10 §5). */
  private openMoreSave(anchor: HTMLElement): void {
    this.showMenu(new PopoverDesktop({
      class: `${DATABASE_MENU_CLASS} blok-database-layout-reset-menu`,
      trigger: anchor,
      width: 'auto',
      // notion-spec-2 §11: Notion's menu is 254 wide.
      minWidth: '254px',
      autoFocusFirstItem: false,
      items: [{
        type: PopoverItemType.Default,
        name: 'reset',
        icon: IconUndo,
        title: this.label('tools.database.layoutReset'),
        description: this.label('tools.database.layoutResetDescription'),
        closeOnActivate: true,
        onActivate: () => this.askReset(),
      }] as PopoverItemParams[],
    }));
  }

  private showMenu(menu: PopoverDesktop): void {
    this.closeMenu();
    this.closeModuleMenu();
    menu.on(PopoverEvent.Closed, () => {
      if (this.menu === menu) {
        this.menu = null;
        menu.destroy();
      }
    });
    this.menu = menu;
    menu.show();
  }

  private closeMenu(): void {
    const menu = this.menu;

    this.menu = null;
    menu?.destroy();
  }

  private button(attr: string, icon: string | null, key: string | null, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attr, '');
    if (icon !== null) button.innerHTML = icon;
    if (key !== null) button.append(this.label(key));
    button.addEventListener('click', () => onClick(button));

    return button;
  }

  private pageTitle(title: string): string {
    return title.trim() !== '' ? title : this.label('tools.database.layoutNewPage');
  }

  private label(key: string, vars?: Record<string, string>): string {
    const fallback = databaseEnglish(key) ?? key;

    return this.options.i18n?.t(key, vars) ?? fallback.replace(/\{(\w+)\}/g, (match, name: string) => vars?.[name] ?? match);
  }
}

/** Puts `children` in `parent` in order, moving only what is out of place, so focus stays put. */
const syncChildren = (parent: HTMLElement, children: HTMLElement[]): void => {
  children.forEach((child, index) => {
    if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] ?? null);
  });
  while (parent.children.length > children.length) parent.lastElementChild?.remove();
};
