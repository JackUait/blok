import type {
  API,
  AssetKind,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  FilePasteEvent,
  PasteConfig,
  PasteEvent,
  ToolboxConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { FileConfig, FileData, FileUploadResult } from '../../../types/tools/file';
import type { ImageData } from '../../../types/tools/image';
import type { VideoData } from '../../../types/tools/video';
import { IconCaption, IconCopy, IconDownload, IconFile, IconReplace } from '../../components/icons';
import { PASTE_EXTENSIONS, PASTE_MIME_TYPES } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { renderUploadingState, type UploadingStateElement } from './uploading-state';
import { renderCaptionRow, renderFileCard } from './ui';
import { Uploader } from './uploader';
import { FileToolError } from './errors';
import { uploadErrorMessage } from '../../components/utils/upload-error-message';
import { safeHttpHref } from './url';
import { isPreviewable } from './preview';
import { openFilePreview } from './preview-modal';
import { deliverToRebuiltBlock, putBackOnRebuiltBlock, writeDerived } from '../image/detached-upload';

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

/** Image filenames/URLs that should auto-convert the File block into an Image. */
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)/i;

/** Video filenames/URLs that should auto-convert the File block into a Video. */
const VIDEO_EXTENSION_RE = /\.(mp4|webm|ogg|mov|m4v)(?:[?#]|$)/i;

export class FileTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: FileConfig;
  private readonly uploader: Uploader;
  private data: FileData;
  private readOnly: boolean;
  private root: HTMLElement | null = null;
  private state: ToolState;
  private uploadingEl: UploadingStateElement | null = null;
  private lastFileName: string | null = null;
  private errorMessage: string | null = null;
  private previewTeardown: (() => void) | null = null;
  /** When the pending upload is an image, the result converts to an Image block. */
  private pendingImageConversion = false;
  /** When the pending upload is a video, the result converts to a Video block. */
  private pendingVideoConversion = false;
  /** Set by `removed()`: this instance is no longer the document's block. */
  private detached = false;
  /** The file or link being uploaded; cleared when the user cancels or replaces it. */
  private uploading: File | string | null = null;

  constructor(options: BlockToolConstructorOptions<FileData, FileConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.config = options.config ?? {};
    this.readOnly = options.readOnly;
    this.data = { ...options.data, url: options.data?.url ?? '' };
    this.state = this.data.url ? 'RENDERED' : 'EMPTY';
    this.uploader = new Uploader(this.config, this.api.uploader);
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    root.setAttribute('data-blok-tool', 'file');
    this.root = root;
    this.renderState();
    return root;
  }

  public save(): FileData {
    const out: FileData = { url: this.data.url };
    if (this.data.fileName !== undefined) out.fileName = this.data.fileName;
    if (this.data.size !== undefined) out.size = this.data.size;
    if (this.data.mimeType !== undefined) out.mimeType = this.data.mimeType;
    // Collab keeps `caption` as a Y.Text for character-level merging. A
    // non-string here would fall through to a whole-key set that replaces that
    // Y.Text for good, so an out-of-contract value is dropped, not coerced.
    if (typeof this.data.caption === 'string' && this.data.caption !== '') out.caption = this.data.caption;
    if (this.data.captionVisible !== undefined) out.captionVisible = this.data.captionVisible;
    return out;
  }

  public validate(data: FileData): boolean {
    return typeof data.url === 'string' && data.url.length > 0;
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.renderState();
  }

  /**
   * Anchor the +/drag toolbar to the file card at the top. The caption row
   * below is contenteditable, so the default contenteditable-descendant search
   * would otherwise center the toolbar on the caption at the block's bottom.
   */
  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this.root?.querySelector<HTMLElement>('[data-role="file-card"]') ?? undefined;
  }

  public onPaste(event: PasteEvent): void {
    if (event.type === 'file') {
      if (this.config.sources === 'url') return;
      this.startUpload((event as FilePasteEvent).detail.file);
    }
  }

  public renderSettings(): MenuConfig {
    const i18n = this.api.i18n;
    const captionVisible = this.data.captionVisible ?? ((this.data.caption ?? '') !== '');
    return [
      {
        icon: IconCaption,
        title: i18n.t('tools.file.toggleCaption'),
        name: 'file-caption',
        isActive: captionVisible,
        closeOnActivate: true,
        onActivate: (): void => this.toggleCaption(),
      },
      {
        icon: IconReplace,
        title: i18n.t('tools.file.replace'),
        name: 'file-replace',
        closeOnActivate: true,
        onActivate: (): void => this.transitionToEmpty(),
      },
      {
        icon: IconDownload,
        title: i18n.t('tools.file.download'),
        name: 'file-download',
        closeOnActivate: true,
        onActivate: (): void => this.download(),
      },
      {
        icon: IconCopy,
        title: i18n.t('tools.file.copyUrl'),
        name: 'file-copy-url',
        closeOnActivate: true,
        onActivate: (): void => void navigator.clipboard?.writeText(this.data.url),
      },
    ];
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconFile,
      titleKey: 'file',
      searchTerms: ['file', 'attachment', 'upload', 'download', 'pdf', 'document'],
      section: 'media',
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get assetKind(): AssetKind {
    return 'file';
  }

  public static get pasteConfig(): PasteConfig {
    return {
      files: {
        mimeTypes: [...PASTE_MIME_TYPES],
        extensions: [...PASTE_EXTENSIONS],
      },
    };
  }

  private startUpload(file: File): void {
    this.lastFileName = file.name;
    this.uploading = file;
    this.pendingImageConversion = file.type.startsWith('image/') || IMAGE_EXTENSION_RE.test(file.name);
    this.pendingVideoConversion = file.type.startsWith('video/') || VIDEO_EXTENSION_RE.test(file.name);
    this.state = 'LOADING';
    this.renderState();
    // Choosing the file is the edit, so the upload's result can join its undo step.
    const before = this.data.fileName;

    this.data = { ...this.data, fileName: file.name };
    this.block.dispatchChange();
    const fromUrl = this.data.url;

    void this.uploader
      .handleFile(file, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyUpload(result, file, fromUrl))
      .catch((err) => this.applyPickError(err, file, before));
  }

  /**
   * A failed upload of a file the user picked. The file name is put back to
   * `before` as derived data, so the pick nets to nothing and leaves no undo step.
   * @param err - why the upload failed
   * @param file - the picked file, still `uploading` unless cancelled or replaced
   * @param before - `data.fileName` before the file was picked
   */
  private applyPickError(err: unknown, file: File, before: string | undefined): void {
    if (this.detached) {
      putBackOnRebuiltBlock(this.api, this.block, { fileName: before }, { fileName: file.name }, ['fileName']);

      return;
    }
    this.applyError(err);
    if (this.uploading !== file || this.data.fileName !== file.name) return;
    this.data = { ...this.data, fileName: before };
    this.block.dispatchChange({ derived: true, from: ['fileName'] });
  }

  private startUrl(url: string): void {
    const before = this.data.url;

    this.lastFileName = null;
    this.uploading = url;
    this.pendingImageConversion = IMAGE_EXTENSION_RE.test(url);
    this.pendingVideoConversion = VIDEO_EXTENSION_RE.test(url);
    this.state = 'LOADING';
    this.renderState();
    // Entering the link is the edit, so what the upload produces can join its undo step.
    this.data = { ...this.data, url };
    this.block.dispatchChange();
    void this.uploader
      .handleUrl(url, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyUrlUpload(result, url))
      .catch((err) => this.applyUrlError(err, url, before));
  }

  /**
   * A failed upload of a link the user entered. The link is put back to
   * `before` as derived data, so its edit nets to nothing and leaves no undo step.
   * @param err - why the upload failed
   * @param url - the link, still `uploading` unless cancelled or replaced
   * @param before - `data.url` before the link was entered
   */
  private applyUrlError(err: unknown, url: string, before: string): void {
    if (this.detached) {
      putBackOnRebuiltBlock(this.api, this.block, { url: before }, { url }, ['url']);

      return;
    }
    this.applyError(err);
    if (this.uploading !== url || this.data.url !== url) return;
    this.data = { ...this.data, url: before };
    this.block.dispatchChange({ derived: true, from: ['url'] });
  }

  /**
   * A finished upload of a link the user entered. It lands only while the
   * block still shows that link, and as derived data: the edit was the link.
   * @param result - what the uploader returned
   * @param url - the link, still `uploading` unless cancelled or replaced
   */
  private applyUrlUpload(result: FileUploadResult, url: string): void {
    if (this.detached) {
      // The image/video auto-conversion is deliberately skipped: it would have
      // to rebuild the live block from this instance's pre-peer-edit data.
      deliverToRebuiltBlock(this.api, this.block, 'File', this.resultDelta(result), { url }, ['url']);

      return;
    }
    if (this.uploading !== url || this.data.url !== url) return;
    if (this.showResult(result, ['url'])) {
      this.block.dispatchChange({ derived: true, from: ['url'] });
    }
  }

  /**
   * A finished file upload. It lands only while the block still shows the
   * pick that started it, and as derived data: the edit was the pick.
   * @param result - what the uploader returned
   * @param file - the picked file, still `uploading` unless cancelled or replaced
   * @param fromUrl - `data.url` when the job started
   */
  private applyUpload(result: FileUploadResult, file: File, fromUrl: string): void {
    if (this.detached) {
      deliverToRebuiltBlock(this.api, this.block, 'File', this.resultDelta(result), { url: fromUrl, fileName: file.name }, ['fileName']);

      return;
    }
    if (this.uploading !== file || this.data.url !== fromUrl) return;
    if (this.showResult(result, ['fileName'])) {
      this.block.dispatchChange({ derived: true, from: ['fileName'] });
    }
  }

  private resultDelta(result: FileUploadResult): Partial<FileData> {
    const delta: Partial<FileData> = { url: result.url };
    const fileName = result.fileName ?? this.lastFileName;

    if (fileName !== null && fileName !== undefined) delta.fileName = fileName;
    if (result.size !== undefined) delta.size = result.size;
    if (result.mimeType !== undefined) delta.mimeType = result.mimeType;

    return delta;
  }

  /**
   * @param result - what the uploader returned
   * @param from - the keys the user's pick or link wrote: a conversion joins that edit's undo step
   * @returns false when the block was converted to an image or a video instead
   */
  private showResult(result: FileUploadResult, from: readonly string[]): boolean {
    this.errorMessage = null;
    this.data = {
      ...this.data,
      url: result.url,
      fileName: result.fileName ?? this.lastFileName ?? this.data.fileName,
      size: result.size ?? this.data.size,
      mimeType: result.mimeType ?? this.data.mimeType,
    };
    if (this.pendingVideoConversion && this.convertToVideo(from)) {
      return false;
    }
    if (this.pendingImageConversion && this.convertToImage(from)) {
      return false;
    }
    this.state = 'RENDERED';
    this.renderState();

    return true;
  }

  /**
   * Swap this File block for an Image block carrying the just-uploaded url.
   * File and Image declare no conversionConfig, so we replace in place rather
   * than going through api.blocks.convert. Returns false (keep the file card)
   * when the block can no longer be located.
   * @param from - see `showResult`
   */
  private convertToImage(from: readonly string[]): boolean {
    const index = this.api.blocks.getBlockIndex(this.block.id);
    if (index === undefined) {
      return false;
    }
    const imageData: ImageData = { url: this.data.url };
    if (this.data.fileName !== undefined) imageData.fileName = this.data.fileName;
    if ((this.data.caption ?? '') !== '') imageData.caption = this.data.caption;
    if (this.data.captionVisible !== undefined) imageData.captionVisible = this.data.captionVisible;
    writeDerived(this.api, this.block.id, from, () => {
      this.api.blocks.insert('image', imageData, {}, index, false, true);
    });
    return true;
  }

  /**
   * Swap this File block for a Video block carrying the just-uploaded url.
   * Mirrors {@link convertToImage}: File and Video declare no conversionConfig,
   * so we replace in place. Returns false (keep the file card) when the block
   * can no longer be located.
   * @param from - see `showResult`
   */
  private convertToVideo(from: readonly string[]): boolean {
    const index = this.api.blocks.getBlockIndex(this.block.id);
    if (index === undefined) {
      return false;
    }
    const videoData: VideoData = { url: this.data.url };
    if (this.data.fileName !== undefined) videoData.fileName = this.data.fileName;
    if (this.data.mimeType !== undefined) videoData.mimeType = this.data.mimeType;
    if ((this.data.caption ?? '') !== '') videoData.caption = this.data.caption;
    if (this.data.captionVisible !== undefined) videoData.captionVisible = this.data.captionVisible;
    writeDerived(this.api, this.block.id, from, () => {
      this.api.blocks.insert('video', videoData, {}, index, false, true);
    });
    return true;
  }

  private applyError(err?: unknown): void {
    this.errorMessage = err instanceof FileToolError
      ? uploadErrorMessage(err, (key) => this.api.i18n.t(key), {
        tooLarge: 'tools.file.errorFileTooLarge',
        generic: 'tools.file.errorUploadFailed',
      })
      : null;
    this.state = 'ERROR';
    this.renderState();
  }

  private transitionToEmpty(): void {
    this.uploading = null;
    this.data = { ...this.data, url: '' };
    this.state = 'EMPTY';
    this.renderState();
    this.block.dispatchChange();
  }

  private renameFile(next: string): void {
    if (next === this.data.fileName) {
      return;
    }
    this.data = { ...this.data, fileName: next };
    // Re-render so the download attribute and preview title pick up the new name.
    this.renderState();
    this.block.dispatchChange();
  }

  private toggleCaption(): void {
    const visible = this.data.captionVisible ?? ((this.data.caption ?? '') !== '');
    this.data = { ...this.data, captionVisible: !visible };
    this.renderState();
    this.block.dispatchChange();
  }

  private download(): void {
    const link = this.root?.querySelector<HTMLAnchorElement>('a[data-action="download"]');
    if (link) {
      link.click();
      return;
    }
    const href = safeHttpHref(this.data.url);
    if (href === null) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = this.data.fileName ?? '';
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
  }

  private openPreview(): void {
    this.previewTeardown?.();
    this.previewTeardown = openFilePreview({
      url: this.data.url,
      fileName: this.data.fileName,
      mimeType: this.data.mimeType,
      labels: {
        close: this.api.i18n.t('tools.file.previewClose'),
        raw: this.api.i18n.t('tools.file.previewRaw'),
        render: this.api.i18n.t('tools.file.previewRender'),
        loading: this.api.i18n.t('tools.file.previewLoading'),
        error: this.api.i18n.t('tools.file.previewError'),
        download: this.api.i18n.t('tools.file.previewDownload'),
        openInNewTab: this.api.i18n.t('tools.file.previewOpenInNewTab'),
        backToContent: this.api.i18n.t('tools.file.previewBackToContent'),
      },
    });
  }

  public removed(): void {
    this.detached = true;
    this.previewTeardown?.();
    this.previewTeardown = null;
  }

  private renderState(): void {
    if (!this.root) {
      return;
    }
    this.previewTeardown?.();
    this.previewTeardown = null;
    this.root.innerHTML = '';
    this.uploadingEl = null;

    if (this.state === 'EMPTY') {
      this.root.appendChild(this.buildEmpty());
      return;
    }
    if (this.state === 'LOADING') {
      this.uploadingEl = this.buildUploading();
      this.root.appendChild(this.uploadingEl);
      return;
    }
    if (this.state === 'ERROR') {
      this.root.appendChild(this.buildError());
      return;
    }
    this.root.appendChild(this.buildRendered());
  }

  private buildEmpty(): EmptyStateElement {
    return renderEmptyState({
      acceptTypes: this.config.types ?? [],
      sources: this.config.sources,
      i18n: this.api.i18n,
      onFile: (file) => this.startUpload(file),
      onUrl: (url) => this.startUrl(url),
    });
  }

  private buildUploading(): UploadingStateElement {
    const i18n = this.api.i18n;
    return renderUploadingState({
      fileName: this.lastFileName,
      labels: {
        uploading: i18n.t('tools.file.uploading'),
        cancel: i18n.t('tools.file.cancelUpload'),
        progress: i18n.t('tools.file.uploadProgress'),
      },
      onCancel: () => this.transitionToEmpty(),
    });
  }

  private buildError(): HTMLElement {
    const i18n = this.api.i18n;
    const wrap = document.createElement('div');
    wrap.className = 'blok-file-error-state';
    wrap.setAttribute('data-role', 'file-error');

    const message = document.createElement('span');
    message.textContent = this.errorMessage ?? i18n.t('tools.file.errorUploadFailed');

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'blok-file-retry';
    retry.setAttribute('data-action', 'replace');
    retry.textContent = i18n.t('tools.file.errorReplace');
    retry.addEventListener('click', () => this.transitionToEmpty());

    wrap.append(message, retry);
    return wrap;
  }

  private buildRendered(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'blok-file-rendered';
    const onPreview = isPreviewable(this.data) ? (): void => this.openPreview() : undefined;
    const onRename = this.readOnly ? undefined : (next: string): void => this.renameFile(next);
    wrap.appendChild(renderFileCard(this.data, onPreview, this.api.i18n.t('tools.file.download'), onRename));

    const hasCaption = (this.data.caption ?? '') !== '';
    // Hidden by default: the row shows only when explicitly toggled on or when
    // existing data carries caption text. In read-only the placeholder is no
    // longer an affordance, so an empty caption is dropped entirely.
    const captionVisible = this.data.captionVisible ?? hasCaption;
    if (captionVisible && (!this.readOnly || hasCaption)) {
      wrap.appendChild(renderCaptionRow({
        value: this.data.caption ?? '',
        placeholder: this.config.captionPlaceholder
          ?? this.api.i18n.t('tools.file.captionPlaceholder'),
        readOnly: this.readOnly,
        onChange: (next) => {
          if (next !== this.data.caption) {
            this.data = { ...this.data, caption: next };
            this.block.dispatchChange();
          }
        },
      }));
    }
    return wrap;
  }
}
