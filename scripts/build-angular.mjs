/**
 * Builds the Angular adapter (`@bloklabs/angular`) into an Angular Package
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
 * 2. The adapter depends only on the PUBLIC `@bloklabs/core` surface. Pointing
 *    that specifier at the repo's hand-authored `types/index.d.ts` barrel drags
 *    the real `types/*.ts` SOURCE files into the library program (they re-export
 *    from `.ts`, not `.d.ts`) — same rootDir crash. So we first flatten the
 *    public types into a single self-contained `.d.ts` (declaration files are
 *    exempt from the rootDir check) and map `@bloklabs/core` to it. The runtime
 *    import stays external (a peer dependency), so core is never bundled in.
 *
 * Output: dist/angular/ (FESM2022 partial-Ivy bundle + flattened d.ts + APF
 * package.json), consumed via the root package.json `./angular` export.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { rollup } from 'rollup';
import dtsPlugin from 'rollup-plugin-dts';

const dts = dtsPlugin.default ?? dtsPlugin;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const stagingDir = path.resolve(root, 'dist/.angular-build');
const destDir = path.resolve(root, 'packages/angular/dist');
const rootPkg = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));
const adapterPkg = JSON.parse(readFileSync(path.resolve(root, 'packages/angular/package.json'), 'utf8'));

// Clean staging + previous output.
rmSync(stagingDir, { recursive: true, force: true });
rmSync(destDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

// 1. Flatten the public `@bloklabs/core` types into a single self-contained
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
//
//    Additional staging: adapter files added in createAngularBlock/injectBlocks
//    import helpers from outside `src/angular/` and `src/shared/` — stage only
//    the specific modules they need so the relative paths (which mirror the
//    original `src/` layout) resolve correctly under `rootDir`.
cpSync(path.resolve(root, 'packages/angular/src'), path.resolve(stagingDir, 'angular'), {
  recursive: true,
  filter: (src) => !src.endsWith('.json'),
});
cpSync(path.resolve(root, 'src/shared'), path.resolve(stagingDir, 'shared'), { recursive: true });

// Helpers shared with the core (injectBlocks, createAngularBlock). These files
// use `../../types/...` or `../../markdown/types` relative imports that resolve
// to `types/` at the repo root, which contains a mix of `.d.ts` and `.ts` files.
// The `.ts` files (e.g. `types/data-formats/block-id.ts`) cause ngtsc to crash.
// After copying, we rewrite all `import type` statements that reference the
// repo-root `types/` or `markdown/types` to `'@bloklabs/core'` (the staged
// flat-declaration alias), which is a single clean `.d.ts` with no `.ts` deps.
// `BlockTuneData` and `MarkdownImportConfig` are not in the standard
// `@bloklabs/core` exports, so we append them to `blok-core.d.ts` first.
let coreTypes = readFileSync(coreTypesFile, 'utf8');
if (!coreTypes.includes('export type BlockTuneData')) {
  coreTypes += '\nexport type BlockTuneData = unknown;\n';
}
// Promotion-matched guard: the symbol must be present after the append.
if (!coreTypes.includes('export type BlockTuneData')) {
  throw new Error(
    `[build-angular] Promotion guard failed: 'export type BlockTuneData' is missing from ` +
    `blok-core.d.ts after promotion. The rollup output may have changed.`
  );
}
const beforeMarkdownReplace = coreTypes;
coreTypes = coreTypes.replace(
  /^interface MarkdownImportConfig /m,
  'export interface MarkdownImportConfig '
);
// Promotion-matched guard: the regex must have matched at least once.
if (coreTypes === beforeMarkdownReplace) {
  throw new Error(
    `[build-angular] Promotion guard failed: 'interface MarkdownImportConfig' was not found in ` +
    `blok-core.d.ts — the regex did not match. The interface may have been renamed, removed, or ` +
    `is already exported. Expected a bare 'interface MarkdownImportConfig' declaration in the ` +
    `rollup-flattened types.`
  );
}
writeFileSync(coreTypesFile, coreTypes, 'utf8');

// Stub `@bloklabs/core/markdown` so the dynamic `await import('../../markdown/index')`
// in blocks-api.ts can be remapped to a path TypeScript CAN resolve.  The stub
// only needs the ONE symbol consumed (`markdownToBlocks`); it borrows the types
// from the already-staged `blok-core.d.ts`.
writeFileSync(
  path.resolve(stagingDir, 'blok-markdown.d.ts'),
  [
    `import type { OutputBlockData, MarkdownImportConfig } from '@bloklabs/core';`,
    `export declare function markdownToBlocks(`,
    `  md: string,`,
    `  config?: MarkdownImportConfig`,
    `): Promise<OutputBlockData[]>;`,
  ].join('\n') + '\n',
  'utf8'
);

/** Rewrite imports that resolve to the repo-root `types/` tree (where some
 *  files are `.ts`, triggering ngtsc crashes) to go through the staged
 *  `@bloklabs/core` alias (`blok-core.d.ts`) instead.  Also rewrites the
 *  markdown helpers so they stay resolvable in the staging layout.
 */
