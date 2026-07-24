import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

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
 * Deliberately zero-dependency: readable in a no-install context.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const readManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;

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
});
