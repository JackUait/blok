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
} from '../../../../types';
import { IconGlobe } from '../../../components/icons';
import { attachResizeHandle, type ResizeEdge } from '../../image/resizer';
import { renderEmbedOverlay, type EmbedAlignment } from './overlay';
import { EMBED_SERVICES, matchEmbedService, type EmbedKind } from '../registry';

export interface EmbedData extends BlockToolData {
  service: string;
  source: string;
  embed: string;
  kind?: EmbedKind;
  width?: number;
  height?: number;
  /** Rendered width as a percent of the editor container. Defaults to full (100). */
  widthPercent?: number;
  /** Horizontal placement within the content column. Defaults to center. */
  alignment?: EmbedAlignment;
  caption?: string;
  /** Whether the caption field is shown. */
  captionVisible?: boolean;
}

const TELEGRAM_WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';
const TWITTER_WIDGET_SRC = 'https://platform.twitter.com/widgets.js';

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;
const FULL_WIDTH_PERCENT = 100;
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';
const IFRAME_ALLOW = 'encrypted-media; fullscreen; picture-in-picture';

/**
 * Embed tool.
 *
 * Live interactive iframe for a pasted provider URL, like Notion's "Create embed".
 * Pure client-side: a URL is matched against the embed registry and resolved into
 * a provider-sanctioned iframe URL. Only registry-matched URLs are ever embedded.
 */
