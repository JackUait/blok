import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { links, meta } from './root';

// Read from disk, not imported: the manifest lives in public/ and is the one
// place the brand colour is declared. A copy here could drift from it.
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/site.webmanifest'), 'utf8')
) as { theme_color: string };

describe('root links', () => {
  // Without this the chain is HTML -> CSS -> woff2 and the first face landed
  // over a second in. Only the upright latin subset is preloaded: the other
  // seven faces are unicode-range gated and mostly never fetched.
  it('preloads exactly the one font face used above the fold', () => {
    const fontPreloads = links().filter((l) => 'as' in l && l.as === 'font');

    expect(fontPreloads).toEqual([
      {
        rel: 'preload',
        as: 'font',
        type: 'font/woff2',
        href: '/fonts/plus-jakarta-sans-latin.woff2',
        // Fonts are always fetched in CORS mode; without this the preload
        // misses and the browser downloads the file a second time.
        crossOrigin: 'anonymous',
      },
    ]);
  });

  // A rename in index.css would leave the preload pointing at a 404.
  it('preloads a face the stylesheet actually declares', () => {
    const [preload] = links().filter((l) => 'as' in l && l.as === 'font');
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

    expect(css).toContain(`url("${(preload as { href: string }).href}")`);
    expect(existsSync(resolve(process.cwd(), 'public', (preload as { href: string }).href.slice(1)))).toBe(true);
  });
});

describe('root meta', () => {
  // The manifest already declared a brand colour, but no page carried the tag
  // that paints the browser UI with it, so mobile Chrome/Safari showed the
  // default grey chrome on all 151 pages.
  it('paints the browser chrome with the manifest theme colour', () => {
    const descriptors = meta({ location: { pathname: '/docs/table' } });

    expect(descriptors).toContainEqual({ name: 'theme-color', content: manifest.theme_color });
  });

  it('keeps the per-route descriptors it wraps', () => {
    const descriptors = meta({ location: { pathname: '/docs/table' } });

    expect(descriptors).toContainEqual(
      expect.objectContaining({ tagName: 'link', rel: 'canonical' })
    );
  });
});
