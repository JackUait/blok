import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'

import viteConfig from '../../../vite.config.mjs'
import iifeConfig from '../../../vite.config.iife.mjs'
import umdConfig from '../../../vite.config.umd.mjs'

const dist = resolve(__dirname, '../../../dist')

// The browser floor the CSS already needs (`:has()`, container queries).
const BROWSERS = ['chrome105', 'edge105', 'firefox110', 'safari16']
// `es2020` caps the syntax: consumers' bundlers and test runners parse dist,
// and 1.16.1 shipped nothing newer. oxc lowers to whichever is older.
const JS_TARGET = ['es2020', ...BROWSERS]

const MODIFIER_GROUP = /^\?[imsx-]+:/
const NAMED_GROUP = /^\?<([A-Za-z_$][\w$]*)>/

/** Regex parts above the floor. Lookbehind is ES2018, but Safari 16.0 lacks it (16.4). */
function regexAboveFloor(literal: string): string[] {
  const end = literal.lastIndexOf('/')
  const body = literal.slice(1, end)
  const flags = literal.slice(end + 1)
  const found: string[] = []
  const groupNames = new Set<string>()
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
    const rest = body.slice(i + 1)
    const name = NAMED_GROUP.exec(rest)?.[1]
    if (rest.startsWith('?<=') || rest.startsWith('?<!')) {
      found.push('regex lookbehind')
    } else if (MODIFIER_GROUP.exec(rest) !== null) {
      found.push('regex modifiers')
    } else if (name !== undefined && groupNames.has(name)) {
      found.push('regex duplicate named groups')
    } else if (name !== undefined) {
      groupNames.add(name)
    }
  }
  found.push(...['d', 'v'].filter((flag) => flags.includes(flag)).map((flag) => `regex ${flag} flag`))
  return found
}

const LOGICAL_ASSIGNMENTS = new Set([
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

const isModuleName = (name: ts.ModuleExportName | undefined): boolean => name !== undefined && ts.isStringLiteral(name)

/** The syntax feature a node uses that ES2020 parsers reject, or null. */
function featureAboveFloor(node: ts.Node, source: ts.SourceFile, inFunction: boolean): string | null {
  if (ts.isBinaryExpression(node) && LOGICAL_ASSIGNMENTS.has(node.operatorToken.kind)) {
    return 'logical assignment'
  }
  if ((ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) && node.getText(source).includes('_')) {
    return 'numeric separator'
  }
  if (ts.isPropertyDeclaration(node)) {
    return 'class field'
  }
  if (ts.isPrivateIdentifier(node)) {
    return 'private name'
  }
  if (ts.isClassStaticBlockDeclaration(node)) {
    return 'class static block'
  }
  if (!inFunction && (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined))) {
    return 'top-level await'
  }
  if ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && (isModuleName(node.name) || isModuleName(node.propertyName))) {
    return 'string module name'
  }
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.attributes !== undefined) {
    return 'import attributes'
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 1) {
    return 'import attributes'
  }
  if (ts.isDecorator(node)) {
    return 'decorator'
  }
  if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Using) !== 0) {
    return 'using declaration'
  }
  if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AccessorKeyword)) {
    return 'accessor field'
  }
  return null
}

/** Syntax in a JS file that an ES2020 parser, or a browser at the floor, rejects. */
function syntaxAboveFloor(code: string): string[] {
  const source = ts.createSourceFile('chunk.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const found: string[] = ts.getShebang(code) === undefined ? [] : ['hashbang']
  const visit = (node: ts.Node, inFunction: boolean): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      found.push(...regexAboveFloor(node.getText(source)))
    }
    const feature = featureAboveFloor(node, source, inFunction)
    if (feature !== null) {
      found.push(feature)
    }
    const nested = inFunction || ts.isFunctionLike(node)
    ts.forEachChild(node, (child) => visit(child, nested))
  }
  visit(source, false)
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

  it('emits no syntax newer than the floor', () => {
    const files = listJsFiles(dist)
    const names = files.map((file) => basename(file))
    // Every output format must be scanned: ESM, CJS and both CDN bundles.
    expect(files.length).toBeGreaterThan(500)
    expect(names.filter((name) => name.endsWith('.cjs')).length).toBeGreaterThan(100)
    expect(names).toEqual(expect.arrayContaining(['blok.mjs', 'blok.cjs', 'locales.mjs', 'blok.iife.js', 'blok.umd.js']))

    const hits = files.flatMap((file) =>
      syntaxAboveFloor(readFileSync(file, 'utf-8')).map((feature) => `${file.slice(dist.length + 1)}: ${feature}`),
    )
    expect(hits).toEqual([])
  }, 300_000)
})
