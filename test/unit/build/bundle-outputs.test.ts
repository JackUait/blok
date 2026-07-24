import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { resolve, join, dirname } from 'node:path'
import { describe, it, expect } from 'vitest'

const repoRoot = resolve(__dirname, '../../../')
const dist = resolve(repoRoot, 'dist')
const typesDir = resolve(repoRoot, 'types')
const srcDir = resolve(repoRoot, 'src')

/**
 * Walk every emitted JS file in dist and collect the set of *external* packages
 * it imports (bare specifiers that are not relative paths or node builtins).
 *
 * The build inlines every runtime dependency into the dist chunks, so a healthy
 * dist references nothing except the externalised peer deps. Anything that ends
 * up here MUST be declared as a runtime/peer dependency, and — conversely —
 * every runtime dependency MUST show up here. A dependency that is bundled but
 * still listed in `dependencies` forces consumers (and tools like bundlephobia)
 * to install hundreds of MB of packages that are never imported.
 */
/** Recursively list every emitted JS file under a directory. */
function listJsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listJsFiles(full)
    }
    return /\.(mjs|cjs|js)$/.test(entry.name) ? [full] : []
  })
}

/** Reduce a bare specifier to its package name, or null if it is not an external package. */
function externalPackageName(spec: string): string | null {
  // Relative/absolute paths are internal chunk references, not packages.
  if (spec.startsWith('.') || spec.startsWith('/') || isBuiltin(spec)) {
    return null
  }
  const parts = spec.split('/')
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  // Ignore computed/dynamic specifiers (template literals, string fragments) that
  // the regex may scrape out of minified code — keep only valid npm package names.
  const isValidPackageName = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkg)
  return isValidPackageName && !isBuiltin(pkg) ? pkg : null
}

// Matches `from "spec"`, `require("spec")` and `import("spec")` (single or double quotes).
const SPECIFIER_RE = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g

/** Extract the external package names referenced by a single source file. */
function externalsInSource(source: string): string[] {
  return [...source.matchAll(SPECIFIER_RE)]
    .map((match) => externalPackageName(match[1]))
    .filter((pkg): pkg is string => pkg !== null)
}

// The Angular adapter (`dist/angular`) is a self-contained APF sub-package with
// its OWN package.json declaring `@angular/*` + `@bloklabs/core` as peers. The
// root-package externals guards reason about the root manifest, so they must not
// scan into it (otherwise the Angular peers read as undeclared root externals).
const angularDist = resolve(dist, '..', 'packages', 'angular', 'dist')

function collectDistExternals(): Set<string> {
  const externals = new Set<string>()
  for (const file of listJsFiles(dist)) {
    if (file.startsWith(angularDist)) {
      continue
    }
    for (const pkg of externalsInSource(readFileSync(file, 'utf-8'))) {
      externals.add(pkg)
    }
  }
  return externals
}

/** Recursively list every emitted declaration (.d.ts) file under a directory. */
function listDtsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listDtsFiles(full)
    }
    return entry.name.endsWith('.d.ts') ? [full] : []
  })
}

/** Every module specifier (relative or bare) referenced by a source/declaration file. */
function specifiersInSource(source: string): string[] {
  return [...source.matchAll(SPECIFIER_RE)].map((match) => match[1])
}

/** Resolve a relative specifier from a file to an on-disk module path, or null. */
function resolveRelativeModule(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), `${base}.d.ts`, join(base, 'index.d.ts'), base]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * The published `types/*.d.ts` re-export symbols straight from `src/*.ts`, so a
 * consumer that imports those entry points pulls the referenced src modules into
 * its own type program — and therefore must be able to resolve every external
 * package those src modules import. Walk the src graph reachable from the
 * published declarations and collect those externals: each one legitimately
 * belongs in `dependencies` even though the bundle inlines it.
 */
/** Resolve a file's relative imports to the src modules they reference. */
function resolvedSrcImports(file: string): string[] {
  return specifiersInSource(readFileSync(file, 'utf-8'))
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => resolveRelativeModule(file, spec))
    .filter((module): module is string => module !== null && module.startsWith(srcDir))
}

