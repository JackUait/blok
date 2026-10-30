import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const vendorLicensePath = resolve(__dirname, '../../../dist/vendor.LICENSE.txt')

const PERMISSIVE = ['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0']

// Must match the named exceptions in vite.config.mjs's license gate.
// elkjs is EPL-2.0: mermaid 12 imports it for its default ELK layout.
// cldr-annotations-full is data, not code: vite.config.mjs appends its notice
// because scripts/build-emoji-locale-data.mjs generates it into src.
const NAMED_EXCEPTIONS: Record<string, string> = {
  khroma: 'null',
  elkjs: 'EPL-2.0',
  'cldr-annotations-full': 'Unicode-3.0',
}

interface VendorEntry {
  name: string
  license: string
  block: string
}

function readVendorEntries(): VendorEntry[] {
  const text = readFileSync(vendorLicensePath, 'utf8')

  return text
    .split(/\n(?=Name: )/)
    .filter((block) => block.startsWith('Name: '))
    .map((block) => ({
      name: /^Name: (.+)$/m.exec(block)?.[1] ?? '',
      license: /^License: (.+)$/m.exec(block)?.[1] ?? '',
      block,
    }))
}

function isPermissive(license: string): boolean {
  return license
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((part) => PERMISSIVE.includes(part))
}

describe('dist/vendor.LICENSE.txt', () => {
  it('ships elkjs under EPL-2.0 with its full license text', () => {
    const elkjs = readVendorEntries().find((entry) => entry.name === 'elkjs')

    expect(elkjs?.license).toBe('EPL-2.0')
    expect(elkjs?.block).toContain('Eclipse Public License')
  })

  it('ships no jszip or its pako, lie and setimmediate: the in-house zip reader replaced them', () => {
    const names = readVendorEntries().map((entry) => entry.name)

    expect(names).not.toContain('jszip')
    expect(names).not.toContain('pako')
    expect(names).not.toContain('lie')
    expect(names).not.toContain('setimmediate')
  })

  it('ships the Unicode-3.0 notice of the CLDR emoji data, at the installed version', () => {
    const cldrRoot = resolve(__dirname, '../../../node_modules/cldr-annotations-full')
    const manifest = JSON.parse(readFileSync(resolve(cldrRoot, 'package.json'), 'utf8')) as { version: string }
    const notice = readFileSync(resolve(cldrRoot, 'LICENSE'), 'utf8').trim()
    const cldr = readVendorEntries().filter((entry) => entry.name === 'cldr-annotations-full')

    expect(cldr.map((entry) => entry.license)).toEqual(['Unicode-3.0'])
    expect(/^Version: (.+)$/m.exec(cldr[0]?.block ?? '')?.[1]).toBe(manifest.version)
    expect(cldr[0]?.block).toContain(notice)
  })

  it('lists mermaid, the package that pulls elkjs in', () => {
    expect(readVendorEntries().map((entry) => entry.name)).toContain('mermaid')
  })

  it('bundles one mermaid, at the version package.json pins', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    const versions = readVendorEntries()
      .filter((entry) => entry.name === 'mermaid')
      .map((entry) => /^Version: (.+)$/m.exec(entry.block)?.[1])

    expect(versions).toEqual([manifest.devDependencies?.mermaid])
  })

  it('bundles one MapLibre GL, BSD-3-Clause, at the version package.json pins', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    const maplibre = readVendorEntries().filter((entry) => entry.name === 'maplibre-gl')

    expect(maplibre.map((entry) => entry.license)).toEqual(['BSD-3-Clause'])
    expect(maplibre.map((entry) => /^Version: (.+)$/m.exec(entry.block)?.[1])).toEqual([manifest.devDependencies?.['maplibre-gl']])
  })

  it('bundles only permissive licenses, apart from named exceptions', () => {
    const offenders = readVendorEntries()
      .filter((entry) => !isPermissive(entry.license))
      .filter((entry) => NAMED_EXCEPTIONS[entry.name] !== entry.license)
      .map((entry) => `${entry.name}: ${entry.license}`)

    expect(offenders).toEqual([])
  })
})
