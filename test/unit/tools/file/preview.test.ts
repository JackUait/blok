import { describe, it, expect } from 'vitest';
import { isPreviewable } from '../../../../src/tools/file/preview';

describe('isPreviewable', () => {
  it('returns true for an application/pdf mime type', () => {
    expect(isPreviewable({ mimeType: 'application/pdf' })).toBe(true);
  });

  it('returns true for a .pdf file name', () => {
    expect(isPreviewable({ fileName: 'doc.pdf' })).toBe(true);
  });

  it('matches the .pdf extension case-insensitively', () => {
    expect(isPreviewable({ fileName: 'DOC.PDF' })).toBe(true);
  });

  it('strips query and hash before checking the url extension', () => {
    expect(isPreviewable({ url: 'https://x.com/a/b.pdf?v=1#p2' })).toBe(true);
  });

  it('returns false for a non-pdf mime type', () => {
    expect(isPreviewable({ mimeType: 'image/png' })).toBe(false);
  });

  it('returns false for a non-pdf file name', () => {
    expect(isPreviewable({ fileName: 'notes.txt' })).toBe(false);
  });

  it('returns false for a url with no extension and no mime type', () => {
    expect(isPreviewable({ url: 'https://x.com/file' })).toBe(false);
  });

  it('returns false for empty data', () => {
    expect(isPreviewable({})).toBe(false);
  });
});
