import type { OutputData } from '../../../types/data-formats/output-data';

import type { CarriedHistory } from './document-session';
import { contentRevision } from './revision';
import { DocSnapshot } from './snapshot';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The steps a session carries between calls, as `{ past, future, lost?, revision }`. They hold only
 * while the document is the one the last call returned: a revision that differs means someone else
 * saved it, so the steps are lost (undo then answers CONFLICT). Every port that restores carried
 * steps runs this check: the C#, Go and Rust bundles, and Node's shared handle store.
 */
export const carriedHistory = (
  value: unknown,
  document: OutputData,
  load: (raw: OutputData) => OutputData,
  isDocument: (entry: unknown) => entry is OutputData
): CarriedHistory | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const isEntry = (entry: unknown): entry is OutputData | 'other' => entry === 'other' || isDocument(entry);
  const past = Array.isArray(value.past) ? value.past.filter(isEntry) : [];
  const future = Array.isArray(value.future) ? value.future.filter(isEntry) : [];

  const lost = value.lost === true;

  if (value.revision !== contentRevision(DocSnapshot.fromOutput(document).toOutput())) {
    return { past: [], future: [], lost: lost || past.length + future.length > 0 };
  }
  const loaded = (entry: OutputData | 'other'): OutputData | 'other' => entry === 'other' ? entry : load(entry);

  return { past: past.map(loaded), future: future.map(loaded), lost };
};
