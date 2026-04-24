import type {
  BlockTool,
  BlockToolConstructorOptions,
  PasteConfig,
  PasteEvent,
  ToolboxConfig,
  API,
  BlockAPI,
  FilePasteEvent,
  HTMLPasteEvent,
  PatternPasteEvent,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type {
  ImageAlignment,
  ImageConfig,
  ImageCrop,
  ImageData,
  ImageFrame,
  ImageSize,
} from '../../../types/tools/image';
import {
  IconCaption,
  IconCopy,
  IconCrop,
  IconDownload,
  IconExpandFullscreen,
  IconImage,
  IconImageAlignCenter,
  IconImageAlignLeft,
  IconImageAlignRight,
  IconReplaceImage,
} from '../../components/icons';
import { DEFAULT_CAPTION_PLACEHOLDER, URL_PATTERN } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { renderErrorState } from './error-state';
import { ImageError } from './errors';
import { attachResizeHandle, type ResizeEdge } from './resizer';
import { widthForAspectChange } from './crop-math';
import {
  applyAutoFull,
  openLightbox,
  renderCaptionRow,
  renderImage,
  renderOverlay,
  updateOverlayCompact,
} from './ui';
import { openCropModal } from './crop-modal';
import { openAltPopover } from './alt-popover';
import { renderUploadingState, type UploadingStateElement } from './uploading-state';
import { Uploader, type UploadResult } from './uploader';

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

export class ImageTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: ImageConfig;
  private readonly uploader: Uploader;
  private data: ImageData;
  private readOnly: boolean;
  private root: HTMLElement | null = null;
  private state: ToolState = 'EMPTY';
  private emptyStateEl: EmptyStateElement | null = null;
  private uploadingEl: UploadingStateElement | null = null;
  private resizeDetach: (() => void)[] = [];
  private overlayResizeObserver: ResizeObserver | null = null;
  private cropDetach: (() => void) | null = null;
  private altPopoverDetach: (() => void) | null = null;
  private errorMessage: string | null = null;
  private lastFileName: string | null = null;
  private lastSource: { kind: 'file'; file: File } | { kind: 'url'; url: string } | null = null;
  private brokenImage = false;
  private retrying = false;
  private reloadAttempts = 0;

  constructor(options: BlockToolConstructorOptions<ImageData, ImageConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.config = options.config ?? {};
    this.readOnly = options.readOnly;
    this.data = { ...options.data, url: options.data?.url ?? '' };
    this.state = this.data.url ? 'RENDERED' : 'EMPTY';
    this.uploader = new Uploader(this.config);
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    root.setAttribute('data-blok-tool', 'image');
    this.root = root;
    this.renderState();
    return root;
  }

  public save(_block?: HTMLElement): ImageData {
    const out: ImageData = { url: this.data.url };
    if (this.data.caption !== undefined) out.caption = this.data.caption;
    if (this.data.width !== undefined) out.width = this.data.width;
    if (this.data.alignment !== undefined) out.alignment = this.data.alignment;
    if (this.data.alt !== undefined) out.alt = this.data.alt;
    if (this.data.fileName !== undefined) out.fileName = this.data.fileName;
    if (this.data.size !== undefined) out.size = this.data.size;
    if (this.data.frame !== undefined) out.frame = this.data.frame;
    if (this.data.rounded !== undefined) out.rounded = this.data.rounded;
    if (this.data.captionVisible !== undefined) out.captionVisible = this.data.captionVisible;
    if (this.data.crop !== undefined) {
      const { x, y, w, h, shape } = this.data.crop;
      const isFull = x === 0 && y === 0 && w === 100 && h === 100;
      const isShaped = shape === 'circle' || shape === 'ellipse';
      if (!isFull || isShaped) {
        out.crop = isShaped ? { x, y, w, h, shape } : { x, y, w, h };
      }
    }
    return out;
  }

  public validate(data: ImageData): boolean {
    return typeof data.url === 'string' && data.url.length > 0;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconImage,
      titleKey: 'image',
      searchTerms: ['image', 'img', 'picture', 'photo', 'media'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      patterns: { image: URL_PATTERN },
      tags: [{ img: { src: true, alt: true } }],
      files: { mimeTypes: ['image/*'] },
    };
  }

  public onPaste(event: PasteEvent): void {
    if (event.type === 'pattern') {
      const detail = (event as PatternPasteEvent).detail;
      this.applyResult({ url: detail.data });
      return;
    }
    if (event.type === 'tag') {
      const node = (event as HTMLPasteEvent).detail.data;
      const src = node?.getAttribute?.('src') ?? '';
      if (!src) return;
      this.startUrl(src);
      return;
    }
    if (event.type === 'file') {
      const detail = (event as FilePasteEvent).detail;
      this.startUpload(detail.file);
    }
  }

  private reportProgress = (percent: number): void => {
    this.uploadingEl?.setProgress(percent);
  };

  private startUpload(file: File): void {
    this.lastFileName = file.name;
    this.lastSource = { kind: 'file', file };
    this.state = 'LOADING';
    this.errorMessage = null;
    this.brokenImage = false;
    this.renderState();
    void this.uploader
      .handleFile(file, { onProgress: this.reportProgress })
      .then((result) => this.applyResult(result))
      .catch((err) => this.applyError(err));
  }

  private startUrl(url: string): void {
    this.lastFileName = null;
    this.lastSource = { kind: 'url', url };
    this.state = 'LOADING';
    this.errorMessage = null;
    this.brokenImage = false;
    this.renderState();
    void this.uploader
      .handleUrl(url, { onProgress: this.reportProgress })
      .then((result) => this.applyResult(result))
      .catch((err) => this.applyError(err));
  }

  private retryLastSource(): void {
    const source = this.lastSource;
    if (!source) {
      this.transitionToEmpty();
      return;
    }
    this.retrying = true;
    this.syncRetryingAttribute();
    const retryBtn = this.root?.querySelector<HTMLButtonElement>(
      '[data-role="error-state"] [data-action="retry"]'
    );
    if (retryBtn) retryBtn.disabled = true;
    const promise = source.kind === 'file'
      ? this.uploader.handleFile(source.file, { onProgress: this.reportProgress })
      : this.uploader.handleUrl(source.url, { onProgress: this.reportProgress });
    void promise
      .then((result) => this.applyResult(result))
      .catch((err) => this.applyError(err));
  }

  private applyResult(result: UploadResult): void {
    this.data = { ...this.data, url: result.url, fileName: result.fileName ?? this.data.fileName };
    this.state = 'RENDERED';
    this.errorMessage = null;
    this.brokenImage = false;
    this.retrying = false;
    this.renderState();
    this.block.dispatchChange();
  }

  private applyError(err: unknown): void {
    this.state = 'ERROR';
    this.errorMessage = err instanceof Error ? err.message : this.api.i18n.t('tools.image.errorUploadFailed');
    this.brokenImage = false;
    this.retrying = false;
    this.renderState();
    if (!(err instanceof ImageError)) {
      console.error('[image] upload failed', err);
    }
  }

  private applyBrokenImage(): void {
    if (this.state === 'ERROR' && this.brokenImage) return;
    this.state = 'ERROR';
    this.brokenImage = true;
    this.errorMessage = this.api.i18n.t('tools.image.errorSourceOffline');
    this.renderState();
  }

  private handleImgLoadFailure(imgEl: HTMLImageElement, figure: HTMLElement): void {
    if (this.reloadAttempts >= 1) {
      figure.removeAttribute('data-loading');
      this.applyBrokenImage();
      return;
    }
    this.reloadAttempts++;
    figure.setAttribute('data-loading', 'true');
    const src = this.data.url;
    imgEl.setAttribute('src', '');
    imgEl.setAttribute('src', src);
  }

  private retryBrokenImage(): void {
    this.brokenImage = false;
    this.errorMessage = null;
    this.state = 'RENDERED';
    this.renderState();
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.renderState();
  }

  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this.root?.querySelector<HTMLElement>('.blok-image-inner') ?? undefined;
  }

  public getContentOffset(_hoveredElement: Element): { left: number } | undefined {
    const root = this.root;
    const figure = root?.querySelector<HTMLElement>('.blok-image-inner');
    if (!root || !figure) return undefined;
    const delta = figure.getBoundingClientRect().left - root.getBoundingClientRect().left;
    return delta > 0 ? { left: delta } : undefined;
  }

  public renderSettings(): MenuConfig {
    const i18n = this.api.i18n;
    const currentAlignment: ImageAlignment = this.data.alignment ?? 'center';
    const captionVisible = this.data.captionVisible !== false;
    const alignments: { value: ImageAlignment; title: string; icon: string }[] = [
      { value: 'left',   title: i18n.t('tools.image.alignmentLeft'),   icon: IconImageAlignLeft },
      { value: 'center', title: i18n.t('tools.image.alignmentCenter'), icon: IconImageAlignCenter },
      { value: 'right',  title: i18n.t('tools.image.alignmentRight'),  icon: IconImageAlignRight },
    ];
    const iconAlignment = alignments.find((a) => a.value === currentAlignment)?.icon ?? alignments[1].icon;
    const iconCaption = IconCaption;
    const iconReplace = IconReplaceImage;
    const iconCrop = IconCrop;
    const iconFullscreen = IconExpandFullscreen;
    const iconDownload = IconDownload;
    return [
      {
        icon: iconAlignment,
        title: i18n.t('tools.image.alignment'),
        name: 'image-alignment',
        children: {
          items: alignments.map((a) => ({
            icon: a.icon,
            title: a.title,
            name: `image-alignment-${a.value}`,
            isActive: currentAlignment === a.value,
            closeOnActivate: true,
            onActivate: (): void => this.setAlignment(a.value),
          })),
        },
      },
      {
        icon: iconCaption,
        title: i18n.t('tools.image.caption'),
        name: 'image-caption',
        isActive: captionVisible,
        closeOnActivate: true,
        onActivate: (): void => this.toggleCaption(),
      },
      {
        icon: iconReplace,
        title: i18n.t('tools.image.replace'),
        name: 'image-replace',
        closeOnActivate: true,
        onActivate: (): void => this.transitionToEmpty(),
      },
      {
        icon: iconCrop,
        title: i18n.t('tools.image.crop'),
        name: 'image-crop',
        closeOnActivate: true,
        onActivate: (): void => this.enterCrop(),
      },
      {
        icon: iconFullscreen,
        title: i18n.t('tools.image.viewFullscreen'),
        name: 'image-fullscreen',
        closeOnActivate: true,
        onActivate: (): void => this.openFullscreen(),
      },
      {
        icon: iconDownload,
        title: i18n.t('tools.image.downloadOriginal'),
        name: 'image-download',
        closeOnActivate: true,
        onActivate: (): void => this.download(),
      },
      {
        icon: IconCopy,
        title: i18n.t('tools.image.copyUrl'),
        name: 'image-copy-url',
        closeOnActivate: true,
        onActivate: (): void => this.copyUrl(),
      },
    ];
  }

  private openFullscreen(): void {
    const figure = this.root?.querySelector<HTMLElement>('.blok-image-inner');
    const origin = figure?.querySelector<HTMLElement>('.blok-image-crop')
      ?? figure?.querySelector<HTMLElement>('img')
      ?? undefined;
    openLightbox({
      url: this.data.url,
      alt: this.data.alt,
      fileName: this.data.fileName,
      crop: this.data.crop,
      origin,
      i18n: this.api.i18n,
      navigation: this.collectNavigation(),
    });
  }

  private collectNavigation(): { items: Array<{ url: string; alt?: string; fileName?: string; crop?: ImageCrop }>; startIndex: number } | undefined {
    const blocksApi = (this.api as API & { blocks?: { getBlocksCount(): number; getBlockByIndex(i: number): BlockAPI | undefined } }).blocks;
    if (!blocksApi?.getBlocksCount || !blocksApi.getBlockByIndex) return undefined;
    const count = blocksApi.getBlocksCount();
    type Collected = { blockId: string; item: { url: string; alt?: string; fileName?: string; crop?: ImageCrop } };
    const collected: Collected[] = Array.from({ length: count }, (_, i) => blocksApi.getBlockByIndex(i))
      .filter((b): b is BlockAPI => b !== undefined && b.name === 'image')
      .map((b): Collected | null => {
        const toolRoot = b.holder?.querySelector<HTMLElement>('[data-blok-tool="image"]');
        if (toolRoot?.getAttribute('data-state') === 'error') return null;
        const img = b.holder?.querySelector<HTMLImageElement>('.blok-image-inner img');
        if (img && img.complete && img.naturalWidth === 0) return null;
        const preserved = b.preservedData as Partial<ImageData> | undefined;
        const preservedUrl = typeof preserved?.url === 'string' ? preserved.url : '';
        if (preservedUrl) {
          return { blockId: b.id, item: { url: preservedUrl, alt: preserved?.alt, fileName: preserved?.fileName, crop: preserved?.crop } };
        }
        const src = img?.getAttribute('src') ?? '';
        if (!src) return null;
        const alt = img?.getAttribute('alt') ?? undefined;
        return { blockId: b.id, item: { url: src, alt, fileName: preserved?.fileName, crop: preserved?.crop } };
      })
      .filter((entry): entry is Collected => entry !== null);
    if (collected.length < 2) return undefined;
    const foundIndex = collected.findIndex((c) => c.blockId === this.block.id);
    const startIndex = foundIndex === -1 ? 0 : foundIndex;
    return { items: collected.map((c) => c.item), startIndex };
  }

  private enterCrop(): void {
    if (this.cropDetach) return;
    this.closeAlignmentPopover();
    this.cropDetach = openCropModal({
      url: this.data.url,
      alt: this.data.alt,
      initial: this.data.crop,
      onApply: (rect) => this.applyCrop(rect),
      onCancel: () => this.cancelCrop(),
      i18n: this.api.i18n,
    });
  }

  private applyCrop(rect: ImageCrop | null): void {
    this.cropDetach = null;
    const prevCrop = this.data.crop;
    // Keep the figure's rendered HEIGHT roughly stable across aspect changes
    // so a newly-tall crop doesn't balloon into a vertical tower (and a newly-
    // wide crop doesn't stretch sideways). Only rescale when the user has an
    // explicit width set; otherwise CSS size presets still rule.
    if (this.data.width !== undefined) {
      this.data.width = widthForAspectChange(this.data.width, prevCrop, rect);
    }
    if (rect === null) {
      delete this.data.crop;
    } else {
      this.data.crop = rect;
    }
    this.block.dispatchChange();
    this.renderState();
  }

  private cancelCrop(): void {
    this.cropDetach = null;
  }

  private detachCrop(): void {
    this.cropDetach?.();
    this.cropDetach = null;
  }

  private closeAlignmentPopover(): void {
    if (!this.root) return;
    const popover = this.root.querySelector<HTMLElement>(
      '[data-role="align-popover"]:not([hidden])'
    );
    if (!popover) return;
    popover.hidden = true;
    popover.removeAttribute('data-blok-popover-opened');
    this.root.removeAttribute('data-align-open');
    this.root
      .querySelector<HTMLElement>('[data-action="align-trigger"]')
      ?.setAttribute('aria-expanded', 'false');
  }

  public removed(): void {
    this.detachResize();
    this.detachCrop();
    this.altPopoverDetach?.();
    this.altPopoverDetach = null;
    if (this.data.url.startsWith('blob:')) {
      URL.revokeObjectURL(this.data.url);
    }
  }

  private detachResize(): void {
    while (this.resizeDetach.length > 0) {
      const detach = this.resizeDetach.pop();
      if (detach) detach();
    }
    this.overlayResizeObserver?.disconnect();
    this.overlayResizeObserver = null;
  }

  private syncRootAttributes(): void {
    if (!this.root) return;
    const r = this.root;
    r.setAttribute('data-state', this.state.toLowerCase());
    r.setAttribute('data-size', this.data.size ?? 'md');
    r.setAttribute('data-align', this.data.alignment ?? 'center');
    r.setAttribute('data-frame', this.data.frame ?? 'none');
    r.setAttribute('data-rounded', this.data.rounded === false ? 'off' : 'on');
    r.setAttribute(
      'data-caption',
      this.data.captionVisible === false ? 'off' : 'on'
    );
    r.setAttribute('data-alt', this.data.alt ? 'set' : 'none');
    r.setAttribute('data-selected', 'false');
    r.removeAttribute('data-align-open');
    this.syncRetryingAttribute();
  }

  private syncRetryingAttribute(): void {
    if (!this.root) return;
    if (this.retrying) {
      this.root.setAttribute('data-retrying', 'true');
    } else {
      this.root.removeAttribute('data-retrying');
    }
  }

  private renderState(): void {
    if (!this.root) return;
    this.detachResize();
    this.root.replaceChildren();
    this.syncRootAttributes();

    if (this.state === 'EMPTY') {
      this.renderEmpty();
      return;
    }
    if (this.state === 'LOADING') {
      this.renderLoading();
      return;
    }
    if (this.state === 'ERROR') {
      this.renderError();
      return;
    }

    this.renderRendered();
  }

  private renderEmpty(): void {
    if (!this.root) return;
    const el = renderEmptyState({
      onFile: (file) => this.startUpload(file),
      onUrl: (url) => this.startUrl(url),
      acceptTypes: this.config.types,
      maxSize: this.config.maxSize,
      i18n: this.api.i18n,
    });
    this.emptyStateEl = el;
    this.root.appendChild(el);
  }

  private renderLoading(): void {
    if (!this.root) return;
    const el = renderUploadingState({
      fileName: this.lastFileName ?? this.api.i18n.t('tools.image.uploading'),
      onCancel: () => this.transitionToEmpty(),
      i18n: this.api.i18n,
    });
    this.uploadingEl = el;
    this.root.appendChild(el);
  }

  private renderError(): void {
    if (!this.root) return;
    const isBroken = this.brokenImage;
    const el = renderErrorState({
      variant: isBroken ? 'broken' : 'upload',
      title: isBroken
        ? this.api.i18n.t('tools.image.errorImageFailedToLoad')
        : this.api.i18n.t('tools.image.errorUploadFailedTitle'),
      message: this.errorMessage ?? undefined,
      onTryAgain: isBroken
        ? () => this.retryBrokenImage()
        : () => this.retryLastSource(),
      onSwap: () => this.transitionToEmpty(),
      i18n: this.api.i18n,
    });
    this.root.appendChild(el);
  }

  private renderRendered(): void {
    if (!this.root) return;
    const figure = renderImage(this.data);

    const imgEl = figure.querySelector('img');
    // FLIP origin: the visible element. With an active crop that's the crop wrapper
    // (img extends past it), otherwise the img itself.
    const originEl = figure.querySelector<HTMLElement>('.blok-image-crop') ?? imgEl ?? undefined;
    if (imgEl) {
      imgEl.style.cursor = 'zoom-in';
      imgEl.addEventListener('click', () => openLightbox({ url: this.data.url, alt: this.data.alt, fileName: this.data.fileName, crop: this.data.crop, origin: originEl, i18n: this.api.i18n, navigation: this.collectNavigation() }));
      this.reloadAttempts = 0;
      imgEl.addEventListener('error', () => this.handleImgLoadFailure(imgEl, figure));
      imgEl.addEventListener('load', () => figure.removeAttribute('data-loading'));
      if (imgEl.complete && imgEl.naturalWidth === 0) {
        this.applyBrokenImage();
        return;
      }
    }

    if (!this.readOnly) {
      const overlay = renderOverlay({
        state: {
          alignment: this.data.alignment ?? 'center',
          captionVisible: this.data.captionVisible !== false,
          size: this.data.size ?? 'md',
        },
        onAlign: (next) => this.setAlignment(next),
        onSize: (next) => this.setSize(next),
        onReplace: () => this.transitionToEmpty(),
        onDelete: () => this.deleteBlock(),
        onDownload: () => this.download(),
        onFullscreen: () => openLightbox({ url: this.data.url, alt: this.data.alt, fileName: this.data.fileName, crop: this.data.crop, origin: originEl, i18n: this.api.i18n, navigation: this.collectNavigation() }),
        onCopyUrl: () => this.copyUrl(),
        onToggleCaption: () => this.toggleCaption(),
        onCrop: () => this.enterCrop(),
        i18n: this.api.i18n,
      });
      figure.appendChild(overlay);

      const moreBtn = overlay.querySelector<HTMLButtonElement>('[data-action="more"]');
      moreBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openBlockSettings(moreBtn);
      });

      this.observeOverlayWidth(figure, overlay);
    }

    const placeholder = this.config.captionPlaceholder ?? DEFAULT_CAPTION_PLACEHOLDER;
    const captionVisible = this.data.captionVisible !== false;
    const captionRow = renderCaptionRow({
      caption: {
        value: this.data.caption ?? '',
        placeholder,
        readOnly: this.readOnly,
      },
      onAlt: this.readOnly || !captionVisible ? undefined : () => this.promptAlt(),
      hasAlt: Boolean(this.data.alt),
      i18n: this.api.i18n,
    });
    const captionEl = captionRow.querySelector<HTMLElement>('.blok-image-caption');
    captionEl?.addEventListener('blur', () => {
      const next = captionEl.textContent ?? '';
      if (next !== this.data.caption) {
        this.data.caption = next;
        this.block.dispatchChange();
      }
    });
    figure.appendChild(captionRow);
    this.root.appendChild(figure);

    if (!this.readOnly) {
      this.attachResizeHandles(figure);
    }
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
    if (!toolbar?.toggleBlockSettings) return;
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

  private observeOverlayWidth(figure: HTMLElement, overlay: HTMLElement): void {
    const img = figure.querySelector<HTMLImageElement>('img');
    const sync = (): void => {
      if (this.root && img && img.naturalWidth > 0) {
        const container = this.root.parentElement;
        const containerWidth = container?.clientWidth ?? figure.clientWidth;
        applyAutoFull(this.root, img, containerWidth);
      }
      updateOverlayCompact(overlay, figure.clientWidth, figure.clientHeight);
    };
    sync();
    if (img && !img.complete) {
      img.addEventListener('load', sync, { once: true });
    }
    if (typeof ResizeObserver === 'undefined') return;
    this.overlayResizeObserver = new ResizeObserver(sync);
    this.overlayResizeObserver.observe(figure);
  }

  private attachResizeHandles(figure: HTMLElement): void {
    const edges: ResizeEdge[] = ['left', 'right'];
    for (const edge of edges) {
      const handle = this.createResizeHandle(edge);
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
          this.data.width = percent;
          this.block.dispatchChange();
        },
      });
      this.resizeDetach.push(detach);
    }
  }

  private createResizeHandle(edge: ResizeEdge): HTMLElement {
    const handle = document.createElement('div');
    handle.setAttribute('data-role', 'resize-handle');
    handle.setAttribute('data-edge', edge);
    return handle;
  }

  private setAlignment(next: ImageAlignment): void {
    if (this.data.alignment === next) return;
    const prevFigure = this.root?.querySelector<HTMLElement>('.blok-image-inner');
    const prevRect = prevFigure?.getBoundingClientRect();
    this.data.alignment = next;
    this.block.dispatchChange();
    this.renderState();
    if (!prevRect) return;
    const nextFigure = this.root?.querySelector<HTMLElement>('.blok-image-inner');
    if (!nextFigure) return;
    const nextRect = nextFigure.getBoundingClientRect();
    const dx = prevRect.left - nextRect.left;
    if (Math.abs(dx) < 0.5) return;
    nextFigure.style.transition = 'none';
    nextFigure.style.transform = `translateX(${dx}px)`;
    void nextFigure.offsetWidth;
    nextFigure.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
    nextFigure.style.transform = 'translateX(0)';
    const cleanup = (): void => {
      nextFigure.style.transition = '';
      nextFigure.style.transform = '';
      nextFigure.removeEventListener('transitionend', cleanup);
    };
    nextFigure.addEventListener('transitionend', cleanup);
  }

  private setSize(next: ImageSize): void {
    if (this.data.size === next) return;
    this.data.size = next;
    this.block.dispatchChange();
    this.renderState();
  }

  public setFrame(next: ImageFrame): void {
    if (this.data.frame === next) return;
    this.data.frame = next;
    this.block.dispatchChange();
    this.renderState();
  }

  public setRounded(next: boolean): void {
    if (this.data.rounded === next) return;
    this.data.rounded = next;
    this.block.dispatchChange();
    this.renderState();
  }

  private toggleCaption(): void {
    this.data.captionVisible = this.data.captionVisible === false;
    this.block.dispatchChange();
    this.renderState();
  }

  private transitionToEmpty(): void {
    this.data = { ...this.data, url: '' };
    this.state = 'EMPTY';
    this.errorMessage = null;
    this.brokenImage = false;
    this.lastSource = null;
    this.lastFileName = null;
    this.renderState();
    this.block.dispatchChange();
  }

  private promptAlt(): void {
    if (this.altPopoverDetach || !this.root) return;
    const anchor = this.root.querySelector<HTMLElement>(
      '.blok-image-caption-row [data-action="alt-edit"]'
    );
    if (!anchor) return;
    this.closeAlignmentPopover();
    anchor.setAttribute('aria-expanded', 'true');
    this.root.setAttribute('data-alt-open', 'true');
    this.altPopoverDetach = openAltPopover({
      anchor,
      value: this.data.alt ?? '',
      i18n: this.api.i18n,
      onSave: (next) => {
        this.altPopoverDetach = null;
        anchor.setAttribute('aria-expanded', 'false');
        this.root?.removeAttribute('data-alt-open');
        const trimmed = next.trim();
        const current = this.data.alt ?? '';
        if (trimmed === current) return;
        if (trimmed === '') delete this.data.alt;
        else this.data.alt = trimmed;
        this.block.dispatchChange();
        this.renderState();
      },
      onCancel: () => {
        this.altPopoverDetach = null;
        anchor.setAttribute('aria-expanded', 'false');
        this.root?.removeAttribute('data-alt-open');
      },
    });
  }

  private deleteBlock(): void {
    const blocks = (this.api as unknown as { blocks?: { delete?: (id: string) => void } }).blocks;
    blocks?.delete?.(this.block.id);
  }

  private download(): void {
    const a = document.createElement('a');
    a.href = this.data.url;
    a.download = this.data.fileName ?? '';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private copyUrl(): void {
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      void clip.writeText(this.data.url);
    }
  }
}
