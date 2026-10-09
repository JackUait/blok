import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DatabaseDropLine, DROP_LINE_FADE_MS } from '../../../../src/tools/database/database-drop-line';

const line = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-blok-database-drop-line]');

const reduceMotion = (reduce: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('DatabaseDropLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    reduceMotion(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws a 4px horizontal line centred on the given y, on the page, outside the board', () => {
    const drop = new DatabaseDropLine();

    drop.showHorizontal({ left: 10, centerY: 100, width: 260 });

    const el = line();

    expect(el?.parentElement).toBe(document.body);
    expect(el?.style.position).toBe('fixed');
    expect(el?.style.left).toBe('10px');
    expect(el?.style.top).toBe('98px');
    expect(el?.style.width).toBe('260px');
    expect(el?.style.height).toBe('4px');
    expect(el?.style.pointerEvents).toBe('none');
  });

  it('draws a 4px vertical line centred on the given x', () => {
    const drop = new DatabaseDropLine();

    drop.showVertical({ centerX: 50, top: 20, height: 300 });

    expect(line()?.style.left).toBe('48px');
    expect(line()?.style.top).toBe('20px');
    expect(line()?.style.width).toBe('4px');
    expect(line()?.style.height).toBe('300px');
  });

  it('moves one line instead of drawing a second', () => {
    const drop = new DatabaseDropLine();

    drop.showHorizontal({ left: 10, centerY: 100, width: 260 });
    drop.showHorizontal({ left: 10, centerY: 200, width: 260 });

    expect(document.body.querySelectorAll('[data-blok-database-drop-line]')).toHaveLength(1);
    expect(line()?.style.top).toBe('198px');
  });

  it('fades the line out and removes it after the fade', () => {
    const drop = new DatabaseDropLine();

    drop.showHorizontal({ left: 10, centerY: 100, width: 260 });
    drop.hide();

    expect(line()?.style.opacity).toBe('0');

    vi.advanceTimersByTime(DROP_LINE_FADE_MS);

    expect(line()).toBeNull();
  });

  it('removes the line at once when the user asks for reduced motion', () => {
    reduceMotion(true);
    const drop = new DatabaseDropLine();

    drop.showHorizontal({ left: 10, centerY: 100, width: 260 });
    drop.hide();

    expect(line()).toBeNull();
  });

  it('draws a fresh line while the previous one still fades out', () => {
    const drop = new DatabaseDropLine();

    drop.showHorizontal({ left: 10, centerY: 100, width: 260 });
    drop.hide();
    drop.showHorizontal({ left: 10, centerY: 300, width: 260 });

    const lines = document.body.querySelectorAll<HTMLElement>('[data-blok-database-drop-line]');

    expect(lines).toHaveLength(2);
    expect(lines[1].style.opacity).toBe('');

    vi.advanceTimersByTime(DROP_LINE_FADE_MS);

    expect(document.body.querySelectorAll('[data-blok-database-drop-line]')).toHaveLength(1);
  });

  it('removes every line at once on destroy', () => {
    const drop = new DatabaseDropLine();

    drop.showHorizontal({ left: 10, centerY: 100, width: 260 });
    drop.hide();
    drop.showHorizontal({ left: 10, centerY: 300, width: 260 });
    drop.destroy();

    expect(document.body.querySelectorAll('[data-blok-database-drop-line]')).toHaveLength(0);
  });
});

describe('DatabaseDropLine colour', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('copies the colour token the board resolves, since the line sits outside the editor', () => {
    const board = document.createElement('div');

    board.style.setProperty('--blok-database-drop-line', 'rgb(1, 2, 3)');
    document.body.appendChild(board);

    new DatabaseDropLine(board).showHorizontal({ left: 0, centerY: 10, width: 10 });

    expect(line()?.style.backgroundColor).toBe('rgb(1, 2, 3)');
  });
});
