import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, createBlok } from './columns-blocks/_helpers';

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const URL = 'https://example.com/article';

test.describe('Bookmark link', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createBlok(page, {
      blocks: [
        { id: 'b', type: 'bookmark', data: { url: URL, title: 'Example article' } },
        { id: 'p', type: 'paragraph', data: { text: 'See <a href="https://example.com">example</a>.' } },
      ],
    });
  });

  test('hovering the card opens no link card, while an ordinary link still gets one', async ({ page }) => {
    const watch = page.evaluate(() => new Promise<boolean>((resolve) => {
      const seen = (): boolean => document.querySelector('[data-blok-testid="link-hover-card"]') !== null;
      const observer = new MutationObserver(() => {
        if (seen()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(seen());
      }, 1200);
    }));

    await page.getByTestId('bookmark-card').hover();
    expect(await watch).toBe(false);

    await page.getByText('example', { exact: true }).hover();
    await expect(page.getByTestId('link-hover-card')).toBeVisible();
  });

  test('clicking the card still opens its url in a new tab', async ({ page, context }) => {
    await context.route('https://example.com/**', (route) => route.fulfill({ body: 'ok' }));

    const popup = page.waitForEvent('popup');

    await page.getByTestId('bookmark-card').click();

    expect((await popup).url()).toBe(URL);
  });
});
