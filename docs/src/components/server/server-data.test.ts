// docs/src/components/server/server-data.test.ts
import { describe, expect, it } from 'vitest';
import { serverCoverageNote, serverLimits, serverPaths } from './server-data';

describe('server docs data', () => {
  it('documents the four deployment paths as separate entries', () => {
    expect(serverPaths.map((p) => p.id)).toEqual([
      'own-storage',
      'dotnet',
      'own-server',
      'serverless',
    ]);
  });

  it('states the link-preview coverage limit up front', () => {
    expect(serverCoverageNote).toMatch(/70%/);
    expect(serverCoverageNote).toMatch(/plain link/i);
  });

  it('leads with the path that runs no service, because an extra service depresses adoption', () => {
    expect(serverPaths[0].id).toBe('own-storage');
    expect(serverPaths[0].runsService).toBe(false);
    expect(serverPaths.filter((p) => p.runsService).map((p) => p.id)).toEqual([
      'dotnet',
      'own-server',
      'serverless',
    ]);
  });

  it('shows the in-process ASP.NET registration without advertising MySQL', () => {
    const dotnet = serverPaths.find((path) => path.id === 'dotnet');

    expect(dotnet).toBeDefined();

    const samples = [
      ...(dotnet?.whatToRun ?? []),
      ...(dotnet?.appRoute ?? []),
      ...(dotnet === undefined ? [] : [dotnet.editorConfig]),
    ];
    const code = samples.map((sample) => sample.code).join('\n');

    expect(samples.some((sample) => sample.language === 'csharp')).toBe(true);
    expect(code).toContain('dotnet add package Blok.Server.AspNetCore');
    expect(code).toContain('AddBlokServer');
    expect(code).toContain('StorageDirectory');
    expect(code).toContain('PublicUrl');
    expect(code).toContain('UnfurlDisabled = false');
    expect(code).toContain('UseAuthorization<');
    expect(code).toContain('MapBlokServer("/api/blok").RequireAuthorization()');
    expect(dotnet?.description).toMatch(/application.*authorization policy/i);
    expect(dotnet?.description).toMatch(/IBlokAuthorization.*document/i);
  });

  /**
   * Converting a document is the one thing the package does that needs no
   * storage, no outbound network access and no route — a reader who only wants
   * Markdown out of an article should not be sent to configure a bucket.
   */
  it('shows document conversion as its own registration, without storage or a route', () => {
    const dotnet = serverPaths.find((path) => path.id === 'dotnet');
    const code = [...(dotnet?.whatToRun ?? []), ...(dotnet?.appRoute ?? [])]
      .map((sample) => sample.code)
      .join('\n');

    expect(code).toContain('AddBlokDocuments');
    expect(code).toContain('IBlokDocumentConverter');
    expect(code).toContain('ToMarkdownAsync');
    expect(dotnet?.description).toMatch(/markdown/i);
    expect(code).not.toContain('UseMySql');
  });

  it('sends the storage-only path to the presets page instead of restating it', () => {
    expect(serverPaths[0].presetsPath).toBe('/presets');
    expect(serverPaths.slice(1).every((p) => p.presetsPath === undefined)).toBe(true);
  });

  it('gives every path what to run, the app route, the editor config and failure modes', () => {
    for (const path of serverPaths) {
      expect(path.editorConfig.code.length).toBeGreaterThan(0);
      expect(path.failureModes.length).toBeGreaterThan(0);
      for (const mode of path.failureModes) {
        expect(mode.symptom.length).toBeGreaterThan(0);
        expect(mode.cause.length).toBeGreaterThan(0);
        expect(mode.fix.length).toBeGreaterThan(0);
      }
    }

    // Only the storage-only path has nothing to start and no route to add.
    expect(serverPaths[0].whatToRun).toEqual([]);
    expect(serverPaths[0].appRoute).toEqual([]);
    for (const path of serverPaths.slice(1)) {
      expect(path.whatToRun.length).toBeGreaterThan(0);
      expect(path.appRoute.length).toBeGreaterThan(0);
    }
  });

  it('names only flags the binary actually parses', () => {
    // The standalone host's whole flag set, plus the docker flags the run
    // commands legitimately carry. A docs page naming a flag the binary does
    // not have sends a reader to a process that exits with "flag provided but
    // not defined", so this is a whitelist rather than a spot check.
    const known = [
      '--allow-origin',
      '--auth',
      '--listen',
      '--max-upload',
      '--no-unfurl',
      '--public-url',
      '--rate-limit',
      '--s3-addressing',
      '--s3-bucket',
      '--s3-bucket-url',
      '--s3-endpoint',
      '--s3-region',
      '--secret',
      '--storage-dir',
      // docker run's own
      '--network',
    ];
    const prose = [
      ...serverPaths.flatMap((p) => [
        ...p.whatToRun.map((s) => s.code),
        ...p.appRoute.map((s) => s.code),
        p.editorConfig.code,
        ...p.failureModes.flatMap((m) => [m.symptom, m.cause, m.fix]),
      ]),
      ...serverLimits.map((l) => l.body),
      serverCoverageNote,
    ].join('\n');

    const named = [...prose.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]);
    expect([...new Set(named)].filter((flag) => !known.includes(flag))).toEqual([]);
  });

  it('states the five deploy-time limits the design refuses to bury', () => {
    expect(serverLimits.map((l) => l.id)).toEqual([
      'no-documents',
      'file-origin',
      's3-untested',
      'cors-preflight',
      'proxy-rate-limit',
    ]);
    for (const limit of serverLimits) {
      expect(limit.title.length).toBeGreaterThan(0);
      expect(limit.body.length).toBeGreaterThan(0);
    }
  });

  it('says the service stores no documents and why that is deliberate', () => {
    const body = serverLimits.find((l) => l.id === 'no-documents')?.body ?? '';
    expect(body).toMatch(/no database|stores no documents|does not store/i);
  });

  it('warns that uploaded files belong on a different origin than the app', () => {
    const body = serverLimits.find((l) => l.id === 'file-origin')?.body ?? '';
    expect(body).toMatch(/different (origin|hostname)/i);
    expect(body).toMatch(/Content-Disposition/);
    expect(body).toMatch(/nosniff/);
  });

  it('admits the S3 signatures have never met a real bucket', () => {
    const body = serverLimits.find((l) => l.id === 's3-untested')?.body ?? '';
    expect(body).toMatch(/real bucket/i);
  });
});
