import type { FileConfig, FileUploadResult } from '../../../types/tools/file';
import { FileToolError } from './errors';

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

export class Uploader {
  constructor(private readonly config: FileConfig) {}

  public async handleFile(file: File, options: UploadOptions = {}): Promise<FileUploadResult> {
    this.validateFile(file);
    if (this.config.uploader?.uploadByFile) {
      return this.config.uploader.uploadByFile(file, { onProgress: options.onProgress });
    }

    return {
      url: URL.createObjectURL(file),
      fileName: file.name,
      size: file.size,
      mimeType: file.type || undefined,
    };
  }

  public async handleUrl(raw: string, options: UploadOptions = {}): Promise<FileUploadResult> {
    this.validateUrl(raw);
    if (this.config.uploader?.uploadByUrl) {
      return this.config.uploader.uploadByUrl(raw, { onProgress: options.onProgress });
    }

    return { url: raw };
  }

  private validateUrl(raw: string): void {
    const parsed = parseUrl(raw);

    if (!parsed) {
      throw new FileToolError('INVALID_URL', raw);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new FileToolError('INVALID_URL', parsed.protocol);
    }
  }

  private validateFile(file: File): void {
    const { types, maxSize } = this.config;

    if (types !== undefined && !types.includes(file.type)) {
      throw new FileToolError('UNSUPPORTED_TYPE', file.type || 'unknown');
    }
    if (maxSize !== undefined && file.size > maxSize) {
      throw new FileToolError('FILE_TOO_LARGE', `${file.size} > ${maxSize}`);
    }
  }
}
