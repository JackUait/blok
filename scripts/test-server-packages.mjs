import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPackageVersion = '0.0.0-task13';
const consumerVersion = 'package-fixture';

function parseArgs(args) {
  let packageDirectory;
  let packageVersion = defaultPackageVersion;
  let suppliedVersion = false;

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

    throw new Error(`unknown argument: ${argument}`);
  }

  if (packageDirectory !== undefined && !suppliedVersion) {
    throw new Error('--package-dir requires --version');
  }

  return { packageDirectory, packageVersion };
}

const { packageDirectory, packageVersion } = parseArgs(process.argv.slice(2));
const packageProjects = {
  'Blok.Server': {
    description: 'Shared server services for Blok.',
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

async function readPackedPackage(feed, packageId) {
  const packagePath = join(feed, `${packageId}.${packageVersion}.nupkg`);
  const archive = await JSZip.loadAsync(await readFile(packagePath));
  const nuspecName = Object.keys(archive.files)
    .find((name) => !name.includes('/') && name.endsWith('.nuspec'));

  assert.notEqual(nuspecName, undefined, `${packageId} package has no nuspec`);

  const nuspec = await archive.file(nuspecName)?.async('string');

  assert.notEqual(nuspec, undefined, `${packageId} nuspec could not be read`);

  const dllPath = `lib/net10.0/${packageId}.dll`;
  const dll = await archive.file(dllPath)?.async('nodebuffer');
  const readme = await archive.file('README.md')?.async('string');

  assert.notEqual(dll, undefined, `${packageId} package is missing ${dllPath}`);
  assert.notEqual(readme, undefined, `${packageId} package is missing README.md`);

  return { dll, nuspec };
}

function assertPackageMetadata(packageId, nuspec) {
  assert.equal(xmlText(nuspec, 'id'), packageId);
  assert.equal(xmlText(nuspec, 'version'), packageVersion);
  assert.equal(xmlText(nuspec, 'authors'), 'JackUait');
  assert.equal(
    xmlText(nuspec, 'description'),
    packageProjects[packageId].description,
  );

  const license = xmlTag(nuspec, 'license');
  assert.equal(xmlAttributes(license).type, 'expression');
  assert.equal(xmlText(nuspec, 'license'), 'Apache-2.0');
  assert.equal(xmlText(nuspec, 'projectUrl'), 'https://blokeditor.com/');
  assert.equal(xmlText(nuspec, 'readme'), 'README.md');

  const repository = xmlAttributes(xmlTag(nuspec, 'repository'));
  assert.equal(repository.type, 'git');
  assert.equal(repository.url, 'https://github.com/JackUait/blok.git');

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
    assert.deepEqual(
      dependencies
        .map(({ id, version }) => ({ id, version }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      [
        { id: 'AngleSharp', version: '1.7.2' },
        { id: 'BouncyCastle.Cryptography', version: '2.7.0' },
      ],
      'Blok.Server must retain its exact direct package dependencies',
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

function sendRequest(method, url, headers = {}) {
  return new Promise((resolveRequest, reject) => {
    const outgoing = request(url, {
      headers,
      method,
      timeout: 5_000,
    }, (incoming) => {
      const chunks = [];

      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.once('error', reject);
      incoming.once('end', () => {
        resolveRequest({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: incoming.headers,
          status: incoming.statusCode,
        });
      });
    });

    outgoing.once('timeout', () => {
      outgoing.destroy(new Error(`${method} ${url} timed out`));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

function assertResponse(actual, expected, label) {
  assert.equal(actual.status, expected.status, `${label} status`);
  assert.equal(actual.body, expected.body, `${label} body`);

  for (const [name, value] of Object.entries(expected.headers)) {
    assert.equal(actual.headers[name], value, `${label} ${name}`);
  }
}

async function probeEndpoints(
  baseUrl,
  prefix,
  expectedVersion,
  applicationAuthorization = false,
) {
  const endpoint = (path) => new URL(`${prefix}${path}`, baseUrl);

  assertResponse(
    await sendRequest('GET', endpoint('/health')),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: `{"status":"ok","version":"${expectedVersion}"}\n`,
    },
    'GET /health',
  );
  assertResponse(
    await sendRequest('HEAD', endpoint('/health')),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '',
    },
    'HEAD /health',
  );
  assertResponse(
    await sendRequest('POST', endpoint('/health')),
    {
      status: 405,
      headers: {
        allow: 'GET, HEAD',
        'content-type': 'text/plain; charset=utf-8',
      },
      body: 'Method Not Allowed\n',
    },
    'POST /health',
  );
  if (applicationAuthorization) {
    const anonymous = await sendRequest('GET', endpoint('/unfurl'));

    assert.equal(anonymous.status, 401, 'anonymous GET /unfurl status');
    assertResponse(
      await sendRequest('GET', endpoint('/unfurl'), {
        'X-Test-User': 'signed-in',
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: '{"success":0}\n',
      },
      'authenticated GET /unfurl',
    );
    assertResponse(
      await sendRequest('OPTIONS', endpoint('/unfurl'), {
        'Access-Control-Request-Method': 'GET',
        Origin: 'https://app.example.test',
      }),
      {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-origin': 'https://app.example.test',
        },
        body: '',
      },
      'anonymous OPTIONS /unfurl',
    );
  } else {
    assertResponse(
      await sendRequest('GET', endpoint('/unfurl')),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: '{"success":0}\n',
      },
      'GET /unfurl',
    );
  }
  assertResponse(
    await sendRequest(
      'POST',
      endpoint('/upload'),
      applicationAuthorization ? { 'X-Test-User': 'signed-in' } : {},
    ),
    {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: '404 page not found\n',
    },
    'POST /upload',
  );
  assertResponse(
    await sendRequest(
      'GET',
      endpoint('/missing'),
      applicationAuthorization ? { 'X-Test-User': 'signed-in' } : {},
    ),
    {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: '404 page not found\n',
    },
    'GET /missing',
  );
}

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error;
  let standardError = '';
  let standardOutput = '';

  child.once('error', (spawnError) => {
    error = spawnError;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    standardError += chunk;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    standardOutput += chunk;
  });

  return {
    child,
    error: () => error,
    output: () => `${standardOutput}${standardError}`,
  };
}

async function waitForServer(running, healthUrl) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    if (running.error() !== undefined) {
      throw running.error();
    }

    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      throw new Error(
        `Server exited before becoming healthy: ${running.output()}`,
      );
    }

    try {
      const response = await sendRequest('GET', healthUrl);

      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(
    `Server did not become healthy: ${lastError instanceof Error ? lastError.message : lastError ?? ''}\n` +
    running.output(),
  );
}

async function stopProcess(running) {
  if (running.child.exitCode !== null || running.child.signalCode !== null) {
    return;
  }

  const closed = once(running.child, 'close');
  running.child.kill();

  const activeTimeoutCount = () => process.getActiveResourcesInfo()
    .filter((resource) => resource === 'Timeout')
    .length;
  const timeoutCountBefore = activeTimeoutCount();
  let fallbackTimer;
  const timeout = new Promise((resolveTimeout) => {
    fallbackTimer = setTimeout(resolveTimeout, 5_000);
  });
  let result;

  try {
    result = await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(fallbackTimer);
  }

  if (result !== undefined) {
    assert.equal(
      activeTimeoutCount(),
      timeoutCountBefore,
      'The server shutdown fallback timer must not keep Node alive',
    );
  }

  if (result === undefined &&
      running.child.exitCode === null &&
      running.child.signalCode === null) {
    running.child.kill('SIGKILL');
    await once(running.child, 'close');
  }
}

async function allocatePort() {
  const { createServer } = await import('node:net');
  const server = createServer();

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });

  const address = server.address();

  assert.notEqual(address, null, 'Could not allocate a server port');
  assert.equal(typeof address, 'object');

  const port = address.port;

  await new Promise((resolveClose, reject) => {
    server.close((error) => error === undefined ? resolveClose() : reject(error));
  });

  return port;
}

async function runAndProbe(
  executable,
  args,
  environment,
  prefix,
  expectedVersion,
  applicationAuthorization = false,
) {
  const port = await allocatePort();
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  const running = startProcess(
    executable,
    args(port),
    { env: { ...process.env, ...environment } },
  );

  try {
    await waitForServer(
      running,
      new URL(`${prefix}/health`, baseUrl),
    );
    await probeEndpoints(
      baseUrl,
      prefix,
      expectedVersion,
      applicationAuthorization,
    );
  } finally {
    await stopProcess(running);
  }
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

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'blok-server-packages-'));
  const feed = packageDirectory ?? join(temporaryRoot, 'feed');
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

  try {
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

    const feedFiles = (await readdir(feed))
      .filter((name) => name.endsWith('.nupkg'))
      .sort();
    assert.deepEqual(feedFiles, packageIds
      .map((packageId) => `${packageId}.${packageVersion}.nupkg`)
      .sort());

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

    await writeFile(nugetConfig, `<?xml version="1.0" encoding="utf-8"?>
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
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="AngleSharp" />
      <package pattern="BouncyCastle.Cryptography" />
    </packageSource>
  </packageSourceMapping>
</configuration>
`);

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
      {},
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
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
