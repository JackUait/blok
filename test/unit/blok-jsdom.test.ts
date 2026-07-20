import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Blok as BlokInstance } from '../../types';
import { Paragraph } from '../../src/tools/paragraph';

let editor: BlokInstance | undefined;
let holder: HTMLDivElement | undefined;

describe('Blok jsdom compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes animation-frame fallbacks when jsdom uses a separate runtime global', async () => {
    const isolatedWindow = Object.create(window) as Window;

    Object.defineProperties(isolatedWindow, {
      requestAnimationFrame: {
        configurable: true,
        writable: true,
        value: undefined,
      },
      cancelAnimationFrame: {
        configurable: true,
        writable: true,
        value: undefined,
      },
    });

    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    vi.stubGlobal('window', isolatedWindow);

    await import('../../src/components/polyfills');

    expect(globalThis.requestAnimationFrame).toBeTypeOf('function');
    expect(globalThis.cancelAnimationFrame).toBeTypeOf('function');
  });

  it('initializes a real editor when requestAnimationFrame is not provided by the environment', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);

    expect(window.requestAnimationFrame).toBeUndefined();
    expect(window.cancelAnimationFrame).toBeUndefined();

    const { Blok } = await import('../../src/blok');

    expect(requestAnimationFrame).toBeTypeOf('function');
    expect(cancelAnimationFrame).toBeTypeOf('function');

    editor = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
      },
      data: {
        blocks: [{ type: 'paragraph', data: { text: 'jsdom' } }],
      },
    });

    await expect(editor.isReady).resolves.toBe(editor);
  }, 60_000);
});
