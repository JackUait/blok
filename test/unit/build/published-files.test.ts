import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import packageJson from '../../../package.json'

const repoRoot = resolve(__dirname, '../../../')
const files = packageJson.files

const isPublished = (path: string): boolean =>
  files.some((entry) => path === entry || path.startsWith(`${entry}/`))

// The bin runs straight from the tarball, so every file it requires must ship.
function binRequires(): string[] {
  const bin = resolve(repoRoot, packageJson.bin['migrate-from-editorjs'])
  const code = readFileSync(bin, 'utf-8')
  return [...code.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((match) =>
    relative(repoRoot, resolve(dirname(bin), match[1])),
  )
}

describe('published files', () => {
  it('ships every file the migrate-from-editorjs bin requires', () => {
    const required = binRequires()
    expect(required.length).toBeGreaterThan(0)
    expect(required.filter((path) => !existsSync(resolve(repoRoot, path)) || !isPublished(path))).toEqual([])
  })

  it('ships no source file beyond what the bin requires', () => {
    // Types live in types/ and code in dist/; the raw src tree only bloats the tarball.
    const required = new Set(binRequires())
    expect(files.filter((entry) => (entry === 'src' || entry.startsWith('src/')) && !required.has(entry))).toEqual([])
  })
})
