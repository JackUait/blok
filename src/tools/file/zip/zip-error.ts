/** Thrown for any archive Blok will not read: corrupt, unsupported or over the limits. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}
