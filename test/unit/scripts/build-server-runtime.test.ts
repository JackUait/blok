// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServerRuntime } from '../../../scripts/build-server-runtime.mjs';

describe('buildServerRuntime', () => {
  let outDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    outDir = mkdtempSync(join(tmpdir(), 'blok-server-runtime-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(outDir, { recursive: true, force: true });
  });

  it('builds one self-contained host script', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');

    expect(readdirSync(outDir)).toEqual(['blok-server-runtime.js']);
    expect(source).toContain('blokServerInvoke');
    expect(source).not.toMatch(/\bimport\s*\(/);
  });

  /**
   * The bundle is embedded in Blok.Server and executed by an engine that has
   * only the ECMAScript globals — no `atob`, no `Buffer`, no `TextDecoder`.
   * A dependency reaching for a host global fails at load, taking every
   * conversion with it, so the bundle is evaluated here in a realm with the
   * same nothing.
   */
  it('loads and converts in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;

    expect(typeof invoke).toBe('function');
    expect(await invoke('blocksToHtml', '{"blocks":[{"type":"paragraph","data":{"text":"Hi &amp; bye"}}]}'))
      .toBe('<p>Hi &amp; bye</p>');
  });

  /** The engine has no structuredClone; the hand clone must still keep an own `__proto__` key. */
  it('keeps a __proto__ key through injectTexts in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const output = await invoke(
      'injectTexts',
      '{"document":{"blocks":[{"type":"paragraph","data":{"text":"x","__proto__":{"keep":"me"}}}]},"texts":["y"]}'
    );

    expect(output).toContain('"data":{"text":"y","__proto__":{"keep":"me"}}');
  });

  /** The engine has no structuredClone; remap must still copy and keep an own `__proto__` key. */
  it('remaps a page document in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const output = await invoke(
      'remapPageDocument',
      '{"document":{"blocks":[{"id":"a","type":"page","data":{"pageId":"p","__proto__":{"keep":"me"}},"tunes":{"__proto__":{"t":1}}}]},'
      + '"blockIds":{"a":"A"},"pageIds":{"p":"P"}}'
    );

    expect(output).toBe('{"document":{"blocks":[{"id":"A","type":"page","data":{"pageId":"P","__proto__":{"keep":"me"}},"tunes":{"__proto__":{"t":1}}}]}}');
  });

  /** Own-key lookups and the unsafe-scheme strip must hold in the bare realm too. */
  it('renders page metadata from an envelope in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const html = await invoke(
      'blocksToHtmlWithPages',
      '{"document":{"blocks":[{"type":"paragraph","data":{"text":"<a data-blok-page-id=\\"__proto__\\">x</a> <a data-blok-page-id=\\"toString\\">x</a> <a data-blok-page-id=\\"js\\">x</a>"}}]},'
      + '"pages":{"__proto__":{"title":"Own","href":"/p/own"},"js":{"title":"Js","href":"javascript:alert(1)"}}}'
    );

    expect(html).toBe(
      '<p><a data-blok-page-id="__proto__" href="/p/own">Own</a> <a data-blok-page-id="toString">Page</a> <a data-blok-page-id="js">Js</a></p>'
    );
  });

  /**
   * The stored `version` of a document has to be the same string whichever side
   * wrote it, so the bundle reports the editor's own version rather than a
   * number a consumer invents. `VERSION` is a build-time define; without it
   * `getBlokVersion()` falls back to 'dev' and every server-written document is
   * stamped with a version the editor never writes.
   */
  it('reports the package version', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const expected = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')).version;

    expect(await invoke('version', '{}')).toBe(expected);
  });

  it('keeps the previous bundle available while rebuilding', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const previous = readFileSync(outputPath);
    let rebuilding = true;
    let changedBeforeCompletion = false;
    const rebuild = buildServerRuntime(outDir).finally(() => {
      rebuilding = false;
    });

    while (rebuilding) {
      if (!existsSync(outputPath) || !readFileSync(outputPath).equals(previous)) {
        changedBeforeCompletion = true;
        break;
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await rebuild;

    expect(changedBeforeCompletion).toBe(false);
  });
});
