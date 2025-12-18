import './test/playwright/support/suppress-css-import';
import { defineConfig } from '@playwright/test';

const AMOUNT_OF_LOCAL_WORKERS = 3;

/**
 * Playwright Test Configuration - Browser Coverage Strategy
 *
 * This configuration optimizes test execution time while maintaining cross-browser coverage.
 *
 * CATEGORIZATION RULES:
 * - Cross-browser tests (chromium, firefox, webkit):
 *   Tests involving browser-specific behavior: events, rendering, keyboard, clipboard
 *
 * - Logic tests (chromium-logic):
 *   Pure JavaScript logic, API methods, state management - no browser differences
 *
 * WHEN TO ADD A NEW TEST:
 * - Does it test browser-specific behavior? → Add to CROSS_BROWSER_TESTS
 * - Is it pure logic/API testing? → Add to LOGIC_TESTS
 * - Unsure? Default to CROSS_BROWSER_TESTS (safer)
 *
 * IMPORTANT: If you rename test directories, update the patterns below.
 * Run `yarn e2e --list` to verify all tests are matched after changes.
 *
 * Recommended plugins installed:
 * - @axe-core/playwright: For accessibility testing
 *   Usage in tests: import { injectAxe, checkA11y } from '@axe-core/playwright';
 *                   await injectAxe(page);
 *                   await checkA11y(page);
 *
 * - eslint-plugin-playwright: For linting Playwright tests
 *   Configured in eslint.config.mjs
 */

// Cross-browser critical tests - require validation on all browsers
const CROSS_BROWSER_TESTS = [
  // Browser-specific event handling
  '**/drag-drop.spec.ts',
  '**/copy-paste.spec.ts',

  // Keyboard navigation (Firefox has known Tab/Shift+Tab issues)
  '**/modules/BlockEvents/**/*.spec.ts',

  // Inline tools (text selection behavior differs)
  '**/inline-tools/**/*.spec.ts',

  // Accessibility (must work across all assistive tech)
  '**/accessibility/**/*.spec.ts',

  // UI components with browser-specific rendering
  '**/ui/inline-toolbar.spec.ts',
  '**/ui/toolbox.spec.ts',
  '**/ui/placeholders.spec.ts',
  '**/ui/keyboard-shortcuts.spec.ts',

  // UI state management
  '**/onchange.spec.ts',
  '**/modules/multi-block-conversion.spec.ts',
] as const;

// Logic/API tests - browser-agnostic, run once on Chromium
const LOGIC_TESTS = [
  // API tests (pure logic, no DOM dependencies)
  '**/api/**/*.spec.ts',

  // Module logic tests
  '**/modules/BlockManager.spec.ts',
  '**/modules/block-movement.spec.ts',
  '**/modules/Saver.spec.ts',
  '**/modules/BlockIds.spec.ts',
  '**/modules/selection.spec.ts',
  '**/modules/navigation-mode.spec.ts',
  '**/modules/undo-redo.spec.ts',

  // Tool configuration tests (standard DOM operations)
  '**/tools/block-tool.spec.ts',
  '**/tools/block-tune.spec.ts',
  '**/tools/header.spec.ts',
  '**/tools/inline-tool.spec.ts',
  '**/tools/list.spec.ts',
  '**/tools/paragraph.spec.ts',
  '**/tools/tools-factory.spec.ts',
  '**/tools/tools-collection.spec.ts',

  // UI utilities (generic components)
  '**/utils/**/*.spec.ts',

  // Editor state and configuration
  '**/error-handling.spec.ts',
  '**/i18n.spec.ts',
  '**/read-only.spec.ts',
  '**/sanitisation.spec.ts',
  '**/ui/initialization.spec.ts',
  '**/ui/configuration.spec.ts',
  '**/ui/data-blok-empty.spec.ts',
  '**/ui/ui-module.spec.ts',
  '**/ui/block-tunes.spec.ts',
  '**/ui/plus-block-tunes.spec.ts',
  '**/ui/selection-with-link-input.spec.ts',
  '**/ui/inline-toolbar-nested-popover.spec.ts',
] as const;

// Generate cross-browser projects programmatically
const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
const crossBrowserProjects = BROWSERS.map(browser => ({
  name: browser,
  use: { browserName: browser },
  testMatch: [...CROSS_BROWSER_TESTS],
}));

export default defineConfig({
  globalSetup: './test/playwright/global-setup.ts',
  testDir: 'test/playwright/tests',
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-blok-testid',
  },
  projects: [
    ...crossBrowserProjects,
    {
      name: 'chromium-logic',
      use: { browserName: 'chromium' },
      testMatch: [...LOGIC_TESTS],
    },
  ],
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 3 : AMOUNT_OF_LOCAL_WORKERS,
});

// Export for tooling/scripts
export { CROSS_BROWSER_TESTS, LOGIC_TESTS };
