import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const dist = resolve(__dirname, '../../../dist')

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
