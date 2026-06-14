import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { resolve, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const dist = resolve(__dirname, '../../../dist')

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

function collectDistExternals(): Set<string> {
  const externals = new Set<string>()
  for (const file of listJsFiles(dist)) {
    for (const pkg of externalsInSource(readFileSync(file, 'utf-8'))) {
      externals.add(pkg)
    }
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

  it('produces react.cjs', () => {
    expect(existsSync(resolve(dist, 'react.cjs'))).toBe(true)
  })

  it('produces markdown.cjs', () => {
    expect(existsSync(resolve(dist, 'markdown.cjs'))).toBe(true)
  })
})

describe('IIFE bundle output', () => {
  it('produces blok.iife.js', () => {
    expect(existsSync(resolve(dist, 'blok.iife.js'))).toBe(true)
  })
})

describe('ESM outputs still present', () => {
  it('still produces blok.mjs', () => {
    expect(existsSync(resolve(dist, 'blok.mjs'))).toBe(true)
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

  it('"./react" export has "require" condition', () => {
    expect((packageJson.exports['./react'] as Record<string, string>)['require']).toBe('./dist/react.cjs')
  })

  it('"./markdown" export has "require" condition', () => {
    expect((packageJson.exports['./markdown'] as Record<string, string>)['require']).toBe('./dist/markdown.cjs')
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
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const runtimeDeps = Object.keys(manifest.dependencies ?? {})
  const peerDeps = Object.keys(manifest.peerDependencies ?? {})

  it('every runtime dependency is actually imported by dist (no redundant bundled deps)', () => {
    // Bundled-but-undeclared-as-external deps make consumers install packages
    // that are never imported. Anything in `dependencies` must show up as a real
    // external import in the built output.
    const externals = collectDistExternals()
    const redundant = runtimeDeps.filter((dep) => !externals.has(dep))
    expect(redundant).toEqual([])
  })

  it('every external import in dist is declared as a runtime or peer dependency', () => {
    const externals = [...collectDistExternals()]
    const declared = new Set([...runtimeDeps, ...peerDeps])
    const undeclared = externals.filter((pkg) => !declared.has(pkg))
    expect(undeclared).toEqual([])
  })
})
