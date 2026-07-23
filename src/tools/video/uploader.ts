import type { VideoConfig } from '../../../types/tools/video';
import { resolveMaxSize } from '../../components/utils/max-size';
import { matchesMime } from '../../components/utils/mime-match';
import { DEFAULT_MAX_SIZE, DEFAULT_MIME_TYPES, URL_PATTERN } from './constants';

export interface UploadResult {
  url: string;
  fileName?: string;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
}

export class VideoUploadError extends Error {
  public readonly detail?: string;

  constructor(public readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'VideoUploadError';
    this.detail = detail;
  }
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export class Uploader {
  constructor(private readonly config: VideoConfig) {}

  public async handleUrl(raw: string, options: UploadOptions = {}): Promise<UploadResult> {
    this.validateUrl(raw);
    if (this.config.uploader?.uploadByUrl) {
      return this.config.uploader.uploadByUrl(raw, { onProgress: options.onProgress });
    }

    return { url: raw };
  }

  public async handleFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
    this.validateFile(file);
    if (this.config.uploader?.uploadByFile) {
      return this.config.uploader.uploadByFile(file, { onProgress: options.onProgress });
    }

    return { url: URL.createObjectURL(file), fileName: file.name };
  }

  private validateUrl(raw: string): void {
    const parsed = parseUrl(raw);

    if (!parsed) {
      throw new VideoUploadError('INVALID_URL', raw);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new VideoUploadError('INVALID_URL', parsed.protocol);
    }
    // Without `uploadByUrl` the raw string becomes the `<video src>` verbatim, so
    // it has to be a file the browser can decode. A provider watch page (VK,
    // YouTube, …) would otherwise render a permanently black player — those
    // belong in an embed block. The paste path already enforces this pattern;
    // the URL field used to accept anything http(s).
    if (!this.config.uploader?.uploadByUrl && !URL_PATTERN.test(raw)) {
      throw new VideoUploadError('NOT_MEDIA_URL', raw);
    }
  }

  private validateFile(file: File): void {
    const types = this.config.types ?? [...DEFAULT_MIME_TYPES];
    const maxSize = resolveMaxSize(this.config.maxSize, file.type, DEFAULT_MAX_SIZE);

    if (file.type && !matchesMime(file.type, types)) {
      throw new VideoUploadError('UNSUPPORTED_TYPE', file.type);
    }
    if (file.size > maxSize) {
      throw new VideoUploadError('FILE_TOO_LARGE', `${file.size} > ${maxSize}`);
    }
  }
}
