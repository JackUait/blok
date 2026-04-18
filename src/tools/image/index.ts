import type {
  BlockTool,
  BlockToolConstructorOptions,
  PasteConfig,
  PasteEvent,
  ToolboxConfig,
  API,
  BlockAPI,
} from '../../../types';
import type { ImageData, ImageConfig } from '../../../types/tools/image';
import { IconImage } from '../../components/icons';
import { DEFAULT_CAPTION_PLACEHOLDER, URL_PATTERN } from './constants';
import { renderCaption, renderImage } from './ui';

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

export class ImageTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: ImageConfig;
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

  public onPaste(_event: PasteEvent): void {
    // wired in next task
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
