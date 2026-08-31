import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(__dirname, '../../..');

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf-8');

const readJson = <T>(path: string): T => JSON.parse(read(path)) as T;

const SERVER_NPM_NAME = '@bloklabs/server';
const SERVER_GPR_NAME = '@dodopizza/blok-server';
const SERVER_MANIFEST = 'packages/server/package.json';
const RELEASE_WORKFLOW = '.github/workflows/release-server.yml';
const SETUP_NODE_ACTION = '.github/actions/setup-node-deps/action.yml';
const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_DOTNET_ACTION = 'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9';
const LOGIN_ACTION = 'docker/login-action@dbcb813823bdd20940b903addbd779551569679f';
const SETUP_NODE_ACTION_SHA = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const SERVER_ARCHIVES = [
  'blok-server_darwin_amd64.tar.gz',
  'blok-server_darwin_arm64.tar.gz',
  'blok-server_linux_amd64.tar.gz',
  'blok-server_linux_arm64.tar.gz',
  'blok-server_linux_musl_amd64.tar.gz',
  'blok-server_linux_musl_arm64.tar.gz',
  'blok-server_windows_amd64.zip',
  'blok-server_windows_arm64.zip',
];

type FamilyEntry = {
  npmName: string;
  gprName: string;
  manifestPath: string;
  packDir: string;
};

type WorkflowStep = {
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, boolean | string | number>;
};

type CompositeAction = {
  inputs?: Record<string, { default?: string }>;
  runs?: { steps?: WorkflowStep[] };
};

type Workflow = {
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  on?: { push?: { tags?: string[] } };
  jobs: Record<string, {
    if?: string;
    permissions?: Record<string, string>;
    steps?: WorkflowStep[];
  }>;
};

const loadFamily = async (): Promise<FamilyEntry[]> => {
  const { FAMILY } = (await import('../../../scripts/release-manifest.mjs')) as {
    FAMILY: FamilyEntry[];
  };

  return FAMILY;
};

const extractArrayLiteral = (source: string, constName: string): string => {
  const start = source.indexOf(`${constName} = [`);

  expect(start, `${constName} is not declared as an array literal`).toBeGreaterThan(-1);

  const end = source.indexOf('];', start);

  expect(end, `${constName} has no closing bracket`).toBeGreaterThan(start);

  return source.slice(start, end);
};