/** External package names a file imports via bare specifiers. */
function externalImports(file: string): string[] {
  return specifiersInSource(readFileSync(file, 'utf-8'))
    .filter((spec) => !spec.startsWith('.'))
    .map((spec) => externalPackageName(spec))
    .filter((pkg): pkg is string => pkg !== null)
}

function srcModulesReferencedByPublishedTypes(): string[] {
  return listDtsFiles(typesDir).flatMap((dts) => resolvedSrcImports(dts))
}

/**
 * Relative references in a published declaration file that resolve to a module
 * outside the published `files` set (or not at all). These break a consumer's
 * type resolution — e.g. a `../src/...` re-export once `src` is dropped from
 * the published tarball.
 */
function danglingRefsInDeclaration(dts: string, publishedRoots: Set<string>): string[] {
  return specifiersInSource(readFileSync(dts, 'utf-8'))
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => {
      const resolved = resolveRelativeModule(dts, spec)
      if (resolved === null) {
        return `${dts} -> ${spec} (unresolved)`
      }
      const topLevel = resolved.slice(repoRoot.length + 1).split('/')[0]
      return publishedRoots.has(topLevel)
        ? null
        : `${dts} -> ${spec} (resolves into unpublished "${topLevel}/")`
    })
    .filter((entry): entry is string => entry !== null)
}

/**
 * Walk the declaration graph reachable from a published entry's `.d.ts`,
 * following only relative `.d.ts` imports, and collect every relative
 * specifier that resolves into `src/`.
 *
 * A consumer that does a bare `import ... from '@bloklabs/core'` resolves to
 * `types/index.d.ts`. TypeScript follows that file's imports; `skipLibCheck`
 * skips other `.d.ts` files, but any reference that resolves to a raw `src/*.ts`
 * module pulls that source into the consumer's program and type-checks it under
 * the consumer's compiler flags (e.g. `noUncheckedIndexedAccess`). The bare
 * entry's declaration closure must therefore be self-contained — no `src/` leak.
 */
/** Relative imports of a declaration file, resolved to on-disk module paths. */
function relativeTargets(file: string): { spec: string; resolved: string }[] {
  return specifiersInSource(readFileSync(file, 'utf-8'))
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => ({ spec, resolved: resolveRelativeModule(file, spec) }))
    .filter((target): target is { spec: string; resolved: string } => target.resolved !== null)
}

function srcLeaksReachableFrom(entry: string): string[] {
  const leaks: string[] = []
  const visited = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || visited.has(file)) {
      continue
    }
    visited.add(file)
    const targets = relativeTargets(file)
    leaks.push(
      ...targets
        .filter((target) => target.resolved.startsWith(srcDir))
        .map((target) => `${file.slice(repoRoot.length + 1)} -> ${target.spec}`),
    )
    queue.push(
      ...targets
        .filter((target) => !target.resolved.startsWith(srcDir) && target.resolved.endsWith('.d.ts'))
        .map((target) => target.resolved),
    )
  }
  return leaks
}

function collectTypeSurfaceExternals(): Set<string> {
  const externals = new Set<string>()
  const visited = new Set<string>()
  const queue = srcModulesReferencedByPublishedTypes()
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || visited.has(file) || !file.endsWith('.ts')) {
      continue
    }
    visited.add(file)
    for (const pkg of externalImports(file)) {
      externals.add(pkg)
    }
    queue.push(...resolvedSrcImports(file).filter((next) => !visited.has(next)))
  }
  return externals
}

describe('CJS bundle outputs', () => {
  it('produces blok.cjs', () => {
    expect(existsSync(resolve(dist, 'blok.cjs'))).toBe(true)
  })

  it('produces tools.cjs', () => {
    expect(existsSync(resolve(dist, 'tools.cjs'))).toBe(true)
  })

  it('produces full.cjs', () => {
    expect(existsSync(resolve(dist, 'full.cjs'))).toBe(true)
  })

  it('produces the @bloklabs/react workspace bundle (index.cjs)', () => {
    expect(existsSync(resolve(dist, '../packages/react/dist/index.cjs'))).toBe(true)
  })

  it('produces markdown.cjs', () => {
    expect(existsSync(resolve(dist, 'markdown.cjs'))).toBe(true)
  })

  it('produces view.cjs', () => {
    expect(existsSync(resolve(dist, 'view.cjs'))).toBe(true)
  })

  it('produces icons.cjs', () => {
    expect(existsSync(resolve(dist, 'icons.cjs'))).toBe(true)
  })
})

