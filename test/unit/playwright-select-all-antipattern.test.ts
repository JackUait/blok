import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import path from 'node:path';

/**
 * Guards against the flaky webkit anti-pattern discovered in v0.10.9:
 *
 *     await locator.click();
 *     await page.keyboard.press('Meta+a');
 *     await expect(inlineToolbar).toBeVisible();
 *
 * Under webkit headless the click → focus → keyboard race can leave the
 * selection collapsed. `InlineSelectionValidator` then rejects the "empty
 * selection" and the inline toolbar never opens, so the `toBeVisible()`
 * assertion times out far from the real cause.
 *
 * The deterministic alternative is `selectAllInEditable` from
 * `test/playwright/tests/helpers/selection.ts`, which builds a `Range`,
 * assigns it to the document selection and dispatches `selectionchange`
 * synchronously — bypassing the focus race and the 180ms debounce.
 *
 * This scanner fires on any Playwright spec that chains a
 * `keyboard.press('<mod>+a')` (or the split-key-press form) into an
 * inline-toolbar / bold-button / popover-item visibility assertion.
 */

const SELECT_ALL_PRESS_PATTERNS: readonly RegExp[] = [
  /keyboard\.press\s*\(\s*[`'"]\s*(?:\$\{[^}]+\}|Meta|Control|ControlOrMeta)\s*\+\s*a\s*[`'"]/i,
  /keyboard\.press\s*\(\s*[`'"]\s*(?:\$\{[^}]+\}|Meta|Control|ControlOrMeta)\s*\+\s*KeyA\s*[`'"]/i,
];

const SPLIT_KEY_DOWN_PATTERN = /keyboard\.down\s*\(\s*[`'"](?:Meta|Control)[`'"]\s*\)/i;
const SPLIT_KEY_PRESS_A_PATTERN = /keyboard\.press\s*\(\s*[`'"](?:a|KeyA)[`'"]\s*\)/i;

const INLINE_TOOLBAR_EXPECT_PATTERNS: readonly RegExp[] = [
  /(INLINE_TOOLBAR_SELECTOR|inlineToolbar|boldButton|italicButton|markerButton|linkButton|underlineButton)[\s\S]*?toBeVisible\s*\(/,
  /data-blok-popover-item-active/,
  /data-blok-testid=\s*["']?inline-toolbar/,
];

const ALLOW_MARKER = '@select-all-ok';
const LINE_WINDOW = 25;

interface Offense {
  line: number;
  text: string;
}

/**
 * Pure scanner used by the guard test below. Exported-as-const so it can
 * be exercised directly with synthetic sources in the dedicated "scanner
 * self-tests" suite, without having to write real playwright specs.
 * @param source - Full text of a playwright spec file.
 * @returns List of line offenses (1-indexed) where the anti-pattern occurs.
 */
const findSelectAllAntipatternOffenses = (source: string): Offense[] => {
  const lines = source.split('\n');

  return lines.flatMap((line, idx) => {
    const pressHits = SELECT_ALL_PRESS_PATTERNS.some((pattern) => pattern.test(line));
    const splitFormHits = SPLIT_KEY_PRESS_A_PATTERN.test(line)
      && lines.slice(Math.max(0, idx - LINE_WINDOW), idx).some((prior) => SPLIT_KEY_DOWN_PATTERN.test(prior));

    if (!pressHits && !splitFormHits) {
      return [];
    }

    const windowEnd = Math.min(lines.length, idx + LINE_WINDOW);
    const windowText = lines.slice(idx, windowEnd).join('\n');
    const allowWindowStart = Math.max(0, idx - 5);
    const allowWindowText = lines.slice(allowWindowStart, windowEnd).join('\n');
    const chainsIntoInlineToolbar = INLINE_TOOLBAR_EXPECT_PATTERNS.some((pattern) => pattern.test(windowText));
    const isAllowlisted = allowWindowText.includes(ALLOW_MARKER);

    if (!chainsIntoInlineToolbar || isAllowlisted) {
      return [];
    }

    return [ { line: idx + 1,
      text: line.trim() } ];
  });
};

describe('playwright select-all anti-pattern guard', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const specFiles = globSync('test/playwright/tests/**/*.spec.ts', {
    cwd: repoRoot,
    absolute: true,
  });

  it('finds at least one playwright spec to scan', () => {
    expect(specFiles.length).toBeGreaterThan(0);
  });

  it.each(specFiles.map((file) => [ path.relative(repoRoot, file), file ]))(
    '%s does not chain keyboard select-all into an inline-toolbar visibility assertion',
    (_, absPath) => {
      const source = readFileSync(absPath, 'utf8');
      const offenses = findSelectAllAntipatternOffenses(source);
      const formatted = offenses.map((offense) => `  line ${offense.line}: ${offense.text}`).join('\n');
      const message = `Use selectAllInEditable() from helpers/selection.ts instead of keyboard-shortcut select-all + inline-toolbar expect. If you truly need the keyboard shortcut, add a comment containing "${ALLOW_MARKER}" in the same block.\n${formatted}`;

      expect(offenses, message).toEqual([]);
    }
  );
});

describe('scanner self-tests', () => {
  it('flags the canonical Meta+a → toBeVisible chain', () => {
    const source = `await paragraph.click();
await page.keyboard.press('Meta+a');
const toolbar = page.locator(INLINE_TOOLBAR_SELECTOR);
await expect(toolbar).toBeVisible();`;
    const offenses = findSelectAllAntipatternOffenses(source);

    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.line).toBe(2);
  });

  it('flags the templated modifier form', () => {
    const source = `await paragraph.click();
await page.keyboard.press(\`\${MODIFIER_KEY}+a\`);
await expect(boldButton).toBeVisible();`;
    const offenses = findSelectAllAntipatternOffenses(source);

    expect(offenses).toHaveLength(1);
  });

  it('flags the ControlOrMeta+a form', () => {
    const source = `await page.keyboard.press('ControlOrMeta+a');
await expect(inlineToolbar).toBeVisible();`;

    expect(findSelectAllAntipatternOffenses(source)).toHaveLength(1);
  });

  it('flags the KeyA form', () => {
    const source = `await page.keyboard.press('Meta+KeyA');
await expect(boldButton).toBeVisible();`;

    expect(findSelectAllAntipatternOffenses(source)).toHaveLength(1);
  });

  it('flags the split keyboard.down + keyboard.press("a") form', () => {
    const source = `await page.keyboard.down('Meta');
await page.keyboard.press('a');
await page.keyboard.up('Meta');
await expect(italicButton).toBeVisible();`;
    const offenses = findSelectAllAntipatternOffenses(source);

    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.line).toBe(2);
  });

  it('flags the popover-item-active attribute assertion', () => {
    const source = `await page.keyboard.press('Meta+a');
await expect(page.locator('[data-blok-item-name="bold"]'))
  .toHaveAttribute('data-blok-popover-item-active', 'true');`;

    expect(findSelectAllAntipatternOffenses(source)).toHaveLength(1);
  });

  it('ignores select-all followed by non-toolbar actions (backspace, paste, copy)', () => {
    const source = `await paragraph.click();
await page.keyboard.press('Meta+a');
await page.keyboard.press('Backspace');`;

    expect(findSelectAllAntipatternOffenses(source)).toEqual([]);
  });

  it('ignores Meta+b / keyboard shortcuts unrelated to select-all', () => {
    const source = `await page.keyboard.press('Meta+b');
await expect(boldButton).toBeVisible();`;

    expect(findSelectAllAntipatternOffenses(source)).toEqual([]);
  });

  it('ignores occurrences allowlisted via the @select-all-ok marker', () => {
    const source = `// @select-all-ok — legitimate raw-keyboard coverage for shortcut test
await page.keyboard.press('Meta+a');
await expect(inlineToolbar).toBeVisible();`;

    expect(findSelectAllAntipatternOffenses(source)).toEqual([]);
  });

  it('treats the inline-toolbar expectation as out-of-range beyond the window', () => {
    const spacer = Array.from({ length: LINE_WINDOW + 5 }, () => '// filler').join('\n');
    const source = `await page.keyboard.press('Meta+a');
${spacer}
await expect(inlineToolbar).toBeVisible();`;

    expect(findSelectAllAntipatternOffenses(source)).toEqual([]);
  });

  it('does not double-count when both split form and explicit press appear', () => {
    const source = `await page.keyboard.down('Meta');
await page.keyboard.press('a');
await expect(boldButton).toBeVisible();`;
    const offenses = findSelectAllAntipatternOffenses(source);

    expect(offenses).toHaveLength(1);
  });
});