describe('server release wiring', () => {
  it('stamps and publishes the npm wrapper through every explicit family list', async () => {
    const manifests = extractArrayLiteral(read('scripts/release.mjs'), 'WORKSPACE_MANIFESTS');

    expect(manifests).toContain(`'${SERVER_MANIFEST}'`);

    const family = await loadFamily();
    const entry = family.find((item) => item.npmName === SERVER_NPM_NAME);

    expect(entry).toEqual({
      npmName: SERVER_NPM_NAME,
      gprName: SERVER_GPR_NAME,
      manifestPath: SERVER_MANIFEST,
      packDir: 'packages/server',
    });

    const metadataLaw = read('test/unit/architecture/package-metadata-law.test.ts');
    const mirrorTest = read('test/unit/scripts/release-manifest.test.ts');
    const docsVerifier = read('scripts/verify-docs-release.mjs');

    expect(metadataLaw).toContain(`name: '${SERVER_NPM_NAME}'`);
    expect(mirrorTest).toContain(`'${SERVER_NPM_NAME}'`);
    expect(docsVerifier).toContain(`name: '${SERVER_NPM_NAME}'`);
  });

  /**
   * The package shipped only `bin/` until the ticket signer landed, and the law
   * here used to pin that. Now that it publishes JavaScript, the invariant is
   * the opposite one: everything `exports` points at has to be produced by a
   * build the release actually runs. `release.mjs` runs `build-all.mjs` before
   * packing, so a package that ships `dist` and is missing from that graph
   * publishes an exports map aimed at files nobody built.
   */
  it('builds every JavaScript file it ships', async () => {
    const { buildTasks } = (await import('../../../scripts/build-all.mjs')) as {
      buildTasks: (opts?: { mode?: string; withCli?: boolean }) => { name: string }[];
    };
    const tasks = new Set(buildTasks({ withCli: true }).map((task) => task.name));
    const manifest = readJson<{
      scripts?: Record<string, string>;
      files?: string[];
      exports?: Record<string, Record<string, string> | string>;
    }>(SERVER_MANIFEST);

    expect(manifest.files).toContain('dist');
    expect(manifest.scripts?.build).toBeTypeOf('string');
    expect(tasks.has('server')).toBe(true);

    const targets = Object.values(manifest.exports ?? {})
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry)))
      .filter((target) => target.startsWith('./dist/'));

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(
        manifest.files?.some((included) => target.startsWith(`./${included}/`)),
        `${target} is not covered by "files"`
      ).toBe(true);
    }
  });

  // The signer must agree with the C# verifier, and the only thing that proves
  // it is the fixture both read. Its suite has to run in CI for that to count.
  it('runs the ticket signer suite in CI', () => {
    const workflow = parse(read('.github/workflows/ci.yml')) as Workflow;
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);

    expect(steps.some((step) => step.run === `yarn workspace ${SERVER_NPM_NAME} test`)).toBe(true);
  });

  it('does not ship an unused generated JavaScript runtime', () => {
    expect(existsSync(join(
      repoRoot,
      'packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js',
    ))).toBe(false);
  });

  it('keeps the server package on the family version', () => {
    const root = readJson<{ version: string }>('package.json');
    const server = readJson<{ version: string }>(SERVER_MANIFEST);

    expect(server.version).toBe(root.version);
  });

  it('keeps Node and C# verification together in final CI', () => {
    const workflow = parse(read('.github/workflows/ci.yml')) as Workflow;
    const steps = workflow.jobs.server?.steps ?? [];
    const actions = steps.map((step) => step.uses ?? '').join('\n');
    const runs = steps.map((step) => step.run ?? '').join('\n');

    expect(actions).toContain('./.github/actions/setup-node-deps');
    expect(actions).toContain(SETUP_DOTNET_ACTION);
    expect(runs).toContain(
      'dotnet test packages/server/dotnet/Blok.Server.slnx',
    );
    expect(runs).toContain('--collect:"Code Coverage;Format=Cobertura"');
    expect(runs).toContain('node scripts/check-server-coverage.mjs');
    expect(runs).toContain(
      'dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes',
    );
    expect(runs).toContain('node scripts/test-server-packages.mjs');
    expect(runs).toContain('node scripts/test-server-conformance.mjs --target csharp');
    expect(runs).toContain('node scripts/publish-server.mjs --version 1.10.1 --dry-run');
    expect(runs).toContain('test/unit/architecture/server-release-wiring.test.ts');
  });

  // The runner is the only thing that builds the binaries the gated conformance
  // suites drive; a suite missing from its vitest arguments is never run anywhere.
  it('runs both conformance suites through the runner CI invokes', () => {
    const runner = read('scripts/test-server-conformance.mjs');

    for (const suite of [
      'test/unit/server-conformance/server-contract.test.ts',
      'test/unit/server-conformance/sync-contract.test.ts',
    ]) {
      expect(runner).toContain(`'${suite}'`);
    }
  });

  it('lets release jobs skip the separate docs dependency install', () => {
    const action = parse(read(SETUP_NODE_ACTION)) as CompositeAction;
    const docsInstall = action.runs?.steps?.find(
      (step) => step.name === 'Install docs dependencies',
    );

    expect(action.inputs?.['install-docs']?.default).toBe('true');
    expect(docsInstall?.if).toBe("inputs.install-docs == 'true'");
  });

  it('pins external actions used by the server release', () => {
    const release = read(RELEASE_WORKFLOW);
    const setup = read(SETUP_NODE_ACTION);

    expect(release).toContain(`uses: ${CHECKOUT_ACTION}`);
    expect(release).toContain(`uses: ${SETUP_DOTNET_ACTION}`);
    expect(release).toContain(`uses: ${LOGIN_ACTION}`);
    expect(setup).toContain(`uses: ${SETUP_NODE_ACTION_SHA}`);
  });

  it('validates the family version before publishing or tagging', () => {
    const releaseScript = read('scripts/release.mjs');

    expect(releaseScript).toContain(
      "import { isReleaseVersion } from './release-version.mjs';",
    );
    expect(releaseScript.indexOf('if (!isReleaseVersion(version))')).toBeLessThan(
      releaseScript.indexOf('npm whoami'),
    );
  });

  it('creates the family release as a draft before the server workflow runs', () => {
    const releaseScript = read('scripts/release.mjs');

    expect(releaseScript).toMatch(/gh release create \$\{gitTag\}[^\n]* --draft/);
  });

  it('publishes two NuGets, eight hosts, checksums, and a multi-architecture image before the draft', () => {
    expect(existsSync(join(repoRoot, RELEASE_WORKFLOW))).toBe(true);

    const source = read(RELEASE_WORKFLOW);
    const workflow = parse(source) as Workflow;

    expect(workflow.on?.push?.tags).toContain('v*');
    expect(workflow.concurrency).toEqual({
      group: 'release-server',
      'cancel-in-progress': false,
    });

    const job = workflow.jobs['release-server'];

    expect(job).toBeDefined();
    expect(job?.if).toContain('github.repository');
    expect(job?.permissions).toMatchObject({ contents: 'write', packages: 'write' });

    const steps = job?.steps ?? [];
    const actions = steps.map((step) => step.uses ?? '').join('\n');
    const runs = steps.map((step) => step.run ?? '').join('\n');

    expect(actions).toContain(CHECKOUT_ACTION);
    expect(steps.find((step) => step.uses === CHECKOUT_ACTION)?.with)
      .toMatchObject({
        'fetch-depth': 0,
        'persist-credentials': false,
      });
    expect(actions).toContain('./.github/actions/setup-node-deps');
    expect(steps.find((step) => step.uses === './.github/actions/setup-node-deps')?.with)
      .toMatchObject({ 'install-docs': false });
    expect(actions).toContain(SETUP_DOTNET_ACTION);
    expect(actions).toContain(LOGIN_ACTION);
    expect(source.match(/version="\$\{GITHUB_REF_NAME#v\}"/g)).toHaveLength(1);
    expect(runs).toContain(
      'dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release',
    );
    expect(runs).toContain(
      'dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes',
    );
    expect(runs).toContain(
      'yarn test test/unit/server-conformance/server-contract.test.ts',
    );

    for (const project of [
      'packages/server/dotnet/Blok.Server/Blok.Server.csproj',
      'packages/server/dotnet/Blok.Server.AspNetCore/Blok.Server.AspNetCore.csproj',
    ]) {
      expect(runs).toContain(`dotnet pack ${project}`);
    }

    expect(runs).toContain('-p:PackageVersion="$BLOK_SERVER_VERSION"');
    expect(runs).toContain('--output .server-release-dist/nuget');
    expect(runs).toContain(
      'node scripts/test-server-packages.mjs --package-dir .server-release-dist/nuget --version "$BLOK_SERVER_VERSION"',
    );
    expect(runs).toContain(
      'node scripts/publish-server.mjs --version "$BLOK_SERVER_VERSION" --output .server-release-dist',
    );

    for (const archive of SERVER_ARCHIVES) {
      expect(runs).toContain(archive);
    }

    expect(runs).toContain('checksums.txt');
    expect(runs).toContain('Blok.Server."$BLOK_SERVER_VERSION".nupkg');
    expect(runs).toContain('Blok.Server.AspNetCore."$BLOK_SERVER_VERSION".nupkg');
    expect(runs).toContain('dotnet nuget push');
    expect(source).toContain('NUGET_API_KEY: ${{ secrets.NUGET_API_KEY }}');
    expect(source).not.toContain('BLOK_NUGET');

    expect(runs).toContain(
      'docker build --platform linux/amd64 -f packages/server/Dockerfile',
    );
    expect(runs).toContain('--build-arg BLOK_SERVER_VERSION="$BLOK_SERVER_VERSION"');
    expect(runs).toContain('image="ghcr.io/jackuait/blok-server"');
    expect(runs).toContain('--tag "$image:$BLOK_SERVER_VERSION"');
    expect(runs).toContain('--network host');
    expect(runs).toContain('--listen 127.0.0.1:4000');
    expect(runs).toContain('--auth proxy');
    expect(runs).toContain('docker buildx build');
    expect(runs).toContain('--platform linux/amd64,linux/arm64');
    expect(runs).toContain('--push');
    expect(runs).not.toContain('docker push "$image:$BLOK_SERVER_VERSION"');

    const deliveryVerification = steps.find(
      (step) => step.name === 'Verify published server delivery',
    )?.run;

    expect(deliveryVerification).toMatch(
      /anonymous_docker_config="\$\(mktemp -d\)"[\s\S]*DOCKER_CONFIG="\$anonymous_docker_config" docker manifest inspect/,
    );
    expect(deliveryVerification).toContain('"architecture": "amd64"');
    expect(deliveryVerification).toContain('"architecture": "arm64"');

    expect(runs).toContain('gh release upload "$GITHUB_REF_NAME"');
    expect(runs).toContain('gh release edit "$GITHUB_REF_NAME" --draft=false');

    const nugetPush = source.indexOf('dotnet nuget push');
    const assetUpload = source.indexOf('gh release upload "$GITHUB_REF_NAME"');
    const imagePush = source.indexOf('docker buildx build');
    const observable = source.indexOf('Verify published server delivery');
    const publishDraft = source.indexOf('gh release edit "$GITHUB_REF_NAME" --draft=false');

    expect(nugetPush).toBeGreaterThan(-1);
    expect(assetUpload).toBeGreaterThan(nugetPush);
    expect(imagePush).toBeGreaterThan(assetUpload);
    expect(observable).toBeGreaterThan(imagePush);
    expect(publishDraft).toBeGreaterThan(observable);
  });

  it('holds GHCR credentials only for the image push', () => {
    const workflow = parse(read(RELEASE_WORKFLOW)) as Workflow;
    const steps = workflow.jobs['release-server']?.steps ?? [];
    const loginIndex = steps.findIndex(
      (step) => step.uses === LOGIN_ACTION,
    );
    const pushIndex = steps.findIndex((step) => step.name === 'Push multi-architecture image');
    const logoutIndex = steps.findIndex((step) => step.name === 'Log out of GHCR');
    const logout = steps[logoutIndex];

    expect(loginIndex).toBe(pushIndex - 1);
    expect(logoutIndex).toBe(pushIndex + 1);
    expect(logout?.if).toBe('always()');
    expect(logout?.run).toContain('docker logout ghcr.io');
  });

  it('dispatches tagged docs deployment after publishing the release', () => {
    const workflow = parse(read(RELEASE_WORKFLOW)) as Workflow;
    const job = workflow.jobs['release-server'];
    const steps = job?.steps ?? [];
    const publishIndex = steps.findIndex(
      (step) => step.name === 'Publish the draft GitHub release',
    );
    const dispatchIndex = steps.findIndex(
      (step) => step.name === 'Deploy docs from the release tag',
    );
    const dispatch = steps[dispatchIndex];

    expect(job?.permissions).toMatchObject({ actions: 'write' });
    expect(dispatch?.run).toContain('gh workflow run deploy-docs.yml');
    expect(dispatch?.run).toContain('--ref "$GITHUB_REF_NAME"');
    expect(dispatch?.run).toContain(
      '-f release_tag="$GITHUB_REF_NAME"',
    );
    expect(dispatchIndex).toBeGreaterThan(publishIndex);
  });

  it('publishes latest only for stable server versions', () => {
    const workflow = parse(read(RELEASE_WORKFLOW)) as Workflow;
    const steps = workflow.jobs['release-server']?.steps ?? [];
    const build = steps.find(
      (step) => step.name === 'Build and smoke linux/amd64 image',
    )?.run ?? '';
    const push = steps.find(
      (step) => step.name === 'Push multi-architecture image',
    )?.run ?? '';

    expect(build).toContain(
      'image_tags=(--tag "$image:$BLOK_SERVER_VERSION")',
    );
    expect(build).toContain(
      'if [[ "$BLOK_SERVER_VERSION" != *-* ]]; then',
    );
    expect(build).toContain(
      'image_tags+=(--tag "$image:latest")',
    );
    expect(build).toContain('"${image_tags[@]}"');
    expect(push).toContain(
      'image_tags=(--tag "$image:$BLOK_SERVER_VERSION")',
    );
    expect(push).toContain(
      'if [[ "$BLOK_SERVER_VERSION" != *-* ]]; then',
    );
    expect(push).toContain(
      'image_tags+=(--tag "$image:latest")',
    );
    expect(push).toContain('"${image_tags[@]}"');
    expect(push).toContain('docker buildx build');
  });

  it('requires the unsafe image smoke to refuse quickly and exactly', () => {
    const workflow = parse(read(RELEASE_WORKFLOW)) as Workflow;
    const build = workflow.jobs['release-server']?.steps?.find(
      (step) => step.name === 'Build and smoke linux/amd64 image',
    )?.run ?? '';

    expect(build).toContain(
      'timeout 10s docker run --rm "$image:$BLOK_SERVER_VERSION"',
    );
    expect(build).toContain('unsafe_status=$?');
    expect(build).toContain('if [ "$unsafe_status" -eq 124 ]; then');
    expect(build).toContain('if [ "$unsafe_status" -eq 0 ]; then');
    expect(build).toContain(
      'if [ "$unsafe_refusal" != "$expected_refusal" ]; then',
    );
    expect(build).toContain(
      'blok-server refused to start: --auth none serves anyone who can reach',
    );
  });

  it('lets the package fixture validate the exact release NuGets', () => {
    const fixture = read('scripts/test-server-packages.mjs');
    const project = read(
      'test/fixtures/dotnet-server-consumer/Blok.Server.Consumer.csproj',
    );

    expect(fixture).toContain("argument === '--package-dir'");
    expect(fixture).toContain("argument === '--version'");
    expect(fixture).toContain('packageDirectory ??');
    expect(fixture).toContain(
      '`-p:BlokServerPackageVersion=${packageVersion}`',
    );
    expect(fixture.match(/packageVersionProperty,/g)).toHaveLength(2);
    expect(project).toContain(
      '<BlokServerPackageVersion Condition="\'$(BlokServerPackageVersion)\' == \'\'">0.0.0-task13</BlokServerPackageVersion>',
    );
    expect(project).toContain('Version="$(BlokServerPackageVersion)"');
    expect(project).not.toContain('PackageReference Include="Blok.Server"');
  });

  it('builds the C# host from the root context into .NET 10 runtime-deps', () => {
    const dockerfile = read('packages/server/Dockerfile');
    const workflow = read(RELEASE_WORKFLOW);

    expect(dockerfile).toMatch(
      /^FROM --platform=\$BUILDPLATFORM mcr\.microsoft\.com\/dotnet\/sdk:10\.0[^\n]* AS publish/m,
    );
    expect(dockerfile).toContain(
      'COPY packages/server/dotnet/ packages/server/dotnet/',
    );
    expect(dockerfile).not.toContain('FROM node:');
    expect(dockerfile).not.toContain('yarn install');
    expect(dockerfile).not.toContain('build-server-runtime');
    expect(dockerfile).toContain(
      'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj',
    );
    expect(dockerfile).toContain('ARG TARGETARCH');
    expect(dockerfile).toContain('rid=linux-x64');
    expect(dockerfile).toContain('rid=linux-arm64');
    expect(dockerfile).toContain('--runtime "$rid"');
    expect(dockerfile).not.toContain('--runtime linux-x64');
    expect(dockerfile).toContain('--self-contained true');
    expect(dockerfile).toContain('-p:PublishSingleFile=true');
    expect(dockerfile).toContain('-p:IncludeNativeLibrariesForSelfExtract=true');
    expect(dockerfile).not.toContain('SkipBlokServerRuntimeBuild');
    expect(dockerfile).toContain('ARG BLOK_SERVER_VERSION');
    expect(dockerfile).toContain('-p:BlokServerVersion=$BLOK_SERVER_VERSION');
    expect(dockerfile).toMatch(/^FROM mcr\.microsoft\.com\/dotnet\/runtime-deps:10\.0/m);

    const runtimeStage = dockerfile.slice(
      dockerfile.lastIndexOf('FROM mcr.microsoft.com/dotnet/runtime-deps:10.0'),
    );

    expect(runtimeStage).not.toContain('useradd');
    expect(runtimeStage).toContain('COPY --from=publish --chown=65532:65532 /data /data');
    expect(runtimeStage).toMatch(/^WORKDIR \/data$/m);
    expect(runtimeStage).toMatch(/^USER 65532:65532$/m);
    expect(dockerfile).toContain('EXPOSE 4000');
    expect(dockerfile).toContain('ENTRYPOINT ["/blok-server"]');
    expect(dockerfile).not.toMatch(/\bgo(?:lang)?\b/i);
    expect(dockerfile).not.toContain('distroless');

    expect(workflow).toMatch(
      /docker build --platform linux\/amd64 -f packages\/server\/Dockerfile[\s\S]*?^\s+\.$/m,
    );
    expect(workflow).toMatch(
      /docker buildx build[\s\S]*--platform linux\/amd64,linux\/arm64[\s\S]*--push/m,
    );
  });

  it('documents a loopback Docker port, persistent data, and TLS termination', () => {
    const readme = read('packages/server/README.md');

    expect(readme).toContain('--network host');
    expect(readme).toContain('--listen 127.0.0.1:4000');
    expect(readme).toMatch(/-p 127\.0\.0\.1:4000:4000[\s\S]*--auth ticket/);
    expect(readme).toContain('--listen 0.0.0.0:4000');
    expect(readme).toContain('target=/data');
    expect(readme).toContain('--storage-dir /data');
    expect(readme).toMatch(/Alpine|musl/);
    expect(readme).toMatch(/TLS[^\n]*(reverse proxy|hosting platform)|(reverse proxy|hosting platform)[^\n]*TLS/i);
  });

  it('keeps the root Docker context small without excluding release inputs', () => {
    const ignore = read('.dockerignore');

    const patterns = ignore.split('\n');

    for (const pattern of [
      '.git',
      'node_modules',
      '**/node_modules',
      '.yarn',
      '.venv',
      'storybook-static',
      'dist',
      '**/dist',
      '**/bin',
      '**/obj',
      'docs/dist',
      '.server-release-dist',
      '.server-release-smoke',
      '.server-test-results',
      '.server-coverage',
      '.superpowers',
      '.env',
      '.env.*',
      '.npmrc',
    ]) {
      expect(patterns).toContain(pattern);
    }

    expect(ignore).not.toMatch(/^src\/?$/m);
    expect(ignore).not.toMatch(/^scripts\/?$/m);
    expect(ignore).not.toMatch(/^packages\/server\/dotnet\/?$/m);
    expect(ignore).not.toMatch(/^package\.json$/m);
    expect(ignore).not.toMatch(/^yarn\.lock$/m);
    expect(ignore).not.toMatch(/^\.yarnrc\.yml$/m);
  });

  it('keeps every public delivery surface on C#', () => {
    const publicSources = [
      read(RELEASE_WORKFLOW),
      read('packages/server/Dockerfile'),
      read(SERVER_MANIFEST),
      read('packages/server/README.md'),
      read('scripts/release-manifest.mjs'),
    ].join('\n');

    expect(publicSources).not.toContain('Go sidecar');
    expect(read(SERVER_MANIFEST)).toMatch(/C#|ASP\.NET/);
    expect(read('packages/server/README.md')).toContain('Blok.Server.AspNetCore');
    expect(read('packages/server/README.md')).not.toContain('UseMySql');
    expect(read(RELEASE_WORKFLOW)).not.toContain('MySql');
  });

  it('ships an npm wrapper that verifies the C# host it downloads', () => {
    const wrapper = read('packages/server/bin/blok-server.mjs');

    expect(wrapper).toContain('checksums.txt');
    expect(wrapper).toContain('createHash');
    expect(wrapper).toContain('ghcr.io/jackuait/blok-server');
    expect(wrapper).toMatch(/realpathSync\(process\.argv\[1\]\)/);
  });

  /**
   * YDotNet.Native.Linux 0.6.0 mispacks its musl natives (wrong-arch asset
   * for linux-musl-x64, none for linux-musl-arm64), so the release builds
   * yffi from the yrs tag YDotNet 0.6.0 was built against and swaps it in.
   * The pin, the swap, and the smokes are all release-only — these pins are
   * the only thing that keeps them from silently rotting.
   */
  describe('musl libyrs override', () => {
    const YRS_PIN = 'release-v0.19.1';
    const MUSL_BUILD_JOB = 'build-musl-yffi';
    const HOST_CSPROJ = 'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj';
    const HOST_RUNTIMES_DIR = 'packages/server/dotnet/Blok.Server.Host/runtimes';
    const CACHE_ACTION = 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830';
    const UPLOAD_ACTION = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
    const DOWNLOAD_ACTION = 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';

    type MuslJob = {
      if?: string;
      'runs-on'?: string;
      needs?: string | string[];
      permissions?: Record<string, string>;
      env?: Record<string, string>;
      strategy?: { matrix?: { include?: Record<string, string>[] } };
      steps?: WorkflowStep[];
    };

    const loadJobs = (): Record<string, MuslJob> =>
      (parse(read(RELEASE_WORKFLOW)) as { jobs: Record<string, MuslJob> }).jobs;

    it('builds both musl natives from the pinned yrs release in rust:alpine', () => {
      const job = loadJobs()[MUSL_BUILD_JOB];

      expect(job).toBeDefined();
      expect(job?.if).toContain('github.repository');
      expect(job?.permissions).toEqual({ contents: 'read' });
      expect(job?.['runs-on']).toBe('${{ matrix.runner }}');
      expect(job?.env?.YRS_PIN).toBe(YRS_PIN);
      expect(job?.strategy?.matrix?.include).toEqual([
        {
          rid: 'linux-musl-x64',
          target: 'x86_64-unknown-linux-musl',
          runner: 'ubuntu-latest',
          machine: 'x86-64',
          loader: 'libc.musl-x86_64.so.1',
        },
        {
          rid: 'linux-musl-arm64',
          target: 'aarch64-unknown-linux-musl',
          runner: 'ubuntu-24.04-arm',
          machine: 'ARM aarch64',
          loader: 'libc.musl-aarch64.so.1',
        },
      ]);

      const runs = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');

      expect(runs).toContain('rust:alpine');
      expect(runs).toContain('https://github.com/y-crdt/y-crdt.git');
      expect(runs).toContain('--branch "$YRS_PIN"');
      expect(runs).toContain('RUSTFLAGS="-C target-feature=-crt-static"');
      expect(runs).toContain('cargo build --release -p yffi --target ${{ matrix.target }}');
    });

    it('caches by the yrs pin and refuses partial restores', () => {
      const steps = loadJobs()[MUSL_BUILD_JOB]?.steps ?? [];
      const cache = steps.find((step) => (step.uses ?? '').startsWith('actions/cache@'));

      expect(cache?.uses).toBe(CACHE_ACTION);
      expect(String(cache?.with?.key)).toContain('${{ matrix.target }}');
      expect(String(cache?.with?.key)).toContain('${{ env.YRS_PIN }}');
      expect(cache?.with?.['restore-keys']).toBeUndefined();

      const build = steps.find((step) => (step.run ?? '').includes('cargo build'));

      expect(build?.if).toContain('cache-hit');
    });

    it('verifies architecture and musl linkage before uploading each native', () => {
      const steps = loadJobs()[MUSL_BUILD_JOB]?.steps ?? [];
      const runs = steps.map((step) => step.run ?? '').join('\n');

      expect(runs).toContain("grep -F 'ELF 64-bit LSB shared object'");
      expect(runs).toContain("grep -F '${{ matrix.machine }}'");
      expect(runs).toContain('readelf -d');
      expect(runs).toContain("grep -F '${{ matrix.loader }}'");

      const upload = steps.find((step) => (step.uses ?? '').startsWith('actions/upload-artifact@'));

      expect(upload?.uses).toBe(UPLOAD_ACTION);
      expect(upload?.with?.name).toBe('libyrs-${{ matrix.rid }}');
      expect(upload?.with?.['if-no-files-found']).toBe('error');
    });

    it('stages both overrides into the host project before any publish', () => {
      const jobs = loadJobs();
      const release = jobs['release-server'];

      expect(release?.needs).toBe(MUSL_BUILD_JOB);

      const steps = release?.steps ?? [];
      const downloadIndex = steps.findIndex(
        (step) => (step.uses ?? '').startsWith('actions/download-artifact@'),
      );
      const stageIndex = steps.findIndex(
        (step) => (step.run ?? '').includes(`${HOST_RUNTIMES_DIR}/$rid/native/libyrs.so`),
      );
      const buildIndex = steps.findIndex(
        (step) => step.name === 'Build NuGet and host artifacts',
      );

      expect(steps[downloadIndex]?.uses).toBe(DOWNLOAD_ACTION);
      expect(steps[downloadIndex]?.with?.pattern).toBe('libyrs-linux-musl-*');
      expect(stageIndex).toBeGreaterThan(downloadIndex);
      expect(buildIndex).toBeGreaterThan(stageIndex);
      expect(steps[stageIndex]?.run).toContain('linux-musl-x64 linux-musl-arm64');
      expect(steps[stageIndex]?.run).toContain('install -D');
    });

    it('names the upstream mispack and the bump rule in the workflow', () => {
      const source = read(RELEASE_WORKFLOW);

      expect(source).toContain('YDotNet.Native.Linux');
      expect(source).toContain('build-binaries.yml');
      expect(source).toMatch(/YDotNet (version )?bump/);
      expect(source.match(new RegExp(YRS_PIN, 'g'))?.length).toBeGreaterThanOrEqual(2);
    });

    it('smokes the musl-amd64 archive with a real native load on Alpine', () => {
      const steps = loadJobs()['release-server']?.steps ?? [];
      const smoke = steps.find((step) => step.name === 'Smoke musl-amd64 archive on Alpine');

      expect(smoke?.run).toContain('blok-server_linux_musl_amd64.tar.gz');
      expect(smoke?.run).toContain('runtime-deps:10.0-alpine');
      expect(smoke?.run).toContain('--platform linux/amd64');
      expect(smoke?.run).toContain('DOTNET_BUNDLE_EXTRACT_BASE_DIR');
      expect(smoke?.run).toContain('/blok-server --help');
      expect(smoke?.run).toContain('/lib/ld-musl-x86_64.so.1 --list');

      const source = read(RELEASE_WORKFLOW);

      expect(source.indexOf('Smoke musl-amd64 archive on Alpine'))
        .toBeGreaterThan(source.indexOf('node scripts/publish-server.mjs --version'));
    });

    it('smokes single-file extraction and native load as USER 65532 in the image', () => {
      const steps = loadJobs()['release-server']?.steps ?? [];
      const smoke = steps.find(
        (step) => step.name === 'Smoke image native extraction as USER 65532',
      );

      expect(smoke?.run).toContain('id -u');
      expect(smoke?.run).toContain('65532');
      expect(smoke?.run).toContain('test ! -w "${HOME:-/}"');
      expect(smoke?.run).toContain('/blok-server --help');
      expect(smoke?.run).toContain('libyrs.so');
      expect(smoke?.run).toContain('ldd');

      const source = read(RELEASE_WORKFLOW);
      const smokeIndex = source.indexOf('Smoke image native extraction as USER 65532');

      expect(smokeIndex).toBeGreaterThan(
        source.indexOf('docker build --platform linux/amd64'),
      );
      expect(smokeIndex).toBeLessThan(source.indexOf('Log in to GHCR'));
    });

    it('overrides the packaged native per musl RID in the host project', () => {
      const csproj = read(HOST_CSPROJ);

      for (const rid of ['linux-musl-x64', 'linux-musl-arm64']) {
        expect(csproj).toContain(
          `<ItemGroup Condition="'$(RuntimeIdentifier)' == '${rid}'">`,
        );
        expect(csproj).toContain(`runtimes/${rid}/native/libyrs.so`);
      }

      expect(csproj).toContain('Link="libyrs.so"');
      expect(csproj).toContain('CopyToPublishDirectory="PreserveNewest"');
      expect(csproj).toContain('<NativeCopyLocalItems Remove="@(NativeCopyLocalItems)"');
      expect(csproj).toContain(
        '<RuntimeTargetsCopyLocalItems Remove="@(RuntimeTargetsCopyLocalItems)"',
      );

      expect(read('.gitignore')).toContain(`${HOST_RUNTIMES_DIR}/`);
    });

    it('hard-fails a real musl publish before dotnet when an override is absent', () => {
      const script = read('scripts/publish-server.mjs');
      const dryRunBranch = script.indexOf('if (options.dryRun)');
      const guardCall = script.indexOf('assertMuslOverridesPresent(TARGETS)');
      const publishLoop = script.indexOf('spawnSync(command.command');

      expect(dryRunBranch).toBeGreaterThan(-1);
      expect(guardCall).toBeGreaterThan(dryRunBranch);
      expect(guardCall).toBeLessThan(publishLoop);
    });
  });
});
