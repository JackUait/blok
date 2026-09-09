/**
 * PROVEN EQUIVALENT (no test can distinguish these mutants):
 *
 * - L59 `data.mimeType ?? ''` -> `'Stryker was here!'`. Every consumer of
 *   `mime` is an equality, `startsWith` or `includes` against a specific
 *   value; a garbage string fails all of them exactly like ''.
 * - L61 ternary fallback `''` (when there is no fileName and no url) ->
 *   `'Stryker was here!'`. No extension set contains it and
 *   `extToPrismLang` misses it, so both values classify as 'generic'.
 */
import { describe, expect, it } from 'vitest';

import { resolveFileIcon } from '../../../../src/tools/file/file-icon';

describe('resolveFileIcon — Office MIME fallbacks', () => {
  it('buckets the legacy Excel MIME as a spreadsheet', () => {
    expect(resolveFileIcon({ mimeType: 'application/vnd.ms-excel' }).category).toBe('spreadsheet');
  });

  it('buckets the legacy PowerPoint MIME as a presentation', () => {
    expect(resolveFileIcon({ mimeType: 'application/vnd.ms-powerpoint' }).category).toBe('presentation');
  });

  it('buckets the legacy Word MIME as a document', () => {
    expect(resolveFileIcon({ mimeType: 'application/msword' }).category).toBe('document');
  });

  // Killing the `source === undefined` guard: extOf would split undefined.
  it('classifies a file with neither name nor url as generic', () => {
    expect(resolveFileIcon({}).category).toBe('generic');
  });
});
