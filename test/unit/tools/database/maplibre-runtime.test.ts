import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Runtime from '../../../../src/tools/database/maplibre-runtime';

const setWorkerUrl = vi.fn();

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: (url: string): void => {
    setWorkerUrl(url);
  },
}));

const runtime = async (): Promise<typeof Runtime> => import('../../../../src/tools/database/maplibre-runtime');

const workerFile = resolve(__dirname, '../../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');

describe('MapLibre runtime (lazy chunk)', () => {
  const blobs: Blob[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    blobs.length = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        blobs.push(blob);

        return `blob:test/${blobs.length}`;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = '';
  });

  it('the installed worker is self-contained: it has no relative static import', () => {
    const worker = readFileSync(workerFile, 'utf8');

    expect(worker).not.toMatch(/(?:\bfrom|\bimport)\s*["']\.{1,2}\//);
  });

  it('starts one worker from a blob URL, once, with no file beside the bundle', async () => {
    const { boot } = await runtime();

    boot();
    boot();

    expect(setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(setWorkerUrl).toHaveBeenCalledWith('blob:test/1');
    expect(blobs).toHaveLength(1);
    const [worker] = await Promise.all(blobs.map((blob) => blob.text()));

    expect(worker).toBe(readFileSync(workerFile, 'utf8').replace(/\s*\/\/# sourceMappingURL=\S*\s*$/, ''));
    expect(blobs.every((blob) => blob.type === 'text/javascript')).toBe(true);
  });

  it('scopes every MapLibre rule under the map host, so a host page\'s own maps keep their styles', async () => {
    const { scopeRules, MAPLIBRE_SCOPE } = await runtime();
    const style = document.createElement('style');

    style.textContent = '.maplibregl-map{overflow:hidden}.a,.b:not(.c,.d){color:red}@media (hover:hover){.e{color:blue}}@keyframes spin{to{opacity:1}}';
    document.head.appendChild(style);
    const sheet = style.sheet;

    if (sheet === null) throw new Error('no sheet');
    scopeRules(sheet.cssRules);
    const selectorsOf = (rule: CSSRule): string[] => {
      if (rule instanceof CSSStyleRule) return [rule.selectorText];
      if (rule instanceof CSSMediaRule) return [...rule.cssRules].flatMap(selectorsOf);

      return [];
    };
    const selectors = [...sheet.cssRules].flatMap(selectorsOf)
      // Engines differ on the space after a comma inside :not().
      .map((selector) => selector.replace(/,\s*/g, ', '));

    expect(MAPLIBRE_SCOPE).toBe('data-blok-maplibre');
    expect(selectors).toEqual([
      '[data-blok-maplibre] .maplibregl-map',
      '[data-blok-maplibre] .a, [data-blok-maplibre] .b:not(.c, .d)',
      '[data-blok-maplibre] .e',
    ]);
  });

  it('adds its stylesheet once, with the nonce Blok\'s own styles carry', async () => {
    const own = document.createElement('style');

    own.id = 'blok-styles';
    own.nonce = 'n0nce';
    document.head.appendChild(own);
    const { boot } = await runtime();

    boot();
    boot();
    const added = document.head.querySelectorAll('style#blok-maplibre-styles');

    expect(added).toHaveLength(1);
    expect((added[0] as HTMLStyleElement).nonce).toBe('n0nce');
  });
});
