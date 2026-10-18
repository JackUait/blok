import { surfaceError } from '../errors';

export interface LoadedDocument {
  raw: unknown;
  version: string | null;
  /** No document has this id yet: raw is the empty document a first save creates. */
  missing?: true;
}

export interface SourceListing {
  documents: Array<{ id: string; title: string | null }>;
  nextCursor: string | null;
}

export interface DocumentSource {
  readonly kind: 'files' | 'endpoint';
  load(documentId: string): Promise<LoadedDocument>;
  save(
    documentId: string,
    document: unknown,
    options: { ifVersion: string | null },
  ): Promise<{ version: string | null }>;
  list?(request: { query?: string; cursor?: string; limit: number }): Promise<SourceListing>;
  /** Whether two ids name one stored file, as a symlink and its target do. */
  sameDocument?(first: string, second: string): Promise<boolean>;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const assertDocumentShape = (value: unknown, where: string): void => {
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    throw surfaceError('SOURCE_UNAVAILABLE', `${where} is not a Blok document: expected an object with a "blocks" array.`);
  }
};