describe('IIFE bundle output', () => {
  it('produces blok.iife.js', () => {
    expect(existsSync(resolve(dist, 'blok.iife.js'))).toBe(true)
  })
})

describe('UMD drop-in global output (Editor.js compatibility)', () => {
  it('produces blok.umd.js', () => {
    expect(existsSync(resolve(dist, 'blok.umd.js'))).toBe(true)
  })

  it('exposes the EditorJS global as the constructor itself (not a namespace)', () => {
    const umd = readFileSync(resolve(dist, 'blok.umd.js'), 'utf-8')
    // Vite/Rollup UMD wrapper references the global name in its factory boilerplate.
    expect(umd).toMatch(/EditorJS/)
    // With `output.exports: 'default'` the global is assigned the default export
    // directly: `global.EditorJS = factory()`. A namespace build would instead
    // produce `global.EditorJS = {}` then attach members (`.default`, `.Blok`),
    // which would force `new EditorJS.default(...)`. Guard against that regression.
    expect(umd).not.toMatch(/EditorJS\s*=\s*\{\s*\}/)
    expect(umd).not.toMatch(/EditorJS\.default\s*=/)
  })
})

describe('CDN bundles ship compiled Tailwind CSS', () => {
  // CSS reaches every bundle as a JS string: src/components/modules/ui.ts does
  // `import styles from '../../styles/main.css?inline'` and injects it as a
  // single <style>. Only @tailwindcss/vite compiles that source. It lives in
  // vite.config.mjs; for 3 months (iife) and 1 month (umd) it was missing from
  // vite.config.iife.mjs / vite.config.umd.mjs, so those two CDN bundles shipped
  // Tailwind v4 SOURCE SYNTAX verbatim to the browser — zero generated
  // utilities, zero design tokens, a completely unstyled editor for every
  // unpkg/jsDelivr consumer. Source-level laws cannot catch this (the source is
  // fine); only a dist-level assertion can.
  for (const bundle of ['blok.iife.js', 'blok.umd.js']) {
    it(`${bundle} contains generated, scoped Tailwind utilities`, () => {
      const code = readFileSync(resolve(dist, bundle), 'utf-8')

      // `px-3` and `leading-snug` are used by the editor's own components;
      // scopeUtilitiesPlugin rewrites every generated utility to the
      // `:where([data-blok-interface], ...)` scoped form.
      // Boolean assertions, not toContain: a failing toContain would print the
      // entire multi-megabyte bundle as a diff.
      expect(code.includes('.px-3:where(')).toBe(true)
      // Theme tokens must be materialised too, not left as an @theme block.
      expect(code.includes('--tw-leading')).toBe(true)
    })

    it(`${bundle} ships no uncompiled Tailwind source syntax`, () => {
      const code = readFileSync(resolve(dist, bundle), 'utf-8')

      // `@tailwind utilities;` is a dead v3 directive and `@theme {...}` is an
      // unknown at-rule browsers discard whole — both mean the CSS was inlined
      // but never compiled.
      expect(code.includes('@tailwind utilities')).toBe(false)
      expect(code.includes('@theme')).toBe(false)
    })
  }
})

describe('view bundle isolation (parse5 stays out of editor bundles)', () => {
  // parse5 is bundled ONLY into the ./view entry (see the source-level law in
  // test/unit/architecture/view-entry-law.test.ts). This is the dist-level
  // half of that contract: a vite entry/chunk change that splices the view
  // graph into an editor bundle would ship parse5 to every editor consumer.
  // Fingerprint: parse5's tokenizer error codes are stable string literals
  // that survive minification.
  const PARSE5_FINGERPRINT = 'control-character-in-input-stream'

  it('view.mjs actually contains parse5 (fingerprint non-vacuity)', () => {
    expect(readFileSync(resolve(dist, 'view.mjs'), 'utf-8').includes(PARSE5_FINGERPRINT)).toBe(true)
  })

  for (const bundle of ['blok.mjs', 'full.mjs', 'tools.mjs', 'adapters.mjs', 'blok.cjs', 'blok.iife.js', 'blok.umd.js']) {
    it(`${bundle} ships no parse5`, () => {
      expect(readFileSync(resolve(dist, bundle), 'utf-8').includes(PARSE5_FINGERPRINT)).toBe(false)
    })
  }
})

