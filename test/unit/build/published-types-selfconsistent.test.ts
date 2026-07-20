import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const repoRoot = resolve(__dirname, '../../../')
const tsc = resolve(repoRoot, 'node_modules/.bin/tsc')

/**
 * Type-check the published bare-import declaration entry with `skipLibCheck:false`.
 *
 * The project's own `tsc --noEmit` runs with `skipLibCheck:true`, so it never
 * deep-checks the hand-authored `types/*.d.ts` for INTERNAL consistency — a
 * declaration that imports a non-exported symbol, references an unimported name,
 * or extends an interface incompatibly compiles silently. A consumer who turns
 * `skipLibCheck` off (a stricter, legitimate setting) inherits every such error.
 *
 * `types: []` keeps the program scoped to Blok's own declarations (no ambient
 * `@types/*` noise). The bare entry's closure pulls in configs/tools/api/…, so
 * this guards the whole default public type surface.
 */
function typeCheckErrors(entry: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'blok-dts-'))
  try {
    const tsconfigPath = join(dir, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          moduleResolution: 'bundler',
          module: 'esnext',
          target: 'es2022',
          lib: ['dom', 'es2022'],
          types: [],
        },
        files: [resolve(repoRoot, entry)],
      }),
    )
    try {
      execFileSync(tsc, ['-p', tsconfigPath], { encoding: 'utf-8', stdio: 'pipe' })
      return []
    } catch (error) {
      const output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
      return output
        .split('\n')
        .filter((line) => line.includes('error TS'))
        .map((line) => line.replace(`${repoRoot}/`, '').trim())
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('published type declarations are self-consistent', () => {
  it('the bare-import entry type-checks cleanly under skipLibCheck:false', () => {
    expect(typeCheckErrors('types/index.d.ts')).toEqual([])
  }, 60_000)

  it('the ./tools entry type-checks cleanly under skipLibCheck:false', () => {
    expect(typeCheckErrors('types/tools-entry.d.ts')).toEqual([])
  }, 60_000)

  it('the ./full entry type-checks cleanly under skipLibCheck:false', () => {
    expect(typeCheckErrors('types/full.d.ts')).toEqual([])
  }, 60_000)
})
