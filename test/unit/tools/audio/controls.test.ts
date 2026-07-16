import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachControls } from '../../../../src/tools/audio/controls';

const makeMedia = (): HTMLAudioElement => {
  const a = document.createElement('audio');
  Object.defineProperty(a, 'duration', { value: 200, configurable: true });
  a.play = vi.fn().mockResolvedValue(undefined);
  a.pause = vi.fn();
  return a;
};

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Attaches without an explicit storage stub fall back to jsdom's real
  // localStorage, which persists across tests — clear it to avoid leakage.
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('attachControls', () => {
  it('toggles playback from the play button', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({ media, figure, data: { url: 'u' } });
    figure.appendChild(h.element);
    const play = h.element.querySelector('[data-role="audio-play"]') as HTMLButtonElement;
    play.click();
    expect(media.play).toHaveBeenCalled();
    h.destroy();
  });

  it('space bar toggles playback when the figure has focus', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({ media, figure, data: { url: 'u' } });
    figure.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(media.play).toHaveBeenCalled();
    h.destroy();
  });

  it('mute button flips media.muted and persists it', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const storage = memoryStorage();
    const h = attachControls({ media, figure, data: { url: 'u' }, storage });
    const mute = h.element.querySelector('[data-role="audio-mute"]') as HTMLButtonElement;
    mute.click();
    expect(media.muted).toBe(true);
    expect(storage.getItem('blok:audio:volume')).toContain('"muted":true');
    h.destroy();
  });

  it('loop button flips media.loop and notifies', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const onLoopChange = vi.fn();
    const h = attachControls({ media, figure, data: { url: 'u' }, onLoopChange });
    const loop = h.element.querySelector('[data-role="audio-loop"]') as HTMLButtonElement;
    loop.click();
    expect(media.loop).toBe(true);
    expect(onLoopChange).toHaveBeenCalledWith(true);
    h.destroy();
  });

  const fakeI18n = (map: Record<string, string>) => ({
    has: (k: string): boolean => k in map,
    t: (k: string): string => map[k] ?? k,
  });

  it('exposes the speed slider aria-valuetext at initial render (before any input)', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({ media, figure, data: { url: 'u' } });
    const slider = h.element.querySelector('.blok-audio-controls__speed-slider') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('1×');
    h.destroy();
  });

  it('i18n-translates the control labels when an I18n instance is provided', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({
      media,
      figure,
      data: { url: 'u' },
      i18n: fakeI18n({ 'tools.audio.volume': 'Volume FR', 'tools.audio.mute': 'Muet' }),
    });
    expect(h.element.querySelector('[data-role="audio-volume"]')!.getAttribute('aria-label')).toBe('Volume FR');
    expect(h.element.querySelector('[data-role="audio-mute"]')!.getAttribute('aria-label')).toBe('Muet');
    h.destroy();
  });

  it('applies a preset speed but keeps the menu open for further tweaking', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({ media, figure, data: { url: 'u' } });
    figure.appendChild(h.element);

    const gear = h.element.querySelector('[data-role="audio-speed"]') as HTMLButtonElement;
    gear.click();
    const menu = h.element.querySelector('.blok-audio-controls__speed-menu') as HTMLElement;
    expect(menu.hidden).toBe(false);

    const chips = h.element.querySelectorAll('.blok-audio-controls__speed-chip');
    (chips[3] as HTMLButtonElement).click(); // 2× preset

    expect(media.playbackRate).toBe(2);
    expect(menu.hidden).toBe(false); // stays open — the user may keep adjusting
    h.destroy();
  });

  it('restores persisted volume on attach', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const storage = memoryStorage();
    storage.setItem('blok:audio:volume', JSON.stringify({ volume: 0.3, muted: false }));
    attachControls({ media, figure, data: { url: 'u' }, storage });
    expect(media.volume).toBeCloseTo(0.3, 5);
  });

  it('paints the volume slider fill from the gradient property the stylesheet reads', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({ media, figure, data: { url: 'u' } });
    const volume = h.element.querySelector('[data-role="audio-volume"]') as HTMLInputElement;

    // Drag to half volume — the painted track must fill to 50%.
    volume.value = '0.5';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    // audio.css gradient consumes --blok-audio-vol-pct; if JS writes any other
    // name the fill stays frozen at its 100% default and muted looks identical.
    expect(volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('50%');

    // Muting parks the fill at 0% so the bar visibly empties.
    const mute = h.element.querySelector('[data-role="audio-mute"]') as HTMLButtonElement;
    mute.click();
    expect(volume.style.getPropertyValue('--blok-audio-vol-pct')).toBe('0%');
    h.destroy();
  });

  it('does not restore position when duration is unknown (0)', () => {
    const media = makeMedia();
    Object.defineProperty(media, 'duration', { value: 0, configurable: true });
    const figure = document.createElement('figure');
    const storage = memoryStorage();
    storage.setItem('blok:audio:pos:u', '42');
    attachControls({ media, figure, data: { url: 'u' }, storage });
    media.dispatchEvent(new Event('loadedmetadata'));
    expect(media.currentTime).toBe(0);
  });

  it('persists the playback speed and restores it on a new attach', () => {
    const storage = memoryStorage();
    const a = makeMedia();
    const ha = attachControls({ media: a, figure: document.createElement('figure'), data: { url: 'u' }, storage });
    const chips = ha.element.querySelectorAll('.blok-audio-controls__speed-chip');
    (chips[2] as HTMLButtonElement).click(); // 1.5× preset
    expect(storage.getItem('blok:audio:rate')).toBe('1.5');
    ha.destroy();

    const b = makeMedia();
    const hb = attachControls({ media: b, figure: document.createElement('figure'), data: { url: 'u' }, storage });
    expect(b.playbackRate).toBe(1.5);
    const slider = hb.element.querySelector('.blok-audio-controls__speed-slider') as HTMLInputElement;
    expect(slider.value).toBe('1.5');
    hb.destroy();
  });

  it('ignores a corrupt stored playback speed', () => {
    const storage = memoryStorage();
    storage.setItem('blok:audio:rate', 'not-a-number');
    const media = makeMedia();
    const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' }, storage });
    expect(media.playbackRate).toBe(1);
    h.destroy();
  });

  it('persists loop toggles and restores them on a new attach without notifying onLoopChange', () => {
    const storage = memoryStorage();
    const a = makeMedia();
    const ha = attachControls({ media: a, figure: document.createElement('figure'), data: { url: 'u' }, storage });
    (ha.element.querySelector('[data-role="audio-loop"]') as HTMLButtonElement).click();
    expect(storage.getItem('blok:audio:loop')).toBe('true');
    ha.destroy();

    const b = makeMedia();
    const onLoopChange = vi.fn();
    const hb = attachControls({ media: b, figure: document.createElement('figure'), data: { url: 'u' }, storage, onLoopChange });
    expect(b.loop).toBe(true);
    expect(hb.element.querySelector('[data-role="audio-loop"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(onLoopChange).not.toHaveBeenCalled();
    hb.destroy();
  });

  it('stored loop=false overrides a media element seeded with loop on', () => {
    const storage = memoryStorage();
    storage.setItem('blok:audio:loop', 'false');
    const media = makeMedia();
    media.loop = true;
    const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' }, storage });
    expect(media.loop).toBe(false);
    expect(h.element.querySelector('[data-role="audio-loop"]')!.getAttribute('aria-pressed')).toBe('false');
    h.destroy();
  });
});
