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
