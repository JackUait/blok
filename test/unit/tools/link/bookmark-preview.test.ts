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
  it('frames the cover in a leaning browser window, like the real card', () => {
    const cover = renderBookmarkPreview().querySelector('[data-part="cover"]');
    const frame = cover?.querySelector('[data-part="window"]');

    expect(frame?.querySelector('[data-part="bar"]')?.textContent).toBe('craft.blog/slow');
    expect(frame?.querySelector('[data-part="shot"]')).not.toBeNull();
    expect(ruleFor('window')).toContain('rotate(');
  });

  it('shows the link as host and path', () => {
    const link = renderBookmarkPreview().querySelector('[data-part="link"]');

    expect(link?.querySelector('[data-part="host"]')?.textContent).toBe('craft.blog');
    expect(link?.querySelector('[data-part="path"]')?.textContent).toBe('/slow');
    expect(link?.querySelector('[data-part="address"] [data-part="favicon"]')).not.toBeNull();
  });
});
