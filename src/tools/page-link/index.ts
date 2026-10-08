import { describePageLink } from '../../shared/tool-descriptions/page-link';
import { pageLinkSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  SanitizerConfig,
} from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconLock } from '../../components/icons';
import { safeHref } from '../../components/utils/sanitize-url';
import {
  PAGE_ICON_CLASSES,
  PAGE_LINK_CLASSES,
  PAGE_LINK_DISABLED_CLASSES,
  PAGE_LINK_ENABLED_CLASSES,
  PAGE_TITLE_CLASSES,
  PAGE_TITLE_MUTED_CLASSES,
  PAGE_WRAPPER_CLASSES,
} from '../page/constants';
import { pageIconNode } from '../page/hover-preview';
import type { PageConfig, PageInfo } from '../page/types';

export interface PageLinkData extends BlockToolData {
  pageId: string;
}

type PageLinkState = 'unresolved' | 'normal' | 'untitled' | 'missing' | 'no-access';

/** A non-owning reference to a host page. */
export class PageLink implements BlockTool {
  public static describe = describePageLink;

  private readonly api: API;
  private readonly config: PageConfig;
  private data: PageLinkData;
  private readonly isProbe: boolean;
  private root: HTMLElement | null = null;
  private info: PageInfo | null | undefined;
  private requestVersion = 0;
  private started = false;
  private detached = false;
  private unsubscribe: (() => void) | undefined;

  constructor(options: BlockToolConstructorOptions<PageLinkData, PageConfig>) {
    this.api = options.api;
    this.config = options.config ?? {};
    this.data = { pageId: typeof options.data?.pageId === 'string' ? options.data.pageId : '' };
    this.isProbe = options.origin === 'probe';
  }

  public static get sanitize(): SanitizerConfig {
    return pageLinkSanitize();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get acceptsChildren(): boolean {
    return false;
  }

  public render(): HTMLElement {
    const root = document.createElement('div');

    root.className = PAGE_WRAPPER_CLASSES;
    root.setAttribute(DATA_ATTR.tool, 'page-link');
    root.setAttribute(DATA_ATTR.mutationFree, 'true');
    root.setAttribute(DATA_ATTR.linkOwner, '');
    this.root = root;
    this.renderView();

    return root;
  }

  public rendered(): void {
    if (this.started || this.isProbe) {
      return;
    }
    this.started = true;
    this.listen();
    void this.refresh();
  }

  public save(): PageLinkData {
    return { pageId: this.data.pageId };
  }

  public validate(data: PageLinkData): boolean {
    return typeof data.pageId === 'string' && data.pageId !== '';
  }

  public setData(data: PageLinkData): boolean {
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
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  public destroy(): void {
    this.removed();
  }

  public onNavigationEnter(event: KeyboardEvent): boolean {
    if (!this.isNavigable) {
      return false;
    }

    if (this.config.open !== undefined) {
      this.config.open(this.data.pageId, { event });

      return true;
    }

    const anchor = this.root?.querySelector('a[href]');

    if (!(anchor instanceof HTMLAnchorElement)) {
      return false;
    }
    if (event.metaKey || event.ctrlKey) {
      window.open(anchor.href, '_blank', 'noopener');

      return true;
    }
    anchor.click();

    return true;
  }

  private listen(): void {
    this.unsubscribe?.();
    const { pageId } = this.data;
    const stop = pageId === '' ? undefined : this.config.subscribe?.(pageId, () => {
      if (!this.detached && pageId === this.data.pageId) {
        void this.refresh();
      }
    });

    this.unsubscribe = typeof stop === 'function' ? stop : undefined;
  }

  private async refresh(): Promise<void> {
    const pageId = this.data.pageId;
    const version = ++this.requestVersion;

    this.info = undefined;
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

    this.info = info;
    this.renderView();
  }

  private get state(): PageLinkState {
    if (this.info === undefined) {
      return 'unresolved';
    }
    if (this.info === null) {
      return 'missing';
    }
    if (this.info.access === 'none') {
      return 'no-access';
    }

    return typeof this.info.title === 'string' && this.info.title.trim() !== '' ? 'normal' : 'untitled';
  }

  private get isNavigable(): boolean {
    return this.data.pageId !== '' && (this.state === 'normal' || this.state === 'untitled');
  }

  private renderView(): void {
    this.root?.replaceChildren(this.buildLink());
  }

  private buildLink(): HTMLAnchorElement {
    const state = this.state;
    const link = document.createElement('a');

    link.className = `${PAGE_LINK_CLASSES} ${this.isNavigable ? PAGE_LINK_ENABLED_CLASSES : PAGE_LINK_DISABLED_CLASSES}`;
    link.setAttribute(DATA_ATTR.testid, 'page-link');
    link.setAttribute(DATA_ATTR.blockContextMenu, '');
    link.setAttribute('data-blok-page-state', state);
    link.tabIndex = -1;
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
        link.href = href;
      }
    } else {
      link.setAttribute('aria-disabled', 'true');
    }

    const icon = document.createElement('span');

    icon.className = PAGE_ICON_CLASSES;
    icon.setAttribute('aria-hidden', 'true');
    if (state === 'no-access') {
      icon.innerHTML = IconLock;
    } else {
      icon.append(pageIconNode(this.isNavigable ? this.info?.icon : undefined));
    }

    const title = document.createElement('span');

    title.className = state === 'normal' ? PAGE_TITLE_CLASSES : `${PAGE_TITLE_CLASSES} ${PAGE_TITLE_MUTED_CLASSES}`;
    title.textContent = this.titleText(state);
    link.append(icon, title);
    link.addEventListener('mousedown', this.handleMouseDown);
    link.addEventListener('click', this.handleClick);

    return link;
  }

  private titleText(state: PageLinkState): string {
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
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (this.config.open !== undefined) {
      event.preventDefault();
      this.config.open(this.data.pageId, { event });
    }
  };
}
