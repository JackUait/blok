import { describe, it, expect } from 'vitest';
import { resolveFileIcon } from '../../../../src/tools/file/file-icon';
import {
  IconFile,
  IconFileArchive,
  IconFileDoc,
  IconFilePdf,
  IconFileSheet,
  IconFileSlides,
  IconImage,
  IconMusic,
  IconVideo,
  IconCode,
} from '../../../../src/components/icons';

describe('resolveFileIcon', () => {
  it('maps PDFs by mime type and by extension', () => {
    expect(resolveFileIcon({ url: 'x', mimeType: 'application/pdf' })).toEqual({ category: 'pdf', icon: IconFilePdf });
    expect(resolveFileIcon({ url: 'report.PDF' })).toEqual({ category: 'pdf', icon: IconFilePdf });
  });

  it('maps word-processing documents', () => {
    expect(resolveFileIcon({ url: 'a.doc' }).category).toBe('document');
    expect(resolveFileIcon({ url: 'a.docx' }).icon).toBe(IconFileDoc);
    expect(resolveFileIcon({ url: 'a.rtf' }).category).toBe('document');
    expect(resolveFileIcon({ url: 'a.odt' }).category).toBe('document');
  });

  it('maps spreadsheets, including csv', () => {
    expect(resolveFileIcon({ url: 'a.xlsx' }).icon).toBe(IconFileSheet);
    expect(resolveFileIcon({ url: 'a.xls' }).category).toBe('spreadsheet');
    expect(resolveFileIcon({ url: 'data.csv' }).category).toBe('spreadsheet');
    expect(resolveFileIcon({ url: 'a.ods' }).category).toBe('spreadsheet');
  });

  it('maps presentations', () => {
    expect(resolveFileIcon({ url: 'a.pptx' }).icon).toBe(IconFileSlides);
    expect(resolveFileIcon({ url: 'a.ppt' }).category).toBe('presentation');
    expect(resolveFileIcon({ url: 'a.odp' }).category).toBe('presentation');
  });

  it('maps archives', () => {
    for (const ext of ['zip', 'rar', '7z', 'gz', 'tar']) {
      expect(resolveFileIcon({ url: `a.${ext}` })).toEqual({ category: 'archive', icon: IconFileArchive });
    }
  });

  it('maps audio by mime and extension', () => {
    expect(resolveFileIcon({ url: 'a', mimeType: 'audio/mpeg' }).icon).toBe(IconMusic);
    expect(resolveFileIcon({ url: 'song.mp3' }).category).toBe('audio');
    expect(resolveFileIcon({ url: 'song.flac' }).category).toBe('audio');
  });

  it('maps video by mime and extension', () => {
    expect(resolveFileIcon({ url: 'a', mimeType: 'video/mp4' }).icon).toBe(IconVideo);
    expect(resolveFileIcon({ url: 'clip.mov' }).category).toBe('video');
    expect(resolveFileIcon({ url: 'clip.mkv' }).category).toBe('video');
  });

  it('maps images by mime and extension', () => {
    expect(resolveFileIcon({ url: 'a', mimeType: 'image/png' }).icon).toBe(IconImage);
    expect(resolveFileIcon({ url: 'pic.jpg' }).category).toBe('image');
    expect(resolveFileIcon({ url: 'pic.svg' }).category).toBe('image');
  });

  it('maps source code via the prism language table', () => {
    expect(resolveFileIcon({ url: 'main.ts' }).icon).toBe(IconCode);
    expect(resolveFileIcon({ url: 'main.py' }).category).toBe('code');
  });

  it('maps plain text and markdown to the generic document glyph', () => {
    expect(resolveFileIcon({ url: 'notes.txt' })).toEqual({ category: 'text', icon: IconFile });
    expect(resolveFileIcon({ url: 'readme.md' }).category).toBe('text');
    expect(resolveFileIcon({ url: 'a', mimeType: 'text/plain' }).category).toBe('text');
  });

  it('falls back to the generic glyph for unknown types', () => {
    expect(resolveFileIcon({ url: 'mystery.xyz' })).toEqual({ category: 'generic', icon: IconFile });
    expect(resolveFileIcon({ url: 'noextension' }).category).toBe('generic');
  });

  it('prefers filename extension over the url when both are present', () => {
    expect(resolveFileIcon({ url: 'blob:abc-123', fileName: 'invoice.pdf' }).category).toBe('pdf');
  });
});
