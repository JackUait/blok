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
import type { ImageData, ImageConfig } from '../../../types/tools/image';
import { IconImage } from '../../components/icons';
import { DEFAULT_CAPTION_PLACEHOLDER, URL_PATTERN } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { ImageError } from './errors';
import { attachResizeHandle, type ResizeEdge } from './resizer';
import { openLightbox, renderCaption, renderImage, renderOverlay } from './ui';
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
  private resizeDetach: (() => void)[] = [];

  constructor(options: BlockToolConstructorOptions<ImageData, ImageConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.config = options.config ?? {};
    this.readOnly = options.readOnly;
    this.data = { url: '', ...options.data };
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

  public save(): ImageData {
    const out: ImageData = { url: this.data.url };
    if (this.data.caption !== undefined) out.caption = this.data.caption;
    if (this.data.width !== undefined) out.width = this.data.width;
    if (this.data.alignment !== undefined) out.alignment = this.data.alignment;
    if (this.data.alt !== undefined) out.alt = this.data.alt;
    if (this.data.fileName !== undefined) out.fileName = this.data.fileName;
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
      void this.applyResult({ url: detail.data });
      return;
    }
    if (event.type === 'file') {
      const detail = (event as FilePasteEvent).detail;
      this.state = 'LOADING';
      this.renderState();
      void this.uploader
        .handleFile(detail.file)
        .then((result) => this.applyResult(result))
        .catch((err) => this.applyError(err));
    }
  }

  private applyResult(result: UploadResult): void {
    this.data = { ...this.data, url: result.url, fileName: result.fileName ?? this.data.fileName };
    this.state = 'RENDERED';
    this.renderState();
    this.block.dispatchChange();
  }

  private applyError(err: unknown): void {
    this.state = 'ERROR';
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

  public removed(): void {
    while (this.resizeDetach.length > 0) {
      const detach = this.resizeDetach.pop();
      if (detach) detach();
    }
    if (this.data.url.startsWith('blob:')) {
      URL.revokeObjectURL(this.data.url);
    }
  }

  private renderState(): void {
    if (!this.root) return;
    while (this.resizeDetach.length > 0) {
      const detach = this.resizeDetach.pop();
      if (detach) detach();
    }
    this.root.replaceChildren();

    if (this.state === 'EMPTY') {
      const el = renderEmptyState({
        onFile: (file) => {
          const event = new CustomEvent('paste', { detail: { file } }) as FilePasteEvent;
          Object.defineProperty(event, 'type', { value: 'file' });
          this.onPaste(event);
        },
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
      return;
    }
    if (this.state === 'LOADING') {
      const skeleton = document.createElement('div');
      skeleton.setAttribute('data-role', 'loading');
      skeleton.textContent = 'Loading…';
      this.root.appendChild(skeleton);
      return;
    }
    if (this.state === 'ERROR') {
      const err = document.createElement('div');
      err.setAttribute('data-role', 'error');
      err.textContent = "Couldn't load image";
      this.root.appendChild(err);
      return;
    }

    const figure = renderImage(this.data);
    figure.style.position = 'relative';

    const imgEl = figure.querySelector('img');
    if (imgEl) {
      imgEl.style.cursor = 'zoom-in';
      imgEl.addEventListener('click', () => openLightbox({ url: this.data.url, alt: this.data.alt }));
    }

    if (!this.readOnly) {
      const overlay = renderOverlay({
        onAlign: () => this.cycleAlignment(),
        onReplace: () => this.transitionToEmpty(),
        onAlt: () => this.promptAlt(),
        onDelete: () => {
          const blocks = (this.api as unknown as { blocks?: { delete?: (id: string) => void } }).blocks;
          blocks?.delete?.(this.block.id);
        },
        onDownload: () => this.download(),
        onFullscreen: () => openLightbox({ url: this.data.url, alt: this.data.alt }),
      });
      figure.appendChild(overlay);
      figure.addEventListener('mouseenter', () => {
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
      });
      figure.addEventListener('mouseleave', () => {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
      });
    }

    const placeholder = this.config.captionPlaceholder ?? DEFAULT_CAPTION_PLACEHOLDER;
    const caption = renderCaption({
      value: this.data.caption ?? '',
      placeholder,
      readOnly: this.readOnly,
    });
    caption.addEventListener('blur', () => {
      const next = caption.textContent ?? '';
      if (next !== this.data.caption) {
        this.data.caption = next;
        this.block.dispatchChange();
      }
    });
    figure.appendChild(caption);

    if (!this.readOnly) {
      const edges: ResizeEdge[] = ['left', 'right'];
      for (const edge of edges) {
        const handle = document.createElement('div');
        handle.setAttribute('data-role', 'resize-handle');
        handle.setAttribute('data-edge', edge);
        Object.assign(handle.style, {
          position: 'absolute',
          top: '0',
          bottom: '0',
          width: '6px',
          cursor: 'col-resize',
          background: 'transparent',
        } as Partial<CSSStyleDeclaration>);
        if (edge === 'left') handle.style.left = '-3px';
        else handle.style.right = '-3px';
        figure.appendChild(handle);
        const detach = attachResizeHandle({
          handle,
          container: figure,
          edge,
          onPreview: (percent) => {
            const img = figure.querySelector('img');
            if (img) img.style.width = `${percent}%`;
          },
          onCommit: (percent) => {
            this.data.width = percent;
            this.block.dispatchChange();
          },
        });
        this.resizeDetach.push(detach);
      }
    }

    this.root.appendChild(figure);
  }

  private cycleAlignment(): void {
    const order: NonNullable<ImageData['alignment']>[] = ['left', 'center', 'right'];
    const current = this.data.alignment;
    const next = current === undefined
      ? order[0]
      : order[(order.indexOf(current) + 1) % order.length];
    this.data.alignment = next;
    this.block.dispatchChange();
    this.renderState();
  }

  private transitionToEmpty(): void {
    this.data = { ...this.data, url: '' };
    this.state = 'EMPTY';
    this.renderState();
    this.block.dispatchChange();
  }

  private promptAlt(): void {
    const next = window.prompt('Alt text', this.data.alt ?? '');
    if (next === null) return;
    this.data.alt = next;
    this.block.dispatchChange();
    this.renderState();
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
}
