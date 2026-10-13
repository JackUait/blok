import { nanoid } from 'nanoid';
import type { I18n } from '../../../types';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconCheck, IconChevronDown, IconCross, IconDatabase, IconDotsHorizontal, IconEyeClosed, IconEyeSlash, IconInfo, IconPage, IconPin, IconPinFilled, IconPlus, IconPreview, IconSplitView, IconTabs } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import { onHover } from '../../components/utils/tooltip';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { DatabasePanel, panelInput, panelLabel, panelRow, panelSeparator, panelSwitch } from './database-panel';
import type { PanelPage } from './database-panel';
import { propertyTypeMeta } from './database-property-types';
import {
  PAGE_LAYOUT_PIN_LIMIT,
  addSection,
  pin,
  removeFromLayout,
  resolvePageLayout,
  setFullWidth,
  setGroupIn,
  setPropertyIcons,
  setPropertyLabels,
  setStructure,
  setTemplates,
} from './page-layout';
import type { PageLayoutData, PageLayoutOp } from './page-layout';
import type { PageVisibility, PropertyDefinition } from './types';

/** A page the Preview switch offers. */
export interface PreviewPage {
  id: string;
  title: string;
}

export interface PageLayoutBuilderOptions {
  i18n?: I18n;
  /** The database's name for the top bar. Empty shows the new-database placeholder. */
  title: string;
  /** The live element whose direction the builder takes: it mounts outside the editor. */
  directionSource: Element | null;
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
  /** A property's page visibility, with the draft's eye edit if any. */
  visibility: (id: string) => PageVisibility;
  /** An eye edit. It is a draft: Apply writes it on the property. */
  setVisibility: (id: string, visibility: PageVisibility) => void;
}

/** The canvas modules (research/09 anatomy L39). Page discussions is skipped (plan §2.4). */
export type PageLayoutModule = 'heading' | 'group' | 'content';

const MODULE_NAMES: Record<PageLayoutModule, string> = {
  heading: 'tools.database.layoutModuleHeading',
  group: 'tools.database.layoutModuleGroup',
  content: 'tools.database.layoutModuleContent',
};

