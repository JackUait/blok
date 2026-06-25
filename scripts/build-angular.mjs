/**
 * Builds the Angular adapter (`@jackuait/blok/angular`) into an Angular Package
 * Format (APF) bundle under `dist/angular/` via ng-packagr.
 *
 * Why a staging directory instead of running ng-packagr against `src/angular`
 * directly:
 *
 * 1. ng-packagr hard-codes the TypeScript `rootDir` to the directory of the
 *    entry file (see ng-packagr `src/lib/ts/tsconfig.ts` → `rootDir: basePath`).
 *    The adapter imports `../shared/deep-equal` (the framework-agnostic dedup
 *    helper shared with the React adapter), which lives OUTSIDE `src/angular`.
 *    A source file outside `rootDir` triggers TS6059 ("not under rootDir"),
 *    and ngtsc crashes while formatting that diagnostic. Staging puts the entry
 *    at the common ancestor of `angular/` + `shared/` so both are under rootDir.
 *
 * 2. The adapter depends only on the PUBLIC `@jackuait/blok` surface. Pointing
 *    that specifier at the repo's hand-authored `types/index.d.ts` barrel drags
 *    the real `types/*.ts` SOURCE files into the library program (they re-export
 *    from `.ts`, not `.d.ts`) — same rootDir crash. So we first flatten the
 *    public types into a single self-contained `.d.ts` (declaration files are
 *    exempt from the rootDir check) and map `@jackuait/blok` to it. The runtime
 *    import stays external (a peer dependency), so core is never bundled in.
 *
 * Output: dist/angular/ (FESM2022 partial-Ivy bundle + flattened d.ts + APF
 * package.json), consumed via the root package.json `./angular` export.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { rollup } from 'rollup';
import dtsPlugin from 'rollup-plugin-dts';

const dts = dtsPlugin.default ?? dtsPlugin;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const stagingDir = path.resolve(root, 'dist/.angular-build');
const destDir = path.resolve(root, 'dist/angular');
const rootPkg = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));
const adapterPkg = JSON.parse(readFileSync(path.resolve(root, 'src/angular/package.json'), 'utf8'));

// Clean staging + previous output.
rmSync(stagingDir, { recursive: true, force: true });
rmSync(destDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

// 1. Flatten the public `@jackuait/blok` types into a single self-contained
//    declaration file so the library program never pulls core `.ts` sources.
const coreTypesFile = path.resolve(stagingDir, 'blok-core.d.ts');
const bundle = await rollup({
  input: path.resolve(root, 'types/index.d.ts'),
  plugins: [dts({ respectExternal: false })],
  onwarn: () => {},
});
await bundle.write({ file: coreTypesFile, format: 'es' });
await bundle.close();

// 2. Stage the adapter + its shared dependency under one root. The entry file
//    sits at the staging root so ng-packagr's rootDir covers both `angular/`
//    and `shared/`; the `../shared/deep-equal` import resolves unchanged.
cpSync(path.resolve(root, 'src/angular'), path.resolve(stagingDir, 'angular'), {
  recursive: true,
  filter: (src) => !src.endsWith('.json'),
});
cpSync(path.resolve(root, 'src/shared'), path.resolve(stagingDir, 'shared'), { recursive: true });
writeFileSync(path.resolve(stagingDir, 'index.ts'), `export * from './angular';\n`, 'utf8');

// 3. The published package.json: name + peer ranges from the canonical template
//    in src/angular, version stamped from the root package, and the core peer
//    pinned to the exact sibling version.
const publishedPkg = {
  ...adapterPkg,
  version: rootPkg.version,
  peerDependencies: {
    ...adapterPkg.peerDependencies,
    '@jackuait/blok': rootPkg.version,
  },
};
writeFileSync(path.resolve(stagingDir, 'package.json'), JSON.stringify(publishedPkg, null, 2), 'utf8');

// 4. ng-packagr config + a self-contained lib tsconfig mapping the core
//    specifier to the flattened declaration.
writeFileSync(
  path.resolve(stagingDir, 'ng-package.json'),
  JSON.stringify(
    {
      $schema: '../../node_modules/ng-packagr/ng-package.schema.json',
      dest: '../angular',
      lib: { entryFile: 'index.ts' },
    },
    null,
    2
  ),
  'utf8'
);
writeFileSync(
  path.resolve(stagingDir, 'tsconfig.lib.json'),
  JSON.stringify(
    {
      extends: '../../tsconfig.json',
      compilerOptions: {
        experimentalDecorators: false,
        emitDecoratorMetadata: false,
        declaration: true,
        declarationMap: false,
        sourceMap: false,
        noEmit: false,
        types: ['node'],
        baseUrl: '.',
        paths: { '@jackuait/blok': ['./blok-core.d.ts'] },
      },
      angularCompilerOptions: {
        compilationMode: 'partial',
        strictTemplates: true,
      },
      exclude: ['node_modules', '**/*.test.ts'],
      include: ['**/*.ts'],
    },
    null,
    2
  ),
  'utf8'
);

// 5. Run ng-packagr against the staged project.
execFileSync(
  path.resolve(root, 'node_modules/.bin/ng-packagr'),
  ['-p', path.resolve(stagingDir, 'ng-package.json'), '-c', path.resolve(stagingDir, 'tsconfig.lib.json')],
  { stdio: 'inherit', cwd: root }
);

// 6. Drop the staging dir; keep only the published APF output.
rmSync(stagingDir, { recursive: true, force: true });

console.log(`Angular adapter built to ${path.relative(root, destDir)}`);
