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
  '**/tools/code-block-paste.spec.ts',
  '**/tools/code-block-enter.spec.ts',
  '**/tools/code-block-no-inline-toolbar.spec.ts',

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

  // UI interactions requiring cross-browser validation
  '**/ui/plus-block-tunes-interaction.spec.ts',
  '**/ui/plus-button-slash.spec.ts',
  '**/ui/inline-toolbar-nested-popover-keyboard.spec.ts',

  // Keyboard shortcuts (contenteditable + keyboard behavior varies)
  '**/tools/header-shortcut.spec.ts',

  // UI interactions involving hover, viewport, mouse events
  '**/ui/mobile-and-readonly-coordination.spec.ts',
  '**/ui/toolbar-nested-list-positioning.spec.ts',
  '**/ui/toolbar-rubber-band-hover.spec.ts',
  '**/ui/toolbar-always-visible.spec.ts',
  '**/ui/settings-toggler-after-drag.spec.ts',

  // Toolbar focus preservation (mouse events - cross-browser)
  '**/modules/toolbar-focus.spec.ts',
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
  '**/tools/code-block-undo-view-mode.spec.ts',
  '**/modules/multi-block-selection-with-toolbar.spec.ts',
  '**/modules/scroll-to-block.spec.ts',

  // Tool configuration tests (standard DOM operations)
  '**/tools/block-tool.spec.ts',
  '**/tools/block-tune.spec.ts',
  '**/tools/callout.spec.ts',
  '**/tools/header.spec.ts',
  '**/tools/inline-tool.spec.ts',
  '**/tools/list.spec.ts',
  '**/tools/paragraph.spec.ts',
  '**/tools/tools-factory.spec.ts',
  '**/tools/tools-collection.spec.ts',

  // UI utilities (generic components)
  '**/utils/**/*.spec.ts',

  // Table read-only rendering (regression coverage for flat-array article shapes)
  '**/tools/table-readonly.spec.ts',

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
  '**/ui/multilingual-search.spec.ts',
  '**/ui/slash-search-placeholder.spec.ts',
  '**/ui/toolbox-no-truncation.spec.ts',
  '**/ui/table-toolbar-visibility.spec.ts',
  '**/ui/css-layer-conflict.spec.ts',
  '**/ui/content-align.spec.ts',
  '**/ui/database-board-pill-width.spec.ts',
  '**/ui/database-pill-title-edit.spec.ts',
  '**/ui/database-single-view-tab-bar.spec.ts',
  '**/ui/database-card-hover-actions.spec.ts',
  '**/ui/block-settings-edit-metadata.spec.ts',

  // Seed/utility tests
  '**/seed.spec.ts',

  // React adapter
  '**/react-adapter.spec.ts',
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
  reporter: process.env.CI
    ? [['blob'], ['list'], ['github']]
    : [['list'], ['html', { open: 'never' }]],
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
    {
      name: 'chromium-default',
      use: { browserName: 'chromium' },
      testIgnore: [...CROSS_BROWSER_TESTS, ...LOGIC_TESTS],
    },
  ],
  webServer: {
    command: 'npx serve . -l 4444 --no-clipboard',
    port: 4444,
    // Don't reuse existing server - it might be a Vite dev server which has
    // module resolution issues under concurrent test load
    reuseExistingServer: false,
    timeout: 120000, // Give the server more time to start up
  },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 3 : AMOUNT_OF_LOCAL_WORKERS,
});

// Export for tooling/scripts
export { CROSS_BROWSER_TESTS, LOGIC_TESTS };
