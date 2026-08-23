# Embedded .NET Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that Blok's real DOM-free TypeScript can run inside a .NET 10 NuGet assembly through Jint, and leave the production runtime boundary, build artifact, tests, and CI wiring in place.

**Architecture:** A private TypeScript entry exposes one global async function, `blokServerInvoke(operation, inputJson)`, from a single IIFE with dynamic imports inlined. `Blok.Server` embeds that file as a resource and runs it through a bounded pool of pre-initialized Jint engines; consumers see neither JavaScript objects nor Jint types. The probe is accepted only if Markdown import (including math), HTML/plain-text rendering, concurrent calls, and cancellation recovery all pass.

**Tech Stack:** TypeScript, Vite/Rollup IIFE, Vitest, .NET 10, Jint 4.16.1, xUnit 2.9.3.

**Spec:** `docs/plans/2026-08-23-blok-dotnet-library-design.md`

## Global Constraints

- Work directly on the existing `main` branch. Do not create branches or worktrees.
- Follow TDD for every task: add a test, run it red, implement the smallest passing change, then refactor.
- `src/server-runtime` may import only DOM-free code. It must never import editor modules, tool classes, or DOM helpers.
- The host boundary is exactly `blokServerInvoke(operation: string, inputJson: string): Promise<string>`.
- Supported operations in this phase are `markdownToBlocks`, `blocksToHtml`, and `blocksToPlainText`.
- `markdownToBlocks` accepts `{"markdown":"..."}` and returns a serialized `OutputData` envelope: `{"blocks":[...]}`.
- `blocksToHtml` and `blocksToPlainText` accept a serialized `OutputData` envelope and return plain strings.
- Unknown operations and malformed inputs fail; they never return partial data.
- The generated bundle is an embedded implementation resource, not a public npm subpath and not a committed build product.
- The Jint pool size defaults to `max(1, min(Environment.ProcessorCount, 4))` and is configurable internally for tests.
- A cancelled invocation discards and recreates its engine before returning the slot to the pool.
- Run ESLint only on changed TypeScript/JavaScript files. Run only the new or directly affected test files during red/green cycles.
- Do not modify `vite.config.mjs`; the embedded bundle has its own programmatic build script.

## File structure

- `src/server-runtime/index.ts` — validates JSON inputs and exposes the three DOM-free operations through the single global boundary.
- `test/unit/server-runtime/index.test.ts` — pins the operation names, wire shapes, math support, and failures before bundling.
- `scripts/build-server-runtime.mjs` — creates one minified IIFE as a single IIFE (IIFE builds disable code splitting); accepts an output directory so tests do not write into the repository.
- `test/unit/scripts/build-server-runtime.test.ts` — proves the artifact is one file, contains the host global, and contains no runtime `import()`.
- `scripts/build-all.mjs` — adds the independent `server-runtime` build task.
- `test/unit/scripts/build-all.test.ts` — pins that task in production and test graphs.
- `packages/server/dotnet/Blok.Server/Blok.Server.csproj` — .NET 10 library, Jint dependency, embedded runtime resource, and build hook.
- `packages/server/dotnet/Blok.Server/Runtime/IBlokRuntime.cs` — internal JSON-string runtime contract.
- `packages/server/dotnet/Blok.Server/Runtime/JintBlokRuntime.cs` — bounded pre-initialized engine pool and cancellation recovery.
- `packages/server/dotnet/Blok.Server/Properties/AssemblyInfo.cs` — grants the test assembly access to internal runtime types.
- `packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj` — xUnit test project.
- `packages/server/dotnet/Blok.Server.Tests/Runtime/JintBlokRuntimeTests.cs` — cross-runtime fixture, concurrency, and cancellation tests.
- `.github/workflows/ci.yml` — keeps the Go reference suite and adds Node/.NET setup plus the runtime test project.
- `test/unit/architecture/server-release-wiring.test.ts` — pins both suites in CI during the migration.
- `.gitignore` — ignores generated .NET build directories and the generated embedded bundle.

