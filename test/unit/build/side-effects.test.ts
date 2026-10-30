import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, matchesGlob, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import packageJson from '../../../package.json'
import viteConfig from '../../../vite.config.mjs'

const repoRoot = resolve(__dirname, '../../../')
const dist = resolve(repoRoot, 'dist')
const patterns = packageJson.sideEffects

// Code that changes the page just by loading: polyfills on globals and the
// input-modality attribute that focus-ring CSS reads from <html>.
const GLOBAL_EFFECTS = [
  /prototype\.scrollIntoViewIfNeeded\s*=(?!=)/,
  /\.requestIdleCallback\s*=(?!=)/,
  /setAttribute\(\s*[`'"]data-blok-modality/,
]

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

// Bundlers match a pattern without a slash against the file name, and any
// other pattern against the path from the package root.
function matches(file: string, pattern: string): boolean {
  const path = relative(repoRoot, file)
  return pattern.includes('/') ? matchesGlob(path, pattern.replace(/^\.\//, '')) : matchesGlob(basename(path), pattern)
}

const isDeclared = (file: string): boolean => patterns.some((pattern) => matches(file, pattern))

describe('package.json sideEffects', () => {
  const distFiles = listFiles(dist)
  const jsFiles = distFiles.filter((file) => /\.(mjs|cjs|js)$/.test(file))

  // Blok's own build reads this field too: without the src entry it drops the
  // side-effect-only `import './components/polyfills'` from src/blok.ts.
  for (const effect of GLOBAL_EFFECTS) {
    it(`ships and declares every dist file that runs ${effect.source}`, () => {
      const carriers = jsFiles.filter((file) => effect.test(readFileSync(file, 'utf-8')))
      expect(carriers.length).toBeGreaterThan(0)
      expect(carriers.filter((file) => !isDeclared(file)).map((file) => relative(dist, file))).toEqual([])
    })
  }

  // vite.config.mjs routes every chunk without a global effect outside the
  // globs, so a bundler can skip the chunks of tools an app never imports.
  it('keeps the database tool outside the sideEffects globs', () => {
    // The iife and umd bundles hold everything and are declared on purpose.
    const carriers = jsFiles.filter((file) => file.endsWith('.mjs') && readFileSync(file, 'utf-8').includes('data-blok-database-list-title-input'))
    expect(carriers.length).toBeGreaterThan(0)
    expect(carriers.filter(isDeclared).map((file) => relative(dist, file))).toEqual([])
  })

  it('has no pattern that matches nothing', () => {
    const files = [...distFiles, ...listFiles(resolve(repoRoot, 'src')), resolve(repoRoot, 'view.css')]
    expect(patterns.filter((pattern) => !files.some((file) => matches(file, pattern)))).toEqual([])
  })

  it('keeps the entry files side-effect free, so an unused entry is dropped', () => {
    const conditions: unknown[] = Object.values(packageJson.exports)
    const entries = conditions.flatMap((target) => {
      if (typeof target !== 'object' || target === null) {
        return []
      }
      const { import: esm, require: cjs } = target as { import?: string; require?: string }
      return [esm, cjs].filter((path): path is string => path !== undefined)
    })
    expect(entries.length).toBeGreaterThan(20)
    expect(entries.filter((path) => isDeclared(resolve(repoRoot, path)))).toEqual([])
  })
})

// A bundler drops `import "./x"` (no bindings) when x is undeclared, so only
// code that is known to run nothing on load may leave the globs. Package code
// can (mermaid's diagram chunks are imported for their effects alone).
describe('vite.config.mjs chunk placement', () => {
  const resolved = (viteConfig as (env: { mode: string; command: string }) => { build: { rollupOptions: { output: Array<{ format: string; chunkFileNames: (chunk: { moduleIds: string[] }) => string }> } } })({ mode: 'production', command: 'build' })
  const place = (moduleIds: string[]): string[] =>
    resolved.build.rollupOptions.output.map((output) => output.chunkFileNames({ moduleIds }).split('/')[0])
  const src = (path: string): string => resolve(repoRoot, 'src', path)

  it('puts a chunk of Blok source alone outside the globs', () => {
    expect(place([src('tools/table/index.ts'), '\0rolldown/runtime.js'])).toEqual(['pure-chunks', 'pure-chunks'])
  })

  it('keeps a chunk with package code under the globs', () => {
    expect(place([src('tools/code/index.ts'), resolve(repoRoot, 'node_modules/mermaid/dist/mermaid.core.mjs')])).toEqual(['chunks', 'chunks'])
  })

  it('keeps a chunk with a global effect under the globs', () => {
    expect(place([src('components/polyfills.ts')])).toEqual(['chunks', 'chunks'])
    expect(place([src('components/utils/input-modality.ts')])).toEqual(['chunks', 'chunks'])
  })
})
