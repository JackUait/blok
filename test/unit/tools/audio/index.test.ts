import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { AudioConfig, AudioData } from '../../../../types/tools/audio';
import { AudioTool } from '../../../../src/tools/audio';

vi.mock('../../../../src/tools/audio/metadata', () => ({
  readTrackMetadata: vi.fn().mockResolvedValue({}),
  resolveCover: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/tools/audio/waveform', () => ({
  decodePeaks: vi.fn().mockResolvedValue(null),
  attachWaveform: vi.fn().mockReturnValue({ destroy: vi.fn() }),
}));

// Helper to get the mocked decodePeaks function after module mocking
async function getDecodePeaksMock() {
  const mod = await import('../../../../src/tools/audio/waveform');
  return mod.decodePeaks as ReturnType<typeof vi.fn>;
}

vi.mock('../../../../src/tools/audio/uploader', () => {
  class AudioUploadError extends Error {}
  class Uploader {
    handleFile = vi.fn().mockResolvedValue({ url: 'https://cdn/track.mp3', fileName: 'track.mp3' });
    handleUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/track.mp3' });
  }
  return { AudioUploadError, Uploader };
});

const createMockApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
} as unknown as API);

const createMockBlock = (): BlockAPI => ({
  id: 'a1',
  name: 'audio',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const opts = (
  data: Partial<AudioData> = {},
  config: AudioConfig = {},
  block?: BlockAPI,
): BlockToolConstructorOptions<AudioData, AudioConfig> => ({
  data: { url: '', ...data } as AudioData,
  config,
  api: createMockApi(),
  block: block ?? createMockBlock(),
  readOnly: false,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Force prefers-reduced-motion so caption toggles take the instant path. */
const setReducedMotion = (reduced: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('AudioTool', () => {
  it('renders an empty state when there is no url', () => {
    const tool = new AudioTool(opts());
    const root = tool.render();
    expect(root.querySelector('.blok-media-empty')).not.toBeNull();
  });

  it('renders an <audio> without native controls when a url is present', () => {
    const tool = new AudioTool(opts({ url: 'https://x/y.mp3' }));
    const root = tool.render();
    const audio = root.querySelector('[data-role="audio-media"]');
    expect(audio).not.toBeNull();
    expect((audio as HTMLAudioElement).hasAttribute('controls')).toBe(false);
  });

  it('save() returns only defined fields', () => {
    const tool = new AudioTool(opts({ url: 'u', title: 'T', artist: 'A', width: 50, alignment: 'center', loop: true }));
    tool.render();
    expect(tool.save()).toEqual({ url: 'u', title: 'T', artist: 'A', width: 50, alignment: 'center', loop: true });
  });

  it('validate() requires a non-empty url', () => {
    const tool = new AudioTool(opts());
    expect(tool.validate({ url: '' } as AudioData)).toBe(false);
    expect(tool.validate({ url: 'u' } as AudioData)).toBe(true);
  });

  it('toolbox uses the music icon and audio titleKey', () => {
    expect(AudioTool.toolbox).toMatchObject({ titleKey: 'audio' });
    const tb = AudioTool.toolbox;
    const entry = Array.isArray(tb) ? tb[0] : tb;
    expect(entry.icon).toContain('<svg');
  });

  it('pasteConfig claims audio files and the audio URL pattern', () => {
    const cfg = AudioTool.pasteConfig;
    if (cfg === false) throw new Error('pasteConfig is false');
    expect(cfg.files?.mimeTypes).toContain('audio/*');
    expect(cfg.patterns?.audio).toBeInstanceOf(RegExp);
  });

  it('setReadOnly(true) locks the editable title', () => {
    const tool = new AudioTool(opts({ url: 'u', title: 'T' }));
    const root = tool.render();
    tool.setReadOnly(true);
    const title = root.querySelector('[data-role="audio-title"]');
    expect(title?.getAttribute('contenteditable')).toBe('false');
  });

  it('I1: removed() sets destroyed flag and enrichment no longer calls dispatchChange', async () => {
    const block = createMockBlock();
    const tool = new AudioTool(opts({ url: '' }, {}, block));
    tool.render();
    // Trigger upload path which fires async enrichment
    tool.onPaste({ type: 'file', detail: { file: new File(['x'], 'track.mp3', { type: 'audio/mpeg' }) } } as never);
    // Remove block before enrichment resolves
    tool.removed();
    // Flush all microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The initial applyResult calls dispatchChange once; after removal no further calls
    const callCount = (block.dispatchChange as ReturnType<typeof vi.fn>).mock.calls.length;
    // Advance another tick to ensure enrichment callbacks ran
    await Promise.resolve();
    expect((block.dispatchChange as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    expect((tool as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('I2: null peaks (jsdom) does not call dispatchChange or set peaks', async () => {
    const block = createMockBlock();
    const tool = new AudioTool(opts({ url: '' }, {}, block));
    tool.render();
    tool.onPaste({ type: 'file', detail: { file: new File(['x'], 'track.mp3', { type: 'audio/mpeg' }) } } as never);
    // Flush all microtasks so enrichment callbacks run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tool.save().peaks).toBeUndefined();
    // dispatchChange called exactly once (from applyResult), not again for null peaks
    const dispatchCalls = (block.dispatchChange as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(dispatchCalls).toBe(1);
  });

  it('I3: decoded peaks and duration are cached in data and round-trip through save()', async () => {
    const decodePeaksMock = await getDecodePeaksMock();
    decodePeaksMock.mockResolvedValueOnce({ peaks: [0.1, 0.5, 1], duration: 8 });

    const block = createMockBlock();
    const tool = new AudioTool(opts({ url: '' }, {}, block));
    tool.render();
    tool.onPaste({ type: 'file', detail: { file: new File(['x'], 'track.mp3', { type: 'audio/mpeg' }) } } as never);
    // Flush all microtasks so enrichment callbacks run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tool.save().peaks).toEqual([0.1, 0.5, 1]);
    expect(tool.save().duration).toBe(8);
  });

  it('caption round-trip: blur on [data-role="audio-caption"] updates save().caption', () => {
    const tool = new AudioTool(opts({ url: 'https://x/y.mp3', caption: '' }));
    const root = tool.render();
    const captionEl = root.querySelector<HTMLElement>('[data-role="audio-caption"]');
    expect(captionEl).not.toBeNull();
    captionEl!.textContent = 'My caption';
    captionEl!.dispatchEvent(new Event('blur'));
    expect(tool.save().caption).toBe('My caption');
  });

  const activateSetting = (tool: AudioTool, name: string): void => {
    const flat: { name?: string; onActivate?: () => void; children?: { items?: unknown[] } }[] = [];
    const walk = (arr: unknown[]): void => {
      for (const it of arr) {
        const item = it as { name?: string; onActivate?: () => void; children?: { items?: unknown[] } };
        flat.push(item);
        if (item.children?.items) walk(item.children.items);
      }
    };
    const settings = tool.renderSettings();
    walk(Array.isArray(settings) ? settings : [settings]);
    const target = flat.find((it) => it.name === name);
    if (!target?.onActivate) throw new Error(`no activatable setting named ${name}`);
    target.onActivate();
  };

  it('removing the caption hides the field in edit mode and clears the text', () => {
    setReducedMotion(true);
    const tool = new AudioTool(opts({ url: 'https://x/y.mp3', caption: 'Hello' }));
    const root = tool.render();
    expect(root.querySelector('[data-role="audio-caption"]')).not.toBeNull();

    activateSetting(tool, 'audio-caption'); // toggle off → remove

    // Field gone even though we are in edit mode (not read-only).
    expect(root.querySelector('[data-role="audio-caption"]')).toBeNull();
    const saved = tool.save();
    expect(saved.captionVisible).toBe(false);
    expect(saved.caption).toBeUndefined();
  });

  it('the Caption setting reflects the removed state as inactive', () => {
    setReducedMotion(true);
    const tool = new AudioTool(opts({ url: 'https://x/y.mp3', caption: 'Hello' }));
    tool.render();
    activateSetting(tool, 'audio-caption'); // off
    const settings = tool.renderSettings();
    const flat = Array.isArray(settings) ? settings : [settings];
    const captionItem = flat.find((it) => (it as { name?: string }).name === 'audio-caption') as { isActive?: boolean };
    expect(captionItem.isActive).toBe(false);
  });

  it('re-enabling the caption restores an empty field without resurrecting old text', () => {
    setReducedMotion(true);
    const tool = new AudioTool(opts({ url: 'https://x/y.mp3', caption: 'Hello' }));
    const root = tool.render();
    activateSetting(tool, 'audio-caption'); // off
    activateSetting(tool, 'audio-caption'); // on again

    const captionEl = root.querySelector<HTMLElement>('[data-role="audio-caption"]');
    expect(captionEl).not.toBeNull();
    expect(captionEl!.textContent).toBe('');
    expect(tool.save().captionVisible).toBe(true);
    expect(tool.save().caption).toBeUndefined();
  });

  it('adding the caption animates in without rebuilding the player', () => {
    setReducedMotion(false);
    const tool = new AudioTool(opts({ url: 'https://x/y.mp3', captionVisible: false }));
    const root = tool.render();
    const figureBefore = root.querySelector('[data-role="audio-figure"]');
    expect(root.querySelector('[data-role="audio-caption-row"]')).toBeNull();

    activateSetting(tool, 'audio-caption'); // enable → animate in

    expect(root.querySelector('[data-role="audio-caption-row"]')).not.toBeNull();
    // Same figure instance — the card was not torn down and rebuilt.
    expect(root.querySelector('[data-role="audio-figure"]')).toBe(figureBefore);
    expect(tool.save().captionVisible).toBe(true);
  });

  it('removing the caption collapses the row, then removes it after the transition', () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    try {
      const tool = new AudioTool(opts({ url: 'https://x/y.mp3', caption: 'Hello' }));
      const root = tool.render();
      const figureBefore = root.querySelector('[data-role="audio-figure"]');

      activateSetting(tool, 'audio-caption'); // disable → animate out

      // Row still present, collapsing; data already updated; card not rebuilt.
      const row = root.querySelector<HTMLElement>('[data-role="audio-caption-row"]');
      expect(row).not.toBeNull();
      expect(row!.classList.contains('is-collapsed')).toBe(true);
      expect(tool.save().captionVisible).toBe(false);
      expect(root.querySelector('[data-role="audio-figure"]')).toBe(figureBefore);

      // Once the collapse transition finishes, the row is gone.
      vi.advanceTimersByTime(500);
      expect(root.querySelector('[data-role="audio-caption-row"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('toolbar anchor', () => {
    it('anchors the +/tunes toolbar to the top of the card, not the title row', () => {
      const tool = new AudioTool(opts({ url: 'https://x/y.mp3', title: 'T', artist: 'A' }));
      const root = tool.render();

      const anchor = tool.getToolbarAnchorElement();
      expect(anchor).toBeDefined();
      // The anchor is a dedicated top-of-card marker so the generic positioner
      // centers the gutter buttons flush with the cover art, not on the title.
      expect(anchor?.getAttribute('data-role')).toBe('audio-toolbar-anchor');

      const figure = root.querySelector('[data-role="audio-figure"]');
      expect(figure?.contains(anchor as Node)).toBe(true);
      // It must be the first child so it sits at the very top of the card.
      expect(figure?.firstElementChild).toBe(anchor);
    });
  });
});
