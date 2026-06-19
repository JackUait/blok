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

beforeEach(() => vi.clearAllMocks());
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

  it('restores persisted volume on attach', () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const storage = memoryStorage();
    storage.setItem('blok:audio:volume', JSON.stringify({ volume: 0.3, muted: false }));
    attachControls({ media, figure, data: { url: 'u' }, storage });
    expect(media.volume).toBeCloseTo(0.3, 5);
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
});
