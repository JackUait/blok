import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { transform } from 'lightningcss';
import viteConfig from '../../../vite.config.mjs';

/**
 * Vite minifies CSS with lightningcss using `build.cssTarget` (or `build.target`
 * when unset). Old targets lower logical properties into physical rules guarded
 * by `:lang(ar|he|…)`, which key on the HOST page's `lang` — not on Blok's
 * direction. An RTL editor on a `lang="en"` page then lays out as LTR.
 */
const LOGICAL_SAMPLE = '.a{padding-inline-start:4px;margin-inline-end:2px;inset-inline-start:0;border-inline-start:1px solid red;text-align:start}';

const toLightningTargets = (targets: string[]): Record<string, number> => {
  return Object.fromEntries(targets.map((target) => {
    const match = /^([a-z]+)(\d+)$/.exec(target);

    if (match === null) {
      throw new Error(`Unrecognised cssTarget entry: ${target}`);
    }

    return [ match[1], Number(match[2]) << 16 ];
  }));
};

describe('production CSS keeps logical properties', () => {
  it('declares an explicit modern build.cssTarget', () => {
    const config = viteConfig({ mode: 'production', command: 'build' });
    const cssTarget: unknown = config.build?.cssTarget;

    expect(Array.isArray(cssTarget)).toBe(true);
  });

  it('does not lower logical properties into :lang()-guarded physical rules', () => {
    const config = viteConfig({ mode: 'production', command: 'build' });
    const cssTarget = config.build?.cssTarget;
    // Unset cssTarget falls back to build.target 'es2017', which Vite converts to these.
    const targets = Array.isArray(cssTarget) ? cssTarget.map(String) : [ 'chrome58', 'edge16', 'firefox57', 'safari11' ];
    const { code } = transform({
      filename: 'sample.css',
      code: Buffer.from(LOGICAL_SAMPLE),
      minify: true,
      targets: toLightningTargets(targets),
    });
    const output = code.toString();

    expect(output).not.toContain(':lang(');
    expect(output).toContain('padding-inline-start');
  });
});

const listCss = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);

  if (entry.isDirectory()) {
    return listCss(full);
  }

  return entry.name.endsWith('.css') ? [ full ] : [];
});

describe('direction selectors survive the build', () => {
  // `:dir()` is newer than the cssTarget floor, so it is lowered to the same
  // `lang`-keyed rules. Blok stamps `dir` on its roots: select `[dir=rtl]`.
  it('no source stylesheet uses :dir()', () => {
    const offenders = listCss(resolve(__dirname, '../../../src')).filter((file) => readFileSync(file, 'utf8').includes(':dir('));

    expect(offenders).toEqual([]);
  });
});
