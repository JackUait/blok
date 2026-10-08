import { pageSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  ConversionConfig,
  OutputBlockData,
  SanitizerConfig,
  ToolboxConfig,
} from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import {
  IconArrowDiagonal,
  IconEmojiSmile,
  IconLock,
  IconPage,
  IconPencil,
  IconSplitView,
} from '../../components/icons';
import { buildBlockColorTunes, type BlockColorData } from '../../components/shared/block-color';
import { COLOR_PRESETS, colorVarName } from '../../components/shared/color-presets';
import { getUserOS } from '../../components/utils/browser';
import { startInlineRename } from '../../components/utils/inline-rename';
import { beautifyShortcut } from '../../components/utils/string';
import { EmojiPicker } from '../callout/emoji-picker';
import { openModalDialog, type ModalDialogHandle } from '../../components/utils/modal-dialog';
import { CSS } from '../../components/utils/notifier/draw';
import { twJoin } from '../../components/utils/tw';
import type { MenuConfig, MenuConfigItem } from '../../../types/tools/menu-config';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { generateBlockId } from '../../components/utils/id-generator';
import { log } from '../../components/utils/logger';
import { safeHref } from '../../components/utils/sanitize-url';
import {
  PAGE_ICON_CLASSES,
  PAGE_LINK_CLASSES,
  PAGE_LINK_DENIED_CLASSES,
  PAGE_LINK_DISABLED_CLASSES,
  PAGE_LINK_ENABLED_CLASSES,
  PAGE_TITLE_CLASSES,
  PAGE_TITLE_MUTED_CLASSES,
  PAGE_WRAPPER_CLASSES,
} from './constants';
import { PageHoverPreview, pageIconNode, previewLines, type PageHoverContent, type PagePreviewLine } from './hover-preview';
import { renderPagePreview } from './preview';
import { outputBlocksToHtml } from '../../shared/rich-text/block-data';
import { declaredRichTextFields } from '../../components/tools/base';
import { richTextFieldsFor } from '../../shared/rich-text/fields';
import type { PageConfig, PageData, PageIcon, PageInfo } from './types';

const isOutputBlock = (value: unknown): value is OutputBlockData =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  && typeof Reflect.get(value, 'data') === 'object' && Reflect.get(value, 'data') !== null;

export type { PageCache, PageConfig, PageCreateResult, PageData, PageIcon, PageInfo, PageSearchResult } from './types';

type PageState = 'unresolved' | 'normal' | 'untitled' | 'missing' | 'no-access';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The id `create` answered with; anything else keeps the id Blok passed. */
const createdId = (answer: unknown): string | undefined =>
  isRecord(answer) && typeof answer.pageId === 'string' && answer.pageId !== '' ? answer.pageId : undefined;

/**
 * Ids `prepareInsert` made pages for. The block the toolbox then inserts
 * takes its id out and opens the page; a flag in data would be saved.
 */
const preparedPageIds = new Set<string>();

const COLOR_NAMES = new Set(COLOR_PRESETS.map((preset) => preset.name));

/** Only a preset name reaches a style: a raw value could carry CSS. */
const readColors = (data: Partial<PageData> | undefined): BlockColorData => {
  const colors: BlockColorData = {};

  if (typeof data?.textColor === 'string' && COLOR_NAMES.has(data.textColor)) {
    colors.textColor = data.textColor;
  }
  if (typeof data?.backgroundColor === 'string' && COLOR_NAMES.has(data.backgroundColor)) {
    colors.backgroundColor = data.backgroundColor;
  }

  return colors;
};

const isRenameShortcut = (event: KeyboardEvent): boolean =>
  event.code === 'KeyR' && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);

const readIcon = (value: unknown): PageIcon | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === 'emoji' && typeof value.value === 'string' && value.value !== '') {
    return { type: 'emoji', value: value.value };
  }
  if (value.type === 'image' && typeof value.url === 'string' && value.url !== '') {
    return { type: 'image', url: value.url };
  }

  return undefined;
};

