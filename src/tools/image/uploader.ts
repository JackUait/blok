import type { ImageConfig } from '../../../types/tools/image';
import { DEFAULT_MAX_SIZE, DEFAULT_MIME_TYPES } from './constants';
import { ImageError } from './errors';

export interface UploadResult {
  url: string;
  fileName?: string;
}

export class Uploader {
  constructor(private readonly config: ImageConfig) {}

  public async handleUrl(raw: string): Promise<UploadResult> {
    this.validateUrl(raw);
    if (this.config.uploader?.uploadByUrl) {
      return this.config.uploader.uploadByUrl(raw);
    }

    return { url: raw };
  }

  public async handleFile(file: File): Promise<UploadResult> {
    this.validateFile(file);
    if (this.config.uploader?.uploadByFile) {
      return this.config.uploader.uploadByFile(file);
    }

    return { url: URL.createObjectURL(file), fileName: file.name };
  }

  private validateUrl(raw: string): void {
    let parsed: URL;

    try {
      parsed = new URL(raw);
    } catch {
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
