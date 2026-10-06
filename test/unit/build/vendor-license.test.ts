import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const vendorLicensePath = resolve(__dirname, '../../../dist/vendor.LICENSE.txt')

const PERMISSIVE = ['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0']

// Must match the named exceptions in vite.config.mjs's license gate.
// elkjs is EPL-2.0: mermaid 12 imports it for its default ELK layout.
const NAMED_EXCEPTIONS: Record<string, string> = {
  'html-janitor': 'null',
  khroma: 'null',
  elkjs: 'EPL-2.0',
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

  it('bundles only permissive licenses, apart from named exceptions', () => {
    const offenders = readVendorEntries()
      .filter((entry) => !isPermissive(entry.license))
      .filter((entry) => NAMED_EXCEPTIONS[entry.name] !== entry.license)
      .map((entry) => `${entry.name}: ${entry.license}`)

    expect(offenders).toEqual([])
  })
})
