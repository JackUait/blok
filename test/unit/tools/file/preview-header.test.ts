import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { openFilePreview } from '../../../../src/tools/file/preview-modal';

vi.mock('../../../../src/tools/file/text-preview', () => ({
  loadTextPreview: vi.fn().mockResolvedValue({ ok: true, text: 'hello' }),
}));
vi.mock('../../../../src/tools/file/office-preview', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../src/tools/file/office-preview');

  return { ...actual, fillOfficeBody: vi.fn().mockResolvedValue(undefined) };
});

const labels = { close: 'Close preview' };
const q = <T extends Element>(selector: string): T | null => document.body.querySelector<T>(selector);

describe('file preview header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['report.docx', 'DOC', 'document'],
    ['budget.xlsx', 'XLS', 'spreadsheet'],
    ['deck.pptx', 'PPT', 'presentation'],
    ['invoice.pdf', 'PDF', 'pdf'],
    ['README.md', 'MD', 'text'],
    ['queue.ts', 'TS', 'code'],
    ['people.csv', 'CSV', 'spreadsheet'],
    ['server.log', 'LOG', 'text'],
  ])('badges %s as %s in the %s colour', (fileName, badge, category) => {
    openFilePreview({ url: `https://example.com/${fileName}`, fileName, labels });

    const el = q<HTMLElement>('[data-role="file-preview-badge"]');
    expect(el?.textContent).toBe(badge);
    expect(el?.getAttribute('data-file-category')).toBe(category);
  });

  it.each([
    ['report.docx', 'DOC'],
    ['budget.xlsx', 'XLS'],
    ['deck.pptx', 'PPT'],
    ['invoice.pdf', 'PDF'],
    ['README.md', 'MD'],
    ['queue.ts', 'TS'],
    ['people.csv', 'CSV'],
    ['notes.txt', 'TXT'],
  ])('shows no type, count or size after the name of %s', (fileName, badge) => {
    openFilePreview({ url: `https://example.com/${fileName}`, fileName, size: 18_432, labels });

    expect(q('[data-role="file-preview-meta"]')).toBeNull();
    const title = q('[data-role="file-preview-badge"]')?.parentElement;
    expect(Array.from(title?.children ?? []).map((el) => el.textContent)).toEqual([badge, fileName]);
  });

  it('offers a download link named after the file', () => {
    openFilePreview({ url: 'https://example.com/files/a.docx', fileName: 'a.docx', labels: { ...labels, download: 'Download' } });

    const link = q<HTMLAnchorElement>('[data-action="preview-save"]');
    expect(link?.getAttribute('href')).toBe('https://example.com/files/a.docx');
    expect(link?.getAttribute('download')).toBe('a.docx');
    expect(link?.getAttribute('aria-label')).toBe('Download');
    expect(link?.rel).toBe('noopener noreferrer');
  });

  it('downloads a blob file in place, without opening a tab', () => {
    openFilePreview({ url: 'blob:https://example.com/abc', fileName: 'a.txt', labels });

    const link = q<HTMLAnchorElement>('[data-action="preview-save"]');
    expect(link?.getAttribute('href')).toBe('blob:https://example.com/abc');
    expect(link?.getAttribute('download')).toBe('a.txt');
    expect(link?.hasAttribute('target')).toBe(false);
  });

  it('offers no download link for a url that is neither http(s) nor blob', () => {
    openFilePreview({ url: 'javascript:alert(1)', fileName: 'a.txt', labels });

    expect(q('[data-action="preview-save"]')).toBeNull();
  });

  it('opens any http(s) file in a new tab', () => {
    openFilePreview({ url: 'https://example.com/a.ts', fileName: 'a.ts', labels: { ...labels, openInNewTab: 'Open in new tab' } });

    const link = q<HTMLAnchorElement>('[data-action="preview-open-tab"]');
    expect(link?.getAttribute('href')).toBe('https://example.com/a.ts');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
  });

  it('never opens a blob text file in a tab, where it could run as the editor', () => {
    openFilePreview({ url: 'blob:https://example.com/abc', fileName: 'a.html', labels });

    expect(q('[data-action="preview-open-tab"]')).toBeNull();
  });

  it('keeps Download, Open in new tab and Close in that order', () => {
    openFilePreview({ url: 'https://example.com/a.ts', fileName: 'a.ts', labels });

    const actions = Array.from(document.body.querySelectorAll('.blok-file-preview-actions > *'))
      .map((el) => el.getAttribute('data-action'));
    expect(actions).toEqual(['preview-save', 'preview-open-tab', 'close-preview']);
  });
});
