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
const CHECKOUT_ACTION = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const SETUP_DOTNET_ACTION = 'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9';
const LOGIN_ACTION = 'docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9';
const SETUP_NODE_ACTION_SHA = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const SERVER_ARCHIVES = [
  'blok-server_darwin_amd64.tar.gz',
  'blok-server_darwin_arm64.tar.gz',
  'blok-server_linux_amd64.tar.gz',
  'blok-server_linux_arm64.tar.gz',
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

  it('keeps a wrapper-only npm package out of the JavaScript build graph', async () => {
    const { buildTasks } = (await import('../../../scripts/build-all.mjs')) as {
      buildTasks: (opts?: { mode?: string; withCli?: boolean }) => { name: string }[];
    };
    const tasks = new Set(buildTasks({ withCli: true }).map((task) => task.name));

    expect(readJson<{ scripts?: Record<string, string> }>(SERVER_MANIFEST).scripts).toBeUndefined();
    expect(tasks.has('server')).toBe(false);
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
    expect(actions).toContain('actions/setup-dotnet@v4');
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

  it('creates the family release as a draft before the server workflow runs', () => {
    const releaseScript = read('scripts/release.mjs');

    expect(releaseScript).toMatch(/gh release create \$\{gitTag\}[^\n]* --draft/);
  });

  it('publishes two NuGets, six hosts, checksums, and the amd64 image before the draft', () => {
    expect(existsSync(join(repoRoot, RELEASE_WORKFLOW))).toBe(true);

    const source = read(RELEASE_WORKFLOW);
    const workflow = parse(source) as Workflow;

    expect(workflow.on?.push?.tags).toContain('v*');

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
    expect(runs).toContain('docker push "$image:$BLOK_SERVER_VERSION"');
    expect(runs).toContain('docker push "$image:latest"');

    const deliveryVerification = steps.find(
      (step) => step.name === 'Verify published server delivery',
    )?.run;

    expect(deliveryVerification).toMatch(
      /anonymous_docker_config="\$\(mktemp -d\)"[\s\S]*DOCKER_CONFIG="\$anonymous_docker_config" docker manifest inspect/,
    );
    expect(runs).not.toContain('docker buildx build');
    expect(runs).not.toContain('--platform linux/arm64');

    expect(runs).toContain('gh release upload "$GITHUB_REF_NAME"');
    expect(runs).toContain('gh release edit "$GITHUB_REF_NAME" --draft=false');

    const nugetPush = source.indexOf('dotnet nuget push');
    const assetUpload = source.indexOf('gh release upload "$GITHUB_REF_NAME"');
    const imagePush = source.indexOf('docker push "$image:$BLOK_SERVER_VERSION"');
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
    const pushIndex = steps.findIndex((step) => step.name === 'Push linux/amd64 image');
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
      (step) => step.name === 'Push linux/amd64 image',
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
    expect(push).toContain('docker push "$image:$BLOK_SERVER_VERSION"');
    expect(push).toContain(
      'if [[ "$BLOK_SERVER_VERSION" != *-* ]]; then',
    );
    expect(push).toContain('docker push "$image:latest"');
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

  it('makes the embedded runtime build incremental', () => {
    const project = read('packages/server/dotnet/Blok.Server/Blok.Server.csproj');
    const target = project.match(
      /<Target Name="BuildBlokServerRuntime"[\s\S]*?<\/Target>/,
    )?.[0] ?? '';

    expect(project).toContain(
      '<BlokServerRuntimeInput Include="$(MSBuildThisFileDirectory)../../../../src/**/*.ts" />',
    );
    expect(project).toContain(
      '<BlokServerRuntimeInput Include="$(MSBuildThisFileDirectory)../../../../types/**/*.d.ts" />',
    );
    expect(project).toContain(
      '<BlokServerRuntimeInput Include="$(MSBuildThisFileDirectory)../../../../scripts/build-server-runtime.mjs" />',
    );
    expect(target).toContain('Inputs="@(BlokServerRuntimeInput)"');
    expect(target).toContain(
      'Outputs="$(MSBuildThisFileDirectory)Generated/blok-server-runtime.js"',
    );
  });

  it('builds the C# host from the root context into .NET 10 runtime-deps', () => {
    const dockerfile = read('packages/server/Dockerfile');
    const workflow = read(RELEASE_WORKFLOW);

    expect(dockerfile).toMatch(/^FROM node:24[^\n]* AS runtime-build/m);
    expect(dockerfile).toContain('corepack enable');
    expect(dockerfile).toContain('yarn install --immutable');

    for (const manifest of [
      'packages/angular/package.json',
      'packages/cli/package.json',
      'packages/presets/package.json',
      'packages/react/package.json',
      'packages/server/package.json',
      'packages/vue/package.json',
    ]) {
      expect(dockerfile).toContain(`COPY ${manifest} ${manifest}`);
    }
    expect(dockerfile.indexOf('yarn install --immutable')).toBeLessThan(
      dockerfile.indexOf('COPY . .'),
    );
    expect(dockerfile).toContain('node scripts/build-server-runtime.mjs');
    expect(dockerfile).toMatch(/^FROM mcr\.microsoft\.com\/dotnet\/sdk:10\.0[^\n]* AS publish/m);
    expect(dockerfile).toContain(
      'packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj',
    );
    expect(dockerfile).toContain('--runtime linux-x64');
    expect(dockerfile).toContain('--self-contained true');
    expect(dockerfile).toContain('-p:PublishSingleFile=true');
    expect(dockerfile).toContain('-p:SkipBlokServerRuntimeBuild=true');
    expect(dockerfile).toContain('ARG BLOK_SERVER_VERSION');
    expect(dockerfile).toContain('-p:BlokServerVersion=$BLOK_SERVER_VERSION');
    expect(dockerfile).toMatch(/^FROM mcr\.microsoft\.com\/dotnet\/runtime-deps:10\.0/m);

    const runtimeStage = dockerfile.slice(
      dockerfile.lastIndexOf('FROM mcr.microsoft.com/dotnet/runtime-deps:10.0'),
    );

    expect(runtimeStage).toMatch(/useradd[^\n]*blok/);
    expect(runtimeStage).toContain('mkdir /data');
    expect(runtimeStage).toContain('chown blok:blok /data');
    expect(runtimeStage).toMatch(/^WORKDIR \/data$/m);
    expect(runtimeStage).toMatch(/^USER blok$/m);
    expect(dockerfile).toContain('EXPOSE 4000');
    expect(dockerfile).toContain('ENTRYPOINT ["/blok-server"]');
    expect(dockerfile).not.toMatch(/\bgo(?:lang)?\b/i);
    expect(dockerfile).not.toContain('distroless');

    expect(workflow).toMatch(
      /docker build --platform linux\/amd64 -f packages\/server\/Dockerfile[\s\S]*?^\s+\.$/m,
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
});
