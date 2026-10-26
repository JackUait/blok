/**
 * Panning the page beside a side peek must restyle only the moving wrapper, not the page inside it.
 * Counts are read from Chrome's trace (UpdateLayoutTree elementCount): they are exact on every run,
 * unlike frame times.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const PARAGRAPHS = 400;

const blocks: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
  ...Array.from({ length: PARAGRAPHS }, (_, i) => ({ id: `p${i}`, type: 'paragraph', data: { text: `Line ${i} with <b>bold</b> text` } })),
];

interface TraceEvent {
  name: string;
  args?: { elementCount?: number };
}

// Playwright types trace chunks as string maps, but Chrome sends objects with numbers in them.
const isTraceEvent = (value: unknown): value is TraceEvent =>
  typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string';

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (data) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, blocks);
  await expect(page.locator('[data-blok-database-wrapper]')).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('panning the page beside a side peek restyles only the wrapper, not the page inside it', async ({ page }) => {
  await mount(page);
  const wrapper = page.locator('[data-blok-interface=blok]').first();
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
  await expect(page.locator('[data-blok-database-drawer]')).toHaveAttribute('data-peek-mode', 'side');
  await expect(page.locator('[data-blok-database-peek-scrollbar]')).toBeVisible();

  const pageSize = await wrapper.evaluate((el) => el.querySelectorAll('*').length);

  // Without a big page the old cost would hide under the bound below.
  expect(pageSize).toBeGreaterThan(1000);

  const resting = (await wrapper.boundingBox())?.x ?? 0;
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];

  cdp.on('Tracing.dataCollected', (chunk) => {
    const values: unknown[] = chunk.value;

    events.push(...values.filter(isTraceEvent));
  });
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline'] } });
  // Over a paragraph: nothing under it scrolls sideways, so the wheel pans the page.
  await page.mouse.move(300, 600);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(6, 0);
  }
  await expect.poll(async () => (await wrapper.boundingBox())?.x ?? 0).toBeLessThan(resting);
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));

  await cdp.send('Tracing.end');
  await done;

  const restyled = events.filter((e) => e.name === 'UpdateLayoutTree').map((e) => e.args?.elementCount ?? 0);

  expect(restyled.length).toBeGreaterThan(0);
  // A pan restyles the wrapper and a few nodes around the bar, never the page's thousands.
  expect(Math.max(...restyled)).toBeLessThan(300);
});
