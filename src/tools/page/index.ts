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
import { IconLinkExternal, IconPage } from '../../components/icons';
import { generateBlockId } from '../../components/utils/id-generator';
import { PLAINTEXT } from '../../components/utils/sanitizer';
import { safeHref } from '../../components/utils/sanitize-url';
import type { MenuConfig } from '../../../types/tools/menu-config';
import {
  PAGE_ICON_CLASSES,
  PAGE_LINK_CLASSES,
  PAGE_LINK_DISABLED_CLASSES,
  PAGE_LINK_ENABLED_CLASSES,
  PAGE_TITLE_CLASSES,
  PAGE_TITLE_MUTED_CLASSES,
  PAGE_WRAPPER_CLASSES,
} from './constants';
import { PageHoverPreview, pageIconNode, previewLines, type PageHoverContent, type PagePreviewLine } from './hover-preview';
import { renderPagePreview } from './preview';
import type { PageCache, PageConfig, PageData, PageIcon, PageInfo } from './types';

export type { PageCache, PageConfig, PageData, PageIcon, PageInfo } from './types';

type PageState = 'normal' | 'untitled' | 'missing' | 'no-access';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Saved data is wire data: keep only a well-formed icon. */
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

const readCache = (value: unknown): PageCache | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const icon = readIcon(value.icon);
  const cache: PageCache = {
    ...(typeof value.title === 'string' && { title: value.title }),
    ...(icon !== undefined && { icon }),
  };

  return Object.keys(cache).length > 0 ? cache : undefined;
};

const sameCache = (a: PageCache | undefined, b: PageCache | undefined): boolean =>
  JSON.stringify(readCache(a) ?? {}) === JSON.stringify(readCache(b) ?? {});

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Page block: a link to another page, like Notion's sub-page block.
 *
 * The block only points at the page (`pageId`). The host owns the page and
 * its title; `cache` is a display copy refreshed from `config.resolve`.
 */
