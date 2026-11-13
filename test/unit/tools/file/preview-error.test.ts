import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildErrorInto, createTypedPdfUrl } from '../../../../src/tools/file/preview-error';

const lines = (body: HTMLElement): { title: string | null; detail: string | null } => ({
  title: body.querySelector('[data-role="file-preview-error-title"]')?.textContent ?? null,
  detail: body.querySelector('[data-role="file-preview-error-detail"]')?.textContent ?? null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildErrorInto', () => {
  it('says what failed and what to do next, as two lines above the download link', () => {
    const body = document.createElement('div');

    buildErrorInto(body, {
      url: 'https://example.com/a.docx',
      labels: { close: 'Close', error: 'Vorschau fehlgeschlagen', errorDetail: 'Lade die Datei herunter.', download: 'Herunterladen' },
    });
    const title = body.querySelector('[data-role="file-preview-error-title"]');

    expect(lines(body)).toEqual({ title: 'Vorschau fehlgeschlagen', detail: 'Lade die Datei herunter.' });
    expect(title?.nextElementSibling?.getAttribute('data-role')).toBe('file-preview-error-detail');
    expect(body.querySelector('[data-action="preview-download"]')?.textContent).toBe('Herunterladen');
  });

  it('does not tell the reader to download a file it offers no link to', () => {
    const body = document.createElement('div');

    buildErrorInto(body, {
      url: 'javascript:alert(1)',
      labels: { close: 'Close', error: 'Vorschau fehlgeschlagen', errorDetail: 'Lade die Datei herunter.', errorNoLinkDetail: 'Link prüfen.' },
    });

    expect(lines(body).detail).toBe('Link prüfen.');
    expect(body.querySelector('[data-action="preview-download"]')).toBeNull();
  });

  it('falls back to English for both lines when no labels are given', () => {
    const withLink = document.createElement('div');
    const withoutLink = document.createElement('div');

    buildErrorInto(withLink, { url: 'https://example.com/a.docx', labels: { close: 'Close' } });
    buildErrorInto(withoutLink, { url: 'javascript:alert(1)', labels: { close: 'Close' } });

    expect(lines(withLink)).toEqual({ title: "Couldn't load preview", detail: 'Download the file to open it.' });
    expect(lines(withoutLink)).toEqual({ title: "Couldn't load preview", detail: 'Check the link and try again.' });
  });

  describe('pdf bytes', () => {
    const OWN = 'blob:https://example.com/own';
    const actions = (body: HTMLElement): Array<string | null> => Array.from(
      body.querySelectorAll('a'),
      (link) => link.getAttribute('data-action')
    );

    it('links a blob url Blok made from bytes re-typed as application/pdf', () => {
      const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue(OWN);
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const typed = createTypedPdfUrl(new Blob(['<script>'], { type: 'text/html' }));
      const body = document.createElement('div');

      buildErrorInto(body, { url: 'blob:https://example.com/raw', fileName: 'a.pdf', labels: { close: 'Close' } }, typed.url);

      const made = create.mock.calls[0]?.[0];
      expect(made instanceof Blob && made.type).toBe('application/pdf');
      expect(actions(body)).toEqual(['preview-download', 'preview-error-open-tab']);
      expect(lines(body).detail).toBe('Download the file to open it.');
      typed.release();
    });

    it('links no blob url it did not make, and none once released', () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue(OWN);
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const foreign = document.createElement('div');
      const released = document.createElement('div');
      const typed = createTypedPdfUrl(new Blob(['%PDF-1.7']));
      typed.release();

      buildErrorInto(foreign, { url: 'blob:https://example.com/raw', labels: { close: 'Close' } }, 'blob:https://example.com/raw');
      buildErrorInto(released, { url: 'blob:https://example.com/raw', labels: { close: 'Close' } }, OWN);

      expect(actions(foreign)).toEqual([]);
      expect(actions(released)).toEqual([]);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(OWN);
    });
  });
});
