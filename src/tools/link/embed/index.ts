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
import type { MenuConfig } from '../../../../types/tools/menu-config';
import { IconCopy, IconGlobe, IconLinkCopy, IconReplace } from '../../../components/icons';
import { setFieldValidity } from '../../../components/utils/field-validity';
import { attachResizeHandle, type ResizeEdge } from '../../image/resizer';
import { renderEmbedOverlay, type EmbedAlignment } from './overlay';
import { EMBED_SERVICES, matchEmbedService, isHttpUrl, type EmbedKind } from '../registry';

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
const THREADS_WIDGET_SRC = 'https://www.threads.com/embed.js';

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
  private readOnly: boolean;
  private data: Partial<EmbedData>;
  private root: HTMLElement | null = null;
  private resizeDetach: (() => void)[] = [];
  /** Stable id linking the URL input to its inline error via aria-describedby. */
  private readonly urlErrorId = `blok-embed-url-error-${Math.random().toString(36).slice(2, 9)}`;

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

    this.resolveAndSet((event as PatternPasteEvent).detail.data);
  }

  /**
   * Resolves a URL into embed data and re-renders. A registry match always wins;
   * an unmatched safe http(s) URL becomes a generic sandboxed iframe only when the
   * host opted in via `linkPaste.allowGenericEmbed`. Returns whether the URL
   * resolved to an embeddable source.
   */
  private resolveAndSet(url: string): boolean {
    const match = matchEmbedService(url);

    if (match) {
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

      return true;
    }

    if (this.isGenericAllowed() && isHttpUrl(url)) {
      this.data = {
        service: '',
        source: url,
        embed: url,
        kind: 'iframe',
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      };
      this.renderState();

      return true;
    }

    return false;
  }

  private isGenericAllowed(): boolean {
    return this.api.config?.linkPaste?.allowGenericEmbed === true;
  }

  public render(): HTMLElement {
    const root = document.createElement('div');

    root.className = 'my-2';
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
   * Toggle read-only mode in place (no save/clear/render of the whole editor).
   * Swaps the caption node and the editing chrome so resize handles, the overlay
   * toolbar and caption editability follow the new state — without recreating the
   * iframe, which would detach & reload the embed (a visible "blink").
   */
  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    const figure = this.root?.querySelector<HTMLElement>('[data-role="embed-figure"]');

    // No live figure (empty / script embed) — fall back to a full rebuild.
    if (!figure) {
      this.renderState();

      return;
    }

    // Rebuilding the caption replaces its node, which would drop a live edit that
    // has not been committed via blur yet — commit it to data first.
    const existingCaption = figure.querySelector<HTMLElement>('[data-role="embed-caption"]');

    if (existingCaption) {
      const next = existingCaption.textContent ?? '';

      if (next !== (this.data.caption ?? '')) {
        this.data.caption = next;
      }
    }

    // Rebuild the caption so its contenteditable & blur wiring follow the new mode.
    existingCaption?.remove();

    const caption = this.buildCaption();

    if (caption) {
      figure.querySelector('[data-role="embed-aspect"]')?.after(caption);
    }

    // Read-only strips the editing chrome; editable restores it. Mirrors
    // refreshChrome() but also handles the removal-only (read-only) direction.
    this.detachResizers();
    figure.querySelectorAll('[data-role="resize-handle"]').forEach((el) => el.remove());
    figure.querySelector('[data-role="embed-overlay"]')?.remove();

    if (!state) {
      this.attachResizeHandles(figure);
      figure.appendChild(this.buildOverlay());
    }
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

    if (this.data.service === 'threads') {
      // Threads: text-post-media blockquote scanned and replaced by embed.js.
      // The permalink uses the canonical .com embed URL so pasted .net links
      // still produce the official markup.
      const threadsQuote = document.createElement('blockquote');

      threadsQuote.className = 'text-post-media';
      threadsQuote.setAttribute('data-text-post-permalink', this.data.embed ?? '');
      threadsQuote.setAttribute('data-text-post-version', '0');

      const threadsAnchor = document.createElement('a');

      threadsAnchor.href = this.data.embed ?? '';
      threadsQuote.appendChild(threadsAnchor);
      container.appendChild(threadsQuote);

      const threadsScript = document.createElement('script');

      threadsScript.async = true;
      threadsScript.src = THREADS_WIDGET_SRC;
      container.appendChild(threadsScript);

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
    el.className = 'blok-embed-empty';

    if (this.readOnly) {
      el.classList.add('blok-embed-empty--readonly');

      const note = document.createElement('span');

      note.className = 'blok-embed-empty__readonly';
      note.innerHTML = `<span class="blok-embed-empty__readonly-glyph" aria-hidden="true">${IconGlobe}</span>`;

      const text = document.createElement('span');

      text.textContent = this.api.i18n.t('tools.embed.empty');
      note.appendChild(text);
      el.appendChild(note);

      return el;
    }

    const form = document.createElement('form');

    form.setAttribute('data-role', 'embed-url-form');
    form.className = 'blok-embed-empty__form';

    const bar = document.createElement('div');

    bar.setAttribute('data-role', 'embed-url-bar');
    bar.setAttribute('data-valid', 'false');
    bar.className = 'blok-embed-empty__bar';

    const fieldIcon = document.createElement('span');

    fieldIcon.className = 'blok-embed-empty__bar-icon';
    fieldIcon.setAttribute('aria-hidden', 'true');
    fieldIcon.innerHTML = IconLinkCopy;

    const input = document.createElement('input');

    input.type = 'url';
    input.setAttribute('data-role', 'embed-url-input');
    input.className = 'blok-embed-empty__input';
    input.setAttribute('placeholder', this.api.i18n.t('tools.embed.urlPlaceholder'));
    input.setAttribute('aria-label', this.api.i18n.t('tools.embed.urlPlaceholder'));
    input.autocomplete = 'off';
    input.spellcheck = false;

    const submit = document.createElement('button');

    submit.type = 'submit';
    submit.setAttribute('data-role', 'embed-url-submit');
    submit.className = 'blok-embed-empty__submit';

    const submitLabel = document.createElement('span');

    submitLabel.className = 'blok-embed-empty__submit-label';
    submitLabel.textContent = this.api.i18n.t('tools.embed.urlSubmit');

    const kbd = document.createElement('kbd');

    kbd.className = 'blok-embed-empty__kbd';
    kbd.setAttribute('aria-hidden', 'true');
    kbd.textContent = '↵';
    submit.append(submitLabel, kbd);

    input.addEventListener('input', () => {
      bar.setAttribute('data-valid', this.looksLikeUrl(input.value) ? 'true' : 'false');
      // Editing after a rejected submit clears the shared invalid state.
      setFieldValidity(input, true, this.urlErrorId);
    });

    bar.append(fieldIcon, input, submit);
    form.appendChild(bar);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitUrl(input.value.trim(), el);
    });

    el.appendChild(form);

    return el;
  }

  /**
   * Lenient "is this URL-ish" check that only drives the input's affordance
   * (accent ring + ↵ hint). Accepts bare hosts like `vimeo.com/123` so the
   * cue lights up before the user types a scheme; real validation still runs
   * through `resolveAndSet` on submit.
   */
  private looksLikeUrl(raw: string): boolean {
    const value = raw.trim();

    if (value === '') {
      return false;
    }

    return isHttpUrl(value) || /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(value);
  }

  private submitUrl(url: string, container: HTMLElement): void {
    container.querySelector('[data-role="embed-url-error"]')?.remove();

    if (url !== '' && this.resolveAndSet(url)) {
      return;
    }

    const error = document.createElement('div');

    error.id = this.urlErrorId;
    error.setAttribute('data-role', 'embed-url-error');
    error.setAttribute('role', 'alert');
    error.textContent = this.api.i18n.t('tools.embed.invalidUrl');
    container.appendChild(error);

    // Surface the rejection through the shared invalid-field convention.
    const input = container.querySelector<HTMLInputElement>('[data-role="embed-url-input"]');

    if (input) {
      setFieldValidity(input, false, this.urlErrorId);
    }
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
    const minWidthPx = this.data.service !== undefined
      ? EMBED_SERVICES[this.data.service]?.minWidth
      : undefined;

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
        minWidthPx,
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

  /**
   * Caption visibility is driven by `captionVisible`: explicit `false` hides it
   * even when it still holds text (the toggle would otherwise look dead), and
   * explicit `true` shows it even while empty (so the user can start typing).
   * When the flag is unset (legacy data), fall back to "show if it has text".
   */
  private isCaptionVisible(): boolean {
    return this.data.captionVisible ?? (this.data.caption ?? '') !== '';
  }

  private buildCaption(): HTMLElement | null {
    if (!this.isCaptionVisible()) {
      return null;
    }

    const value = this.data.caption ?? '';
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
    const overlay = renderEmbedOverlay({
      alignment: this.data.alignment ?? 'center',
      captionVisible: this.isCaptionVisible(),
      source: this.data.source ?? '',
      i18n: this.api.i18n,
      onAlign: (next) => this.setAlignment(next),
      onToggleCaption: () => this.toggleCaption(),
    });

    // The "more" button opens the shared block-tunes popover (same as the image
    // block); embed-specific actions are contributed via renderSettings().
    const moreBtn = overlay.querySelector<HTMLButtonElement>('[data-action="more"]');

    moreBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openBlockSettings(moreBtn);
    });

    return overlay;
  }

  public renderSettings(): MenuConfig {
    const i18n = this.api.i18n;

    return [
      {
        icon: IconReplace,
        title: i18n.t('tools.embed.replace'),
        name: 'embed-replace',
        closeOnActivate: true,
        onActivate: (): void => this.replaceSource(),
      },
      {
        icon: IconCopy,
        title: i18n.t('tools.image.copyUrl'),
        name: 'embed-copy-url',
        closeOnActivate: true,
        onActivate: (): void => this.copyLink(),
      },
    ];
  }

  private openBlockSettings(trigger?: HTMLElement): void {
    const toolbar = (this.api as unknown as {
      toolbar?: {
        toggleBlockSettings?: (
          state: boolean,
          trigger?: HTMLElement,
          options?: { placeLeftOfAnchor?: boolean }
        ) => void;
      };
    }).toolbar;

    if (!toolbar?.toggleBlockSettings) {
      return;
    }
    this.root?.setAttribute('data-settings-open', 'true');
    trigger?.setAttribute('aria-expanded', 'true');
    const onClosed = (): void => {
      this.root?.removeAttribute('data-settings-open');
      trigger?.setAttribute('aria-expanded', 'false');
      this.api.events.off('block-settings-closed', onClosed);
    };

    this.api.events.on('block-settings-closed', onClosed);
    toolbar.toggleBlockSettings(true, trigger, { placeLeftOfAnchor: false });
  }

  private replaceSource(): void {
    this.data = { ...this.data, embed: '', source: '' };
    this.block.dispatchChange();
    this.renderState();
  }

  private setAlignment(next: EmbedAlignment): void {
    if ((this.data.alignment ?? 'center') === next) {
      return;
    }

    const figure = this.root?.querySelector<HTMLElement>('[data-role="embed-figure"]');

    // No live figure (empty / script embed) — fall back to a full rebuild.
    if (!figure) {
      this.data.alignment = next;
      this.renderState();
      this.block.dispatchChange();

      return;
    }

    // FLIP origin: where the figure sits before the layout shift.
    const prevRect = figure.getBoundingClientRect();

    this.data.alignment = next;
    this.block.dispatchChange();

    // Re-place in place rather than via renderState(): rebuilding the figure
    // recreates the iframe, which detaches & reloads the embed (a visible
    // "blink"). Mutating the margins keeps the live frame mounted.
    figure.style.marginLeft = next === 'left' ? '0' : 'auto';
    figure.style.marginRight = next === 'right' ? '0' : 'auto';

    // The overlay's active state and the resize handles both capture alignment
    // at build time, so refresh that chrome — without touching the iframe.
    this.refreshChrome(figure);

    // FLIP: slide from the old position to the new one (mirrors the image tool).
    const nextRect = figure.getBoundingClientRect();
    const dx = prevRect.left - nextRect.left;

    if (Math.abs(dx) < 0.5) {
      return;
    }

    figure.style.transition = 'none';
    figure.style.transform = `translateX(${dx}px)`;
    void figure.offsetWidth;
    figure.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
    figure.style.transform = 'translateX(0)';

    const cleanup = (): void => {
      figure.style.transition = '';
      figure.style.transform = '';
      figure.removeEventListener('transitionend', cleanup);
    };

    figure.addEventListener('transitionend', cleanup);
  }

  /**
   * Rebuilds the resize handles and hover overlay for the current alignment
   * without recreating the iframe. detachResizers() only strips listeners, so
   * the old handle/overlay nodes are removed explicitly to avoid duplicates.
   */
  private refreshChrome(figure: HTMLElement): void {
    if (this.readOnly) {
      return;
    }

    this.detachResizers();
    figure.querySelectorAll('[data-role="resize-handle"]').forEach((el) => el.remove());
    figure.querySelector('[data-role="embed-overlay"]')?.remove();

    this.attachResizeHandles(figure);
    figure.appendChild(this.buildOverlay());
  }

  private toggleCaption(): void {
    this.data.captionVisible = !this.isCaptionVisible();
    this.block.dispatchChange();

    const figure = this.root?.querySelector<HTMLElement>('[data-role="embed-figure"]');

    // No live figure (empty / script embed) — fall back to a full rebuild.
    if (!figure) {
      this.renderState();

      return;
    }

    // Add/remove the caption in place rather than via renderState(): rebuilding
    // the figure recreates the iframe, which detaches & reloads the embed (a
    // visible "blink"). Swap only the caption node and keep the live frame mounted.
    figure.querySelector('[data-role="embed-caption"]')?.remove();

    const caption = this.buildCaption();

    if (caption) {
      // Sit the caption directly under the aspect box, ahead of the chrome.
      figure.querySelector('[data-role="embed-aspect"]')?.after(caption);
    }

    // The overlay caption button's pressed state is captured at build time, so
    // refresh that chrome — without touching the iframe.
    this.refreshChrome(figure);
  }

  private copyLink(): void {
    const clip = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;

    void clip?.writeText(this.data.source ?? '');
  }
}
