import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { init as initLexer, parse as parseModule } from 'es-module-lexer/minimal'
import { describe, it, expect } from 'vitest'

const repoRoot = resolve(__dirname, '../../../')
const dist = resolve(repoRoot, 'dist')
const localeSources = resolve(repoRoot, 'src/components/i18n/locales')

// English is bundled into the entry; every other UI locale is a lazy file.
const lazyLocales = readdirSync(localeSources)
  .filter((name) => name.endsWith('.json') && name !== 'en.json')
  .map((name) => name.replace(/\.json$/, ''))

function listEsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listEsFiles(full)
    }
    return entry.name.endsWith('.mjs') ? [full] : []
  })
}

describe('UI locale files', () => {
  const esFiles = listEsFiles(dist)

  it('ships each lazy UI locale once', () => {
    // The emoji data for a locale shares its name, so match the message JSON too.
    const counts = lazyLocales.map((code) => {
      const nameRe = new RegExp(`^${code}-[A-Za-z0-9_-]{8}\\.mjs$`)
      const copies = esFiles.filter((file) =>
        nameRe.test(basename(file)) && readFileSync(file, 'utf-8').includes('"blockSettings.dragToMove"'),
      )
      return `${code}: ${copies.length}`
    })
    expect(lazyLocales.length).toBeGreaterThan(60)
    expect(counts.filter((entry) => !entry.endsWith(': 1'))).toEqual([])
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
