import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/image.css'), 'utf8');

const mount = (inner: string): HTMLImageElement => {
  const style = document.createElement('style');

  style.textContent = css;
  document.head.appendChild(style);
  document.body.innerHTML = `<div data-blok-tool="image"><figure class="blok-image-inner" data-loading="true">${inner}</figure></div>`;

  const img = document.querySelector('img');

  if (img === null) throw new Error('no img');

  return img;
};

describe('image.css: a reloading image keeps its geometry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('does not force a min-height on a turned img inside a plane', () => {
    const img = mount(
      '<div class="blok-image-crop"><div data-role="image-plane"><img style="position:absolute;height:75%;transform:rotate(90deg)"></div></div>'
    );

    expect(getComputedStyle(img).minHeight).not.toBe('220px');
  });

  it('still gives a flat img the loading min-height', () => {
    const img = mount('<img>');

    expect(getComputedStyle(img).minHeight).toBe('220px');
  });
});
