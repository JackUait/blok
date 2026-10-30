// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServerRuntime } from '../../../scripts/build-server-runtime.mjs';
import { isObject } from '../../../src/shared/type-guards';

/**
 * Go embeds the runtime bundle with `go:embed`, which cannot reach outside the
 * module and cannot see a gitignored file, so a consumer of the tagged module
 * gets the copy committed inside it. That copy has to be the bundle C# embeds.
 */
const ROOT = path.resolve(__dirname, '../../..');
const GO_BUNDLE = path.join(ROOT, 'packages/server/go/internal/jsruntime/blok-server-runtime.js');
const CSHARP_BUNDLE = path.join(ROOT, 'packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js');
const SMOKE_FIXTURE = path.join(ROOT, 'test/unit/server-conformance/fixtures/documents/bundle-smoke.json');
const FIX = 'Run `node scripts/build-server-runtime.mjs` and commit packages/server/go/internal/jsruntime/blok-server-runtime.js.';

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

const callsRegExp = (node: ts.Node): node is ts.NewExpression | ts.CallExpression => {
  if (!ts.isNewExpression(node) && !ts.isCallExpression(node)) {
    return false;
  }

  const callee = node.expression;

  return (ts.isIdentifier(callee) && callee.text === 'RegExp')
    || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'RegExp');
};

const stickyFlags = (node: ts.NewExpression | ts.CallExpression): boolean => {
  const flags = node.arguments?.[1];

  return flags !== undefined && (!ts.isStringLiteralLike(flags) || flags.text.includes('y'));
};

/** Regex literals in a script, and every sticky spelling: a `y` flag, or RegExp flags that are not a literal. */
const scanRegexes = (text: string): { literals: number; sticky: string[] } => {
  const source = ts.createSourceFile('bundle.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const sticky: string[] = [];
  let literals = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      literals += 1;
      if (/\/[a-z]*y[a-z]*$/.test(node.text)) {
        sticky.push(node.text);
      }
    } else if (callsRegExp(node) && stickyFlags(node)) {
      sticky.push(node.getText().slice(0, 120));
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return { literals, sticky };
};

const loadInvoke = (source: string): ((operation: string, inputJson: string) => Promise<unknown>) => {
  const sandbox: Record<string, unknown> = {};

  runInContext(source, createContext(sandbox));

  const invoke = sandbox.blokServerInvoke;

  if (typeof invoke !== 'function') {
    throw new TypeError('The bundle did not expose blokServerInvoke.');
  }

  return async (operation, inputJson) => invoke(operation, inputJson) as unknown;
};

describe('Go runtime bundle', () => {
  let outDir: string;
  let fresh: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'blok-go-runtime-law-'));
    fresh = await buildServerRuntime(outDir);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('commits a copy inside the Go module, not ignored by git', () => {
    expect(existsSync(GO_BUNDLE), FIX).toBe(true);
    // check-ignore exits 1 when the path is not ignored.
    expect(() => execFileSync('git', ['check-ignore', '-q', GO_BUNDLE], { cwd: ROOT })).toThrow();
  });

  it('matches a fresh build byte for byte', () => {
    expect(sha256(GO_BUNDLE), FIX).toBe(sha256(fresh));
  });

  // Generated/ exists only where something built it (MSBuild, build-all, the script).
  it.skipIf(!existsSync(CSHARP_BUNDLE))('matches the copy C# embeds', () => {
    expect(sha256(GO_BUNDLE), FIX).toBe(sha256(CSHARP_BUNDLE));
  });

  // The version bump changes the bundle (VERSION define), and the release refuses a dirty tree after its commit.
  it('is committed by the release with the bumped manifests', () => {
    const release = readFileSync(path.join(ROOT, 'scripts/release.mjs'), 'utf8');

    expect(release).toMatch(/git add [^\n]*packages\/server\/go\/internal\/jsruntime\/blok-server-runtime\.js/);
    expect(readFileSync(path.join(ROOT, 'scripts/build-all.mjs'), 'utf8')).toContain('node scripts/build-server-runtime.mjs');
  });

  // Preflight runs this law, so the Go copy must already carry the bumped version.
  it('is rebuilt by the release between the version bump and preflight', () => {
    const release = readFileSync(path.join(ROOT, 'scripts/release.mjs'), 'utf8');
    const bump = release.indexOf('npm version ${version}');
    const rebuild = release.indexOf("run('node scripts/build-server-runtime.mjs')");
    const preflight = release.indexOf("run('yarn release:preflight')");

    expect(bump).toBeGreaterThan(-1);
    expect(rebuild).toBeGreaterThan(bump);
    expect(preflight).toBeGreaterThan(rebuild);
  });

  it('is restored by a dry run', () => {
    const release = readFileSync(path.join(ROOT, 'scripts/release.mjs'), 'utf8');

    expect(release).toMatch(/git checkout -- [^\n]*packages\/server\/go\/internal\/jsruntime\/blok-server-runtime\.js/);
  });

  it('reports the package version under node:vm', async () => {
    const invoke = loadInvoke(readFileSync(GO_BUNDLE, 'utf8'));
    const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

    expect(await invoke('version', '{}')).toBe(version);
  });

  // The Go test reads the same fixture and runs it through goja.
  it('gives the smoke fixture outputs under node:vm', async () => {
    const invoke = loadInvoke(readFileSync(GO_BUNDLE, 'utf8'));
    const cases: unknown = JSON.parse(readFileSync(SMOKE_FIXTURE, 'utf8'));

    if (!Array.isArray(cases)) {
      throw new TypeError('bundle-smoke.json must be an array.');
    }

    expect(cases.length).toBeGreaterThan(0);
    for (const entry of cases) {
      if (!isObject(entry) || typeof entry.op !== 'string' || typeof entry.input !== 'string') {
        throw new TypeError('Each smoke case needs a string op and input.');
      }

      expect(await invoke(entry.op, entry.input), String(entry.name)).toBe(entry.output);
    }
  });

  /**
   * goja is quadratic on a failed sticky probe: `/a/y` over 40 000 chars took
   * 4.5 s where node takes 1 ms. The source-level law covers only the Markdown
   * engine and the HTML parser; this one covers everything the bundle pulls in.
   */
  it('has no sticky regex anywhere in the built bundle', () => {
    const { literals, sticky } = scanRegexes(readFileSync(fresh, 'utf8'));

    // A parse that found nothing would pass vacuously.
    expect(literals).toBeGreaterThan(300);
    expect(sticky).toStrictEqual([]);
  }, 30_000);

  it('flags every sticky spelling a minifier can emit, and nothing else', () => {
    const probe = [
      'var a=/x/gy,b=new RegExp("x","y"),c=RegExp("x","gy"),d=new globalThis.RegExp("x",f),',
      'e=/y/g,g=new RegExp("y","g"),h=RegExp("y"),i=new RegExp(/y/);',
    ].join('');

    expect(scanRegexes(probe)).toStrictEqual({
      literals: 3,
      sticky: ['/x/gy', 'new RegExp("x","y")', 'RegExp("x","gy")', 'new globalThis.RegExp("x",f)'],
    });
  });
});