---

### Task 1: Define the TypeScript runtime boundary

**Files:**
- Create: `src/server-runtime/index.ts`
- Create: `test/unit/server-runtime/index.test.ts`

**Interfaces:**
- Consumes: `markdownToBlocks(md: string): Promise<OutputBlockData[]>`, `blocksToHtml(data): string`, and `blocksToPlainText(data): string`.
- Produces: `invoke(operation: string, inputJson: string): Promise<string>` and global `blokServerInvoke` with the same signature.

- [ ] **Step 1: Write the failing boundary tests**

Create a Node-environment Vitest suite with `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`. Pin these cases:

```ts
expect(JSON.parse(await invoke('markdownToBlocks', '{"markdown":"# Hello"}')))
  .toMatchObject({ blocks: [{ type: 'header', data: { text: 'Hello', level: 1 } }] });

expect(JSON.parse(await invoke('markdownToBlocks', '{"markdown":"$$E = mc^2$$"}')))
  .toMatchObject({ blocks: [{ type: 'code', data: { code: 'E = mc^2', language: 'latex' } }] });

expect(await invoke('blocksToHtml', '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'))
  .toBe('<p>Hi <b>there</b></p>');

expect(await invoke('blocksToPlainText', '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'))
  .toBe('Hi there');

await expect(invoke('blocksToHtml', '{"wrong":[]}')).rejects.toThrow('`blocks` array');
await expect(invoke('unknown', '{}')).rejects.toThrow('Unsupported Blok runtime operation');
```

Also assert `globalThis.blokServerInvoke === invoke` and that `document`/`window` are undefined.

- [ ] **Step 2: Run the new suite and observe the red failure**

Run:

```bash
yarn vitest run --project=unit test/unit/server-runtime/index.test.ts
```

Expected: FAIL because `src/server-runtime/index.ts` does not exist.

- [ ] **Step 3: Implement the minimal boundary**

Implement strict parsers for the two accepted input shapes, switch on the three exact operation names, serialize Markdown blocks as `{ blocks }`, and attach the exported `invoke` function to `globalThis.blokServerInvoke`. Do not add a generic plugin registry or a public npm export.

- [ ] **Step 4: Run the new suite and changed-file lint**

Run:

```bash
yarn vitest run --project=unit test/unit/server-runtime/index.test.ts
npx eslint src/server-runtime/index.ts test/unit/server-runtime/index.test.ts --max-warnings=0
```

Expected: all boundary tests pass and ESLint exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/server-runtime/index.ts test/unit/server-runtime/index.test.ts
git commit -m "feat(server): define the embedded runtime boundary"
```

---

### Task 2: Build one self-contained runtime file

**Files:**
- Create: `scripts/build-server-runtime.mjs`
- Create: `test/unit/scripts/build-server-runtime.test.ts`
- Modify: `scripts/build-all.mjs`
- Modify: `test/unit/scripts/build-all.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `src/server-runtime/index.ts` and Vite's programmatic `build()`.
- Produces: `buildServerRuntime(outDir?: string): Promise<string>`, returning the absolute path to `blok-server-runtime.js`.

- [ ] **Step 1: Write the failing build tests**

The new build-script suite creates a temporary directory, calls `buildServerRuntime(tempDir)`, reads the returned file, and asserts:

```ts
expect(readdirSync(tempDir)).toEqual(['blok-server-runtime.js']);
expect(source).toContain('blokServerInvoke');
expect(source).not.toMatch(/\bimport\s*\(/);
```

Update the existing build graph suite to require this production task:

```ts
expect(tasks.get('server-runtime')?.cmd).toBe('node scripts/build-server-runtime.mjs');
expect(tasks.get('server-runtime')?.deps ?? []).toEqual([]);
```

Update the production/test task counts from 10/14 to 11/15.

- [ ] **Step 2: Run both affected suites and observe red failures**

Run:

```bash
yarn vitest run --project=unit test/unit/scripts/build-server-runtime.test.ts test/unit/scripts/build-all.test.ts
```

