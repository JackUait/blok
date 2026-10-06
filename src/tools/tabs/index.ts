import type {
  API,
  BlockAPI,
  BlockOrigin,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
} from '../../../types';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconEmojiSmile, IconPencil, IconPlus, IconTabs, IconTrash } from '../../components/icons';
import { startInlineRename } from '../../components/utils/inline-rename';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { rovingRadioGroup, type RovingRadioGroup } from '../../components/utils/roving-radio-group';
import { EmojiPicker } from '../callout/emoji-picker';
import { mountChildBlocks } from '../nested-blocks';
import { TABS_ATTR, TAB_TOOL } from './constants';
import { attachPillGestures } from './pill-gestures';
import { cascadeIn, foldPill, looksTheSame, measurePill, morphPanelsHeight, moveIndicator, panelRows, popInPill, type PillBox } from './motion';
import { renderTabsPreview } from './preview';
import { tabRegistry, type TabsHandle } from './registry';
import type { TabData, TabsData } from './types';

/** Origins that mean "the author just made this block". Only these seed tabs. */
const CREATION_ORIGINS: ReadonlySet<BlockOrigin | undefined> = new Set<BlockOrigin | undefined>([
  undefined,
  'user',
  'api',
  'convert',
]);

const SEEDED_TABS = 3;

interface SeedData {
  noSeed?: boolean;
}

/**
 * Tabs block: a card with a strip of tabs and the open tab's content below.
 * Each tab is a `tab` child block. Which tab is open is UI state, not data.
 */
export class TabsTool implements BlockTool, TabsHandle {
  private readonly api: API;
  private readonly blockId: string;
  private readonly block: BlockAPI;
  private readonly isCreation: boolean;
  private readonly noSeed: boolean;
  private readOnly: boolean;
  private root: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private indicator: HTMLElement | null = null;
  private panels: HTMLElement | null = null;
  private pills = new Map<string, HTMLElement>();
  private stripSignature = '';
  private indicatorBox: PillBox | null = null;
  private roving: RovingRadioGroup | null = null;
  private menu: PopoverDesktop | null = null;
  private emojiPicker: EmojiPicker | null = null;
  private syncQueued = false;
  private evictionScheduled = false;
  private renaming = false;
  private detachGestures: (() => void) | null = null;
  /** Open tab when the block is not mounted in an editor yet. */
  private localActive: string | undefined;
  /** Tabs whose fold animation runs before their delete: already gone for counting. */
  private readonly pendingDeletes = new Set<string>();
  private appliedActive = '';
  private readonly isProbe: boolean;
  private panelsObserver: MutationObserver | null = null;
  private stripResizeObserver: ResizeObserver | null = null;

  constructor({ data, api, block, readOnly, origin }: BlockToolConstructorOptions<TabsData & SeedData>) {
    this.api = api;
    this.block = block;
    this.blockId = block.id;
    this.readOnly = readOnly;
    this.isCreation = CREATION_ORIGINS.has(origin);
    this.noSeed = (data as SeedData | undefined)?.noSeed === true;
    // A probe instance only reads data and is never destroyed: it must not listen.
    this.isProbe = origin === 'probe';

    if (!this.isProbe) {
      this.api.events.on('block changed', this.queueSync);
    }
  }

