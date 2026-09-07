import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

import {
  ANONYMOUS_GLYPHS,
  UNKNOWN_GLYPH,
} from '../../../../src/components/modules/collaboration/anonymous-identity';

const presenceCss = readFileSync(resolve(__dirname, '../../../../src/styles/presence.css'), 'utf8');

for (const glyph of [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH]) {
  test(`${glyph} mask artwork is centered and fits its canvas`, async ({ page }) => {
    await page.addStyleTag({ content: presenceCss });

    const geometry = await page.evaluate(async name => {
      const face = document.createElement('span');

      face.setAttribute('data-blok-presence-face', '');
      face.setAttribute('data-blok-presence-glyph', name);
      document.body.appendChild(face);

      const mask = getComputedStyle(face, '::after').maskImage;
      const encoded = mask.match(/^url\("data:image\/svg\+xml,([^"]+)"\)$/)?.[1];

      if (!encoded) {
        throw new Error(`Missing SVG mask for ${name}: ${mask}`);
      }

      const svg = new DOMParser().parseFromString(decodeURIComponent(encoded), 'image/svg+xml').documentElement;
      const padding = 2;
      const size = 20;
      const scale = 20;
      const paddedSize = size + 2 * padding;

      // A larger viewport exposes paint that the real mask would clip.
      svg.setAttribute('viewBox', `${-padding} ${-padding} ${paddedSize} ${paddedSize}`);
      svg.setAttribute('width', String(paddedSize));
      svg.setAttribute('height', String(paddedSize));

      const image = new Image();

      image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await image.decode();

      const canvas = document.createElement('canvas');

      canvas.width = paddedSize * scale;
      canvas.height = paddedSize * scale;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Canvas 2D context unavailable');
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let weight = 0;
      let weightedX = 0;
      let weightedY = 0;

      for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        const alpha = pixels[pixel * 4 + 3];

        weight += alpha;
        weightedX += (x + 0.5) * alpha;
        weightedY += (y + 0.5) * alpha;

        // Ignore faint antialiasing fringes; one pixel is 0.05 SVG units.
        if (alpha >= 8) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (!Number.isFinite(minX) || weight === 0) {
        throw new Error(`Empty painted mask for ${name}`);
      }

      const visited = new Uint8Array(canvas.width * canvas.height);
      let openings = 0;

      for (let seed = 0; seed < visited.length; seed++) {
        if (visited[seed] || pixels[seed * 4 + 3] >= 128) {
          continue;
        }

        const queue = [seed];
        let exterior = false;

        visited[seed] = 1;

        for (let index = 0; index < queue.length; index++) {
          const pixel = queue[index];
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);

          exterior ||= x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1;

          const neighbors = [
            x > 0 ? pixel - 1 : -1,
            x < canvas.width - 1 ? pixel + 1 : -1,
            y > 0 ? pixel - canvas.width : -1,
            y < canvas.height - 1 ? pixel + canvas.width : -1,
          ].filter(neighbor => neighbor >= 0 && !visited[neighbor] && pixels[neighbor * 4 + 3] < 128);

          neighbors.forEach(neighbor => {
            visited[neighbor] = 1;
            queue.push(neighbor);
          });
        }

        // Ignore pinholes smaller than one square SVG unit.
        if (!exterior && queue.length >= scale * scale) {
          openings++;
        }
      }

      return {
        openings,
        left: minX / scale - padding,
        top: minY / scale - padding,
        right: (maxX + 1) / scale - padding,
        bottom: (maxY + 1) / scale - padding,
        centroidX: weightedX / weight / scale - padding,
        centroidY: weightedY / weight / scale - padding,
      };
    }, glyph);

    const minimumOpenings: Partial<Record<typeof glyph, number>> = {
      astronaut: 3,
      rocket: 3,
      satellite: 7,
      planet: 2,
      star: 5,
      sun: 1,
      telescope: 2,
      saucer: 6,
      asteroid: 3,
    };

    expect.soft(geometry.openings, `${glyph} readable negative-space details`).toBeGreaterThanOrEqual(minimumOpenings[glyph] ?? 0);

    const boundsCenterX = (geometry.left + geometry.right) / 2;
    const boundsCenterY = (geometry.top + geometry.bottom) / 2;

    expect.soft(Math.abs(boundsCenterX - 10), `${glyph} painted bounds center X = ${boundsCenterX}`).toBeLessThanOrEqual(0.55);
    expect.soft(Math.abs(boundsCenterY - 10), `${glyph} painted bounds center Y = ${boundsCenterY}`).toBeLessThanOrEqual(0.55);
    expect.soft(geometry.left, `${glyph} left clipping`).toBeGreaterThanOrEqual(0);
    expect.soft(geometry.top, `${glyph} top clipping`).toBeGreaterThanOrEqual(0);
    expect.soft(geometry.right, `${glyph} right clipping`).toBeLessThanOrEqual(20);
    expect.soft(geometry.bottom, `${glyph} bottom clipping`).toBeLessThanOrEqual(20);
    expect.soft(Math.abs(geometry.centroidX - 10), `${glyph} alpha centroid X = ${geometry.centroidX}`).toBeLessThanOrEqual(1.2);
    expect.soft(Math.abs(geometry.centroidY - 10), `${glyph} alpha centroid Y = ${geometry.centroidY}`).toBeLessThanOrEqual(1.2);
  });
}
