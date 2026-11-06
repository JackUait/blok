import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerRuntime } from './build-server-runtime.mjs';
import { runAndProbe } from './lib/server-probes.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPackageVersion = '0.0.0-task13';
const consumerVersion = 'package-fixture';

function parseArgs(args) {
  let packageDirectory;
  let packageVersion = defaultPackageVersion;
  let suppliedVersion = false;
  let packages = 'all';

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--package-dir') {
      const value = args[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error('--package-dir needs a value');
      }

      packageDirectory = resolve(repositoryRoot, value);
      index += 1;
      continue;
    }

    if (argument === '--version') {
      const value = args[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new Error('--version needs a value');
      }

      packageVersion = value;
      suppliedVersion = true;
      index += 1;
      continue;
    }

    if (argument === '--packages') {
      const value = args[index + 1];

      if (!['all', 'server', 'mcp'].includes(value)) {
        throw new Error('--packages takes all, server or mcp');
      }

      packages = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${argument}`);
  }

  if (packageDirectory !== undefined && !suppliedVersion) {
    throw new Error('--package-dir requires --version');
  }

  return { packageDirectory, packageVersion, packages };
}

const { packageDirectory, packageVersion, packages: selectedPackages } = parseArgs(process.argv.slice(2));
const packageProjects = {
  'Blok.Server': {
    description: 'Shared server services and embedded document runtime for Blok.',
    path: join(
      repositoryRoot,
      'packages/server/dotnet/Blok.Server/Blok.Server.csproj',
    ),
  },
  'Blok.Server.AspNetCore': {
    description: 'ASP.NET Core registration and endpoint mapping for Blok server services.',
    path: join(
      repositoryRoot,
      'packages/server/dotnet/Blok.Server.AspNetCore/Blok.Server.AspNetCore.csproj',
    ),
  },
};
const packageIds = Object.keys(packageProjects);
// Packed and checked beside the server packages; the consumer fixture does not use them.
const mcpProjects = {
  'Blok.Server.Mcp': {
    description: 'An MCP server for Blok documents, for ASP.NET Core apps.',
    path: join(repositoryRoot, 'packages/server/dotnet/Blok.Server.Mcp/Blok.Server.Mcp.csproj'),
  },
  'Blok.Mcp': {
    description: 'The Blok MCP server as a .NET tool: blok-mcp over stdio or HTTP.',
    path: join(repositoryRoot, 'packages/server/dotnet/Blok.Mcp/Blok.Mcp.csproj'),
  },
};
const mcpIds = Object.keys(mcpProjects);

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      ...options,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(
        `${command} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`,
      ));
    });
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function withTrailingSeparator(path) {
  return path.endsWith(sep) ? path : `${path}${sep}`;
}

function stripXmlComments(xml) {
  let cursor = 0;
  let result = '';

  while (cursor < xml.length) {
    const start = xml.indexOf('<!--', cursor);

    if (start < 0) {
      return result + xml.slice(cursor);
    }

    const end = xml.indexOf('-->', start + 4);

    if (end < 0) {
      return result + xml.slice(cursor);
    }

    result += xml.slice(cursor, start);
    cursor = end + 3;
  }

  return result;
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function xmlText(xml, elementName) {
  const match = xml.match(new RegExp(
    `<${elementName}\\b[^>]*>([\\s\\S]*?)</${elementName}>`,
  ));

  assert.notEqual(match, null, `Missing <${elementName}> in nuspec`);

  return decodeXml(match[1].trim());
}

function xmlTag(xml, elementName) {
  const match = xml.match(new RegExp(`<${elementName}\\b[^>]*>`));

  assert.notEqual(match, null, `Missing <${elementName}> in nuspec`);

  return match[0];
}

function xmlAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w.-]+)="([^"]*)"/g)]
      .map((match) => [match[1], decodeXml(match[2])]),
  );
}

// Needs Info-ZIP unzip on PATH (both callers run on ubuntu-latest).
function unzip(args) {
  return execFileSync('unzip', args, { maxBuffer: 512 * 1024 * 1024 });
}

function openPackedPackage(feed, packageId) {
  const packagePath = join(feed, `${packageId}.${packageVersion}.nupkg`);
  const names = unzip(['-Z1', packagePath]).toString('utf8').split('\n').filter(Boolean);
  // unzip -p reads a name as a wildcard pattern; these names hold no wildcards.
  const read = (name) => (names.includes(name) ? unzip(['-p', packagePath, name]) : undefined);
  const nuspecName = names.find((name) => !name.includes('/') && name.endsWith('.nuspec'));

  assert.notEqual(nuspecName, undefined, `${packageId} package has no nuspec`);

  const nuspec = read(nuspecName)?.toString('utf8');

  assert.notEqual(nuspec, undefined, `${packageId} nuspec could not be read`);
  assert.notEqual(read('README.md'), undefined, `${packageId} package is missing README.md`);

  return { nuspec, read };
}

async function readPackedPackage(feed, packageId) {
  const { nuspec, read } = openPackedPackage(feed, packageId);
  const dllPath = `lib/net10.0/${packageId}.dll`;
  const dll = read(dllPath);

  assert.notEqual(dll, undefined, `${packageId} package is missing ${dllPath}`);

  return { dll, nuspec };
}

function assertCommonMetadata(packageId, nuspec, description) {
  assert.equal(xmlText(nuspec, 'id'), packageId);
  assert.equal(xmlText(nuspec, 'version'), packageVersion);
  assert.equal(xmlText(nuspec, 'authors'), 'JackUait');
  assert.equal(xmlText(nuspec, 'description'), description);

  const license = xmlTag(nuspec, 'license');
  assert.equal(xmlAttributes(license).type, 'expression');
  assert.equal(xmlText(nuspec, 'license'), 'Apache-2.0');
  assert.equal(xmlText(nuspec, 'projectUrl'), 'https://blokeditor.com/');
  assert.equal(xmlText(nuspec, 'readme'), 'README.md');

  const repository = xmlAttributes(xmlTag(nuspec, 'repository'));
  assert.equal(repository.type, 'git');
  assert.equal(repository.url, 'https://github.com/JackUait/blok.git');
}

const blokDependenciesOf = (nuspec) => [...nuspec.matchAll(/<dependency\b[^>]*>/g)]
  .map((match) => xmlAttributes(match[0]))
  .filter((dependency) => dependency.id?.startsWith('Blok.'))
  .map(({ id, version }) => ({ id, version }));

function assertMcpPackages(feed) {
  const library = openPackedPackage(feed, 'Blok.Server.Mcp');

  assertCommonMetadata('Blok.Server.Mcp', library.nuspec, mcpProjects['Blok.Server.Mcp'].description);
  assert.notEqual(library.read('lib/net10.0/Blok.Server.Mcp.dll'), undefined, 'Blok.Server.Mcp package is missing its DLL');
  assert.deepEqual(blokDependenciesOf(library.nuspec), [{ id: 'Blok.Server.AspNetCore', version: packageVersion }]);

  const tool = openPackedPackage(feed, 'Blok.Mcp');

  assertCommonMetadata('Blok.Mcp', tool.nuspec, mcpProjects['Blok.Mcp'].description);
  assert.notEqual(tool.read('tools/net10.0/any/Blok.Mcp.dll'), undefined, 'Blok.Mcp package is missing tools/net10.0/any/Blok.Mcp.dll');
  assert.deepEqual(
    [...tool.nuspec.matchAll(/<packageType\b[^>]*>/g)].map((match) => xmlAttributes(match[0]).name),
    ['DotnetTool', 'McpServer'],
  );
  // A tool package carries its dependencies inside; it must declare none.
  assert.deepEqual(blokDependenciesOf(tool.nuspec), []);

  const serverJson = tool.read('.mcp/server.json');

  assert.notEqual(serverJson, undefined, 'Blok.Mcp package is missing .mcp/server.json');

  const server = JSON.parse(serverJson.toString('utf8'));

  assert.equal(server.version, packageVersion, '.mcp/server.json version is not the package version');
  assert.deepEqual(
    server.packages.map(({ identifier, version }) => ({ identifier, version })),
    [{ identifier: 'Blok.Mcp', version: packageVersion }],
  );
}

function assertPackageMetadata(packageId, nuspec) {
  assertCommonMetadata(packageId, nuspec, packageProjects[packageId].description);

  const targetFrameworks = [...nuspec.matchAll(/<group\b[^>]*>/g)]
    .map((match) => xmlAttributes(match[0]).targetFramework);
  assert.deepEqual(
    [...new Set(targetFrameworks)],
    ['net10.0'],
    `${packageId} must target only net10.0`,
  );

  const dependencies = [...nuspec.matchAll(/<dependency\b[^>]*>/g)]
    .map((match) => xmlAttributes(match[0]));
  const blokDependencies = dependencies
    .filter((dependency) => dependency.id?.startsWith('Blok.'));

  if (packageId === 'Blok.Server.AspNetCore') {
    assert.equal(blokDependencies.length, 1);
    assert.equal(blokDependencies[0].id, 'Blok.Server');
    assert.equal(blokDependencies[0].version, packageVersion);
  } else {
    assert.deepEqual(blokDependencies, []);
    // `exclude` is asserted, not just id and version: withholding Compile is
    // the entire point of Jint's and BouncyCastle's PrivateAssets, and
    // dropping it lets a consumer write `using Jint.Runtime;` against a
    // package they never declared. 1.13.0 shipped without it and this gate
    // saw nothing.
    assert.deepEqual(
      dependencies
        .map(({ id, version, exclude }) => ({ id, version, exclude }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      [
        { id: 'AngleSharp', version: '1.9.0', exclude: 'Build,Analyzers' },
        { id: 'BouncyCastle.Cryptography', version: '2.7.0', exclude: 'Compile,Build,Analyzers' },
        { id: 'Jint', version: '4.17.0', exclude: 'Compile,Build,Analyzers' },
      ],
      'Blok.Server must retain its exact direct package dependencies and asset exclusions',
    );
  }
}

function assertConsumerAssets(assets) {
  const target = assets.targets?.['net10.0'];

  assert.notEqual(target, undefined, 'Consumer assets are missing net10.0');

  const coreKey = `Blok.Server/${packageVersion}`;
  const aspNetCoreKey = `Blok.Server.AspNetCore/${packageVersion}`;
  assert.equal(target[coreKey]?.type, 'package');
  assert.equal(target[aspNetCoreKey]?.type, 'package');
  assert.equal(target[aspNetCoreKey]?.dependencies?.['Blok.Server'], packageVersion);

  const libraries = assets.libraries ?? {};
  assert.equal(libraries[coreKey]?.type, 'package');
  assert.equal(libraries[aspNetCoreKey]?.type, 'package');
  assert.deepEqual(
    Object.entries(libraries)
      .filter(([, library]) => library.type === 'project'),
    [],
    'Consumer restore must not contain project references',
  );

  const directDependencies =
    assets.project?.frameworks?.['net10.0']?.dependencies ?? {};
  assert.deepEqual(
    Object.keys(directDependencies)
      .filter((name) => name.startsWith('Blok.')),
    ['Blok.Server.AspNetCore'],
  );
}

function currentRuntimeIdentifier() {
  const identifiers = {
    'darwin-arm64': 'osx-arm64',
    'darwin-x64': 'osx-x64',
    'linux-arm64': 'linux-arm64',
    'linux-x64': 'linux-x64',
    'win32-arm64': 'win-arm64',
    'win32-x64': 'win-x64',
  };
  const key = `${process.platform}-${process.arch}`;
  const identifier = identifiers[key];

  assert.notEqual(identifier, undefined, `Unsupported current platform: ${key}`);

  return identifier;
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// The installed tool speaks MCP over stdio, so stdin at its end must stop it
// with code 0 ("stdio exits 0 when stdin closes" in the MCP conformance suite).
function expectStdioExit(command) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, [], { stdio: ['ignore', 'ignore', 'inherit'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} did not exit within 30s of stdin closing`));
    }, 30_000);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} exited with ${code === null ? `signal ${signal}` : `code ${code}`} when stdin closed`));
    });
  });
}

function feedConfig(feed) {
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="blok-local" value="${escapeXml(feed)}" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="blok-local">
      <package pattern="Blok.Server" />
      <package pattern="Blok.Server.AspNetCore" />
      <package pattern="Blok.Mcp" />
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="Jint" />
      <package pattern="Acornima" />
      <package pattern="AngleSharp" />
      <package pattern="BouncyCastle.Cryptography" />
    </packageSource>
  </packageSourceMapping>
</configuration>
`;
}

