import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachControls } from '../../../../src/tools/audio/controls';
import { volumeLevelIcon } from '../../../../src/components/utils/volume-icon';
import { IconPlayerVolumeMute } from '../../../../src/components/icons';

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
  // A native range reverses in RTL while its painted fill runs left to right,
  // and the waveform seeks left to right, so the sliders read LTR too.
  it('pins every slider to LTR', () => {
    const figure = document.createElement('figure');
    const h = attachControls({ media: makeMedia(), figure, data: { url: 'u' } });
    const ranges = Array.from(h.element.querySelectorAll('input[type="range"]'));

    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(ranges.map((range) => range.getAttribute('dir'))).toEqual(ranges.map(() => 'ltr'));
    h.destroy();
  });

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

    const presets = h.element.querySelectorAll('.blok-audio-controls__speed-preset');
    (presets[4] as HTMLButtonElement).click(); // 2× preset

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

  it('draws the speaker icon for the current volume', async () => {
    const media = makeMedia();
    const figure = document.createElement('figure');
    const h = attachControls({ media, figure, data: { url: 'u' } });
    const volume = h.element.querySelector('[data-role="audio-volume"]') as HTMLInputElement;
    const mute = h.element.querySelector('[data-role="audio-mute"]') as HTMLButtonElement;
    const drawn = (svg: string): string => {
      const holder = document.createElement('div');

      holder.innerHTML = svg;

      return holder.innerHTML;
    };

    volume.value = '0.25';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(mute.innerHTML).toBe(drawn(volumeLevelIcon(0.25))));

    volume.value = '0.8';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(mute.innerHTML).toBe(drawn(volumeLevelIcon(0.8))));

    mute.click();
    await vi.waitFor(() => expect(mute.innerHTML).toBe(drawn(IconPlayerVolumeMute)));

    mute.click();
    await vi.waitFor(() => expect(mute.innerHTML).toBe(drawn(volumeLevelIcon(0.8))));
    h.destroy();
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
    const presets = ha.element.querySelectorAll('.blok-audio-controls__speed-preset');
    (presets[3] as HTMLButtonElement).click(); // 1.5× preset
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

  it('keeps the loop from block data when the stored preference is not restored', () => {
    const storage = memoryStorage();
    storage.setItem('blok:audio:loop', 'true');
    const media = makeMedia();
    const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' }, storage, restoreLoop: false });
    expect(media.loop).toBe(false);
    expect(h.element.querySelector('[data-role="audio-loop"]')!.getAttribute('aria-pressed')).toBe('false');
    h.destroy();
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

  describe('seek slider', () => {
    const seekOf = (el: HTMLElement): HTMLInputElement => {
      const seek = el.querySelector('[data-role="audio-seek"]');

      if (!(seek instanceof HTMLInputElement)) throw new Error('no seek slider');

      return seek;
    };

    it('is a labelled range that starts at the beginning', () => {
      const h = attachControls({ media: makeMedia(), figure: document.createElement('figure'), data: { url: 'u' } });
      const seek = seekOf(h.element);

      expect(seek.type).toBe('range');
      expect(seek.getAttribute('aria-label')).toBe('Seek');
      expect(seek.value).toBe('0');
      h.destroy();
    });

    it('moves the track to the dragged position', () => {
      const media = makeMedia();
      const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
      const seek = seekOf(h.element);

      seek.value = '0.25';
      seek.dispatchEvent(new Event('input', { bubbles: true }));

      expect(media.currentTime).toBeCloseTo(50, 5);
      expect(seek.style.getPropertyValue('--blok-audio-seek-pct')).toBe('25%');
      h.destroy();
    });

    it('follows the track as it plays and reads the position out as a time', () => {
      const media = makeMedia();
      const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
      const seek = seekOf(h.element);

      media.currentTime = 100;
      media.dispatchEvent(new Event('timeupdate'));

      expect(Number(seek.value)).toBeCloseTo(0.5, 5);
      expect(seek.style.getPropertyValue('--blok-audio-seek-pct')).toBe('50%');
      expect(seek.getAttribute('aria-valuetext')).toBe('01:40 / 03:20');
      h.destroy();
    });

    describe('between time updates', () => {
      const frames = new Map<number, FrameRequestCallback>();
      const ids = { next: 1 };
      const runFrame = (): void => {
        const pending = Array.from(frames.values());

        frames.clear();
        pending.forEach((frame) => frame(0));
      };

      beforeEach(() => {
        frames.clear();
        vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
          const id = ids.next++;

          frames.set(id, frame);

          return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
      });
      afterEach(() => vi.unstubAllGlobals());

      it('glides with the track on every frame while it plays', () => {
        const media = makeMedia();
        const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
        const seek = seekOf(h.element);

        media.dispatchEvent(new Event('play'));
        media.currentTime = 50.05;
        runFrame();

        expect(Number(seek.value)).toBeCloseTo(0.25025, 6);
        expect(seek.style.getPropertyValue('--blok-audio-seek-pct')).toBe('25.025%');

        media.currentTime = 50.1;
        runFrame();

        expect(Number(seek.value)).toBeCloseTo(0.2505, 6);
        h.destroy();
      });

      it('holds still on frames once the track pauses', () => {
        const media = makeMedia();
        const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
        const seek = seekOf(h.element);

        media.dispatchEvent(new Event('play'));
        media.dispatchEvent(new Event('pause'));
        media.currentTime = 50;
        runFrame();
        runFrame();

        expect(seek.value).toBe('0');
        h.destroy();
      });

      it('holds still on frames after destroy', () => {
        const media = makeMedia();
        const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
        const seek = seekOf(h.element);

        media.dispatchEvent(new Event('play'));
        h.destroy();
        media.currentTime = 50;
        runFrame();

        expect(seek.value).toBe('0');
      });

      it('waits for time updates under reduced motion', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        const media = makeMedia();
        const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
        const seek = seekOf(h.element);

        media.dispatchEvent(new Event('play'));
        media.currentTime = 50;
        runFrame();

        expect(seek.value).toBe('0');
        h.destroy();
      });
    });

    it('stays at the start and does not seek while the track has no length', () => {
      const media = makeMedia();

      Object.defineProperty(media, 'duration', { value: NaN, configurable: true });
      const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
      const seek = seekOf(h.element);

      seek.value = '0.5';
      seek.dispatchEvent(new Event('input', { bubbles: true }));

      expect(media.currentTime).toBe(0);
      expect(seek.value).toBe('0');
      h.destroy();
    });

    it('stops seeking after destroy', () => {
      const media = makeMedia();
      const h = attachControls({ media, figure: document.createElement('figure'), data: { url: 'u' } });
      const seek = seekOf(h.element);

      h.destroy();
      seek.value = '0.5';
      seek.dispatchEvent(new Event('input', { bubbles: true }));

      expect(media.currentTime).toBe(0);
    });
  });
});

