import type {
  API,
  BlockAPI,
  BlockTool,
  BlockToolConstructorOptions,
  FilePasteEvent,
  PasteConfig,
  PasteEvent,
  PatternPasteEvent,
  ToolboxConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { AudioAlignment, AudioConfig, AudioData } from '../../../types/tools/audio';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconCaption,
  IconCopy,
  IconDownload,
  IconImage,
  IconMusic,
  IconPlayerLoop,
  IconReplace,
  IconTrash,
} from '../../components/icons';
import { renderUploadingState, type UploadingStateElement } from '../image/uploading-state';
import { DEFAULT_CAPTION_PLACEHOLDER, URL_PATTERN } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { tr } from './i18n';
import { renderCaptionRow, renderNowPlaying } from './ui';
import { openCoverPicker, validateCoverFile, type CoverPickerHandle } from './cover-picker';
import { attachControls, type ControlsHandle } from './controls';
import { attachWaveform, decodePeaks, type WaveformHandle } from './waveform';
import { readTrackMetadata, resolveCover } from './metadata';
import { Uploader, AudioUploadError, type UploadResult } from './uploader';
import { uploadErrorMessage } from '../../components/utils/upload-error-message';
import { pickDisplayMaxSize } from '../../components/utils/max-size';

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

export class AudioTool implements BlockTool {
  private readonly api: API;
  private readonly block: BlockAPI;
  private readonly config: AudioConfig;
  private readonly uploader: Uploader;
  private data: AudioData;
  private readOnly: boolean;
  private root: HTMLElement | null = null;
  private state: ToolState;
  private uploadingEl: UploadingStateElement | null = null;
  private lastFileName: string | null = null;
  private errorMessage: string | null = null;
  private lastSource: { kind: 'file'; file: File } | { kind: 'url'; url: string } | null = null;
  private controlsHandle: ControlsHandle | null = null;
  private waveformHandle: WaveformHandle | null = null;
  private destroyed = false;
  private coverPicker: CoverPickerHandle | null = null;
  /** Pending fallback timer for the caption collapse-out animation. */
  private captionExitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BlockToolConstructorOptions<AudioData, AudioConfig>) {
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
    root.setAttribute('data-blok-tool', 'audio');
    this.root = root;
    this.renderState();
    return root;
  }

  public save(_block?: HTMLElement): AudioData {
    const out: AudioData = { url: this.data.url };
    if (this.data.caption !== undefined) out.caption = this.data.caption;
    if (this.data.captionVisible !== undefined) out.captionVisible = this.data.captionVisible;
    if (this.data.title !== undefined) out.title = this.data.title;
    if (this.data.artist !== undefined) out.artist = this.data.artist;
    if (this.data.coverUrl !== undefined) out.coverUrl = this.data.coverUrl;
    if (this.data.loop) out.loop = true;
    if (this.data.width !== undefined) out.width = this.data.width;
    if (this.data.alignment !== undefined) out.alignment = this.data.alignment;
    if (this.data.fileName !== undefined) out.fileName = this.data.fileName;
    if (this.data.mimeType !== undefined) out.mimeType = this.data.mimeType;
    if (this.data.duration !== undefined) out.duration = this.data.duration;
    if (this.data.peaks !== undefined) out.peaks = this.data.peaks;
    return out;
  }

  public validate(data: AudioData): boolean {
    return typeof data.url === 'string' && data.url.length > 0;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconMusic,
      titleKey: 'audio',
      searchTerms: ['audio', 'music', 'sound', 'song', 'mp3', 'track', 'media'],
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      patterns: { audio: URL_PATTERN },
      files: { mimeTypes: ['audio/*'] },
    };
  }

  public onPaste(event: PasteEvent): void {
    if (event.type === 'pattern') {
      this.applyResult({ url: (event as PatternPasteEvent).detail.data });
      return;
    }
    if (event.type === 'file') {
      this.startUpload((event as FilePasteEvent).detail.file);
    }
  }

  public getToolbarAnchorElement(): HTMLElement | undefined {
    // Anchor on the top-of-card marker so the +/tunes buttons sit flush with the
    // top of the cover art. Fall back to the figure if the marker isn't present.
    return (
      this.root?.querySelector<HTMLElement>('[data-role="audio-toolbar-anchor"]') ??
      this.root?.querySelector<HTMLElement>('[data-role="audio-figure"]') ??
      undefined
    );
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.renderState();
  }

  public renderSettings(): MenuConfig {
    const i18n = this.api.i18n;
    const current: AudioAlignment = this.data.alignment ?? 'center';
    const captionVisible = this.data.captionVisible !== false;
    const alignments: { value: AudioAlignment; title: string; icon: string }[] = [
      { value: 'left', title: tr(i18n, 'tools.audio.alignmentLeft', 'Align left'), icon: IconAlignLeft },
      { value: 'center', title: tr(i18n, 'tools.audio.alignmentCenter', 'Align center'), icon: IconAlignCenter },
      { value: 'right', title: tr(i18n, 'tools.audio.alignmentRight', 'Align right'), icon: IconAlignRight },
    ];
    const alignIcon = alignments.find((a) => a.value === current)?.icon ?? alignments[1].icon;

    return [
      {
        icon: alignIcon,
        title: tr(i18n, 'tools.audio.alignment', 'Alignment'),
        name: 'audio-alignment',
        children: {
          items: alignments.map((a) => ({
            icon: a.icon,
            title: a.title,
            name: `audio-alignment-${a.value}`,
            isActive: current === a.value,
            closeOnActivate: true,
            onActivate: (): void => this.setAlignment(a.value),
          })),
        },
      },
      {
        icon: IconCaption,
        title: tr(i18n, 'tools.audio.caption', 'Caption'),
        name: 'audio-caption',
        isActive: captionVisible,
        closeOnActivate: true,
        onActivate: (): void => this.toggleCaption(),
      },
      {
        icon: IconPlayerLoop,
        title: tr(i18n, 'tools.audio.loop', 'Loop'),
        name: 'audio-loop',
        isActive: this.data.loop === true,
        closeOnActivate: true,
        onActivate: (): void => this.toggleLoop(),
      },
      {
        icon: IconReplace,
        title: tr(i18n, 'tools.audio.replace', 'Replace audio'),
        name: 'audio-replace',
        closeOnActivate: true,
        onActivate: (): void => this.transitionToEmpty(),
      },
      {
        icon: IconImage,
        title: tr(i18n, 'tools.audio.coverSet', 'Set cover image'),
        name: 'audio-cover-set',
        closeOnActivate: true,
        onActivate: (): void => this.openCoverPicker(),
      },
      ...(this.data.coverUrl
        ? [{
          icon: IconTrash,
          title: tr(i18n, 'tools.audio.coverRemove', 'Remove cover'),
          name: 'audio-cover-remove',
          closeOnActivate: true,
          onActivate: (): void => this.removeCover(),
        }]
        : []),
      {
        icon: IconDownload,
        title: tr(i18n, 'tools.audio.download', 'Download'),
        name: 'audio-download',
        closeOnActivate: true,
        onActivate: (): void => this.download(),
      },
      {
        icon: IconCopy,
        title: tr(i18n, 'tools.audio.copyUrl', 'Copy URL'),
        name: 'audio-copy-url',
        closeOnActivate: true,
        onActivate: (): void => this.copyUrl(),
      },
    ];
  }

  public removed(): void {
    this.destroyed = true;
    if (this.captionExitTimer) { clearTimeout(this.captionExitTimer); this.captionExitTimer = null; }
    this.controlsHandle?.destroy();
    this.controlsHandle = null;
    this.waveformHandle?.destroy();
    this.waveformHandle = null;
    if (this.data.url.startsWith('blob:')) {
      URL.revokeObjectURL(this.data.url);
    }
    if (this.data.coverUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.data.coverUrl);
    }
    this.coverPicker?.close();
    this.coverPicker = null;
  }

  private startUpload(file: File): void {
    this.lastFileName = file.name;
    this.lastSource = { kind: 'file', file };
    this.state = 'LOADING';
    this.renderState();
    void this.uploader
      .handleFile(file, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyResult(result, file))
      .catch((err) => this.applyError(err));
  }

  private startUrl(url: string): void {
    this.lastFileName = null;
    this.lastSource = { kind: 'url', url };
    this.state = 'LOADING';
    this.renderState();
    void this.uploader
      .handleUrl(url, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyResult(result))
      .catch((err) => this.applyError(err));
  }

  private applyResult(result: UploadResult, file?: File): void {
    this.data = {
      ...this.data,
      url: result.url,
      fileName: result.fileName ?? this.lastFileName ?? this.data.fileName,
      mimeType: file?.type || this.data.mimeType,
    };
    this.errorMessage = null;
    this.state = 'RENDERED';
    this.renderState();
    this.block.dispatchChange();

    // Asynchronous enrichment from a real File upload (not URL paste).
    if (file) {
      // Metadata: title, artist, cover
      void readTrackMetadata(file)
        .then(async (meta) => {
          if (this.destroyed) return;
          const dirty = { value: false };
          if (meta.title) { this.data.title = meta.title; dirty.value = true; }
          if (meta.artist) { this.data.artist = meta.artist; dirty.value = true; }
          if (meta.cover) {
            const coverUrl = await resolveCover(meta.cover, this.config.uploader).catch(() => undefined);
            if (coverUrl) { this.data.coverUrl = coverUrl; dirty.value = true; }
          }
          if (this.destroyed) return;
          if (dirty.value) {
            this.renderState();
            this.block.dispatchChange();
          }
        })
        .catch(() => { /* leave player working without metadata */ });

      // Waveform peaks + duration
      void decodePeaks(file)
        .then((decoded) => {
          if (this.destroyed) return;
          if (decoded && decoded.peaks.length) {
            this.data.peaks = decoded.peaks;
            this.data.duration = decoded.duration;
            this.renderState();
            this.block.dispatchChange();
          }
        })
        .catch(() => { /* leave player working without waveform */ });
    }
  }

  private applyError(err?: unknown): void {
    this.errorMessage = err instanceof AudioUploadError
      ? uploadErrorMessage(err, (key) => this.api.i18n.t(key), {
        tooLarge: 'tools.audio.errorFileTooLarge',
        generic: 'tools.audio.errorUploadFailed',
      })
      : null;
    this.state = 'ERROR';
    this.renderState();
  }

  private syncRootAttributes(): void {
    if (!this.root) return;
    const r = this.root;
    r.setAttribute('data-state', this.state.toLowerCase());
    r.setAttribute('data-align', this.data.alignment ?? 'center');
    r.setAttribute('data-caption', this.data.captionVisible === false ? 'off' : 'on');
  }

  private renderState(): void {
    if (!this.root) return;
    if (this.captionExitTimer) { clearTimeout(this.captionExitTimer); this.captionExitTimer = null; }
    this.controlsHandle?.destroy();
    this.controlsHandle = null;
    this.waveformHandle?.destroy();
    this.waveformHandle = null;
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
  }

  private renderEmpty(): void {
    if (!this.root) return;
    const el: EmptyStateElement = renderEmptyState({
      onFile: (file) => this.startUpload(file),
      onUrl: (url) => this.startUrl(url),
      acceptTypes: this.config.types,
      maxSize: pickDisplayMaxSize(this.config.maxSize),
      i18n: this.api.i18n,
    });
    this.root.appendChild(el);
  }

  private renderLoading(): void {
    if (!this.root) return;
    this.uploadingEl = renderUploadingState({
      fileName: this.lastFileName ?? tr(this.api.i18n, 'tools.audio.uploading', 'Uploading…'),
      onCancel: () => this.transitionToEmpty(),
      i18n: this.api.i18n,
    });
    this.root.appendChild(this.uploadingEl);
  }

  private renderError(): void {
    if (!this.root) return;
    const wrap = document.createElement('div');
    wrap.className = 'blok-audio-error-state';
    wrap.setAttribute('data-role', 'audio-error');

    const message = document.createElement('span');
    message.textContent = this.errorMessage ?? tr(this.api.i18n, 'tools.audio.errorUploadFailed', 'Upload failed');

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'blok-audio-retry';
    retry.setAttribute('data-action', 'replace');
    retry.textContent = tr(this.api.i18n, 'tools.audio.errorReplace', 'Replace');
    retry.addEventListener('click', () => this.transitionToEmpty());

    wrap.append(message, retry);
    this.root.appendChild(wrap);
  }

  private renderRendered(): void {
    if (!this.root) return;
    const titlePlaceholder = tr(this.api.i18n, 'tools.audio.titlePlaceholder', 'Track title');
    const artistPlaceholder = tr(this.api.i18n, 'tools.audio.artistPlaceholder', 'Artist');

    const { figure, audio, waveformMount, title, artist, body, coverButton } = renderNowPlaying(this.data, {
      editable: !this.readOnly,
      titlePlaceholder,
      artistPlaceholder,
      coverChangeLabel: tr(this.api.i18n, 'tools.audio.coverChange', 'Change cover'),
    });

    // Waveform (if peaks are available)
    if (this.data.peaks?.length) {
      this.waveformHandle = attachWaveform({ mount: waveformMount, media: audio, peaks: this.data.peaks });
    }

    // Transport controls — appended into the right-column body (under waveform)
    this.controlsHandle = attachControls({
      media: audio,
      figure,
      data: this.data,
      onLoopChange: (loop) => {
        this.data.loop = loop || undefined;
        this.block.dispatchChange();
      },
    });
    body.appendChild(this.controlsHandle.element);

    // Caption row — outside body, below the card
    const captionVisible = this.data.captionVisible !== false;
    if (captionVisible) {
      figure.appendChild(this.createCaptionRow());
    }

    // Wire title/artist blur handlers
    title.addEventListener('blur', () => {
      const next = title.textContent ?? '';
      if (next !== this.data.title) {
        this.data.title = next || undefined;
        this.block.dispatchChange();
      }
    });
    artist.addEventListener('blur', () => {
      const next = artist.textContent ?? '';
      if (next !== this.data.artist) {
        this.data.artist = next || undefined;
        this.block.dispatchChange();
      }
    });

    coverButton?.addEventListener('click', () => this.openCoverPicker());

    this.root.appendChild(figure);
  }

  /** Build a caption row (with its blur handler wired) ready to mount. */
  private createCaptionRow(): HTMLElement {
    const placeholder = this.config.captionPlaceholder ?? DEFAULT_CAPTION_PLACEHOLDER;
    const row = renderCaptionRow({
      value: this.data.caption ?? '',
      placeholder,
      editable: !this.readOnly,
    });
    const captionEl = row.querySelector<HTMLElement>('[data-role="audio-caption"]');
    captionEl?.addEventListener('blur', () => {
      const next = captionEl.textContent ?? '';
      if (next !== this.data.caption) {
        this.data.caption = next || undefined;
        this.block.dispatchChange();
      }
    });
    return row;
  }

  private prefersReducedMotion(): boolean {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private setAlignment(next: AudioAlignment): void {
    if (this.data.alignment === next) return;
    this.data.alignment = next;
    this.block.dispatchChange();
    this.renderState();
  }

  private toggleCaption(): void {
    const enabling = this.data.captionVisible === false;
    this.data.captionVisible = enabling;
    // Removing the caption clears its text too, so re-enabling starts fresh
    // rather than resurrecting the old text.
    if (!enabling) this.data.caption = undefined;
    this.block.dispatchChange();

    const figure = this.root?.querySelector<HTMLElement>('[data-role="audio-figure"]');
    // No live card to animate (or motion is off) — fall back to an instant
    // re-render so the caption snaps in/out.
    if (!figure || this.prefersReducedMotion()) {
      this.renderState();
      return;
    }
    this.syncRootAttributes();
    if (enabling) this.animateCaptionIn(figure);
    else this.animateCaptionOut(figure);
  }

  private animateCaptionIn(figure: HTMLElement): void {
    const existing = figure.querySelector<HTMLElement>('[data-role="audio-caption-row"]');
    if (existing) {
      // A collapse-out was mid-flight — cancel it and re-open in place.
      if (this.captionExitTimer) { clearTimeout(this.captionExitTimer); this.captionExitTimer = null; }
      existing.classList.remove('is-collapsed');
      return;
    }
    const row = this.createCaptionRow();
    // Appended at full height immediately (a single layout step); is-collapsed
    // only offsets/fades the inner, so the reveal animates on the compositor.
    row.classList.add('is-collapsed');
    figure.appendChild(row);
    // Commit the collapsed start frame, then settle the inner into place.
    void row.offsetHeight;
    row.classList.remove('is-collapsed');
  }

  private animateCaptionOut(figure: HTMLElement): void {
    const row = figure.querySelector<HTMLElement>('[data-role="audio-caption-row"]');
    if (!row) return;
    row.classList.add('is-collapsed');
    const finish = (): void => {
      if (this.captionExitTimer) { clearTimeout(this.captionExitTimer); this.captionExitTimer = null; }
      row.removeEventListener('transitionend', onEnd);
      row.remove();
    };
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName === 'opacity') finish();
    };
    row.addEventListener('transitionend', onEnd);
    // Fallback in case transitionend never fires (display:none, interrupted, etc.).
    this.captionExitTimer = setTimeout(finish, 360);
  }

  private toggleLoop(): void {
    this.data.loop = this.data.loop !== true ? true : undefined;
    this.block.dispatchChange();
    this.renderState();
  }

  private transitionToEmpty(): void {
    this.data = { ...this.data, url: '' };
    this.state = 'EMPTY';
    this.lastSource = null;
    this.lastFileName = null;
    this.renderState();
    this.block.dispatchChange();
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

  private openCoverPicker(): void {
    if (this.readOnly) return;
    const anchor = this.root?.querySelector<HTMLElement>('[data-role="audio-cover"]');
    if (!anchor) return;
    this.coverPicker?.close();
    this.coverPicker = openCoverPicker({
      anchor,
      i18n: this.api.i18n,
      onFile: (file) => this.applyCoverFile(file),
      onUrl: (url) => this.applyCoverUrl(url),
      onClose: () => { this.coverPicker = null; },
    });
  }

  private applyCoverFile(file: File): void {
    const error = validateCoverFile(file, this.api.i18n);
    if (error) {
      this.coverPicker?.setError(error);
      return;
    }
    const uploader = this.config.uploader;
    const upload = uploader?.uploadByFile
      ? uploader.uploadByFile(file).then((res) => res.url)
      : Promise.resolve(URL.createObjectURL(file));
    void upload
      .then((url) => {
        if (this.destroyed) return;
        this.setCover(url);
        this.coverPicker?.close();
      })
      .catch(() => {
        this.coverPicker?.setError(
          tr(this.api.i18n, 'tools.audio.errorUploadFailed', 'Upload failed')
        );
      });
  }

  private applyCoverUrl(url: string): void {
    this.setCover(url);
    this.coverPicker?.close();
  }

  private setCover(url: string): void {
    const prev = this.data.coverUrl;
    if (prev && prev !== url && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
    this.data.coverUrl = url;
    this.renderState();
    this.block.dispatchChange();
  }

  private removeCover(): void {
    const prev = this.data.coverUrl;
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    this.data.coverUrl = undefined;
    this.renderState();
    this.block.dispatchChange();
  }
}
