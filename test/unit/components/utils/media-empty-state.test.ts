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

describe('preview depth follows the pointer', () => {
  const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

  const setup = (): { panel: HTMLElement; preview: HTMLElement } => {
    const el = render({ preview: 'image' });
    const panel = el.querySelector<HTMLElement>('.blok-media-empty__panel');
    const preview = el.querySelector<HTMLElement>('[data-blok-media-preview]');
    if (!panel || !preview) throw new Error('panel or preview missing');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    return { panel, preview };
  };

  const move = (target: HTMLElement, x: number, y: number): void => {
    target.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  };

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('leans toward the pointer, from -1 at one edge to 1 at the other', async () => {
    const { panel, preview } = setup();

    move(panel, 200, 0);
    await nextFrame();

    expect(preview.style.getPropertyValue('--mx')).toBe('1');
    expect(preview.style.getPropertyValue('--my')).toBe('-1');
  });

  it('settles back to center when the pointer leaves', async () => {
    const { panel, preview } = setup();

    move(panel, 50, 75);
    await nextFrame();
    panel.dispatchEvent(new MouseEvent('pointerleave'));

    expect(preview.style.getPropertyValue('--mx')).toBe('0');
    expect(preview.style.getPropertyValue('--my')).toBe('0');
  });

  it('stays still when the user asks for reduced motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    });
    const { panel, preview } = setup();

    move(panel, 200, 0);
    await nextFrame();

    expect(preview.style.getPropertyValue('--mx')).toBe('');
  });
});

describe('preview springs home when the pointer leaves', () => {
  const setup = (): { panel: HTMLElement; preview: HTMLElement } => {
    const el = render({ preview: 'video' });
    const panel = el.querySelector<HTMLElement>('.blok-media-empty__panel');
    const preview = el.querySelector<HTMLElement>('[data-blok-media-preview]');
    if (!panel || !preview) throw new Error('panel or preview missing');
    return { panel, preview };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('plays the demo while the pointer is over the panel', () => {
    const { panel, preview } = setup();

    panel.dispatchEvent(new MouseEvent('pointerenter'));

    expect(preview.hasAttribute('data-hover')).toBe(true);
  });

  it('swaps the demo for an exit that clears once it has played', () => {
    const { panel, preview } = setup();
    panel.dispatchEvent(new MouseEvent('pointerenter'));

    panel.dispatchEvent(new MouseEvent('pointerleave'));

    expect(preview.hasAttribute('data-hover')).toBe(false);
    expect(preview.hasAttribute('data-leaving')).toBe(true);

    vi.advanceTimersByTime(2000);

    expect(preview.hasAttribute('data-leaving')).toBe(false);
  });

  it('drops the exit and replays the demo when the pointer comes back', () => {
    const { panel, preview } = setup();
    panel.dispatchEvent(new MouseEvent('pointerenter'));
    panel.dispatchEvent(new MouseEvent('pointerleave'));

    panel.dispatchEvent(new MouseEvent('pointerenter'));

    expect(preview.hasAttribute('data-leaving')).toBe(false);
    expect(preview.hasAttribute('data-hover')).toBe(true);

    vi.advanceTimersByTime(2000);

    expect(preview.hasAttribute('data-hover')).toBe(true);
  });

  it('skips the exit when the user asks for reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce'), media: query }),
    });
    const { panel, preview } = setup();
    panel.dispatchEvent(new MouseEvent('pointerenter'));

    panel.dispatchEvent(new MouseEvent('pointerleave'));

    expect(preview.hasAttribute('data-hover')).toBe(false);
    expect(preview.hasAttribute('data-leaving')).toBe(false);
  });
});

