import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachControls as attachVideoControls } from '../../../src/tools/video/controls';
import { attachControls as attachAudioControls } from '../../../src/tools/audio/controls';
import { createColorPicker } from '../../../src/components/shared/color-picker';
import { readRecentLanguages, RECENT_LANGUAGES_STORAGE_KEY } from '../../../src/tools/code/language-picker';
import type { I18n } from '../../../types/api';

/** What another tab's write looks like here: storage already holds the value, then the event arrives. */
const storageEvent = (key: string, value: string | null): void => {
  if (value === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, storageArea: localStorage }));
};

const setProp = (el: HTMLElement, key: string, value: unknown): void => {
  Object.defineProperty(el, key, { value, configurable: true, writable: true });
};

const mountVideo = (opts: Partial<Parameters<typeof attachVideoControls>[0]> = {}): { video: HTMLVideoElement; destroy(): void } => {
  const figure = document.createElement('figure');
  const video = document.createElement('video');

  setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
  setProp(video, 'pause', vi.fn());
  figure.appendChild(video);
  document.body.appendChild(figure);

  const { destroy } = attachVideoControls({ video, figure, ...opts });

  return { video, destroy };
};

const mountAudio = (opts: Partial<Parameters<typeof attachAudioControls>[0]> = {}): { media: HTMLAudioElement; destroy(): void } => {
  const figure = document.createElement('figure');
  const media = document.createElement('audio');

  Object.defineProperty(media, 'duration', { value: 200, configurable: true });
  setProp(media, 'play', vi.fn().mockResolvedValue(undefined));
  setProp(media, 'pause', vi.fn());

  const { destroy } = attachAudioControls({ media, figure, data: { url: 'a.mp3' }, ...opts });

  return { media, destroy };
};

const memoryStorage = (): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } => {
  const map = new Map<string, string>();

  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

describe('video preferences follow other tabs', () => {
  it('volume follows another tab while the player is open', () => {
    const { video } = mountVideo();

    storageEvent('blok:video:volume', JSON.stringify({ volume: 0.25, muted: true }));

    expect(video.volume).toBe(0.25);
    expect(video.muted).toBe(true);
  });

  it('rate follows another tab while the player is open', () => {
    const { video } = mountVideo();

    storageEvent('blok:video:rate', '1.5');

    expect(video.playbackRate).toBe(1.5);
  });

  it('loop follows another tab while the player is open', () => {
    const { video } = mountVideo();

    storageEvent('blok:video:loop', 'true');

    expect(video.loop).toBe(true);
  });

  it('playback position never follows another tab', () => {
    const { video } = mountVideo();

    setProp(video, 'currentSrc', 'a.mp4');
    setProp(video, 'currentTime', 3);
    setProp(video, 'duration', 200);
    storageEvent('blok:video:pos:a.mp4', '42');

    expect(video.currentTime).toBe(3);
  });

  it('a removed or corrupt entry leaves the player as it is', () => {
    const { video } = mountVideo();

    storageEvent('blok:video:rate', '1.5');
    storageEvent('blok:video:rate', null);
    storageEvent('blok:video:rate', 'junk');
    storageEvent('blok:video:volume', '{not json');

    expect(video.playbackRate).toBe(1.5);
    expect(video.volume).toBe(1);
  });

  it('stops following once destroyed', () => {
    const { video, destroy } = mountVideo();

    destroy();
    storageEvent('blok:video:rate', '2');

    expect(video.playbackRate).toBe(1);
  });

  it('a player with its own storage ignores localStorage events', () => {
    const { video } = mountVideo({ storage: memoryStorage() });

    storageEvent('blok:video:rate', '2');

    expect(video.playbackRate).toBe(1);
  });
});

describe('audio preferences follow other tabs', () => {
  it('volume follows another tab while the player is open', () => {
    const { media } = mountAudio();

    storageEvent('blok:audio:volume', JSON.stringify({ volume: 0.25, muted: true }));

    expect(media.volume).toBe(0.25);
    expect(media.muted).toBe(true);
  });

  it('rate follows another tab while the player is open', () => {
    const { media } = mountAudio();

    storageEvent('blok:audio:rate', '1.5');

    expect(media.playbackRate).toBe(1.5);
  });

  it('loop follows another tab without touching block data', () => {
    const onLoopChange = vi.fn();
    const { media } = mountAudio({ onLoopChange });

    storageEvent('blok:audio:loop', 'true');

    expect(media.loop).toBe(true);
    expect(onLoopChange).not.toHaveBeenCalled();
  });

  it('playback position never follows another tab', () => {
    const { media } = mountAudio();

    setProp(media, 'currentSrc', 'a.mp3');
    setProp(media, 'currentTime', 3);
    storageEvent('blok:audio:pos:a.mp3', '42');

    expect(media.currentTime).toBe(3);
  });

  it('stops following once destroyed', () => {
    const { media, destroy } = mountAudio();

    destroy();
    storageEvent('blok:audio:rate', '2');

    expect(media.playbackRate).toBe(1);
  });

  it('a player with its own storage ignores localStorage events', () => {
    const { media } = mountAudio({ storage: memoryStorage() });

    storageEvent('blok:audio:rate', '2');

    expect(media.playbackRate).toBe(1);
  });
});

describe('readers that re-read storage each time they open', () => {
  const i18n: I18n = {
    t: (key: string) => key,
    has: () => false,
    getEnglishTranslation: () => '',
    getLocale: () => 'en',
  };

  it('recent colors: a picker built after the event shows the new recents', () => {
    storageEvent('blok-recent-colors', JSON.stringify([{ name: 'red', field: 'text' }]));

    const { element } = createColorPicker({
      i18n,
      testIdPrefix: 'test',
      modes: [
        { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
        { key: 'bg', labelKey: 'tools.marker.background', presetField: 'bg' },
      ],
      onColorSelect: vi.fn(),
    });

    expect(element.querySelector('[data-blok-testid="test-swatch-recent-text-red"]')).not.toBeNull();
  });

  it('recent code languages are read from storage on every call', () => {
    expect(readRecentLanguages()).toStrictEqual([]);

    storageEvent(RECENT_LANGUAGES_STORAGE_KEY, JSON.stringify(['go']));

    expect(readRecentLanguages()).toStrictEqual(['go']);
  });
});
