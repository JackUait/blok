import type {
  BlockTool,
  BlockToolConstructorOptions,
  PasteConfig,
  PasteEvent,
  ToolboxConfig,
  API,
  BlockAPI,
  FilePasteEvent,
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
import { IconCopy, IconImage } from '../../components/icons';
import { DEFAULT_CAPTION_PLACEHOLDER, URL_PATTERN } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { renderErrorState } from './error-state';
import { ImageError } from './errors';
import { attachResizeHandle, type ResizeEdge } from './resizer';
import {
  openLightbox,
  renderCaptionRow,
  renderImage,
  renderOverlay,
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
  private cropDetach: (() => void) | null = null;
  private altPopoverDetach: (() => void) | null = null;
  private errorMessage: string | null = null;
  private lastFileName: string | null = null;

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
      title: 'Image',
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
      files: { mimeTypes: ['image/*'] },
    };
  }

  public onPaste(event: PasteEvent): void {
    if (event.type === 'pattern') {
      const detail = (event as PatternPasteEvent).detail;
      this.applyResult({ url: detail.data });
      return;
    }
    if (event.type === 'file') {
      const detail = (event as FilePasteEvent).detail;
      this.startUpload(detail.file);
    }
  }

  private startUpload(file: File): void {
    this.lastFileName = file.name;
    this.state = 'LOADING';
    this.errorMessage = null;
    this.renderState();
    void this.uploader
      .handleFile(file)
      .then((result) => this.applyResult(result))
      .catch((err) => this.applyError(err));
  }

  private applyResult(result: UploadResult): void {
    this.data = { ...this.data, url: result.url, fileName: result.fileName ?? this.data.fileName };
    this.state = 'RENDERED';
    this.errorMessage = null;
    this.renderState();
    this.block.dispatchChange();
  }

  private applyError(err: unknown): void {
    this.state = 'ERROR';
    this.errorMessage = err instanceof Error ? err.message : 'Upload failed';
    this.renderState();
    if (!(err instanceof ImageError)) {
      console.error('[image] upload failed', err);
    }
  }

  private showEmptyError(err: unknown): void {
    if (this.emptyStateEl) {
      this.emptyStateEl.setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.renderState();
  }

  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this.root?.querySelector<HTMLElement>('.blok-image-inner') ?? undefined;
  }

  public renderSettings(): MenuConfig {
    const currentSize = this.data.size ?? 'md';
    const sizes: { value: ImageSize; title: string }[] = [
      { value: 'sm', title: 'Small' },
      { value: 'md', title: 'Medium' },
      { value: 'lg', title: 'Large' },
      { value: 'full', title: 'Full' },
    ];
    const iconDownload = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true" focusable="false"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
    return [
      {
        icon: IconImage,
        title: 'Size',
        name: 'image-size',
        children: {
          items: sizes.map((s) => ({
            icon: IconImage,
            title: s.title,
            name: `image-size-${s.value}`,
            isActive: currentSize === s.value,
            closeOnActivate: true,
            onActivate: (): void => this.setSize(s.value),
          })),
        },
      },
      {
        icon: iconDownload,
        title: 'Download original',
        name: 'image-download',
        closeOnActivate: true,
        onActivate: (): void => this.download(),
      },
      {
        icon: IconCopy,
        title: 'Copy URL',
        name: 'image-copy-url',
        closeOnActivate: true,
        onActivate: (): void => this.copyUrl(),
      },
    ];
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
    });
  }

  private applyCrop(rect: ImageCrop | null): void {
    this.cropDetach = null;
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
      onUrl: (url) => {
        void this.uploader
          .handleUrl(url)
          .then((result) => this.applyResult(result))
          .catch((err) => this.showEmptyError(err));
      },
      acceptTypes: this.config.types,
    });
    this.emptyStateEl = el;
    this.root.appendChild(el);
  }

  private renderLoading(): void {
    if (!this.root) return;
    const el = renderUploadingState({
      fileName: this.lastFileName ?? 'Uploading…',
      onCancel: () => this.transitionToEmpty(),
    });
    this.uploadingEl = el;
    this.root.appendChild(el);
  }

  private renderError(): void {
    if (!this.root) return;
    const el = renderErrorState({
      message: this.errorMessage ?? undefined,
      onRetry: this.lastFileName
        ? undefined
        : () => this.transitionToEmpty(),
      onReplace: () => this.transitionToEmpty(),
    });
    this.root.appendChild(el);
  }

  private renderRendered(): void {
    if (!this.root) return;
    const figure = renderImage(this.data);

    const imgEl = figure.querySelector('img');
    if (imgEl) {
      imgEl.style.cursor = 'zoom-in';
      imgEl.addEventListener('click', () => openLightbox({ url: this.data.url, alt: this.data.alt, fileName: this.data.fileName }));
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
        onFullscreen: () => openLightbox({ url: this.data.url, alt: this.data.alt, fileName: this.data.fileName }),
        onCopyUrl: () => this.copyUrl(),
        onToggleCaption: () => this.toggleCaption(),
        onCrop: () => this.enterCrop(),
      });
      figure.appendChild(overlay);

      const moreBtn = overlay.querySelector<HTMLButtonElement>('[data-action="more"]');
      moreBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openBlockSettings(moreBtn);
      });
    }

    const placeholder = this.config.captionPlaceholder ?? DEFAULT_CAPTION_PLACEHOLDER;
    const captionRow = renderCaptionRow({
      caption: {
        value: this.data.caption ?? '',
        placeholder,
        readOnly: this.readOnly,
      },
      onAlt: this.readOnly ? undefined : () => this.promptAlt(),
      hasAlt: Boolean(this.data.alt),
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
    const onClosed = (): void => {
      this.root?.removeAttribute('data-settings-open');
      this.api.events.off('block-settings-closed', onClosed);
    };
    this.api.events.on('block-settings-closed', onClosed);
    toolbar.toggleBlockSettings(true, trigger, { placeLeftOfAnchor: false });
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
    this.data.alignment = next;
    this.block.dispatchChange();
    this.renderState();
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
    this.altPopoverDetach = openAltPopover({
      anchor,
      value: this.data.alt ?? '',
      onSave: (next) => {
        this.altPopoverDetach = null;
        anchor.setAttribute('aria-expanded', 'false');
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
