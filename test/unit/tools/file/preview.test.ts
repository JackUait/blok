import { describe, it, expect } from 'vitest';
import { getPreviewKind, isPreviewable } from '../../../../src/tools/file/preview';

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

  it('returns true for a plain-text file name', () => {
    expect(isPreviewable({ fileName: 'notes.txt' })).toBe(true);
  });

  it('returns false for a url with no extension and no mime type', () => {
    expect(isPreviewable({ url: 'https://x.com/file' })).toBe(false);
  });

  it('returns false for empty data', () => {
    expect(isPreviewable({})).toBe(false);
  });

  it('returns true for docx, xlsx, pptx files', () => {
    expect(isPreviewable({ fileName: 'a.docx' })).toBe(true);
    expect(isPreviewable({ fileName: 'a.xlsx' })).toBe(true);
    expect(isPreviewable({ fileName: 'a.pptx' })).toBe(true);
  });
});

describe('getPreviewKind', () => {
  it('classifies PDFs by mime and extension', () => {
    expect(getPreviewKind({ url: 'x', mimeType: 'application/pdf' })).toBe('pdf');
    expect(getPreviewKind({ url: 'doc.pdf' })).toBe('pdf');
    expect(getPreviewKind({ url: 'blob:1', fileName: 'a.PDF' })).toBe('pdf');
  });

  it('classifies Markdown by extension and mime', () => {
    expect(getPreviewKind({ url: 'readme.md' })).toBe('markdown');
    expect(getPreviewKind({ url: 'x', fileName: 'a.markdown' })).toBe('markdown');
    expect(getPreviewKind({ url: 'x', mimeType: 'text/markdown' })).toBe('markdown');
  });

  it('classifies code by mapped extension', () => {
    expect(getPreviewKind({ url: 'app.ts' })).toBe('code');
    expect(getPreviewKind({ url: 'main.py' })).toBe('code');
    expect(getPreviewKind({ url: 'style.css' })).toBe('code');
    expect(getPreviewKind({ url: 'q.sql' })).toBe('code');
  });

  it('classifies plain text by extension and text/* mime', () => {
    expect(getPreviewKind({ url: 'notes.txt' })).toBe('text');
    expect(getPreviewKind({ url: 'data.csv' })).toBe('text');
    expect(getPreviewKind({ url: 'server.log' })).toBe('text');
    expect(getPreviewKind({ url: 'x', mimeType: 'text/plain' })).toBe('text');
  });

  it('returns null for non-previewable files', () => {
    expect(getPreviewKind({ url: 'photo.png' })).toBeNull();
    expect(getPreviewKind({ url: 'archive.zip' })).toBeNull();
    expect(getPreviewKind({})).toBeNull();
  });

  it('isPreviewable is true exactly when a kind resolves', () => {
    expect(isPreviewable({ url: 'a.md' })).toBe(true);
    expect(isPreviewable({ url: 'a.zip' })).toBe(false);
  });

  it('classifies docx by extension and OOXML mime', () => {
    expect(getPreviewKind({ fileName: 'a.docx' })).toBe('docx');
    expect(getPreviewKind({ url: 'x', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('docx');
  });

  it('classifies xlsx by extension and OOXML mime', () => {
    expect(getPreviewKind({ fileName: 'a.xlsx' })).toBe('xlsx');
    expect(getPreviewKind({ url: 'x', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe('xlsx');
  });

  it('classifies pptx by extension and OOXML mime', () => {
    expect(getPreviewKind({ fileName: 'a.pptx' })).toBe('pptx');
    expect(getPreviewKind({ url: 'x', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe('pptx');
  });

  it('leaves legacy doc/xls/ppt download-only', () => {
    expect(getPreviewKind({ fileName: 'a.doc' })).toBeNull();
    expect(getPreviewKind({ fileName: 'a.xls' })).toBeNull();
    expect(getPreviewKind({ fileName: 'a.ppt' })).toBeNull();
  });
});
