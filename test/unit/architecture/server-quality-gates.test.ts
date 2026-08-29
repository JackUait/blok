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
    expect(tools.tools['dotnet-reportgenerator-globaltool']?.version).toBe('5.5.11');
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
    expect(securityRuns).toContain(
      'docker build --tag blok-server:ci --file packages/server/Dockerfile .',
    );
    expect(securityUses).toContain(
      'gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7',
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
    expect(securityUses.filter(use => use ===
      'aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1'))
      .toHaveLength(2);
    expect(securitySteps.find(step =>
      step.name === 'Scan server container image')?.with).toMatchObject({
      'scan-type': 'image',
      'image-ref': 'blok-server:ci',
    });
    expect(codeqlUses).toContain(
      'github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28',
    );
    expect(codeqlUses).toContain(
      'github/codeql-action/analyze@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28',
    );
  });

  it('keeps backend package, image, and workflow dependencies updated', () => {
    const dependabot = parse(read('.github/dependabot.yml')) as Dependabot;
    const targets = dependabot.updates.map(update => [
      update['package-ecosystem'],
      update.directory,
    ]);

    expect(targets).toEqual(expect.arrayContaining([
      ['nuget', '/packages/server/dotnet'],
      ['docker', '/packages/server'],
      ['github-actions', '/'],
    ]));
  });
});