Expected: FAIL because the build script and graph task do not exist.

- [ ] **Step 3: Implement the programmatic IIFE build**

Use `vite.build({ configFile: false, ... })` with:

```js
build: {
  copyPublicDir: false,
  emptyOutDir: true,
  outDir,
  target: 'es2020',
  minify: 'esbuild',
  lib: {
    entry: resolve(root, 'src/server-runtime/index.ts'),
    name: 'BlokServerRuntimeBundle',
    formats: ['iife'],
    fileName: () => 'blok-server-runtime.js',
  },
  // IIFE output has code splitting disabled, so dynamic imports are inlined.
}
```

Export the function for tests and execute it only when the script is the main module. Add an independent `server-runtime` task to `buildTasks()`. Ignore:

```gitignore
packages/server/dotnet/**/bin/
packages/server/dotnet/**/obj/
packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js
```

- [ ] **Step 4: Run the affected suites, build once, and lint changed files**

Run:

```bash
yarn vitest run --project=unit test/unit/scripts/build-server-runtime.test.ts test/unit/scripts/build-all.test.ts
node scripts/build-server-runtime.mjs
npx eslint scripts/build-server-runtime.mjs scripts/build-all.mjs test/unit/scripts/build-server-runtime.test.ts test/unit/scripts/build-all.test.ts --max-warnings=0
```

Expected: both suites pass; the generated artifact is one file; ESLint exits 0.

- [ ] **Step 5: Commit**

```bash
git add .gitignore scripts/build-server-runtime.mjs scripts/build-all.mjs test/unit/scripts/build-server-runtime.test.ts test/unit/scripts/build-all.test.ts
git commit -m "build(server): create the embedded runtime bundle"
```

---

### Task 3: Run the bundle through a bounded Jint pool

**Files:**
- Create: `packages/server/dotnet/Blok.Server/Blok.Server.csproj`
- Create: `packages/server/dotnet/Blok.Server/Runtime/IBlokRuntime.cs`
- Create: `packages/server/dotnet/Blok.Server/Runtime/JintBlokRuntime.cs`
- Create: `packages/server/dotnet/Blok.Server/Properties/AssemblyInfo.cs`
- Create: `packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj`
- Create: `packages/server/dotnet/Blok.Server.Tests/Runtime/JintBlokRuntimeTests.cs`

**Interfaces:**
- Produces:

```csharp
internal interface IBlokRuntime
{
    ValueTask<string> InvokeAsync(
        string operation,
        string inputJson,
        CancellationToken cancellationToken = default);
}

internal sealed class JintBlokRuntime : IBlokRuntime
{
    internal static JintBlokRuntime FromEmbeddedResource(int? poolSize = null);
    internal JintBlokRuntime(string script, int poolSize);
    public ValueTask<string> InvokeAsync(
        string operation,
        string inputJson,
        CancellationToken cancellationToken = default);
}
```

- [ ] **Step 1: Create the test project and write failing runtime tests**

Use `net10.0`, Jint `4.16.1`, xUnit `2.9.3`, `Microsoft.NET.Test.Sdk` `18.8.0`, and `xunit.runner.visualstudio` `3.1.5`. Reference `Blok.Server` from the test project.

Tests must cover:

1. simple Markdown import;
2. math Markdown import;
3. HTML rendering;
4. plain-text rendering;
5. 64 mixed concurrent calls through a pool of four, with every result checked and a 30-second test timeout;
6. a cancelled never-settling Promise, followed by a successful call through the same one-slot runtime, proving that cancellation replaces and returns the slot.

For the cancellation test, construct the runtime with:

```js
globalThis.blokServerInvoke = async (operation) => {
  if (operation === 'wait') return await new Promise(() => {});
  return 'ok';
};
```

- [ ] **Step 2: Run the test project and observe the red compile failure**

