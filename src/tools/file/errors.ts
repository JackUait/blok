export type FileToolErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_URL'
  | 'UPLOAD_FAILED';

export class FileToolError extends Error {
  public readonly code: FileToolErrorCode;
  public readonly detail: string;

  constructor(code: FileToolErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FileToolError';
    this.code = code;
    this.detail = detail;
  }
}
