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
