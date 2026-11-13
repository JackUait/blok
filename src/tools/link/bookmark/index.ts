import { describeBookmark } from '../../../shared/tool-descriptions/bookmark';
import { linkClipboardHtml } from '../../../shared/clipboard-html';
import { LINK_ACTION_HANDLERS } from '../../../shared/tool-actions/link';
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
import { overrideStatic } from '../../../components/utils/override-static';
import type { LazySheet } from '../../../components/utils/lazy-styles';
import { renderMediaEmptyState, type MediaEmptyStateElement } from '../../../components/utils/media-empty-state';

export interface BookmarkData extends BookmarkMeta, BlockToolData {}

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED';

/** Generic http(s) URL — bookmark is the fallback claim for any non-embed link. */
const URL_PATTERN = /https?:\/\/\S+/;

/** A domain with no scheme, as typed into a browser's address bar. */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+([/?#].*)?$/;

/** The http(s) link in typed or dropped text, or null. A bare domain gets https. */
const linkFrom = (text: string): string | null => {
  const value = text.trim();
  const url = BARE_DOMAIN.test(value) ? `https://${value}` : value;

  return isHttpUrl(url) ? url : null;
};

/** Glides the block from its old height to its new one, so the lines below it never jump. */
const glideHeight = (element: HTMLElement, from: number): void => {
  const to = element.getBoundingClientRect().height;
  const still = from === 0 || to === 0 || Math.abs(from - to) < 1;
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (still || reduced || typeof element.animate !== 'function') {
    return;
  }

  element.animate([ { height: `${from}px` }, { height: `${to}px` } ], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
};

/**
 * Bookmark tool.
 *
 * Static OpenGraph card for a pasted link, like Notion's "Create bookmark".
 * Metadata is fetched from a consumer-supplied endpoint (CORS makes a backend
 * mandatory); Blok ships only the contract. There is no error state: a preview
 * that cannot be read renders the link itself.
 */
export class Bookmark implements BlockTool {
  public static get 'blok.runtimePartsOwner'(): string {
    return 'bookmark';
  }

  /** Core loads these before the first render. Subclasses inherit it. */
  public static get 'blok.toolSheets'(): LazySheet[] {
    return ['media'];
  }

  public static get describe(): typeof describeBookmark {
    return describeBookmark;
  }

  public static set describe(value: typeof describeBookmark) {
    overrideStatic(this, 'describe', value);
  }

  public static get actionHandlers(): typeof LINK_ACTION_HANDLERS.bookmark {
    return LINK_ACTION_HANDLERS.bookmark;
  }

  public static set actionHandlers(value: typeof LINK_ACTION_HANDLERS.bookmark) {
    overrideStatic(this, 'actionHandlers', value);
  }

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
  private readOnly: boolean;
  /** The empty field takes the caret once, and only for a block the user just made. */
  private focusField: boolean;
  /** The next card follows the loading card, so it fades in. */
  private arriving = false;

  constructor(options: BlockToolConstructorOptions<BookmarkData, BookmarkConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.fetcher = new MetadataFetcher(options.config ?? { endpoint: '' });
    this.data = { ...options.data, url: options.data?.url ?? '' };
    this.state = this.data.url ? 'RENDERED' : 'EMPTY';
    this.readOnly = options.readOnly;
    this.focusField = options.origin === 'user' || options.origin === 'convert';
    // Only this client's undo/redo: the preview of a redone paste was dropped
    // with the undone block. A load must not refetch a link that has no
    // preview, and a peer's change must not make every client fetch.
    this.refetchOnRender = options.origin === 'replay' && options.replaySource !== 'remote' && !options.readOnly
      && this.data.url !== '' && Object.keys(this.data).length === 1;
  }

  /** One link. The cover and favicon are left out, or a paste makes them images. */
  public static clipboardHtml(data: BookmarkData): string | null {
    return linkClipboardHtml(data.url, [data.title]);
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

  /** Only the empty state differs: the link field is for editing. */
  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (this.state === 'EMPTY') {
      this.renderState();
    }
  }

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
        this.arriving = true;
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
        this.arriving = true;
        this.renderState();
      });
  }

  private renderState(): void {
    if (!this.root) {
      return;
    }

    const before = this.root.getBoundingClientRect().height;

    this.root.replaceChildren(this.buildStateElement());
    glideHeight(this.root, before);
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

  /** The shared link field of the media blocks: one sentence, one field. Read-only shows the sentence alone. */
  private buildEmpty(): HTMLElement {
    if (this.readOnly) {
      return this.buildPlaceholder('bookmark-empty', 'tools.bookmark.empty');
    }

    const t = (key: string): string => this.api.i18n.t(key);
    const add = (text: string): boolean => {
      const url = linkFrom(text);

      if (url === null) {
        return false;
      }

      this.startFetch(url);
      // Typing the link is the user's edit. The preview joins it later as a derived change.
      this.block.dispatchChange();

      return true;
    };
    const empty: MediaEmptyStateElement = renderMediaEmptyState({
      acceptTypes: [],
      sources: 'url',
      hideTitle: true,
      autoFocus: this.focusField,
      onFile: () => undefined,
      onUrl: (text) => {
        if (!add(text)) {
          empty.setError(t('tools.link.invalidLink'));
        }
      },
      labels: {
        add: t('toolNames.bookmark'),
        hint: t('tools.bookmark.empty'),
        urlPlaceholder: 'https://',
        urlAria: t('tools.link.webLink'),
        submit: t('tools.image.emptyInsert'),
        invalidLink: t('tools.link.invalidLink'),
        // A link-only surface never shows these.
        dropAnywhere: '',
        cancelLink: '',
        embed: '',
        chooseFile: '',
        dropToUpload: '',
      },
    });

    this.focusField = false;
    empty.setAttribute('data-blok-testid', 'bookmark-empty');
    // A link dragged from a browser tab or another page.
    empty.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('text/uri-list')) {
        event.preventDefault();
      }
    });
    empty.addEventListener('drop', (event) => {
      const dropped = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || '';

      if (add(dropped.split('\n')[0])) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    return empty;
  }

  /** The card's own shape with nothing in it yet but the address, so the card lands without a jump. */
  private buildLoading(): HTMLElement {
    const card = document.createElement('div');

    card.classList.add('blok-bookmark', 'blok-bookmark--loading');
    card.setAttribute('data-blok-testid', 'bookmark-loading');
    card.setAttribute('role', 'status');
    card.setAttribute('aria-label', this.api.i18n.t('tools.bookmark.loading'));

    const content = document.createElement('div');

    content.classList.add('blok-bookmark__content');
    content.append(...['title', 'line', 'line'].map((part) => {
      const bone = document.createElement('span');

      bone.classList.add('blok-bookmark__bone');
      bone.setAttribute('data-part', part);
      bone.setAttribute('aria-hidden', 'true');

      return bone;
    }), this.buildLinkRow());
    card.appendChild(content);

    return card;
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
    card.classList.toggle('blok-bookmark--arriving', this.arriving);
    this.arriving = false;
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

    content.appendChild(this.buildLinkRow());

    const layers = this.colourLayers(this.data.image || this.data.favicon);

    if (this.data.image) {
      const imageContainer = document.createElement('div');

      imageContainer.classList.add('blok-bookmark__image');
      imageContainer.setAttribute('data-role', 'bookmark-image');

      const image = this.decorativeImage(this.data.image);

      image.addEventListener('error', () => {
        imageContainer.remove();
        layers.forEach((layer) => layer.remove());
        card.classList.add('blok-bookmark--bare');
        card.prepend(...this.colourLayers(this.data.favicon));
      }, { once: true });
      imageContainer.appendChild(image);
      card.append(...layers, imageContainer, content);
    } else {
      card.classList.add('blok-bookmark--bare');
      card.append(...layers, content);
    }

    return card;
  }

  /** The address pill: the favicon when there is one, then host and path. */
  private buildLinkRow(): HTMLElement {
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
      favicon.setAttribute('loading', 'lazy');
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

    return linkRow;
  }

  /**
   * The glow under the card and the blurred backdrop inside it, both drawn
   * from one picture: the cover, or the favicon when there is no cover.
   * CSS filters do the colouring, so a cross-origin picture needs no CORS.
   */
  private colourLayers(src: string | undefined): HTMLElement[] {
    if (!src) {
      return [];
    }

    const layers = ['glow', 'wash'].map((name) => {
      const layer = document.createElement('span');

      layer.classList.add(`blok-bookmark__${name}`);
      layer.setAttribute('data-role', `bookmark-${name}`);
      layer.setAttribute('aria-hidden', 'true');

      const image = this.decorativeImage(src);

      image.addEventListener('error', () => layers.forEach((each) => each.remove()), { once: true });
      layer.appendChild(image);

      return layer;
    });

    return layers;
  }

  private decorativeImage(src: string): HTMLImageElement {
    const image = document.createElement('img');

    image.setAttribute('loading', 'lazy');
    image.src = src;
    image.alt = '';

    return image;
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