Run:

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj
```

Expected: FAIL because `IBlokRuntime` and `JintBlokRuntime` do not exist.

- [ ] **Step 3: Implement the runtime and embedded-resource build hook**

The library project targets `net10.0`, references Jint `4.16.1`, embeds
`Generated/blok-server-runtime.js` with logical name `Blok.Server.Runtime.blok-server-runtime.js`,
and runs `node ../../../../scripts/build-server-runtime.mjs` before resource preparation.

`JintBlokRuntime` reads the embedded resource once, creates the requested number of
engines up front, and owns a bounded `Channel<Engine>`. Each call rents one engine,
uses `Engine.InvokeAsync("blokServerInvoke", cancellationToken, operation, inputJson)`,
and returns the string result. On `OperationCanceledException`, it creates a fresh engine
from the same script before returning the slot. The default pool size is
`Math.Max(1, Math.Min(Environment.ProcessorCount, 4))`.

Do not expose Jint in a public signature and do not add ASP.NET yet.

- [ ] **Step 4: Run the runtime tests and build the package**

Run:

```bash
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj
dotnet build packages/server/dotnet/Blok.Server/Blok.Server.csproj --no-restore
```

Expected: six tests pass and the library build exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/dotnet
git commit -m "feat(server): execute Blok through Jint"
```

---

### Task 4: Put the runtime proof in CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `test/unit/architecture/server-release-wiring.test.ts`
- Modify: `docs/plans/2026-08-23-blok-dotnet-library-design.md`

**Interfaces:**
- Consumes: `scripts/build-server-runtime.mjs` and `Blok.Server.Tests.csproj`.
- Produces: a `server` CI job that runs both the frozen Go reference suite and the new .NET runtime suite.

- [ ] **Step 1: Extend the architecture law first**

Keep the existing Go assertion and add exact assertions that the `server` job contains:

```text
actions/setup-dotnet@v4
./.github/actions/setup-node-deps
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj
```

- [ ] **Step 2: Run the architecture test and observe the red failure**

Run:

```bash
yarn vitest run --project=unit test/unit/architecture/server-release-wiring.test.ts
```

Expected: FAIL because CI does not set up .NET or run the project.

- [ ] **Step 3: Update the server CI job**

Keep `actions/setup-go@v5` and `go vet ./... && go test ./...`. Add the repository's Node setup action because the .NET build hook bundles TypeScript, add `actions/setup-dotnet@v4` with `dotnet-version: '10.0.x'`, and run the exact .NET test command from the repository root.

Update the design status with the concrete result: Jint `4.16.1` accepted if all Task 3 tests pass; otherwise record the failed gate and use ClearScript in the next plan. Do not claim acceptance before the tests pass.

- [ ] **Step 4: Run all directly affected verification**

Run:

```bash
yarn vitest run --project=unit \
  test/unit/server-runtime/index.test.ts \
  test/unit/scripts/build-server-runtime.test.ts \
  test/unit/scripts/build-all.test.ts \
  test/unit/architecture/server-release-wiring.test.ts
dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj
npx eslint \
  src/server-runtime/index.ts \
  scripts/build-server-runtime.mjs \
  scripts/build-all.mjs \
  test/unit/server-runtime/index.test.ts \
  test/unit/scripts/build-server-runtime.test.ts \
  test/unit/scripts/build-all.test.ts \
  test/unit/architecture/server-release-wiring.test.ts \
  --max-warnings=0
git diff --check
```

Expected: all affected tests pass, ESLint exits 0, and the diff is clean.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml test/unit/architecture/server-release-wiring.test.ts docs/plans/2026-08-23-blok-dotnet-library-design.md
git commit -m "ci(server): verify the embedded .NET runtime"
```

---

## Completion gate

Before declaring this sub-project complete:

1. Run the full unit suite because the root build graph changed:

   ```bash
   yarn test
   ```

2. Re-run the .NET test project and Go reference suite:

   ```bash
   dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj
   (cd packages/server && go vet ./... && go test ./...)
   ```

3. Run `git pull --rebase`, push `main`, and confirm `git status -sb` reports
   `main...origin/main` with no worktree changes.
