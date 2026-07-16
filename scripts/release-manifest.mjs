import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/**
 * The @bloklabs/* package family released in lockstep by scripts/release.mjs.
 *
 * Each entry describes one package: where its manifest lives, which directory
 * `npm pack` runs in, its npmjs name, and its GitHub Packages mirror name
 * (GHP forces the @dodopizza scope, and slashes can't carry over, so mirrors
 * use the dash form).
 *
 * Publish order matters: core first so adapter peers always have a published
 * target at the moment they land.
 */
export const FAMILY = [
  {
    npmName: '@bloklabs/core',
    gprName: '@dodopizza/blok',
    manifestPath: 'package.json',
    packDir: '.',
  },
  {
    npmName: '@bloklabs/react',
    gprName: '@dodopizza/blok-react',
    manifestPath: 'packages/react/package.json',
    packDir: 'packages/react',
  },
  {
    npmName: '@bloklabs/vue',
    gprName: '@dodopizza/blok-vue',
    manifestPath: 'packages/vue/package.json',
    packDir: 'packages/vue',
  },
  {
    // The publishable Angular artifact is the ng-packagr APF output — its
    // generated manifest (version-stamped peers) is the one that ships.
    npmName: '@bloklabs/angular',
    gprName: '@dodopizza/blok-angular',
    manifestPath: 'packages/angular/dist/package.json',
    packDir: 'packages/angular/dist',
  },
  {
    npmName: '@bloklabs/cli',
    gprName: '@dodopizza/blok-cli',
    manifestPath: 'packages/cli/package.json',
    packDir: 'packages/cli',
  },
];

/**
 * Build the GitHub Packages variant of a package manifest: renames the package
 * to its @dodopizza mirror name and maps the `@bloklabs/core` peer dependency to
 * the mirror's core name (`@dodopizza/blok`), keeping the version range.
 * Pure — returns a deep-enough copy, never mutates the input.
 *
 * @param {object} pkgJson - Parsed package.json contents
 * @param {{ gprName: string }} entry - The FAMILY entry for this package
 * @returns {object} The rewritten manifest object
 */
/**
 * Rewrite `@bloklabs/core` specifiers inside bundled adapter code to the
 * GitHub Packages mirror's core name, so a GHP-only consumer resolves the
 * peer they actually installed (`@dodopizza/blok`) instead of a package
 * from a registry they may not use. Subpaths (`/adapters`, `/markdown`, …)
 * are preserved because the substring match keeps everything after the name.
 *
 * @param {string} source - Bundle source code (.mjs/.cjs/.d.ts)
 * @returns {string}
 */
export function rewriteSpecifiersForGpr(source) {
  return source.replaceAll('@bloklabs/core', '@dodopizza/blok');
}

/** Asset extensions that can't carry a package specifier — never rewritten. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.wasm', '.node', '.tgz', '.zip',
]);

/** Root-level files npm packs even when absent from the manifest `files` list. */
const AUTO_INCLUDED_ROOT_FILES = /^(readme|changelog|license|licence|notice)(\.|$)/i;

/**
 * Collect every text file that ships in a package's tarball, so the GPR
 * mirror publish can rewrite `@bloklabs/core` specifiers in ALL of them —
 * bundles, hand-authored types, shipped sources, docs — not a hand-maintained
 * subset. Coverage is derived from the manifest's `files` list (or the whole
 * pack dir when absent, e.g. the Angular APF output) plus npm's auto-included
 * root docs. The manifest itself is excluded: prepareManifestForGpr rewrites
 * it structurally.
 *
 * @param {{ packDir: string, manifestPath: string }} entry - FAMILY-shaped entry
 * @returns {string[]} Paths of files to rewrite
 */
export function collectGprRewriteFiles({ packDir, manifestPath }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const manifestAbs = resolve(manifestPath);
  const collected = new Set();

  const visit = (path) => {
    if (!existsSync(path)) return;

    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) {
        if (name === 'node_modules') continue;
        visit(join(path, name));
      }

      return;
    }

    if (resolve(path) === manifestAbs) return;

    const ext = extname(path).toLowerCase();

    if (BINARY_EXTENSIONS.has(ext)) return;

    collected.add(path);
  };

  if (Array.isArray(manifest.files)) {
    for (const entry of manifest.files) {
      visit(join(packDir, entry));
    }

    for (const name of readdirSync(packDir)) {
      if (AUTO_INCLUDED_ROOT_FILES.test(name)) {
        visit(join(packDir, name));
      }
    }
  } else {
    visit(packDir);
  }

  return [...collected];
}

export function prepareManifestForGpr(pkgJson, entry) {
  const out = { ...pkgJson, name: entry.gprName };

  if (pkgJson.peerDependencies && '@bloklabs/core' in pkgJson.peerDependencies) {
    const peers = { ...pkgJson.peerDependencies };

    peers['@dodopizza/blok'] = peers['@bloklabs/core'];
    delete peers['@bloklabs/core'];
    out.peerDependencies = peers;
  }

  return out;
}
