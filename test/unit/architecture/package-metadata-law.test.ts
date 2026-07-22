import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * PACKAGE METADATA LAW
 *
 * Every published manifest is a public, independently indexed page: npmjs.com renders
 * `description`, `keywords`, `homepage`, `repository` and the README, and that page is the
 * first thing both search engines and human evaluators see. The three adapter packages
 * shipped 1.3.0 with zero keywords and no README at all (`npm view @bloklabs/react readme`
 * → "No README data found"), so their pages carried nothing a developer could search for.
 *
 * This law pins the discovery-facing fields so they cannot silently regress:
 * - the category terms people actually type ("block editor", "wysiwyg", "notion-like")
 * - the framework term on each adapter
 * - `homepage`/`bugs`/`repository`/`license`/`author`, which npm turns into page links
 * - a README with an install command, a real usage snippet and a docs link
 *
 * Deliberately zero-dependency: readable in a no-install context like the other law tests.
 *
 * A README in the SOURCE directory is not the same as a README in the tarball. Every package
 * but Angular packs from its own directory, so the two coincide; @bloklabs/angular packs from
 * the ng-packagr output at `packages/angular/dist` (see FAMILY in scripts/release-manifest.mjs),
 * and nothing copied a README there. The source README satisfied the clause below while the
 * published page stayed empty — the exact failure this law was written to catch, passing.
 * The pack-dir clause closes that hole.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const HOMEPAGE = 'https://blokeditor.com';
const REPOSITORY_URL = 'git+https://github.com/JackUait/blok.git';
const BUGS_URL = 'https://github.com/JackUait/blok/issues';

/** Category terms shared by every package that IS the editor (core + the adapters). */
const EDITOR_KEYWORDS = [
  'block-editor',
  'rich-text-editor',
  'wysiwyg',
  'editor',
  'notion',
  'notion-like',
  'headless',
  'block-based',
  'contenteditable',
  'json',
  'typescript',
];

interface PublishedPackage {
  /** Directory relative to the repo root. */
  dir: string;
  /**
   * Directory npm actually packs, mirrored from FAMILY in scripts/release-manifest.mjs.
   * Equal to `dir` for every package but Angular, which packs its ng-packagr output.
   */
  packDir: string;
  name: string;
  /** Keywords this manifest must carry, on top of anything else it lists. */
  requiredKeywords: string[];
  /**
   * Whether the README clause applies. False for the root package only: its README is the
   * repo's front page and is maintained on its own terms, not to this shape.
   */
  requiresReadme: boolean;
}

const publishedPackages: PublishedPackage[] = [
  {
    dir: '.',
    packDir: '.',
    name: '@bloklabs/core',
    requiredKeywords: [ ...EDITOR_KEYWORDS, 'react', 'vue', 'angular' ],
    requiresReadme: false,
  },
  {
    dir: 'packages/react',
    packDir: 'packages/react',
    name: '@bloklabs/react',
    requiredKeywords: [ ...EDITOR_KEYWORDS, 'react', 'react-component' ],
    requiresReadme: true,
  },
  {
    dir: 'packages/vue',
    packDir: 'packages/vue',
    name: '@bloklabs/vue',
    requiredKeywords: [ ...EDITOR_KEYWORDS, 'vue', 'vue3' ],
    requiresReadme: true,
  },
  {
    dir: 'packages/angular',
    packDir: 'packages/angular/dist',
    name: '@bloklabs/angular',
    requiredKeywords: [ ...EDITOR_KEYWORDS, 'angular' ],
    requiresReadme: true,
  },
  {
    dir: 'packages/cli',
    packDir: 'packages/cli',
    // Not the editor — a converter — so it carries the migration vocabulary instead of
    // "contenteditable"/"wysiwyg", which would be keyword spam on a CLI page.
    name: '@bloklabs/cli',
    requiredKeywords: [ 'block-editor', 'rich-text-editor', 'editorjs', 'migration', 'json' ],
    requiresReadme: true,
  },
];

const readManifest = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf-8')) as Record<string, unknown>;