  public render(): HTMLElement {
    const root = document.createElement('div');

    root.setAttribute(TABS_ATTR.root, '');
    root.setAttribute(DATA_ATTR.testid, 'tabs');
    tabRegistry.setContainer(root, this);

    const strip = document.createElement('div');

    strip.setAttribute(TABS_ATTR.strip, '');
    strip.setAttribute(DATA_ATTR.chrome, '');
    // Pills, the indicator and scroll fades are UI: never a block edit.
    strip.setAttribute(DATA_ATTR.mutationFree, 'true');
    strip.setAttribute('contenteditable', 'false');

    const scroller = document.createElement('div');

    scroller.setAttribute(TABS_ATTR.scroller, '');
    scroller.setAttribute('role', 'tablist');
    // Arrows, Home/End, Enter and the menu key belong to the strip.
    scroller.setAttribute(DATA_ATTR.keyboardOwner, '');
    scroller.addEventListener('scroll', this.updateOverflow, { passive: true });

    const indicator = document.createElement('div');

    indicator.setAttribute(TABS_ATTR.indicator, '');
    indicator.setAttribute('aria-hidden', 'true');
    scroller.appendChild(indicator);
    strip.appendChild(scroller);

    if (!this.readOnly) {
      strip.appendChild(this.buildAddButton());
    }

    const panels = document.createElement('div');

    panels.setAttribute(TABS_ATTR.panels, '');
    panels.setAttribute(DATA_ATTR.nestedBlocks, '');
    panels.setAttribute(DATA_ATTR.mutationFree, 'true');

    root.append(strip, panels);

    // Undo and remote replays move tab holders without a 'block changed' event.
    if (!this.isProbe && typeof MutationObserver !== 'undefined') {
      this.panelsObserver = new MutationObserver(this.queueSync);
      this.panelsObserver.observe(panels, { childList: true });
    }

    // A block that mounts hidden measures a zero-width strip, and a late web
    // font resizes the pills, not the strip: re-measure when either changes.
    if (!this.isProbe && typeof ResizeObserver !== 'undefined') {
      this.stripResizeObserver = new ResizeObserver(this.onStripResize);
      this.stripResizeObserver.observe(scroller);
    }

    this.detachGestures = attachPillGestures({
      strip,
      scroller,
      pills: () => Array.from(this.pills.values()),
      isReadOnly: () => this.readOnly,
      onReorder: (id, before) => this.moveTab({ id, before }),
      onDwell: id => this.select(id, { animate: true, focus: false }),
    });

    this.root = root;
    this.scroller = scroller;
    this.indicator = indicator;
    this.panels = panels;

    return root;
  }

  public rendered(): void {
    if (this.panels === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      // Loads, undo and remote replays render before their tabs arrive, so
      // only a genuine creation may seed. See ColumnList.rendered().
      if (this.isCreation && !this.noSeed) {
        this.seedTabs();
      }

      return;
    }

    const tabs = children.filter(child => child.name === TAB_TOOL);

    mountChildBlocks(this.panels, tabs);

    if (tabs.length !== children.length) {
      this.scheduleRogueEviction();
    }

    this.sync();
  }

