import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachControls, playerTier } from '../../../../src/tools/video/controls';
import { IconDotsHorizontal, IconPlayerSettings } from '../../../../src/components/icons';

interface Harness {
  figure: HTMLElement;
  video: HTMLVideoElement;
  resize(width: number): void;
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

const mount = (width: number): Harness => {
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

  return {
    figure,
    video,
    resize(next: number): void {
      setProp(figure, 'clientWidth', next);
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
