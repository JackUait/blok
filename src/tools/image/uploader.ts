import type { ImageConfig } from '../../../types/tools/image';
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
}
