import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { BLOCK_CONTENT_CLASSES, BLOCK_WRAPPER_CLASSES } from '../../../src/shared/block-scaffolding';
import { ALL_STATIC_CLASSES } from '../../../src/shared/tool-classes';

/**
 * VIEW BASELINE STYLESHEET LAW
 *
 * `@bloklabs/core/view` emits clean, unstyled semantic HTML. Read-only
 * consumers (hr-platform's ~55 sites) otherwise reverse-engineer the editor's
 * block spacing with fragile bare-tag CSS that drifts from the real token
 * values. The opt-in `@bloklabs/core/view.css` closes that gap: a
 * `[data-blok-tool]`-keyed sheet that reads the SAME public
 * `--blok-block-padding-*` custom properties the editor's block padding routes
 * through (main.css), so there is one source of truth for the spacing.
 *
 * This law pins the file's existence, its packaging (so it actually ships in
 * the tarball and resolves via the `./view.css` export), and the fact that it
 * keys on the tool hook and reads the real padding tokens with their editor
 * defaults — not hand-picked numbers that can silently diverge.
 *
 * Since the parity work the sheet is GENERATED (scripts/generate-view-css.mjs)
 * from the same shared class modules the emitters stamp, so the law also pins
 * the three properties a generated artifact needs: that it covers every class
 * those modules can emit, that the committed file is what the generator
 * currently produces, and that it has not quietly grown unbounded.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Measured at 46,315 bytes when the sheet was first generated (Phase A: text
 * blocks + scaffolding), rounded up ~15%.
 *
 * Raising this is a DECISION, not a fix. The documented next step when Phase B
 * media styling pushes the sheet past the budget is to split it into an opt-in
 * `view-media.css`, so hosts rendering text-only documents keep paying for text
 * only — not to pick a bigger number.
 */
const VIEW_CSS_BYTE_BUDGET = 53_000;

const readManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;

/**
 * Render a class name the way it appears as a CSS selector.
 *
 * Tailwind escapes every character outside `[A-Za-z0-9_-]` with a backslash, so
 * `leading-[1.5]` is emitted as `.leading-\[1\.5\]`. Substring-matching the raw
 * class name would find `pl-8` inside `.pl-8\.5` and report coverage the sheet
 * does not have.
 * @param cls - a class name as written in the shared modules
 */
const cssEscapeClass = (cls: string): string =>
  `.${cls.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)}`;

describe('view baseline stylesheet law', () => {
  it('ships the opt-in stylesheet at the repo root', () => {
    expect(existsSync(join(repoRoot, 'view.css')), 'view.css is missing').toBe(true);
  });

  it('lists view.css in the published files array', () => {
    const files = (readManifest().files ?? []) as string[];

    expect(files, 'view.css is not packed into the tarball').toContain('view.css');
  });

  it('exposes the ./view.css subpath export', () => {
    const exportsMap = readManifest().exports as Record<string, unknown>;

    expect(exportsMap['./view.css'], 'the ./view.css export is missing').toBe('./view.css');
  });

  it('keys on the data-blok-tool hook and reads the real padding tokens', () => {
    const css = readFileSync(join(repoRoot, 'view.css'), 'utf-8');

    expect(css, 'stylesheet must key on the tool hook').toContain('[data-blok-tool]');
    expect(css).toContain('var(--blok-block-padding-top, 7px)');
    expect(css).toContain('var(--blok-block-padding-bottom, 7px)');
    expect(css).toContain('var(--blok-block-padding-inline, 2px)');
  });

  it('reads the same padding-token defaults the editor declares', () => {
    // Single source of truth: the defaults baked into the fallback must match
    // what main.css applies to each editable block, or the view drifts.
    const mainCss = readFileSync(join(repoRoot, 'src/styles/main.css'), 'utf-8');

    expect(mainCss).toContain('--blok-block-padding-top,7px');
    expect(mainCss).toContain('--blok-block-padding-bottom,7px');
    expect(mainCss).toContain('--blok-block-padding-inline,2px');
  });

  describe('generated coverage', () => {
    /** Guards the escape helper itself — a broken one would fake coverage. */
    it.each([
      ['leading-[1.5]', '.leading-\\[1\\.5\\]'],
      ['[&>p:first-of-type]:mt-0', '.\\[\\&\\>p\\:first-of-type\\]\\:mt-0'],
      ['pl-8', '.pl-8'],
    ])('escapes %s the way Tailwind emits it', (cls, expected) => {
      expect(cssEscapeClass(cls)).toBe(expected);
    });

    it('covers every class the shared modules can emit', () => {
      const css = readFileSync(join(repoRoot, 'view.css'), 'utf-8');

      /**
       * Missing coverage means the generator's prune dropped a rule the
       * emitters still stamp — the exact failure a jsdom class-parity gate
       * cannot see, because both sides agree on the class and neither knows
       * whether a stylesheet backs it.
       */
      const uncovered = [
        ...new Set([...ALL_STATIC_CLASSES, ...BLOCK_WRAPPER_CLASSES, ...BLOCK_CONTENT_CLASSES]),
      ].filter((cls) => !css.includes(cssEscapeClass(cls)));

      expect(uncovered, `view.css is missing rules for: ${uncovered.join(', ')}`).toEqual([]);
    });

    it('is regeneration-fresh', () => {
      const before = readFileSync(join(repoRoot, 'view.css'), 'utf-8');

      execFileSync('node', ['scripts/generate-view-css.mjs'], { cwd: repoRoot });

      expect(
        readFileSync(join(repoRoot, 'view.css'), 'utf-8'),
        'view.css is stale — run `node scripts/generate-view-css.mjs`'
      ).toBe(before);
    }, 60_000);

    it('stays within the byte budget', () => {
      expect(readFileSync(join(repoRoot, 'view.css')).byteLength).toBeLessThan(VIEW_CSS_BYTE_BUDGET);
    });

    it('ships no presence chrome — a view has no collaborators in it', () => {
      /**
       * Presence rules are attribute-keyed and several are pure custom-property
       * carriers, so the pruner keeps them the way it keeps a theme token —
       * except a rendered view has no awareness, no peers and no silhouettes,
       * so every byte of it is dead weight inside a budgeted sheet.
       */
      expect(readFileSync(join(repoRoot, 'view.css'), 'utf-8')).not.toContain('presence');
    });

    it('ships no webfonts — a view inherits the host typography', () => {
      /**
       * fonts.css alone is ~226 KB of base64. Bundling it would quintuple the
       * sheet for a face most hosts already serve.
       */
      expect(readFileSync(join(repoRoot, 'view.css'), 'utf-8')).not.toContain('@font-face');
    });
  });
});
