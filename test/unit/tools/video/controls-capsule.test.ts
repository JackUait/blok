import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachControls, playerTier } from '../../../../src/tools/video/controls';
import { IconDotsHorizontal, IconPlayerSettings } from '../../../../src/components/icons';

interface Harness {
  figure: HTMLElement;
  video: HTMLVideoElement;
  resize(width: number, height?: number): void;
  observed(): Element[];
  disconnected(): boolean;
  destroy(): void;
}

const setProp = (el: HTMLElement, key: string, value: unknown): void => {
  Object.defineProperty(el, key, { value, configurable: true, writable: true });
};

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const mount = (width: number, height = 0): Harness => {
  const observer = { callback: (): void => undefined, targets: [] as Element[], disconnected: false };

  class FakeResizeObserver {
    constructor(callback: () => void) {
      observer.callback = callback;
    }
    public observe(target: Element): void {
      observer.targets.push(target);
    }
    public unobserve(): void {}
    public disconnect(): void {
      observer.disconnected = true;
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);

  const figure = document.createElement('figure');
  const video = document.createElement('video');
  setProp(video, 'play', vi.fn().mockResolvedValue(undefined));
  setProp(video, 'pause', vi.fn());
  figure.appendChild(video);
  const slot = document.createElement('div');
  slot.appendChild(figure);
  document.body.appendChild(slot);
  setProp(figure, 'clientWidth', width);
  const { element, destroy } = attachControls({ video, figure });
  figure.appendChild(element);
  // The overlay is measured once it is in the page, as in a browser.
  setProp(element, 'clientHeight', height);
  observer.callback();

  return {
    figure,
    video,
    resize(next: number, nextHeight = 0): void {
      setProp(figure, 'clientWidth', next);
      setProp(element, 'clientHeight', nextHeight);
      observer.callback();
    },
    observed: () => observer.targets,
    disconnected: () => observer.disconnected,
    destroy,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('video controls — playerTier', () => {
  it('keeps the full bar from 400px up', () => {
    expect(playerTier(400)).toBe('full');
    expect(playerTier(1200)).toBe('full');
  });

  it('steps down at 400, 260 and 180', () => {
    expect(playerTier(399)).toBe('compact');
    expect(playerTier(260)).toBe('compact');
    expect(playerTier(259)).toBe('small');
    expect(playerTier(180)).toBe('small');
    expect(playerTier(179)).toBe('tiny');
    expect(playerTier(1)).toBe('tiny');
  });

  it('treats a player with no measured width as full', () => {
    expect(playerTier(0)).toBe('full');
  });
});

describe('video controls — capsule tier', () => {
  it('leaves a wide player on the full bar', () => {
    const h = mount(640);

    expect(h.figure.getAttribute('data-tier')).toBe('full');
    expect(h.figure.hasAttribute('data-capsule')).toBe(false);
    h.destroy();
  });

  it('marks a narrow player as a capsule, by tier', () => {
    const h = mount(320);

    expect(h.figure.hasAttribute('data-capsule')).toBe(true);
    expect(h.figure.getAttribute('data-tier')).toBe('compact');
    h.destroy();
  });

  it('follows the player as it is resized, both ways', () => {
    const h = mount(640);

    expect(h.observed()).toContain(h.figure);
    h.resize(200);
    expect(h.figure.getAttribute('data-tier')).toBe('small');
    expect(h.figure.hasAttribute('data-capsule')).toBe(true);
    h.resize(150);
    expect(h.figure.getAttribute('data-tier')).toBe('tiny');
    h.resize(640);
    expect(h.figure.getAttribute('data-tier')).toBe('full');
    expect(h.figure.hasAttribute('data-capsule')).toBe(false);
    h.destroy();
  });

  it('stops watching the size when destroyed', () => {
    const h = mount(320);

    h.destroy();
    expect(h.disconnected()).toBe(true);
  });

  it('closes the settings card when the tier changes, since its button may be gone', () => {
    const h = mount(320);
    const menu = q(h.figure, '[data-role="playback-menu"]');

    q(h.figure, '[data-action="gear"]').click();
    expect(menu.hidden).toBe(false);
    h.resize(200);

    expect(menu.hidden).toBe(true);
    h.destroy();
  });

  it('draws the settings button as three dots in a capsule, and as a gear on the full bar', () => {
    const h = mount(320);
    const gear = q(h.figure, '[data-action="gear"]');
    const svgOf = (icon: string): string => {
      const probe = document.createElement('span');

      probe.innerHTML = icon;

      return probe.innerHTML;
    };

    expect(gear.innerHTML).toBe(svgOf(IconDotsHorizontal));
    h.resize(640);
    expect(gear.innerHTML).toBe(svgOf(IconPlayerSettings));
    h.destroy();
  });
});

describe('video controls — time label parts', () => {
  it('keeps the elapsed and total times in separate parts, so a capsule can show only the first', () => {
    const h = mount(320);
    const time = q(h.figure, '[data-role="time"]');

    setProp(h.video, 'duration', 72);
    setProp(h.video, 'currentTime', 5);
    h.video.dispatchEvent(new Event('timeupdate'));

    expect(q(time, '[data-role="time-current"]').textContent).toBe('0:05');
    expect(q(time, '[data-role="time-total"]').textContent).toBe(' / 1:12');
    expect(time.textContent).toBe('0:05 / 1:12');
    h.destroy();
  });

  it('shows the remaining time in the first part and empties the total', () => {
    const h = mount(320);
    const time = q(h.figure, '[data-role="time"]');

    setProp(h.video, 'duration', 72);
    setProp(h.video, 'currentTime', 5);
    time.click();

    expect(q(time, '[data-role="time-current"]').textContent).toBe('-1:07');
    expect(q(time, '[data-role="time-total"]').textContent).toBe('');
    h.destroy();
  });
});

describe('video controls — folded view modes in the settings card', () => {
  it('offers theater mode in the settings card, and enters it', () => {
    const h = mount(320);
    const menu = q(h.figure, '[data-role="playback-menu"]');

    q(h.figure, '[data-action="gear"]').click();
    expect(menu.hidden).toBe(false);
    q(menu, '[data-action="menu-theater"]').click();

    expect(h.figure.getAttribute('data-theater')).toBe('true');
    expect(menu.hidden).toBe(true);
    h.destroy();
  });

  it('offers picture-in-picture in the settings card only where the browser has it', () => {
    const without = mount(320);

    expect(without.figure.querySelector('[data-action="menu-pip"]')).toBeNull();
    without.destroy();
    document.body.innerHTML = '';

    setProp(document as unknown as HTMLElement, 'pictureInPictureEnabled', true);
    const withPip = mount(320);
    const request = vi.fn().mockResolvedValue(undefined);

    setProp(withPip.video, 'requestPictureInPicture', request);
    q(withPip.figure, '[data-action="gear"]').click();
    q(withPip.figure, '[data-action="menu-pip"]').click();

    expect(request).toHaveBeenCalledTimes(1);
    expect(q(withPip.figure, '[data-role="playback-menu"]').hidden).toBe(true);
    withPip.destroy();
    setProp(document as unknown as HTMLElement, 'pictureInPictureEnabled', false);
  });
});

describe('video controls — the flash on a small player', () => {
  const play = (h: Harness): HTMLElement => q(h.figure, '[data-action="play-toggle"]');
  const burst = (h: Harness): HTMLElement => q(h.figure, '[data-role="play-burst"]');

  it('keeps the centre flash on a capsule with room for it', () => {
    const h = mount(320, 240);

    expect(h.figure.hasAttribute('data-flash')).toBe(false);
    play(h).click();

    expect(burst(h).classList.contains('is-active')).toBe(true);
    expect(play(h).classList.contains('is-pop')).toBe(false);
    h.destroy();
  });

  it('pops the play button instead under 182px tall, where the flash would touch the capsule', () => {
    const h = mount(320, 181);

    expect(h.figure.getAttribute('data-flash')).toBe('pop');
    play(h).click();

    expect(burst(h).classList.contains('is-active')).toBe(false);
    expect(play(h).classList.contains('is-pop')).toBe(true);
    h.destroy();
  });

  it('keeps the flash at exactly 182px tall', () => {
    const h = mount(320, 182);

    expect(h.figure.hasAttribute('data-flash')).toBe(false);
    h.destroy();
  });

  it('pops under 180px wide whatever the height', () => {
    const h = mount(170, 400);

    expect(h.figure.getAttribute('data-flash')).toBe('pop');
    h.destroy();
  });

  it('never pops on the full bar, however short', () => {
    const h = mount(640, 120);

    expect(h.figure.hasAttribute('data-flash')).toBe(false);
    play(h).click();
    expect(burst(h).classList.contains('is-active')).toBe(true);
    h.destroy();
  });

  it('clears the pop when its animation ends, and a flash left over when the player shrinks', () => {
    const h = mount(320, 240);

    play(h).click();
    h.resize(320, 120);
    expect(burst(h).classList.contains('is-active')).toBe(false);
    play(h).click();
    play(h).dispatchEvent(new Event('animationend'));

    expect(play(h).classList.contains('is-pop')).toBe(false);
    h.destroy();
  });

  it('follows the height when only the height changes', () => {
    const h = mount(320, 240);

    h.resize(320, 150);
    expect(h.figure.getAttribute('data-flash')).toBe('pop');
    h.resize(320, 240);
    expect(h.figure.hasAttribute('data-flash')).toBe(false);
    h.destroy();
  });
});

describe('video controls — the settings sheet in a capsule', () => {
  const menu = (h: Harness): HTMLElement => q(h.figure, '[data-role="playback-menu"]');
  const sheet = (h: Harness): HTMLElement => q(h.figure, '[data-role="menu-sheet"]');
  const open = (h: Harness): void => q(h.figure, '[data-action="gear"]').click();

  it('opens the card inside the video frame, not on the figure', () => {
    const h = mount(320, 240);

    open(h);

    expect(sheet(h).hidden).toBe(false);
    expect(sheet(h).contains(menu(h))).toBe(true);
    expect(q(h.figure, '.blok-video-controls').contains(sheet(h))).toBe(true);
    h.destroy();
  });

  it('leaves the card on the figure on the full bar, with the sheet shut', () => {
    const h = mount(640, 360);

    open(h);

    expect(menu(h).parentElement).toBe(h.figure);
    expect(sheet(h).hidden).toBe(true);
    h.destroy();
  });

  it('moves the card back to the figure when the player grows to the full bar', () => {
    const h = mount(320, 240);

    h.resize(640, 360);
    open(h);

    expect(menu(h).parentElement).toBe(h.figure);
    expect(sheet(h).hidden).toBe(true);
    h.destroy();
  });

  it('does not anchor the card to the button by hand in a capsule', () => {
    const h = mount(320, 240);

    open(h);

    expect(menu(h).style.bottom).toBe('');
    expect(menu(h).style.left).toBe('');
    expect(menu(h).style.right).toBe('');
    h.destroy();
  });

  it('rises from the bottom from 216px tall, and takes the whole frame below', () => {
    const tall = mount(320, 216);

    expect(tall.figure.getAttribute('data-sheet')).toBe('panel');
    tall.resize(320, 215);
    expect(tall.figure.getAttribute('data-sheet')).toBe('frame');
    tall.resize(640, 360);
    expect(tall.figure.hasAttribute('data-sheet')).toBe(false);
    tall.destroy();
  });

  it('treats an unmeasured height as tall', () => {
    const h = mount(320);

    expect(h.figure.getAttribute('data-sheet')).toBe('panel');
    expect(h.figure.getAttribute('data-sheet-content')).toBe('rows');
    expect(h.figure.hasAttribute('data-flash')).toBe(false);
    h.destroy();
  });

  it('swaps the rows for tiles under 180px wide or under 146px tall', () => {
    const h = mount(320, 146);

    expect(h.figure.getAttribute('data-sheet-content')).toBe('rows');
    h.resize(320, 145);
    expect(h.figure.getAttribute('data-sheet-content')).toBe('tiles');
    h.resize(179, 300);
    expect(h.figure.getAttribute('data-sheet-content')).toBe('tiles');
    h.resize(180, 300);
    expect(h.figure.getAttribute('data-sheet-content')).toBe('rows');
    h.destroy();
  });

  it('tightens the rows under 300px wide', () => {
    const h = mount(300, 300);

    expect(h.figure.hasAttribute('data-sheet-rows')).toBe(false);
    h.resize(299, 300);
    expect(h.figure.getAttribute('data-sheet-rows')).toBe('tight');
    h.destroy();
  });

  it('closes from the close button and hands focus back to the three dots', () => {
    const h = mount(320, 240);

    open(h);
    q(h.figure, '[data-action="menu-close"]').click();

    expect(sheet(h).hidden).toBe(true);
    expect(menu(h).hidden).toBe(true);
    expect(q(h.figure, '[data-action="gear"]')).toHaveFocus();
    h.destroy();
  });

  it('closes on a press on the dimmed picture around the card', () => {
    const h = mount(320, 240);

    open(h);
    sheet(h).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(sheet(h).hidden).toBe(true);
    h.destroy();
  });

  it('stays open on a press inside the card', () => {
    const h = mount(320, 240);

    open(h);
    q(h.figure, '[data-action="loop"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(sheet(h).hidden).toBe(false);
    h.destroy();
  });

  it('closes on Escape', () => {
    const h = mount(320, 240);

    open(h);
    menu(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(sheet(h).hidden).toBe(true);
    h.destroy();
  });

  it('shuts the sheet when the tier changes', () => {
    const h = mount(320, 240);

    open(h);
    h.resize(200, 240);

    expect(sheet(h).hidden).toBe(true);
    h.destroy();
  });

  it('shuts the sheet when rows turn into tiles under it', () => {
    const h = mount(320, 240);

    open(h);
    h.resize(320, 120);

    expect(sheet(h).hidden).toBe(true);
    h.destroy();
  });
});

describe('video controls — the settings tiles on the smallest players', () => {
  const tile = (h: Harness, action: string): HTMLElement => q(h.figure, `[data-role="menu-tiles"] [data-action="${action}"]`);
  const openTiles = (): Harness => {
    const h = mount(150, 200);

    q(h.figure, '[data-action="gear"]').click();

    return h;
  };

  it('steps the speed through the presets and wraps around', () => {
    const h = openTiles();

    expect(tile(h, 'tile-speed').textContent).toBe('1×');
    tile(h, 'tile-speed').click();
    expect(h.video.playbackRate).toBe(1.5);
    expect(tile(h, 'tile-speed').textContent).toBe('1.5×');
    tile(h, 'tile-speed').click();
    tile(h, 'tile-speed').click();

    expect(h.video.playbackRate).toBe(0.25);
    h.destroy();
  });

  it('steps up from a speed that is between two presets', () => {
    const h = openTiles();

    q(h.figure, '[data-action="speed-increase"]').click();
    const between = h.video.playbackRate;

    expect(between).toBeGreaterThan(1);
    expect(between).toBeLessThan(1.5);
    tile(h, 'tile-speed').click();

    expect(h.video.playbackRate).toBe(1.5);
    h.destroy();
  });

  it('turns loop on and off, in step with the loop row', () => {
    const h = openTiles();

    tile(h, 'tile-loop').click();

    expect(h.video.loop).toBe(true);
    expect(tile(h, 'tile-loop').getAttribute('aria-checked')).toBe('true');
    expect(q(h.figure, '[data-action="loop"]').getAttribute('aria-checked')).toBe('true');
    q(h.figure, '[data-action="loop"]').click();

    expect(tile(h, 'tile-loop').getAttribute('aria-checked')).toBe('false');
    h.destroy();
  });

  it('carries sound, since the mute button is gone at this size', () => {
    const h = openTiles();

    expect(tile(h, 'tile-sound').getAttribute('aria-checked')).toBe('true');
    tile(h, 'tile-sound').click();
    h.video.dispatchEvent(new Event('volumechange'));

    expect(h.video.muted).toBe(true);
    expect(tile(h, 'tile-sound').getAttribute('aria-checked')).toBe('false');
    expect(tile(h, 'tile-sound').getAttribute('aria-label')).toBe('Unmute');
    h.destroy();
  });

  it('enters theater mode and shuts the sheet', () => {
    const h = openTiles();

    tile(h, 'tile-theater').click();

    expect(h.figure.getAttribute('data-theater')).toBe('true');
    expect(q(h.figure, '[data-role="menu-sheet"]').hidden).toBe(true);
    h.destroy();
  });

  it('has a close tile that shuts the sheet and hands focus back', () => {
    const h = openTiles();

    tile(h, 'tile-close').click();

    expect(q(h.figure, '[data-role="menu-sheet"]').hidden).toBe(true);
    expect(q(h.figure, '[data-action="gear"]')).toHaveFocus();
    h.destroy();
  });

  it('offers picture-in-picture only where the browser has it', () => {
    const without = openTiles();

    expect(without.figure.querySelector('[data-action="tile-pip"]')).toBeNull();
    without.destroy();
    document.body.innerHTML = '';

    setProp(document as unknown as HTMLElement, 'pictureInPictureEnabled', true);
    const withPip = openTiles();
    const request = vi.fn().mockResolvedValue(undefined);

    setProp(withPip.video, 'requestPictureInPicture', request);
    tile(withPip, 'tile-pip').click();

    expect(request).toHaveBeenCalledTimes(1);
    withPip.destroy();
    setProp(document as unknown as HTMLElement, 'pictureInPictureEnabled', false);
  });

  it('keeps the close tile last, after picture-in-picture', () => {
    setProp(document as unknown as HTMLElement, 'pictureInPictureEnabled', true);
    const h = openTiles();
    const order = [...q(h.figure, '[data-role="menu-tiles"]').children].map((n) => n.getAttribute('data-action'));

    expect(order).toEqual(['tile-speed', 'tile-loop', 'tile-sound', 'tile-theater', 'tile-pip', 'tile-close']);
    h.destroy();
    setProp(document as unknown as HTMLElement, 'pictureInPictureEnabled', false);
  });
});