const readString = (manifest: Record<string, unknown>, key: string): string => {
  const value = manifest[key];

  return typeof value === 'string' ? value : '';
};

describe('package metadata law', () => {
  it.each(publishedPackages)('$name declares the discovery-facing fields', ({ dir, name }) => {
    const manifest = readManifest(dir);

    expect(manifest.name).toBe(name);
    expect(readString(manifest, 'description').length, `${name} has no description`).toBeGreaterThan(20);
    expect(manifest.homepage, `${name} homepage must point at the docs site`).toBe(HOMEPAGE);
    expect(manifest.license).toBe('Apache-2.0');
    expect(readString(manifest, 'author'), `${name} has no author`).not.toBe('');
    expect((manifest.repository as { url?: string } | undefined)?.url).toBe(REPOSITORY_URL);
    expect((manifest.bugs as { url?: string } | undefined)?.url).toBe(BUGS_URL);
  });

  it.each(publishedPackages)('$name carries the searched category keywords', ({ dir, name, requiredKeywords }) => {
    const keywords = (readManifest(dir).keywords ?? []) as string[];
    const missing = requiredKeywords.filter((keyword) => !keywords.includes(keyword));

    expect(missing, `${name} is missing keywords: ${missing.join(', ')}`).toEqual([]);
  });

  it('the declared license matches the LICENSE file', () => {
    const license = readFileSync(join(repoRoot, 'LICENSE'), 'utf-8');

    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0');
  });

  it.each(publishedPackages.filter((pkg) => pkg.requiresReadme))(
    '$name ships a README with install, usage and a docs link',
    ({ dir, name }) => {
      const readmePath = join(repoRoot, dir, 'README.md');

      expect(existsSync(readmePath), `${name} has no README — its npm page renders empty`).toBe(true);

      const readme = readFileSync(readmePath, 'utf-8');

      expect(readme.length, `${name} README is too thin to be a useful npm page`).toBeGreaterThan(400);
      expect(readme, `${name} README has no install command`).toMatch(
        new RegExp(`(npm install|npx) ${name.replace('/', '\\/')}`)
      );
      expect(readme, `${name} README has no fenced code sample`).toContain('```');
      expect(readme, `${name} README does not link to the docs site`).toContain(`${HOMEPAGE}/docs`);
    }
  );

  it('the pack directories still match the release manifest', async () => {
    const { FAMILY } = (await import('../../../scripts/release-manifest.mjs')) as {
      FAMILY: { npmName: string; packDir: string }[];
    };

    const drifted = publishedPackages.filter(
      (pkg) => FAMILY.find((entry) => entry.npmName === pkg.name)?.packDir !== pkg.packDir
    );

    expect(drifted.map((pkg) => pkg.name), 'packDir here no longer matches FAMILY').toEqual([]);
  });

  it.each(publishedPackages.filter((pkg) => pkg.requiresReadme && pkg.packDir !== pkg.dir))(
    '$name stages its README into the directory it packs from',
    ({ dir, packDir, name }) => {
      // A generated pack dir only holds what the build script puts there. Assert against the
      // script rather than the built output, so a clean checkout catches the omission too.
      const script = readFileSync(join(repoRoot, 'scripts/build-angular.mjs'), 'utf-8');

      expect(
        script,
        `nothing copies ${dir}/README.md into ${packDir}, so ${name}'s npm page renders empty`
      ).toMatch(/README\.md/);

      // When the build HAS run, the file must actually be there.
      if (existsSync(join(repoRoot, packDir))) {
        expect(
          existsSync(join(repoRoot, packDir, 'README.md')),
          `${packDir} was built without a README`
        ).toBe(true);
      }
    }
  );

  // Non-vacuity guard: the two it.each blocks above assert nothing if the package list
  // is ever emptied or the keyword lists are cleared.
  it('the law actually checks something', () => {
    expect(publishedPackages.length).toBeGreaterThanOrEqual(5);
    expect(publishedPackages.every((pkg) => pkg.requiredKeywords.length >= 5)).toBe(true);
  });
});
