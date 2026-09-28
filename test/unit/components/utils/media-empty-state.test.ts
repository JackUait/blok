import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderMediaEmptyState,
  type MediaEmptyStateOptions,
} from '../../../../src/components/utils/media-empty-state';
import { renderEmptyState as renderVideo } from '../../../../src/tools/video/empty-state';
import { renderEmptyState as renderAudio } from '../../../../src/tools/audio/empty-state';
import { renderEmptyState as renderImage } from '../../../../src/tools/image/empty-state';
import { renderEmptyState as renderFile } from '../../../../src/tools/file/empty-state';
import type { I18nInstance } from '../../../../src/components/utils/tools';

const LABELS: MediaEmptyStateOptions['labels'] = {
  add: 'Add a video',
  upload: 'Upload',
  embed: 'Link',
  chooseFile: 'Choose file',
  orDropHere: 'or drop a video here',
  dropToUpload: 'Drop to upload',
  urlPlaceholder: 'Paste a video URL…',
  urlAria: 'Video URL',
  submit: 'Insert',
  sourceAria: 'Video source',
};

const render = (overrides: Partial<MediaEmptyStateOptions> = {}) =>
  renderMediaEmptyState({
    acceptTypes: ['video/mp4'],
    labels: LABELS,
    onFile: vi.fn(),
    onUrl: vi.fn(),
    ...overrides,
  });

const fileDrag = (type: string): Event => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { types: ['Files'], files: [], dropEffect: 'none' },
  });
  return ev;
};

const card = (el: HTMLElement): HTMLElement => {
  const found = el.querySelector<HTMLElement>('.blok-media-empty__card');
  if (!found) throw new Error('card missing');
  return found;
};

const hintText = (el: HTMLElement): string | null =>
  el.querySelector('.blok-media-empty__hint')?.textContent ?? null;

describe('renderMediaEmptyState preview', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it.each(['video', 'audio', 'image', 'file'] as const)('draws a decorative %s preview instead of the icon tile', (kind) => {
    const el = render({ preview: kind });
    const preview = el.querySelector(`[data-blok-media-preview="${kind}"]`);

    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('aria-hidden')).toBe('true');
    expect(preview?.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('.blok-media-empty__tile')).toBeNull();
  });

  it('keeps the small icon tile when no preview is asked for', () => {
    const el = render();

    expect(el.querySelector('[data-blok-media-preview]')).toBeNull();
    expect(el.querySelector('.blok-media-empty__tile')).not.toBeNull();
  });

  it('says "drop to upload" under the button while a file hovers the card', () => {
    const el = render({ preview: 'video' });

    card(el).dispatchEvent(fileDrag('dragenter'));
    expect(hintText(el)).toBe('Drop to upload');

    card(el).dispatchEvent(fileDrag('dragleave'));
    expect(hintText(el)).toBe('or drop a video here');
  });

  it('restores the hint after a drop', () => {
    const el = render({ preview: 'video' });

    card(el).dispatchEvent(fileDrag('dragenter'));
    card(el).dispatchEvent(fileDrag('drop'));

    expect(hintText(el)).toBe('or drop a video here');
    expect(card(el).classList.contains('is-dragover')).toBe(false);
  });
});

describe('media tools pick their own preview', () => {
  const i18n = {
    t: (key: string) => key,
    has: () => false,
  } as unknown as I18nInstance;
  const handlers = { onFile: vi.fn(), onUrl: vi.fn() };

  it.each([
    ['video', () => renderVideo(handlers)],
    ['audio', () => renderAudio(handlers)],
    ['image', () => renderImage(handlers)],
    ['file', () => renderFile({ ...handlers, acceptTypes: [], i18n })],
  ] as const)('%s', (kind, make) => {
    expect(make().querySelector(`[data-blok-media-preview="${kind}"]`)).not.toBeNull();
  });
});
