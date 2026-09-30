import type {
  API,
  AssetKind,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  FilePasteEvent,
  PasteConfig,
  PasteEvent,
  PatternPasteEvent,
  ToolboxConfig,
  SanitizerConfig,
} from '../../../types';
import { PLAINTEXT } from '../../components/utils/sanitizer';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { VideoAlignment, VideoConfig, VideoData } from '../../../types/tools/video';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconCaption,
  IconCopy,
  IconDownload,
  IconPlayerLoop,
  IconPlayerPlay,
  IconPlayerSettings,
  IconReplace,
  IconVideo,
} from '../../components/icons';
import { attachResizeHandle, type ResizeEdge } from '../image/resizer';
import { renderUploadingState, type UploadingStateElement } from '../image/uploading-state';
import { DEFAULT_CAPTION_PLACEHOLDER, MIN_WIDTH_PX, URL_PATTERN } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { tr } from './i18n';
import { deliverToRebuiltBlock, isStillInDocument, putBackOnRebuiltBlock, releaseObjectUrl } from '../image/detached-upload';
import { readVariants } from '../../shared/read-variants';
import type { ConvertedMedia, MediaConfig, VideoFormat } from '../../../types/configs/media';
import { enqueueMediaJob } from '../../components/media-variants/media-queue';
import { convertVideoInBackground, videoFormatOf } from '../../components/media-variants/video-background';
import { produceVideoVariant } from '../../components/media-variants/video-variants';
import { renderCaptionRow, renderVideo } from './ui';
import { attachControls, type ControlsHandle } from './controls';
import { Uploader, VideoUploadError, type UploadResult } from './uploader';
import { uploadErrorMessage } from '../../components/utils/upload-error-message';
import { resolveUploadError } from '../../components/utils/media-upload-error';
import { pickDisplayMaxSize } from '../../components/utils/max-size';
import { safeDownloadHref } from '../../components/utils/sanitize-url';
import { renderVideoPreview } from './preview';

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

/** Longer videos are only remuxed: a long re-encode can hold the CPU for minutes. */
const DEFAULT_MAX_TRANSCODE_SECONDS = 600;
/** A conversion with no progress this long is treated as hung and cancelled. */
const CONVERSION_IDLE_MS = 10 * 60_000;

