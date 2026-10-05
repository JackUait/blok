import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { renderVideo, renderCaptionRow, renderErrorState } from '../../../../src/tools/video/ui';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderVideo', () => {
  it('marks the video as a block-menu surface', () => {
    const video = renderVideo({ url: 'https://example.com/clip.mp4' }).querySelector('video');

    expect(video?.hasAttribute('data-blok-block-context-menu')).toBe(true);
  });

  it('returns figure with <video> carrying the src url', () => {
    const fig = renderVideo({ url: 'https://example.com/clip.mp4' });
    const video = fig.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('https://example.com/clip.mp4');
  });

  it('sets text-align on figure per alignment', () => {
    expect(renderVideo({ url: 'u', alignment: 'left' }).style.textAlign).toBe('left');
    expect(renderVideo({ url: 'u', alignment: 'center' }).style.textAlign).toBe('center');
    expect(renderVideo({ url: 'u', alignment: 'right' }).style.textAlign).toBe('right');
  });

  it('defaults to center alignment when omitted', () => {
    const fig = renderVideo({ url: 'u' });
    expect(fig.style.textAlign).toBe('center');
  });

  it('applies width percent on figure when provided', () => {
    const fig = renderVideo({ url: 'u', width: 60 });
    expect(fig.style.width).toBe('60%');
  });

  it('omits inline figure width when absent so CSS default applies', () => {
    const fig = renderVideo({ url: 'u' });
    expect(fig.style.width).toBe('');
  });

  it('sets aspect-ratio on the media wrapper to prevent squeeze-on-load layout shift', () => {
    const fig = renderVideo({ url: 'u' });
    const media = fig.querySelector<HTMLElement>('[data-role="video-media"]');
    expect(media).not.toBeNull();
    // Default 16:9 aspect ratio must be set so the browser reserves space
    // before loadedmetadata fires.
    expect(media!.style.aspectRatio).toBe('16 / 9');
  });

  it('uses stored aspectRatio from data when available', () => {
    const fig = renderVideo({ url: 'u', aspectRatio: '21 / 9' });
    const media = fig.querySelector<HTMLElement>('[data-role="video-media"]');
    expect(media!.style.aspectRatio).toBe('21 / 9');
  });

  it('video element has preload metadata and no native controls', () => {
    const fig = renderVideo({ url: 'u' });
    const video = fig.querySelector('video')!;
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.hasAttribute('controls')).toBe(false);
  });

  it('video element is focusable for keyboard controls', () => {
    const fig = renderVideo({ url: 'u' });
    const video = fig.querySelector('video')!;
    expect(video.getAttribute('tabindex')).toBe('0');
  });
});

describe('renderCaptionRow', () => {
  it('renders a contenteditable div with the provided value', () => {
    const row = renderCaptionRow({
      value: 'Hello',
      placeholder: 'Write…',
      readOnly: false,
      onChange: vi.fn(),
    });
    const caption = row.querySelector('[data-role="video-caption"]');
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toBe('Hello');
  });

  it('sets contenteditable to false when readOnly', () => {
    const row = renderCaptionRow({
      value: '',
      placeholder: 'Write…',
      readOnly: true,
      onChange: vi.fn(),
    });
    const caption = row.querySelector('[data-role="video-caption"]');
    expect(caption!.getAttribute('contenteditable')).toBe('false');
  });

  it('calls onChange on blur with the new text', () => {
    const onChange = vi.fn();
    const row = renderCaptionRow({
      value: '',
      placeholder: 'Write…',
      readOnly: false,
      onChange,
    });
    const caption = row.querySelector('[data-role="video-caption"]')!;
    caption.textContent = 'Updated';
    caption.dispatchEvent(new Event('blur'));
    expect(onChange).toHaveBeenCalledWith('Updated');
  });

  it('sets placeholder via data-placeholder attribute', () => {
    const row = renderCaptionRow({
      value: '',
      placeholder: 'My placeholder',
      readOnly: false,
      onChange: vi.fn(),
    });
    const caption = row.querySelector('[data-role="video-caption"]');
    expect(caption!.getAttribute('data-placeholder')).toBe('My placeholder');
  });
});

