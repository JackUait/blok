/**
 * Architectural enforcement: the React Fixture Import-Map Law.
 *
 * The react-adapter E2E fixtures (react-test.html, blok-editor.html) load the
 * built workspace adapter (`packages/react/dist/index.mjs`) as a native browser
 * module. The adapter bundle externalizes its dependencies as BARE specifiers
 * (`react`, `react-dom`, `@bloklabs/core`, ...), and a browser can only resolve
 * a bare specifier through the fixture's `<script type="importmap">`.
 *
 * A bare import that is missing from an import map does not fail loudly in any
 * unit test — the fixture page just dies at module resolution and EVERY test in
 * react-adapter.spec.ts times out waiting for `status: ready`. That is exactly
 * what shipped in 1f93c7b1: the adapter gained `import { createPortal } from
 * 'react-dom'` (block portals), no fixture mapped `react-dom`, and the whole
 * chromium-logic shard went red in CI.
 *
 * This test mechanically keeps the two sides in sync: every bare specifier the
 * built adapter imports must have an entry in EVERY react fixture's import map.
 *
 * The docs bundle is the SAME hazard with a different resolver. docs/vite.config.ts
 * resolves the adapter's `@bloklabs/core*` specifiers to the built dist by hand, so
 * the site shares one core with tools.mjs. A specifier it does not alias falls
 * through to Node resolution, which reads the root `exports` map and can pick the
 * `types` condition — dragging a `.d.ts` into the RUNTIME graph. That is what broke
 * deploy run 29904098834: the adapter gained `@bloklabs/core/view` (bca6d04e), the
 * docs config aliased only `@bloklabs/core` and `/adapters`, and the build died on
 * `Could not resolve './index' in ../types/view.d.ts`. It could not reproduce
 * locally, because a stale packages/react/dist has no view import at all — only a
 * fresh `yarn build` exposes it, which is exactly what CI does and a dev usually
 * does not.
 *
 * If this test fails on your change: add the specifier to each fixture's
 * import map AND to the docs alias, and (for react-dom/* specifiers) make sure
 * scripts/build-react-vendor.mjs emits a vendor wrapper for it so the mapped
 * file actually exists in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const adapterBundle = resolve(root, 'packages/react/dist/index.mjs');

const fixtures = [
  'test/playwright/fixtures/react-test.html',
  'test/playwright/fixtures/blok-editor.html',
];

const extractBareImports = (source: string): string[] => {
  const specifiers = new Set<string>();
  const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined && !specifier.startsWith('.') && !specifier.startsWith('/')) {
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
};

const extractImportMap = (html: string): Record<string, string> => {
  const mapMatch = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  if (mapMatch === null) {
    throw new Error('fixture has no <script type="importmap"> block');
  }
  return (JSON.parse(mapMatch[1]) as { imports: Record<string, string> }).imports;
};

describe('React fixture import-map law', () => {
  // The adapter bundle is a build output; unit tests run after the build in CI
  // (the dist artifact is downloaded first) and after `yarn build` locally.
  //
  // This presence check is UNCONDITIONAL on purpose. It used to be an
  // `it.skipIf(!existsSync(adapterBundle))` wrapped around the law below — which
  // meant a missing bundle made the ONLY test in this file disappear and the file
  // read as passed, so the law silently stopped guarding exactly when the build
  // was broken. `test/unit/build/bundle-outputs.test.ts` already asserts the built
  // react adapter unconditionally (`packages/react/dist/index.cjs`), so requiring a
  // build here adds no new burden to a local run.
  it('the built react adapter exists (unit tests run after the build)', () => {
    expect(
      existsSync(adapterBundle),
      'packages/react/dist/index.mjs is missing — run `yarn build` first. Without it the import-map law below cannot run at all.'
    ).toBe(true);
  });

  it(
    'every bare import of the built react adapter is mapped in every react fixture',
    () => {
      const bareImports = extractBareImports(readFileSync(adapterBundle, 'utf8'));

      expect(bareImports.length).toBeGreaterThan(0);

      for (const fixture of fixtures) {
        const imports = extractImportMap(readFileSync(resolve(root, fixture), 'utf8'));
        const unmapped = bareImports.filter((specifier) => imports[specifier] === undefined);

        expect(
          unmapped,
          `${fixture} is missing import map entries for bare specifiers imported by packages/react/dist/index.mjs. ` +
          'The fixture page will fail at module resolution and every react-adapter E2E test will time out. ' +
          'Map each specifier (and emit a vendor wrapper in scripts/build-react-vendor.mjs if needed).',
        ).toEqual([]);
      }
    },
  );

  it('every core specifier of the built react adapter is aliased in the docs build', () => {
    // Only the `@bloklabs/core*` family matters here: react/react-dom are real
    // dependencies the docs app resolves from its own node_modules, while the
    // core specifiers have no package to resolve to except the root exports map
    // — whose `types` condition is a live foot-gun for a bundler.
    const coreImports = extractBareImports(readFileSync(adapterBundle, 'utf8'))
      .filter((specifier) => specifier === '@bloklabs/core' || specifier.startsWith('@bloklabs/core/'));

    expect(coreImports.length, 'the adapter no longer imports the core at all — that cannot be right').toBeGreaterThan(0);

    const docsConfig = readFileSync(resolve(root, 'docs/vite.config.ts'), 'utf8');
    const unaliased = coreImports.filter((specifier) => !docsConfig.includes(`"${specifier}"`));

    expect(
      unaliased,
      'docs/vite.config.ts does not resolve these bare specifiers imported by packages/react/dist/index.mjs: ' +
      `${unaliased.join(', ')}. They fall through to the root exports map, where a bundler can pick the ` +
      '`types` condition and pull a .d.ts into the runtime graph — the docs build then fails with ' +
      'UNRESOLVED_IMPORT and nothing deploys.',
    ).toEqual([]);
  });
});
