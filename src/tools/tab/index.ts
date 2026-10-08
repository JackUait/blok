import { tabSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  SanitizerConfig,
} from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { mountChildBlocks, withSlotlessDescendants } from '../nested-blocks';
import { TABS_ATTR, TABS_TOOL } from '../tabs/constants';
import { tabRegistry, type TabHandle } from '../tabs/registry';
import type { TabData } from '../tabs/types';

const normalize = (data: Partial<TabData> | undefined): TabData => {
  const title = typeof data?.title === 'string' ? data.title : '';
  const icon = typeof data?.icon === 'string' && data.icon !== '' ? data.icon : undefined;

  return icon === undefined ? { title } : { title, icon };
};

/**
 * One tab of a tabs block. Its title and icon live in data; its content is
 * its child blocks. The tab strip belongs to the parent tabs block, so a tab
 * renders only its panel.
 */
export class TabTool implements BlockTool, TabHandle {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly blockId: string;
  private _data: TabData;
  private readOnly: boolean;
  private wrapper: HTMLElement | null = null;
  private childSlot: HTMLElement | null = null;
  private placeholder: HTMLElement | null = null;
  // A probe instance only reads data and is never destroyed: it must not listen.
  private readonly isProbe: boolean;

  constructor({ data, api, block, readOnly, origin }: BlockToolConstructorOptions<TabData>) {
    this.api = api;
    this.block = block;
    this.blockId = block.id;
    this.readOnly = readOnly;
    this._data = normalize(data);
    this.isProbe = origin === 'probe';

    if (!this.isProbe) {
      this.api.events.on('block changed', this.handleBlockChanged);
    }
  }

  public get data(): TabData {
    return this._data;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute(TABS_ATTR.tab, '');
    wrapper.setAttribute('role', 'tabpanel');
    wrapper.id = `blok-tab-panel-${this.blockId}`;
    wrapper.setAttribute('aria-labelledby', `blok-tab-${this.blockId}`);

    const childSlot = document.createElement('div');

    childSlot.setAttribute(DATA_ATTR.nestedBlocks, '');
    childSlot.setAttribute(TABS_ATTR.tabChildren, '');
    // The slot holds only child blocks; a write on a child holder is never a tab edit.
    childSlot.setAttribute(DATA_ATTR.mutationFree, 'true');

    const placeholder = document.createElement('div');

    placeholder.setAttribute(TABS_ATTR.empty, '');
    // A block dragged over the empty tab drops in as its first child.
    placeholder.setAttribute(DATA_ATTR.dropInto, '');
    placeholder.setAttribute(DATA_ATTR.childStandIn, '');
    placeholder.setAttribute(DATA_ATTR.chrome, '');
    placeholder.setAttribute(DATA_ATTR.mutationFree, 'true');
    placeholder.setAttribute('contenteditable', 'false');
    placeholder.textContent = this.api.i18n.t('tools.tabs.emptyTab');
    placeholder.addEventListener('click', this.handlePlaceholderClick);

    wrapper.append(childSlot, placeholder);
    tabRegistry.setTab(wrapper, this);

    this.wrapper = wrapper;
    this.childSlot = childSlot;
    this.placeholder = placeholder;

    return wrapper;
  }

  public rendered(): void {
    if (this.childSlot === null) {
      return;
    }

    mountChildBlocks(
      this.childSlot,
      withSlotlessDescendants(this.api.blocks.getChildren(this.blockId), id => this.api.blocks.getChildren(id))
    );
    this.updatePlaceholder();
    this.container()?.sync();
  }

  public save(): TabData {
    return { ...this._data };
  }

  public validate(_data: TabData): boolean {
    return true;
  }

  /**
   * Apply new data in place, so a rename or a peer's edit never rebuilds the
   * panel and its children.
   * @param newData - the tab's new data
   */
  public setData(newData: Partial<TabData>): boolean {
    this._data = normalize({ ...this._data, ...newData });
    this.container()?.sync();

    return true;
  }

  /**
   * Find-in-page calls this on a hidden ancestor of a match: show this tab.
   */
  public expand(): void {
    const parentId = this.block.parentId;

    if (parentId !== null) {
      this.container()?.activate(this.blockId);
    }
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.updatePlaceholder();
  }

  public removed(): void {
    this.api.events.off('block changed', this.handleBlockChanged);

    const container = this.container();

    queueMicrotask(() => container?.sync());
  }

  public destroy(): void {
    this.api.events.off('block changed', this.handleBlockChanged);
  }

  /** The tabs block this panel is mounted in. */
  private container(): ReturnType<typeof tabRegistry.container> {
    return tabRegistry.container(this.wrapper?.parentElement?.closest(`[${TABS_ATTR.root}]`));
  }

  private readonly handleBlockChanged = (): void => {
    this.updatePlaceholder();
  };

  private updatePlaceholder(): void {
    if (this.placeholder === null) {
      return;
    }

    const empty = this.api.blocks.getChildren(this.blockId).length === 0;

    this.placeholder.classList.toggle('hidden', !empty || this.readOnly);
  }

  private readonly handlePlaceholderClick = (): void => {
    if (this.readOnly || this.childSlot === null) {
      return;
    }

    const paragraph = this.api.blocks.insertAt(undefined, undefined, { parentId: this.blockId, position: 'end' });

    this.childSlot.appendChild(paragraph.holder);
    this.updatePlaceholder();
    this.api.caret.setToBlock(paragraph.id, 'start');
  };

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /** Enter on the last empty line of a tab adds a line in the tab, never leaves it. */
  public static get keepsChildrenOnEnter(): boolean {
    return true;
  }

  /** A tab is layout: no toolbar or selection of its own, and its content is not indented. */
  public static get isLayout(): boolean {
    return true;
  }

  /** Deleting a tab deletes its content. Promoting it would drop stray blocks into the strip. */
  public static get deletesChildren(): boolean {
    return true;
  }

  public static get childTools(): { deny: string[] } {
    return { deny: [TABS_TOOL] };
  }

  public static get sanitize(): SanitizerConfig {
    return tabSanitize();
  }
}

export type { TabData };
