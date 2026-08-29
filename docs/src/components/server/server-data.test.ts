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

  // The editor grew a `server` key that fills in the uploader and the unfurl
  // endpoint. Showing the hand-written wiring here would teach the long way
  // round and quietly rot against what the editor actually does.
  it('wires the editor with the server key rather than by hand', () => {
    for (const id of ['own-server', 'serverless']) {
      const code = serverPaths.find((p) => p.id === id)?.editorConfig.code ?? '';

      expect(code, id).toMatch(/server: /);
      expect(code, id).not.toContain('fetchStorage');
      expect(code, id).not.toContain('bookmark');
    }
  });

  it('carries the pass with the ticket key, so one cached pass serves everything', () => {
    const code = serverPaths.find((p) => p.id === 'serverless')?.editorConfig.code ?? '';

    expect(code).toMatch(/ticket: /);
    // A resolved object froze the pass at construction; previews died at expiry
    // while uploads carried on.
    expect(code).not.toContain('await authHeaders()');
  });

  it('mints the pass with blokTicket instead of spelling out an HMAC', () => {
    const routes = serverPaths.find((p) => p.id === 'serverless')?.appRoute ?? [];

    expect(routes.some((r) => r.code.includes("from '@bloklabs/server/ticket'"))).toBe(true);
    expect(routes.some((r) => r.code.includes('blokTicket('))).toBe(true);
  });

  // A signer only exists for JavaScript backends. Everyone else needs the wire
  // format itself, or they cannot use this path at all.
  it('keeps the raw pass contract for backends that are not JavaScript', () => {
    const routes = serverPaths.find((p) => p.id === 'serverless')?.appRoute ?? [];
    const raw = routes.map((r) => `${r.label} ${r.code}`).join('\n');

    expect(raw).toContain('HS256');
    for (const claim of ['user', 'doc', 'write', 'exp']) {
      expect(raw, claim).toMatch(new RegExp(`\\b${claim}\\b`));
    }
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
    expect(code).not.toContain('UseAuthorization<');
    expect(code).toContain('MapBlokServer("/api/blok").RequireAuthorization()');
    expect(dotnet?.description).toMatch(/application.*authorization policy/i);
    expect(dotnet?.description).not.toContain('IBlokAuthorization');
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

  it('keeps Docker data writable and publishes the ticket host port on loopback', () => {
    const ownServer = serverPaths.find((path) => path.id === 'own-server');
    const serverless = serverPaths.find((path) => path.id === 'serverless');
    const ownServerCommand = ownServer?.whatToRun.map((sample) => sample.code).join('\n') ?? '';
    const serverlessCommand = serverless?.whatToRun.map((sample) => sample.code).join('\n') ?? '';

    expect(ownServerCommand).toContain('--network host');
    expect(ownServerCommand).toContain('--listen 127.0.0.1:4000');
    expect(serverlessCommand).toContain('-p 127.0.0.1:4000:4000');
    expect(serverlessCommand).toContain('--listen 0.0.0.0:4000');

    for (const command of [ownServerCommand, serverlessCommand]) {
      expect(command).toContain('target=/data');
      expect(command).toContain('--storage-dir /data');
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
      '--mount',
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

  it('documents the validated option bounds and standalone rate defaults', () => {
    const prose = [
      ...serverPaths.flatMap((path) => [
        path.description,
        ...path.failureModes.flatMap((mode) => [mode.cause, mode.fix]),
      ]),
      ...serverLimits.map((limit) => limit.body),
    ].join(' ');

    expect(prose).toMatch(/MaxUploadBytes.*Array\.MaxLength.*storage.*unfurl/i);
    expect(prose).toMatch(/RateLimitPerMinute.*zero or greater/i);
    expect(prose).toMatch(/PublicUrl.*HTTP.*root-relative/i);
    expect(prose).toMatch(/S3BucketUrl.*absolute HTTP/i);
    expect(prose).toMatch(/S3Endpoint.*HTTPS.*loopback HTTP/i);
    expect(prose).toMatch(/ListenAddress.*DNS host.*every network interface/i);
    expect(prose).toMatch(/--rate-limit.*ticket.*60.*otherwise.*0/i);
  });

  it('states the seven service limits the design refuses to bury', () => {
    expect(serverLimits.map((l) => l.id)).toEqual([
      'no-documents',
      'file-origin',
      's3-untested',
      'cors-preflight',
      'upload-by-url-json',
      'proxy-rate-limit',
      'tls-termination',
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

  it('documents the browser-origin guard without blocking backend calls', () => {
    const body = serverLimits.find((l) => l.id === 'cors-preflight')?.body ?? '';

    expect(body).toMatch(/Origin/);
    expect(body).toMatch(/Sec-Fetch-Site.*cross-site/);
    expect(body).toMatch(/server-to-server|backend/i);
  });

  it('allowlists the app origin in the proxy deployment example', () => {
    const ownServer = serverPaths.find((path) => path.id === 'own-server');
    const command = ownServer?.whatToRun.map((sample) => sample.code).join('\n') ?? '';

    expect(command).toContain('--auth proxy');
    expect(command).toContain('--allow-origin https://myapp.com');
  });

  it('documents the upload-by-url JSON media type', () => {
    const limit = serverLimits.find((l) => l.id === 'upload-by-url-json');

    expect(limit?.body).toMatch(/POST \/upload-by-url/);
    expect(limit?.body).toMatch(/Content-Type: application\/json/);
  });

  it('documents read-only ticket permissions', () => {
    const direct = serverPaths.find((path) => path.id === 'serverless');
    const prose = [
      direct?.description,
      ...(direct?.failureModes.flatMap((mode) => [mode.cause, mode.fix]) ?? []),
    ].join(' ');

    expect(prose).toMatch(/write: false.*unfurl/i);
    expect(prose).toMatch(/upload.*write: true/i);
  });

  it('requires TLS termination for an internet-facing host', () => {
    const body = serverLimits.find((l) => l.id === 'tls-termination')?.body ?? '';

    expect(body).toMatch(/does not terminate TLS|speaks plain HTTP/i);
    expect(body).toMatch(/reverse proxy|hosting platform/i);
  });
});
