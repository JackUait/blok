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
  // round and quietly rot against what the editor actually does. The in-process
  // path is in the list too: `collaboration` is refused without `server`, so a
  // hand-wired sample there cannot host the collaboration story at all.
  it('wires the editor with the server key rather than by hand', () => {
    for (const id of ['dotnet', 'own-server', 'serverless']) {
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

  // The client half of each path. `collaboration` is refused without `server`,
  // so every path that runs the service shows the two keys together — and the
  // sample shape stays identical across them, because a reader compares paths.
  it('shows the collaboration config on every path that runs the service', () => {
    for (const id of ['dotnet', 'own-server', 'serverless']) {
      const code = serverPaths.find((p) => p.id === id)?.editorConfig.code ?? '';

      expect(code, id).toMatch(/server: /);
      expect(code, id).toContain('collaboration: {');
      expect(code, id).toContain("doc: 'article-42'");
      expect(code, id).toContain("user: { name: 'Jack', color: '#f60' }");
    }
  });

  // The storage-only path cannot run the sync service, so the sample must not
  // show a key that would throw there — and has to say where to get it.
  it('keeps the storage-only path honest about live collaboration', () => {
    const code = serverPaths.find((p) => p.id === 'own-storage')?.editorConfig.code ?? '';

    expect(code).not.toContain('collaboration:');
    expect(code).toMatch(/needs the service/i);
    expect(code).toMatch(/link previews/i);
    expect(code).toMatch(/paths below/i);
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

  // In-process only: with collaboration on, no passes and no document check,
  // MapBlokServer logs one warning naming the three sync routes. The standalone
  // host validates none mode as loopback-only and never shows it.
  it('explains the warning when nothing guards the sync routes in-process', () => {
    const modes = serverPaths.find((p) => p.id === 'dotnet')?.failureModes ?? [];
    const prose = modes.map((m) => `${m.symptom} ${m.cause} ${m.fix}`).join('\n');

    expect(prose).toMatch(/open to anyone/i);
    expect(prose).toMatch(/three routes/i);
    expect(prose).toMatch(/reset/);
    expect(prose).toMatch(/edit/);
    expect(prose).toMatch(/RequireAuthorization\(\)/);
    // The description pin bans the type name from prose; the sample carries it.
    expect(prose).not.toContain('IBlokAuthorization');
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
      '--doc-endpoint-auth',
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

  // Three guards the managed engine removed, plus the delivery shape it
  // replaced. The NUL screen (close 4400 "update contains U+0000") and the
  // 4503 stored-NUL seed failure belonged to the old native binding and are
  // gone: the room applies such an update like any other. The native library,
  // its extraction directory and the runtimes that needed one are gone too.
  // Each of these read as a real operator hazard, so any of them drifting back
  // into the prose sends a reader chasing something the service cannot do.
  it('does not describe guards or delivery the managed engine removed', () => {
    const prose = [
      ...serverPaths.flatMap((path) => [
        path.description,
        path.situation,
        ...path.failureModes.flatMap((mode) => [mode.symptom, mode.cause, mode.fix]),
      ]),
      ...serverLimits.map((limit) => `${limit.title} ${limit.body}`),
      serverCoverageNote,
    ].join('\n');

    expect(prose).not.toMatch(/U\+0000/);
    expect(prose).not.toMatch(/\bNUL\b/);
    expect(prose).not.toMatch(/YDotNet/i);
    expect(prose).not.toMatch(/native librar/i);
    expect(prose).not.toMatch(/extraction director/i);
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

  it('states the twenty-seven service limits the design refuses to bury', () => {
    expect(serverLimits.map((l) => l.id)).toEqual([
      'no-documents',
      'collab-replaces-persistence',
      'working-copy-privacy',
      'collab-reset',
      'doc-endpoint-auth',
      'collab-new-documents',
      'file-origin',
      'asset-cors',
      's3-untested',
      'cors-preflight',
      'upload-by-url-json',
      'proxy-rate-limit',
      'ticket-not-scoped',
      'collab-pass-lifetime',
      'collab-connection-cap',
      'collab-connection-ceiling',
      'collab-scale-out',
      'collab-what-is-not-limited',
      'collab-what-is-not-checked',
      'collab-connection-states',
      'collab-offline-reload',
      'collab-merge-granularity',
      'collab-presence-identity',
      'collab-presence-unverified',
      'collab-presence-room-size',
      'collab-doc-id-shape',
      'tls-termination',
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
    // The export debounce is a lag on the READ side too, not just a loss
    // window: whatever else reads your records is that far behind the tab.
    expect(body).toMatch(/trails|behind/i);
    expect(body).toMatch(/export|report|another service/i);
    // A refused write-back backs off and retries, and eviction refuses to drop
    // a room that still owes one — so an endpoint outage is a delay, not a loss.
    expect(body).toMatch(/retried/i);
    expect(body).toMatch(/stays loaded/i);
  });

  // Two ways to give the document a second owner, one entry: the refused
  // `persistence` pair, and the `onSave` payload a host used to write back.
  // Remote edits still reach onChange/onSave on purpose, which is exactly what
  // makes "just save what it hands you" a plausible and wrong reflex.
  it('says the service owns the round-trip, so persistence is refused and onSave is not a save cue', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-replaces-persistence')?.body ?? '';

    expect(limits.indexOf('collab-replaces-persistence')).toBe(limits.indexOf('no-documents') + 1);
    expect(body).toMatch(/persistence/);
    expect(body).toMatch(/cannot be combined|refuses/i);
    expect(body).toMatch(/two owners|owns/i);
    expect(body).toMatch(/onSave/);
    expect(body).toMatch(/onChange/);
    expect(body).toMatch(/do not write|never write|stop saving/i);
  });

  it('keeps the working copy out of public reach', () => {
    const body = serverLimits.find((l) => l.id === 'working-copy-privacy')?.body ?? '';

    expect(body).toContain('--collab-dir');
    expect(body).toContain('--collab-s3-prefix');
    expect(body).toMatch(/publicly/i);
    expect(body).toMatch(/uploads directory|uploads folder/i);
    // What the store does with files it cannot use: rename aside and re-seed,
    // sweep stale temp files at startup, and fail the open on a format it does
    // not read (a reset keeps the stored format, so it is not the lever here).
    expect(body).toContain('.unreadable-');
    expect(body).toMatch(/temporary files/i);
    expect(body).toMatch(/format this service does not read/i);
  });

  // Two ways in, and the entry has to make the choice between them obvious:
  // the edit call for a few blocks, the reset call for a whole document. Both
  // properties readers act on are pinned — an edit request is all-or-nothing,
  // and a document nobody has open can still be edited.
  it('documents both ways to change a document from outside', () => {
    const body = serverLimits.find((l) => l.id === 'collab-reset')?.body ?? '';

    expect(body).toContain('POST /sync/{doc}/edit');
    expect(body).toContain('POST /sync/{doc}/reset');
    expect(body).toMatch(/insert, update or remove/i);
    expect(body).toMatch(/nothing is applied|all-or-nothing/i);
    expect(body).toMatch(/nobody has open/i);
    expect(body).toMatch(/wins|overwritten/i);
    expect(body).toMatch(/open tab/i);
    // Inserts apply one after another against the document as it stands, so
    // two naming the same anchor land reversed; a reader chaining them by
    // hand needs to know.
    expect(body).toMatch(/same `?after`?/);
    expect(body).toMatch(/reverse order/i);
    // The write-back already carries the version header; the consumer cannot
    // close the reset-vs-export race without knowing it exists.
    expect(body).toContain('Blok-Doc-Version');
    expect(body).toMatch(/409/);
    expect(body).toContain('Blok-Idempotency-Key');
    expect(body).toMatch(/1 to 128/);
    expect(body).toContain('Blok-Doc-Lineage');
    expect(body).toContain('Blok-Doc-Sequence');
    expect(body).toMatch(/operation journal.*same key.*first result.*409/i);
    expect(body).toMatch(/working-copy-only.*does not deduplicat.*ordinary retry/i);
    expect(body).toMatch(/durable/i);
    expect(body).toContain('has no children list, so nothing can be placed under it.');
    expect(body).toContain('is not in the document order, so nothing can be placed after it.');
    expect(body).toMatch(/422/);
  });

  // Shape is checked at the door, meaning is not. Each of these is a known
  // pass-through, stated so nobody discovers it from a support ticket.
  it('names what passes through unchecked: lone surrogates, pending updates, denied children', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-what-is-not-checked')?.body ?? '';

    expect(limits.indexOf('collab-what-is-not-checked')).toBe(
      limits.indexOf('collab-what-is-not-limited') + 1,
    );
    expect(body).toMatch(/U\+FFFD/);
    expect(body).toMatch(/surrogate/i);
    expect(body).toMatch(/integrates nothing|never integrate/i);
    expect(body).toMatch(/not refused|relayed/i);
    expect(body).toMatch(/evict/i);
    expect(body).toContain('childTools');
    expect(body).toMatch(/warning/i);
    expect(body).toMatch(/does not demote|not demoted/i);
    // The one thing that does NOT pass through, and the lockstep rule that
    // makes a document saved in the browser and one written back by the
    // service agree: both skip a malformed block and both null past 256.
    expect(body).toMatch(/256 levels/i);
    expect(body).toMatch(/null/);
    expect(body).toMatch(/editor and the service/i);
  });

  it('documents how the service signs in to the document endpoint', () => {
    const body = serverLimits.find((l) => l.id === 'doc-endpoint-auth')?.body ?? '';

    expect(body).toContain('BLOK_DOC_ENDPOINT_AUTH');
    expect(body).toMatch(/verbatim/i);
    // A CR or LF in the value refuses to start, because a header carrying one
    // would be dropped from every doc-endpoint call with nothing to see.
    expect(body).toMatch(/single line/i);
    expect(body).toMatch(/carriage return|newline|line break/i);
  });

  // The seed call treats null as "nothing saved yet" and anything non-2xx as a
  // failure, so an endpoint that answers 404 for a new document locks it. The
  // entry sits right after the auth one because both describe that endpoint.
  it('tells the document endpoint to answer null for a new document, never 404', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-new-documents')?.body ?? '';

    expect(limits.indexOf('collab-new-documents')).toBe(limits.indexOf('doc-endpoint-auth') + 1);
    expect(body).toMatch(/200 with null/);
    expect(body).toContain('{ "data": null }');
    expect(body).toMatch(/404/);
    expect(body).toMatch(/5xx/);
    expect(body).toMatch(/failure/i);
    expect(body).toMatch(/reconnecting notice/i);
    expect(body).toMatch(/overwrite/i);
    expect(body).toContain('--doc-endpoint');
  });

  it('gives collaboration passes about 30 minutes and admits revocation waits for a reconnect', () => {
    const body = serverLimits.find((l) => l.id === 'collab-pass-lifetime')?.body ?? '';

    expect(body).toMatch(/30 minutes/);
    expect(body).toMatch(/checked once|when the connection opens/i);
    expect(body).toMatch(/reconnect/i);
    expect(body).toMatch(/access away|revok/i);
  });

  // The cap keys on who is holding the connection. Behind a proxy nothing
  // names the person, so a cap there would be one allowance for everybody.
  it('caps live connections per person and document, and admits the proxy path has none', () => {
    const body = serverLimits.find((l) => l.id === 'collab-connection-cap')?.body ?? '';

    expect(body).toMatch(/eight/i);
    expect(body).toContain('too many connections');
    expect(body).toMatch(/429/);
    expect(body).toMatch(/address/i);
    expect(body).toMatch(/proxy/i);
    expect(body).toMatch(/no cap/i);
    // The sync door refuses a pass with an empty user (SyncClose.UserlessPass),
    // so the cap and the rate window key on the user alone. The old sentence
    // promised a per-network-address fallback that no longer exists.
    expect(body).toContain('pass names no user');
    expect(body).toMatch(/4401/);
    expect(body).not.toMatch(/network address/i);
  });

  // Kestrel's default is unlimited; the host pins 1,024 only with --collab on,
  // and only in the standalone host. It sits right after the per-person cap so
  // "no cap at all" on the proxy path is not read as "no ceiling either".
  it('states the per-process ceiling on live connections, and names the in-app knob with Kestrel underneath', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-connection-ceiling')?.body ?? '';

    expect(limits.indexOf('collab-connection-ceiling')).toBe(limits.indexOf('collab-connection-cap') + 1);
    expect(body).toContain('1,024');
    expect(body).toContain('--collab');
    expect(body).toMatch(/per process/i);
    expect(body).toMatch(/Kestrel/);
    expect(body).toMatch(/refused/i);
    expect(body).toMatch(/until one of the open ones closes/i);
    expect(body).toMatch(/ASP\.NET/);
    expect(body).toContain('MaxConcurrentUpgradedConnections');
    // The service counts upgrades itself and refuses BEFORE the room is seeded;
    // Kestrel's limit stays underneath and answers 500 after the seed.
    expect(body).toMatch(/503/);
    expect(body).toContain('CollabMaxConnections');
    expect(body).toMatch(/500/);
  });

  // The design promised a documented sharding pattern instead of scaling
  // machinery. It sits right after the per-process ceiling — the number that
  // makes someone reach for a second process — and the guarantee it names is
  // deliberate: nothing in the service prevents two processes opening one
  // document, so the routing rule IS the safety, and the entry must say so.
  it('documents the scale-out pattern: one document, one process, routed by id', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-scale-out')?.body ?? '';

    expect(limits.indexOf('collab-scale-out')).toBe(limits.indexOf('collab-connection-ceiling') + 1);
    expect(body).toMatch(/one .*process/i);
    expect(body).toContain('/sync/{doc}');
    expect(body).toMatch(/route/i);
    expect(body).toMatch(/document id/i);
    expect(body).toMatch(/overwrit/i);
    expect(body).toMatch(/reset/i);
    expect(body).toMatch(/uploads? and link[- ]previews?/i);
    expect(body).toMatch(/nothing (in the service )?stops|does not stop|no built-in/i);
  });

  // The review asked for the unbounded things to be said out loud, next to the
  // five bounds that do exist, so nobody reads the connection cap as a quota.
  it('says what live collaboration leaves unlimited, and names the five bounds it does have', () => {
    const body = serverLimits.find((l) => l.id === 'collab-what-is-not-limited')?.body ?? '';

    expect(body).toMatch(/no cap/i);
    expect(body).toMatch(/your own backend/i);
    expect(body).toContain('1 MiB');
    expect(body).toContain('8 MiB');
    expect(body).toMatch(/50/);
    expect(body).toContain('inbound rate exceeded');
    expect(body).toMatch(/1008/);
    expect(body).toContain('CollabInboundFramesPerSecond');
    expect(body).toContain('--rate-limit');
    expect(body).toMatch(/not limited/i);
    // Presence is metered by BYTES on top of the frame count, so a connection
    // under the message rate can still be closed. Undercounting the bounds is
    // what makes a reader budget for four.
    expect(body).toContain('CollabInboundAwarenessBytesPerSecond');
    expect(body).toContain('128 KiB');
    expect(body).toContain('512 KiB');
    expect(body).toMatch(/beyond those five/i);
    // Only the three RATES accept 0; CollabInboundBurstFrames must be positive
    // and a 0 there throws at startup, so "any of them" would be false.
    expect(body).toMatch(/0 turns any of the rates off/);
    // The resync budget meters presence re-queries too, not whole-document
    // resends alone.
    expect(body).toMatch(/re-announce/i);
    // The inbound budget made this sentence false.
    expect(body).not.toMatch(/how fast an open connection sends is not limited/i);
    // The fifth bound made this count false.
    expect(body).not.toMatch(/beyond those four/i);
    // The message cap is announced at connect, so the editor refuses an
    // oversized send itself instead of learning the cap from a disconnect.
    expect(body).toMatch(/tells the editor the message-size limit when it connects/);
    expect(body).toMatch(/refuses to send something too big/);
    // A message may take 16 receives plus one per 64 bytes (SyncSocketMember),
    // and a text frame is refused outright — both are connection-level rules a
    // non-Blok client can trip.
    expect(body).toContain('binary frames only');
    expect(body).toMatch(/1003/);
    expect(body).toMatch(/sixteen pieces/i);
  });

  // The two halves of the door are deliberately asymmetric: nothing is editable
  // before the first sync (a locally seeded doc forks history), everything stays
  // editable after one, even with the socket gone.
  it('describes the read-only-until-synced start and the editable-while-offline reconnect', () => {
    const body = serverLimits.find((l) => l.id === 'collab-connection-states')?.body ?? '';

    expect(body).toMatch(/read-only/i);
    expect(body).toMatch(/first sync/i);
    expect(body).toMatch(/write|read-only itself|host/i);
    expect(body).toMatch(/stays editable|remains editable/i);
    expect(body).toMatch(/reconnect/i);
    expect(body).toContain('collaboration:status');
    expect(body).toMatch(/connecting/);
    expect(body).toMatch(/connected/);
    expect(body).toMatch(/offline/);
    expect(body).toMatch(/your own indicator|indicator of your own/i);
  });

  // Staying editable offline is only kind if the price of a reload is written
  // down: the tab is the sole copy until it reconnects.
  // The default still loses offline edits on reload, so that stays the lead.
  // The opt-in that changes it now exists, and the two things that keep a local
  // copy from becoming a second source of truth — nothing before the first
  // sync, and thrown away when the history stops matching — are the reason it
  // is safe to offer at all, so they are pinned too.
  it('says a reload loses offline edits by default, and what the offline option changes', () => {
    const body = serverLimits.find((l) => l.id === 'collab-offline-reload')?.body ?? '';

    expect(body).toMatch(/reload/i);
    expect(body).toMatch(/only copy|nowhere else|in the tab/i);
    expect(body).toMatch(/gone|lost/i);
    expect(body).toMatch(/by default/i);
    expect(body).toMatch(/offline option/i);
    expect(body).toMatch(/off unless you ask|opt/i);
    expect(body).toMatch(/browser storage/i);
    expect(body).toMatch(/until the first successful sync/i);
    expect(body).toMatch(/thrown away|discarded/i);
    // The copy belongs to the browser, not to the person signed in — an
    // operator on shared computers has to be told before they turn it on.
    expect(body).toMatch(/shared computer/i);
  });

  // The claim the design says will eventually disappoint someone, so it is
  // stated before they meet it: fields merge, letters inside one do not.
  it('prices the merge granularity honestly, Notion included', () => {
    const body = serverLimits.find((l) => l.id === 'collab-merge-granularity')?.body ?? '';

    expect(body).toMatch(/different blocks/i);
    expect(body).toMatch(/different fields|other fields/i);
    expect(body).toMatch(/last/i);
    expect(body).toMatch(/Notion/);
    expect(body).toMatch(/character/i);
  });

  // Presence has two entries on purpose: this one is what a reader sees and
  // where it comes from, the next one is what it does not prove.
  it('says what presence renders and where the display identity comes from', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-presence-identity')?.body ?? '';

    expect(limits.indexOf('collab-presence-identity')).toBe(
      limits.indexOf('collab-presence-unverified') - 1,
    );
    expect(body).toMatch(/avatar/i);
    expect(body).toMatch(/cursor|caret/i);
    // Presence draws a cursor, the way Notion does. An entry still promising a
    // highlighted block describes a version of the editor that no longer ships.
    expect(body).not.toMatch(/outline/i);
    // The caret carries no name flag: identity is a monogram face in the
    // margin with the name on hover, and the caret pulses once idle.
    expect(body).not.toMatch(/flag/i);
    expect(body).toMatch(/margin|gutter|beside the block/i);
    expect(body).toMatch(/pulse/i);
    expect(body).toMatch(/hover/i);
    expect(body).toMatch(/collaboration/);
    expect(body).toMatch(/name/i);
    expect(body).toMatch(/colou?r/i);
    // The display identity is NOT the attribution option, and a reader who
    // conflates them wires the wrong one.
    expect(body).toMatch(/last edited|attribution|credit/i);
    expect(body).toMatch(/independent|separate/i);
    // Leaving the name out is the DEFAULT, so the entry has to say what that
    // person is drawn as rather than leaving a reader to guess at a blank disc.
    expect(body).toMatch(/silhouette/i);
  });

  // Awareness frames are relayed unread, read-only members included, so the
  // entry has to stop anyone treating presence as identity. Their SHAPE is
  // checked now (SyncWire.TryValidateAwarenessUpdate), so "never looks inside"
  // would be false: a state that is not valid JSON ends every receiving
  // session, and the third bad frame closes the sender.
  it('says presence is relayed unverified and must not carry permissions', () => {
    const body = serverLimits.find((l) => l.id === 'collab-presence-unverified')?.body ?? '';

    expect(body).toMatch(/exactly as each browser sends/i);
    expect(body).toMatch(/read-only pass/i);
    expect(body).toMatch(/not an identity check/i);
    expect(body).toMatch(/never build permissions/i);
    expect(body).not.toMatch(/never looks inside/i);
    expect(body).toMatch(/valid JSON/i);
    expect(body).toContain('malformed awareness');
    expect(body).toMatch(/1008/);
  });

  // Over the cap the room drops the presence frame and logs it rather than
  // closing anyone, so the honest framing is a degradation, not a seat count.
  // The number is internal, so the entry must not hand out a flag name for it.
  it('says presence stops past 256 people while editing carries on', () => {
    const limits = serverLimits.map((l) => l.id);
    const body = serverLimits.find((l) => l.id === 'collab-presence-room-size')?.body ?? '';

    expect(limits.indexOf('collab-presence-room-size')).toBe(
      limits.indexOf('collab-presence-unverified') + 1,
    );
    expect(body).toContain('256');
    expect(body).toMatch(/cursor|caret/i);
    expect(body).toMatch(/dropped/i);
    expect(body).toMatch(/log/i);
    expect(body).toMatch(/editing/i);
    expect(body).toMatch(/keeps? typing|carries on|as usual/i);
    expect(body).toMatch(/no setting|fixed/i);
    expect(body).not.toMatch(/MaxAwarenessClients/);
  });

  // The id sits in /sync/{doc} and in the pass and is compared byte for byte;
  // a slash, encoded or not, is closed 4400 by name rather than left to surface
  // as a baffling doc-claim mismatch.
  it('prescribes a single-segment opaque document id', () => {
    const body = serverLimits.find((l) => l.id === 'collab-doc-id-shape')?.body ?? '';

    expect(body).toContain('/sync/{doc}');
    expect(body).toMatch(/one path segment/i);
    expect(body).toMatch(/slash/i);
    expect(body).toMatch(/even an encoded one/i);
    expect(body).toMatch(/refused/i);
    expect(body).toContain('document ids must be a single path segment');
    expect(body).toMatch(/opaque ids/i);
    expect(body).toMatch(/token/i);
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
    expect(body).toMatch(/name its user/i);
    expect(body).toMatch(/your own app|your app/i);
  });

  it('requires TLS termination for an internet-facing host', () => {
    const body = serverLimits.find((l) => l.id === 'tls-termination')?.body ?? '';

    expect(body).toMatch(/does not terminate TLS|speaks plain HTTP/i);
    expect(body).toMatch(/reverse proxy|hosting platform/i);
  });
});
