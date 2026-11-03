// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

type Step = {
  name?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, boolean | number | string>;
};

type Workflow = {
  jobs: Record<string, {
    steps?: Step[];
  }>;
};

type Dependabot = {
  updates: Array<{
    'package-ecosystem': string;
    directory: string;
  }>;
};

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');
const workflow = (path: string): Workflow =>
  parse(read(path)) as Workflow;

describe('server quality gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enforces analyzers, warnings, code style, and full NuGet auditing', () => {
    const props = read('packages/server/dotnet/Directory.Build.props');

    expect(props).toContain('<AnalysisLevel>latest-recommended</AnalysisLevel>');
    expect(props).toContain('<AnalysisMode>Recommended</AnalysisMode>');
    expect(props).toContain('<EnableNETAnalyzers>true</EnableNETAnalyzers>');
    expect(props).toContain('<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>');
    expect(props).toContain('<TreatWarningsAsErrors>true</TreatWarningsAsErrors>');
    expect(props).toContain('<NuGetAudit>true</NuGetAudit>');
    expect(props).toContain('<NuGetAuditMode>all</NuGetAuditMode>');
    expect(props).toContain('<NuGetAuditLevel>low</NuGetAuditLevel>');
    expect(props).toContain('NU1901;NU1902;NU1903;NU1904');
    // The managed engine packs no native RID assets, so nothing is suppressed.
    expect(props).not.toContain('NETSDK1206');
    expect(props).not.toContain('<NoWarn>');
  });

  it('keeps unit, integration, end-to-end, and coverage gates in CI', () => {
    const solution = read('packages/server/dotnet/Blok.Server.slnx');
    const server = workflow('.github/workflows/ci.yml').jobs.server;
    const runs = (server?.steps ?? [])
      .flatMap(step => step.run === undefined ? [] : [step.run])
      .join('\n');
    const tools = JSON.parse(read('.config/dotnet-tools.json')) as {
      tools: Record<string, { version: string }>;
    };

    expect(solution).toContain('Blok.Server.Tests/Blok.Server.Tests.csproj');
    expect(solution).toContain('Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj');
    expect(solution).toContain('Blok.Server.Host.Tests/Blok.Server.Host.Tests.csproj');
    expect(runs).toContain('--collect:"Code Coverage;Format=Cobertura"');
    expect(runs).toContain('dotnet tool restore');
    expect(runs).toContain('dotnet reportgenerator');
    expect(runs).toContain('node scripts/check-server-coverage.mjs');
    expect(tools.tools['dotnet-reportgenerator-globaltool']?.version).toBe('5.5.12');
  });

  it('formats, vets, audits, tests and measures the Go server in CI', () => {
    const steps = workflow('.github/workflows/ci.yml').jobs['server-security']?.steps ?? [];
    const runs = steps
      .flatMap(step => step.run === undefined ? [] : [step.run])
      .join('\n');
    const uses = steps.flatMap(step => step.uses === undefined ? [] : [step.uses]);

    expect(uses).toContain('actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e');
    expect(runs).toContain('gofmt -l packages/server/go test/fixtures/go-server-consumer');
    expect(runs).toContain('go vet ./...');
    // Pinned: @latest would let a new release change what fails the gate.
    expect(runs).toContain('go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...');
    expect(runs).toMatch(/go test -p 2 .*-coverprofile=/);
    expect(runs).toContain('scripts/check-server-coverage.mjs --go "$RUNNER_TEMP/go-coverage.out"');
    expect(runs).toContain('node scripts/test-server-go-module.mjs');
    // Go conformance runs in Validate Spec File Coverage, which has the time.
    expect(
      (workflow('.github/workflows/ci.yml').jobs['validate-spec-coverage']?.steps ?? [])
        .map(step => step.run ?? ''),
    ).toContain('node scripts/test-server-conformance.mjs --target go');
  });

  it('scans secrets, vulnerable dependencies, configuration, and C# code', () => {
    const ci = workflow('.github/workflows/ci.yml');
    const securitySteps = ci.jobs['server-security']?.steps ?? [];
    const securityRuns = securitySteps
      .flatMap(step => step.run === undefined ? [] : [step.run])
      .join('\n');
    const securityUses = securitySteps
      .flatMap(step => step.uses === undefined ? [] : [step.uses]);
    const codeqlUses = Object.values(workflow('.github/workflows/codeql.yml').jobs)
      .flatMap(job => job.steps ?? [])
      .flatMap(step => step.uses === undefined ? [] : [step.uses]);

    expect(securityRuns).toContain(
      'dotnet restore packages/server/dotnet/Blok.Server.slnx',
    );
    expect(securityUses).toContain(
      'gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e',
    );
    expect(
      securitySteps.find(step => step.name === 'Scan committed secrets')?.env,
    ).toMatchObject({ GITLEAKS_CONFIG: 'gitleaks.toml' });
    const gitleaksConfig = read('gitleaks.toml');

    /**
     * The singular table, and never the plural array of them: gitleaks 8.24.3
     * parses `[[allowlists]]` without complaint and then ignores it, so a config
     * written that way allows nothing while reading as though it does. The
     * repository shipped exactly that until a placeholder blob name in the
     * server tests failed the scan the config claimed to have excused.
     */
    expect(gitleaksConfig).toMatch(/^\[allowlist\]$/m);
    expect(gitleaksConfig).not.toMatch(/\[\[allowlists\]\]/);
    expect(gitleaksConfig).toContain(
      '^test/unit/server-conformance/fixtures/tickets\\.json$',
    );
    // The sync tests send the sample nonce from RFC 6455 section 1.3.
    expect(gitleaksConfig).toContain('dGhlIHNhbXBsZSBub25jZQ');
    expect(securitySteps.find(step =>
      step.name === 'Scan repository vulnerabilities and configuration')?.uses)
      .toBe('aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
    // The image is built and scanned in Workflow Lint, which is idle for
    // minutes: Server Security's Go tests need the time.
    const imageSteps = ci.jobs['workflow-lint']?.steps ?? [];
    expect(imageSteps.find(step =>
      step.name === 'Build server container image')?.run).toBe(
      'docker build --tag blok-server:ci --file packages/server/Dockerfile .',
    );
    const imageScan = imageSteps.find(step => step.name === 'Scan server container image');
    expect(imageScan?.uses).toBe(
      'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25',
    );
    expect(imageScan?.with).toMatchObject({
      'scan-type': 'image',
      'image-ref': 'blok-server:ci',
      severity: 'HIGH,CRITICAL',
      'exit-code': '1',
    });
    expect(codeqlUses).toContain(
      'github/codeql-action/init@9b3254085494b55a0f7c4c2b3d2d52cc712ce370',
    );
    expect(codeqlUses).toContain(
      'github/codeql-action/analyze@9b3254085494b55a0f7c4c2b3d2d52cc712ce370',
    );
  });

  // A Go leg in ci.yml's CodeQL matrix would be a 20th job at t=0 on a main
  // push, and init's build-mode takes one language per job, so Go cannot
  // share the C# leg. The weekly scan has no slot to spend.
  it('scans the Go server with CodeQL weekly, not in CI', () => {
    type Matrix = { strategy?: { matrix?: { include?: Array<Record<string, string>> } } };
    const legs = (file: string): Array<Record<string, string>> =>
      Object.values(parse(read(file)).jobs as Record<string, Matrix>)
        .flatMap(job => job.strategy?.matrix?.include ?? []);
    const weekly = workflow('.github/workflows/codeql.yml');
    const steps = Object.values(weekly.jobs).flatMap(job => job.steps ?? []);

    expect(legs('.github/workflows/codeql.yml')).toContainEqual({ language: 'go', 'build-mode': 'manual' });
    expect(legs('.github/workflows/ci.yml').map(leg => leg.language)).not.toContain('go');
    expect(steps.find(step => step.name === 'Setup Go')?.uses)
      .toBe('actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e');
    expect(steps.find(step => step.name === 'Build Go server')?.run)
      .toBe('go build ./...');
  });

  it('keeps backend package, image, and workflow dependencies updated', () => {
    const dependabot = parse(read('.github/dependabot.yml')) as Dependabot;
    const targets = dependabot.updates.map(update => [
      update['package-ecosystem'],
      update.directory,
    ]);

    expect(targets).toEqual(expect.arrayContaining([
      ['nuget', '/packages/server/dotnet'],
      ['gomod', '/packages/server/go'],
      ['docker', '/packages/server'],
      ['github-actions', '/'],
    ]));
  });
});
