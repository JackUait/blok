import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder: holder,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Initial block',
            },
          },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('api.sanitizer', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createBlok(page);
  });

  test('clean removes disallowed HTML', async ({ page }) => {
    const sanitized = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const dirtyHtml = '<p>Safe<script>alert("XSS")</script></p>';

      return window.blokInstance.sanitizer.clean(dirtyHtml, {
        p: true,
      });
    });

    expect(sanitized).toBe('<p>Safe</p>');
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('alert');
  });

  test('clean applies custom sanitizer config', async ({ page }) => {
    const sanitized = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const dirtyHtml = '<span data-blok-id="allowed" style="color:red">Span <em>content</em></span>';

      return window.blokInstance.sanitizer.clean(dirtyHtml, {
        span: {
          'data-blok-id': true,
        },
        em: {},
      });
    });

    expect(sanitized).toContain('<span data-blok-id="allowed">');
    expect(sanitized).toContain('<em>content</em>');
    expect(sanitized).not.toContain('style=');
  });

  // A <form> lets a named control shadow its own DOM properties; jsdom does not, so this runs in a browser.
  test('clean keeps no handler when a form shadows its DOM properties', async ({ page }) => {
    const results = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const shadows = [ 'previousSibling', 'nextSibling', 'firstChild', 'nodeName', 'nodeType', 'attributes', 'childNodes', 'removeChild', 'insertBefore', 'removeAttribute' ]
        .map((name) => `<input name="${name}">`)
        .join('');
      const dirtyHtml = `<p>a<img src="x" onerror="alert(1)"><form>${shadows}<img src="x" onerror="alert(2)"></form><img src="x" onerror="alert(3)">b</p>`;
      return [
        window.blokInstance.sanitizer.clean(dirtyHtml, { p: {}, img: { src: true } }),
        window.blokInstance.sanitizer.clean(dirtyHtml, { p: {}, img: { src: true }, form: {}, input: { name: true } }),
      ];
    });

    for (const sanitized of results) {
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).toContain('a<img src="x">');
      expect(sanitized).toContain('<img src="x">b');
    }
  });
});
