import { test, expect } from '@playwright/test';

/**
 * These tests verify that Blok's UI is isolated from host-page styles.
 *
 * Two isolation behaviors are tested:
 * 1. Ambient host styles do NOT cascade into Blok (isolation works).
 * 2. Explicit targeting of Blok selectors still applies styles (user overrides work).
 */
test.describe('Style isolation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-blok-testid="blok-editor"]');
  });

  test('host body font-family does not cascade into editor wrapper', async ({ page }) => {
    // Inject aggressive host-page font styles
    await page.addStyleTag({
      content: `body { font-family: 'Times New Roman', serif !important; }`,
    });

    const editorFontFamily = await page.locator('[data-blok-interface]').evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(editorFontFamily).not.toContain('Times New Roman');
  });

  test('host wildcard color does not cascade into editor wrapper', async ({ page }) => {
    await page.addStyleTag({
      content: `* { color: rgb(255, 0, 0) !important; }`,
    });

    const editorColor = await page.locator('[data-blok-interface]').evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(editorColor).not.toBe('rgb(255, 0, 0)');
  });

  test('host body font-family does not cascade into popover', async ({ page }) => {
    await page.addStyleTag({
      content: `body { font-family: 'Times New Roman', serif !important; }`,
    });

    // Open the toolbox via + button
    await page.getByTestId('toolbox-toggler').click();
    await page.waitForSelector('[data-blok-popover]');

    const popoverFontFamily = await page.locator('[data-blok-popover]').first().evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(popoverFontFamily).not.toContain('Times New Roman');
  });

  test('host wildcard color does not cascade into popover', async ({ page }) => {
    await page.addStyleTag({
      content: `* { color: rgb(255, 0, 0) !important; }`,
    });

    await page.getByTestId('toolbox-toggler').click();
    await page.waitForSelector('[data-blok-popover]');

    const popoverColor = await page.locator('[data-blok-popover]').first().evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(popoverColor).not.toBe('rgb(255, 0, 0)');
  });

  test('explicit targeting of [data-blok-interface] still applies styles', async ({ page }) => {
    // User explicitly targets Blok's wrapper — this SHOULD work
    await page.addStyleTag({
      content: `[data-blok-interface] { color: rgb(0, 128, 0) !important; }`,
    });

    const editorColor = await page.locator('[data-blok-interface]').evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(editorColor).toBe('rgb(0, 128, 0)');
  });
});
