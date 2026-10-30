// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServerRuntime, writeServerRuntimes } from '../../../scripts/build-server-runtime.mjs';
import { COMMANDS } from '../../../src/shared/agent/commands';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { readCustomToolsFile, snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { isObject } from '../../../src/shared/type-guards';
import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';

import type { BlokCustomToolsFile, HostService, ManifestOverrides } from '../../../types';
import type { AgentActor, AgentBatch, Edit } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { RichText } from '../../../types/rich-text';

const buildBareRuntime = async (directory: string): Promise<(operation: string, inputJson: string) => Promise<string>> => {
  const outputPath = await buildServerRuntime(directory);
  const sandbox: Record<string, unknown> = {};

  runInContext(readFileSync(outputPath, 'utf8'), createContext(sandbox));

  const invoke: unknown = sandbox.blokServerInvoke;

  if (typeof invoke !== 'function') {
    throw new TypeError('The server runtime did not expose blokServerInvoke.');
  }

  return async (operation, inputJson) => {
    const output: unknown = await invoke(operation, inputJson);

    if (typeof output !== 'string') {
      throw new TypeError('The server runtime did not return a string.');
    }

    return output;
  };
};

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
    // Only parse5's entity decoder needed atob; nothing in the runtime calls it now.
    expect(source).not.toContain('atob');
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

  it('executes a stored write batch and read in a realm with no host globals', async () => {
    const invoke = await buildBareRuntime(outDir);
    const text: RichText = [{ text: 'x', marks: { bold: true } }];
    const actor: AgentActor = { id: 'agent-jint', name: 'Server agent', kind: 'agent' };
    const document: OutputData = {
      blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }],
    };
    const batch: AgentBatch = { commands: [
      { name: 'text.format', args: { id: 'p', range: { find: 'x' }, set: { bold: true } } },
      { name: 'block.insert', args: { id: 'q', type: 'paragraph', data: { text: 'y' } } },
      { name: 'doc.read', args: { detail: 'full' } },
    ] };
    const result: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({ document, actor, batch })));
    const expectedEdits: Edit[] = [
      { op: 'setRichText', id: 'p', field: 'text', value: text },
      {
        op: 'insert', block: { id: 'q', type: 'paragraph', data: { text: [{ text: 'y' }] }, children: [] },
        parentId: null, afterId: 'p',
      },
    ];

    if (!isObject(result) || !isObject(result.document) || !Array.isArray(result.document.blocks)) {
      throw new TypeError('agentExecute must return a document with a blocks array.');
    }

    expect(result.edits).toEqual(expectedEdits);
    expect(result.result).toMatchObject({
      ok: true, revision: expect.stringMatching(/^h[0-9a-f]+$/),
      results: [{}, { id: 'q' }, { blocks: [{ id: 'p' }, { id: 'q' }] }],
    });
    expect(result.document.blocks).toMatchObject([
      { id: 'p', type: 'paragraph', data: { text }, lastEditedBy: actor.id },
      { id: 'q', type: 'paragraph', data: { text: [{ text: 'y' }] }, lastEditedBy: actor.id },
    ]);
    expect(readFileSync(join(outDir, 'blok-server-runtime.js'), 'utf8').length).toBeLessThan(4 * 1024 * 1024);
  });

  /** The server only parses math; KaTeX renders it and weighs ~300 KB in every Jint engine. */
  it('leaves KaTeX out and still parses math from markdown', async () => {
    const invoke = await buildBareRuntime(outDir);
    const source = readFileSync(join(outDir, 'blok-server-runtime.js'), 'utf8');
    const output: unknown = JSON.parse(await invoke('markdownToBlocks', JSON.stringify({ markdown: 'Area $a^2$\n\n$$\nE = mc^2\n$$\n' })));

    expect(source.match(/KaTeX parse error/g)).toBeNull();
    expect(output).toMatchObject({ blocks: [
      { type: 'paragraph', data: { text: [{ text: 'Area' }] } },
      { type: 'code', data: { code: 'a^2', language: 'latex' } },
      { type: 'code', data: { code: 'E = mc^2', language: 'latex' } },
    ] });
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

  /** HTML fields are parsed, and their references decoded, with no host global to lean on. */
  it('converts HTML fields to segments in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const output = await invoke(
      'htmlFieldsToSegments',
      '[{"id":"a","type":"paragraph","field":"text","html":"<b>a &lt; b</b>&nbsp;c"}]'
    );

    expect(output).toBe('[{"id":"a","type":"paragraph","field":"text","segments":[{"text":"a < b","marks":{"bold":true}},{"text":"\u00a0c"}]}]');
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

  /** Go embeds its own committed copy; the script keeps it equal to the C# one. */
  it('writes the same bundle for C# and for Go', async () => {
    const csharpDir = join(outDir, 'csharp');
    const goDir = join(outDir, 'go');
    const written = await writeServerRuntimes({ csharpDir, goDir });

    expect(written).toEqual([join(csharpDir, 'blok-server-runtime.js'), join(goDir, 'blok-server-runtime.js')]);
    expect(readFileSync(written[1]).equals(readFileSync(written[0]))).toBe(true);
    expect(readdirSync(goDir)).toEqual(['blok-server-runtime.js']);
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

  it('builds the real manifest and Jint contract in a realm with no host globals', async () => {
    const invoke = await buildBareRuntime(outDir);
    const result: unknown = JSON.parse(await invoke('manifest', '{}'));
    const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: await invoke('version', '{}') }));
    const contract = buildAgentContract(manifest, COMMANDS, { runtime: 'jint', services: [] });

    expect(result).toEqual({ manifest, contract });
    expect(result).toMatchObject({
      contract: {
        commands: expect.arrayContaining([
          expect.objectContaining({ name: 'history.undo', available: false, unavailableReason: 'runtime' }),
          expect.objectContaining({ name: 'history.redo', available: false, unavailableReason: 'runtime' }),
        ]),
      },
    });
  });

  it('adds a handlerless custom tool and hides an overridden built-in in the bare realm', async () => {
    const invoke = await buildBareRuntime(outDir);
    const customTools: BlokCustomToolsFile = {
      formatVersion: 1,
      blocks: [{
        name: 'quiz',
        statics: {
          toolbox: [],
          richTextFields: [],
          acceptsChildren: false,
          ownsChildren: false,
          isLayout: false,
          deletesChildren: false,
          selfPlacesChildren: false,
          restrictedInTableCell: false,
          conversion: {},
          convertible: { import: false, export: false },
          hasPrepareInsert: false,
        },
        description: {
          summary: 'A quiz.',
          data: { type: 'object' },
          actions: [{ name: 'grade', summary: 'Grade the quiz.', target: 'block', args: { type: 'object' } }],
        },
      }],
    };
    const overrides: ManifestOverrides = { spacer: { hidden: true } };
    const result: unknown = JSON.parse(await invoke('manifest', JSON.stringify({ customTools, overrides })));
    const snapshot = snapshotWithCustomTools(
      buildBuiltInSnapshot({ blokVersion: await invoke('version', '{}') }),
      readCustomToolsFile(customTools)
    );
    const manifest = buildToolManifest(snapshot, overrides);
    const contract = buildAgentContract(manifest, COMMANDS, { runtime: 'jint', services: [] });

    expect(result).toEqual({ manifest, contract });
    expect(result).toMatchObject({
      manifest: {
        blocks: expect.arrayContaining([
          expect.objectContaining({ name: 'quiz', level: 'described' }),
        ]),
      },
      contract: {
        commands: expect.arrayContaining([
          expect.objectContaining({ name: 'quiz.grade', available: false, unavailableReason: 'runtime' }),
        ]),
      },
    });
    expect(result).toMatchObject({
      manifest: { blocks: expect.not.arrayContaining([expect.objectContaining({ name: 'spacer' })]) },
      contract: { manifest: { blocks: expect.not.arrayContaining([expect.objectContaining({ name: 'spacer' })]) } },
    });
  });

  it('forwards supplied services to the real manifest and Jint contract in the bare realm', async () => {
    const invoke = await buildBareRuntime(outDir);
    const services: HostService[] = ['pageBackend', 'host', 'uploader', 'linkMetadata'];
    const result: unknown = JSON.parse(await invoke('manifest', JSON.stringify({ services })));
    const blokVersion = await invoke('version', '{}');
    const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion, services }));
    const contract = buildAgentContract(manifest, COMMANDS, { runtime: 'jint', services });
    const withoutServices = buildToolManifest(buildBuiltInSnapshot({ blokVersion }));
    const contractWithoutServices = buildAgentContract(withoutServices, COMMANDS, { runtime: 'jint', services: [] });

    expect(result).toEqual({ manifest, contract });
    expect(result).not.toMatchObject({ manifest: { revision: withoutServices.revision } });
    expect(result).not.toMatchObject({ contract: { revision: contractWithoutServices.revision } });
  });

  it('propagates the custom tools reader error for malformed input in the bare realm', async () => {
    const invoke = await buildBareRuntime(outDir);
    const customTools: unknown = { formatVersion: 1, blocks: [{ name: 'quiz' }] };
    let expectedError: TypeError | undefined;

    try {
      readCustomToolsFile(customTools);
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) {
        throw error;
      }

      expectedError = error;
    }

    if (expectedError === undefined) {
      throw new Error('Expected the custom tools reader to reject malformed input.');
    }

    await expect(invoke('manifest', JSON.stringify({ customTools }))).rejects.toMatchObject({
      name: expectedError.name,
      message: expectedError.message,
    });
  });

  it('stays within the checked-in size budget', async () => {
    const budgetPath = join(__dirname, 'server-runtime-size-budget.json');

    expect(existsSync(budgetPath), 'Create server-runtime-size-budget.json from a measured build').toBe(true);

    const budget: unknown = JSON.parse(readFileSync(budgetPath, 'utf8'));
    const maxBytes = isObject(budget) && typeof budget.maxBytes === 'number' ? budget.maxBytes : 0;
    const size = statSync(await buildServerRuntime(outDir)).size;

    // Every Jint engine parses this bundle at startup.
    expect(size, `bundle is ${size} bytes; budget ${maxBytes}. Raising it is a reviewed edit.`).toBeLessThanOrEqual(maxBytes);
  });
});
