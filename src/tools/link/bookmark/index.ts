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
    const el = document.createElement('div');

    el.setAttribute('data-blok-testid', 'bookmark-empty');
    el.textContent = this.api.i18n.t('tools.bookmark.empty');

    return el;
  }

  private buildLoading(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-testid', 'bookmark-loading');
    el.textContent = this.api.i18n.t('tools.bookmark.loading');

    return el;
  }

  private buildError(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-testid', 'bookmark-error');
    el.textContent = this.api.i18n.t('tools.bookmark.error');

    return el;
  }

  private buildCard(): HTMLElement {
    const card = document.createElement('a');

    card.setAttribute('data-blok-testid', 'bookmark-card');
    card.href = this.data.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    const title = document.createElement('div');

    title.textContent = this.data.title ?? this.data.url;
    card.appendChild(title);

    if (this.data.description) {
      const description = document.createElement('div');

      description.textContent = this.data.description;
      card.appendChild(description);
    }

    if (this.data.favicon) {
      const favicon = document.createElement('img');

      favicon.src = this.data.favicon;
      favicon.alt = '';
      card.appendChild(favicon);
    }

    if (this.data.image) {
      const image = document.createElement('img');

      image.src = this.data.image;
      image.alt = '';
      card.appendChild(image);
    }

    return card;
  }
}