/** A page block points to a host-owned page. Only its ID is saved. */
export class PageTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: PageConfig;
  private data: { pageId: string } & BlockColorData;
  /** Minted here: this instance is the user's or the API's new page. */
  private readonly isNew: boolean;
  /** Made by `prepareInsert` before the toolbox inserted it: open it, never create it. */
  private readonly isPrepared: boolean;
  private readonly opensWhenCreated: boolean;
  private readonly isProbe: boolean;
  private root: HTMLElement | null = null;
  private info: PageInfo | null | undefined;
  private requestVersion = 0;
  private started = false;
  private detached = false;
  private unsubscribe: (() => void) | undefined;
  private accessDialog: ModalDialogHandle | null = null;
  private readOnly: boolean;
  private renaming = false;
  private emojiPicker: EmojiPicker | null = null;
  private readonly preview = new PageHoverPreview(() => this.previewContent(), () => this.previewBody());

  constructor(options: BlockToolConstructorOptions<PageData, PageConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.config = options.config ?? {};

    const pageId = typeof options.data?.pageId === 'string' ? options.data.pageId : '';
    const origin = options.origin ?? 'api';

    // Restore origins (load, replay, paste, probe, convert) never mint: the
    // document is the truth there, and a probe is never inserted.
    this.isNew = pageId === '' && !options.readOnly && (origin === 'user' || origin === 'api');
    this.isPrepared = origin === 'user' && !options.readOnly && preparedPageIds.delete(pageId);
    this.opensWhenCreated = origin === 'user';
    this.isProbe = origin === 'probe';
    this.data = { pageId: this.isNew ? generateBlockId() : pageId, ...readColors(options.data) };
    this.readOnly = Boolean(options.readOnly);
  }

  /** The block menu is a "Page" section with Turn into first, and Delete reads "Move to Trash". */
  public static get blockMenu(): { titled: boolean; trash: boolean } {
    return { titled: true, trash: true };
  }

  /**
   * The toolbox waits for this before it inserts a page, so the block is
   * born with the id the host's `create` answered. A rejection inserts nothing.
   */
  public static async prepareInsert(config: PageConfig): Promise<PageData> {
    const minted = generateBlockId();
    const pageId = createdId(await config.create?.({ pageId: minted })) ?? minted;

    preparedPageIds.add(pageId);

    return { pageId };
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconPage,
      titleKey: 'page',
      searchTerms: ['page', 'subpage', 'sub-page', 'doc', 'document', 'new page'],
      section: 'basic',
      preview: { render: renderPagePreview, descriptionKey: 'toolbox.preview.page' },
    };
  }

  /** Plain text: an HTML parse would cut a title at `<` and turn `&` into `&amp;`. */
  public static get sanitize(): SanitizerConfig {
    return pageSanitize();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /** The body lives in another document; exports skip a page's children. */
  public static get acceptsChildren(): boolean {
    return false;
  }

  /**
   * The link a copy becomes outside the page's own document, and in other
   * apps. The url is absolute: a relative href means nothing once pasted elsewhere.
   */
  public static copyAsLink(data: PageData, config: PageConfig): { url: string; text: string } | null {
    const pageId = typeof data.pageId === 'string' ? data.pageId : '';

    try {
      const href = config.href === undefined || pageId === '' ? null : safeHref(config.href(pageId));

      return href === null ? null : { url: new URL(href, document.baseURI).href, text: 'Page' };
    } catch {
      return null;
    }
  }

  public static get conversionConfig(): ConversionConfig {
    return { export: (): string => 'Page' };
  }

  public render(): HTMLElement {
    const root = document.createElement('div');

    root.className = PAGE_WRAPPER_CLASSES;
    root.setAttribute(DATA_ATTR.tool, 'page');
    // Nothing here is edited in place; data reaches the document through
    // dispatchChange, so re-renders must not count as edits.
    root.setAttribute(DATA_ATTR.mutationFree, 'true');
    // The page has its own hover preview and click; Blok's link card would cover it.
    root.setAttribute(DATA_ATTR.linkOwner, '');
    this.root = root;
    this.renderView();

    return root;
  }

  /** Called again when the block moves, so the work runs once. */
  public rendered(): void {
    if (this.started || this.isProbe) {
      return;
    }
    this.started = true;
    this.listen();
    document.addEventListener('keydown', this.handleDocumentKeydown);

    if (this.isNew) {
      void this.createPage();

      return;
    }
    if (this.isPrepared) {
      void this.openPrepared();

      return;
    }

    void this.refresh();
  }

  public save(): PageData {
    return { ...this.data };
  }

  /** A block failing this is dropped on save, so only an empty id fails. */
  public validate(data: PageData): boolean {
    return typeof data.pageId === 'string' && data.pageId.length > 0;
  }

  /**
   * Undo/redo and peers land here. Never resolves or writes: a re-created
   * block would, and two viewers whose hosts disagree would then rewrite
   * each other forever.
   */
  public setData(data: PageData): boolean {
    const pageId = typeof data.pageId === 'string' ? data.pageId : '';
    const moved = pageId !== this.data.pageId;

    if (moved) {
      ++this.requestVersion;
      this.info = undefined;
    }
    this.data = { pageId, ...readColors(data) };
    if (moved && this.started) {
      this.listen();
      void this.refresh();
    } else {
      this.renderView();
    }

    return true;
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
  }

  public removed(): void {
    this.detached = true;
    ++this.requestVersion;
    this.stopListening();
    document.removeEventListener('keydown', this.handleDocumentKeydown);
    this.preview.hide();
    this.accessDialog?.close();
    this.emojiPicker?.close();
    this.emojiPicker?.getElement().remove();
    this.emojiPicker = null;
  }

  public destroy(): void {
    this.removed();
  }

  public renderSettings(): MenuConfig {
    const { t } = this.api.i18n;
    const navigable = this.isNavigable;
    const edits: MenuConfigItem[] = this.colorTunes();
    const opens: MenuConfigItem[] = [];

    if (navigable && this.config.setIcon !== undefined) {
      edits.push({
        icon: IconEmojiSmile,
        title: t('tools.page.editIcon'),
        name: 'page-edit-icon',
        closeOnActivate: true,
        onActivate: (): void => this.openIconPicker(),
      });
    }
    if (navigable && this.config.rename !== undefined) {
      edits.push({
        icon: IconPencil,
        title: t('tools.page.rename'),
        name: 'page-rename',
        secondaryLabel: beautifyShortcut('CMD+SHIFT+R'),
        closeOnActivate: true,
        onActivate: (): void => this.startRename(),
      });
    }

    const link = navigable ? PageTool.copyAsLink(this.save(), this.config) : null;

    if (link !== null) {
      opens.push({
        icon: IconArrowDiagonal,
        title: t('tools.file.previewOpenInNewTab'),
        name: 'page-open-new-tab',
        secondaryLabel: beautifyShortcut('CMD+SHIFT+ENTER'),
        closeOnActivate: true,
        onActivate: (): void => {
          if (this.isNavigable) {
            window.open(link.url, '_blank', 'noopener,noreferrer');
          }
        },
      });
    }

    const peek = this.config.peek;

    if (navigable && peek !== undefined) {
      const click = t('blockSettings.clickAction');

      opens.push({
        icon: IconSplitView,
        title: t('tools.page.openInSidePeek'),
        name: 'page-open-side-peek',
        secondaryLabel: getUserOS().mac ? `⌥${click}` : `Alt+${click}`,
        closeOnActivate: true,
        onActivate: (): void => {
          if (this.isNavigable) {
            peek(this.data.pageId, {});
          }
        },
      });
    }

    return opens.length === 0 ? edits : [...edits, { type: PopoverItemType.Separator }, ...opens];
  }

  /** Enter on the selected block opens the page or explains denied access. */
  public onNavigationEnter(event: KeyboardEvent): boolean {
    if (this.state === 'no-access') {
      this.showNoAccessDialog();

      return true;
    }
    if (!this.isNavigable) {
      return false;
    }

    // Cmd/Ctrl+Shift+Enter is "Open in new tab" from the block menu, so it
    // wins over the host's own open.
    const newTab = event.shiftKey && (event.metaKey || event.ctrlKey)
      ? PageTool.copyAsLink(this.save(), this.config)
      : null;

    if (newTab !== null) {
      window.open(newTab.url, '_blank', 'noopener,noreferrer');

      return true;
    }

    const open = this.config.open;

    if (open !== undefined) {
      open(this.data.pageId, { event });

      return true;
    }

    const link = this.root?.querySelector('a[href]');

    if (!(link instanceof HTMLAnchorElement)) {
      return false;
    }
    // A synthetic click drops the modifier keys, so a new tab must be asked for.
    if (event.metaKey || event.ctrlKey) {
      window.open(link.getAttribute('href') ?? '', '_blank', 'noopener');

      return true;
    }
    // A real click, so the browser follows the href as it would for a mouse.
    link.click();

    return true;
  }

  private colorTunes(): MenuConfigItem[] {
    return buildBlockColorTunes({
      data: this.data,
      i18n: this.api.i18n,
      onPick: (field, value): void => {
        const { [field]: _old, ...rest } = this.data;

        this.data = value === undefined ? rest : { ...rest, [field]: value };
        this.renderView();
        this.block.dispatchChange();
      },
    }) as MenuConfigItem[];
  }

  private startRename(): void {
    const rename = this.config.rename;
    const link = this.root?.querySelector('a');

    if (rename === undefined || this.renaming || !this.isNavigable || !(link instanceof HTMLAnchorElement)) {
      return;
    }

    const { pageId } = this.data;
    const current = this.info?.title ?? '';

    this.preview.hide();
    this.renaming = true;
    startInlineRename({
      target: link,
      currentValue: current,
      label: this.api.i18n.t('tools.page.rename'),
      configureInput: (input) => {
        input.setAttribute('class', `${PAGE_LINK_CLASSES} ${PAGE_TITLE_CLASSES} bg-transparent outline-none`);
        input.setAttribute('placeholder', this.api.i18n.t('tools.page.untitled'));
        input.setAttribute(DATA_ATTR.testid, 'page-rename-input');
        // The field's own keys (arrows, Escape, Backspace) must not move blocks.
        input.setAttribute(DATA_ATTR.keyboardOwner, '');
      },
      buildRestored: () => {
        this.renaming = false;

        return this.buildLink();
      },
      onCancel: () => {
        this.renaming = false;
      },
      onCommit: (title) => {
        this.renaming = false;
        if (title === current || pageId !== this.data.pageId || this.detached) {
          return;
        }
        this.info = { ...this.info, title };
        this.renderView();
        void this.saveToHost(() => rename(pageId, title));
      },
    });
  }

  /**
   * Shows the edit at once, then asks the host again: a failed save brings
   * back the host's value. The hook runs now, so a throw is caught too.
   */
  private async saveToHost(write: () => void | Promise<void>): Promise<void> {
    try {
      await new Promise<void>((resolve) => resolve(write()));
    } catch {
      // The refresh below shows what the host kept.
    }
    await this.refresh(this.info);
  }

  private openIconPicker(): void {
    const setIcon = this.config.setIcon;
    const anchor = this.root?.querySelector<HTMLElement>(`[${DATA_ATTR.testid}="page-icon"]`);

    if (setIcon === undefined || !this.isNavigable || anchor === null || anchor === undefined) {
      return;
    }

    const { pageId } = this.data;
    const save = (icon: PageIcon | null): void => {
      if (pageId !== this.data.pageId || this.detached) {
        return;
      }
      this.info = { ...this.info, icon: icon ?? undefined };
      this.renderView();
      void this.saveToHost(() => setIcon(pageId, icon));
    };
    const handlers = {
      onSelect: (native: string): void => save({ type: 'emoji', value: native }),
      onRemove: (): void => save(null),
    };

    if (this.emojiPicker === null) {
      this.emojiPicker = new EmojiPicker({ ...handlers, i18n: this.api.i18n, locale: this.api.i18n.getLocale() });
    }

    const element = this.emojiPicker.getElement();

    if (!element.isConnected) {
      document.body.appendChild(element);
    }
    void this.emojiPicker.open(anchor, undefined, handlers);
  }

  private async createPage(): Promise<void> {
    const { pageId } = this.data;

    // One microtask: the insert adds the block to the document synchronously,
    // and the id write must land after it.
    await Promise.resolve();
    if (this.detached || pageId !== this.data.pageId) {
      return;
    }
    // Core's post-insert normalise fills only keys the insert lacked, so an
    // insert carrying `pageId: ''` would keep the empty id without this write.
    this.block.dispatchChange({ derived: true });

    try {
      const answered = createdId(await this.config.create?.({ pageId }));

      if (answered !== undefined && answered !== pageId) {
        log(`Page create() answered "${answered}" for a block already inserted as "${pageId}"; the block keeps "${pageId}". Pass pageId to blocks.insert() to use your own id.`, 'warn');
      }
    } catch {
      if (this.detached || pageId !== this.data.pageId) {
        return;
      }
      this.info = null;
      this.renderView();
      if (this.config.resolve !== undefined) {
        await this.refresh(null);
      }

      return;
    }

    if (this.detached || pageId !== this.data.pageId) {
      return;
    }
    if (this.opensWhenCreated) {
      this.config.open?.(pageId, {});
    }

    await this.refresh();
  }

  private async openPrepared(): Promise<void> {
    const { pageId } = this.data;

    // The insert adds the block to the document after this call.
    await Promise.resolve();
    if (this.detached || pageId !== this.data.pageId) {
      return;
    }
    this.config.open?.(pageId, {});

    await this.refresh();
  }

  private listen(): void {
    this.stopListening();

    const { pageId } = this.data;
    const stop = pageId === '' ? undefined : this.config.subscribe?.(pageId, () => {
      if (pageId === this.data.pageId && !this.detached) {
        void this.refresh();
      }
    });

    // A no-op still marks the block as listening, so setData moves it to a new page.
    this.unsubscribe = typeof stop === 'function' ? stop : (): void => undefined;
  }

  private stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** `fallback` is shown while the host answers; a saved edit passes what it just showed. */
  private async refresh(fallback: PageInfo | null | undefined = undefined): Promise<void> {
    const pageId = this.data.pageId;
    const version = ++this.requestVersion;

    this.info = fallback;
    this.renderView();
    if (pageId === '' || this.config.resolve === undefined) {
      return;
    }

    const info = await Promise.resolve()
      .then(() => this.config.resolve?.(pageId))
      .catch((): undefined => undefined);

    if (this.detached || version !== this.requestVersion || pageId !== this.data.pageId) {
      return;
    }

    this.info = info === undefined ? fallback : info;
    this.renderView();
  }

  private get state(): PageState {
    if (this.info === undefined) {
      return 'unresolved';
    }
    if (this.info === null) {
      return 'missing';
    }
    if (this.info.access === 'none') {
      return 'no-access';
    }

    const title = this.info.title;

    return typeof title === 'string' && title.trim() !== '' ? 'normal' : 'untitled';
  }

  private get isNavigable(): boolean {
    return this.data.pageId !== '' && (this.state === 'normal' || this.state === 'untitled');
  }

  private renderView(): void {
    // The rename field stands where the link was; it rebuilds the link itself.
    if (this.renaming) {
      return;
    }
    if (this.state !== 'no-access') {
      this.accessDialog?.close();
    }
    // The preview is anchored to the link being replaced.
    this.preview.hide();
    this.root?.replaceChildren(this.buildLink());
  }

  private previewBody(): Promise<PagePreviewLine[]> | null {
    const preview = this.config.preview;

    if (preview === undefined || !this.isNavigable) {
      return null;
    }

    const { pageId } = this.data;

    return Promise.resolve().then(() => preview(pageId)).then((blocks) => previewLines(this.previewBlocksAsHtml(blocks)));
  }

  /** The host may store the page as segments; the preview reads HTML text. */
  private previewBlocksAsHtml(blocks: unknown): unknown {
    if (!Array.isArray(blocks)) {
      return blocks;
    }
    const installed = typeof this.api.tools?.getBlockTools === 'function' ? this.api.tools.getBlockTools() : [];
    const fieldsOf = (type: string): string[] => {
      const tool = installed.find((candidate) => candidate.name === type);

      // The built-in table only for uninstalled types: the preview writes nothing back.
      return tool === undefined ? richTextFieldsFor(type) : declaredRichTextFields(Reflect.get(tool, 'constructable'));
    };

    return blocks.map((block: unknown) => (isOutputBlock(block) ? outputBlocksToHtml([block], fieldsOf)[0] : block));
  }

  private previewContent(): PageHoverContent | null {
    if (!this.isNavigable) {
      return null;
    }

    const state = this.state;

    const path = this.info?.path;

    return {
      icon: readIcon(this.info?.icon),
      title: this.titleText(state),
      path: Array.isArray(path) ? path.filter((title): title is string => typeof title === 'string') : [],
    };
  }

  private buildLink(): HTMLAnchorElement {
    const state = this.state;
    const link = document.createElement('a');

    const nonNavigableClasses = state === 'no-access' ? PAGE_LINK_DENIED_CLASSES : PAGE_LINK_DISABLED_CLASSES;
    const stateClasses = this.isNavigable ? PAGE_LINK_ENABLED_CLASSES : nonNavigableClasses;

    link.className = `${PAGE_LINK_CLASSES} ${stateClasses}`;
    link.setAttribute(DATA_ATTR.testid, 'page-link');
    link.setAttribute(DATA_ATTR.blockContextMenu, '');
    link.setAttribute('data-blok-page-state', state);
    // Never focused, so Blok keeps its keys (undo, Escape, arrows). Tab is
    // Blok's indent; the keyboard opens the page from navigation mode.
    link.tabIndex = -1;
    // Blocks move by Blok's drag handle, not by a native link drag.
    link.draggable = false;

    if (this.isNavigable) {
      const href = (() => {
        try {
          return this.config.href === undefined ? null : safeHref(this.config.href(this.data.pageId));
        } catch {
          return null;
        }
      })();

      if (href !== null) {
        link.setAttribute('href', href);
      }
    } else if (state === 'no-access') {
      link.setAttribute('role', 'button');
      link.setAttribute('aria-haspopup', 'dialog');
    } else {
      link.setAttribute('aria-disabled', 'true');
    }

    this.paintColor(link);
    link.addEventListener('mousedown', this.handleMouseDown);
    link.addEventListener('click', this.handleClick);
    link.append(this.buildIcon(), this.buildTitle(state));
    this.preview.attach(link);

    return link;
  }

  /** Important: the link's own ink class is important too, or it would win. */
  private paintColor(link: HTMLElement): void {
    const { textColor, backgroundColor } = this.data;

    if (textColor !== undefined) {
      link.style.setProperty('color', colorVarName(textColor, 'text'), 'important');
    }
    if (backgroundColor !== undefined) {
      link.style.setProperty('background-color', colorVarName(backgroundColor, 'bg'));
    }
  }

  private buildIcon(): HTMLElement {
    const slot = document.createElement('span');

    slot.className = PAGE_ICON_CLASSES;
    slot.setAttribute(DATA_ATTR.testid, 'page-icon');
    slot.setAttribute('aria-hidden', 'true');

    if (this.state === 'no-access') {
      slot.innerHTML = IconLock;
    } else {
      slot.replaceChildren(pageIconNode(this.isNavigable ? readIcon(this.info?.icon) : undefined));
    }

    return slot;
  }

  private buildTitle(state: PageState): HTMLElement {
    const title = document.createElement('span');
    const muted = state !== 'normal';

    title.className = muted ? `${PAGE_TITLE_CLASSES} ${PAGE_TITLE_MUTED_CLASSES}` : PAGE_TITLE_CLASSES;
    title.setAttribute(DATA_ATTR.testid, 'page-title');
    title.textContent = this.titleText(state);

    return title;
  }

  private titleText(state: PageState): string {
    switch (state) {
      case 'unresolved':
        return this.api.i18n.t('tools.page.unresolved');
      case 'missing':
        return this.api.i18n.t('tools.page.missing');
      case 'no-access':
        return this.api.i18n.t('tools.page.noAccess');
      case 'untitled':
        return this.api.i18n.t('tools.page.untitled');
      case 'normal':
        return this.info?.title ?? '';
    }
  }

  private showNoAccessDialog(): void {
    if (this.detached || this.state !== 'no-access' || this.accessDialog !== null) {
      return;
    }

    const backdrop = document.createElement('div');
    const panel = document.createElement('div');
    const title = document.createElement('h2');
    const body = document.createElement('p');
    const closeButton = document.createElement('button');
    const id = generateBlockId();

    backdrop.className = 'fixed flex items-center justify-center bg-black/50 p-4';
    // The top-layer reset clears class-based inset.
    backdrop.style.inset = '0';
    backdrop.setAttribute(DATA_ATTR.testid, 'page-access-dialog');
    backdrop.setAttribute(DATA_ATTR.interface, 'page-access-dialog');
    panel.className = twJoin(
      CSS.notification,
      CSS.dialog,
      'w-[420px] max-w-[calc(100vw-32px)] flex-col items-start gap-4 py-5'
    );
    title.id = `blok-page-access-title-${id}`;
    title.className = 'text-[17px] font-medium';
    title.textContent = this.api.i18n.t('tools.page.accessDialogTitle');
    body.id = `blok-page-access-body-${id}`;
    body.textContent = this.api.i18n.t('tools.page.accessDialogBody');
    closeButton.type = 'button';
    closeButton.className = twJoin(CSS.btn, CSS.okBtn);
    closeButton.textContent = this.api.i18n.t('tools.page.accessDialogClose');

    const close = (): void => this.accessDialog?.close();

    closeButton.addEventListener('click', close);
    panel.append(title, body, closeButton);
    backdrop.append(panel);
    this.accessDialog = openModalDialog({
      content: backdrop,
      surface: panel,
      labelledBy: title.id,
      describedBy: body.id,
      initialFocus: () => closeButton,
      directionSource: this.root,
      onDismiss: close,
      onClose: () => { this.accessDialog = null; },
    });
  }

  /** A browser focuses a link on mousedown; tabIndex -1 alone does not stop that. */
  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) {
      event.preventDefault();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!isRenameShortcut(event) || this.readOnly || !this.block.selected || this.config.rename === undefined || !this.isNavigable) {
      return;
    }
    // Ahead of the browser's hard reload on the same keys.
    event.preventDefault();
    this.startRename();
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.state === 'no-access') {
      event.preventDefault();
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        this.showNoAccessDialog();
      }

      return;
    }
    if (!this.isNavigable) {
      event.preventDefault();

      return;
    }

    const peek = this.config.peek;

    // Alt+click would download the link; the host's side peek replaces that.
    if (peek !== undefined && event.button === 0 && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      peek(this.data.pageId, { event });

      return;
    }

    // Modified and non-primary clicks keep the browser's own meaning (new tab, new window).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const open = this.config.open;

    if (open === undefined) {
      return;
    }

    event.preventDefault();
    open(this.data.pageId, { event });
  };
}
