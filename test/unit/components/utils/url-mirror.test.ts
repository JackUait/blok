import { describe, it, expect } from 'vitest';
import { createUrlMirror } from '../../../../src/components/utils/url-mirror';

interface Setup {
  input: HTMLInputElement;
  mirror: ReturnType<typeof createUrlMirror>;
  type: (value: string) => void;
}

const setup = (): Setup => {
  const input = document.createElement('input');
  const mirror = createUrlMirror(input);

  document.body.append(mirror.element, input);

  return {
    input,
    mirror,
    type: (value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  };
};

const parts = (mirror: ReturnType<typeof createUrlMirror>): Array<[string, string]> =>
  Array.from(mirror.element.querySelectorAll('[class^="blok-media-empty__url-"]'))
    .map((span) => [span.className.replace('blok-media-empty__url-', ''), span.textContent ?? '']);

describe('url mirror', () => {
  it('colours a typed link the way an address bar does', () => {
    const { mirror, type } = setup();

    type('https://www.youtube.com/watch?v=1');

    expect(parts(mirror)).toEqual([
      ['proto', 'https://'],
      ['www', 'www.'],
      ['host', 'youtube.com'],
      ['path', '/watch?v=1'],
    ]);
  });

  it('draws only the parts the text has', () => {
    const { mirror, type } = setup();

    type('vimeo.com');

    expect(parts(mirror)).toEqual([['host', 'vimeo.com']]);
  });

  it('hides the input text so only the mirror shows, and keeps the mirror out of the a11y tree', () => {
    const { input, mirror } = setup();

    expect(input.classList.contains('blok-media-empty__embed-input--mirrored')).toBe(true);
    expect(mirror.element.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows the input when a long link scrolls', () => {
    const { input, mirror } = setup();

    Object.defineProperty(input, 'scrollLeft', { configurable: true, value: 42 });
    input.dispatchEvent(new Event('scroll'));

    expect(mirror.element.firstElementChild?.getAttribute('style')).toContain('--scroll: 42');
  });

  it('hazes only the sides a long link runs past', () => {
    const { input, mirror } = setup();
    const measure = (scrollLeft: number): void => {
      Object.defineProperty(input, 'scrollLeft', { configurable: true, value: scrollLeft });
      Object.defineProperty(input, 'scrollWidth', { configurable: true, value: 300 });
      Object.defineProperty(input, 'clientWidth', { configurable: true, value: 200 });
      input.dispatchEvent(new Event('scroll'));
    };
    const sides = (): [string | null, string | null] =>
      [mirror.element.getAttribute('data-overflow-start'), mirror.element.getAttribute('data-overflow-end')];

    measure(0);
    expect(sides()).toEqual([null, '']);

    measure(50);
    expect(sides()).toEqual(['', '']);

    measure(100);
    expect(sides()).toEqual(['', null]);
  });

  it('does not haze a link that fits', () => {
    const { input, mirror } = setup();

    Object.defineProperty(input, 'scrollWidth', { configurable: true, value: 200 });
    Object.defineProperty(input, 'clientWidth', { configurable: true, value: 200 });
    input.dispatchEvent(new Event('input'));

    expect(mirror.element.hasAttribute('data-overflow-start')).toBe(false);
    expect(mirror.element.hasAttribute('data-overflow-end')).toBe(false);
  });

  it('redraws on demand after the value is set in code', () => {
    const { input, mirror } = setup();

    input.value = 'https://x.dev';
    mirror.draw();

    expect(parts(mirror).map(([part]) => part)).toEqual(['proto', 'host']);
  });
});
