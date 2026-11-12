import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();
const stage = readFileSync(join(__dirname, '../../../src/tools/audio/error-scenes/stage.ts'), 'utf8');

const numberOf = (name: string): number => {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(stage);

  if (!match) throw new Error(`stage.ts has no ${name}`);

  return Number(match[1]);
};

describe('audio error card', () => {
  it('switches to the narrow layout in CSS at the width where the stage moves the object on top', () => {
    const narrow = /@container \(max-width: (\d+)px\) \{\s*\[data-blok-tool="audio"\] \.blok-audio-error-state \{\s*padding-block-start: (\d+)px;/.exec(css);

    expect(narrow?.[1]).toBe(String(numberOf('NARROW_BELOW') - 1));
    expect(Number(narrow?.[2])).toBeGreaterThanOrEqual(numberOf('NARROW_SCENE_HEIGHT'));
  });

  it('makes the failed block a container so that query has a width to read', () => {
    expect(css).toMatch(/\[data-blok-tool="audio"\]\[data-state="error"\] \{\s*container-type: inline-size;/);
  });

  it('lets the pointer through the words to the object, but not through the buttons', () => {
    expect(css).toMatch(/\.blok-audio-error-state__body \{[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.blok-audio-error-state__actions \{[^}]*pointer-events: auto;/);
  });
});
