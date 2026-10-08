import { describeBookmark } from '../../../shared/tool-descriptions/bookmark';
import { bookmarkSanitize } from '../../../shared/tool-descriptions/sanitize/blocks';
import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteConfig,
  PasteEvent,
  PatternPasteEvent,
  ToolboxConfig,
  SanitizerConfig,
} from '../../../../types';
import { IconCopy, IconLink, IconLinkExternal } from '../../../components/icons';
import { DATA_ATTR } from '../../../components/constants/data-attributes';
import type { MenuConfig } from '../../../../types/tools/menu-config';
import { deliverToRebuiltBlock } from '../../image/detached-upload';
import { isHttpUrl, setSafeLinkHref } from '../registry';
import {
  MetadataFetcher,
  type BookmarkConfig,
  type BookmarkMeta,
} from '../metadata-fetcher';
import { renderBookmarkPreview } from './preview';

export interface BookmarkData extends BookmarkMeta, BlockToolData {}

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED';

/** Generic http(s) URL — bookmark is the fallback claim for any non-embed link. */
const URL_PATTERN = /https?:\/\/\S+/;

/**
 * Bookmark tool.
 *
 * Static OpenGraph card for a pasted link, like Notion's "Create bookmark".
 * Metadata is fetched from a consumer-supplied endpoint (CORS makes a backend
 * mandatory); Blok ships only the contract. There is no error state: a preview
 * that cannot be read renders the link itself.
 */
export class Bookmark implements BlockTool {
  public static describe = describeBookmark;

  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly fetcher: MetadataFetcher;
  private data: BookmarkData;
  private state: ToolState;
  private root: HTMLElement | null = null;
  /** Set by `removed()`: this instance is no longer the document's block. */
  private detached = false;
  /** A replayed block (redo, undo of a delete) whose preview never landed. */
  private readonly refetchOnRender: boolean;