/** Modules with a ••• menu. Content's menu was not measured. */
type MenuModule = 'heading' | 'group';

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
  /** Module cards are built once, so a menu's trigger outlives a redraw. The drawer fills their bodies. */
  private readonly modules = new Map<PageLayoutModule, { card: HTMLElement; body: HTMLElement }>();
  private readonly menuButtons: Record<MenuModule, HTMLButtonElement>;
  /** The one open module menu. */
  private moduleMenu: { kind: MenuModule; panel: DatabasePanel } | null = null;
  private menuQuery = '';
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
    this.menuButtons = { heading: this.menuButton('heading'), group: this.menuButton('group') };
    for (const kind of ['heading', 'group', 'content'] as const) this.canvas.appendChild(this.module(kind));
    side.setAttribute('data-blok-database-layout-side', '');
    side.setAttribute('data-blok-database-layout-settings-column', '');
    side.append(...this.pageSettings());
    body.append(this.canvas, side);
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
    this.moduleMenu?.panel.refresh();
  }

  /** Is `target` inside the builder or one of its menus? */
  contains(target: Node): boolean {
    return this.root.contains(target);
  }

  close(): void {
    this.confirm?.abort();
    this.confirm = null;
    this.closeMenu();
    this.closeModuleMenu();
    this.dialog.close();
  }

  /** Puts the drawn regions of the previewed page into the module cards. */
  fill(regions: Record<PageLayoutModule, HTMLElement[]>): void {
    for (const [kind, { body }] of this.modules) body.replaceChildren(...regions[kind]);
  }

  /** A card with a header strip; a click anywhere in it selects it and opens its menu (research/10 §8). */
  private module(kind: PageLayoutModule): HTMLElement {
    const card = document.createElement('section');
    const header = document.createElement('div');
    const name = document.createElement('span');
    const body = document.createElement('div');

    card.setAttribute('data-blok-database-layout-module', kind);
    header.setAttribute('data-blok-database-layout-module-header', '');
    name.setAttribute('data-blok-database-layout-module-name', '');
    name.textContent = this.label(MODULE_NAMES[kind]);
    body.setAttribute('data-blok-database-layout-module-body', '');
    header.append(name);
    if (kind !== 'content') header.append(this.menuButtons[kind]);
    card.append(header, body);
    card.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest(MODULE_CONTROL) !== null) return;
      this.select(kind);
      if (kind !== 'content' && this.moduleMenu?.kind !== kind) this.openModuleMenu(kind);
    });
    this.modules.set(kind, { card, body });

    return card;
  }

  private menuButton(kind: MenuModule): HTMLButtonElement {
    const button = this.button('data-blok-database-layout-module-menu', IconDotsHorizontal, null, () => this.toggleModuleMenu(kind));

    button.setAttribute('aria-label', this.label('tools.database.layoutModuleMenu'));
    button.setAttribute('aria-expanded', 'false');

    return button;
  }

  private select(kind: PageLayoutModule): void {
    for (const [other, { card }] of this.modules) card.toggleAttribute('data-selected', other === kind);
    if (this.moduleMenu !== null && this.moduleMenu.kind !== kind) this.closeModuleMenu();
  }

  private toggleModuleMenu(kind: MenuModule): void {
    if (this.moduleMenu?.kind === kind) {
      this.closeModuleMenu();

      return;
    }
    this.select(kind);
    this.openModuleMenu(kind);
  }

  /** research/09 §3: each module's ••• menu has a header, a focused property search, and its lists. */
  private openModuleMenu(kind: MenuModule): void {
    this.closeMenu();
    this.closeModuleMenu();
    const anchor = this.menuButtons[kind];
    const root: PanelPage = kind === 'heading'
      ? { title: this.label('tools.database.layoutModuleHeading'), build: () => this.headingMenuPage() }
      : {
        title: this.label('tools.database.layoutModuleGroup'),
        headerAction: () => this.button('data-blok-database-layout-add-section', IconPlus, 'tools.database.layoutAddSection', () => {
          this.options.edit(addSection(nanoid(), this.label('tools.database.layoutNewSection'), this.options.properties().map((def) => def.id)));
        }),
        build: (panel) => this.groupMenuPage(panel),
      };
    const panel = new DatabasePanel({
      anchor,
      testId: `database-layout-${kind}-menu`,
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
    this.moduleMenu = { kind, panel };
    anchor.setAttribute('aria-expanded', 'true');
    panel.open();
    // The panel focuses its first control, which in the group menu is the header's Add section.
    panel.root.querySelector<HTMLElement>('[data-blok-database-panel-input]')?.focus();
  }

  /** Closes the open module menu, if any. The drawer's canvas ⋯ menu calls it, so only one menu is open. */
  closeModuleMenu(): void {
    const menu = this.moduleMenu;

    this.moduleMenu = null;
    if (menu === null) return;
    this.menuButtons[menu.kind].setAttribute('aria-expanded', 'false');
    menu.panel.close();
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
   * research/09 §3 L56: search, the group's properties (sections included,
   * pins not) with an eye each, "+ Add a property", then Move to panel or page.
   */
  private groupMenuPage(panel: DatabasePanel): HTMLElement[] {
    const layout = this.options.layout();
    const resolved = resolvePageLayout(layout, this.options.properties());
    const list = document.createElement('div');
    const rows = [...resolved.group, ...resolved.sections.flatMap((entry) => entry.properties)].map((def) => this.groupRow(def, panel));
    const add = this.button('data-blok-database-layout-add-group-property', null, 'tools.database.addProperty', () => {
      this.closeModuleMenu();
      this.options.onAddToGroup(this.menuButtons.group);
    });
    const toPanel = layout.groupIn === 'page';

    list.setAttribute('data-blok-database-layout-group-list', '');
    list.append(...rows);

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

  /** research/09 §5: type glyph, name, and an always-visible eye whose glyph shows the state. */
  private groupRow(def: PropertyDefinition, panel: DatabasePanel): HTMLElement {
    const row = document.createElement('div');
    const name = document.createElement('span');
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
    name.setAttribute('data-blok-database-layout-group-name', '');
    name.textContent = def.name;
    eye.setAttribute('data-blok-testid', eyeId);
    eye.setAttribute('data-visibility', visibility);
    eye.setAttribute('aria-label', this.label('tools.database.layoutVisibilityAria', { name: def.name }));
    row.append(this.typeIcon(def, 'data-blok-database-layout-group-icon'), name, eye);

    return row;
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

  private headingMenuPage(): HTMLElement[] {
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
        const row = this.pinRow(def, kind === 'pinned', kind === 'unpinned' && full);

        rows.push(row);
        el.appendChild(row);
      }

      return el;
    };
    const pinnedList = list('pinned', pinned);
    const unpinnedList = list('unpinned', properties.filter((def) => !pinnedIds.has(def.id)));
    const add = this.button('data-blok-database-layout-add-pin', null, 'tools.database.addProperty', () => {
      this.closeModuleMenu();
      this.options.onAddPin(this.menuButtons.heading);
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

  /** research/09 §3: type glyph, name, and an always-visible pin button. */
  private pinRow(def: PropertyDefinition, pinned: boolean, disabled: boolean): HTMLElement {
    const row = document.createElement('div');
    const name = document.createElement('span');
    const toggle = this.button('data-blok-database-layout-pin-toggle', pinned ? IconPinFilled : IconPin, null, () => {
      this.options.edit(pinned ? removeFromLayout(def.id) : pin(def.id));
    });

    row.setAttribute('data-blok-database-layout-pin-row', '');
    row.setAttribute('data-property-id', def.id);
    row.setAttribute('data-name', def.name.toLowerCase());
    name.setAttribute('data-blok-database-layout-pin-name', '');
    name.textContent = def.name;
    toggle.setAttribute('data-blok-testid', `database-layout-pin-${def.id}`);
    toggle.setAttribute('aria-label', this.label(pinned ? 'tools.database.layoutUnpinAria' : 'tools.database.layoutPinAria', { name: def.name }));
    toggle.toggleAttribute('data-pinned', pinned);
    toggle.disabled = disabled;
    row.append(this.typeIcon(def, 'data-blok-database-layout-pin-icon'), name, toggle);

    return row;
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
    const info = document.createElement('span');
    const description = document.createElement('span');
    const hint = this.label(hintKey);

    info.setAttribute('data-blok-database-layout-hint', '');
    info.innerHTML = IconInfo;
    onHover(info, hint);
    // The (i) takes no focus, so the switch carries the hint for keyboard and screen reader users.
    description.id = `blok-database-layout-hint-${nanoid()}`;
    description.setAttribute('data-blok-database-sr-only', '');
    description.textContent = hint;
    toggle.setAttribute('aria-describedby', description.id);
    toggle.querySelector('[data-blok-database-panel-label]')?.after(info);
    row.append(description);

    return row;
  }

  /** Cancel: with edits, asks first (research/09 §3b). */
  private cancel(): void {
    if (!this.options.hasEdits()) {
      this.options.onDiscard();

      return;
    }
    const confirm = new AbortController();

    this.closeMenu();
    this.closeModuleMenu();
    this.confirm = confirm;
    void openDatabaseConfirm({
      title: this.label('tools.database.layoutDiscardTitle'),
      confirmLabel: this.label('tools.database.layoutDiscard'),
      cancelLabel: this.label('tools.database.layoutCancel'),
      destructive: true,
      directionSource: this.root,
      // Over this modal: two focus traps on body would pull focus back and forth.
      container: this.root,
      signal: confirm.signal,
    }).then((discard) => {
      if (this.confirm !== confirm) return;
      this.confirm = null;
      if (discard) this.options.onDiscard();
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
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '220px',
      autoFocusFirstItem: false,
      items: [{
        type: PopoverItemType.Default,
        name: 'reset',
        title: this.label('tools.database.layoutReset'),
        secondaryLabel: this.label('tools.database.layoutResetDescription'),
        closeOnActivate: true,
        onActivate: () => this.options.onReset(),
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
    const fallback = (englishDictionary as Record<string, string>)[key] ?? key;

    return this.options.i18n?.t(key, vars) ?? fallback.replace(/\{(\w+)\}/g, (match, name: string) => vars?.[name] ?? match);
  }
}
