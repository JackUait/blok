import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveConfig, optimizeDeps } from 'vite'

const repoRoot = resolve(__dirname, '../../../')

/**
 * Regression guard for the Vite dev server (`yarn serve`).
 *
 * Vite's dependency scanner crawls EVERY `*.html` in the project by default to
 * seed pre-bundling. That default sweep pulls in the Playwright adapter E2E
 * fixtures under `test/playwright/fixtures/` — but those are static,
 * importmap-driven pages served by `npx serve` (see playwright.config.ts), not
 * part of Vite's app graph. The Angular fixture's `app.mjs` imports the adapter
 * bare (`@bloklabs/angular`), and the Angular APF FESM it points at imports
 * the core bare (`@bloklabs/core`); both resolve ONLY via the page's import map,
 * never from `node_modules` (this repo is not self-installed). Crawling them made
 * the scanner abort with "The following dependencies are imported but could not
 * be resolved", which disabled pre-bundling for the whole dev server.
 *
 * The fix scopes `optimizeDeps.entries` to the real dev playground so the scanner
 * never touches the static E2E fixtures. This test runs the actual scan against
 * the real config and asserts it completes.
 */
describe('Vite dev server dependency scan', () => {
  it('resolves all scanned entries without choking on the static E2E adapter fixtures', async () => {
    const config = await resolveConfig(
      { configFile: resolve(repoRoot, 'vite.config.mjs') },
      'serve',
      'development',
      'development',
    )

    // `force: true` makes the optimizer re-run the scan instead of reading a
    // cached result, so this exercises the real crawl every time.
    await expect(optimizeDeps(config, true)).resolves.toBeDefined()
  }, 120_000)
})