  constructor(options: BlockToolConstructorOptions<BookmarkData, BookmarkConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.fetcher = new MetadataFetcher(options.config ?? { endpoint: '' });
    this.data = { ...options.data, url: options.data?.url ?? '' };
    this.state = this.data.url ? 'RENDERED' : 'EMPTY';
    // Only this client's undo/redo: the preview of a redone paste was dropped
    // with the undone block. A load must not refetch a link that has no
    // preview, and a peer's change must not make every client fetch.
    this.refetchOnRender = options.origin === 'replay' && options.replaySource !== 'remote' && !options.readOnly
      && this.data.url !== '' && Object.keys(this.data).length === 1;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconLink,
      titleKey: 'bookmark',
      searchTerms: ['bookmark', 'link', 'url', 'preview', 'card'],
      section: 'media',
      preview: { render: renderBookmarkPreview, descriptionKey: 'toolbox.preview.bookmark' },
    };
  }

  /**
   * Plain text and bare URLs: an HTML parse would cut text at `<` and turn `&` into `&amp;`.
   */
  public static get sanitize(): SanitizerConfig {
    return bookmarkSanitize();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get frameRadius(): string {
    return 'var(--blok-radius-block)';
  }

  public static get pasteConfig(): PasteConfig {
    // URL_PATTERN is a catch-all: it matches ANY http(s) link. Give it a low
    // priority so specific patterns (embed's per-service regexes) always resolve
    // first — correctness no longer depends on bookmark being registered last.
    return {
      patterns: { bookmark: URL_PATTERN },
      patternPriority: { bookmark: -100 },
    };
  }

  public onPaste(event: PasteEvent): void {
    if (event.type !== 'pattern') {
      return;
    }

    const url = (event as PatternPasteEvent).detail.data;

    if (!isHttpUrl(url)) {
      return;
    }

    this.startFetch(url);
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'my-1';
    root.setAttribute('data-blok-tool', 'bookmark');
    // The card is never edited in place; what it shows reaches the document
    // through dispatchChange, so its re-renders must not count as edits.
    root.setAttribute('data-blok-mutation-free', 'true');
    this.root = root;
    this.renderState();

    if (this.refetchOnRender) {
      this.startFetch(this.data.url);
    }

    return root;
  }

  public renderSettings(): MenuConfig {
    const { url } = this.data;

    if (!isHttpUrl(url)) {
      return [];
    }

    return [
      {
        icon: IconLinkExternal,
        title: this.api.i18n.t('tools.embed.openOriginal'),
        name: 'bookmark-open-original',
        closeOnActivate: true,
        onActivate: (): void => {
          window.open(url, '_blank', 'noopener,noreferrer');
        },
      },
      {
        icon: IconCopy,
        title: this.api.i18n.t('tools.link.copyUrl'),
        name: 'bookmark-copy-url',
        closeOnActivate: true,
        onActivate: (): void => {
          void navigator.clipboard?.writeText(url);
        },
      },
    ];
  }

  public save(): BookmarkData {
    const out: BookmarkData = { url: this.data.url };

    if (this.data.title !== undefined) out.title = this.data.title;
    if (this.data.description !== undefined) out.description = this.data.description;
    if (this.data.image !== undefined) out.image = this.data.image;
    if (this.data.favicon !== undefined) out.favicon = this.data.favicon;
    if (this.data.domain !== undefined) out.domain = this.data.domain;

    return out;
  }

  public validate(data: BookmarkData): boolean {
    return typeof data.url === 'string' && data.url.length > 0;
  }

  /**
   * The bookmark card is a static, non-editable anchor in both modes, so the
   * in-place read-only toggle needs no DOM changes. The method must still
   * exist: the editor only takes the in-place toggle path (instead of a full
   * save/clear/render) when EVERY registered tool implements setReadOnly.
   */
  public setReadOnly(_state: boolean): void {}

  public removed(): void {
    this.detached = true;
  }

  private startFetch(url: string): void {
    this.data = { url };
    this.state = 'LOADING';
    this.renderState();
    void this.fetcher
      .fetch(url)
      .then((meta) => {
        // A rebuilt block's tool is a new instance, so the fetched preview has
        // to be written through the blocks API instead.
        if (this.detached) {
          deliverToRebuiltBlock(this.api, this.block, 'Bookmark', { ...meta }, undefined, ['url']);

          return;
        }
        this.data = { ...meta };
        this.state = 'RENDERED';
        this.renderState();
        // The preview is not the user's edit: it joins the step that wrote the link.
        this.block.dispatchChange({ derived: true, from: ['url'] });
      })
      .catch(() => {
        // Roughly a third of sites serve no preview data, so a failed fetch is
        // ordinary, not a fault: the block keeps the `{ url }` set above and
        // renders it as a plain link. It MUST be the same RENDERED path a
        // reload takes — save() never persisted a failure, so a reloaded block
        // carrying this exact data renders the card either way.
        this.state = 'RENDERED';
        this.renderState();
      });
  }

  private renderState(): void {
    if (!this.root) {
      return;
    }

    this.root.replaceChildren(this.buildStateElement());
  }

  private buildStateElement(): HTMLElement {
    switch (this.state) {
      case 'LOADING':
        return this.buildLoading();
      case 'RENDERED':
        return this.buildCard();
      case 'EMPTY':
        return this.buildEmpty();
    }
  }

  private buildEmpty(): HTMLElement {
    return this.buildPlaceholder('bookmark-empty', 'tools.bookmark.empty');
  }

  private buildLoading(): HTMLElement {
    return this.buildPlaceholder('bookmark-loading', 'tools.bookmark.loading');
  }

  private buildPlaceholder(testId: string, i18nKey: string): HTMLElement {
    const el = document.createElement('div');

    el.classList.add('blok-bookmark__placeholder');
    el.setAttribute('data-blok-testid', testId);
    el.textContent = this.api.i18n.t(i18nKey);

    return el;
  }

  private buildCard(): HTMLElement {
    const card = document.createElement('a');

    card.classList.add('blok-bookmark');
    card.setAttribute('data-blok-testid', 'bookmark-card');
    card.setAttribute(DATA_ATTR.blockContextMenu, '');
    card.setAttribute(DATA_ATTR.linkOwner, '');

    // Only navigate http(s) URLs. Saved JSON or a compromised unfurl endpoint
    // could carry a javascript:/data: URL; leaving href unset prevents XSS.
    setSafeLinkHref(card, this.data.url);
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    const content = document.createElement('div');

    content.classList.add('blok-bookmark__content');
    content.setAttribute('data-role', 'bookmark-content');

    const title = document.createElement('div');

    title.classList.add('blok-bookmark__title');
    title.setAttribute('data-role', 'bookmark-title');
    // Each line follows its own script: core reads only editable text, so it
    // never sets a direction for this block.
    title.setAttribute('dir', 'auto');
    title.textContent = this.data.title ?? this.fallbackTitle();
    content.appendChild(title);

    if (this.data.description) {
      const description = document.createElement('div');

      description.classList.add('blok-bookmark__description');
      description.setAttribute('data-role', 'bookmark-description');
      description.setAttribute('dir', 'auto');
      description.textContent = this.data.description;
      content.appendChild(description);
    }

    const linkRow = document.createElement('div');

    linkRow.classList.add('blok-bookmark__link-row');
    linkRow.setAttribute('data-role', 'bookmark-link-row');

    const addressPill = document.createElement('span');

    addressPill.classList.add('blok-bookmark__address');
    addressPill.setAttribute('data-role', 'bookmark-address');

    if (this.data.favicon) {
      const favicon = document.createElement('img');

      favicon.classList.add('blok-bookmark__favicon');
      favicon.setAttribute('data-role', 'bookmark-favicon');
      favicon.src = this.data.favicon;
      favicon.alt = '';
      addressPill.appendChild(favicon);
    }

    const urlText = document.createElement('span');

    urlText.classList.add('blok-bookmark__url');
    urlText.setAttribute('data-role', 'bookmark-url');
    urlText.append(...this.addressParts());
    addressPill.appendChild(urlText);
    linkRow.appendChild(addressPill);
    content.appendChild(linkRow);

    card.appendChild(content);

    if (this.data.image) {
      const imageContainer = document.createElement('div');

      imageContainer.classList.add('blok-bookmark__image');
      imageContainer.setAttribute('data-role', 'bookmark-image');

      const frame = document.createElement('div');

      frame.classList.add('blok-bookmark__window');
      frame.setAttribute('data-role', 'bookmark-window');

      const bar = document.createElement('div');

      bar.classList.add('blok-bookmark__window-bar');
      bar.setAttribute('data-role', 'bookmark-window-bar');
      bar.setAttribute('aria-hidden', 'true');

      const address = this.splitAddress();
      const barAddress = document.createElement('span');

      barAddress.textContent = address === null ? this.data.url : address.host + address.path;
      bar.appendChild(barAddress);

      const image = document.createElement('img');

      image.src = this.data.image;
      image.alt = '';
      frame.append(bar, image);
      imageContainer.appendChild(frame);
      card.appendChild(imageContainer);
    }

    return card;
  }

  /** Host in ink, path in gray; an unparseable url is shown as saved. */
  private addressParts(): Array<string | HTMLElement> {
    const address = this.splitAddress();

    if (address === null) {
      return [ this.data.url ];
    }

    const host = document.createElement('span');

    host.classList.add('blok-bookmark__host');
    host.setAttribute('data-role', 'bookmark-host');
    host.textContent = address.host;

    if (address.path === '') {
      return [ host ];
    }

    const path = document.createElement('span');

    path.classList.add('blok-bookmark__path');
    path.setAttribute('data-role', 'bookmark-path');
    path.textContent = address.path;

    return [ host, path ];
  }

  /** The scheme is dropped; a bare site root has no path. */
  private splitAddress(): { host: string; path: string } | null {
    try {
      const { host, pathname, search, hash } = new URL(this.data.url);
      const path = pathname + search + hash;

      return host === '' ? null : { host, path: path === '/' ? '' : path };
    } catch {
      return null;
    }
  }

  /** Notion reduces a URL-ish title to the hostname; raw url if unparseable. */
  private fallbackTitle(): string {
    try {
      const { hostname } = new URL(this.data.url);

      return hostname || this.data.url;
    } catch {
      return this.data.url;
    }
  }
}
