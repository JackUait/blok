// test/playwright/tests/tools/file.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const FILE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="file"]`;
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Reset DOM and destroy any running Blok instance.
 */
const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

/**
 * Create a Blok instance with the FileTool registered.
 * FileTool is not in the test.html defaults, so we dynamically import it
 * from the already-built /dist/tools.mjs and inject it via the tools config.
 */
const createBlokWithFile = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const { File: FileTool, Image: ImageTool } = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
      const blok = new window.Blok({
        holder,
        tools: {
          file: { class: FileTool },
          image: { class: ImageTool },
        },
        ...(initialData ? { data: initialData } : {}),
      });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

// ---------------------------------------------------------------------------
// 1. Upload via file input renders a download card
// ---------------------------------------------------------------------------
test('upload renders a download card with correct filename and download attribute', async ({ page }) => {
  await createBlokWithFile(page);

  // Insert a File block via the slash menu
  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );
  await defaultParagraph.click();
  await page.keyboard.type('/file', { delay: 50 });

  const fileMenuItem = page.locator('[data-blok-item-name="file"]');
  await expect(fileMenuItem).toBeVisible();
  await fileMenuItem.click();

  const fileBlock = page.locator(FILE_BLOCK_SELECTOR);
  await expect(fileBlock).toBeVisible();

  // The file input is hidden — setInputFiles works on hidden inputs
  const fileInput = fileBlock.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });

  // After upload (URL.createObjectURL fallback), card should appear
  const fileCard = page.locator('[data-role="file-card"]');
  await expect(fileCard).toBeVisible();

  // Filename shown in the card
  await expect(page.locator('[data-role="file-name"]')).toHaveText('report.pdf');

  // download attribute equals the filename
  await expect(fileCard).toHaveAttribute('download', 'report.pdf');
});

// ---------------------------------------------------------------------------
// 2. Routing guard: PDF drop → File block; PNG drop → Image block
// ---------------------------------------------------------------------------
test('dropping a PDF file creates a File block, dropping a PNG creates an Image block', async ({ page }) => {
  // Use two separate Blok instances to keep the routing tests independent.

  // --- PDF drop → File block ---
  await createBlokWithFile(page);

  const pdfDropTarget = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`
  ).first();

  await pdfDropTarget.evaluate((element: HTMLElement) => {
    const file = new File([ new Uint8Array([ 0x25, 0x50, 0x44, 0x46 ]) ], 'document.pdf', { type: 'application/pdf' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const makeEvent = (type: string): DragEvent => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
      return ev;
    };

    element.dispatchEvent(makeEvent('dragenter'));
    element.dispatchEvent(makeEvent('dragover'));
    element.dispatchEvent(makeEvent('drop'));
  });

  const fileCard = page.locator('[data-role="file-card"]');
  await expect(fileCard).toBeVisible();

  // --- PNG drop → Image block ---
  await createBlokWithFile(page);

  const PNG_1x1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  const pngDropTarget = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`
  ).first();

  await pngDropTarget.evaluate((element: HTMLElement, base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const file = new File([ bytes ], 'photo.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const makeEvent = (type: string): DragEvent => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
      return ev;
    };

    element.dispatchEvent(makeEvent('dragenter'));
    element.dispatchEvent(makeEvent('dragover'));
    element.dispatchEvent(makeEvent('drop'));
  }, PNG_1x1_BASE64);

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);
  await expect(imageBlock).toBeVisible();
  await expect(imageBlock).toHaveAttribute('data-state', 'rendered');
});

// ---------------------------------------------------------------------------
// 3. Read-only: caption becomes non-editable
// ---------------------------------------------------------------------------
test('read-only mode sets file caption to contenteditable="false"', async ({ page }) => {
  await createBlokWithFile(page, {
    blocks: [
      {
        type: 'file',
        data: {
          url: 'https://example.com/report.pdf',
          fileName: 'report.pdf',
          caption: 'Annual report',
          captionVisible: true,
        },
      },
    ],
  });

  const fileBlock = page.locator(FILE_BLOCK_SELECTOR);
  await expect(fileBlock).toBeVisible();

  // Caption is editable before read-only
  const caption = fileBlock.locator('[data-role="file-caption"]');
  await expect(caption).toHaveAttribute('contenteditable', 'true');

  // Enable read-only
  await page.evaluate(async () => {
    const blok = window.blokInstance;
    if (!blok) throw new Error('Blok instance not found');
    await blok.readOnly.toggle(true);
  });
  await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

  // Caption must now be non-editable
  await expect(caption).toHaveAttribute('contenteditable', 'false');
});
