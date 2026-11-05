import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

export const dist = resolve(__dirname, '../../../dist')

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
export function syntaxAboveFloor(code: string): string[] {
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

export function listJsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listJsFiles(full)
    }
    return /\.(mjs|cjs|js)$/.test(entry.name) ? [full] : []
  })
}

// Parsing all of dist took 44s on CI in one file. Vitest runs files in
// parallel, so the scan is split across the syntax-floor-dist-* files.
export const DIST_SHARDS = 4

/** The dist files of each shard, largest first onto the lightest shard. */
export function distShards(files: string[]): string[][] {
  const shards = Array.from({ length: DIST_SHARDS }, () => ({ bytes: 0, files: [] as string[] }))
  const sized = files.map((file) => ({ file, bytes: statSync(file).size }))
  sized.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file))
  for (const { file, bytes } of sized) {
    const lightest = shards.reduce((min, shard) => (shard.bytes < min.bytes ? shard : min))
    lightest.files.push(file)
    lightest.bytes += bytes
  }
  return shards.map((shard) => shard.files)
}

/** Each use of syntax above the floor in one shard of dist, as `path: feature`. */
export function scanDistShard(index: number): string[] {
  return distShards(listJsFiles(dist))[index].flatMap((file) =>
    syntaxAboveFloor(readFileSync(file, 'utf-8')).map((feature) => `${file.slice(dist.length + 1)}: ${feature}`),
  )
}