async function expectPackedFiles(feed, ids) {
  const feedFiles = (await readdir(feed)).filter((name) => name.endsWith('.nupkg'));

  for (const packageId of ids) {
    assert(feedFiles.includes(`${packageId}.${packageVersion}.nupkg`), `${packageId} ${packageVersion} is not in ${feed}`);
  }
  if (packageDirectory !== undefined) {
    // A release feed holds exactly the packages it ships.
    assert.deepEqual(feedFiles.sort(), [...packageIds, ...mcpIds]
      .map((packageId) => `${packageId}.${packageVersion}.nupkg`)
      .sort());
  }
}

// Packs (unless --package-dir), checks, installs and runs the MCP packages.
async function testMcpPackages(temporaryRoot) {
  const feed = packageDirectory ?? join(temporaryRoot, 'mcp-feed');
  const toolPath = join(temporaryRoot, 'tool');
  const nugetConfig = join(temporaryRoot, 'mcp-NuGet.Config');
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';

  for (const [packageId, project] of Object.entries(mcpProjects)) {
    const projectXml = stripXmlComments(await readFile(project.path, 'utf8'));

    assert.doesNotMatch(
      projectXml,
      /<(?:Version|PackageVersion)\b/,
      `${packageId} must not declare Version or PackageVersion`,
    );
  }

  if (packageDirectory === undefined) {
    await mkdir(feed, { recursive: true });
    for (const packageId of mcpIds) {
      await run('dotnet', [
        'pack',
        mcpProjects[packageId].path,
        '--configuration',
        'Release',
        `-p:PackageVersion=${packageVersion}`,
        '-p:ContinuousIntegrationBuild=true',
        '--output',
        feed,
      ]);
    }
  }

  await expectPackedFiles(feed, mcpIds);
  assertMcpPackages(feed);
  await writeFile(nugetConfig, feedConfig(feed));
  await run('dotnet', [
    'tool',
    'install',
    'Blok.Mcp',
    '--tool-path',
    toolPath,
    '--version',
    packageVersion,
    '--configfile',
    nugetConfig,
  ]);
  await expectStdioExit(join(toolPath, `blok-mcp${executableSuffix}`));
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'blok-server-packages-'));

  try {
    if (selectedPackages !== 'mcp') {
      await testServerPackages(temporaryRoot);
    }
    if (selectedPackages !== 'server') {
      await testMcpPackages(temporaryRoot);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function testServerPackages(temporaryRoot) {
  const feed = packageDirectory ?? join(temporaryRoot, 'feed');
  const expectedRuntimeDirectory = join(temporaryRoot, 'expected-runtime');
  const globalPackages = join(temporaryRoot, 'global-packages');
  const fixtureIntermediate = join(temporaryRoot, 'fixture-obj');
  const fixtureOutput = join(temporaryRoot, 'fixture-bin');
  const hostPublish = join(temporaryRoot, 'host-publish');
  const nugetConfig = join(temporaryRoot, 'NuGet.Config');
  const fixtureProject = join(
    repositoryRoot,
    'test/fixtures/dotnet-server-consumer/Blok.Server.Consumer.csproj',
  );
  const solution = join(
    repositoryRoot,
    'packages/server/dotnet/Blok.Server.slnx',
  );
  const hostProject = join(
    repositoryRoot,
    'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj',
  );

  for (const [packageId, project] of Object.entries(packageProjects)) {
    const projectXml = stripXmlComments(await readFile(project.path, 'utf8'));

    assert.doesNotMatch(
      projectXml,
      /<(?:Version|PackageVersion)\b/,
      `${packageId} must not declare Version or PackageVersion`,
    );
  }

  const hostProjectXml = stripXmlComments(await readFile(hostProject, 'utf8'));
  const hostPackableValues = [
    ...hostProjectXml.matchAll(
      /<IsPackable\b[^>]*>([\s\S]*?)<\/IsPackable>/g,
    ),
  ].map((match) => match[1].trim());

  assert.deepEqual(
    hostPackableValues,
    ['false'],
    'Blok.Server.Host must be explicitly non-packable',
  );

  if (packageDirectory === undefined) {
    await mkdir(feed, { recursive: true });
  }

  await mkdir(globalPackages, { recursive: true });

  const expectedRuntimePath = await buildServerRuntime(expectedRuntimeDirectory);
  const expectedRuntimeHash = sha256(await readFile(expectedRuntimePath));

  await run('dotnet', [
    'build',
    solution,
    '--configuration',
    'Release',
    `-p:PackageVersion=${packageVersion}`,
    '-p:ContinuousIntegrationBuild=true',
  ]);

  if (packageDirectory === undefined) {
    for (const packageId of packageIds) {
      await run('dotnet', [
        'pack',
        packageProjects[packageId].path,
        '--configuration',
        'Release',
        '--no-build',
        `-p:PackageVersion=${packageVersion}`,
        '-p:ContinuousIntegrationBuild=true',
        '--output',
        feed,
      ]);
    }
  }

  await expectPackedFiles(feed, packageIds);

  const packages = {};

  for (const packageId of packageIds) {
    const packedPackage = await readPackedPackage(feed, packageId);

    assertPackageMetadata(packageId, packedPackage.nuspec);
    packages[packageId] = packedPackage;
  }

  for (const packageId of packageIds) {
    const hostDll = await readFile(join(
      repositoryRoot,
      'packages/server/dotnet/Blok.Server.Host/bin/Release/net10.0',
      `${packageId}.dll`,
    ));

    assert(
      packages[packageId].dll.equals(hostDll),
      `${packageId} package and Host build DLLs differ`,
    );
  }

  await writeFile(nugetConfig, feedConfig(feed));

  const intermediateProperty =
    `-p:BaseIntermediateOutputPath=${withTrailingSeparator(fixtureIntermediate)}`;
  const outputProperty =
    `-p:BaseOutputPath=${withTrailingSeparator(fixtureOutput)}`;
  const packageVersionProperty =
    `-p:BlokServerPackageVersion=${packageVersion}`;

  await run('dotnet', [
    'restore',
    fixtureProject,
    '--configfile',
    nugetConfig,
    '--packages',
    globalPackages,
    '--no-cache',
    '--force-evaluate',
    intermediateProperty,
    outputProperty,
    packageVersionProperty,
  ]);

  const assets = JSON.parse(
    await readFile(join(fixtureIntermediate, 'project.assets.json'), 'utf8'),
  );

  assertConsumerAssets(assets);

  await run('dotnet', [
    'build',
    fixtureProject,
    '--configuration',
    'Release',
    '--no-restore',
    '-p:ContinuousIntegrationBuild=true',
    intermediateProperty,
    outputProperty,
    packageVersionProperty,
  ]);

  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const consumerExecutable = join(
    fixtureOutput,
    'Release/net10.0',
    `Blok.Server.Consumer${executableSuffix}`,
  );

  await runAndProbe(
    consumerExecutable,
    (port) => ['--urls', `http://127.0.0.1:${port}`],
    { BLOK_EXPECTED_RUNTIME_SHA256: expectedRuntimeHash },
    '/api/blok',
    consumerVersion,
    true,
  );

  await run('dotnet', [
    'publish',
    hostProject,
    '--configuration',
    'Release',
    '--runtime',
    currentRuntimeIdentifier(),
    '--self-contained',
    'true',
    `-p:PackageVersion=${packageVersion}`,
    '-p:ContinuousIntegrationBuild=true',
    '-p:PublishSingleFile=true',
    '--output',
    hostPublish,
  ]);

  const hostExecutable = join(
    hostPublish,
    `Blok.Server.Host${executableSuffix}`,
  );

  await runAndProbe(
    hostExecutable,
    (port) => [
      '--listen',
      `127.0.0.1:${port}`,
      '--storage-dir',
      '',
    ],
    {},
    '',
    'dev',
  );

}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