describe('link tab', () => {
  const openLink = (overrides: Partial<MediaEmptyStateOptions> = {}): HTMLElement => {
    const el = render({ preview: 'image', acceptTypes: ['image/jpeg', 'image/png'], ...overrides });
    el.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    return el;
  };

  const type = (el: HTMLElement, value: string, inputType = 'insertText'): void => {
    const input = el.querySelector<HTMLInputElement>('input[type="url"]');
    if (!input) throw new Error('url input missing');
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
  };

  const drawing = (el: HTMLElement): HTMLElement | null =>
    el.querySelector<HTMLElement>('.blok-media-empty__panel > [data-blok-media-preview="image"]');

  const host = (el: HTMLElement): HTMLElement | null =>
    el.querySelector<HTMLElement>('.blok-media-empty__embed-host');

  it('keeps the full-size drawing on stage above a large field, pale until the link is valid', () => {
    const el = openLink();

    expect(drawing(el)?.style.getPropertyValue('--blok-media-progress')).toBe('0');
    expect(el.querySelector('.blok-media-empty__embed-bar')?.classList.contains('blok-media-empty__embed-bar--large')).toBe(true);
    expect(el.querySelector('.blok-media-empty__embed-bar [data-blok-media-preview]')).toBeNull();
    expect(el.querySelector('.blok-media-empty__embed-icon svg')).not.toBeNull();
  });

  it('completes the drawing once the link is valid, and resets it when cleared', () => {
    const el = openLink();

    type(el, 'https://images.unsplash.com/photo.jpg');
    expect(drawing(el)?.style.getPropertyValue('--blok-media-progress')).toBe('1');

    type(el, '');
    expect(drawing(el)?.style.getPropertyValue('--blok-media-progress')).toBe('0');
  });

  it('reads a file link back as its accepted type, without repeating the domain', () => {
    const el = openLink();

    type(el, 'https://images.unsplash.com/photo.jpg');

    expect(host(el)?.hidden).toBe(false);
    expect(el.querySelector('.blok-media-empty__embed-type')?.textContent).toBe('JPG');
    expect(el.querySelector('.blok-media-empty__embed-domain')).toBeNull();
  });

  it('names a known provider instead of repeating its domain', () => {
    const el = openLink();

    type(el, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(host(el)?.hidden).toBe(false);
    expect(el.querySelector('.blok-media-empty__embed-provider')?.textContent).toBe('YouTube');
  });

  it('says nothing beside a link when there is nothing new to say', () => {
    const el = openLink();

    type(el, 'https://example.com/gallery');

    expect(host(el)?.hidden).toBe(true);
  });

  it('draws the link like an address bar: faded protocol, strong domain, muted path', () => {
    const el = openLink();

    type(el, 'https://www.youtube.com/watch?v=1');
    const part = (name: string): string | null | undefined =>
      el.querySelector(`.blok-media-empty__embed-mirror .blok-media-empty__url-${name}`)?.textContent;

    expect([part('proto'), part('www'), part('host'), part('path')]).toEqual(['https://', 'www.', 'youtube.com', '/watch?v=1']);
    expect(el.querySelector('.blok-media-empty__embed-mirror')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives the site a face once the link is valid, from its registrable domain', () => {
    const el = openLink();
    const icon = (): HTMLElement | null => el.querySelector<HTMLElement>('.blok-media-empty__embed-icon');

    type(el, 'https://www.bbc.co.uk/news/pic.png');
    expect(icon()?.getAttribute('data-site')).toBe('B');

    type(el, 'not a link');
    expect(icon()?.hasAttribute('data-site')).toBe(false);
  });

  it('hides the read-back while the link is not valid yet', () => {
    const el = openLink();

    type(el, 'https://images.unsplash.com/photo.jpg');
    type(el, 'not a link');

    expect(host(el)?.hidden).toBe(true);
  });

  it('catches a pasted valid link', () => {
    const el = openLink();

    type(el, 'https://images.unsplash.com/photo.jpg', 'insertFromPaste');

    expect(drawing(el)?.classList.contains('is-caught')).toBe(true);
  });

  it('keeps the plain link icon when no drawing is asked for', () => {
    const el = render();
    el.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();

    expect(el.querySelector('.blok-media-empty__embed-bar [data-blok-media-preview]')).toBeNull();
    expect(el.querySelector('.blok-media-empty__embed-icon svg')).not.toBeNull();
    expect(el.querySelector('.blok-media-empty__embed-bar')?.classList.contains('blok-media-empty__embed-bar--large')).toBe(false);
  });
});

describe('switching tabs', () => {
  it('keeps the very same drawing on stage, so it never re-renders', () => {
    const el = render({ preview: 'image' });
    const first = el.querySelector('[data-blok-media-preview]');

    el.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    const onLink = el.querySelector('[data-blok-media-preview]');
    el.querySelector<HTMLButtonElement>('[data-tab="upload"]')?.click();
    const backOnUpload = el.querySelector('[data-blok-media-preview]');

    expect(first).not.toBeNull();
    expect(onLink).toBe(first);
    expect(backOnUpload).toBe(first);
  });

  it('waits for a link on the Link tab and rests again back on Upload', () => {
    const el = render({ preview: 'image' });
    const drawing = el.querySelector<HTMLElement>('[data-blok-media-preview]');

    el.querySelector<HTMLButtonElement>('[data-tab="embed"]')?.click();
    expect(drawing?.hasAttribute('data-uploading')).toBe(true);

    el.querySelector<HTMLButtonElement>('[data-tab="upload"]')?.click();
    expect(drawing?.hasAttribute('data-uploading')).toBe(false);
    expect(drawing?.style.getPropertyValue('--blok-media-progress')).toBe('');
  });
});
