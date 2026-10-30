import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, resolve, join, dirname } from 'node:path'
import { init as initLexer, parse as parseModule } from 'es-module-lexer/minimal'
import postcss from 'postcss'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'

import { ENTRIES as OVERRIDE_ENTRIES } from '../../../scripts/override/generate-override-entries.mjs'

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

// vite.config.mjs splits chunks between `chunks/` (global effects, declared in
// sideEffects) and `pure-chunks/`; which one a chunk lands in is not a contract.
function chunkFiles(): string[] {
  return ['chunks', 'pure-chunks']
    .flatMap((dir) => (existsSync(join(dist, dir)) ? listJsFiles(join(dist, dir)) : []))
    .filter((file) => file.endsWith('.mjs'))
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

    it(`${bundle} keeps logical properties, like the ESM bundle`, () => {
      const code = readFileSync(resolve(dist, bundle), 'utf-8')

      // An old cssTarget lowers logical properties into `:lang()` rules keyed
      // on the host page's language, which breaks RTL. Blok's CSS has none.
      expect(code.includes(':lang(')).toBe(false)
      expect(code.includes('padding-inline-start')).toBe(true)
    })
  }
})

describe('view bundle isolation (the HTML parser stays out of editor bundles)', () => {
  // The DOM-free HTML parser (src/html) is bundled ONLY into the ./view entry
  // (see the source-level law in test/unit/architecture/view-entry-law.test.ts).
  // This is the dist-level half of that contract: a vite entry/chunk change
  // that splices the view graph into an editor bundle would ship the parser to
  // every editor consumer. Fingerprints are string literals that survive
  // minification: the tokenizer's state guard, and a parse5 error code.
  const PARSER_FINGERPRINT = 'Unknown tokenizer state'
  const PARSE5_FINGERPRINT = 'control-character-in-input-stream'

  // Published entries are now thin override wrappers (scripts/override/generate-override-entries.mjs)
  // that re-export from a `*-impl` sibling — the real bundled code, and thus
  // this fingerprint, lives there. Fall back to the bundle itself for outputs
  // the wrapper never touches (blok.iife.js, blok.umd.js read src directly).
  const contentBearingPath = (bundle: string): string => {
    const implPath = resolve(dist, bundle.replace(/(\.[a-z]+)$/, '-impl$1'))
    return existsSync(implPath) ? implPath : resolve(dist, bundle)
  }

  // The parser sits in a shared chunk when ./view and ./migrate both use it, so
  // read every relative file the bundle loads, lazy import() and require included.
  const RELATIVE_IMPORT_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`](\.{1,2}\/[^"'`]+)["'`]/g
  const shippedCode = (bundle: string): string => {
    const seen = new Set<string>()
    const visit = (file: string): void => {
      if (seen.has(file)) {
        return
      }
      seen.add(file)
      for (const [, spec] of readFileSync(file, 'utf-8').matchAll(RELATIVE_IMPORT_RE)) {
        // MapLibre's worker source ships as a string; maplibre-runtime.ts rewrites this specifier to a blob URL.
        if (spec === './maplibre-gl-shared.mjs') {
          continue
        }
        visit(join(dirname(file), spec))
      }
    }
    visit(contentBearingPath(bundle))
    return [...seen].map((file) => readFileSync(file, 'utf-8')).join('\n')
  }

  it('view.mjs actually contains the HTML parser (fingerprint non-vacuity)', () => {
    expect(shippedCode('view.mjs').includes(PARSER_FINGERPRINT)).toBe(true)
  })

  it('view.mjs ships no parse5', () => {
    expect(shippedCode('view.mjs').includes(PARSE5_FINGERPRINT)).toBe(false)
  })

  for (const bundle of ['blok.mjs', 'full.mjs', 'tools.mjs', 'adapters.mjs', 'blok.cjs', 'blok.iife.js', 'blok.umd.js']) {
    it(`${bundle} ships neither the HTML parser nor parse5`, () => {
      const code = shippedCode(bundle)

      expect(code.includes(PARSER_FINGERPRINT)).toBe(false)
      expect(code.includes(PARSE5_FINGERPRINT)).toBe(false)
    })
  }
})

