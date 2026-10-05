import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dissolve, DUST_MS, DUST_LIFE_MS } from '../../../../src/components/utils/notifier/dust';

const fakeContext = (): Record<string, unknown> => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([ 120, 40, 200, 255 ]) })),
  globalAlpha: 1,
  fillStyle: '',
});

const mount = (): { host: HTMLElement; card: HTMLElement } => {
  const host = document.createElement('div');
  const card = document.createElement('div');

  card.setAttribute('data-blok-toast', 'card');
  host.append(card);
  document.body.append(host);
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 500, 400, 60));
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 492, 400, 68));

  return { host, card };
};

const motion = (reduce: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }),
  });
};

describe('notifier dust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    motion(false);
    vi.stubGlobal('CanvasRenderingContext2D', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
    document.body.innerHTML = '';
  });

  it('leaves the card alone when the user asks for reduced motion', () => {
    motion(true);
    const { card } = mount();
    const gone = vi.fn();

    expect(dissolve(card, gone)).toBe(false);
    expect(card.hasAttribute('data-blok-toast-dust')).toBe(false);
  });

  it('sweeps the card away from its close side, then removes it', () => {
    const { card } = mount();
    const gone = vi.fn();

    expect(dissolve(card, gone)).toBe(true);
    expect(card.getAttribute('data-blok-toast-dust')).toBe('ltr');

    vi.advanceTimersByTime(DUST_MS - 1);
    expect([ card.isConnected, gone.mock.calls.length ]).toEqual([ true, 0 ]);

    vi.advanceTimersByTime(1);
    expect([ card.isConnected, gone.mock.calls.length ]).toEqual([ false, 0 ]);

    vi.advanceTimersByTime(DUST_LIFE_MS);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says when the card has left the layout, before its dust settles', () => {
    const { card } = mount();
    const removed = vi.fn();

    dissolve(card, vi.fn(), removed);
    vi.advanceTimersByTime(DUST_MS - 1);
    expect(removed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('sweeps from the left in a right-to-left card, where the close button sits', () => {
    const { card } = mount();

    card.style.direction = 'rtl';
    dissolve(card, vi.fn());

    expect(card.getAttribute('data-blok-toast-dust')).toBe('rtl');
  });

  it('paints the dust on a canvas that does not catch the pointer or reach assistive tech, and clears it', () => {
    const { host, card } = mount();

    dissolve(card, vi.fn());
    const canvas = host.querySelector('canvas');

    expect([ canvas?.getAttribute('aria-hidden'), canvas?.style.pointerEvents, canvas?.hasAttribute('data-blok-testid') ])
      .toEqual([ 'true', 'none', false ]);

    vi.advanceTimersByTime(DUST_MS + DUST_LIFE_MS);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('still sweeps the card away where there is no canvas', () => {
    vi.unstubAllGlobals();
    const { host, card } = mount();
    const gone = vi.fn();

    expect(dissolve(card, gone)).toBe(true);
    expect(host.querySelector('canvas')).toBeNull();

    vi.advanceTimersByTime(DUST_MS);
    expect(card.isConnected).toBe(false);
  });
});
