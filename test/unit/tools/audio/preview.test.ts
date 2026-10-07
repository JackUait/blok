import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAudioPreview } from '../../../../src/tools/audio/preview';

const mountPreview = (): HTMLElement => {
  const drawing = renderAudioPreview();

  document.body.appendChild(drawing);

  return drawing;
};

const query = (root: HTMLElement, selector: string): HTMLElement => {
  const el = root.querySelector(selector);

  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }

  return el;
};

const reduceMotion = (reduce: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }));
};

describe('audio toolbox preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date' ] });
    reduceMotion(false);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws the real no-cover audio block', () => {
    const drawing = mountPreview();
    const figure = query(drawing, '[data-blok-tool="audio"] figure.blok-audio-inner');

    expect(query(figure, '[data-role="audio-cover-disc"]')).toBeTruthy();
    expect(figure.querySelector('img')).toBeNull();
    expect(query(figure, '[data-role="audio-title"]').textContent).toBe('Late Night Drive');
    expect(query(figure, '[data-role="audio-artist"]').textContent).toBe('Nova Lane');
    expect(query(figure, '[data-role="audio-title"]').getAttribute('contenteditable')).toBe('false');
    expect(query(figure, '[data-role="audio-waveform-canvas"]')).toBeTruthy();
    expect(query(figure, '[data-role="audio-controls"] [data-role="audio-play"]')).toBeTruthy();
    expect(query(figure, '[data-role="audio-mute"]')).toBeTruthy();
    expect(query(figure, '[data-role="audio-speed"]')).toBeTruthy();
    expect(query(figure, '[data-role="audio-loop"]')).toBeTruthy();
    expect(query(figure, '.blok-audio-controls__time').textContent).toBe('01:12 / 03:48');
  });

  it('presses play, plays, then pauses, like the block does', () => {
    const drawing = mountPreview();
    const figure = query(drawing, 'figure.blok-audio-inner');
    const time = query(drawing, '.blok-audio-controls__time');

    expect(figure.getAttribute('data-playing')).toBe('false');

    vi.advanceTimersByTime(1500);

    expect(figure.getAttribute('data-playing')).toBe('true');
    expect(query(drawing, '[data-role="audio-play"]').getAttribute('aria-label')).toBe('Pause');

    vi.advanceTimersByTime(3000);

    expect(time.textContent).toBe('01:15 / 03:48');

    vi.advanceTimersByTime(5000);

    expect(figure.getAttribute('data-playing')).toBe('false');
  });

  it('stops playing once the card drops the drawing', () => {
    const drawing = mountPreview();
    const time = query(drawing, '.blok-audio-controls__time');

    vi.advanceTimersByTime(2000);
    drawing.remove();
    const frozen = time.textContent;

    vi.advanceTimersByTime(3000);

    expect(time.textContent).toBe(frozen);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops playing while the card is hidden', () => {
    const card = document.createElement('div');
    const drawing = renderAudioPreview();

    card.appendChild(drawing);
    document.body.appendChild(card);
    const time = query(drawing, '.blok-audio-controls__time');

    vi.advanceTimersByTime(2000);
    card.hidden = true;
    vi.advanceTimersByTime(100);
    const frozen = time.textContent;

    vi.advanceTimersByTime(3000);

    expect(time.textContent).toBe(frozen);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds still under reduced motion', () => {
    reduceMotion(true);
    const drawing = mountPreview();

    vi.advanceTimersByTime(5000);

    expect(query(drawing, 'figure.blok-audio-inner').getAttribute('data-playing')).toBe('false');
    expect(query(drawing, '.blok-audio-controls__time').textContent).toBe('01:12 / 03:48');
  });
});