describe('ESM outputs still present', () => {
  it('still produces blok.mjs', () => {
    expect(existsSync(resolve(dist, 'blok.mjs'))).toBe(true)
  })

  it('produces view.mjs', () => {
    expect(existsSync(resolve(dist, 'view.mjs'))).toBe(true)
  })

  it('still produces full.mjs', () => {
    expect(existsSync(resolve(dist, 'full.mjs'))).toBe(true)
  })
})

describe('IIFE bundle content', () => {
  it('blok.iife.js contains a var/window assignment for BlokEditor global', () => {
    const iife = readFileSync(resolve(dist, 'blok.iife.js'), 'utf-8')
    // IIFE bundles expose the library as a named global variable
    // Vite generates: var BlokEditor = (function() { ... })()
    expect(iife).toMatch(/var\s+BlokEditor\s*=/)
  })
})

import packageJson from '../../../package.json'

describe('package.json exports include require conditions', () => {
  it('"." export has "require" condition pointing to blok.cjs', () => {
    expect((packageJson.exports['.'] as Record<string, string>)['require']).toBe('./dist/blok.cjs')
  })

  it('"./tools" export has "require" condition', () => {
    expect((packageJson.exports['./tools'] as Record<string, string>)['require']).toBe('./dist/tools.cjs')
  })

  it('"./full" export has "require" condition', () => {
    expect((packageJson.exports['./full'] as Record<string, string>)['require']).toBe('./dist/full.cjs')
  })

  it('core no longer exports "./react" (moved to the @bloklabs/react package)', () => {
    expect(packageJson.exports['./react' as keyof typeof packageJson.exports]).toBeUndefined()
  })

  it('"./markdown" export has "require" condition', () => {
    expect((packageJson.exports['./markdown'] as Record<string, string>)['require']).toBe('./dist/markdown.cjs')
  })

  it('"./view" export has "import", "require", and "types" conditions', () => {
    const viewExport = packageJson.exports['./view'] as Record<string, string>
    expect(viewExport['import']).toBe('./dist/view.mjs')
    expect(viewExport['require']).toBe('./dist/view.cjs')
    expect(viewExport['types']).toBe('./types/view.d.ts')
  })

  it('"./icons" export has "import", "require", and "types" conditions', () => {
    const iconsExport = packageJson.exports['./icons'] as Record<string, string>
    expect(iconsExport['import']).toBe('./dist/icons.mjs')
    expect(iconsExport['require']).toBe('./dist/icons.cjs')
    expect(iconsExport['types']).toBe('./types/icons.d.ts')
  })

  it('"./umd" export points at the drop-in global bundle', () => {
    expect((packageJson.exports['./umd'] as Record<string, string>)['default']).toBe('./dist/blok.umd.js')
  })
})

describe('package.json top-level fields for CJS + IIFE', () => {
  it('has "main" field pointing to blok.cjs', () => {
    expect((packageJson as unknown as Record<string, string>)['main']).toBe('./dist/blok.cjs')
  })

  it('has "browser" field pointing to blok.iife.js', () => {
    expect((packageJson as unknown as Record<string, string>)['browser']).toBe('./dist/blok.iife.js')
  })

  it('has "unpkg" field pointing to blok.iife.js', () => {
    expect((packageJson as unknown as Record<string, string>)['unpkg']).toBe('./dist/blok.iife.js')
  })

  it('has "jsdelivr" field pointing to blok.iife.js', () => {
    expect((packageJson as unknown as Record<string, string>)['jsdelivr']).toBe('./dist/blok.iife.js')
  })
})

