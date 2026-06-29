import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderEmptyState } from '../../../../src/tools/image/empty-state';
import { simulateChange } from '../../../helpers/simulate';

describe('renderEmptyState', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('renders Upload tab by default with file input', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn() });
    const file = el.querySelector('input[type="file"]');
    expect(file).not.toBeNull();
    if (!file) throw new Error('expected file input');
    expect(file.getAttribute('accept')).toContain('image/');
  });

  it('switches to Embed tab on click and shows URL input', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn() });
    const embedTab = el.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    if (!embedTab) throw new Error('embed tab missing');
    embedTab.click();
    const url = el.querySelector('input[type="url"]');
    expect(url).not.toBeNull();
  });

  it('calls onFile with the picked file', () => {
    const onFile = vi.fn();
    const el = renderEmptyState({ onFile, onUrl: vi.fn() });
    const fileInput = el.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error('file input missing');
    const file = new File([new Uint8Array(1)], 'a.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    simulateChange(fileInput);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('calls onUrl with the trimmed URL on submit', () => {
    const onUrl = vi.fn();
    const el = renderEmptyState({ onFile: vi.fn(), onUrl });
    const embedTab = el.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    if (!embedTab) throw new Error('embed tab missing');
    embedTab.click();
    const input = el.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = '  https://x/y.png  ';
    const submit = el.querySelector<HTMLButtonElement>('[data-action="submit-url"]');
    if (!submit) throw new Error('submit missing');
    submit.click();
    expect(onUrl).toHaveBeenCalledWith('https://x/y.png');
  });

  it('accepts pasting any image/* file by default (e.g. image/avif)', () => {
    const onFile = vi.fn();
    const el = renderEmptyState({ onFile, onUrl: vi.fn() });
    const card = el.querySelector<HTMLElement>('.blok-media-empty__card');
    if (!card) throw new Error('card missing');
    const file = new File([new Uint8Array(1)], 'a.avif', { type: 'image/avif' });
    const ev = new Event('paste') as Event & { clipboardData: unknown };
    ev.clipboardData = { items: [{ kind: 'file', getAsFile: () => file }] };
    card.dispatchEvent(ev);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('renders inline error from setError(message)', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn() });
    el.setError('boom');
    const err = el.querySelector('[data-role="error"]');
    if (!err) throw new Error('error region missing');
    expect(err.textContent).toBe('boom');
  });

  it('with sources "upload" renders only the Upload source (no Link tab)', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), sources: 'upload' });
    expect(el.querySelector('[data-tab="embed"]')).toBeNull();
    expect(el.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('with sources "url" renders only the Link source (no Upload tab, URL input active)', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), sources: 'url' });
    expect(el.querySelector('[data-tab="upload"]')).toBeNull();
    expect(el.querySelector('input[type="url"]')).not.toBeNull();
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });

  it('with a single source hides the tablist entirely', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn(), sources: 'upload' });
    expect(el.querySelector('[role="tablist"]')).toBeNull();
  });

  it('with sources "url" a dropped file does NOT trigger onFile', () => {
    const onFile = vi.fn();
    const el = renderEmptyState({ onFile, onUrl: vi.fn(), sources: 'url' });
    const card = el.querySelector<HTMLElement>('.blok-media-empty__card');
    if (!card) throw new Error('card missing');
    const file = new File([new Uint8Array(1)], 'a.png', { type: 'image/png' });
    const ev = new Event('drop') as Event & { dataTransfer: unknown };
    ev.dataTransfer = { files: [file] };
    card.dispatchEvent(ev);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('defaults to both sources when sources omitted', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn() });
    expect(el.querySelector('[data-tab="upload"]')).not.toBeNull();
    expect(el.querySelector('[data-tab="embed"]')).not.toBeNull();
  });

  it('falls back to English when i18n omitted', () => {
    const el = renderEmptyState({ onFile: vi.fn(), onUrl: vi.fn() });
    const card = el.querySelector<HTMLElement>('.blok-media-empty__card');
    if (!card) throw new Error('card missing');
    expect(card.getAttribute('aria-label')).toBe('Add an image');
    const labelEl = el.querySelector('.blok-media-empty__label');
    expect(labelEl?.textContent).toBe('Add an image');
    const uploadTab = el.querySelector<HTMLButtonElement>('[data-tab="upload"]');
    expect(uploadTab?.textContent).toBe('Upload');
    const embedTab = el.querySelector<HTMLButtonElement>('[data-tab="embed"]');
    expect(embedTab?.textContent).toBe('Link');
    embedTab?.click();
    const urlInput = el.querySelector<HTMLInputElement>('input[type="url"]');
    expect(urlInput?.placeholder).toBe('Paste an image URL…');
  });
});