  /**
   * Center the block toolbar on the strip. The default anchor is the first
   * editable descendant, which may sit in a hidden tab with an empty rect.
   */
  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this.pills.values().next().value ?? this.scroller ?? undefined;
  }

  public save(): TabsData {
    return {};
  }

  public validate(_data: TabsData): boolean {
    return true;
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.closeMenu();
    this.emojiPicker?.close();
    // Blur commits an open rename before the strip turns read-only.
    this.root?.querySelector<HTMLElement>(`[${TABS_ATTR.renameInput}]`)?.blur();

    const strip = this.root?.querySelector(`[${TABS_ATTR.strip}]`);
    const add = strip?.querySelector(`[${TABS_ATTR.add}]`);

    if (state) {
      // The button may own the visible tooltip; it would outlive the button.
      this.api.tooltip.hide();
      add?.remove();
    } else if (strip !== null && strip !== undefined && (add === null || add === undefined)) {
      strip.appendChild(this.buildAddButton());
    }

    this.stripSignature = '';
    this.sync();
  }

  public removed(): void {
    this.teardown();
  }

  public destroy(): void {
    this.teardown();
  }

  /**
   * Show a tab. Public through the registry: a tab asks for this when
   * find-in-page reveals a match inside it.
   * @param tabId - the tab to open
   */
  public activate(tabId: string): void {
    this.select(tabId, { animate: true, focus: false });
  }

  /**
   * Rebuild the strip from the tab children, then show the open tab.
   * Cheap when nothing changed: pills are rebuilt only when titles, icons or
   * order changed.
   */
  public sync(): void {
    if (this.scroller === null || this.panels === null || this.renaming) {
      return;
    }

    const tabs = this.tabBlocks();

    if (tabs.length === 0) {
      // Every tab is gone (a peer deleted them): drop pills that point nowhere.
      this.pills.forEach(pill => pill.remove());
      this.pills.clear();
      this.stripSignature = '';

      return;
    }

    const signature = JSON.stringify([this.readOnly, ...tabs.map(tab => [tab.id, this.tabData(tab)])]);
    const stored = this.activeId();
    const activeId = stored !== undefined && tabs.some(tab => tab.id === stored) ? stored : tabs[0].id;
    const rebuilt = signature !== this.stripSignature;

    if (rebuilt) {
      this.stripSignature = signature;
      this.buildPills(tabs);
    }

    // Pin the fallback, so reordering never swaps the open tab under the user.
    this.setActiveId(activeId);

    // Most 'block changed' events are typing elsewhere: skip the layout reads.
    if (!rebuilt && activeId === this.appliedActive) {
      return;
    }

    this.applyActive(activeId, { animate: false });
  }

  /**
   * @param params - the tab and its new title; blank keeps the old title
   * @param params.id - tab id
   * @param params.title - the new title
   */
  public renameTab({ id, title }: { id: string; title: string }): void {
    const trimmed = title.trim();
    const tab = this.tabBlocks().find(block => block.id === id);

    if (this.readOnly || tab === undefined || trimmed === '' || trimmed === this.tabData(tab).title) {
      return;
    }

    void this.api.blocks.update(id, { title: trimmed });
  }

  /**
   * Delete a tab and its content. The last tab stays: deleting it would leave
   * a block with nothing to show. Delete the whole block from its menu instead.
   * @param params - the tab to delete
   * @param params.id - tab id
   */
  public deleteTab({ id }: { id: string }): void {
    const tabs = this.tabBlocks();
    const index = tabs.findIndex(tab => tab.id === id);

    if (this.readOnly || index < 0 || tabs.length < 2) {
      return;
    }

    if ((this.activeId() ?? tabs[0].id) === id) {
      const neighbour = tabs[index + 1] ?? tabs[index - 1];

      this.setActiveId(neighbour.id);
    }

    this.pendingDeletes.add(id);

    const remove = (): void => {
      this.pendingDeletes.delete(id);

      const flatIndex = this.api.blocks.getBlockIndex(id);

      if (flatIndex !== undefined) {
        void this.api.blocks.delete(flatIndex);
      }
    };
    const pill = this.pills.get(id);

    if (pill === undefined) {
      remove();

      return;
    }

    pill.setAttribute('aria-hidden', 'true');
    this.select(this.activeId() ?? id, { animate: true, focus: false });
    foldPill(pill, remove);
  }

  /**
   * Move a tab, with its content, before another tab or to the end.
   * @param params - the tab and where it goes
   * @param params.id - tab id
   * @param params.before - the tab it lands before; omitted = last
   */
  public moveTab({ id, before }: { id: string; before?: string }): void {
    if (this.readOnly || id === before) {
      return;
    }

    this.api.blocks.moveTo(id, {
      parentId: this.blockId,
      position: before === undefined ? 'end' : { before },
    });
    this.sync();
  }

  /** Append a tab named after its position, open it, and start renaming it. */
  public addTab(): void {
    if (this.readOnly || this.panels === null) {
      return;
    }

    const number = this.tabBlocks().length + 1;
    const title = this.api.i18n.t('tools.tabs.defaultTitle', { number: String(number) });
    const tab = this.api.blocks.insertAt(TAB_TOOL, { title }, { parentId: this.blockId, position: 'end' });

    this.panels.appendChild(tab.holder);
    this.setActiveId(tab.id);
    this.sync();
    this.select(tab.id, { animate: true, focus: false });

    const pill = this.pills.get(tab.id);

    if (pill !== undefined) {
      popInPill(pill);
      pill.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    this.startRename(tab.id);
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconTabs,
      titleKey: 'tabs',
      searchTerms: ['tabs', 'tab', 'tabbed', 'switch', 'sections'],
      searchTermKeys: ['tabs'],
      section: 'advanced',
      preview: { render: renderTabsPreview, descriptionKey: 'toolbox.preview.tabs' },
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /** The children ARE the tabs: a user gesture must never adopt another block. */
  public static get ownsChildren(): boolean {
    return true;
  }

  /** Enter inside never unwraps the tabs and strands a line beside the card. */
  public static get keepsChildrenOnEnter(): boolean {
    return true;
  }

  /** Deleting the block deletes every tab and its content. */
  public static get deletesChildren(): boolean {
    return true;
  }

  public static get childTools(): { allow: string[] } {
    return { allow: [TAB_TOOL] };
  }

  private teardown(): void {
    this.api.events.off('block changed', this.queueSync);
    this.roving?.destroy();
    this.roving = null;
    this.detachGestures?.();
    this.detachGestures = null;
    this.panelsObserver?.disconnect();
    this.panelsObserver = null;
    this.stripResizeObserver?.disconnect();
    this.stripResizeObserver = null;
    this.closeMenu();
    this.emojiPicker?.close();
    this.emojiPicker?.getElement().remove();
    this.emojiPicker = null;
  }

  private tabBlocks(): BlockAPI[] {
    return this.api.blocks.getChildren(this.blockId)
      .filter(child => child.name === TAB_TOOL && !this.pendingDeletes.has(child.id));
  }

  private tabData(tab: BlockAPI): TabData {
    return tabRegistry.tab(tab.holder.querySelector(`[${TABS_ATTR.tab}]`))?.data ?? { title: '' };
  }

  /** The editor this block is mounted in; open tabs are kept per editor. */
  private editor(): Element | null {
    return this.root?.closest(`[${DATA_ATTR.editor}]`) ?? null;
  }

  private activeId(): string | undefined {
    const editor = this.editor();

    return editor === null ? this.localActive : tabRegistry.activeTab(editor, this.blockId) ?? this.localActive;
  }

  private setActiveId(tabId: string): void {
    const editor = this.editor();

    this.localActive = tabId;

    if (editor !== null) {
      tabRegistry.setActiveTab(editor, this.blockId, tabId);
    }
  }

  private readonly queueSync = (): void => {
    if (this.syncQueued) {
      return;
    }

    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      this.sync();
    });
  };

  private seedTabs(): void {
    const panels = this.panels;

    if (panels === null || this.api.blocks.getBlockIndex(this.blockId) === undefined) {
      return;
    }

    const seeded = Array.from({ length: SEEDED_TABS }, (_, i) => {
      const title = this.api.i18n.t('tools.tabs.defaultTitle', { number: String(i + 1) });
      const tab = this.api.blocks.insertAt(TAB_TOOL, { title }, { parentId: this.blockId, position: 'end' });

      panels.appendChild(tab.holder);

      return tab;
    });

    this.setActiveId(seeded[0].id);
    this.sync();
  }

  /** Evict non-tab children once Yjs replay settles. See ColumnList. */
  private scheduleRogueEviction(): void {
    if (this.evictionScheduled) {
      return;
    }

    this.evictionScheduled = true;

    const run = (): void => {
      if (this.api.blocks.isSyncingFromYjs) {
        requestAnimationFrame(run);

        return;
      }

      this.evictionScheduled = false;

      // Strays stay in the tabs block's container. Last first: each one lands
      // right after the tabs block, so the reverse keeps their order.
      const tabs = this.api.blocks.getById(this.blockId);
      const parentId = tabs?.parentId ?? null;
      const subtree = (id: string): BlockAPI[] =>
        this.api.blocks.getChildren(id).flatMap(child => [child, ...subtree(child.id)]);

      this.api.blocks.getChildren(this.blockId)
        .filter(child => child.name !== TAB_TOOL)
        .reverse()
        .forEach(child => {
          this.api.blocks.setBlockParent(child.id, parentId);

          // A table parent keeps the holders where they are (inside this
          // block's panels) and only adopts the id into the tabs block's cell.
          // A holder inside a moved one rides along, so it is checked late.
          if (tabs !== undefined && tabs !== null) {
            [child, ...subtree(child.id)].reduce<Element>((anchor, member) => {
              if (!tabs.holder.contains(member.holder)) {
                return anchor.contains(member.holder) ? anchor : member.holder;
              }

              anchor.after(member.holder);

              return member.holder;
            }, tabs.holder);
          }
        });
    };

    requestAnimationFrame(run);
  }

  private buildAddButton(): HTMLElement {
    const add = document.createElement('button');
    const label = this.api.i18n.t('tools.tabs.addTab');

    add.type = 'button';
    add.setAttribute(TABS_ATTR.add, '');
    add.setAttribute('aria-label', label);
    add.innerHTML = IconPlus;
    add.addEventListener('click', (event) => {
      event.preventDefault();
      this.addTab();
    });
    this.api.tooltip?.onHover?.(add, label, { placement: 'top' });

    return add;
  }

  private buildPills(tabs: BlockAPI[]): void {
    const scroller = this.scroller;

    if (scroller === null) {
      return;
    }

    // A rebuild replaces the pills; keep keyboard focus on the same tab.
    const focusedId = Array.from(this.pills.entries())
      .find(([, pill]) => pill.contains(document.activeElement))?.[0];

    this.roving?.destroy();
    this.pills.forEach((pill) => {
      this.stripResizeObserver?.unobserve(pill);
      pill.remove();
    });
    this.pills.clear();

    const elements = tabs.map((tab) => {
      const pill = this.buildPill(tab.id, this.tabData(tab));

      scroller.appendChild(pill);
      this.pills.set(tab.id, pill);
      this.stripResizeObserver?.observe(pill);

      return pill;
    });

    this.roving = rovingRadioGroup({
      radios: elements,
      getSelectedIndex: () => elements.findIndex(pill => pill.getAttribute('aria-selected') === 'true'),
      onSelect: (index) => {
        const id = tabs[index]?.id;

        if (id !== undefined) {
          this.select(id, { animate: true, focus: false });
        }
      },
    });
    this.updateOverflow();

    if (focusedId !== undefined) {
      this.pills.get(focusedId)?.focus();
    }
  }

  private buildPill(id: string, data: TabData): HTMLElement {
    const pill = document.createElement('button');

    pill.type = 'button';
    pill.id = `blok-tab-${id}`;
    pill.setAttribute(TABS_ATTR.pill, '');
    pill.setAttribute('role', 'tab');
    pill.setAttribute('aria-controls', `blok-tab-panel-${id}`);
    pill.setAttribute('aria-selected', 'false');
    pill.setAttribute('data-tab-id', id);
    // A block dragged onto the pill drops at the end of this tab (core drag reads it).
    pill.setAttribute(DATA_ATTR.dropInto, id);

    if (!this.readOnly) {
      pill.setAttribute('aria-haspopup', 'menu');
    }

    if (data.icon !== undefined) {
      const icon = document.createElement('span');

      icon.setAttribute(TABS_ATTR.pillIcon, '');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = data.icon;
      pill.appendChild(icon);
    }

    const label = document.createElement('span');

    label.setAttribute(TABS_ATTR.pillLabel, '');
    label.setAttribute('dir', 'auto');
    label.textContent = data.title === '' ? this.api.i18n.t('tools.tabs.untitled') : data.title;
    pill.appendChild(label);
    pill.setAttribute('aria-label', label.textContent);

    pill.addEventListener('click', (event) => {
      const isActive = pill.getAttribute('aria-selected') === 'true';

      // The second click of a double-click keeps the menu the first one opened.
      if (event.detail > 1 && pill.getAttribute('aria-expanded') === 'true') {
        return;
      }

      if (isActive && !this.readOnly) {
        this.openMenu(id);

        return;
      }

      this.select(id, { animate: true, focus: false });
    });
    pill.addEventListener('contextmenu', (event) => {
      if (this.readOnly) {
        return;
      }
      event.preventDefault();
      // The editor opens Block Settings on a right-click; the tab menu replaces it here.
      event.stopPropagation();
      this.select(id, { animate: true, focus: false });
      this.openMenu(id);
    });
    pill.addEventListener('keydown', (event) => {
      const opensMenu = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
      const mod = event.metaKey || event.ctrlKey;
      const isZ = event.code === 'KeyZ' || event.key.toLowerCase() === 'z';
      const isRedo = mod && ((isZ && event.shiftKey) || (event.ctrlKey && event.key.toLowerCase() === 'y'));

      // The strip owns its keyboard, so the editor never sees these keys here.
      if (isRedo || (mod && isZ)) {
        event.preventDefault();
        isRedo ? this.api.history.redo() : this.api.history.undo();

        return;
      }

      if (opensMenu && !this.readOnly) {
        event.preventDefault();
        this.openMenu(id);
      } else if (event.key === 'F2' && !this.readOnly) {
        event.preventDefault();
        this.startRename(id);
      }
    });

    return pill;
  }

  private select(tabId: string, options: { animate: boolean; focus: boolean }): void {
    this.setActiveId(tabId);
    this.applyActive(tabId, options);

    if (options.focus) {
      this.pills.get(tabId)?.focus();
    }
  }

  private applyActive(activeId: string, options: { animate: boolean }): void {
    const panels = this.panels;

    if (panels === null) {
      return;
    }

    this.appliedActive = activeId;

    const tabs = this.tabBlocks();
    const previousIndex = tabs.findIndex(tab => !tab.holder.classList.contains('hidden'));
    const nextIndex = tabs.findIndex(tab => tab.id === activeId);
    const switching = previousIndex !== nextIndex;
    const fromHeight = panels.offsetHeight;

    tabs.forEach((tab) => {
      const isActive = tab.id === activeId;

      tab.holder.classList.toggle('hidden', !isActive);
      tab.holder.setAttribute('aria-hidden', String(!isActive));
    });
    this.pills.forEach((pill, id) => {
      pill.setAttribute('aria-selected', String(id === activeId));
    });
    this.roving?.refresh();

    const pill = this.pills.get(activeId);

    if (pill !== undefined && this.indicator !== null) {
      const box = measurePill(pill);

      moveIndicator(this.indicator, options.animate ? this.indicatorBox : null, box);
      this.indicatorBox = box;
      this.indicator.toggleAttribute('data-placed', box.width > 0);
    }

    if (options.animate && switching) {
      morphPanelsHeight(panels, fromHeight);

      const panel = tabs[nextIndex]?.holder;
      const closing = tabs[previousIndex]?.holder;

      if (panel !== undefined && (closing === undefined || !looksTheSame(panelRows(closing), panelRows(panel)))) {
        cascadeIn(panelRows(panel));
      }
      pill?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  private readonly onStripResize = (): void => {
    this.updateOverflow();
    this.followIndicator(this.appliedActive);
  };

  private readonly updateOverflow = (): void => {
    const scroller = this.scroller;

    if (scroller === null) {
      return;
    }

    const max = scroller.scrollWidth - scroller.clientWidth;
    const fromStart = Math.abs(scroller.scrollLeft);

    scroller.toggleAttribute('data-overflow-start', fromStart > 1);
    scroller.toggleAttribute('data-overflow-end', max - fromStart > 1);
  };

  private openMenu(id: string): void {
    const pill = this.pills.get(id);

    if (pill === undefined) {
      return;
    }

    this.closeMenu();

    const t = (key: string): string => this.api.i18n.t(key);
    const canDelete = this.tabBlocks().length > 1;
    const items = [
      {
        icon: IconPencil,
        title: t('tools.tabs.rename'),
        closeOnActivate: true,
        onActivate: () => this.startRename(id),
      },
      {
        icon: IconEmojiSmile,
        title: t('tools.tabs.editIcon'),
        closeOnActivate: true,
        onActivate: () => this.openIconPicker(id),
      },
      ...(canDelete
        ? [
          { type: PopoverItemType.Separator as const },
          {
            icon: IconTrash,
            title: t('tools.tabs.delete'),
            isDestructive: true,
            closeOnActivate: true,
            onActivate: () => this.deleteTab({ id }),
          },
        ]
        : []),
    ];

    const menu = new PopoverDesktop({
      trigger: pill,
      width: 'auto',
      minWidth: '160px',
      autoFocusFirstItem: false,
      messages: { actions: t('tools.tabs.tabOptions') },
      items,
    });

    pill.setAttribute('aria-expanded', 'true');
    menu.on(PopoverEvent.Closed, () => {
      pill.removeAttribute('aria-expanded');

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

  private startRename(id: string): void {
    const pill = this.pills.get(id);
    const label = pill?.querySelector<HTMLElement>(`[${TABS_ATTR.pillLabel}]`);

    if (this.readOnly || pill === undefined || label === null || label === undefined) {
      return;
    }

    const tab = this.tabBlocks().find(block => block.id === id);
    const current = tab === undefined ? '' : this.tabData(tab).title;

    // A double-click on the open tab clicked it first, which opened its menu.
    this.closeMenu();
    this.renaming = true;
    pill.setAttribute('data-renaming', '');
    startInlineRename({
      target: label,
      currentValue: current,
      label: this.api.i18n.t('tools.tabs.titleLabel'),
      configureInput: (input) => {
        input.setAttribute(TABS_ATTR.renameInput, '');
        input.setAttribute('dir', 'auto');
        input.setAttribute('size', String(Math.max(current.length, 4)));
        input.addEventListener('input', () => {
          input.setAttribute('size', String(Math.max(input.value.length, 4)));
          this.followIndicator(id);
        });
        input.addEventListener('keydown', event => event.stopPropagation());
        queueMicrotask(() => {
          input.focus();
          input.select();
        });
      },
      buildRestored: (value) => {
        const restored = document.createElement('span');

        restored.setAttribute(TABS_ATTR.pillLabel, '');
        restored.setAttribute('dir', 'auto');
        restored.textContent = value;

        return restored;
      },
      onCommit: (value) => {
        this.endRename(pill);
        this.renameTab({ id, title: value });
      },
      onCancel: () => this.endRename(pill),
    });
  }

  private endRename(pill: HTMLElement): void {
    this.renaming = false;
    pill.removeAttribute('data-renaming');
    this.stripSignature = '';
    queueMicrotask(() => this.sync());
  }

  /** Keep the indicator hugging the open pill when its width changes. */
  private followIndicator(id: string): void {
    const pill = this.pills.get(id);

    if (pill === undefined || this.indicator === null || pill.getAttribute('aria-selected') !== 'true') {
      return;
    }

    const box = measurePill(pill);

    moveIndicator(this.indicator, null, box);
    this.indicatorBox = box;
    this.indicator.toggleAttribute('data-placed', box.width > 0);
  }

  private openIconPicker(id: string): void {
    const pill = this.pills.get(id);

    if (pill === undefined || this.readOnly) {
      return;
    }

    const handlers = {
      onSelect: (native: string): void => {
        void this.api.blocks.update(id, { icon: native });
      },
      onRemove: (): void => {
        void this.api.blocks.update(id, { icon: '' });
      },
    };

    if (this.emojiPicker === null) {
      this.emojiPicker = new EmojiPicker({ ...handlers, i18n: this.api.i18n, locale: this.api.i18n.getLocale() });
    }

    const element = this.emojiPicker.getElement();

    if (!element.isConnected) {
      document.body.appendChild(element);
    }
    void this.emojiPicker.open(pill, undefined, handlers);
  }
}

export type { TabsData };
