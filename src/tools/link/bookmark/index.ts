import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteConfig,
  PasteEvent,
  PatternPasteEvent,
  ToolboxConfig,
} from '../../../../types';
import { IconLink } from '../../../components/icons';
import { isHttpUrl } from '../registry';
import {
  MetadataFetcher,
  type BookmarkConfig,
  type BookmarkMeta,
} from '../metadata-fetcher';

export interface BookmarkData extends BookmarkMeta, BlockToolData {}

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

/** Generic http(s) URL — bookmark is the fallback claim for any non-embed link. */
const URL_PATTERN = /https?:\/\/\S+/;

/**
 * Bookmark tool.
 *
 * Static OpenGraph card for a pasted link, like Notion's "Create bookmark".
 * Metadata is fetched from a consumer-supplied endpoint (CORS makes a backend
 * mandatory); Blok ships only the contract. Mirrors the Image tool's state machine.
 */
export class Bookmark implements BlockTool {
  private readonly api: API;
  private readonly fetcher: MetadataFetcher;
  private data: BookmarkData;
  private state: ToolState;
  private root: HTMLElement | null = null;

  constructor(options: BlockToolConstructorOptions<BookmarkData, BookmarkConfig>) {
    this.api = options.api;
    this.fetcher = new MetadataFetcher(options.config ?? { endpoint: '' });
    this.data = { ...options.data, url: options.data?.url ?? '' };
    this.state = this.data.url ? 'RENDERED' : 'EMPTY';
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconLink,
      titleKey: 'bookmark',
      searchTerms: ['bookmark', 'link', 'url', 'preview', 'card'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return { patterns: { bookmark: URL_PATTERN } };
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
    this.root = root;
    this.renderState();

    return root;
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

  private startFetch(url: string): void {
    this.data = { url };
    this.state = 'LOADING';
    this.renderState();
    void this.fetcher
      .fetch(url)
      .then((meta) => {
        this.data = { ...meta };
        this.state = 'RENDERED';
        this.renderState();
      })
      .catch(() => {
        this.state = 'ERROR';
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
      case 'ERROR':
        return this.buildError();
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

  private buildError(): HTMLElement {
    return this.buildPlaceholder('bookmark-error', 'tools.bookmark.error');
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

    // Only navigate http(s) URLs. Saved JSON or a compromised unfurl endpoint
    // could carry a javascript:/data: URL; leaving href unset prevents XSS.
    if (isHttpUrl(this.data.url)) {
      card.href = this.data.url;
    }
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    const content = document.createElement('div');

    content.classList.add('blok-bookmark__content');
    content.setAttribute('data-role', 'bookmark-content');

    const title = document.createElement('div');

    title.classList.add('blok-bookmark__title');
    title.setAttribute('data-role', 'bookmark-title');
    title.textContent = this.data.title ?? this.fallbackTitle();
    content.appendChild(title);

    if (this.data.description) {
      const description = document.createElement('div');

      description.classList.add('blok-bookmark__description');
      description.setAttribute('data-role', 'bookmark-description');
      description.textContent = this.data.description;
      content.appendChild(description);
    }

    const linkRow = document.createElement('div');

    linkRow.classList.add('blok-bookmark__link-row');
    linkRow.setAttribute('data-role', 'bookmark-link-row');

    if (this.data.favicon) {
      const favicon = document.createElement('img');

      favicon.classList.add('blok-bookmark__favicon');
      favicon.setAttribute('data-role', 'bookmark-favicon');
      favicon.src = this.data.favicon;
      favicon.alt = '';
      linkRow.appendChild(favicon);
    }

    const urlText = document.createElement('span');

    urlText.classList.add('blok-bookmark__url');
    urlText.setAttribute('data-role', 'bookmark-url');
    urlText.textContent = this.data.url;
    linkRow.appendChild(urlText);
    content.appendChild(linkRow);

    card.appendChild(content);

    if (this.data.image) {
      const imageContainer = document.createElement('div');

      imageContainer.classList.add('blok-bookmark__image');
      imageContainer.setAttribute('data-role', 'bookmark-image');

      const image = document.createElement('img');

      image.src = this.data.image;
      image.alt = '';
      imageContainer.appendChild(image);
      card.appendChild(imageContainer);
    }

    return card;
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