describe('published package is self-contained (install footprint)', () => {
  const manifest = packageJson as {
    files?: string[]
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const runtimeDeps = Object.keys(manifest.dependencies ?? {})
  const peerDeps = Object.keys(manifest.peerDependencies ?? {})
  const publishedRoots = new Set(manifest.files ?? [])

  it('every runtime dependency is needed by the published output (no redundant bundled deps)', () => {
    // A runtime dependency is justified only if a consumer actually needs it
    // installed: either dist imports it as a real external (not inlined), or the
    // published type declarations re-export src modules that import it. Heavy
    // build-only libs that are fully inlined into dist (e.g. mermaid, katex,
    // prismjs) belong in devDependencies — listing them here forces consumers
    // (and tools like bundlephobia) to install hundreds of MB never imported.
    const justified = new Set([...collectDistExternals(), ...collectTypeSurfaceExternals()])
    const redundant = runtimeDeps.filter((dep) => !justified.has(dep))
    expect(redundant).toEqual([])
  })

  it('every external import in dist is declared as a runtime or peer dependency', () => {
    const externals = [...collectDistExternals()]
    const declared = new Set([...runtimeDeps, ...peerDeps])
    // Known false positive: `echarts` is never imported by dist. It only appears
    // as string-literal source emitted by the bundled @aiden0z/pptx-renderer
    // chunk — its ChartRenderer generates echarts code as JS-source strings
    // (e.g. `" } from 'echarts/components';\necharts.use(...)"`). The regex-based
    // scraper sees those string fragments and mistakes them for real imports.
    // echarts is genuinely not a runtime dependency, so exclude it here rather
    // than declaring it in package.json.
    const knownStringLiteralFalsePositives = new Set(['echarts'])
    const undeclared = externals.filter(
      (pkg) => !declared.has(pkg) && !knownStringLiteralFalsePositives.has(pkg),
    )
    expect(undeclared).toEqual([])
  })

  it('every external imported via the published type surface is a declared dependency', () => {
    // types/*.d.ts re-export from src/*.ts; consumers type-checking those entries
    // must resolve the external packages those src modules import. Transitive type
    // providers arrive through the declared ones, so only require that the direct
    // type-surface externals which are also npm package roots are declared.
    const declared = new Set([...runtimeDeps, ...peerDeps])
    const undeclared = [...collectTypeSurfaceExternals()].filter(
      (pkg) => !declared.has(pkg) && existsSync(resolve(repoRoot, 'node_modules', pkg, 'package.json')),
    )
    // Only direct dependencies must be declared; transitive providers (e.g.
    // micromark-util-types, @types/mdast) are pulled in by the declared cluster.
    const transitiveOnly = new Set(['mdast', 'micromark-util-types', '@types/mdast', '@types/unist'])
    expect(undeclared.filter((pkg) => !transitiveOnly.has(pkg))).toEqual([])
  })

  it('the bare-import type entry is self-contained (drags no raw src into consumers)', () => {
    // The default `import { Blok } from '@bloklabs/core'` resolves to
    // types/index.d.ts. Its declaration closure must not re-export from `src/*.ts`,
    // or consumers with stricter flags (noUncheckedIndexedAccess) inherit type
    // errors from Blok's raw source they never wrote.
    const leaks = srcLeaksReachableFrom(resolve(typesDir, 'index.d.ts'))
    expect(leaks).toEqual([])
  })

  it('no published type declaration references a path outside the published files', () => {
    // Removing `src` from `files` while types/*.d.ts still re-export from `../src`
    // leaves dangling module references that break consumers' type resolution.
    const dangling = listDtsFiles(typesDir).flatMap((dts) =>
      danglingRefsInDeclaration(dts, publishedRoots),
    )
    expect(dangling).toEqual([])
  })
})

describe('dist weight (consumer parse cost)', () => {
  // Consumers that bundle this package (Vite/Rollup) parse EVERY reachable dist
  // module — dynamic imports included. Two things blew that cost up to the point
  // of OOMing consumer CI builds at Node's default heap:
  //   1. JSON locale data (emoji CLDR annotations, UI messages, emoji-mart set)
  //      compiled into giant JS object literals — thousands of AST nodes each
  //      instead of one string literal.
  //   2. Fully unminified chunk output (~28 MB of ES modules).
  // These guards keep both root causes fixed.

  const esFiles = listJsFiles(dist).filter(
    (file) => file.endsWith('.mjs') && !file.startsWith(angularDist),
  )

  it('emits UI message locales as JSON.parse strings, not object literals', () => {
    const messageFiles = readdirSync(dist).filter(
      (name) => name.startsWith('messages-') && name.endsWith('.mjs'),
    )
    expect(messageFiles.length).toBeGreaterThan(0)
    const objectLiteralLocales = messageFiles.filter(
      (name) => !readFileSync(join(dist, name), 'utf-8').includes('JSON.parse('),
    )
    expect(objectLiteralLocales).toEqual([])
  })

  it('emits the emoji-mart native data chunk as a JSON.parse string', () => {
    const chunkDir = join(dist, 'chunks')
    const nativeChunks = readdirSync(chunkDir).filter(
      (name) => name.startsWith('native-') && name.endsWith('.mjs'),
    )
    expect(nativeChunks.length).toBeGreaterThan(0)
    for (const name of nativeChunks) {
      expect(readFileSync(join(chunkDir, name), 'utf-8')).toContain('JSON.parse(')
    }
  })

  it('keeps the non-data ES code surface under the parse-cost budget', () => {
    // JSON.parse data chunks are one cheap string node each; the expensive part
    // for a consumer's bundler is real code. Unminified output put code at
    // ~12 MB; minified it lands around 7 MB. Raising the budget needs a reason.
    const codeBytes = esFiles
      .filter((file) => !readFileSync(file, 'utf-8').slice(0, 200).includes('JSON.parse('))
      .reduce((sum, file) => sum + readFileSync(file).byteLength, 0)
    expect(codeBytes).toBeLessThan(9 * 1024 * 1024)
  })

  it('emits minified chunks (no indented multi-line output)', () => {
    // Unminified lib output averages ~40-70 chars per line; minified output is a
    // handful of very long lines. Guard every substantial code chunk.
    const bloated = esFiles.filter((file) => {
      const code = readFileSync(file, 'utf-8')
      if (code.length < 100 * 1024 || code.slice(0, 200).includes('JSON.parse(')) {
        return false
      }
      return code.length / code.split('\n').length < 200
    })
    expect(bloated).toEqual([])
  })
})

describe('Angular adapter package.json wiring', () => {
  const exportsMap = packageJson.exports as Record<string, Record<string, string> | string>
  const typesVersions = (packageJson as unknown as {
    typesVersions?: Record<string, Record<string, string[]>>
  }).typesVersions

  it('core no longer exports "./angular" (moved to the @bloklabs/angular package)', () => {
    expect(exportsMap['./angular']).toBeUndefined()
    expect(typesVersions?.['*']?.['angular']).toBeUndefined()
  })
})

describe('Angular adapter APF output', () => {
  const angularPkgPath = resolve(angularDist, 'package.json')
  const fesm = resolve(angularDist, 'fesm2022/bloklabs-angular.mjs')

  it('emits the FESM2022 bundle and flattened declarations', () => {
    expect(existsSync(fesm)).toBe(true)
    expect(existsSync(resolve(angularDist, 'index.d.ts'))).toBe(true)
  })

  it('compiles to partial-Ivy (AOT-linkable, not raw decorators)', () => {
    const code = readFileSync(fesm, 'utf-8')
    // Partial compilation emits ɵɵngDeclare* calls the consumer's linker resolves.
    expect(code).toMatch(/ɵɵngDeclareComponent/)
    expect(code).toMatch(/ɵɵngDeclareDirective/)
  })

  it('externalizes the Blok core instead of bundling it', () => {
    const code = readFileSync(fesm, 'utf-8')
    expect(code).toMatch(/from ['"]@bloklabs\/core['"]/)
    // The core editor must never be inlined into the adapter bundle.
    expect(code).not.toMatch(/class BlockManager\b/)
  })

  it('declares @bloklabs/core as an exact-version peer in its own manifest', () => {
    const manifest = JSON.parse(readFileSync(angularPkgPath, 'utf-8')) as {
      version: string
      peerDependencies?: Record<string, string>
    }
    expect(manifest.peerDependencies?.['@bloklabs/core']).toBe(packageJson.version)
    expect(manifest.peerDependencies?.['@angular/core']).toBeDefined()
  })
})
