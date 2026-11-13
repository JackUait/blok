import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderBookmarkPreview } from '../../../../src/tools/link/bookmark/preview';

const css = readFileSync(resolve(__dirname, '../../../../src/styles/block-preview/media.css'), 'utf8');

const ruleFor = (part: string): string => {
  const start = css.indexOf(`[data-blok-preview='bookmark'] [data-part='${part}'] {`);

  return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('bookmark toolbox preview', () => {
  it('draws the cover at the card\'s end with no browser window around it, like the real card', () => {
    const cover = renderBookmarkPreview().querySelector('[data-part="card"] > [data-part="cover"]');

    expect(cover?.querySelector('[data-part="shot"]')).not.toBeNull();
    expect(cover?.querySelector('[data-part="window"]')).toBeNull();
    expect(cover?.querySelector('[data-part="bar"]')).toBeNull();
  });

  it('fades the cover into a dark card and sets the text in white, like the real card', () => {
    expect(ruleFor('cover')).toContain('mask-image: linear-gradient(');
    expect(ruleFor('card')).toContain('color: var(--blok-text-on-dark);');
    expect(ruleFor('card')).not.toContain('border:');
  });

  it('shows the link as host and path', () => {
    const link = renderBookmarkPreview().querySelector('[data-part="link"]');

    expect(link?.querySelector('[data-part="host"]')?.textContent).toBe('craft.blog');
    expect(link?.querySelector('[data-part="path"]')?.textContent).toBe('/slow');
    expect(link?.querySelector('[data-part="address"] [data-part="favicon"]')).not.toBeNull();
  });
});
