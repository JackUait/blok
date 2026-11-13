import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildErrorInto } from '../../../../src/tools/file/preview-error';

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
});