export class Embed implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly readOnly: boolean;
  private data: Partial<EmbedData>;
  private root: HTMLElement | null = null;
  private resizeDetach: (() => void)[] = [];

  constructor(options: BlockToolConstructorOptions<EmbedData>) {
    this.api = options.api;
    this.block = options.block;
    this.readOnly = options.readOnly;
    this.data = { ...options.data };
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconGlobe,
      titleKey: 'embed',
      searchTerms: ['embed', 'iframe', 'video', 'youtube', 'media'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    const patterns = Object.fromEntries(
      Object.entries(EMBED_SERVICES).map(([service, config]) => [service, config.regex])
    );

    return { patterns };
  }

  public onPaste(event: PasteEvent): void {
    if (event.type !== 'pattern') {
      return;
    }

    const url = (event as PatternPasteEvent).detail.data;
    const match = matchEmbedService(url);

    if (!match) {
      return;
    }

    const config = EMBED_SERVICES[match.service];

    this.data = {
      service: match.service,
      source: url,
      embed: match.embedUrl,
      kind: match.kind,
      width: config.width ?? DEFAULT_WIDTH,
      height: config.height ?? DEFAULT_HEIGHT,
    };
    this.renderState();
  }

  public render(): HTMLElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-tool', 'embed');
    this.root = root;
    this.renderState();

    return root;
  }

  public save(): EmbedData {
    return {
      service: this.data.service ?? '',
      source: this.data.source ?? '',
      embed: this.data.embed ?? '',
      kind: this.data.kind ?? 'iframe',
      width: this.data.width ?? DEFAULT_WIDTH,
      height: this.data.height ?? DEFAULT_HEIGHT,
      ...(this.data.widthPercent !== undefined ? { widthPercent: this.data.widthPercent } : {}),
      ...(this.data.alignment !== undefined ? { alignment: this.data.alignment } : {}),
      ...(this.data.caption !== undefined ? { caption: this.data.caption } : {}),
      ...(this.data.captionVisible !== undefined ? { captionVisible: this.data.captionVisible } : {}),
    };
  }

  public validate(data: EmbedData): boolean {
    return Boolean(data.source) && Boolean(data.embed);
  }

  /**
   * Anchors the block toolbar (+ / ⋮⋮) to the embed figure so it centers at
   * the embed's top edge rather than on the caption's contenteditable line.
   */
  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this.root?.querySelector<HTMLElement>('[data-role="embed-figure"]') ?? undefined;
  }

  /**
   * Shifts the block toolbar to the figure's left edge when the embed is
   * narrower than the content column (centered / right-aligned / fixed-width).
   */
  public getContentOffset(_hoveredElement: Element): { left: number } | undefined {
    const root = this.root;
    const figure = root?.querySelector<HTMLElement>('[data-role="embed-figure"]');

    if (!root || !figure) {
      return undefined;
    }

    const delta = figure.getBoundingClientRect().left - root.getBoundingClientRect().left;

    return delta > 0 ? { left: delta } : undefined;
  }

  private renderState(): void {
    if (!this.root) {
      return;
    }

    this.detachResizers();

    if (!this.data.embed) {
      this.root.replaceChildren(this.buildEmpty());

      return;
    }

    if (this.data.kind === 'script') {
      this.root.replaceChildren(this.buildScript());

      return;
    }

    const figure = this.buildIframeFigure();

    this.root.replaceChildren(figure);

    const caption = this.buildCaption();

    if (caption) {
      figure.appendChild(caption);
    }

    if (!this.readOnly) {
      this.attachResizeHandles(figure);
      figure.appendChild(this.buildOverlay());
    }
  }

  private detachResizers(): void {
    while (this.resizeDetach.length > 0) {
      this.resizeDetach.pop()?.();
    }
  }

  private buildScript(): HTMLElement {
    const container = document.createElement('div');

    container.setAttribute('data-blok-testid', 'embed-script');

    const remoteId = this.data.source ? matchEmbedService(this.data.source)?.remoteId ?? '' : '';

    if (this.data.service === 'telegram') {
      const script = document.createElement('script');

      script.async = true;
      script.src = TELEGRAM_WIDGET_SRC;
      script.setAttribute('data-telegram-post', remoteId);
      script.setAttribute('data-width', '100%');
      container.appendChild(script);

      return container;
    }

    // Twitter / X: blockquote scanned and replaced by widgets.js.
    const blockquote = document.createElement('blockquote');

    blockquote.className = 'twitter-tweet';

    const anchor = document.createElement('a');

    anchor.href = this.data.source ?? '';
    blockquote.appendChild(anchor);
    container.appendChild(blockquote);

    const script = document.createElement('script');

    script.async = true;
    script.src = TWITTER_WIDGET_SRC;
    container.appendChild(script);

    return container;
  }

  private buildEmpty(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-testid', 'embed-empty');
    el.textContent = this.api.i18n.t('tools.embed.empty');

    return el;
  }

  /**
   * Wraps the iframe in a percent-width figure (full container width by default)
   * around an aspect-ratio box, so the embed scales fluidly when resized while
   * keeping the provider's native proportions.
   */
  private buildIframeFigure(): HTMLElement {
    const figure = document.createElement('figure');

    const w = this.data.width && this.data.width > 0 ? this.data.width : DEFAULT_WIDTH;
    const h = this.data.height && this.data.height > 0 ? this.data.height : DEFAULT_HEIGHT;
    const fixedWidth = this.data.service !== undefined
      && EMBED_SERVICES[this.data.service]?.fixedWidth === true;

    figure.setAttribute('data-role', 'embed-figure');
    figure.style.position = 'relative';
    // Fixed-content providers (e.g. TikTok) don't scale with the iframe, so the
    // figure is capped at the natural width to keep handles on the visible card.
    // The percent-based width never exceeds the container, so a px cap is safe.
    figure.style.maxWidth = fixedWidth ? `${w}px` : '100%';
    figure.style.width = `${this.data.widthPercent ?? FULL_WIDTH_PERCENT}%`;

    const alignment = this.data.alignment ?? 'center';

    figure.style.marginLeft = alignment === 'left' ? '0' : 'auto';
    figure.style.marginRight = alignment === 'right' ? '0' : 'auto';

    const aspect = document.createElement('div');

    aspect.setAttribute('data-role', 'embed-aspect');
    aspect.style.position = 'relative';
    aspect.style.width = '100%';
    aspect.style.aspectRatio = `${w} / ${h}`;

    aspect.appendChild(this.buildIframe());
    figure.appendChild(aspect);

    return figure;
  }

  private buildIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');

    iframe.setAttribute('data-blok-testid', 'embed-frame');
    iframe.src = this.data.embed ?? '';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.setAttribute('sandbox', IFRAME_SANDBOX);
    iframe.setAttribute('allow', IFRAME_ALLOW);
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('frameborder', '0');

    return iframe;
  }

  private attachResizeHandles(figure: HTMLElement): void {
    const edges: ResizeEdge[] = ['left', 'right'];

    for (const edge of edges) {
      const handle = document.createElement('div');

      handle.setAttribute('data-role', 'resize-handle');
      handle.setAttribute('data-edge', edge);
      figure.appendChild(handle);

      const detach = attachResizeHandle({
        handle,
        figure,
        container: figure.parentElement ?? figure,
        edge,
        alignment: this.data.alignment ?? 'center',
        onPreview: (percent) => {
          figure.style.setProperty('width', `${percent}%`);
        },
        onCommit: (percent) => {
          this.data.widthPercent = percent;
          this.block.dispatchChange();
        },
      });

      this.resizeDetach.push(detach);
    }
  }

  private buildCaption(): HTMLElement | null {
    const visible = this.data.captionVisible === true;
    const value = this.data.caption ?? '';

    if (!visible && value === '') {
      return null;
    }

    const caption = document.createElement('div');

    caption.setAttribute('data-role', 'embed-caption');
    caption.setAttribute('role', 'textbox');
    caption.setAttribute('contenteditable', this.readOnly ? 'false' : 'true');
    caption.setAttribute('data-placeholder', this.api.i18n.t('tools.embed.captionPlaceholder'));
    caption.textContent = value;

    if (!this.readOnly) {
      caption.addEventListener('blur', () => {
        const next = caption.textContent ?? '';

        if (next !== this.data.caption) {
          this.data.caption = next;
          this.block.dispatchChange();
        }
      });
    }

    return caption;
  }

  private buildOverlay(): HTMLElement {
    return renderEmbedOverlay({
      alignment: this.data.alignment ?? 'center',
      captionVisible: this.data.captionVisible === true,
      source: this.data.source ?? '',
      i18n: this.api.i18n,
      onAlign: (next) => this.setAlignment(next),
      onToggleCaption: () => this.toggleCaption(),
      onCopyLink: () => this.copyLink(),
      onDelete: () => this.deleteBlock(),
    });
  }

  private setAlignment(next: EmbedAlignment): void {
    this.data.alignment = next;
    this.renderState();
    this.block.dispatchChange();
  }

  private toggleCaption(): void {
    this.data.captionVisible = this.data.captionVisible !== true;
    this.renderState();
    this.block.dispatchChange();
  }

  private copyLink(): void {
    const clip = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;

    void clip?.writeText(this.data.source ?? '');
  }

  private deleteBlock(): void {
    const blocks = (this.api as unknown as { blocks?: { delete?: (id: string) => void } }).blocks;

    blocks?.delete?.(this.block.id);
  }
}
