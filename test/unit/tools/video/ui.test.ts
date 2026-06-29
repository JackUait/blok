import { describe, it, expect, vi, afterEach } from 'vitest';

import { renderVideo, renderCaptionRow } from '../../../../src/tools/video/ui';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderVideo', () => {
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