describe('eager ESM path ships no ES2023+ runtime APIs', () => {
  // The es2017 build target lowers syntax only. APIs pass through untouched and
  // are not polyfilled, so an API on the eager path breaks every older browser.
  // Mermaid 12 calls Object.groupBy; that is fine only while it stays behind the
  // lazy `import()` of mermaid.core. Object.hasOwn, .at() and structuredClone
  // are already eager, so they are not listed.
  const NEWER_APIS: Record<string, RegExp> = {
    'Object.groupBy / Map.groupBy': /\b(?:Object|Map)\.groupBy\b/,
    'Promise.withResolvers': /\bPromise\.withResolvers\b/,
    'Array findLast / findLastIndex': /\.findLast(?:Index)?\(/,
    'Array toSorted / toReversed / toSpliced': /\.to(?:Sorted|Reversed|Spliced)\(/,
    'Array.fromAsync': /\bArray\.fromAsync\b/,
    'String isWellFormed / toWellFormed': /\.(?:is|to)WellFormed\(/,
    'Set union / intersection / ...': /\.(?:union|intersection|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/,
  }

  /** Every file an entry loads at import time: static imports only, `import()` excluded. */
  const staticClosure = (files: string[] = OVERRIDE_ENTRIES.map((entry) => entry.file)): Set<string> => {
    const seen = new Set<string>()
    const visit = (file: string): void => {
      if (seen.has(file)) {
        return
      }
      seen.add(file)
      const [imports] = parseModule(readFileSync(file, 'utf-8'))
      for (const { n: spec, d } of imports) {
        // d === -1 marks a static import; dynamic import() has d >= 0.
        if (d === -1 && spec?.startsWith('.')) {
          visit(join(dirname(file), spec))
        }
      }
    }
    for (const file of files) {
      visit(join(dist, `${file}.mjs`))
    }
    return seen
  }

  const closureCode = (file: string): string =>
    [...staticClosure([file])].map((path) => readFileSync(path, 'utf-8')).join('\n')

  // Each string lives only in its tool's src/tools/<name>/index.ts.
  const BLOCK_TOOL_FINGERPRINTS: Record<string, string> = {
    DatabaseTool: 'data-blok-database-layout-pool',
    ImageTool: 'image-fullscreen',
    VideoTool: 'video-copy-url-at-time',
    AudioTool: 'audio-cover-remove',
    Bookmark: 'bookmark-copy-url',
  }

  it('tools.mjs loads the block tools at import time (fingerprint non-vacuity)', async () => {
    await initLexer()
    const code = closureCode('tools')
    const missing = Object.entries(BLOCK_TOOL_FINGERPRINTS).filter(([, print]) => !code.includes(print))
    expect(missing).toEqual([])
  })

  it('blok.mjs does not load the built-in block tools at import time', async () => {
    await initLexer()
    const code = closureCode('blok')
    const found = Object.entries(BLOCK_TOOL_FINGERPRINTS).filter(([, print]) => code.includes(print))
    expect(found).toEqual([])
  })

  it('keeps the blok.mjs import-time code under its byte budget', async () => {
    await initLexer()
    const bytes = [...staticClosure(['blok'])].reduce((sum, file) => sum + readFileSync(file).byteLength, 0)
    // 3,721,557 bytes measured under `yarn build`, plus ~5% headroom.
    expect(bytes).toBeLessThan(3.72 * 1024 * 1024)
  })

  // The autolink scheme regex in src/markdown/engine/inline-scan.ts. The entity table is no
  // fingerprint: src/html/entities.ts holds the same table.
  const MARKDOWN_PARSER_FINGERPRINT = String.raw`[A-Za-z][+\-.\dA-Za-z]{1,31}:`

  it('markdown.mjs loads the markdown parser at import time (fingerprint non-vacuity)', async () => {
    await initLexer()
    expect(closureCode('markdown').includes(MARKDOWN_PARSER_FINGERPRINT)).toBe(true)
  })

  for (const file of ['blok', 'tools', 'full']) {
    it(`${file}.mjs loads the markdown parser only on demand`, async () => {
      await initLexer()
      expect(closureCode(file).includes(MARKDOWN_PARSER_FINGERPRINT)).toBe(false)
    })
  }

  // The importer may sit in pure-chunks/ and the target in chunks/ (vite.config.mjs chunkFileNames).
  it('keeps mermaid behind a dynamic import (non-vacuity)', async () => {
    await initLexer()
    const closure = [...staticClosure()]
    expect(closure.some((file) => /mermaid\.core-[^/]*\.mjs$/.test(file))).toBe(false)
    expect(
      closure.some((file) => /import\(\s*[`'"]\.{1,2}\/(?:[\w-]+\/)?mermaid\.core-[^`'"]+\.mjs[`'"]\s*\)/.test(readFileSync(file, 'utf-8')))
    ).toBe(true)
  })

  it('keeps MapLibre behind a dynamic import (non-vacuity)', async () => {
    await initLexer()
    const closure = [...staticClosure()]
    expect(closure.some((file) => /maplibre-runtime-[^/]*\.mjs$/.test(file))).toBe(false)
    expect(
      closure.some((file) => /import\(\s*[`'"]\.{1,2}\/(?:[\w-]+\/)?maplibre-runtime-[^`'"]+\.mjs[`'"]\s*\)/.test(readFileSync(file, 'utf-8')))
    ).toBe(true)
  })

  it('no eager file calls an API newer than the eager path already uses', async () => {
    await initLexer()
    const hits = [...staticClosure()].flatMap((file) => {
      const code = readFileSync(file, 'utf-8')
      return Object.entries(NEWER_APIS)
        .filter(([, re]) => re.test(code))
        .map(([api]) => `${file.slice(dist.length + 1)}: ${api}`)
    })
    expect(hits).toEqual([])
  })
})

describe('opt-in subsystems load behind import()', () => {
  // Each string lives only in that subsystem's lazy body. Strings that the CSS also uses do not work: the CSS ships inside the eager JS.
  const SUBSYSTEMS: Record<string, { fingerprints: string[]; entries: string[] }> = {
    'Ask AI': { fingerprints: ['Continue where you stopped.', 'data-blok-assistant-continue'], entries: ['blok.mjs', 'full.mjs'] },
    'the agent API': {
      fingerprints: ['html.insert runs only in the editor.', 'The insert plan has no created block.'],
      entries: ['blok.mjs', 'full.mjs'],
    },
    // full.mjs ships the Callout tool, which imports the picker itself.
    'the emoji picker': { fingerprints: ['EmojiPicker: failed to build required elements'], entries: ['blok.mjs'] },
  }

  /** Files an entry loads at import time, and the ones its first-level import() calls load. */
  const closures = (entry: string): { eager: Set<string>; lazy: Set<string> } => {
    const walk = (start: string[], seen: Set<string>, dynamic: Set<string>): void => {
      const stack = [...start]
      while (stack.length > 0) {
        const file = stack.pop() as string
        if (seen.has(file)) {
          continue
        }
        seen.add(file)
        const [imports] = parseModule(readFileSync(file, 'utf-8'))
        const relative = imports.filter(({ n: spec }) => spec?.startsWith('.') === true)
        // d === -1 marks a static import; import() has d >= 0.
        relative.filter(({ d }) => d === -1).forEach(({ n: spec }) => stack.push(join(dirname(file), spec as string)))
        relative.filter(({ d }) => d !== -1).forEach(({ n: spec }) => dynamic.add(join(dirname(file), spec as string)))
      }
    }
    const eager = new Set<string>()
    const dynamic = new Set<string>()
    walk([join(dist, entry)], eager, dynamic)
    const lazy = new Set<string>()
    walk([...dynamic].filter((file) => !eager.has(file)), lazy, new Set())
    for (const file of eager) {
      lazy.delete(file)
    }
    return { eager, lazy }
  }

  for (const [name, { fingerprints, entries }] of Object.entries(SUBSYSTEMS)) {
    for (const entry of entries) {
      it(`${entry} loads ${name} only through import()`, async () => {
        await initLexer()
        const { eager, lazy } = closures(entry)
        const eagerHits = [...eager].flatMap((file) =>
          fingerprints.filter((print) => readFileSync(file, 'utf-8').includes(print)).map((print) => `${file.slice(dist.length + 1)}: ${print}`))
        expect(eagerHits).toEqual([])
        for (const print of fingerprints) {
          expect([...lazy].some((file) => readFileSync(file, 'utf-8').includes(print)), print).toBe(true)
        }
      })
    }
  }
})

describe('unbundled entries load only the icons they use', () => {
  // A page that imports dist/blok.mjs without a bundler downloads every file in
  // its static closure, so an icon only a tool draws must not ride along.
  const pathOf = (icon: string): string => {
    const match = /\bd="([^"]+)"/.exec(icon)
    if (match === null) throw new Error('icon has no path')
    return match[1]
  }

  const closureCode = (entry: string): string => {
    const seen = new Set<string>()
    const stack = [resolve(dist, entry)]
    while (stack.length > 0) {
      const file = stack.pop() as string
      if (seen.has(file)) continue
      seen.add(file)
      const [imports] = parseModule(readFileSync(file, 'utf-8'))
      imports
        .filter(({ d, n }) => d === -1 && n?.startsWith('.') === true)
        .forEach(({ n }) => stack.push(resolve(dirname(file), n as string)))
    }
    return [...seen].map((file) => readFileSync(file, 'utf-8')).join('\n')
  }

  it('blok.mjs leaves out an icon only the video player draws', async () => {
    const { IconPlayerTheater, IconCross } = await import('../../../src/components/icons')
    await initLexer()
    const code = closureCode('blok.mjs')
    expect(code.includes(pathOf(IconPlayerTheater))).toBe(false)
    expect(code.includes(pathOf(IconCross))).toBe(true)
  })

  it('icons.mjs exports the same names and values as the source', async () => {
    const source = await import('../../../src/components/icons')
    const built = (await import(resolve(dist, 'icons.mjs'))) as Record<string, unknown>
    const strings = (module: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(module).filter(([, value]) => typeof value !== 'function'))
    expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort())
    expect(strings(built)).toEqual(strings(source))
    expect((built.buildIconColumnsCount as (count: number) => string)(3)).toBe(source.buildIconColumnsCount(3))
  })
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

  it('"./preprocess" export is wired to built files that really carry the entry point', () => {
    const preprocessExport = packageJson.exports['./preprocess'] as Record<string, string>
    expect(preprocessExport['import']).toBe('./dist/preprocess.mjs')
    expect(preprocessExport['require']).toBe('./dist/preprocess.cjs')
    expect(preprocessExport['types']).toBe('./types/preprocess.d.ts')

    for (const file of ['dist/preprocess.mjs', 'dist/preprocess.cjs', 'types/preprocess.d.ts']) {
      const built = readFileSync(resolve(repoRoot, file), 'utf-8')
      expect(built).toContain('preprocessLegacyCmsHtml')
      expect(built).toContain('preprocessLegacyCmsHtmlIn')
    }
  })

  it('"./agent-models" export is wired to built files that really carry the entry point', () => {
    const agentModelsExport = packageJson.exports['./agent-models'] as Record<string, string>
    expect(agentModelsExport['import']).toBe('./dist/agent-models.mjs')
    expect(agentModelsExport['require']).toBe('./dist/agent-models.cjs')
    expect(agentModelsExport['types']).toBe('./types/agent-models.d.ts')

    for (const file of ['dist/agent-models.mjs', 'dist/agent-models.cjs', 'types/agent-models.d.ts']) {
      const built = readFileSync(resolve(repoRoot, file), 'utf-8')
      expect(built).toContain('agentModel')
    }
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
    const undeclared = externals.filter((pkg) => !declared.has(pkg))
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
    expect(undeclared).toEqual([])
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
  //   1. JSON locale data (emoji CLDR annotations, UI messages, emoji dataset)
  //      compiled into giant JS object literals — thousands of AST nodes each
  //      instead of one string literal.
  //   2. Fully unminified chunk output (~28 MB of ES modules).
  // These guards keep both root causes fixed.

  const esFiles = listJsFiles(dist).filter(
    (file) => file.endsWith('.mjs') && !file.startsWith(angularDist),
  )

  it('emits UI message locales as JSON.parse strings, not object literals', () => {
    // Each lazy locale ships as `chunks/<locale>-<hash>.mjs`. The emoji data
    // for the same locale shares that name. UI files hold values only, against
    // one shared key list, so importing that list picks the UI file.
    const codes = readdirSync(resolve(srcDir, 'components/i18n/locales'))
      .filter((name) => name.endsWith('.json') && name !== 'en.json')
      .map((name) => name.replace(/\.json$/, ''))
    const localeChunkRe = new RegExp(`^(?:${codes.join('|')})-[A-Za-z0-9_-]{8}\\.mjs$`)
    const messageFiles = esFiles.filter((file) => {
      const name = file.slice(file.lastIndexOf('/') + 1)
      return localeChunkRe.test(name) && readFileSync(file, 'utf-8').includes('./message-keys-')
    })
    expect(messageFiles.length).toBe(codes.length)
    const objectLiteralLocales = messageFiles.filter(
      (file) => !readFileSync(file, 'utf-8').includes('JSON.parse('),
    )
    expect(objectLiteralLocales).toEqual([])
  })

  it('emits the emoji grid and keyword data chunks as JSON.parse strings', () => {
    for (const prefix of ['emoji-grid-', 'emoji-keywords-']) {
      const dataChunks = chunkFiles().filter((file) => basename(file).startsWith(prefix))
      expect(dataChunks, prefix).toHaveLength(1)
      for (const file of dataChunks) {
        expect(readFileSync(file, 'utf-8')).toContain('JSON.parse(')
      }
    }
  })

  it('does not ship the raw emoji-mart set, which the two emoji data chunks replace', () => {
    expect(chunkFiles().length).toBeGreaterThan(0)
    expect(chunkFiles().filter((file) => basename(file).startsWith('native-'))).toEqual([])
  })

  it('parses markdown math without shipping a KaTeX renderer', () => {
    // Markdown import only parses math; KaTeX renders it in its own lazy chunk.
    // The parser's entity table marks the chunk it lives in.
    const parserChunks = esFiles.filter((file) => readFileSync(file, 'utf-8').includes('AElig Æ~'))
    expect(parserChunks.length).toBeGreaterThan(0)
    const withKatex = parserChunks.filter((file) =>
      readFileSync(file, 'utf-8').includes('KaTeX parse error'),
    )
    expect(withKatex).toEqual([])
  })

  it('keeps the non-data ES code surface under the parse-cost budget', () => {
    // JSON.parse data chunks are one cheap string node each; the expensive part
    // for a consumer's bundler is real code. Unminified output put code at
    // ~12 MB; minified it lands around 7 MB. Raising the budget needs a reason.
    // 11.5 MiB: mermaid 12 adds ~1.7 MB of lazy diagram chunks (elkjs is 1.46 MB).
    // 12 MiB: database Notion parity adds ~215 KB of tool code; the budget counts lazy chunks, so splitting does not help.
    // 12.1 MiB (USER, 2026-10-18): built-in database comments add ~16 KB of code and CSS with no duplication.
    // 13.8 MiB (USER, 2026-10-19: bundle MapLibre): its lazy chunk is 1,705,067 bytes (library, worker and shared
    // module as blob sources, CSS); code went 12,633,521 -> 14,350,582 bytes.
    // 14.3 MiB (USER, 2026-10-21): Ask AI and database parity rounds; code measured 14,687,410 bytes.
    // 14.4 MiB (USER, 2026-10-27): database and Ask AI growth, no duplication; code measured 15,042,671 bytes.
    const codeBytes = esFiles
      .filter((file) => !readFileSync(file, 'utf-8').slice(0, 200).includes('JSON.parse('))
      .reduce((sum, file) => sum + readFileSync(file).byteLength, 0)
    expect(codeBytes).toBeLessThan(14.4 * 1024 * 1024)
  })

  // Minifiers keep the newlines inside string and template literals (the SVG
  // icon strings are multi-line), so only newlines in the code itself count.
  const codeLineCount = (code: string): number => {
    const source = ts.createSourceFile('chunk.mjs', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
    let literalNewlines = 0
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
        literalNewlines += node.getText(source).split('\n').length - 1
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return code.split('\n').length - literalNewlines
  }

  it('counts code lines without the newlines inside literals', () => {
    expect(codeLineCount('var a=`\n<svg>\n</svg>\n`,b=`x\n${a}\ny`;export{a,b};')).toBe(1)
    expect(codeLineCount('function f() {\n  return "a"\n}\n')).toBe(4)
  })

  it('emits minified chunks (no indented multi-line output)', () => {
    // Unminified lib output averages ~40-70 chars per line; minified output is a
    // handful of very long lines. Guard every substantial code chunk.
    const bloated = esFiles.filter((file) => {
      const code = readFileSync(file, 'utf-8')
      if (code.length < 100 * 1024 || code.slice(0, 200).includes('JSON.parse(')) {
        return false
      }
      // Parsing is slow, so only chunks the plain count flags get parsed.
      return code.length / code.split('\n').length < 200 && code.length / codeLineCount(code) < 200
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

describe('runtime reachability of hand-copied public surfaces', () => {
  // Each of these is declared in `types/` (or `packages/react/types/`), so a
  // consumer's `tsc` accepts the import. The bundles enumerate their named
  // exports explicitly, so a missing runtime re-export is invisible until the
  // import blows up in production. Source-level tests cannot catch that gap —
  // only reading the emitted bundle can.
  const exportsName = (file: string, name: string): boolean =>
    new RegExp(`\\b(?:as\\s+)?${name}\\b`).test(readFileSync(file, 'utf-8').slice(-8192))

  const reactDist = resolve(dist, '../packages/react/dist')

  it.each(['tools.mjs', 'tools.cjs'])('%s exports the embed-registry helpers', (bundle) => {
    const file = resolve(dist, bundle)
    expect(exportsName(file, 'matchEmbedService')).toBe(true)
    expect(exportsName(file, 'buildEmbedUrl')).toBe(true)
  })

  it.each(['blok.mjs', 'blok.cjs', 'full.mjs', 'full.cjs'])(
    '%s exports the four block mutation-type constants',
    (bundle) => {
      const file = resolve(dist, bundle)
      for (const name of [
        'BlockAddedMutationType',
        'BlockRemovedMutationType',
        'BlockMovedMutationType',
        'BlockChangedMutationType',
      ]) {
        expect(exportsName(file, name)).toBe(true)
      }
    },
  )

  it.each(['index.mjs', 'index.cjs'])('@bloklabs/react %s exports USE_BLOK_CONFIG_KEYS', (bundle) => {
    expect(exportsName(resolve(reactDist, bundle), 'USE_BLOK_CONFIG_KEYS')).toBe(true)
  })
})

describe('lazy stylesheets stay out of the startup closure', () => {
  // src/components/utils/lazy-styles.ts loads these sheets with import(). A static
  // import would put them back into every consumer's startup bundle.
  const staticClosure = (entry: string): string[] => {
    const seen = new Set<string>()
    const queue = [entry]

    while (queue.length > 0) {
      const file = queue.pop()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      const [imports] = parseModule(readFileSync(file, 'utf-8'))
      // d === -1 marks a static import; dynamic import() has d >= 0.
      const statics = imports.filter((record) => record.d === -1 && record.n?.startsWith('.') === true)
      queue.push(...statics.map((record) => resolve(dirname(file), record.n ?? '')))
    }

    return [...seen]
  }

  const LAZY_FINGERPRINTS = {
    fonts: '@font-face{font-family:JetBrains Mono',
    database: '[data-blok-database-wrapper]{color:',
    'block-preview': '[data-blok-interface=block-preview]{',
    presence: '[data-blok-presence-caret]{',
    media: '.blok-darkroom{--blok-darkroom-bg-center:',
    askai: '[data-blok-assistant-icon]{display:none',
  }
  // The media sheet's later parts each replace their own marker (see lazy-styles.ts).
  const SHEET_PARTS = ['media-2', 'media-3', 'media-4', 'media-5']

  for (const entry of ['blok.mjs', 'full.mjs']) {
    it(`${entry} reaches no lazy sheet through static imports`, async () => {
      await initLexer()
      const closure = staticClosure(resolve(dist, entry))
      for (const [name, fingerprint] of Object.entries(LAZY_FINGERPRINTS)) {
        const holders = closure.filter((file) => readFileSync(file, 'utf-8').includes(fingerprint))
        expect(holders, name).toEqual([])
      }
    })
  }

  // A lazy sheet's CSS replaces its marker rule in #blok-styles. A marker inside
  // @media or @layer would put the whole sheet under that condition.
  it('keeps every lazy sheet marker a top-level rule of the built main sheet', () => {
    const chunks = chunkFiles()
    const main = chunks.map((file) => readFileSync(file, 'utf-8')).find((code) => code.includes('[data-blok-sheet=fonts]'))
    expect(main, 'no chunk holds the main sheet').toBeDefined()
    const start = (main ?? '').indexOf('/*! tailwindcss')
    const end = (main ?? '').indexOf('`', start)
    const root = postcss.parse((main ?? '').slice(start, end))
    const markers: Array<{ name: string; topLevel: boolean }> = []
    root.walkRules((rule) => {
      const match = /^\[data-blok-sheet=([a-z0-9-]+)\]$/.exec(rule.selector)
      if (match !== null) markers.push({ name: match[1], topLevel: rule.parent?.type === 'root' })
    })
    expect(markers.map((marker) => marker.name).sort()).toEqual([...Object.keys(LAZY_FINGERPRINTS), ...SHEET_PARTS].sort())
    expect(markers.filter((marker) => !marker.topLevel)).toEqual([])
  })

  it('ships each lazy sheet in a chunk that Tailwind compiled', () => {
    const chunks = chunkFiles()
    for (const [name, fingerprint] of Object.entries(LAZY_FINGERPRINTS)) {
      const holders = chunks.filter((file) => readFileSync(file, 'utf-8').includes(fingerprint))
      expect(holders, name).toHaveLength(1)
      expect(readFileSync(holders[0], 'utf-8').includes('/*! tailwindcss'), name).toBe(true)
    }
  })
})

describe('dev-only NODE_ENV gates', () => {
  // The define makes NODE_ENV "production", so a gate that throws only in
  // test or development is dead code; a `typeof process` guard kept it alive.
  it('leave no `typeof process` NODE_ENV check in the production chunks', () => {
    const gate = /typeof process\s*(?:<|!==?)\s*[`'"]u(?:ndefined)?[`'"]\s*\?\s*[`'"]production[`'"]/
    const hits = chunkFiles().filter((file) => gate.test(readFileSync(file, 'utf-8'))).map((file) => basename(file))
    expect(chunkFiles().length).toBeGreaterThan(100)
    expect(hits).toEqual([])
  })
})

describe('the database template builder loads when a template is picked', () => {
  const staticClosure = (entry: string): string[] => {
    const seen = new Set<string>()
    const queue = [entry]

    while (queue.length > 0) {
      const file = queue.pop()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      const [imports] = parseModule(readFileSync(file, 'utf-8'))
      // d === -1 marks a static import; dynamic import() has d >= 0.
      const statics = imports.filter((record) => record.d === -1 && record.n?.startsWith('.') === true)
      queue.push(...statics.map((record) => resolve(dirname(file), record.n ?? '')))
    }

    return [...seen]
  }
  // A sample row title only buildStarter reads, as code (a quoted key not followed by `:`).
  const BUILDER_FINGERPRINT = /[`'"]tools\.database\.starterTaskRow1Description[`'"](?!\s*:)/

  it.each(['tools.mjs', 'tool-entries/tool-database.mjs'])('%s reaches no template builder through static imports', async (entry) => {
    await initLexer()
    const closure = staticClosure(resolve(dist, entry))
    expect(closure.length).toBeGreaterThan(1)
    expect(closure.filter((file) => BUILDER_FINGERPRINT.test(readFileSync(file, 'utf-8'))).map((file) => basename(file))).toEqual([])
    // The lazy message key list names the key too; it is data, not the builder.
    const holders = chunkFiles().filter((file) => !basename(file).startsWith('message-keys-') && BUILDER_FINGERPRINT.test(readFileSync(file, 'utf-8')))
    expect(holders).toHaveLength(1)
  })
})

describe('a consumer that imports one tool gets only that tool (tree shaking)', () => {
  // A static class field compiles (es2017) to `Tool.x = …` after the class.
  // Consumer bundlers keep that assignment as a side effect, and with it every
  // tool class in the chunk. Tools declare such statics as accessors instead.
  // An app entry: Vite drops an entry's own exports, so the import must be used.
  const ENTRY = `import { Paragraph } from ${JSON.stringify(resolve(dist, 'tools.mjs'))}; console.log(Paragraph)`

  const UNUSED_TOOL_FINGERPRINTS: Record<string, string> = {
    DatabaseTool: 'data-blok-database-layout-pool',
    ImageTool: 'image-fullscreen',
    VideoTool: 'video-copy-url-at-time',
    AudioTool: 'audio-cover-remove',
    // The level menu's dataset key; the bare name also appears in core CSS selectors.
    Header: '"blok-header-level":',
  }

  // Paragraph's own placeholder attribute; proves the bundle is not empty.
  const PARAGRAPH_FINGERPRINT = 'data-blok-placeholder-active'

  /** Static import closure of a rolldown output: every chunk the entry loads at once. */
  // Vite 8 bundles with rolldown; rolldown itself is not a declared dependency.
  const bundleWithVite = async (): Promise<string> => {
    const { build } = await import('vite')
    const result = await build({
      configFile: false,
      root: repoRoot,
      logLevel: 'silent',
      plugins: [{
        name: 'consumer-entry',
        resolveId: (id: string) => (id === 'consumer-entry' ? id : null),
        load: (id: string) => (id === 'consumer-entry' ? ENTRY : null),
      }],
      build: { write: false, minify: true, copyPublicDir: false, rollupOptions: { input: 'consumer-entry' } },
    })
    const output = (Array.isArray(result) ? result : [result]).flatMap((item) => ('output' in item ? item.output : []))
    const chunks = new Map(output.flatMap((item) => (item.type === 'chunk' ? [[item.fileName, item] as const] : [])))
    const seen = new Set<string>()
    const visit = (fileName: string): void => {
      const chunk = chunks.get(fileName)
      if (chunk === undefined || seen.has(fileName)) {
        return
      }
      seen.add(fileName)
      chunk.imports.forEach(visit)
    }
    output.forEach((item) => item.type === 'chunk' && item.isEntry && visit(item.fileName))
    return [...seen].map((fileName) => chunks.get(fileName)?.code ?? '').join('\n')
  }

  // esbuild runs in its own process: under jsdom its TextEncoder check fails.
  // Without splitting, esbuild would inline every `import()` target too.
  const ESBUILD_SCRIPT = `
    import { build } from 'esbuild'
    import { resolve } from 'node:path'
    const root = process.cwd()
    const result = await build({
      stdin: { contents: ${JSON.stringify(ENTRY)}, resolveDir: root, loader: 'js' },
      absWorkingDir: root,
      bundle: true,
      splitting: true,
      outdir: resolve(root, 'esbuild-consumer'),
      metafile: true,
      format: 'esm',
      minify: true,
      write: false,
      logLevel: 'silent',
      platform: 'browser',
    })
    const files = new Map(result.outputFiles.map((file) => [file.path, file.text]))
    const outputs = result.metafile.outputs
    const seen = new Set()
    const visit = (file) => {
      if (seen.has(file)) return
      seen.add(file)
      outputs[file].imports.filter((item) => item.kind === 'import-statement' && !item.external).forEach((item) => visit(item.path))
    }
    Object.entries(outputs).filter(([, output]) => output.entryPoint === '<stdin>').forEach(([file]) => visit(file))
    process.stdout.write([...seen].map((file) => files.get(resolve(root, file))).join('\\n'))
  `

  const bundleWithEsbuild = async (): Promise<string> =>
    execFileSync(process.execPath, ['--input-type=module', '-e', ESBUILD_SCRIPT], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
    })

  // Measured 45,149 (rolldown) and 58,990 (esbuild) bytes with one lib entry
  // per tool (vite.config.mjs toolEntries); ceilings keep ~15% headroom.
  // A tool that imports src/blok (even with import()) keeps the whole core here: ~2.5 MB more.
  it.each([
    ['vite (rolldown)', bundleWithVite, 52_000],
    ['esbuild', bundleWithEsbuild, 68_000],
  ])('%s drops the tools a Paragraph-only import never uses', async (_name, bundleConsumer, ceiling) => {
    const code = await bundleConsumer()
    const kept = Object.entries(UNUSED_TOOL_FINGERPRINTS).filter(([, print]) => code.includes(print)).map(([tool]) => tool)
    expect(kept).toEqual([])
    expect(code.includes(PARAGRAPH_FINGERPRINT)).toBe(true)
    expect(Buffer.byteLength(code)).toBeLessThan(ceiling)
  }, 60_000)
})