export class PageTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: PageConfig;
  private data: { pageId: string; cache?: PageCache };
  private readOnly: boolean;
  /** Minted here: this instance is the user's or the API's new page. */
  private readonly isNew: boolean;
  private readonly opensWhenCreated: boolean;
  private readonly isProbe: boolean;
  private root: HTMLElement | null = null;
  private found: 'yes' | 'missing' | 'no-access' = 'yes';
  /**
   * What read-only mode shows from `resolve` without saving it. Wrapped so
   * a page with no title or icon still hides the old cache.
   */
  private shown: { cache: PageCache | undefined } | undefined;
  private started = false;
  private detached = false;
  private unsubscribe: (() => void) | undefined;
  /** Titles above the page, from the last `resolve`. Shown only in the hover preview. */
  private path: string[] = [];
  private readonly preview = new PageHoverPreview(() => this.previewContent(), () => this.previewBody());

  constructor(options: BlockToolConstructorOptions<PageData, PageConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.config = options.config ?? {};
    this.readOnly = options.readOnly;

    const pageId = typeof options.data?.pageId === 'string' ? options.data.pageId : '';
    const origin = options.origin ?? 'api';

    // Restore origins (load, replay, paste, probe, convert) never mint: the
    // document is the truth there, and a probe is never inserted.
    this.isNew = pageId === '' && !options.readOnly && (origin === 'user' || origin === 'api');
    this.opensWhenCreated = origin === 'user';
    this.isProbe = origin === 'probe';
    this.data = {
      pageId: this.isNew ? generateBlockId() : pageId,
      cache: readCache(options.data?.cache),
    };
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
    const href = config.href === undefined || pageId === '' ? null : safeHref(config.href(pageId));

    if (href === null) {
      return null;
    }

    try {
      return { url: new URL(href, document.baseURI).href, text: readCache(data.cache)?.title ?? '' };
    } catch {
      return null;
    }
  }

  /** Turn into text keeps the title as literal text. */
  public static get conversionConfig(): ConversionConfig {
    return {
      export: (data): string => escapeText(readCache(data.cache)?.title ?? ''),
    };
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
    const cache = readCache(this.data.cache);

    return {
      pageId: this.data.pageId,
      ...(cache !== undefined && { cache }),
    };
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
      // The missing or locked verdict was about the old page.
      this.found = 'yes';
      this.shown = undefined;
    }
    this.data = { pageId, cache: readCache(data.cache) };
    if (moved && this.unsubscribe !== undefined) {
      this.listen();
    }
    this.renderView();

    return true;
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    const shown = this.shown;

    if (state || shown === undefined) {
      return;
    }
    // Read-only showed a fresher cache than the document holds; save it now.
    this.shown = undefined;
    this.writeCache(shown.cache);
  }

  public removed(): void {
    this.detached = true;
    this.stopListening();
    this.preview.hide();
  }

  public destroy(): void {
    this.stopListening();
    this.preview.hide();
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
          window.open(link.url, '_blank', 'noopener,noreferrer');
        },
      },
    ];
  }

  /**
   * Enter on the selected block opens the page. A missing or locked page
   * returns false: the block has no inputs, so core just keeps it selected.
   */
  public onNavigationEnter(event: KeyboardEvent): boolean {
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
    if (this.detached) {
      return;
    }
    // Core's post-insert normalise fills only keys the insert lacked, so an
    // insert carrying `pageId: ''` would keep the empty id without this write.
    this.block.dispatchChange({ derived: true });

    try {
      await this.config.create?.({ pageId });
    } catch {
      if (this.detached) {
        return;
      }
      // The host failed to make the page: show it missing, unless resolve
      // finds it after all.
      this.found = 'missing';
      this.renderView();
      await this.refresh();

      return;
    }

    if (this.detached) {
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
    const stop = pageId === '' ? undefined : this.config.subscribe?.(pageId, () => void this.refresh());

    // A no-op still marks the block as listening, so setData moves it to a new page.
    this.unsubscribe = typeof stop === 'function' ? stop : (): void => undefined;
  }

  private stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async refresh(): Promise<void> {
    const { pageId } = this.data;
    const resolve = this.config.resolve;

    if (resolve === undefined || pageId === '') {
      return;
    }

    const info = await Promise.resolve()
      .then(() => resolve(pageId))
      .catch((): undefined => undefined);

    if (this.detached || pageId !== this.data.pageId || info === undefined) {
      return;
    }

    this.applyInfo(info);
  }

  private applyInfo(info: PageInfo | null): void {
    if (info === null || info.access === 'none') {
      this.found = info === null ? 'missing' : 'no-access';
      this.renderView();

      return;
    }

    this.found = 'yes';
    this.path = Array.isArray(info.path) ? info.path.filter((title): title is string => typeof title === 'string') : [];

    const fresh = readCache({ title: info.title, icon: info.icon });

    if (this.readOnly) {
      this.shown = { cache: fresh };
      this.renderView();

      return;
    }

    this.shown = undefined;
    this.writeCache(fresh);
  }

  private writeCache(cache: PageCache | undefined): void {
    if (sameCache(cache, this.data.cache)) {
      this.renderView();

      return;
    }

    this.data = { pageId: this.data.pageId, cache };
    this.renderView();
    this.block.dispatchChange({ derived: true });
  }

  private get state(): PageState {
    if (this.found === 'missing') {
      return 'missing';
    }
    if (this.found === 'no-access') {
      return 'no-access';
    }

    const title = this.visibleCache()?.title;

    return title !== undefined && title.trim() !== '' ? 'normal' : 'untitled';
  }

  private visibleCache(): PageCache | undefined {
    return this.shown === undefined ? this.data.cache : this.shown.cache;
  }

  private get isNavigable(): boolean {
    return this.data.pageId !== '' && (this.state === 'normal' || this.state === 'untitled');
  }

  private renderView(): void {
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

    return { icon: this.visibleCache()?.icon, title: this.titleText(state), path: this.path };
  }

  private buildLink(): HTMLAnchorElement {
    const state = this.state;
    const link = document.createElement('a');

    link.className = `${PAGE_LINK_CLASSES} ${this.isNavigable ? PAGE_LINK_ENABLED_CLASSES : PAGE_LINK_DISABLED_CLASSES}`;
    link.setAttribute(DATA_ATTR.blockContextMenu, '');
    link.setAttribute(DATA_ATTR.testid, 'page-link');
    link.setAttribute('data-blok-page-state', state);
    // Never focused, so Blok keeps its keys (undo, Escape, arrows). Tab is
    // Blok's indent; the keyboard opens the page from navigation mode.
    link.tabIndex = -1;
    // Blocks move by Blok's drag handle, not by a native link drag.
    link.draggable = false;

    if (this.isNavigable) {
      const href = this.config.href === undefined ? null : safeHref(this.config.href(this.data.pageId));

      if (href !== null) {
        link.setAttribute('href', href);
      }
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

    slot.replaceChildren(pageIconNode(this.isNavigable ? this.visibleCache()?.icon : undefined));

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
      case 'missing':
        return this.api.i18n.t('tools.page.missing');
      case 'no-access':
        return this.api.i18n.t('tools.page.noAccess');
      case 'untitled':
        return this.api.i18n.t('tools.page.untitled');
      case 'normal':
        return this.visibleCache()?.title ?? '';
    }
  }

  /** A browser focuses a link on mousedown; tabIndex -1 alone does not stop that. */
  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) {
      event.preventDefault();
    }
  };

  private readonly handleClick = (event: MouseEvent): void => {
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
