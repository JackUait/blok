import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { blocksToHtml } from '../../../../src/view';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Gate 3 — view <-> read-only visual parity.
 *
 * The class-parity unit gate (test/unit/view + view-stylesheet-law) proves the
 * two renders AGREE on class names and that view.css carries a rule for each.
 * It cannot prove those rules PAINT the same pixels the read-only editor does —
 * only a browser can. This spec closes that gap: it renders the same document
 * twice and compares the results to each other, so a mismatch cannot be baked
 * into a committed baseline.
 *
 * Isolation — why the view renders in an iframe, not a sibling container:
 *   The editor's Tailwind utilities ship UNSCOPED (main.css imports
 *   `tailwindcss/utilities.css` as global `@layer utilities`, not keyed on
 *   `[data-blok-interface]`). Once the editor mounts, its injected sheet styles
 *   ANY element carrying those classes — including a same-page view container —
 *   so a sibling `<div>` would render identically whether or not view.css even
 *   loaded, and a view.css generation gap (Step 3's whole point) could never
 *   turn this red. The iframe gives the view ONLY view.css, so a missing rule
 *   surfaces as a real pixel diff. The iframe body IS the "second container of
 *   identical width" the plan calls for.
 *
 * Gutter — why readOnly is chromeless:
 *   Plain read-only deliberately keeps the control gutter (main.css); the view
 *   has none. `readOnly: { hideControls: true }` collapses it to 0
 *   (data-blok-controls-hidden), aligning the editor content to the same left
 *   edge as the view so the comparison measures content parity, not chrome.
 *
 * Typography — why the iframe is given the editor's font:
 *   The editor forces `var(--blok-font-sans)` (Inter) on `[data-blok-interface=blok]`
 *   with `!important`; the view root is deliberately `=view` so it does NOT get
 *   that rule and instead inherits the HOST's typography (see the `root` option
 *   docs in blocks-to-html.ts). The two therefore only paint alike when the host
 *   uses the editor's font — so the harness gives the iframe the same Inter face
 *   (fonts.css inlined) and font stack, then the comparison measures what view.css
 *   actually owns: block spacing, list markers, colours, box model — not the
 *   host-supplied typeface. Colour needs no such fix: --blok-text-primary is
 *   `black` in light mode, which the view inherits anyway.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Same width for both renders. */
const CONTAINER_WIDTH = 650;

/**
 * Page-y where the view iframe is stacked, below the editor. An INTEGER so its
 * sub-pixel offset (0) matches the editor's y=0 and text baselines round the
 * same on both sides; clear of the editor's content so they never overlap.
 */
const VIEW_FRAME_TOP = 300;

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

/**
 * The editor's Inter font stack, so the isolated iframe view paints with the
 * same typeface the editor forces on `[data-blok-interface=blok]`.
 */
const EDITOR_FONT_STACK =
  "'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * The Phase A tools whose read-only render is fully CSS-driven, so view.css can
 * reproduce it byte-for-byte. Deliberately EXCLUDED, each for a reason the view
 * cannot close with a stylesheet alone (documented so the omission is not silent):
 *
 *   - list (unordered/ordered): the editor draws bullets and ordered numbers in
 *     JS (src/tools/list/marker-calculator.ts) as real DOM; there is no marker
 *     CSS in main.css, and the DOM-free view emitter renders no marker cell. Its
 *     CLASS parity is already gated by test/unit; its MARKER-GLYPH parity is a
 *     follow-up to the list view emitter, not a view.css gap.
 *   - code: syntax highlighting is Prism token spans injected at render time.
 *   - callout/toggle: container tools whose body is child blocks rendered as
 *     editor sub-editors, chrome the view has no equivalent for.
 *
 * Inline `<code>` is likewise omitted: the editor wraps paragraph text in an
 * inner element whose em-context resolves the `0.875em` inline-code size to the
 * body 16px, while the flat view's `<code>` sits directly under `<p>` and
 * renders at 14px. That is an editor-DOM nuance, not a view.css gap, and it only
 * affects em-relative sizing — `<b>`/`<i>` render identically and stay in.
 */
