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

  // A collaboration pass is checked once, at connect, and must name the
  // document — so the mint route reads the doc the editor asks for and gives
  // that pass a longer life than the five-minute upload default.
  it('mints collaboration passes with the doc claim and a longer life', () => {
    const mint = serverPaths.find((p) => p.id === 'serverless')?.appRoute[0]?.code ?? '';

    expect(mint).toMatch(/searchParams\.get\('doc'\)/);
    expect(mint).toContain('doc');
    expect(mint).toContain('ttlSeconds: 30 * 60');
  });

  it('keeps live collaboration a separate opt-in run command on the serverless path', () => {
    const commands = serverPaths.find((p) => p.id === 'serverless')?.whatToRun ?? [];

    expect(commands.length).toBe(2);
    expect(commands[0].code).not.toContain('--collab');
    expect(commands[1].code).toContain('--collab');
    expect(commands[1].code).toContain('--collab-dir /collab');
    expect(commands[1].code).toContain('--doc-endpoint');
    expect(commands[1].code).toContain('-e BLOK_DOC_ENDPOINT_AUTH');
  });

  // Decision 12 of the phase-2 plan: seeding fails closed and the sync door
  // closes on a bad pass. Both wire behaviors get a reader-facing entry here.
  it('describes the sync door closing and the read-only reconnect state', () => {
    const modes = serverPaths.find((p) => p.id === 'serverless')?.failureModes ?? [];
    const prose = modes.map((m) => `${m.symptom} ${m.cause} ${m.fix}`).join('\n');

    expect(prose).toMatch(/doc claim/i);
    expect(prose).toMatch(/read-only/i);
    expect(prose).toMatch(/--doc-endpoint/);
    expect(prose).toMatch(/BLOK_DOC_ENDPOINT_AUTH/);
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

  it('says live collaboration needs the service, like link previews', () => {
    const ownStorage = serverPaths.find((p) => p.id === 'own-storage');
    const prose = [
      ownStorage?.description ?? '',
      ...(ownStorage?.failureModes ?? []).flatMap((m) => [m.symptom, m.cause, m.fix]),
    ].join(' ');

    expect(ownStorage?.description).toMatch(/live collaboration/i);
    expect(prose).toMatch(/--collab/);
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
    expect(code).toContain('MapBlokServer("/api/blok").RequireAuthorization()');
    expect(dotnet?.description).toMatch(/application.*authorization policy/i);
    expect(dotnet?.description).not.toContain('IBlokAuthorization');
    expect(code).not.toContain('UseMySql');
  });

  // Type names live in code samples; the prose stays plain-language, which is
  // why the description pin above still bans IBlokAuthorization from prose.
  it('adds the collaboration story to the in-process path', () => {
    const dotnet = serverPaths.find((p) => p.id === 'dotnet');
    const code = (dotnet?.appRoute ?? []).map((s) => s.code).join('\n');

    expect(dotnet?.description).toMatch(/live collaboration/i);
    expect(code).toContain('app.UseWebSockets();');
    expect(code).toContain('CollabEnabled = true');
    expect(code).toContain('DocEndpoint');
    expect(code).toContain('IBlokAuthorization');
    expect(code).toContain('CanReadDocumentAsync');
    expect(code).toContain('CanWriteDocumentAsync');
    expect(code).toContain('UseAuthorization<DocumentRules>');
  });

  it('explains the clear refusal when the app forgot UseWebSockets', () => {
    const modes = serverPaths.find((p) => p.id === 'dotnet')?.failureModes ?? [];
    const prose = modes.map((m) => `${m.symptom} ${m.cause} ${m.fix}`).join('\n');

    expect(prose).toMatch(/UseWebSockets/);
    expect(prose).toMatch(/refus/i);
  });

  it('passes WebSocket upgrades through the forwarding route', () => {
    const route = serverPaths.find((p) => p.id === 'own-server')?.appRoute[0]?.code ?? '';

    expect(route).toContain('ws: true');
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
      '--collab',
      '--collab-dir',
      '--collab-s3-prefix',
      '--doc-endpoint',
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

  it('states the fourteen service limits the design refuses to bury', () => {
    expect(serverLimits.map((l) => l.id)).toEqual([
      'no-documents',
      'working-copy-privacy',
      'collab-reset',
      'doc-endpoint-auth',
      'file-origin',
      'asset-cors',
      's3-untested',
      'cors-preflight',
      'upload-by-url-json',
      'proxy-rate-limit',
      'ticket-not-scoped',
      'collab-pass-lifetime',
      'tls-termination',
      'alpine-nuget',
    ]);
    for (const limit of serverLimits) {
      expect(limit.title.length).toBeGreaterThan(0);
      expect(limit.body.length).toBeGreaterThan(0);
    }
  });

  // Live collaboration made the old "stores no documents" claim false: the
  // service now keeps a working copy of docs being edited. The renegotiated
  // entry prices that honestly instead of hiding it.
  it('says the record stays with your endpoint and prices the working copy honestly', () => {
    const body = serverLimits.find((l) => l.id === 'no-documents')?.body ?? '';

    expect(body).toMatch(/working copy/i);
    expect(body).toMatch(/your endpoint|your own app/i);
    expect(body).toMatch(/few seconds/i);
  });

  it('keeps the working copy out of public reach', () => {
    const body = serverLimits.find((l) => l.id === 'working-copy-privacy')?.body ?? '';

    expect(body).toContain('--collab-dir');
    expect(body).toContain('--collab-s3-prefix');
    expect(body).toMatch(/publicly/i);
    expect(body).toMatch(/uploads directory|uploads folder/i);
  });

  it('documents the reset call that re-seeds from your records', () => {
    const body = serverLimits.find((l) => l.id === 'collab-reset')?.body ?? '';

    expect(body).toContain('POST /sync/{doc}/reset');
    expect(body).toMatch(/wins|overwritten/i);
    expect(body).toMatch(/open tab/i);
  });

  it('documents how the service signs in to the document endpoint', () => {
    const body = serverLimits.find((l) => l.id === 'doc-endpoint-auth')?.body ?? '';

    expect(body).toContain('BLOK_DOC_ENDPOINT_AUTH');
    expect(body).toMatch(/verbatim/i);
  });

  it('gives collaboration passes about 30 minutes and admits revocation waits for a reconnect', () => {
    const body = serverLimits.find((l) => l.id === 'collab-pass-lifetime')?.body ?? '';

    expect(body).toMatch(/30 minutes/);
    expect(body).toMatch(/checked once|when the connection opens/i);
    expect(body).toMatch(/reconnect/i);
  });

  it('admits the NuGet package does not run on Alpine x64', () => {
    const body = serverLimits.find((l) => l.id === 'alpine-nuget')?.body ?? '';

    expect(body).toContain('Alpine');
    expect(body).toContain('NuGet');
    expect(body).toMatch(/npx/);
    expect(body).toMatch(/Docker/);
    expect(body).toMatch(/refus|startup/i);
  });

  it('warns that uploaded files belong on a different origin than the app', () => {
    const body = serverLimits.find((l) => l.id === 'file-origin')?.body ?? '';
    expect(body).toMatch(/different (origin|hostname)/i);
    expect(body).toMatch(/Content-Disposition/);
    expect(body).toMatch(/nosniff/);
  });

  // Five features read an uploaded file back from the browser and swallow the
  // failure, so a hostname that answers no CORS header degrades each of them
  // with nothing in Blok to say why. It sits beside file-origin because the two
  // are one instruction: a different hostname, that answers CORS.
  it('says the hostname serving uploads must answer CORS, and what breaks when it does not', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'asset-cors')?.body ?? '';

    expect(limits.indexOf('asset-cors')).toBe(limits.indexOf('file-origin') + 1);
    expect(body).toMatch(/Access-Control-Allow-Origin/);
    for (const feature of [/waveform/i, /GIF/, /SVG/, /preview/i, /download/i]) {
      expect(body, String(feature)).toMatch(feature);
    }
    // The silence is the reason this is written down at all.
    expect(body).toMatch(/quietly|silently|no error|nothing/i);
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

  // Collaboration passes ARE document-scoped and the sync door enforces the
  // claim — including refusing a pass that names no document. The upload and
  // preview routes still ignore it, and the entry has to say both halves.
  it('says collaboration passes are document-scoped at the sync door while upload routes stay user-scoped', () => {
    const body = serverLimits.find((l) => l.id === 'ticket-not-scoped')?.body ?? '';

    expect(body).toMatch(/do(es)? not (restrict|confine|scope)/i);
    expect(body).toMatch(/also names the document/i);
    expect(body).toMatch(/names no document/i);
    expect(body).toMatch(/turned away|refused/i);
    expect(body).toMatch(/your own app|your app/i);
  });

  it('requires TLS termination for an internet-facing host', () => {
    const body = serverLimits.find((l) => l.id === 'tls-termination')?.body ?? '';

    expect(body).toMatch(/does not terminate TLS|speaks plain HTTP/i);
    expect(body).toMatch(/reverse proxy|hosting platform/i);
  });
});
