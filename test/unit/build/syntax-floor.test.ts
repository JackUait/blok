import { readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, it, expect } from 'vitest'

import viteConfig from '../../../vite.config.mjs'
import iifeConfig from '../../../vite.config.iife.mjs'
import umdConfig from '../../../vite.config.umd.mjs'

import { DIST_SHARDS, dist, distShards, listJsFiles, syntaxAboveFloor } from './syntax-floor-scan'

// The browser floor the CSS already needs (`:has()`, container queries).
const BROWSERS = ['chrome105', 'edge105', 'firefox110', 'safari16']
// `es2020` caps the syntax: consumers' bundlers and test runners parse dist,
// and 1.16.1 shipped nothing newer. oxc lowers to whichever is older.
const JS_TARGET = ['es2020', ...BROWSERS]

describe('syntax floor scanner', () => {
  it('flags syntax newer than the floor', () => {
    const cases: Record<string, string[]> = {
      'a||=1; b&&=2; c??=3;': ['logical assignment', 'logical assignment', 'logical assignment'],
      'const n=1_000;': ['numeric separator'],
      'class A{x=1}': ['class field'],
      'class A{m(o){return #x in o}}': ['private name'],
      'class A{static{f()}}': ['class static block'],
      'await f();': ['top-level await'],
      'export { a as "b" };': ['string module name'],
      'import j from "./a.json" with { type: "json" };': ['import attributes'],
      'import("./a.json", { with: { type: "json" } });': ['import attributes'],
      '#!/usr/bin/env node\nf();': ['hashbang'],
      'const a=/(?<=x)y/g, b=/(?<!x)y/;': ['regex lookbehind', 'regex lookbehind'],
      'const a=/(?<y>a)|(?<y>b)/;': ['regex duplicate named groups'],
      'const a=/a/d, b=/[\\p{L}--x]/v, c=/(?i:a)b/;': ['regex d flag', 'regex v flag', 'regex modifiers'],
      '{using r=f()}': ['using declaration'],
    }
    for (const [code, expected] of Object.entries(cases)) {
      expect(syntaxAboveFloor(code), code).toEqual(expected)
    }
  })

  it('passes the syntax 1.16.1 shipped', () => {
    const allowed = [
      'const a=b?.c??d, {e,...f}=g, h={...g}, i=10n;',
      'try{x()}catch{}',
      'async function* gen(){for await (const v of s) yield await v}',
      'class A{constructor(){this.x=1} static m(){}}',
      'const r=/(?<name>a)\\k<name>\\(?<=x[(?<=]/su, s="/(?<=x)/";',
      'import("./x.mjs"); export { a as b };',
    ].join('\n')
    expect(syntaxAboveFloor(allowed)).toEqual([])
  })
})

describe('JS build target', () => {
  for (const [name, config] of [['ESM/CJS', viteConfig], ['IIFE', iifeConfig], ['UMD', umdConfig]] as const) {
    it(`${name} build targets ES2020 and the CSS browser floor`, () => {
      const { build } = config({ mode: 'production', command: 'build' })
      expect(build?.cssTarget).toEqual(BROWSERS)
      expect(build?.target).toEqual(JS_TARGET)
    })
  }

  it('scans every dist file in exactly one syntax-floor-dist shard', () => {
    const files = listJsFiles(dist)
    const names = files.map((file) => basename(file))
    // Every output format must be scanned: ESM, CJS and both CDN bundles.
    expect(files.length).toBeGreaterThan(500)
    expect(names.filter((name) => name.endsWith('.cjs')).length).toBeGreaterThan(100)
    expect(names).toEqual(expect.arrayContaining(['blok.mjs', 'blok.cjs', 'locales.mjs', 'blok.iife.js', 'blok.umd.js']))

    const shards = distShards(files)
    expect(shards).toHaveLength(DIST_SHARDS)
    expect(shards.flat().sort()).toEqual([...files].sort())
    const shardTests = readdirSync(__dirname).filter((name) => /^syntax-floor-dist-\d+\.test\.ts$/.test(name))
    expect(shardTests).toHaveLength(DIST_SHARDS)
  })
})