const FIXTURE: OutputData['blocks'] = [
  { type: 'header', data: { text: 'Visual parity', level: 2 } },
  { type: 'paragraph', data: { text: 'Body text with <b>bold</b> and <i>italic</i>.' } },
  { type: 'quote', data: { text: 'A quoted line.' } },
  { type: 'quote', data: { text: 'A large quote', size: 'large' } },
  { type: 'divider', data: {} },
];

const mountReadOnlyEditor = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ blokBlocks, width }) => {
      document.getElementById('editor')?.remove();
      const container = document.createElement('div');

      container.id = 'editor';
      container.setAttribute('data-blok-testid', 'parity-editor');
      container.style.width = `${width}px`;
      // Pin to a device-pixel-aligned origin. The default flow position sits at a
      // fractional page-y (below the fixture's <h1>), which rounds every text
      // baseline differently from the view's y=0 — a ghost 1px-per-block drift.
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      document.body.appendChild(container);

      const blok = new window.Blok({
        holder: 'editor',
        data: { blocks: blokBlocks },
        readOnly: { hideControls: true },
      });

      window.blokInstance = blok;
      await blok.isReady;
      await document.fonts.ready;
    },
    { blokBlocks: blocks, width: CONTAINER_WIDTH }
  );
};

const mountViewIframe = async (
  page: Page,
  html: string,
  css: string,
  fontsCss: string
): Promise<void> => {
  await page.evaluate(
    ({ viewHtml, viewCss, fonts, width, fontStack, frameTop }) => {
      document.getElementById('view-frame')?.remove();
      const frame = document.createElement('iframe');

      frame.id = 'view-frame';
      frame.setAttribute('data-blok-testid', 'parity-view-frame');
      frame.style.width = `${width}px`;
      frame.style.border = '0';
      // Stacked BELOW #editor at an integer y-origin (same fractional offset, 0,
      // as #editor's y=0) so baseline rounding matches, and at x=0 so the clip
      // stays inside the viewport width. A side-by-side x-offset would push the
      // clip past the viewport and silently shrink it.
      frame.style.position = 'absolute';
      frame.style.top = `${frameTop}px`;
      frame.style.left = '0';
      frame.style.height = '600px';
      // srcdoc gives the view a clean document: ONLY view.css + the host-supplied
      // font. No editor sheet — a missing view.css rule cannot be masked.
      frame.srcdoc =
        '<!doctype html><html><head>' +
        `<style>${fonts}</style>` +
        '<style>html,body{margin:0;padding:0}' +
        `[data-blok-interface="view"]{font-family:${fontStack}}</style>` +
        `<style>${viewCss}</style>` +
        `</head><body>${viewHtml}</body></html>`;
      document.body.appendChild(frame);
    },
    { viewHtml: html, viewCss: css, fonts: fontsCss, width: CONTAINER_WIDTH, fontStack: EDITOR_FONT_STACK, frameTop: VIEW_FRAME_TOP }
  );

  // Wait for the iframe document to parse and its view root to exist.
  const viewRoot = page
    .frameLocator('[data-blok-testid="parity-view-frame"]')
    .locator('[data-blok-interface="view"]');

  await viewRoot.waitFor();
  // The face must be decoded before the screenshot or text metrics differ.
  await viewRoot.evaluate(async (el) => {
    await el.ownerDocument.fonts.ready;
  });
};

/**
 * Fraction of pixels that differ between two same-size PNG buffers by more than
 * an anti-aliasing tolerance, computed with the browser's own canvas — no
 * committed baseline (the two LIVE renders are compared against each other) and
 * no extra dependency. Mismatched dimensions return 1 (total failure). A
 * per-channel delta under `AA_TOLERANCE` is treated as identical: sub-pixel font
 * smoothing legitimately differs between the main document and the iframe even
 * when every box lands on the same device pixel.
 */
const AA_TOLERANCE = 24;

