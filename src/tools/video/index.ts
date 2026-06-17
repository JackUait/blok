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
import type { VideoAlignment, VideoConfig, VideoData } from '../../../types/tools/video';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconCaption,
  IconCopy,
  IconDownload,
  IconReplace,
  IconVideo,
} from '../../components/icons';
import { attachResizeHandle, type ResizeEdge } from '../image/resizer';
import { renderUploadingState, type UploadingStateElement } from '../image/uploading-state';
import { DEFAULT_CAPTION_PLACEHOLDER, URL_PATTERN } from './constants';
import { renderEmptyState, type EmptyStateElement } from './empty-state';
import { tr } from './i18n';
import { renderCaptionRow, renderVideo } from './ui';
import { attachControls, type ControlsHandle } from './controls';
import { Uploader, type UploadResult } from './uploader';

type ToolState = 'EMPTY' | 'LOADING' | 'RENDERED' | 'ERROR';

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
  private lastSource: { kind: 'file'; file: File } | { kind: 'url'; url: string } | null = null;
  private resizeDetach: (() => void)[] = [];
  private controlsHandle: ControlsHandle | null = null;
  // Ephemeral theater (cinema-width) state — presentation only, never saved.
  private theater = false;

  constructor(options: BlockToolConstructorOptions<VideoData, VideoConfig>) {
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
    root.setAttribute('data-blok-tool', 'video');
    this.root = root;
    this.renderState();
    return root;
  }

  public save(_block?: HTMLElement): VideoData {
    const out: VideoData = { url: this.data.url };
    if (this.data.caption !== undefined) out.caption = this.data.caption;
    if (this.data.captionVisible !== undefined) out.captionVisible = this.data.captionVisible;
    if (this.data.width !== undefined) out.width = this.data.width;
    if (this.data.alignment !== undefined) out.alignment = this.data.alignment;
    if (this.data.fileName !== undefined) out.fileName = this.data.fileName;
    if (this.data.mimeType !== undefined) out.mimeType = this.data.mimeType;
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
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      patterns: { video: URL_PATTERN },
      files: { mimeTypes: ['video/*'] },
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
    this.detachResize();
    this.controlsHandle?.destroy();
    this.controlsHandle = null;
    if (this.data.url.startsWith('blob:')) {
      URL.revokeObjectURL(this.data.url);
    }
  }

  private startUpload(file: File): void {
    this.lastFileName = file.name;
    this.lastSource = { kind: 'file', file };
    this.state = 'LOADING';
    this.renderState();
    void this.uploader
      .handleFile(file, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyResult(result, file.type))
      .catch(() => this.applyError());
  }

  private startUrl(url: string): void {
    this.lastFileName = null;
    this.lastSource = { kind: 'url', url };
    this.state = 'LOADING';
    this.renderState();
    void this.uploader
      .handleUrl(url, { onProgress: (p) => this.uploadingEl?.setProgress(p) })
      .then((result) => this.applyResult(result))
      .catch(() => this.applyError());
  }

  private applyResult(result: UploadResult, mimeType?: string): void {
    this.data = {
      ...this.data,
      url: result.url,
      fileName: result.fileName ?? this.lastFileName ?? this.data.fileName,
      mimeType: mimeType || this.data.mimeType,
    };
    this.state = 'RENDERED';
    this.renderState();
    this.block.dispatchChange();
  }

  private applyError(): void {
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
  }

  private renderEmpty(): void {
    if (!this.root) return;
    const el: EmptyStateElement = renderEmptyState({
      onFile: (file) => this.startUpload(file),
      onUrl: (url) => this.startUrl(url),
      acceptTypes: this.config.types,
      maxSize: this.config.maxSize,
      i18n: this.api.i18n,
    });
    this.root.appendChild(el);
  }

  private renderLoading(): void {
    if (!this.root) return;
    this.uploadingEl = renderUploadingState({
      fileName: this.lastFileName ?? tr(this.api.i18n, 'tools.video.uploading', 'Uploading…'),
      onCancel: () => this.transitionToEmpty(),
      i18n: this.api.i18n,
    });
    this.root.appendChild(this.uploadingEl);
  }

  private renderError(): void {
    if (!this.root) return;
    const wrap = document.createElement('div');
    wrap.className = 'blok-video-error-state';
    wrap.setAttribute('data-role', 'video-error');

    const message = document.createElement('span');
    message.textContent = tr(this.api.i18n, 'tools.video.errorUploadFailed', 'Upload failed');

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'blok-video-retry';
    retry.setAttribute('data-action', 'replace');
    retry.textContent = tr(this.api.i18n, 'tools.video.errorReplace', 'Replace');
    retry.addEventListener('click', () => this.transitionToEmpty());

    wrap.append(message, retry);
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
      this.controlsHandle = attachControls({ video, figure });
      media.appendChild(this.controlsHandle.element);
    }

    // Theater is an ephemeral view mode: observe the player's toggle to keep our
    // copy, and re-apply it after a re-render so alignment/caption changes don't
    // eject the viewer. Never written to save() — presentation, not content.
    figure.addEventListener('blok-video-theater', (event) => {
      this.theater = (event as CustomEvent<{ on: boolean }>).detail.on;
    });
    if (this.theater) figure.setAttribute('data-theater', 'true');

    const placeholder = this.config.captionPlaceholder ?? DEFAULT_CAPTION_PLACEHOLDER;
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
}
