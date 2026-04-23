import type { ImageConfig } from '../../../types/tools/image';
import { DEFAULT_MAX_SIZE, DEFAULT_MIME_TYPES } from './constants';
import { ImageError } from './errors';

export interface UploadResult {
  url: string;
  fileName?: string;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

const DATA_IMAGE_PREFIX = /^data:image\//i;

function isImageDataUrl(raw: string): boolean {
  return DATA_IMAGE_PREFIX.test(raw);
}

function dataUrlToFile(dataUrl: string): File {
  const commaIndex = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, commaIndex); // strip "data:"
  const payload = dataUrl.slice(commaIndex + 1);
  const isBase64 = header.endsWith(';base64');
  const mime = isBase64 ? header.slice(0, -7) : header.split(';')[0];
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));

  const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';

  return new File([bytes], `pasted-image.${ext}`, { type: mime });
}

export class Uploader {
  constructor(private readonly config: ImageConfig) {}

  public async handleUrl(raw: string, options: UploadOptions = {}): Promise<UploadResult> {
    if (isImageDataUrl(raw)) {
      return this.handleDataUrl(raw, options);
    }
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

  private async handleDataUrl(raw: string, options: UploadOptions): Promise<UploadResult> {
    if (this.config.uploader?.uploadByUrl) {
      return this.config.uploader.uploadByUrl(raw, { onProgress: options.onProgress });
    }
    if (this.config.uploader?.uploadByFile) {
      return this.handleFile(dataUrlToFile(raw), options);
    }

    return { url: raw };
  }

  private validateUrl(raw: string): void {
    const parsed = parseUrl(raw);

    if (!parsed) {
      throw new ImageError('INVALID_URL', raw);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ImageError('INVALID_URL', parsed.protocol);
    }
  }

  private validateFile(file: File): void {
    const types = this.config.types ?? [...DEFAULT_MIME_TYPES];
    const maxSize = this.config.maxSize ?? DEFAULT_MAX_SIZE;

    if (!types.includes(file.type)) {
      throw new ImageError('UNSUPPORTED_TYPE', file.type || 'unknown');
    }
    if (file.size > maxSize) {
      throw new ImageError('FILE_TOO_LARGE', `${file.size} > ${maxSize}`);
    }
  }
}