const pixelDiffRatio = async (page: Page, a: Buffer, b: Buffer): Promise<number> =>
  page.evaluate(
    async ({ aUrl, bUrl, tol }) => {
      const load = (url: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();

          img.onload = (): void => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      const [ia, ib] = await Promise.all([load(aUrl), load(bUrl)]);

      if (ia.width !== ib.width || ia.height !== ib.height) {
        return 1;
      }

      const dataOf = (img: HTMLImageElement): Uint8ClampedArray => {
        const canvas = document.createElement('canvas');

        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (ctx === null) {
          throw new Error('no 2d context');
        }
        ctx.drawImage(img, 0, 0);

        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const da = dataOf(ia);
      const db = dataOf(ib);
      let differing = 0;

      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) > tol ||
          Math.abs(da[i + 1] - db[i + 1]) > tol ||
          Math.abs(da[i + 2] - db[i + 2]) > tol
        ) {
          differing += 1;
        }
      }

      return differing / (da.length / 4);
    },
    {
      aUrl: `data:image/png;base64,${a.toString('base64')}`,
      bUrl: `data:image/png;base64,${b.toString('base64')}`,
      tol: AA_TOLERANCE,
    }
  );

test.describe('view <-> read-only visual parity', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('view.css reproduces the read-only editor render pixel-for-pixel', async ({ page }) => {
    await mountReadOnlyEditor(page, FIXTURE);

    const viewHtml = blocksToHtml({ blocks: FIXTURE }, {
      root: true,
      classes: true,
      toolAttributes: true,
    });
    const viewCss = readFileSync(path.join(REPO_ROOT, 'view.css'), 'utf-8');
    const fontsCss = readFileSync(path.join(REPO_ROOT, 'src/styles/fonts.css'), 'utf-8');

    await mountViewIframe(page, viewHtml, viewCss, fontsCss);

    await expect(page.locator('[data-blok-testid="parity-editor"]')).toBeVisible();
    await expect(
      page.frameLocator('[data-blok-testid="parity-view-frame"]').locator('[data-blok-interface="view"]')
    ).toBeVisible();

    // Hide the fixture page's own content (the "Blok test page" heading) so it
    // does not bleed into the absolutely-positioned editor's clip region.
    await page.evaluate(() => {
      for (const child of Array.from(document.body.children)) {
        if (child.id !== 'editor' && child.id !== 'view-frame') {
          (child as HTMLElement).style.display = 'none';
        }
      }
    });

    /**
     * Fixed, identical clip boxes for both renders. Element screenshots would
     * differ in size by a rounding pixel (the two container boxes round their
     * height independently), which alone fails an exact compare; a shared clip
     * makes the two buffers the same dimensions so the pixel diff is meaningful.
     * The editor sits at page-y 0, the view iframe at VIEW_FRAME_TOP; both are
     * integer origins so baseline rounding matches, and both at x=0 so neither
     * clip runs past the viewport width.
     */
    const CLIP_HEIGHT = 230;
    const shots = await Promise.all([
      page.screenshot({ ...SCREENSHOT_OPTIONS, clip: { x: 0, y: 0, width: CONTAINER_WIDTH, height: CLIP_HEIGHT } }),
      page.screenshot({ ...SCREENSHOT_OPTIONS, clip: { x: 0, y: VIEW_FRAME_TOP, width: CONTAINER_WIDTH, height: CLIP_HEIGHT } }),
    ]);

    /**
     * Every block lands on the same device pixel (asserted while authoring), so
     * the only legitimate residual is cross-document font anti-aliasing. Compare
     * the two LIVE renders directly — no committed baseline that could bake in a
     * mismatch — and allow only that sub-pixel smoothing. A real gap (the grey
     * quote bar and collapsed block padding this gate already caught) moves far
     * more than 0.5% of pixels.
     */
    const ratio = await pixelDiffRatio(page, shots[0], shots[1]);

    expect(ratio, `read-only editor and view render differ (${(ratio * 100).toFixed(3)}% of pixels)`).toBeLessThan(0.005);
  });
});