// The speed card is the video player's: a big value between − and +, a bead on a
// wire with a peg per preset, and one plain button under each peg.
describe('attachControls — speed card', () => {
  const one = <T extends Element>(root: Element, selector: string): T => {
    const found = root.querySelector<T>(selector);

    if (!found) throw new Error(`missing ${selector}`);

    return found;
  };
  const open = (storage = memoryStorage()) => {
    const media = makeMedia();
    const figure = document.createElement('figure');

    document.body.appendChild(figure);

    const h = attachControls({ media, figure, data: { url: 'u' }, storage });

    figure.appendChild(h.element);

    const menu = one<HTMLElement>(h.element, '.blok-audio-controls__speed-menu');
    const wire = one<HTMLElement>(menu, '.blok-audio-controls__speed-wire');
    const [dec, inc] = [...menu.querySelectorAll<HTMLButtonElement>('.blok-audio-controls__speed-step')];

    return {
      h, media, menu, wire, dec, inc,
      gear: one<HTMLButtonElement>(h.element, '[data-role="audio-speed"]'),
      stepper: one<HTMLElement>(menu, '.blok-audio-controls__speed-stepper'),
      readout: one<HTMLElement>(menu, '.blok-audio-controls__speed-readout'),
      digits: (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('.blok-audio-controls__speed-digit')],
      slider: one<HTMLInputElement>(wire, '.blok-audio-controls__speed-slider'),
      presetRow: one<HTMLElement>(menu, '.blok-audio-controls__speed-presets'),
      presets: [...menu.querySelectorAll<HTMLButtonElement>('.blok-audio-controls__speed-preset')],
    };
  };
  const press = (target: Element, type: string): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  };

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('stacks the value line, the wire and the presets', () => {
    const ui = open();

    expect([...ui.menu.children]).toEqual([ui.stepper, ui.wire, ui.presetRow]);
    expect([...ui.stepper.children]).toEqual([ui.dec, ui.readout, ui.inc]);
    expect(ui.readout.textContent).toBe('1×');
    expect(one(ui.readout, '.blok-audio-controls__speed-readout-unit').textContent).toBe('×');
    expect(ui.wire.querySelectorAll('.blok-audio-controls__wire-peg')).toHaveLength(5);
    expect(one(ui.wire, '.blok-audio-controls__wire-bead')).toBeTruthy();
    ui.h.destroy();
  });

  it('puts one preset under each of the five pegs, evenly spaced', () => {
    const ui = open();

    expect(ui.presets.map((preset) => preset.textContent)).toEqual(['0.25×', '0.5×', '1×', '1.5×', '2×']);
    expect(ui.presets.map((preset) => preset.style.getPropertyValue('--blok-audio-speed-at')))
      .toEqual(['0', '0.25', '0.5', '0.75', '1']);
    expect(ui.presetRow.dir).toBe('ltr');
    ui.h.destroy();
  });

  it('sets the slowest preset and never marks a preset as selected', () => {
    const ui = open();

    ui.presets[0].click();

    expect(ui.media.playbackRate).toBe(0.25);
    expect(ui.presets.map((preset) => preset.getAttributeNames().filter((name) => /pressed|selected|checked|current/.test(name))))
      .toEqual([[], [], [], [], []]);
    ui.h.destroy();
  });

  it('follows a drag along the wire', () => {
    const ui = open();

    ui.gear.click();
    vi.spyOn(ui.wire, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 62));
    // 26 + 0.75 * 188: the 1.5× peg in the wire's 240-wide drawing.
    ui.wire.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 167, clientY: 31 }));

    expect(ui.media.playbackRate).toBe(1.5);
    expect(ui.readout.textContent).toBe('1.5×');
    ui.h.destroy();
  });

  it('rolls in only the digits that changed, from the side the value came from', () => {
    const ui = open();

    expect(ui.digits().map((digit) => digit.getAttribute('data-roll'))).toEqual([null]);

    ui.presets[3].click();
    expect(ui.digits().map((digit) => [digit.textContent, digit.getAttribute('data-roll')]))
      .toEqual([['1', null], ['.', 'up'], ['5', 'up']]);

    ui.presets[1].click();
    expect(ui.digits().map((digit) => [digit.textContent, digit.getAttribute('data-roll')]))
      .toEqual([['0', 'down'], ['.', null], ['5', null]]);
    ui.h.destroy();
  });

  it('steps once on a press and keeps stepping while the button is held', () => {
    vi.useFakeTimers();

    const ui = open();

    press(ui.inc, 'pointerdown');
    expect(ui.media.playbackRate).toBe(1.05);

    vi.advanceTimersByTime(349);
    expect(ui.media.playbackRate).toBe(1.05);

    vi.advanceTimersByTime(1 + 70 * 3);
    expect(ui.media.playbackRate).toBe(1.2);

    press(ui.inc, 'pointerup');
    // The click that ends a pointer press must not step again.
    ui.inc.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    vi.advanceTimersByTime(1000);
    expect(ui.media.playbackRate).toBe(1.2);
    ui.h.destroy();
  });

  it('ends a hold at the end of the range, when the menu closes and on destroy', () => {
    vi.useFakeTimers();

    const ui = open();

    ui.presets[4].click();
    ui.presets[3].click();
    press(ui.inc, 'pointerdown');
    vi.advanceTimersByTime(5000);
    expect(ui.media.playbackRate).toBe(3);
    expect(ui.inc.disabled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    ui.gear.click();
    press(ui.dec, 'pointerdown');
    ui.gear.click();
    vi.advanceTimersByTime(5000);
    expect(ui.media.playbackRate).toBe(2.95);

    press(ui.dec, 'pointerdown');
    ui.h.destroy();
    vi.advanceTimersByTime(5000);
    expect(ui.media.playbackRate).toBe(2.9);
  });

  describe('typing a speed into the big number', () => {
    const typeSpeed = (ui: ReturnType<typeof open>, text: string): HTMLInputElement => {
      ui.readout.click();
      const field = one<HTMLInputElement>(ui.menu, '.blok-audio-controls__speed-entry-input');
      field.value = text;
      return field;
    };
    const enter = (el: Element): void => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    };

    it('takes a typed speed past the presets, from 0.1x up to 3x', () => {
      const ui = open();

      ui.gear.click();
      enter(typeSpeed(ui, '2.7'));
      expect(ui.media.playbackRate).toBe(2.7);
      expect(ui.readout.textContent).toBe('2.7×');
      expect(ui.slider.value).toBe('2');

      enter(typeSpeed(ui, '0,1'));
      expect(ui.media.playbackRate).toBe(0.1);
      expect(ui.dec.disabled).toBe(true);

      enter(typeSpeed(ui, '9'));
      expect(ui.media.playbackRate).toBe(3);
      expect(ui.inc.disabled).toBe(true);
      ui.h.destroy();
    });

    it('lets digits be typed: the player\'s 0-9 seek keys stay out of the field', () => {
      const ui = open();

      Object.defineProperty(ui.media, 'duration', { value: 100, configurable: true });
      ui.media.currentTime = 10;
      ui.gear.click();

      const field = typeSpeed(ui, '');
      const digit = new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true });

      field.dispatchEvent(digit);

      expect(digit.defaultPrevented).toBe(false);
      expect(ui.media.currentTime).toBe(10);
      ui.h.destroy();
    });

    it('keeps a typed speed when the card closes from a click outside', () => {
      const ui = open();

      ui.gear.click();
      typeSpeed(ui, '2.5');
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

      expect(ui.menu.hidden).toBe(true);
      expect(ui.media.playbackRate).toBe(2.5);
      ui.h.destroy();
    });

    it('keeps a typed speed when the gear closes the card', () => {
      const ui = open();

      ui.gear.click();
      typeSpeed(ui, '2.5');
      ui.gear.click();

      expect(ui.menu.hidden).toBe(true);
      expect(ui.media.playbackRate).toBe(2.5);
      ui.h.destroy();
    });

    it('steps from the typed speed when minus is pressed while the field is open', () => {
      const ui = open();

      ui.gear.click();
      typeSpeed(ui, '2.5');
      press(ui.dec, 'pointerdown');
      press(ui.dec, 'pointerup');

      expect(ui.media.playbackRate).toBe(2.45);
      ui.h.destroy();
    });

    it('remembers a typed speed for the next player', () => {
      const storage = memoryStorage();
      const ui = open(storage);

      ui.gear.click();
      enter(typeSpeed(ui, '2.75'));
      ui.h.destroy();

      expect(open(storage).media.playbackRate).toBe(2.75);
    });
  });

  it('moves the wire only while the card is open', () => {
    vi.useFakeTimers();

    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
    const ui = open();

    ui.presets[4].click();
    expect(frames).not.toHaveBeenCalled();

    ui.gear.click();
    ui.presets[2].click();
    expect(frames).toHaveBeenCalled();

    ui.gear.click();
    frames.mockClear();
    vi.advanceTimersByTime(1000);
    ui.presets[4].click();
    expect(frames).not.toHaveBeenCalled();
    ui.h.destroy();
  });

  it('slides the card back inside the window when it would cross an edge', () => {
    const ui = open();

    Object.defineProperty(document.documentElement, 'clientWidth', { value: 400, configurable: true });
    const box = vi.spyOn(ui.menu, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 0, 264, 160));

    ui.gear.click();
    expect(ui.menu.style.getPropertyValue('translate')).toBe('-72px');

    ui.gear.click();
    box.mockReturnValue(new DOMRect(-30, 0, 264, 160));
    ui.gear.click();
    expect(ui.menu.style.getPropertyValue('translate')).toBe('38px');

    ui.gear.click();
    box.mockReturnValue(new DOMRect(50, 0, 264, 160));
    ui.gear.click();
    expect(ui.menu.style.getPropertyValue('translate')).toBe('');
    ui.h.destroy();
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
  });
});
