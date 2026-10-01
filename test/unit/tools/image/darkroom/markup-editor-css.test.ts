import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERASER_PX } from '../../../../../src/tools/image/darkroom/markup-editor';

const css = readFileSync(resolve(__dirname, '../../../../../src/tools/image/darkroom/markup-editor.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('markup-editor.css', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([0, 1, 2] as const)('the eraser cursor at size %i is a ring as wide as the eraser', (size) => {
    const rule = new RegExp(`\\.blok-markup-layer\\[data-tool="eraser"\\]\\[data-size="${size}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const r = /r='([\d.]+)'/.exec(rule)?.[1];

    expect(Number(r)).toBe(ERASER_PX[size]);
  });
});
