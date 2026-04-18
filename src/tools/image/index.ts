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
import { ImageError } from './errors';
import { renderCaption, renderImage } from './ui';
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

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.renderState();
  }

  private renderState(): void {
    if (!this.root) return;
    this.root.replaceChildren();

    if (this.state !== 'RENDERED') return;

    const figure = renderImage(this.data);
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
    this.root.appendChild(figure);
  }
}
