import { describe, it, expect, vi } from 'vitest';
import { renderEmptyState } from '../../../../src/tools/file/empty-state';

const labels = {
  upload: 'Upload',
  link: 'Link',
  chooseFile: 'Choose file',
  dropHint: 'or drop a file here',
  urlPlaceholder: 'Paste a file URL…',
  urlAria: 'File URL',
  insert: 'Insert',
};

describe('renderEmptyState', () => {
  it('renders a hidden file input and an Upload/Link tab pair', () => {
    const el = renderEmptyState({ accept: '*', labels, onFile: vi.fn(), onUrl: vi.fn() });
    expect(el.querySelector('input[type="file"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="upload"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="link"]')).not.toBeNull();
  });

  it('calls onFile when the hidden input emits a file', () => {
    const onFile = vi.fn();
    const el = renderEmptyState({ accept: '*', labels, onFile, onUrl: vi.fn() });
    const input = el.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('input missing');
    const file = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('calls onUrl when a URL is submitted from the Link tab', () => {
    const onUrl = vi.fn();
    const el = renderEmptyState({ accept: '*', labels, onFile: vi.fn(), onUrl });
    el.querySelector<HTMLButtonElement>('[data-tab="link"]')?.click();
    const urlInput = el.querySelector<HTMLInputElement>('input[type="url"]');
    if (!urlInput) throw new Error('url input missing');
    urlInput.value = 'https://site.com/doc.pdf';
    el.querySelector<HTMLButtonElement>('[data-action="submit-url"]')?.click();
    expect(onUrl).toHaveBeenCalledWith('https://site.com/doc.pdf');
  });

  it('calls onFile when a file is dropped on the card', () => {
    const onFile = vi.fn();
    const el = renderEmptyState({ accept: '*', labels, onFile, onUrl: vi.fn() });
    const file = new File([new Uint8Array(4)], 'b.zip', { type: 'application/zip' });
    const dt = { files: [file], types: ['Files'] } as unknown as DataTransfer;
    const drop = new Event('drop') as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    el.dispatchEvent(drop);
    expect(onFile).toHaveBeenCalledWith(file);
  });
});
