import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

declare global {
  interface Window {
    __blokEditor?: Blok | null;
  }
}

const FIXTURES = [
  { name: 'react', url: 'http://localhost:4444/test/playwright/fixtures/react-test.html', container: 'editor-container' },
  { name: 'vue', url: 'http://localhost:4444/test/playwright/fixtures/vue-test.html', container: 'editor-container' },
  { name: 'angular', url: 'http://localhost:4444/test/playwright/fixtures/angular-test.html', container: 'editor-host' },
] as const;

test.describe('editor.agent through the framework adapters', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  for (const fixture of FIXTURES) {
    test(`spec 16: ${fixture.name} reaches editor.agent on the instance`, async ({ page }) => {
      await page.goto(fixture.url);
      await expect(page.getByTestId('status')).toHaveText('ready');
      await page.waitForFunction(() => window.__blokEditor !== undefined && window.__blokEditor !== null);

      const createdId = await page.evaluate(async () => {
        const editor = window.__blokEditor;

        if (editor === undefined || editor === null) {
          throw new Error('no editor instance');
        }

        const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });

        (window as unknown as { __turn?: typeof turn }).__turn = turn;

        const result = await turn.call('blok_execute', {
          commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'from agent' }, position: 'end' } }],
        });

        return (JSON.parse(result.content) as { changed: { created: string[] } }).changed.created[0];
      });
      const host = page.getByTestId(fixture.container);

      await expect(host.locator(`[data-blok-id="${createdId}"] [data-blok-agent-marker-label="Assistant"]`)).toHaveCount(1);

      await page.evaluate(() => (window as unknown as { __turn?: { end(): void } }).__turn?.end());
      await expect(host.getByText('from agent')).toBeVisible();

      await page.evaluate(() => window.__blokEditor?.history.undo());
      await expect(host.getByText('from agent')).toHaveCount(0);
    });
  }
});
