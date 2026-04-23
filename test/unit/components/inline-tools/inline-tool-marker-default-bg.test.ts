import { describe, it, expect } from 'vitest';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import { clean } from '../../../../src/components/utils/sanitizer';

/**
 * Regression suite: the marker per-tool sanitizer (`MarkerInlineTool.sanitize`)
 * must strip default page-background colors from `<mark>` elements before they
 * are persisted to block data.
 *
 * Bug context: HtmlHandler / BlokDataHandler / TableCellsHandler all run
 * `clean()` (or `sanitizeBlocks()`) with this rule on pasted HTML *before*
 * inserting blocks. When the paste source is something other than Google Docs
 * (Notion, Word, browser-native clipboard from another editor, an old Blok
 * version) the HTML may already contain raw `<mark style="background-color:
 * #ffffff">…</mark>`. The Google Docs preprocessor only filters `<span>`
 * elements, so a raw `<mark>` slips through. The current per-tool rule blindly
 * preserves any `color` / `background-color` it finds, so the white background
 * survives sanitisation and lands in the saved block JSON.
 *
 * Render-time `migrateMarkColors()` strips it on the next document load, but
 * within the same session the saved data is dirty: anyone reading the JSON via
 * Saver before the next reload sees the spurious white/dark background.
 *
 * The fix is to mirror the `<span>` filter: strip near-white and near-black
 * background-colors during sanitization.
 */
describe('MarkerInlineTool.sanitize — default page backgrounds', () => {
  const sanitizeMarkHtml = (html: string): string => {
    return clean(html, MarkerInlineTool.sanitize);
  };

  it('strips background-color: #ffffff from a pasted <mark>', () => {
    const result = sanitizeMarkHtml('<mark style="background-color: #ffffff">hello</mark>');

    expect(result).not.toMatch(/background-color/i);
  });

  it('strips background-color: rgb(255, 255, 255) from a pasted <mark>', () => {
    const result = sanitizeMarkHtml('<mark style="background-color: rgb(255, 255, 255)">hello</mark>');

    expect(result).not.toMatch(/background-color/i);
  });

  it('strips background-color: white keyword from a pasted <mark>', () => {
    const result = sanitizeMarkHtml('<mark style="background-color: white">hello</mark>');

    expect(result).not.toMatch(/background-color/i);
  });

  it('strips near-black background-color (#191918 dark-mode page bg) from a pasted <mark>', () => {
    const result = sanitizeMarkHtml('<mark style="background-color: #191918">hello</mark>');

    expect(result).not.toMatch(/background-color/i);
  });

  it('strips near-black background-color rgb(25, 25, 24) from a pasted <mark>', () => {
    const result = sanitizeMarkHtml('<mark style="background-color: rgb(25, 25, 24)">hello</mark>');

    expect(result).not.toMatch(/background-color/i);
  });

  it('preserves an intentional non-default background-color', () => {
    const result = sanitizeMarkHtml('<mark style="background-color: #fbecdd">hello</mark>');

    expect(result).toMatch(/background-color/i);
    expect(result).toMatch(/#fbecdd|rgb\(\s*251\s*,\s*236\s*,\s*221\s*\)/i);
  });

  it('preserves a foreground color even when background is a stripped default', () => {
    const result = sanitizeMarkHtml(
      '<mark style="color: #d44c47; background-color: #ffffff">hello</mark>'
    );

    /* jsdom normalizes hex to rgb() — accept either form for the foreground color. */
    expect(result).toMatch(/color:\s*(#d44c47|rgb\(\s*212\s*,\s*76\s*,\s*71\s*\))/i);
    expect(result).not.toMatch(/background-color:\s*(#ffffff|rgb\(\s*255)/i);
  });
});
