export type ImageErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_URL'
  | 'LOAD_FAILED'
  | 'UPLOAD_FAILED';

export class ImageError extends Error {
  public readonly code: ImageErrorCode;
  public readonly detail: string;

  constructor(code: ImageErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ImageError';
    this.code = code;
    this.detail = detail;
  }
}
