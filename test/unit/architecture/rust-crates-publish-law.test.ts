// @vitest-environment node
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishedCrates } from '../../../scripts/release-cargo.mjs';

/**
 * `cargo install blok-mcp` builds from crates.io, so blok-mcp and every crate
 * it needs at run time must be published, carry the release version, and
 * build from their own folder alone.
 */
const ROOT = path.resolve(__dirname, '../../..');
const RUST = path.join(ROOT, 'packages/server/rust');
const CRATES = path.join(RUST, 'crates');
const read = (file: string): string => readFileSync(file, 'utf-8');

const manifests = new Map(
  readdirSync(CRATES)
    .filter((dir) => existsSync(path.join(CRATES, dir, 'Cargo.toml')))
    .map((dir) => {
      const source = read(path.join(CRATES, dir, 'Cargo.toml'));
      const name = /^name = "([^"]+)"/m.exec(source)?.[1] ?? dir;

      return [name, { dir, source }];
    }),
);

const section = (source: string, header: string): string => {
  const text = `\n${source}`;
  const start = text.indexOf(`\n[${header}]\n`);

  if (start === -1) {
    return '';
  }

  const rest = text.slice(start + header.length + 4);
  const end = rest.search(/^\[/m);

  return end === -1 ? rest : rest.slice(0, end);
};

const blokDeps = (source: string): string[] =>
  [...section(source, 'dependencies').matchAll(/^(blok-[\w-]+)/gm)].map((match) => match[1]);

const closure = (): string[] => {
  const seen = new Set<string>();
  const walk = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const manifest = manifests.get(name);

    if (manifest === undefined) {
      throw new Error(`no crate named ${name}`);
    }
    blokDeps(manifest.source).forEach(walk);
  };

  walk('blok-mcp');

  return [...seen].sort();
};

const releaseVersion = (JSON.parse(read(path.join(ROOT, 'package.json'))) as { version: string }).version;
const workspace = read(path.join(RUST, 'Cargo.toml'));

describe('Rust crates published to crates.io', () => {
  it('publishes exactly blok-mcp and its run-time crates', () => {
    expect([...publishedCrates(workspace)].sort()).toEqual(closure());
  });

  it('gives the workspace the release version', () => {
    expect(section(workspace, 'workspace.package')).toMatch(new RegExp(`^version = "${releaseVersion.replaceAll('.', '\\.')}"$`, 'm'));
  });

  it('pins each published crate in workspace.dependencies to the release version', () => {
    const table = section(workspace, 'workspace.dependencies');

    for (const name of closure()) {
      const dir = manifests.get(name)?.dir;

      expect(table).toContain(`${name} = { path = "crates/${dir}", version = "=${releaseVersion}" }`);
    }
  });

  it.each(closure())('%s is publishable', (name) => {
    const source = manifests.get(name)?.source ?? '';
    const pkg = section(source, 'package');

    expect(pkg).toMatch(/^version\.workspace = true$/m);
    expect(pkg).toMatch(/^publish = true$/m);
    expect(pkg).toMatch(/^description = "[^"]+"$/m);
    expect(pkg).toMatch(/^repository\.workspace = true$/m);

    // A bare path dependency has no version, so crates.io refuses the crate.
    for (const dep of blokDeps(source)) {
      expect(section(source, 'dependencies')).toMatch(new RegExp(`^${dep}\\.workspace = true$`, 'm'));
    }
  });

  it('keeps every other crate unpublished', () => {
    const published = new Set(closure());

    for (const [name, { source }] of manifests) {
      if (!published.has(name)) {
        expect(section(source, 'package'), name).not.toMatch(/^publish = true$/m);
      }
    }
    expect(section(workspace, 'workspace.package')).toMatch(/^publish = false$/m);
  });

  it('reads no file outside a published crate at build time', () => {
    const includes = closure().flatMap((name) => {
      const crate = path.join(CRATES, manifests.get(name)?.dir ?? '');
      const src = path.join(crate, 'src');

      return readdirSync(src, { recursive: true, encoding: 'utf-8' })
        .filter((file) => file.endsWith('.rs'))
        .flatMap((file) => [...read(path.join(src, file)).matchAll(/include_(?:str|bytes)!\("([^"]+)"\)/g)]
          .map((match) => ({ crate, label: `${name}/${file}: ${match[1]}`, target: path.resolve(path.dirname(path.join(src, file)), match[1]) })));
    });

    for (const { crate, label, target } of includes) {
      expect(target.startsWith(crate + path.sep), label).toBe(true);
    }
  });

  it('packages the runtime bundle Go embeds, through a symlink', () => {
    const link = path.join(CRATES, 'jsruntime/src/blok-server-runtime.js');

    expect(readlinkSync(link)).toBe('../../../../go/internal/jsruntime/blok-server-runtime.js');
    expect(realpathSync(link)).toBe(path.join(ROOT, 'packages/server/go/internal/jsruntime/blok-server-runtime.js'));
  });
});
