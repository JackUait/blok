import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = resolve(__dirname, '../../..')

interface PackageManifest {
  version?: string
  devDependencies?: Record<string, string>
}

const readJson = (path: string): PackageManifest => JSON.parse(readFileSync(path, 'utf8')) as PackageManifest

const pinned = readJson(resolve(root, 'package.json')).devDependencies?.mermaid

// Each lock entry is a block whose first line lists its descriptors.
const lockEntries = (name: string): Array<{ header: string; version: string }> =>
  readFileSync(resolve(root, 'yarn.lock'), 'utf8')
    .split(/\n\n/)
    .filter((block) => block.startsWith(`"${name}@`) || block.startsWith(`${name}@`))
    .map((block) => ({
      header: block.split('\n')[0],
      version: /^ {2}version: (.+)$/m.exec(block)?.[1] ?? '',
    }))

describe('mermaid pin', () => {
  it('is an exact version in package.json', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('resolves to one mermaid copy in yarn.lock, at the pinned version', () => {
    const entries = lockEntries('mermaid')

    expect(entries.map((entry) => entry.version)).toEqual([pinned])
    expect(entries[0]?.header).toContain(`mermaid@npm:${pinned}`)
  })

  it('is the version installed in node_modules', () => {
    expect(readJson(resolve(root, 'node_modules/mermaid/package.json')).version).toBe(pinned)
  })
})
