import type { FileConfig, FileUploadResult } from '../../../types/tools/file';
import { resolveMaxSize } from '../../components/utils/max-size';
import { DEFAULT_MAX_SIZE } from './constants';
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

    const endpoint = this.fileEndpoint();
    if (endpoint !== undefined) {
      return this.uploadFileToEndpoint(endpoint, file);
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

    const endpoint = this.urlEndpoint();
    if (endpoint !== undefined) {
      return this.uploadUrlToEndpoint(endpoint, raw);
    }

    return { url: raw };
  }

  /** Resolve the endpoint for file uploads. A string serves both kinds. */
  private fileEndpoint(): string | undefined {
    const { endpoints } = this.config;
    return typeof endpoints === 'string' ? endpoints : endpoints?.byFile;
  }

  /** Resolve the endpoint for URL embeds. A string serves both kinds. */
  private urlEndpoint(): string | undefined {
    const { endpoints } = this.config;
    return typeof endpoints === 'string' ? endpoints : endpoints?.byUrl;
  }

  private async uploadFileToEndpoint(endpoint: string, file: File): Promise<FileUploadResult> {
    const form = new FormData();
    form.append(this.config.field ?? 'file', file);
    // No Content-Type header: the browser sets the multipart boundary itself.
    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      headers: this.config.additionalRequestHeaders,
    });
    return this.parseResponse(response, file.name, file.size, file.type);
  }

  private async uploadUrlToEndpoint(endpoint: string, raw: string): Promise<FileUploadResult> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.additionalRequestHeaders },
      body: JSON.stringify({ url: raw }),
    });
    return this.parseResponse(response);
  }

  private async parseResponse(
    response: Response,
    fallbackName?: string,
    fallbackSize?: number,
    fallbackMime?: string,
  ): Promise<FileUploadResult> {
    if (!response.ok) {
      throw new FileToolError('UPLOAD_FAILED', String(response.status));
    }

    const body: unknown = await response.json().catch(() => null);
    if (body === null || typeof body !== 'object' || typeof (body as { url?: unknown }).url !== 'string') {
      throw new FileToolError('UPLOAD_FAILED', 'malformed response');
    }

    const json = body as Record<string, unknown>;
    const result: FileUploadResult = { url: json.url as string };
    const fileName = typeof json.fileName === 'string' ? json.fileName : fallbackName;
    if (fileName !== undefined) result.fileName = fileName;
    const size = typeof json.size === 'number' ? json.size : fallbackSize;
    if (size !== undefined) result.size = size;
    const mimeType = typeof json.mimeType === 'string' ? json.mimeType : (fallbackMime || undefined);
    if (mimeType !== undefined) result.mimeType = mimeType;
    return result;
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
    const { types } = this.config;
    const maxSize = resolveMaxSize(this.config.maxSize, file.type, DEFAULT_MAX_SIZE);

    if (types !== undefined && !types.includes(file.type)) {
      throw new FileToolError('UNSUPPORTED_TYPE', file.type || 'unknown');
    }
    if (file.size > maxSize) {
      throw new FileToolError('FILE_TOO_LARGE', `${file.size} > ${maxSize}`);
    }
  }
}
