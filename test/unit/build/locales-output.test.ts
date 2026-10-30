import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { init as initLexer, parse as parseModule } from 'es-module-lexer/minimal'
import { describe, it, expect } from 'vitest'

import { RELEASED_DATABASE_KEYS, isDatabaseOnlyKey } from '../../../scripts/english-parts.mjs'

const repoRoot = resolve(__dirname, '../../../')
const dist = resolve(repoRoot, 'dist')
const localeSources = resolve(repoRoot, 'src/components/i18n/locales')

// English is bundled into the entry; every other UI locale is a lazy file.
const lazyLocales = readdirSync(localeSources)
  .filter((name) => name.endsWith('.json') && name !== 'en.json')
  .map((name) => name.replace(/\.json$/, ''))

// Static and dynamic relative imports, as the minifier writes them.
const IMPORT_RE = /(?:from|import)\s*\(?\s*["'`](\.[^"'`]+)["'`]/g

/** Every dist file an entry can load: its static and lazy import closure. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [resolve(dist, entry)]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file) || !existsSync(file)) {
      continue
    }
    seen.add(file)
    for (const match of readFileSync(file, 'utf-8').matchAll(IMPORT_RE)) {
      queue.push(resolve(dirname(file), match[1]))
    }
  }
  return seen
}

const STATIC_IMPORT_RE = /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["'](\.[^"']+)["']/g

/** The files an entry loads before it runs: its static import closure. */
function eagerFrom(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [resolve(dist, entry)]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) {
      continue
    }
    seen.add(file)
    for (const match of readFileSync(file, 'utf-8').matchAll(STATIC_IMPORT_RE)) {
      queue.push(resolve(dirname(file), match[1]))
    }
  }
  return [...seen]
}

function listEsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listEsFiles(full)
    }
    return entry.name.endsWith('.mjs') ? [full] : []
  })
}

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex')

/**
 * Load every locale the way a consumer does, in a plain node process: the ES
 * files through `/locales` `loadLocale`, the CJS chunks through `require`.
 * Vitest would push ~70 multi-megabyte chunks through its transform.
 * Prints `{ es: { code: sha1 }, cjs: { code: sha1[] } }` of JSON.stringify(dictionary).
 */
const LOAD_EVERY_LOCALE = `
const { createHash } = require('node:crypto')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const sha1 = (text) => createHash('sha1').update(text).digest('hex')
const dist = process.argv[1]
;(async () => {
  const locales = await import(join(dist, 'locales.mjs'))
  const es = {}
  for (const code of locales.ALL_LOCALE_CODES) {
    es[code] = sha1(JSON.stringify((await locales.loadLocale(code)).dictionary))
  }
  const cjs = {}
  // vite.config.mjs splits chunks between these two folders.
  for (const [dir, name] of ['chunks', 'pure-chunks'].flatMap((dir) => readdirSync(join(dist, dir)).map((name) => [dir, name]))) {
    const match = /^([a-zA-Z-]+)-[A-Za-z0-9_-]{8}\\.cjs$/.exec(name)
    if (match === null || !locales.ALL_LOCALE_CODES.includes(match[1])) continue
    const data = require(join(dist, dir, name)).default
    ;(cjs[match[1]] ??= []).push(sha1(JSON.stringify(data)))
  }
  process.stdout.write(JSON.stringify({ es, cjs }))
})()
`

describe('UI locale files', () => {
  const esFiles = listEsFiles(dist)

  it('ships each lazy UI locale once', () => {
    // The emoji data for a locale shares its name. UI chunks hold values only,
    // so they are the ones that import the shared message key list.
    const counts = lazyLocales.map((code) => {
      const nameRe = new RegExp(`^${code}-[A-Za-z0-9_-]{8}\\.mjs$`)
      const copies = esFiles.filter((file) =>
        nameRe.test(basename(file)) && readFileSync(file, 'utf-8').includes('./message-keys-'),
      )
      return `${code}: ${copies.length}`
    })
    expect(lazyLocales.length).toBeGreaterThan(60)
    expect(counts.filter((entry) => !entry.endsWith(': 1'))).toEqual([])
  })

  it('ships the English messages once across the core, tools and /locales entries', () => {
    // An app importing both entries must not download English twice.
    const reachable = new Set(['blok.mjs', 'tools.mjs', 'locales.mjs'].flatMap((entry) => [...reachableFrom(entry)]))
    const copiesOf = (key: string, value: string): string[] => [...reachable]
      .filter((file) => {
        const code = readFileSync(file, 'utf-8')
        return code.includes(`"${key}"`) && code.includes(value)
      })
      .map((file) => basename(file))
    expect(reachable.size).toBeGreaterThan(100)
    expect(copiesOf('blockSettings.dragToMove', 'Drag to move')).toHaveLength(1)
    expect(copiesOf('tools.database.tableDragHandle', 'Drag to move, click to open menu')).toHaveLength(1)
  })

  it('every UI locale loads as the exact object its source JSON parses to', () => {
    // Stringify compares values, missing keys and key order in one go.
    const loaded = JSON.parse(
      execFileSync(process.execPath, ['-e', LOAD_EVERY_LOCALE, dist], { encoding: 'utf-8', maxBuffer: 1 << 24 }),
    ) as { es: Record<string, string>, cjs: Record<string, string[]> }
    const codes = [...lazyLocales, 'en']
    const mismatches = codes.flatMap((code) => {
      const expected = sha1(JSON.stringify(JSON.parse(readFileSync(resolve(localeSources, `${code}.json`), 'utf-8'))))
      const esOk = loaded.es[code] === expected
      const cjsOk = code === 'en' || (loaded.cjs[code] ?? []).filter((hash) => hash === expected).length === 1
      return esOk && cjsOk ? [] : [`${code}: es ${esOk ? 'ok' : 'differs'}, cjs ${cjsOk ? 'ok' : 'differs'}`]
    })
    expect(Object.keys(loaded.es)).toHaveLength(codes.length)
    expect(mismatches).toEqual([])
  })

  it('lazy UI locales ship their values against one shared key list', () => {
    // Keys are ~half of every locale file; only the shared list carries them.
    const keyLists = esFiles.filter((file) => basename(file).startsWith('message-keys-'))
    expect(keyLists.map((file) => basename(file))).toHaveLength(1)
    const withKeys = lazyLocales.flatMap((code) => {
      const nameRe = new RegExp(`^${code}-[A-Za-z0-9_-]{8}\\.mjs$`)
      return esFiles.filter((file) =>
        nameRe.test(basename(file)) && readFileSync(file, 'utf-8').includes('blockSettings.clickToOpenMenu'),
      )
    })
    expect(withKeys.map((file) => basename(file))).toEqual([])
  })

  it('every file the locales entry imports exists', async () => {
    await initLexer()
    const impl = resolve(dist, existsSync(resolve(dist, 'locales-impl.mjs')) ? 'locales-impl.mjs' : 'locales.mjs')
    const [imports] = parseModule(readFileSync(impl, 'utf-8'))
    const targets = imports.flatMap(({ n }) => (n?.startsWith('.') ? [resolve(dirname(impl), n)] : []))
    expect(targets.length).toBeGreaterThanOrEqual(lazyLocales.length)
    expect(targets.filter((file) => !existsSync(file))).toEqual([])
  })
})

/** Like LOAD_EVERY_LOCALE, but imports every `<code>-<hash>` chunk directly. */
const LOAD_LOCALE_CHUNKS = `
const { createHash } = require('node:crypto')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const sha1 = (text) => createHash('sha1').update(text).digest('hex')
const [dist, codesJson] = process.argv.slice(1)
const codes = JSON.parse(codesJson)
;(async () => {
  const out = { mjs: {}, cjs: {} }
  for (const [dir, name] of ['chunks', 'pure-chunks'].flatMap((dir) => readdirSync(join(dist, dir)).map((name) => [dir, name]))) {
    const match = /^([a-zA-Z-]+)-[A-Za-z0-9_-]{8}\\.(mjs|cjs)$/.exec(name)
    if (match === null || !codes.includes(match[1])) continue
    const file = join(dist, dir, name)
    const data = match[2] === 'mjs' ? (await import(file)).default : require(file).default
    ;(out[match[2]][match[1]] ??= []).push(sha1(JSON.stringify(data)))
  }
  process.stdout.write(JSON.stringify(out))
})()
`

describe('English split between core and the Database tools', () => {
  const english = Object.keys(JSON.parse(readFileSync(resolve(localeSources, 'en.json'), 'utf-8')) as Record<string, string>)
  const databaseOnly = english.filter(isDatabaseOnlyKey)
  const missingFrom = (entry: string, keys: string[]): string[] => {
    const code = eagerFrom(entry).map((file) => readFileSync(file, 'utf-8')).join('\n')
    return keys.filter((key) => !code.includes(`"${key}"`))
  }

  it('leaves database-only keys out of the bare core import', () => {
    expect(databaseOnly.length).toBeGreaterThan(1000)
    expect(missingFrom('blok.mjs', databaseOnly)).toHaveLength(databaseOnly.length)
  })

  it('keeps every key core reads in the bare core import', () => {
    expect(missingFrom('blok.mjs', english.filter((key) => !isDatabaseOnlyKey(key)))).toEqual([])
  })

  it('keeps the database keys v1.16.1 shipped in the bare core import', () => {
    expect(missingFrom('blok.mjs', RELEASED_DATABASE_KEYS)).toEqual([])
  })

  it('ships the database keys with the tools entry', () => {
    expect(missingFrom('tools.mjs', databaseOnly)).toEqual([])
  })
})

describe('emoji locale files', () => {
  const emojiSources = resolve(repoRoot, 'src/components/utils/emoji/locales')
  const emojiLocales = readdirSync(emojiSources)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
  const esFiles = listEsFiles(dist)

  it('every emoji locale loads as the exact object its source JSON parses to', () => {
    // Search ranks keywords above names, so the keyword lists must come back
    // whole and in order. Stringify checks that, key order included.
    const loaded = JSON.parse(
      execFileSync(process.execPath, ['-e', LOAD_LOCALE_CHUNKS, dist, JSON.stringify(emojiLocales)], {
        encoding: 'utf-8',
        maxBuffer: 1 << 24,
      }),
    ) as Record<'mjs' | 'cjs', Record<string, string[]>>
    const mismatches = emojiLocales.flatMap((code) => {
      const expected = sha1(JSON.stringify(JSON.parse(readFileSync(resolve(emojiSources, `${code}.json`), 'utf-8'))))
      return (['mjs', 'cjs'] as const).flatMap((format) =>
        (loaded[format][code] ?? []).filter((hash) => hash === expected).length === 1 ? [] : [`${code}.${format}`],
      )
    })
    expect(emojiLocales.length).toBeGreaterThan(60)
    expect(mismatches).toEqual([])
  })

  it('emoji locales ship their entries against one shared emoji list', () => {
    const keyLists = esFiles.filter((file) => basename(file).startsWith('emoji-locale-keys-'))
    expect(keyLists.map((file) => basename(file))).toHaveLength(1)
    const importers = esFiles.filter((file) => readFileSync(file, 'utf-8').includes('./emoji-locale-keys-'))
    expect(importers).toHaveLength(emojiLocales.length)
  })
})
