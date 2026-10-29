import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'

import viteConfig from '../../../vite.config.mjs'
import iifeConfig from '../../../vite.config.iife.mjs'
import umdConfig from '../../../vite.config.umd.mjs'

const dist = resolve(__dirname, '../../../dist')

// The browser floor the CSS already needs (`:has()`, container queries).
const FLOOR = ['chrome105', 'edge105', 'firefox110', 'safari16']

const MODIFIER_GROUP = /^\?[imsx-]+:/

/** Regex parts newer than the floor. Safari 16.0 has no lookbehind (16.4); `v` and modifiers are newer still. */
function regexAboveFloor(literal: string): string[] {
  const end = literal.lastIndexOf('/')
  const body = literal.slice(1, end)
  const flags = literal.slice(end + 1)
  const found: string[] = []
  let inClass = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (inClass) {
      inClass = ch !== ']'
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch !== '(' || body[i + 1] !== '?') {
      continue
    }
    if (body.startsWith('?<=', i + 1) || body.startsWith('?<!', i + 1)) {
      found.push('regex lookbehind')
    } else if (MODIFIER_GROUP.exec(body.slice(i + 1)) !== null) {
      found.push('regex modifiers')
    }
  }
  if (flags.includes('v')) {
    found.push('regex v flag')
  }
  return found
}

/** Syntax in a JS file that browsers at the floor cannot parse. */
function syntaxAboveFloor(code: string): string[] {
  const source = ts.createSourceFile('chunk.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      found.push(...regexAboveFloor(node.getText(source)))
    } else if (ts.isClassStaticBlockDeclaration(node)) {
      found.push('class static block')
    } else if (ts.isDecorator(node)) {
      found.push('decorator')
    } else if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Using) !== 0) {
      found.push('using declaration')
    } else if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AccessorKeyword)) {
      found.push('accessor field')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function listJsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listJsFiles(full)
    }
    return /\.(mjs|cjs|js)$/.test(entry.name) ? [full] : []
  })
}

describe('syntax floor scanner', () => {
  it('flags syntax newer than the floor', () => {
    expect(syntaxAboveFloor('const a=/(?<=x)y/g, b=/(?<!x)y/;')).toEqual(['regex lookbehind', 'regex lookbehind'])
    expect(syntaxAboveFloor('class A{static{f()}}')).toEqual(['class static block'])
    expect(syntaxAboveFloor('const a=/[\\p{L}--x]/v, b=/(?i:a)b/;')).toEqual(['regex v flag', 'regex modifiers'])
    expect(syntaxAboveFloor('{using r=f()}')).toEqual(['using declaration'])
    expect(syntaxAboveFloor('class A{accessor x=1}')).toEqual(['accessor field'])
  })

  it('passes syntax the floor already parses', () => {
    const allowed = [
      'const a=b?.c??d; a||=1;',
      'class A{#x=1;static y=2;#m(){} has(o){return #x in o}}',
      'const r=/(?<name>a)\\(?<=x[(?<=]/su, s="/(?<=x)/";',
    ].join('\n')
    expect(syntaxAboveFloor(allowed)).toEqual([])
  })
})

describe('JS build target', () => {
  // The CDN configs once had no cssTarget, so their CSS fell back to es2017
  // and got the `:lang()` lowering that breaks RTL.
  for (const [name, config] of [['ESM/CJS', viteConfig], ['IIFE', iifeConfig], ['UMD', umdConfig]] as const) {
    it(`${name} build matches the CSS browser floor`, () => {
      const { build } = config({ mode: 'production', command: 'build' })
      expect(build?.cssTarget).toEqual(FLOOR)
      expect(build?.target).toEqual(FLOOR)
    })
  }

  it('emits no syntax newer than the floor', () => {
    const hits = listJsFiles(dist).flatMap((file) =>
      syntaxAboveFloor(readFileSync(file, 'utf-8')).map((feature) => `${file.slice(dist.length + 1)}: ${feature}`),
    )
    expect(hits).toEqual([])
  }, 300_000)
})
