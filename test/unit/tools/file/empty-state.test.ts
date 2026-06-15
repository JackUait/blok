import { describe, it, expect, vi } from 'vitest';
import { renderEmptyState } from '../../../../src/tools/file/empty-state';
import { simulateChange } from '../../../helpers/simulate';
import type { I18nInstance } from '../../../../src/components/utils/tools';

const LABELS: Record<string, string> = {
  'tools.file.emptyAddFile': 'Add a file',
  'tools.file.emptyUpload': 'Upload',
  'tools.file.emptyLink': 'Link',
  'tools.file.emptyChooseFile': 'Choose file',
  'tools.file.emptyDropHint': 'or drop a file here',
  'tools.file.emptyDropToUpload': 'Drop to upload',
  'tools.file.emptySourceAria': 'File source',
  'tools.file.emptyUrlPlaceholder': 'Paste a file URL…',
  'tools.file.emptyUrlAria': 'File URL',
  'tools.file.emptyInsert': 'Insert',
};

const i18n = {
  t: (key: string) => LABELS[key] ?? key,
  has: () => false,
} as unknown as I18nInstance;

const render = (overrides: Partial<Parameters<typeof renderEmptyState>[0]> = {}) =>
  renderEmptyState({ acceptTypes: [], i18n, onFile: vi.fn(), onUrl: vi.fn(), ...overrides });

describe('file renderEmptyState', () => {
  it('renders a hidden file input and an Upload/Link tab pair', () => {
    const el = render();
    expect(el.querySelector('input[type="file"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="upload"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="embed"]')).not.toBeNull();
  });

  it('labels the card and tabs from file i18n keys', () => {
    const el = render();
    const card = el.querySelector<HTMLElement>('.blok-media-empty__card');
    expect(card?.getAttribute('aria-label')).toBe('Add a file');
    expect(el.querySelector('[data-tab="upload"]')?.textContent).toBe('Upload');
    expect(el.querySelector('[data-tab="embed"]')?.textContent).toBe('Link');
  });

  it('calls onFile when the hidden input emits a file', () => {
    const onFile = vi.fn();
    const el = render({ onFile });
    const input = el.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('input missing');
    const file = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    simulateChange(input);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('calls onUrl when a URL is submitted from the Link tab', () => {
    const onUrl = vi.fn();
    const el = render({ onUrl });
    el.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const urlInput = el.querySelector<HTMLInputElement>('input[type="url"]');
    if (!urlInput) throw new Error('url input missing');
    urlInput.value = 'https://site.com/doc.pdf';
    el.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    expect(onUrl).toHaveBeenCalledWith('https://site.com/doc.pdf');
  });

  it('calls onFile when a file is dropped on the card', () => {
    const onFile = vi.fn();
    const el = render({ onFile });
    const card = el.querySelector<HTMLElement>('.blok-media-empty__card');
    if (!card) throw new Error('card missing');
    const file = new File([new Uint8Array(4)], 'b.zip', { type: 'application/zip' });
    const dt = { files: [file], types: ['Files'] } as unknown as DataTransfer;
    const drop = new Event('drop') as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    card.dispatchEvent(drop);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('renders inline error from setError(message)', () => {
    const el = render();
    el.setError('boom');
    expect(el.querySelector('[data-role="error"]')?.textContent).toBe('boom');
  });
});