const rewriteTypeImports = (filePath) => {
  let src = readFileSync(filePath, 'utf8');

  // 1. `import type { … } from '…/types/…'` or `'…/markdown/types'` → @bloklabs/core
  const TYPE_PATTERNS = [
    /^import type \{([^}]+)\} from ['"](?:\.\.\/)*types(?:\/[^'"]+)?['"];?\n?/gm,
    /^import type \{([^}]+)\} from ['"](?:\.\.\/)*markdown\/types['"];?\n?/gm,
    // The adapters import repo-root types via the `@/types` alias; fold those
    // into the staged flat `@bloklabs/core` declaration too.
    /^import type \{([^}]+)\} from ['"]@\/types(?:\/[^'"]+)?['"];?\n?/gm,
  ];
  const symbols = [];
  for (const re of TYPE_PATTERNS) {
    src = src.replace(re, (_, captured) => {
      symbols.push(...captured.split(',').map((s) => s.trim()).filter(Boolean));
      return '';
    });
  }
  if (symbols.length > 0) {
    const unique = [...new Set(symbols)];
    src = `import type { ${unique.join(', ')} } from '@bloklabs/core';\n` + src;
  }

  // 2. Dynamic `import('…/markdown/index')` → `import('@bloklabs/core/markdown')`
  //    so the path is resolvable under the staging tsconfig's `paths` aliases.
  src = src.replace(
    /import\(['"](?:\.\.\/)*markdown\/index['"]\)/g,
    `import('@bloklabs/core/markdown')`
  );

  writeFileSync(filePath, src, 'utf8');
};

const copyAndRewrite = (relSrc, relDest) => {
  const dest = path.resolve(stagingDir, relDest);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(path.resolve(root, relSrc), dest);
  rewriteTypeImports(dest);
};

copyAndRewrite('src/components/utils/blocks-tree.ts',         'components/utils/blocks-tree.ts');
copyAndRewrite('src/components/utils/readonly-config.ts',     'components/utils/readonly-config.ts');
copyAndRewrite('src/components/utils/blocks-api.ts',          'components/utils/blocks-api.ts');
// id-generator.ts imports `nanoid` (a bare specifier). ng-packagr/rollup
// externalizes ALL bare specifiers, so it cannot be bundled. Replace the
// import with a minimal inline implementation using crypto.getRandomValues(),
// which produces the same 10-char URL-safe alphabet as nanoid.
(() => {
  const dest = path.resolve(stagingDir, 'components/utils/id-generator.ts');
  mkdirSync(path.dirname(dest), { recursive: true });
  const original = readFileSync(path.resolve(root, 'src/components/utils/id-generator.ts'), 'utf8');
  writeFileSync(
    dest,
    original.replace(
      `import { nanoid } from 'nanoid';`,
      `// nanoid replaced with inline crypto implementation for the Angular adapter bundle.\n` +
      `const _ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';\n` +
      `const _nanoid = (n: number): string => {\n` +
      `  const buf = crypto.getRandomValues(new Uint8Array(n));\n` +
      `  return Array.from(buf, (b) => _ID_CHARS[b % 64]).join('');\n` +
      `};\n` +
      `const nanoid = _nanoid;`,
    ),
    'utf8'
  );
})();
copyAndRewrite('src/components/errors/tool-not-found.ts',     'components/errors/tool-not-found.ts');
copyAndRewrite('src/components/constants/data-attributes.ts', 'components/constants/data-attributes.ts');
copyAndRewrite('src/tools/nested-blocks.ts',                  'tools/nested-blocks.ts');

// The adapter sources import shared core utilities via the public
// `@bloklabs/core/adapters` specifier (see src/adapters.ts). ng-packagr would
// externalize that bare specifier, but the utils are meant to be bundled here
// (mirroring the staged copies above), so rewrite the specifier to a staged
// contract module that re-exports the staged copies.
writeFileSync(
  path.resolve(stagingDir, 'adapters-contract.ts'),
  [
    `export * from './components/utils/blocks-api';`,
    `export * from './components/utils/blocks-tree';`,
    `export * from './components/utils/readonly-config';`,
    `export * from './shared/deep-equal';`,
    `export * from './shared/output-data';`,
    `export * from './shared/prop-schema';`,
    `export * from './tools/nested-blocks';`,
    `export { DATA_ATTR } from './components/constants/data-attributes';`,
  ].join('\n') + '\n',
  'utf8'
);
for (const entry of readdirSync(path.resolve(stagingDir, 'angular'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
  const staged = path.resolve(stagingDir, 'angular', entry.name);
  const src = readFileSync(staged, 'utf8');
  writeFileSync(staged, src.replace(/from '@bloklabs\/core\/adapters'/g, `from '../adapters-contract'`), 'utf8');
}
// Also rewrite staged angular/ files that import from '../../types/...'.
rewriteTypeImports(path.resolve(stagingDir, 'angular/useBlocks.ts'));
rewriteTypeImports(path.resolve(stagingDir, 'angular/block-context.ts'));
rewriteTypeImports(path.resolve(stagingDir, 'angular/createAngularBlock.ts'));
rewriteTypeImports(path.resolve(stagingDir, 'angular/blok-editor.component.ts'));
rewriteTypeImports(path.resolve(stagingDir, 'angular/blok-content.directive.ts'));
// Also rewrite staged shared/ files that import from '../../types'.
for (const entry of readdirSync(path.resolve(stagingDir, 'shared'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
  rewriteTypeImports(path.resolve(stagingDir, 'shared', entry.name));
}

// Fail-loud guard: after all rewrites, no staged .ts source file should still contain
// a relative import whose specifier points into the core types/ or markdown/types tree.
// rewriteTypeImports() uses single-line `import type { }` regexes and would silently
// miss multi-line type imports or inline-`type` modifiers in mixed imports.  This scan
// catches those misses immediately with a clear diagnostic instead of a cryptic ng-packagr
// compile error downstream.
const gatherTsSourceFiles = (dir) => {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...gatherTsSourceFiles(full));
    // Skip generated .d.ts files — they are declaration stubs, not source.
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) results.push(full);
  }
  return results;
};

for (const tsFile of gatherTsSourceFiles(stagingDir)) {
  const src = readFileSync(tsFile, 'utf8');
  // Match any 'from' clause with a relative specifier that goes UP at least one
  // directory level (starts with ../).  Specifiers that only descend (./foo) are
  // intra-staging and are fine (e.g. './types' → angular/types.ts is staged).
  // No staging directory is named 'types', so any UP-going path containing
  // '/types' is a leaked reference that should have been rewritten to '@bloklabs/core'.
  const re = /from\s+['"]((?:\.\.\/)+[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    if (
      spec.includes('/types/') ||
      spec.endsWith('/types') ||
      /\/markdown\/types/.test(spec)
    ) {
      const rel = path.relative(stagingDir, tsFile);
      throw new Error(
        `[build-angular] Leftover core type import in staged file '${rel}': ` +
        `'${spec}' was not rewritten to '@bloklabs/core'. ` +
        `Check rewriteTypeImports() — the import may be multi-line or use an inline 'type' modifier.`
      );
    }
  }
}

writeFileSync(path.resolve(stagingDir, 'index.ts'), `export * from './angular';\n`, 'utf8');

// 3. The published package.json: name + peer ranges from the canonical template
//    in src/angular, version stamped from the root package, and the core peer
//    pinned to the exact sibling version.
const publishedPkg = {
  ...adapterPkg,
  version: rootPkg.version,
  peerDependencies: {
    ...adapterPkg.peerDependencies,
    '@bloklabs/core': rootPkg.version,
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
      dest: '../../packages/angular/dist',
      lib: { entryFile: 'index.ts' },
      allowedNonPeerDependencies: ['.'],
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
        // No `baseUrl`: deprecated in TypeScript 6 (TS5101), removed in 7. The
        // mappings below are "./"-prefixed, so they already resolve relative to
        // this generated tsconfig's own directory (the staging dir).
        paths: {
          '@bloklabs/core': ['./blok-core.d.ts'],
          '@bloklabs/core/markdown': ['./blok-markdown.d.ts'],
        },
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

// 6. Restore a root `index.d.ts` entry point.
//    ng-packagr 20 emitted declarations at `dist/index.d.ts`; ng-packagr 22
//    flattens them to `dist/types/<flat-module>.d.ts` and points `typings`
//    there. That path is consumer-visible, so anyone resolving or deep-importing
//    the old entry would break on upgrade. Re-export the flattened bundle from
//    the historical location and keep `typings`/`exports` pointing at it.
//    NOTE: this re-export stays inside dist/ — it must never reference `src/`
//    (see the published-types law in CLAUDE.md).
const angularPkgPath = path.resolve(destDir, 'package.json');
const angularPkg = JSON.parse(readFileSync(angularPkgPath, 'utf8'));
const flatTypes = angularPkg.typings ?? angularPkg.types;

if (typeof flatTypes !== 'string') {
  throw new Error(`build-angular: ng-packagr emitted no typings entry; got ${JSON.stringify(angularPkg.typings)}`);
}

const flatTypesSpecifier = `./${flatTypes.replace(/^\.\//, '').replace(/\.d\.ts$/, '')}`;

writeFileSync(
  path.resolve(destDir, 'index.d.ts'),
  `export * from '${flatTypesSpecifier}';\n`,
  'utf8'
);

angularPkg.typings = './index.d.ts';

if (angularPkg.exports?.['.']) {
  angularPkg.exports['.'].types = './index.d.ts';
}

writeFileSync(angularPkgPath, `${JSON.stringify(angularPkg, null, 2)}\n`, 'utf8');

// npm auto-includes a README only from the directory it packs, and this package packs
// from destDir (see FAMILY in scripts/release-manifest.mjs) — not from packages/angular.
// Without this copy the source README is never published and the npm page renders empty,
// which is how @bloklabs/angular shipped 1.3.0.
cpSync(path.resolve(root, 'packages/angular/README.md'), path.resolve(destDir, 'README.md'));

// 7. Drop the staging dir; keep only the published APF output.
rmSync(stagingDir, { recursive: true, force: true });

console.log(`Angular adapter built to ${path.relative(root, destDir)}`);
