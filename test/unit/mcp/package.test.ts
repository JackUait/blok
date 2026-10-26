// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import type { InlineConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '../../..');
const { build } = vi.hoisted(() => ({
  build: vi.fn<(config: InlineConfig) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('vite', () => ({ build }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = (path: string): Record<string, unknown> => {
  const absolutePath = resolve(ROOT, path);

  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);

  const value: unknown = JSON.parse(readFileSync(absolutePath, 'utf8'));

  if (!isRecord(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  return value;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@bloklabs/mcp package boundary', () => {
  it('declares the independently installable MCP package and CLI payload', () => {
    const pkg = readJson('packages/mcp/package.json');

    expect(pkg.name).toBe('@bloklabs/mcp');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ 'blok-mcp': 'bin/blok-mcp.mjs' });
    expect(pkg.files).toEqual(['bin', 'dist', 'types']);
    expect(pkg.publishConfig).toEqual({ access: 'public' });
    expect(existsSync(resolve(ROOT, 'packages/mcp/bin/blok-mcp.mjs'))).toBe(true);
  });

  it('uses the root lockstep version', () => {
    expect(readJson('packages/mcp/package.json').version).toBe(readJson('package.json').version);
  });

  it('declares the runtime dependencies without a separately installed core', () => {
    const pkg = readJson('packages/mcp/package.json');

    expect(pkg.dependencies).toEqual({
      '@modelcontextprotocol/server': '2.4.0',
      ws: '8.22.0',
    });
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('uses the core Node engine floor', () => {
    const engines = readJson('packages/mcp/package.json').engines;

    expect(engines).toEqual({ node: '>=20.19.0' });
    expect(engines).toEqual(readJson('package.json').engines);
  });

  it('exports the package-owned ESM entry and published declaration path', () => {
    expect(readJson('packages/mcp/package.json').exports).toEqual({
      '.': { types: './types/index.d.ts', import: './dist/mcp.mjs' },
      './package.json': './package.json',
    });
  });

  it('exposes the standalone build through the root package scripts', () => {
    const scripts = readJson('package.json').scripts;

    expect(scripts).toMatchObject({ 'build:mcp': 'node scripts/build-mcp.mjs' });
  });

  it('pins the SDK client only as a root development dependency', () => {
    const pkg = readJson('package.json');

    expect(pkg.devDependencies).toMatchObject({ '@modelcontextprotocol/client': '2.4.0' });

    if (isRecord(pkg.dependencies)) {
      expect(pkg.dependencies['@modelcontextprotocol/client']).toBeUndefined();
    }
  });

  it('includes the MCP manifest in the release workspace version-stamping list', () => {
    const source = ts.createSourceFile(
      'release.mjs',
      readFileSync(resolve(ROOT, 'scripts/release.mjs'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const manifests: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.name.text === 'WORKSPACE_MANIFESTS'
        && node.initializer !== undefined
        && ts.isArrayLiteralExpression(node.initializer)) {
        for (const element of node.initializer.elements.filter(ts.isStringLiteral)) {
          manifests.push(element.text);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
    expect(manifests).toContain('packages/mcp/package.json');
  });

  it.each(['unit-tests', 'workspace-unit-tests'])(
    'builds MCP immediately after the CLI in the %s CI job',
    (jobName) => {
      const workflow: unknown = parse(readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8'));

      if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        throw new Error('CI must declare jobs');
      }

      const job = workflow.jobs[jobName];

      if (!isRecord(job) || !Array.isArray(job.steps)) {
        throw new Error(`CI job ${jobName} must declare steps`);
      }

      const runs = job.steps.flatMap((step: unknown) =>
        isRecord(step) && typeof step.run === 'string' ? [step.run] : []
      );

      const cliIndex = runs.indexOf('yarn build:cli');

      expect(cliIndex).toBeGreaterThanOrEqual(0);
      expect(runs[cliIndex + 1]).toBe('yarn build:mcp');
    }
  );

  it('builds both Node entries in its own dist without externalizing core', async () => {
    const scriptPath = resolve(ROOT, 'scripts/build-mcp.mjs');

    expect(existsSync(scriptPath), 'scripts/build-mcp.mjs must exist').toBe(true);
    vi.resetModules();
    await import(pathToFileURL(scriptPath).href);

    expect(build).toHaveBeenCalledOnce();

    const config = build.mock.calls[0]?.[0];

    expect(config).toMatchObject({
      configFile: false,
      build: {
        copyPublicDir: false,
        ssr: true,
        target: 'node20',
        emptyOutDir: true,
        outDir: resolve(ROOT, 'packages/mcp/dist'),
        lib: {
          entry: {
            mcp: resolve(ROOT, 'src/mcp/index.ts'),
            'stdout-guard': resolve(ROOT, 'src/mcp/stdout-guard.ts'),
          },
          formats: ['es'],
        },
      },
      define: { VERSION: JSON.stringify(readJson('package.json').version) },
    });

    const lib = config?.build?.lib;

    if (!lib || typeof lib.fileName !== 'function') {
      throw new Error('MCP must name both entry bundles');
    }

    expect(lib.fileName('es', 'mcp')).toBe('mcp.mjs');
    expect(lib.fileName('es', 'stdout-guard')).toBe('stdout-guard.mjs');

    const external = config?.build?.rollupOptions?.external;

    if (!Array.isArray(external)) {
      throw new Error('MCP must declare external runtime dependencies');
    }

    const isExternal = (id: string): boolean => external.some((rule: unknown) =>
      rule instanceof RegExp ? rule.test(id) : rule === id
    );

    for (const id of ['node:fs', 'node:path', '@modelcontextprotocol/server', '@modelcontextprotocol/server/mcp', 'ws']) {
      expect(isExternal(id), id).toBe(true);
    }

    for (const id of ['@bloklabs/core', '../shared/agent/index.ts', '@modelcontextprotocol/server-other']) {
      expect(isExternal(id), id).toBe(false);
    }

    for (const path of ['src/mcp/index.ts', 'src/mcp/stdout-guard.ts']) {
      expect(existsSync(resolve(ROOT, path)), path).toBe(true);
    }
  });
});
