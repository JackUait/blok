import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wrapDist, WRAPPER_MARKER, ENTRIES } from '../../../scripts/override/generate-override-entries.mjs';

const MINI_ENTRIES: Record<string, string> = {
  'blok.mjs': 'const A = 1;\nexport const Blok = A;\nexport const version = "9.9.9";\nexport default Blok;\n',
  'blok.cjs': 'exports.Blok = 1;\nexports.version = "9.9.9";\n',
  'tools.mjs': 'export const Table = 2;\n',
  'tools.cjs': 'exports.Table = 2;\n',
  'full.mjs': 'export const Full = 3;\n',
  'full.cjs': 'exports.Full = 3;\n',
  'markdown.mjs': 'export const md = 4;\n',
  'markdown.cjs': 'exports.md = 4;\n',
  'view.mjs': 'export const view = 5;\n',
  'view.cjs': 'exports.view = 5;\n',
  'migrate.mjs': 'export const migrate = 6;\n',
  'migrate.cjs': 'exports.migrate = 6;\n',
  'adapters.mjs': 'export const adapt = 7;\n',
  'adapters.cjs': 'exports.adapt = 7;\n',
  'icons.mjs': 'export const IconX = 8;\n',
  'icons.cjs': 'exports.IconX = 8;\n',
  'locales.mjs': 'export const de = 9;\n',
};

describe('generate-override-entries', () => {
  let dist: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dist = mkdtempSync(join(tmpdir(), 'blok-override-dist-'));
    for (const [file, content] of Object.entries(MINI_ENTRIES)) {
      writeFileSync(join(dist, file), content);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dist, { recursive: true, force: true });
  });

  it('renames every entry to -impl and writes a marked wrapper in its place', async () => {
    await wrapDist(dist);
    for (const entry of ENTRIES) {
      for (const ext of entry.formats) {
        expect(existsSync(join(dist, `${entry.file}-impl.${ext}`))).toBe(true);
        const wrapper = readFileSync(join(dist, `${entry.file}.${ext}`), 'utf8');
        expect(wrapper.startsWith(WRAPPER_MARKER)).toBe(true);
        expect(wrapper).toContain(`resolveOverrideEntry('${entry.key}'`);
      }
    }
  });

  it('guards every impl export by name, routes through a pure pick, and keeps default', async () => {
    await wrapDist(dist);
    const wrapper = readFileSync(join(dist, 'blok.mjs'), 'utf8');
    expect(wrapper).toContain(`export const Blok = /* @__PURE__ */ pick('Blok', impl.Blok);`);
    expect(wrapper).toContain(`export const version = /* @__PURE__ */ pick('version', impl.version);`);
    expect(wrapper).toContain('export default _default;');
    const toolsWrapper = readFileSync(join(dist, 'tools.mjs'), 'utf8');
    expect(toolsWrapper).not.toContain('export default');
  });

  it('emits a cjs wrapper that falls back to the whole impl object', async () => {
    await wrapDist(dist);
    const wrapper = readFileSync(join(dist, 'blok.cjs'), 'utf8');
    expect(wrapper).toContain(`require('./blok-impl.cjs')`);
    expect(wrapper).toContain('module.exports = impl;');
  });

  it('copies the runtime as mjs and derives a cjs runtime', async () => {
    await wrapDist(dist);
    const source = readFileSync('scripts/override/override-runtime.mjs', 'utf8');
    expect(readFileSync(join(dist, 'override-runtime.mjs'), 'utf8')).toBe(source);
    const cjs = readFileSync(join(dist, 'override-runtime.cjs'), 'utf8');
    expect(cjs).toContain('module.exports = { PROTOCOL, resolveOverrideEntry };');
    expect(cjs).not.toContain('export function');
  });

  it('is idempotent — a second run changes nothing and never double-wraps', async () => {
    await wrapDist(dist);
    const first = readFileSync(join(dist, 'blok.mjs'), 'utf8');
    await wrapDist(dist);
    expect(readFileSync(join(dist, 'blok.mjs'), 'utf8')).toBe(first);
    expect(existsSync(join(dist, 'blok-impl-impl.mjs'))).toBe(false);
  });

  it('recovers from a run interrupted between formats (mjs wrapped, cjs not)', async () => {
    await wrapDist(dist);
    const wrappedCjs = readFileSync(join(dist, 'blok.cjs'), 'utf8');
    writeFileSync(join(dist, 'blok.cjs'), MINI_ENTRIES['blok.cjs']);
    rmSync(join(dist, 'blok-impl.cjs'));
    await wrapDist(dist);
    expect(readFileSync(join(dist, 'blok.cjs'), 'utf8')).toBe(wrappedCjs);
  });

  it('fails loudly when an entry file is missing', async () => {
    rmSync(join(dist, 'locales.mjs'));
    await expect(wrapDist(dist)).rejects.toThrow(/locales\.mjs/);
  });
});