export class VideoTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: VideoConfig;
  private readonly uploader: Uploader;
  private data: VideoData;
  private readOnly: boolean;
  private root: HTMLElement | null = null;
  private state: ToolState;
  private uploadingEl: UploadingStateElement | null = null;
  private lastFileName: string | null = null;
  private errorMessage: string | null = null;
  private lastSource: { kind: 'file'; file: File } | { kind: 'url'; url: string } | null = null;
  private resizeDetach: (() => void)[] = [];
  private controlsHandle: ControlsHandle | null = null;
  // Ephemeral theater (cinema-width) state — presentation only, never saved.
  private theater = false;
  /** Set by `removed()`: this instance is no longer the document's block. */
  private detached = false;
  /** Background conversion progress, or null when none runs. */
  private converting: number | null = null;
  private convertingEl: HTMLElement | null = null;
  /** Aborts the running background conversion. */
  private conversion: AbortController | null = null;

  constructor(options: BlockToolConstructorOptions<VideoData, VideoConfig>) {
    this.api = options.api;
    this.block = options.block;
    this.config = options.config ?? {};
    this.readOnly = options.readOnly;
    this.data = { ...options.data, url: options.data?.url ?? '', variants: readVariants(options.data?.variants) };
    this.state = this.data.url ? 'RENDERED' : 'EMPTY';
    this.uploader = new Uploader(this.config, this.api.uploader);
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    root.setAttribute('data-blok-tool', 'video');
    this.root = root;
    this.renderState();
    return root;
  }

  public save(_block?: HTMLElement): VideoData {
    const out: VideoData = { url: this.data.url };
    // Collab keeps `caption` as a Y.Text for character-level merging. A
    // non-string here would fall through to a whole-key set that replaces that
    // Y.Text for good, so an out-of-contract value is dropped, not coerced.
    if (typeof this.data.caption === 'string') out.caption = this.data.caption;
    if (this.data.captionVisible !== undefined) out.captionVisible = this.data.captionVisible;
    if (this.data.width !== undefined) out.width = this.data.width;
    if (this.data.alignment !== undefined) out.alignment = this.data.alignment;
    if (this.data.autoplay) out.autoplay = true;
    if (this.data.loop) out.loop = true;
    if (this.data.hideControls) out.hideControls = true;
    if (this.data.fileName !== undefined) out.fileName = this.data.fileName;
    if (this.data.mimeType !== undefined) out.mimeType = this.data.mimeType;
    const variants = readVariants(this.data.variants, this.data.url);
    if (variants !== undefined) out.variants = variants;
    if (this.data.aspectRatio !== undefined) out.aspectRatio = this.data.aspectRatio;
    return out;
  }

  public validate(data: VideoData): boolean {
    return typeof data.url === 'string' && data.url.length > 0;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconVideo,
      titleKey: 'video',
      searchTerms: ['video', 'movie', 'clip', 'player', 'mp4', 'media'],
      section: 'media',
      preview: { render: renderVideoPreview, descriptionKey: 'toolbox.preview.video' },
    };
  }

  /**
   * Plain text and bare URLs: an HTML parse would cut text at `<` and turn `&` into `&amp;`.
   */
  public static get sanitize(): SanitizerConfig {
    return {
      url: PLAINTEXT,
      caption: PLAINTEXT,
      fileName: PLAINTEXT,
      mimeType: PLAINTEXT,
      aspectRatio: PLAINTEXT,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get frameRadius(): string {
    return 'var(--blok-radius-block)';
  }

  public static get assetKind(): AssetKind {
    return 'video';
  }

  public static get pasteConfig(): PasteConfig {
    return {
      patterns: { video: URL_PATTERN },
      files: { mimeTypes: ['video/*'] },
    };
  }

  public onPaste(event: PasteEvent): void {
    const sources = this.config.sources;
    if (event.type === 'pattern') {
      if (sources === 'upload') return;
      this.applyResult({ url: (event as PatternPasteEvent).detail.data });
      return;
    }
    if (event.type === 'file') {
      if (sources === 'url') return;
      this.startUpload((event as FilePasteEvent).detail.file);
    }
  }

  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this.root?.querySelector<HTMLElement>('[data-role="video-figure"]') ?? undefined;
  }

  public getContentOffset(_hoveredElement: Element): { left: number } | undefined {
    const root = this.root;
    const figure = root?.querySelector<HTMLElement>('[data-role="video-figure"]');
    if (!root || !figure) return undefined;
    const delta = figure.getBoundingClientRect().left - root.getBoundingClientRect().left;
    return delta > 0 ? { left: delta } : undefined;
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.renderState();
  }

  public renderSettings(): MenuConfig {
    const i18n = this.api.i18n;
    const current: VideoAlignment = this.data.alignment ?? 'center';
    const captionVisible = this.data.captionVisible !== false;
    const alignments: { value: VideoAlignment; title: string; icon: string }[] = [
      { value: 'left', title: tr(i18n, 'tools.video.alignmentLeft', 'Align left'), icon: IconAlignLeft },
      { value: 'center', title: tr(i18n, 'tools.video.alignmentCenter', 'Align center'), icon: IconAlignCenter },
      { value: 'right', title: tr(i18n, 'tools.video.alignmentRight', 'Align right'), icon: IconAlignRight },
    ];
    const alignIcon = alignments.find((a) => a.value === current)?.icon ?? alignments[1].icon;

    return [
      {
        icon: alignIcon,
        title: tr(i18n, 'tools.video.alignment', 'Alignment'),
        name: 'video-alignment',
        children: {
          items: alignments.map((a) => ({
            icon: a.icon,
            title: a.title,
            name: `video-alignment-${a.value}`,
            isActive: current === a.value,
            closeOnActivate: true,
            onActivate: (): void => this.setAlignment(a.value),
          })),
        },
      },
      {
        icon: IconCaption,
        title: tr(i18n, 'tools.video.caption', 'Caption'),
        name: 'video-caption',
        isActive: captionVisible,
        closeOnActivate: true,
        onActivate: (): void => this.toggleCaption(),
      },
      {
        icon: IconPlayerPlay,
        title: tr(i18n, 'tools.video.autoplay', 'Autoplay'),
        name: 'video-autoplay',
        isActive: this.data.autoplay === true,
        closeOnActivate: true,
        onActivate: (): void => this.toggleAutoplay(),
      },
      {
        icon: IconPlayerLoop,
        title: tr(i18n, 'tools.video.loop', 'Loop'),
        name: 'video-loop',
        isActive: this.data.loop === true,
        closeOnActivate: true,
        onActivate: (): void => this.toggleLoop(),
      },
      {
        icon: IconPlayerSettings,
        title: tr(i18n, 'tools.video.hideControls', 'Hide controls'),
        name: 'video-hide-controls',
        isActive: this.data.hideControls === true,
        closeOnActivate: true,
        onActivate: (): void => this.toggleHideControls(),
      },
      {
        icon: IconReplace,
        title: tr(i18n, 'tools.video.replace', 'Replace video'),
        name: 'video-replace',
        closeOnActivate: true,
        onActivate: (): void => this.transitionToEmpty(),
      },
      {
        icon: IconDownload,
        title: tr(i18n, 'tools.video.download', 'Download'),
        name: 'video-download',
        // A stored URL with a non-downloadable scheme (javascript:, data:text/html)
        // has nothing to download — the item stays visible but inert.
        isDisabled: safeDownloadHref(this.data.url) === null,
        closeOnActivate: true,
        onActivate: (): void => this.download(),
      },
      {
        icon: IconCopy,
        title: tr(i18n, 'tools.video.copyUrl', 'Copy URL'),
        name: 'video-copy-url',
        closeOnActivate: true,
        onActivate: (): void => this.copyUrl(),
      },
    ];
  }

  public removed(): void {
    this.cancelConversionIfGone();
    this.detached = true;
    this.detachResize();
    this.controlsHandle?.destroy();
    this.controlsHandle = null;
    releaseObjectUrl(this.api, this.block.id, this.data.url);
  }

  /**
   * Blok calls this on every removal, rebuilds included, and alone when the
   * editor is destroyed.
   */
  public destroy(): void {
    this.cancelConversionIfGone();
  }

  /**
   * A rebuilt block (undo, collab replay) still wants its formats; a deleted
   * block or a destroyed editor does not. Checked once the removal settles.
   */
  private cancelConversionIfGone(): void {
    const conversion = this.conversion;

    if (conversion === null) return;
    queueMicrotask(() => {
      if (!isStillInDocument(this.api, this.block.id)) conversion.abort();
    });
  }

  private startUpload(file: File): void {
    const source = { kind: 'file', file } as const;

    this.lastFileName = file.name;
    this.lastSource = source;
    this.state = 'LOADING';
    this.renderState();
    // Choosing the file is the edit, so the upload's result can join its undo step.
    const before = this.data.fileName;

    this.data = { ...this.data, fileName: file.name };
    this.block.dispatchChange();
    const fromUrl = this.data.url;

    void this.uploader
      .handleFile(file, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyUpload(result, source, fromUrl))
      .catch((err) => this.applyPickError(err, source, before));
  }

  /**
   * A failed upload of a file the user picked. The file name is put back to
   * `before` as derived data, so the pick nets to nothing and leaves no undo step.
   * @param err - why the upload failed
   * @param source - the job, still `lastSource` unless cancelled or replaced
   * @param before - `data.fileName` before the file was picked
   */
  private applyPickError(err: unknown, source: { kind: 'file'; file: File }, before: string | undefined): void {
    if (this.detached) {
      putBackOnRebuiltBlock(this.api, this.block, { fileName: before }, { fileName: source.file.name }, ['fileName']);

      return;
    }
    this.applyError(err, { file: source.file });
    if (this.lastSource !== source || this.data.fileName !== source.file.name) return;
    this.data = { ...this.data, fileName: before };
    this.block.dispatchChange({ derived: true, from: ['fileName'] });
  }

  private startUrl(url: string): void {
    const source = { kind: 'url', url } as const;
    const before = this.data.url;
    const variantsBefore = this.data.variants;

    this.lastFileName = null;
    this.lastSource = source;
    this.state = 'LOADING';
    this.renderState();
    // Entering the link is the edit, so what the upload produces can join its undo step.
    this.data = { ...this.data, url, variants: undefined };
    this.block.dispatchChange();
    void this.uploader
      .handleUrl(url, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyUrlUpload(result, source))
      .catch((err) => this.applyUrlError(err, source, before, variantsBefore));
  }

  /**
   * A failed upload of a link the user entered. The link is put back to
   * `before` as derived data, so its edit nets to nothing and leaves no undo step.
   * @param err - why the upload failed
   * @param source - the job, still `lastSource` unless cancelled or replaced
   * @param before - `data.url` before the link was entered
   * @param variantsBefore - `data.variants` before the link was entered
   */
  private applyUrlError(err: unknown, source: { kind: 'url'; url: string }, before: string, variantsBefore: VideoData['variants']): void {
    if (this.detached) {
      putBackOnRebuiltBlock(this.api, this.block, { url: before, variants: variantsBefore }, { url: source.url }, ['url']);

      return;
    }
    this.applyError(err, { url: source.url });
    if (this.lastSource !== source || this.data.url !== source.url) return;
    this.data = { ...this.data, url: before, variants: variantsBefore };
    this.block.dispatchChange({ derived: true, from: ['url'] });
  }

  private applyResult(result: UploadResult): void {
    if (this.detached) {
      deliverToRebuiltBlock(this.api, this.block, 'Video', this.resultDelta(result));

      return;
    }
    this.showResult(result);
    this.block.dispatchChange();
  }

  /**
   * A finished upload of a link the user entered. It lands only while the
   * block still shows that link, and as derived data: the edit was the link.
   * @param result - what the uploader returned
   * @param source - the job, still `lastSource` unless cancelled or replaced
   */
  private applyUrlUpload(result: UploadResult, source: { kind: 'url'; url: string }): void {
    if (this.detached) {
      deliverToRebuiltBlock(this.api, this.block, 'Video', this.resultDelta(result), { url: source.url }, ['url']);

      return;
    }
    if (this.lastSource !== source || this.data.url !== source.url) return;
    this.showResult(result);
    this.block.dispatchChange({ derived: true, from: ['url'] });
  }

  /**
   * A finished file upload. It lands only while the block still shows the
   * pick that started it, and as derived data: the edit was the pick.
   * @param result - what the uploader returned
   * @param source - the job, still `lastSource` unless cancelled or replaced
   * @param fromUrl - `data.url` when the job started
   */
  private applyUpload(result: UploadResult, source: { kind: 'file'; file: File }, fromUrl: string): void {
    const mimeType = source.file.type;

    if (this.detached) {
      deliverToRebuiltBlock(this.api, this.block, 'Video', this.resultDelta(result, mimeType), { url: fromUrl, fileName: source.file.name }, ['fileName']);

      return;
    }
    if (this.lastSource !== source || this.data.url !== fromUrl) return;
    this.showResult(result, mimeType);
    this.block.dispatchChange({ derived: true, from: ['fileName'] });
    this.startVariants(source.file, result.url);
  }

  /**
   * Convert the uploaded original into the host's formats, one job per page at
   * a time. The original already plays; nothing here blocks the user.
   * @param file - the file the user picked
   * @param url - where the original was stored
   */
  private startVariants(file: File, url: string): void {
    const media = this.api.config?.media;
    const formats = media?.formats?.video;

    // Blok does not bundle Mediabunny: without the host's loader only `convert` can help.
    if (media === undefined || formats === undefined || formats.length === 0) return;
    if (media.mediabunny === undefined && media.convert === undefined) return;
    const controller = new AbortController();

    const idle: { timer?: ReturnType<typeof setTimeout> } = {};
    // A hung host hook or upload would hold the page queue and its leave guard forever.
    const stillWorking = (): void => {
      clearTimeout(idle.timer);
      idle.timer = setTimeout(() => controller.abort(), CONVERSION_IDLE_MS);
    };

    this.conversion?.abort();
    this.conversion = controller;
    this.showConverting(0);
    void enqueueMediaJob(() => this.convertVariants(file, url, formats, media, controller.signal, stillWorking), controller.signal)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(idle.timer);
        if (this.conversion !== controller) return;
        this.conversion = null;
        this.showConverting(null);
      });
  }

  private async convertVariants(
    file: File,
    url: string,
    formats: VideoFormat[],
    media: MediaConfig,
    signal: AbortSignal,
    stillWorking: () => void
  ): Promise<void> {
    const progress = (percent: number): void => {
      stillWorking();
      this.showConverting(percent);
    };

    stillWorking();

    const fromHook: unknown = media.convert === undefined
      ? null
      : await media.convert(file, formats, { kind: 'video', signal, onProgress: (f) => progress(Math.round(f * 100)) })
        .catch(() => null);
    // Untyped hosts can return anything; only an array counts as an answer.
    const listed = Array.isArray(fromHook) ? (fromHook as ConvertedMedia[]) : null;
    const load = media.mediabunny;
    const shown = { url };

    await convertVideoInBackground({ file, url }, formats, {
      produce: async (format, onProgress) => {
        if (listed !== null) {
          return listed.find((item) => videoFormatOf(item.mimeType) === format) ?? null;
        }

        return load === undefined
          ? null
          : produceVideoVariant(file, format, { maxTranscodeDuration: media.maxTranscodeDuration ?? DEFAULT_MAX_TRANSCODE_SECONDS, onProgress, load, signal });
      },
      upload: (part, variant) => this.uploader.uploadVariant(part, variant),
      // A rebuilt block is checked by deliverToRebuiltBlock when writing.
      isCurrent: (expected) => !signal.aborted && (this.detached || this.data.url === expected),
      write: (next) => {
        this.writeVariants(shown.url, next);
        shown.url = next.url;
      },
      onProgress: progress,
    });
  }

  /**
   * Derived data: the edit was the upload, so no undo step. The playing
   * `<video>` is left alone; the new sources apply on the next render.
   * @param expected - the url the block should still hold
   * @param next - the new url and variants
   */
  private writeVariants(expected: string, next: { url: string; variants?: VideoData['variants'] }): void {
    const delta: Partial<VideoData> = { url: next.url, variants: next.variants };

    // Only an MP4 ever replaces the original as url.
    if (next.url !== expected) {
      delta.mimeType = 'video/mp4';
      if (this.data.fileName !== undefined) delta.fileName = this.data.fileName.replace(/(\.[^./]*)?$/, '.mp4');
    }
    if (this.detached) {
      deliverToRebuiltBlock(this.api, this.block, 'Video', delta, { url: expected }, ['url']);

      return;
    }
    if (this.data.url !== expected) return;
    this.data = { ...this.data, ...delta };
    this.block.dispatchChange({ derived: true, from: ['url'] });
  }

  /**
   * @param percent - progress 0–100, or null to remove the status
   */
  private showConverting(percent: number | null): void {
    this.converting = percent;
    if (percent === null) {
      this.convertingEl?.remove();
      this.convertingEl = null;

      return;
    }

    const media = this.root?.querySelector<HTMLElement>('[data-role="video-media"]');

    if (!media) return;
    if (this.convertingEl === null || !media.contains(this.convertingEl)) {
      const el = document.createElement('div');

      el.className = 'blok-video-converting';
      el.setAttribute('data-blok-testid', 'video-converting');
      el.setAttribute('role', 'status');
      media.appendChild(el);
      this.convertingEl = el;
    }
    this.convertingEl.textContent = `${this.api.i18n.t('tools.image.converting')} ${percent}%`;
  }

  private resultDelta(result: UploadResult, mimeType?: string): Partial<VideoData> {
    // Always set, so a new file clears the previous video's variants.
    const delta: Partial<VideoData> = { url: result.url, variants: undefined };
    const fileName = result.fileName ?? this.lastFileName;

    if (fileName !== null && fileName !== undefined) delta.fileName = fileName;
    if (mimeType) delta.mimeType = mimeType;

    return delta;
  }

  private showResult(result: UploadResult, mimeType?: string): void {
    this.data = {
      ...this.data,
      url: result.url,
      variants: undefined,
      fileName: result.fileName ?? this.lastFileName ?? this.data.fileName,
      mimeType: mimeType || this.data.mimeType,
    };
    this.errorMessage = null;
    this.state = 'RENDERED';
    this.renderState();
  }

  private applyError(err: unknown, source: { file?: File; url?: string }): void {
    const own = err instanceof VideoUploadError ? err : null;
    const outcome = resolveUploadError({
      tool: 'video',
      error: own,
      cause: err,
      message: this.uploadErrorText(own),
      source,
      onUploadError: this.config.onUploadError,
    });

    this.errorMessage = outcome.kind === 'message' ? outcome.message : null;
    this.state = outcome.kind === 'message' ? 'ERROR' : 'EMPTY';
    this.renderState();
  }

  private uploadErrorText(err: VideoUploadError | null): string {
    // A rejected URL is not an upload failure — the generic "Upload failed" copy
    // would hide the one thing the author needs to know: the link is not a file.
    if (err?.code === 'NOT_MEDIA_URL') {
      return tr(
        this.api.i18n,
        'tools.video.errorNotMediaUrl',
        'Link a video file (.mp4, .webm, .mov), or use an embed block',
      );
    }

    return err
      ? uploadErrorMessage(err, (key) => this.api.i18n.t(key), {
        tooLarge: 'tools.video.errorFileTooLarge',
        generic: 'tools.video.errorUploadFailed',
      })
      : tr(this.api.i18n, 'tools.video.errorUploadFailed', 'Upload failed');
  }

  /**
   * The media element rejected `data.url`. The url is deliberately kept — the
   * failure may be transient (offline, expired signed URL) and the block must
   * stay recoverable rather than silently losing its content.
   */
  private applyMediaError(): void {
    this.errorMessage = tr(this.api.i18n, 'tools.video.errorUnplayable', 'This video can\'t be played');
    this.state = 'ERROR';
    this.renderState();
  }

  private detachResize(): void {
    while (this.resizeDetach.length > 0) {
      this.resizeDetach.pop()?.();
    }
  }

  private syncRootAttributes(): void {
    if (!this.root) return;
    const r = this.root;
    r.setAttribute('data-state', this.state.toLowerCase());
    r.setAttribute('data-align', this.data.alignment ?? 'center');
    r.setAttribute('data-caption', this.data.captionVisible === false ? 'off' : 'on');
    r.setAttribute('data-controls', this.data.hideControls === true ? 'off' : 'on');
  }

  private renderState(): void {
    if (!this.root) return;
    this.detachResize();
    this.controlsHandle?.destroy();
    this.controlsHandle = null;
    this.root.replaceChildren();
    this.uploadingEl = null;
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
    if (this.converting !== null) this.showConverting(this.converting);
  }

  private renderEmpty(): void {
    if (!this.root) return;
    const el: EmptyStateElement = renderEmptyState({
      onFile: (file) => this.startUpload(file),
      onUrl: (url) => this.startUrl(url),
      acceptTypes: this.config.types,
      maxSize: pickDisplayMaxSize(this.config.maxSize),
      sources: this.config.sources,
      i18n: this.api.i18n,
    });
    this.root.appendChild(el);
  }

  private renderLoading(): void {
    if (!this.root) return;
    const statusLabel = this.lastFileName === null
      ? tr(this.api.i18n, 'tools.video.uploading', 'Uploading…')
      : undefined;
    this.uploadingEl = renderUploadingState({
      fileName: this.lastFileName,
      onCancel: () => this.transitionToEmpty(),
      preview: 'video',
      i18n: this.api.i18n,
      ...(statusLabel !== undefined ? { statusLabel } : {}),
    });
    this.root.appendChild(this.uploadingEl);
  }

  private renderError(): void {
    if (!this.root) return;
    const wrap = document.createElement('div');
    wrap.className = 'blok-video-error-state';
    wrap.setAttribute('data-role', 'video-error');

    const message = document.createElement('span');
    message.textContent = this.errorMessage ?? tr(this.api.i18n, 'tools.video.errorUploadFailed', 'Upload failed');

    wrap.appendChild(message);

    // Viewers cannot replace the source — offering the button would only dead-end.
    if (!this.readOnly) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'blok-video-retry';
      retry.setAttribute('data-action', 'replace');
      retry.textContent = tr(this.api.i18n, 'tools.video.errorReplace', 'Replace');
      retry.addEventListener('click', () => this.transitionToEmpty());
      wrap.appendChild(retry);
    }
    this.root.appendChild(wrap);
  }

  private renderRendered(): void {
    if (!this.root) return;
    const figure = renderVideo(this.data);
    const media = figure.querySelector<HTMLElement>('[data-role="video-media"]') ?? figure;

    // Custom playback controls replace the native chrome — available to
    // viewers too, so they attach regardless of read-only.
    const video = media.querySelector('video');
    if (video) {
      // A source the browser cannot decode (a provider watch page, a dead link,
      // a 404) otherwise leaves the block in RENDERED forever — a black 16:9 box
      // with 0:00/0:00 chrome and no explanation. Route it to the ERROR state.
      video.addEventListener('error', () => this.applyMediaError(), { once: true });

      // Loop is content — honour it in both modes. Autoplay is a read-only viewer
      // affordance: muted + autoplay + loop turns the block into a gif. Browsers
      // only honour autoplay when muted, so we mute here; editing never autoplays.
      video.loop = this.data.loop === true;
      if (this.readOnly && this.data.autoplay === true) {
        video.muted = true;
        video.setAttribute('muted', '');
        video.setAttribute('autoplay', '');
      }
      // "Hide controls" tune renders a clean, control-free frame — the custom
      // chrome is skipped entirely (native controls were never attached). Loop
      // and autoplay above still apply: they are content/viewer affordances.
      if (this.data.hideControls !== true) {
        this.controlsHandle = attachControls({
          video,
          figure,
          glow: this.config.glow ?? 'minimal',
          loop: this.data.loop === true,
          i18n: this.api.i18n,
        });
        media.appendChild(this.controlsHandle.element);
      }

      // When metadata arrives, update the media wrapper's aspect ratio so it
      // matches the video's intrinsic dimensions.  If the ratio differs from
      // the default 16 : 9 (or a previously stored value) we persist it so
      // subsequent renders skip the layout pop.
      video.addEventListener('loadedmetadata', () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const ratio = `${video.videoWidth} / ${video.videoHeight}`;
          if (ratio !== this.data.aspectRatio) {
            this.data.aspectRatio = ratio;
            media.style.aspectRatio = ratio;
            this.block.dispatchChange({ derived: true, from: ['url'] });
          }
        }
      }, { once: true });
    }

    // Theater is an ephemeral view mode: observe the player's toggle to keep our
    // copy, and re-apply it after a re-render so alignment/caption changes don't
    // eject the viewer. Never written to save() — presentation, not content.
    figure.addEventListener('blok-video-theater', (event) => {
      this.theater = (event as CustomEvent<{ on: boolean }>).detail.on;
    });
    if (this.theater) this.controlsHandle?.setTheater(true);

    const placeholder = this.config.captionPlaceholder
      ?? tr(this.api.i18n, 'tools.video.captionPlaceholder', DEFAULT_CAPTION_PLACEHOLDER);
    const captionVisible = this.data.captionVisible !== false;
    if (captionVisible || !this.readOnly) {
      figure.appendChild(renderCaptionRow({
        value: this.data.caption ?? '',
        placeholder,
        readOnly: this.readOnly,
        onChange: (next) => {
          if (next !== this.data.caption) {
            this.data.caption = next;
            this.block.dispatchChange();
          }
        },
      }));
    }

    this.root.appendChild(figure);

    if (!this.readOnly) {
      this.attachResizeHandles(figure);
    }
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
        minWidthPx: MIN_WIDTH_PX,
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

  private setAlignment(next: VideoAlignment): void {
    if (this.data.alignment === next) return;
    this.data.alignment = next;
    this.block.dispatchChange();
    this.renderState();
  }

  private toggleCaption(): void {
    this.data.captionVisible = this.data.captionVisible === false;
    this.block.dispatchChange();
    this.renderState();
  }

  private toggleAutoplay(): void {
    this.data.autoplay = this.data.autoplay !== true ? true : undefined;
    this.block.dispatchChange();
    this.renderState();
  }

  private toggleLoop(): void {
    this.data.loop = this.data.loop !== true ? true : undefined;
    this.block.dispatchChange();
    this.renderState();
  }

  private toggleHideControls(): void {
    this.data.hideControls = this.data.hideControls !== true ? true : undefined;
    this.block.dispatchChange();
    this.renderState();
  }

  private transitionToEmpty(): void {
    this.data = { ...this.data, url: '', variants: undefined };
    this.state = 'EMPTY';
    this.lastSource = null;
    this.lastFileName = null;
    this.renderState();
    this.block.dispatchChange();
  }

  private download(): void {
    const href = safeDownloadHref(this.data.url);

    if (href === null) {
      return;
    }

    const a = document.createElement('a');
    a.href = href;
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