describe('renderVideo with variants', () => {
  it('emits one source per variant in stored order and no src attribute', () => {
    const video = renderVideo({ url: 'https://x/a.mp4', variants: [
      { url: 'https://x/a.webm', mimeType: 'video/webm; codecs="vp9, opus"' },
      { url: 'https://x/a.mp4', mimeType: 'video/mp4' },
    ] }).querySelector('video');

    if (!video) throw new Error('no video');
    expect(video.hasAttribute('src')).toBe(false);
    expect(Array.from(video.querySelectorAll('source')).map((s) => [s.getAttribute('src'), s.getAttribute('type')]))
      .toEqual([['https://x/a.webm', 'video/webm; codecs="vp9, opus"'], ['https://x/a.mp4', 'video/mp4']]);
  });

  it('keeps the src attribute when there are no variants', () => {
    expect(renderVideo({ url: 'https://x/a.mp4' }).querySelector('video')?.getAttribute('src')).toBe('https://x/a.mp4');
  });
});

describe('renderVideo with stale variants', () => {
  it('plays the url when it is not one of the variants', () => {
    const video = renderVideo({ url: 'https://x/NEW.mp4', variants: [
      { url: 'https://x/a.webm', mimeType: 'video/webm' },
      { url: 'https://x/a.mp4', mimeType: 'video/mp4' },
    ] }).querySelector('video');

    expect(video?.getAttribute('src')).toBe('https://x/NEW.mp4');
    expect(video?.querySelectorAll('source')).toHaveLength(0);
  });
});

describe('renderErrorState', () => {
  const base = {
    message: 'Upload failed',
    replace: { label: 'Replace', onReplace: (): void => {} },
  };

  it('keeps the hooks hosts and tests target', () => {
    const el = renderErrorState(base);
    expect(el.getAttribute('data-role')).toBe('video-error');
    expect(el.classList.contains('blok-video-error-state')).toBe(true);
    const replace = el.querySelector('button[data-action="replace"]');
    expect(replace?.classList.contains('blok-video-retry')).toBe(true);
    expect(replace?.textContent).toBe('Replace');
  });

  it('announces the message politely and hides the static from screen readers', () => {
    const el = renderErrorState(base);
    const message = el.querySelector('[data-role="video-error-message"]');
    expect(message?.textContent).toBe('Upload failed');
    expect(message?.getAttribute('role')).toBe('status');
    const screen = el.querySelector('[data-role="video-error-screen"]');
    expect(screen?.getAttribute('aria-hidden')).toBe('true');
    expect(screen?.contains(message ?? null)).toBe(false);
  });

  it('draws the tear as colour bars inside the static', () => {
    const el = renderErrorState(base);
    const bars = el.querySelectorAll('[data-role="video-error-screen"] .blok-video-error-state__tear span');
    expect(bars.length).toBe(7);
  });

  it('replaces the video when Replace is pressed', () => {
    const onReplace = vi.fn();
    const el = renderErrorState({ ...base, replace: { label: 'Replace', onReplace } });
    el.querySelector<HTMLButtonElement>('[data-action="replace"]')?.click();
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it('offers no Replace unless asked', () => {
    const el = renderErrorState({ message: 'Upload failed' });
    expect(el.querySelector('[data-action="replace"]')).toBeNull();
  });

  it('offers no file picker unless asked', () => {
    const el = renderErrorState(base);
    expect(el.querySelector('[data-action="upload"]')).toBeNull();
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });

  it('picks a file and hands it over', () => {
    const onFile = vi.fn();
    const el = renderErrorState({ ...base, upload: { label: 'Choose a video', accept: 'video/mp4,video/webm', onFile } });
    const button = el.querySelector<HTMLButtonElement>('button[data-action="upload"]');
    const input = el.querySelector<HTMLInputElement>('input[type="file"]');
    if (!button || !input) throw new Error('upload not rendered');
    expect(button.textContent?.trim()).toBe('Choose a video');
    expect(input.accept).toBe('video/mp4,video/webm');
    expect(input.hidden).toBe(true);

    const pick = vi.spyOn(input, 'click');
    button.click();
    expect(pick).toHaveBeenCalledTimes(1);

    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('puts the upload button before Replace', () => {
    const el = renderErrorState({ ...base, upload: { label: 'Choose a video', accept: 'video/*', onFile: () => {} } });
    const actions = [...el.querySelectorAll('button')].map((b) => b.getAttribute('data-action'));
    expect(actions).toEqual(['upload', 'replace']);
  });

  it('sizes the screen like the player it stands in for', () => {
    const el = renderErrorState({ ...base, width: 45 });
    expect(el.style.width).toBe('45%');
    expect(renderErrorState(base).style.width).toBe('');
  });
});
