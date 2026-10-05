import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  ConversionConfig,
  SanitizerConfig,
  ToolboxConfig,
} from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconLinkExternal, IconLock, IconPage } from '../../components/icons';
import { openModalDialog, type ModalDialogHandle } from '../../components/utils/modal-dialog';
import { CSS } from '../../components/utils/notifier/draw';
import { twJoin } from '../../components/utils/tw';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { generateBlockId } from '../../components/utils/id-generator';
import { PLAINTEXT } from '../../components/utils/sanitizer';
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
import type { PageConfig, PageData, PageIcon, PageInfo } from './types';

export type { PageCache, PageConfig, PageData, PageIcon, PageInfo, PageSearchResult } from './types';

type PageState = 'unresolved' | 'normal' | 'untitled' | 'missing' | 'no-access';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  private data: { pageId: string };
  /** Minted here: this instance is the user's or the API's new page. */
  private readonly isNew: boolean;
  private readonly opensWhenCreated: boolean;
  private readonly isProbe: boolean;
  private root: HTMLElement | null = null;
  private info: PageInfo | null | undefined;
  private requestVersion = 0;
  private started = false;
  private detached = false;
  private unsubscribe: (() => void) | undefined;
  private accessDialog: ModalDialogHandle | null = null;
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
    this.opensWhenCreated = origin === 'user';
    this.isProbe = origin === 'probe';
    this.data = { pageId: this.isNew ? generateBlockId() : pageId };
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
    return {
      pageId: PLAINTEXT,
      cache: PLAINTEXT,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /** The body lives in another document; exports skip a page's children. */
  public static get acceptsChildren(): boolean {
    return false;
  }

  /**
   * A page exists once, so a copy carries a link to it. The url is absolute:
   * a relative href means nothing once pasted into another app.
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

    if (this.isNew) {
      void this.createPage();

      return;
    }

    void this.refresh();
  }

  public save(): PageData {
    return { pageId: this.data.pageId };
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
    this.data = { pageId };
    if (moved && this.started) {
      this.listen();
      void this.refresh();
    } else {
      this.renderView();
    }

    return true;
  }

  public setReadOnly(_state: boolean): void {}

  public removed(): void {
    this.detached = true;
    ++this.requestVersion;
    this.stopListening();
    this.preview.hide();
    this.accessDialog?.close();
  }

  public destroy(): void {
    this.removed();
  }

  public renderSettings(): MenuConfig {
    const link = this.isNavigable ? PageTool.copyAsLink(this.data, this.config) : null;

    if (link === null) {
      return [];
    }

    return [
      {
        icon: IconLinkExternal,
        title: this.api.i18n.t('tools.file.previewOpenInNewTab'),
        name: 'page-open-new-tab',
        closeOnActivate: true,
        onActivate: (): void => {
          if (this.isNavigable) {
            window.open(link.url, '_blank', 'noopener,noreferrer');
          }
        },
      },
    ];
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
      await this.config.create?.({ pageId });
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

  private async refresh(fallback: null | undefined = undefined): Promise<void> {
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

    return Promise.resolve().then(() => preview(pageId)).then(previewLines);
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

    link.addEventListener('mousedown', this.handleMouseDown);
    link.addEventListener('click', this.handleClick);
    link.append(this.buildIcon(), this.buildTitle(state));
    this.preview.attach(link);

    return link;
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
