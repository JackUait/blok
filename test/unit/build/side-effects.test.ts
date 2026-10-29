import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, matchesGlob, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import packageJson from '../../../package.json'

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
