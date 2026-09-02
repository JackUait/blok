// docs/src/components/server/server-data.ts

export type ServerPathId = 'own-storage' | 'dotnet' | 'own-server' | 'serverless';

export interface ServerCodeSample {
  /** Plain-language label above the block, e.g. "Start the service". */
  label: string;
  language: 'bash' | 'csharp' | 'typescript';
  code: string;
}

/** One thing that goes wrong, in the reader's words, with what to do about it. */
export interface ServerFailureMode {
  symptom: string;
  cause: string;
  fix: string;
}

export interface ServerPath {
  id: ServerPathId;
  title: string;
  /** One line naming the reader's situation, so they can stop at the right heading. */
  situation: string;
  description: string;
  /** False only for own-storage, which is why it comes first. */
  runsService: boolean;
  /** What the reader starts. Empty for own-storage — there is nothing to start. */
  whatToRun: ServerCodeSample[];
  /** The single route the reader adds to their own app. Empty for own-storage. */
  appRoute: ServerCodeSample[];
  editorConfig: ServerCodeSample;
  /**
   * Set only on own-storage: that path is fully documented on /presets, and the
   * page links there rather than restating it. Locale-neutral — the page
   * prefixes it for the tree it is rendering in.
   */
  presetsPath?: string;
  failureModes: ServerFailureMode[];
}

export interface ServerLimit {
  id: string;
  title: string;
  body: string;
}

/**
 * The coverage limit, stated on the first screen rather than discovered in
 * production. The design commits to this wording being unsoftened.
 */
export const serverCoverageNote: string =
  'Link previews work for roughly 70% of the sites people paste. X, Instagram, LinkedIn and many news sites serve no preview data to anything that is not a browser, and no service can read what a site does not send. When a preview cannot be read, the block falls back to a plain link showing the domain. It is never an error, and nothing about the paste breaks.';

/**
 * The deployment paths, in the order a reader should meet them. The path
 * that runs no service leads: an extra service to run is the single biggest
 * reason someone installs nothing at all.
 */
export const serverPaths: ServerPath[] = [
  {
    id: 'own-storage',
    title: 'You already have storage',
    situation: 'You use Supabase, S3, Cloudinary or similar, and you want uploads to go straight there.',
    description:
      'Run nothing. The browser uploads to the storage you already pay for, using a ready-made uploader from @bloklabs/presets. This is the cheapest path and it is the one most people should take. Two things it cannot do: link previews and live collaboration. A preview means reading another site’s page, which a browser is not allowed to do, and live collaboration means carrying edits between people’s browsers, which needs something running that both of them can reach. If you want either, keep this uploader and add the service for that feature — the two do not conflict.',
    runsService: false,
    whatToRun: [],
    appRoute: [],
    editorConfig: {
      label: 'Point the editor at your storage',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';
import { supabaseStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: supabaseStorage(supabase, { bucket: 'blok' }),
  // Nothing here turns on live editing: it needs the service in the middle,
  // exactly like link previews do. The three paths below run it — take one
  // and keep this uploader as it is.
});`,
    },
    presetsPath: '/presets',
    failureModes: [
      {
        symptom: 'A pasted link stays a plain link instead of becoming a preview card.',
        cause:
          'Nothing is reading the page behind that link. A browser cannot fetch another site and read its title and image; the site has to allow it, and almost none do.',
        fix: 'Run the service for previews only, or point the bookmark tool at a third-party preview service. If you do not want previews at all, this is already the finished state.',
      },
      {
        symptom: 'Pasting an image URL from another site saves that URL instead of copying the image to your storage.',
        cause:
          'Copying a remote file needs a fetch made by a server. Supabase and presigned uploads happen entirely in the browser, so there is nobody to make it.',
        fix: 'The Cloudinary preset does this on its own, and so does the service. With the others the original URL is stored as-is, which still renders — it just depends on the other site staying up.',
      },
      {
        symptom: 'Two people open the same document and neither sees the other’s edits.',
        cause:
          'Nothing is carrying edits between their browsers. Live collaboration needs the service in the middle, for the same reason link previews do — the browser alone cannot do it.',
        fix: 'Run the service with --collab, pointed at the place your app saves documents. This uploader keeps working unchanged beside it.',
      },
    ],
  },
  {
    id: 'dotnet',
    title: 'Your app runs ASP.NET Core',
    situation: 'You want Blok routes inside the .NET app that already owns your users and deployment.',
    description:
      'Install the ASP.NET Core package and map the shared C# handlers in your existing process. There is no second host, port or container to operate. Your application authorization policy protects uploads and link previews. Live collaboration runs in the same process too: allow WebSockets, tell Blok where your documents live, and add a check that decides who may open which document. The editor calls the route prefix you choose, and database blocks and MySQL integration come later.',
    runsService: true,
    whatToRun: [
      {
        label: 'Install the ASP.NET Core package',
        language: 'bash',
        code: 'dotnet add package Blok.Server.AspNetCore',
      },
    ],
    appRoute: [
      {
        label: 'Register and map Blok in your app',
        language: 'csharp',
        code: `using Blok.Server.AspNetCore;

builder.Services.AddBlokServer(options =>
{
  options.StorageDirectory = "./blok-uploads";
  options.PublicUrl = "https://uploads.example.com/files";
  options.UnfurlDisabled = false;
  // Live collaboration. The service keeps a working copy of open documents
  // and loads and saves the record through your own document routes.
  options.CollabEnabled = true;
  options.DocEndpoint = "https://myapp.com/api/documents";
});

var app = builder.Build();

// Without this call the service cannot open the long-lived connection
// collaboration needs, and refuses it with a message saying so.
app.UseWebSockets();

app.MapBlokServer("/api/blok").RequireAuthorization();`,
      },
      {
        label: 'Decide who may open which document',
        language: 'csharp',
        code: `using System.Security.Claims;
using Blok.Server.AspNetCore;

// Asked when someone opens a document for live collaboration, after your
// RequireAuthorization policy has already run. Without it, any signed-in
// user may open any document.
public sealed class DocumentRules : IBlokAuthorization
{
  public ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    => ValueTask.FromResult(true /* your own check */);

  public ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default)
    => ValueTask.FromResult(true /* your own check */);
}

// Chain it onto the registration above:
builder.Services.AddBlokServer(options => { /* as above */ })
  .UseAuthorization<DocumentRules>();`,
      },
    ],
    editorConfig: {
      label: 'Point the editor at the mapped routes',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  // The prefix you mapped above. Fills in the uploader and the link-preview
  // endpoint; anything you set yourself wins.
  server: '/api/blok',
  // Live collaboration. Everyone who opens the same doc edits together, and
  // the name and color are what the other people see.
  collaboration: {
    doc: 'article-42',
    user: { name: 'Jack', color: '#f60' },
  },
});`,
    },
    failureModes: [
      {
        symptom: 'Upload routes return 404 while health and link previews work.',
        cause:
          'Storage is disabled, so the package does not map routes that could never complete.',
        fix: 'Set StorageDirectory, or configure the S3 options, when calling AddBlokServer.',
      },
      {
        symptom: 'The app rejects its Blok configuration before it maps routes or opens storage.',
        cause:
          'MaxUploadBytes cannot be larger than Array.MaxLength when storage and remote unfurl are both enabled. RateLimitPerMinute must be zero or greater. PublicUrl must be HTTP(S) or root-relative, while S3BucketUrl must be absolute HTTP(S); neither may contain credentials, a query or a fragment. S3Endpoint must be an origin without credentials, a path, a query or a fragment, and must use HTTPS except for loopback HTTP. ListenAddress rejects a DNS host because the standalone Kestrel host would bind every network interface.',
        fix: 'Use a safe public URL, keep remote S3 endpoints on HTTPS, lower the buffered-upload limit when required, and bind an IP address, localhost or an explicit wildcard.',
      },
      {
        symptom: 'The log warns at startup that the collaboration routes are open to anyone who can reach the app.',
        cause:
          'Collaboration is on, the service is not using passes, and no document check is registered, so nothing decides who may open which document. The warning names the three routes it covers: the sync connection, its reset and its edit.',
        fix: 'Register the document check shown above, or switch the service to passes. It is written once, at registration, and cannot see your policy, so a mapped group that already carries RequireAuthorization() gets the warning too — the sentence says as much itself.',
      },
      {
        symptom: 'Opening a document for live collaboration fails at once with a message about WebSockets.',
        cause:
          'The app never called UseWebSockets(), so the long-lived connection collaboration needs cannot be opened. The service refuses with a message naming the missing call rather than letting the editor time out.',
        fix: 'Add app.UseWebSockets(); before MapBlokServer, as in the sample above.',
      },
    ],
  },
  {
    id: 'own-server',
    title: 'You run your own backend',
    situation: 'You have a Django, Rails, Laravel, Node or Go app running on a machine you control.',
    description:
      'Run the service next to your app, listening only on 127.0.0.1. That address is reachable from your own machine and from nowhere else, so nothing on the internet can call it. Your app gets one new route that passes the request through, and your existing login check guards that route the same way it guards everything else. There is no second set of users, no second password, and no domain or certificate to arrange. Live collaboration flows through the same route — the one extra thing your proxy must do is let its long-lived connection through, shown below.',
    runsService: true,
    whatToRun: [
      {
        label: 'Start the service beside your app',
        language: 'bash',
        code: `docker run \\
  --network host \\
  --mount type=volume,source=blok-server-data,target=/data \\
  ghcr.io/jackuait/blok-server \\
  --listen 127.0.0.1:4000 \\
  --auth proxy \\
  --allow-origin https://myapp.com \\
  --storage-dir /data \\
  --public-url https://uploads.myapp.com/files`,
      },
    ],
    appRoute: [
      {
        label: 'Add one forwarding route to your app',
        language: 'typescript',
        code: `import { createProxyMiddleware } from 'http-proxy-middleware';

// Everything under /api/blok goes to the service. requireLogin is your own
// existing check — the service trusts whatever reaches it, so this line is
// what decides who may upload.
app.use(
  '/api/blok',
  requireLogin,
  createProxyMiddleware({
    target: 'http://127.0.0.1:4000',
    pathRewrite: { '^/api/blok': '' },
    // Live collaboration holds a connection open through this route.
    // Without ws: true uploads work and collaboration never connects.
    ws: true,
  }),
);`,
      },
    ],
    editorConfig: {
      label: 'Point the editor at your own route',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  // Fills in the uploader and the link-preview endpoint. Anything you set
  // yourself wins, so your own storage still works alongside it.
  server: '/api/blok',
  // Live collaboration. Everyone who opens the same doc edits together, and
  // the name and color are what the other people see.
  collaboration: {
    doc: 'article-42',
    user: { name: 'Jack', color: '#f60' },
  },
});`,
    },
    failureModes: [
      {
        symptom: 'The container prints "blok-server refused to start" and exits immediately.',
        cause:
          'It was told to listen on an address other than 127.0.0.1 while running in a mode that checks nothing. Refusing is deliberate: starting would have put an unauthenticated service on the internet.',
        fix: 'Keep --listen on 127.0.0.1. If you genuinely need the service reachable from outside, that is the third path below, and it uses --auth ticket.',
      },
      {
        symptom: 'Uploads come back as 404 while link previews work.',
        cause: 'That deployment has no storage configured, so the upload routes are not registered at all.',
        fix: 'Give the service somewhere to put files with --storage-dir, or point it at an S3-compatible bucket.',
      },
      {
        symptom: 'Uploads succeed, but the images are broken for everyone except you.',
        cause:
          '--public-url is the address the browser will load stored files from, and it defaults to the loopback address the service listens on. That address means "this machine" on every machine, so it works for you and nobody else.',
        fix: 'Set --public-url to a real address, and point that hostname at the service or at a web server holding the same directory. Use a different hostname than your app — the reason is in the section above.',
      },
      {
        symptom: 'Large uploads fail before they reach the service.',
        cause: 'Every uploaded file travels through your app on this path, so your app’s own request-size limit applies first.',
        fix: 'Raise the body-size limit on the forwarding route, or take the storage-only path above, where files never touch your app.',
      },
      {
        symptom: 'One busy user makes everyone else hit "rate limit exceeded".',
        cause:
          'Every request arrives at the service from your app, so from the service’s point of view they all come from the same caller and share one allowance.',
        fix: 'Limit per user in your own app, on the forwarding route, where you already know who is signed in.',
      },
      {
        symptom: 'You point the editor straight at http://127.0.0.1:4000 during development and the browser blocks the request.',
        cause:
          'The service only answers a browser that arrives from an address it was told to expect, and by default it was told none.',
        fix: 'Go through your app’s own route as shown above, or pass --allow-origin with your dev server’s address.',
      },
    ],
  },
  {
    id: 'serverless',
    title: 'You are on Vercel or Netlify',
    situation: 'Your app is deployed to a host that runs your code on demand, with nothing running beside it.',
    description:
      'There is no machine to sit the service next to, so it is deployed on its own — Fly, Railway, Render, a small VPS — under a hostname you own. Because it is now reachable from the internet, it checks every request. The hosting platform or a reverse proxy must terminate TLS before forwarding plain HTTP to the service. Your app adds one route that hands the browser a short-lived pass naming the signed-in user. The service checks the pass by itself, with no call back to your app, and lets the request through or refuses it. Live collaboration runs on the same deployment: the service keeps a working copy of the documents people are editing, and loads and saves the record through your app’s own document routes.',
    runsService: true,
    whatToRun: [
      {
        label: 'Deploy the service under a hostname you own',
        language: 'bash',
        // The secret rides an environment variable, not a flag: a flag lands in
        // the machine's process list, where anyone with a shell can read it.
        code: `docker run \\
  -p 127.0.0.1:4000:4000 \\
  --mount type=volume,source=blok-server-data,target=/data \\
  -e BLOK_SECRET \\
  ghcr.io/jackuait/blok-server \\
  --listen 0.0.0.0:4000 \\
  --auth ticket \\
  --allow-origin https://myapp.com \\
  --storage-dir /data \\
  --public-url https://blok.myapp.com/files`,
      },
      {
        label: 'The same service, with live collaboration',
        language: 'bash',
        // The working copy gets its own volume: --collab-dir may not live
        // inside --storage-dir, because everything there is served publicly.
        // BLOK_DOC_ENDPOINT_AUTH rides an env var for the same reason the
        // secret does.
        code: `docker run \\
  -p 127.0.0.1:4000:4000 \\
  --mount type=volume,source=blok-server-data,target=/data \\
  --mount type=volume,source=blok-collab,target=/collab \\
  -e BLOK_SECRET \\
  -e BLOK_DOC_ENDPOINT_AUTH \\
  ghcr.io/jackuait/blok-server \\
  --listen 0.0.0.0:4000 \\
  --auth ticket \\
  --allow-origin https://myapp.com \\
  --storage-dir /data \\
  --public-url https://blok.myapp.com/files \\
  --collab \\
  --collab-dir /collab \\
  --doc-endpoint https://myapp.com/api/documents`,
      },
    ],
    appRoute: [
      {
        label: 'Add one route that hands out a pass',
        language: 'typescript',
        code: `// app/api/blok-ticket/route.ts
import { blokTicket } from '@bloklabs/server/ticket';

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return new Response('Not signed in', { status: 401 });
  }

  // With live collaboration on, the editor asks for a pass naming the
  // document it is opening (?doc=…). This is where your own permission
  // check runs: refuse here and that person never gets in. A collaboration
  // pass is checked once, when the connection opens, so it gets a longer
  // life than the five-minute upload default.
  const doc = new URL(request.url).searchParams.get('doc');

  return Response.json({
    ticket: blokTicket(process.env.BLOK_SECRET, {
      user: session.userId,
      write: true,
      ...(doc === null ? {} : { doc, ttlSeconds: 30 * 60 }),
    }),
  });
}`,
      },
      {
        label: 'The same route, if your backend is not JavaScript',
        language: 'typescript',
        code: `// A pass is a standard HS256 JWT and nothing more. Every language has a
// one-line library for it; this is spelled out so you can see there is no
// magic in it, and so you can port it wherever your backend lives.
//
//   header   {"alg":"HS256","typ":"JWT"}   these two keys, in this order
//   claims   user   your own user id, stored but never interpreted
//            doc    for live collaboration, the one document this pass
//                   may open; upload and preview routes ignore it
//            write  false may read previews; uploads need true
//            exp    seconds since the epoch; keep the life short
//   secret   the same BLOK_SECRET the service runs with, 32 chars or more
//
// Both segments are base64url with the padding stripped, joined with a dot,
// and the signature is HMAC-SHA256 over that string, base64url again.
import { createHmac } from 'node:crypto';

const b64 = (value: string) => Buffer.from(value).toString('base64url');

const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const body = b64(
  JSON.stringify({
    user: session.userId,
    write: true,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  }),
);
const signature = createHmac('sha256', process.env.BLOK_SECRET ?? '')
  .update(\`\${head}.\${body}\`)
  .digest('base64url');

const ticket = \`\${head}.\${body}.\${signature}\`;`,
      },
    ],
    editorConfig: {
      label: 'Point the editor at the service, carrying the pass',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';

new Blok({
  holder: 'editor',
  server: 'https://blok.myapp.com',
  // The editor fetches a pass from this route, keeps it, and replaces it
  // shortly before it expires. Uploads and link previews share one; live
  // collaboration asks the same route for its own, naming the document.
  ticket: '/api/blok-ticket',
  // Live collaboration. Everyone who opens the same doc edits together, and
  // the name and color are what the other people see.
  collaboration: {
    doc: 'article-42',
    user: { name: 'Jack', color: '#f60' },
  },
});`,
    },
    failureModes: [
      {
        symptom: 'The service refuses to start and complains about the secret.',
        cause: 'The shared secret is shorter than 32 characters, or missing. A short one is almost always a password somebody typed.',
        fix: 'Generate a long random one with openssl rand -base64 48, and put it in the BLOK_SECRET environment variable on both sides — the service and the app that mints passes have to hold the same string.',
      },
      {
        symptom: 'The service refuses to start and asks for an origin.',
        cause:
          'A service anyone can reach, with no list of who may call it, can be used to fire requests at other sites from your address. It will not start that way.',
        fix: 'Pass --allow-origin with your app’s address. List several by separating them with commas.',
      },
      {
        symptom: 'Every request comes back 403 "origin not allowed", including ones from your own scripts.',
        cause:
          'In this mode the service refuses anything that does not say which site it came from. Browsers omit that on same-origin requests, and non-browser callers omit it entirely.',
        fix: 'Send an Origin header that matches one of the --allow-origin values, and check for typos: the scheme and port are part of the match.',
      },
      {
        symptom: 'A signed pass can load link previews but cannot upload files.',
        cause: 'A pass with write: false may call only the unfurl route. Both upload routes require write: true.',
        fix: 'Mint upload passes with write: true. Use write: false when a caller should be limited to link previews.',
      },
      {
        symptom: 'Uploads worked, then started coming back 401 after the tab had been open a while.',
        cause: 'The pass expired. That is what makes it safe to hand to a browser.',
        fix: 'Mint a new one per request, as the uploader config above does. Give it a lifetime measured in minutes or hours, not days.',
      },
      {
        symptom: 'Uploads keep working but link previews start failing after an hour.',
        cause:
          'The bookmark tool takes a fixed set of headers when the editor is created, so it keeps sending the pass it was given at startup.',
        fix: 'Give the bookmark tool a longer-lived pass, or route link previews through a small endpoint in your own app that adds a fresh one.',
      },
      {
        symptom: 'Uploads work, but a live-collaboration session drops the moment it opens.',
        cause:
          'The pass was turned away at the collaboration door. A collaboration pass must name the document being opened in its doc claim and still be alive when the editor connects; a pass without the claim, for a different document, or already expired is refused.',
        fix: 'Mint collaboration passes with doc set to the document being opened, after checking that user may see it, and give them about 30 minutes of life.',
      },
      {
        symptom: 'A document opens read-only with a reconnecting notice and never becomes editable.',
        cause:
          'The service could not load the document from your routes — the --doc-endpoint address is wrong, the endpoint is down, or it refused the request. Rather than open an empty document and later save it over your record, the service refuses the session, and the editor shows the last copy it has read-only while it retries.',
        fix: 'Check that --doc-endpoint points at your document routes and that BLOK_DOC_ENDPOINT_AUTH holds the header value they expect. Once the endpoint answers, the next retry connects and the document becomes editable.',
      },
    ],
  },
];

/**
 * What an operator should read before deploying, not after. Each of these is a
 * decision the service made on purpose, so the answer is never "we will fix it".
 * The link-preview coverage limit is not here because it leads the page.
 */
export const serverLimits: ServerLimit[] = [
  {
    id: 'no-documents',
    title: 'Documents stay yours; the service keeps only a working copy',
    body: 'Saving and loading documents stays a small endpoint in your own app — the same place your permission check already lives. That endpoint remains the record: it is what lands in your backups, and it is what you clean when someone asks you to delete their data. Live collaboration adds one moving part: while people edit together, the service keeps a working copy of the open document, in storage you point it at, and writes what people type back to your endpoint every few seconds. Losing that working copy costs at most the few seconds of changes not yet written back; the next open starts fresh from your endpoint. A write-back your endpoint refuses is retried with a growing delay rather than dropped, and a document whose last write-back has not landed stays loaded until it does, even after everybody has left it — so a short outage at your endpoint costs time, not edits. Those same few seconds are a lag in the other direction too: your record trails what the people in the document are looking at, so an export, a report or another service reading your database sees the document as of the last write-back rather than as of the keystroke someone just typed.',
  },
  {
    id: 'collab-replaces-persistence',
    title: 'With live collaboration on, your app stops saving the document itself',
    body: 'The editor’s own persistence option — the load and save callbacks a single-player editor uses to talk to your endpoint — cannot be combined with collaboration. The editor refuses the pair the moment it is created and says which one to drop, because the document would otherwise have two owners writing the same record from two places. Nothing is lost in the trade: the service loads the document from your document endpoint and writes it back to the same route, so it is your endpoint either way, called from the service instead of from the browser. The same goes for saving by hand — onChange and onSave keep firing while people edit together, including for the edits other people make, which is deliberate so a form bound to the editor stays current. Do not write what they hand you back into your record: that is the service’s job now, and a second writer only fights it.',
  },
  {
    id: 'working-copy-privacy',
    title: 'The working copy must not be publicly readable',
    body: 'While people edit together, the working copy lives in the folder you name with --collab-dir, or under the S3 prefix you set with --collab-s3-prefix. It holds document content, so it must not be publicly readable: uploaded files are meant to be served to anyone with the link, the working copy is meant for the service alone. That is also why the service refuses to put it inside the uploads directory — everything there is served. Two things about the folder --collab-dir names: a file the service cannot read is renamed beside itself with an .unreadable- suffix and the document is then loaded fresh from your endpoint, so one damaged file never wedges a document; and temporary files left behind by a writer that died mid-write are deleted when the service starts. Wherever the working copy lives, one written in a format this service does not read fails the open instead of being guessed at — the log names the format, and the file has to be removed before that document opens again.',
  },
  {
    id: 'collab-reset',
    title: 'Changing a document from outside: two calls, and when to use which',
    body: 'While a document is open for live collaboration, the working copy wins: a change written straight into your own records will be overwritten the next time the service writes the document back. So there are two ways in from the outside, and both take a write pass for that document. For a change to a few blocks — a status flipped by a workflow, a field filled in by a job — POST /sync/{doc}/edit with a list of what to insert, update or remove; the change lands in the document, appears in everybody’s tab within moments, and gets written back to your records like any other edit. The whole request is one step: if any part of it is refused, nothing is applied. The service writes the change into the working copy before it answers 204, so a crash a moment later does not lose it; if that write fails it still answers 204, says so in its log and keeps the document loaded until the write lands. Your own records still trail by the write-back delay either way. Two refusals to plan for, both 422 with nothing applied: placing a block under a parent that has no children list, and an `after` the parent’s children list does not hold. Each answer names the step and the block: `collab: op 0: block "p1" has no children list, so nothing can be placed under it.` and `collab: op 0: block "b7" is not in the document order, so nothing can be placed after it.` Inserts apply one after another against the document as it stands, so two inserts naming the same `after` land in reverse order — chain them, each naming the one before it, to append in order. For replacing a document wholesale — a migration, a support fix — save your version to your own records first, then call POST /sync/{doc}/reset: the service throws its working copy away, loads the document fresh from your endpoint, and tells every open tab to drop what it had and pick up the new version. Nobody has to close anything either way. Editing a document nobody has open works too; the service loads it for the occasion. One more thing closes the gap between your save and the reset: once your endpoint answers with a version, every write-back carries the last one it gave in a Blok-Doc-Version header, and that header is your optimistic-concurrency handle. Bump the version on your own save and answer a stale PUT with 409; the service treats it as a failed write-back and retries, and stays refused until the reset loads your version, so a write already on the wire when you save cannot land over it.',
  },
  {
    id: 'doc-endpoint-auth',
    title: 'Your document endpoint keeps its own login check',
    body: 'The service calls your document endpoint twice over: it loads a document the first time someone opens it, and it writes changes back while people edit. If that endpoint requires login — and it should — put the header value it already expects into the BLOK_DOC_ENDPOINT_AUTH environment variable, Bearer and all. The service sends it verbatim on every call. Your route, your auth scheme, nothing new to build. One rule on the value: it must be a single line. A carriage return or newline in it stops the service from starting and says so — a trailing newline from `echo` or from a file is the usual cause — because a header carrying one would be dropped from every call with nothing to see anywhere. The same value can be passed as --doc-endpoint-auth instead, but the service warns against that: a flag puts the credential in the machine’s process list.',
  },
  {
    id: 'collab-new-documents',
    title: 'A brand-new document must answer with nothing, not 404',
    body: 'When the first person opens a document, the service asks your document endpoint for it. For a document you have never saved, answer 200 with null (or { "data": null }) — that means "nothing yet", and the editor starts empty. A 404, a 5xx or an unreachable endpoint is treated as a failure, not as "new": the editor shows a reconnecting notice and nobody can start editing, because seeding an empty document over a record that merely failed to load would later overwrite it. It also means a mistyped --doc-endpoint path fails loudly at the first open instead of quietly emptying your documents.',
  },
  {
    id: 'file-origin',
    title: 'Serve uploaded files from a different hostname than your app',
    body: 'A file someone uploads is served by whatever hostname you put it on, and a browser trusts a page by its hostname. So if uploads are served from the same hostname as your app, a file someone uploads can act as if it were one of your own pages — read the signed-in user’s session, call your API as them. The service sends Content-Disposition: attachment and X-Content-Type-Options: nosniff so a browser downloads such a file instead of running it, but putting uploads on a different hostname from your app (uploads.myapp.com, or an S3 bucket’s own address) is the only complete answer.',
  },
  {
    id: 'asset-cors',
    title: 'The hostname serving your uploads has to answer CORS',
    body: 'Five things in the editor read an uploaded file back after it is stored: the audio player fetches the track to draw its waveform, the image block fetches a GIF before turning it into a video and an SVG to read its real size, the file block fetches a document to show a preview, and the image download button fetches the picture so the browser saves it rather than opening it. Once uploads are served from their own hostname every one of those is a cross-origin request, and the browser refuses it unless the response carries Access-Control-Allow-Origin for your app. Each of them is written to give up quietly rather than break the block, so instead of an error you get a player with no waveform, a GIF that stays a still image, an SVG at the wrong size, a preview that never appears and a download that opens the file instead of saving it — nothing in Blok reports why. Allow your app’s origin on the bucket or hostname the files are served from.',
  },
  {
    id: 's3-untested',
    title: 'The S3 support has not met a real bucket yet',
    body: 'Uploading to S3-compatible storage is built and covered by tests, but those tests check the request against our own reading of the specification — it has never been run against a real bucket, at AWS or anywhere else. Try it on a throwaway bucket before you rely on it. If the storage refuses a request, the service passes the storage’s own explanation through, so the message you see is the one that endpoint sent.',
  },
  {
    id: 'cors-preflight',
    title: 'A browser calling the service directly needs --allow-origin',
    body: 'Every request that carries an Origin must match an address listed with --allow-origin, in every auth mode. In none and proxy modes, an originless request marked Sec-Fetch-Site: cross-site is also refused, while a genuine server-to-server backend request that carries neither header still works. Ticket mode always requires an allowed Origin. Preflight requests follow the same allowlist.',
  },
  {
    id: 'upload-by-url-json',
    title: 'Remote uploads accept JSON requests only',
    body: 'POST /upload-by-url requires Content-Type: application/json. Parameters such as charset=utf-8 are allowed, but other media types — including application/problem+json — receive 415 before the service fetches the URL.',
  },
  {
    id: 'proxy-rate-limit',
    title: 'Behind your own app, the rate limit is one allowance for everybody',
    body: 'The service limits how often a caller may make it fetch a URL. When --rate-limit is omitted, ticket mode allows 60 requests a minute per caller; otherwise the limit is 0, which turns it off. Any explicit value must be zero or greater. It tells callers apart by the address the request came from, and when your app forwards every request, every request arrives from the same address — so the whole deployment shares one allowance and one busy user can use it up. Limiting per user belongs in your own app, on the forwarding route, where you already know who is signed in. This does not apply on the third path, where the pass names the user and each user is counted separately.',
  },
  {
    id: 'ticket-not-scoped',
    title: 'A pass names a user; a collaboration pass also names its document',
    body: 'A pass always says who is holding it and whether they may write. For uploads and link previews that is all the service reads: those routes do not confine the holder to one document, so a pass handed to someone who opened a single page works for every upload and every preview that page can make, for as long as the pass lives. Live collaboration is stricter: a collaboration pass also names the document it may open, the service checks that name at the door, and a pass that names no document — or a different one — is turned away. It has to name its user as well, because the connection cap and the per-minute allowance both key on that name; a collaboration pass with an empty user is refused instead of being pooled with every other anonymous one. Keep the life short either way, hand a pass out only from a route that has already checked who is signed in, and keep the per-document check for uploads in your own app, where you know which document is open.',
  },
  {
    id: 'collab-pass-lifetime',
    title: 'Give a collaboration pass about 30 minutes',
    body: 'An upload pass is checked on every request, so a few minutes of life is right for it. A collaboration pass is checked once, when the connection opens, and the connection then outlives it — so the pass has to be alive at the moments the editor connects and reconnects. Around 30 minutes is the balance: short enough that a leaked pass ages out quickly, long enough that a laptop waking up or a network blip does not fail because the pass died in between. Taking someone’s access away works the same way: it applies the next time they reconnect, not mid-connection.',
  },
  {
    id: 'collab-connection-cap',
    title: 'Eight live connections per person per document',
    body: 'In ticket mode, where the browser carries a pass, one person may hold up to eight open collaboration connections to one document — every tab counts as one — and the ninth is refused with "too many connections" (HTTP 429) until one of them closes. A collaboration pass has to name a user: one that names none is turned away at the door with "pass names no user" (close code 4401), because behind a proxy every such pass would share one cap and one rate window with all the others. When the service runs inside your own ASP.NET app and your login check has named the user, that user is what is counted. Behind your own app or proxy — the none and proxy modes of the standalone service — there is no cap at all, because nothing there names the person: every connection arrives from the one proxy address, and a shared cap would throttle everyone together. If you need a limit there, put it in the proxy, where you already know who is signed in.',
  },
  {
    id: 'collab-connection-ceiling',
    title: '1,024 live connections per process, everybody together',
    body: 'The cap above counts one person; this ceiling counts everybody together, in every auth mode: with --collab on, the standalone service holds at most 1,024 open collaboration connections per process, so a flood of connections that are opened and then simply held cannot use up every connection the process can hold. The service keeps that count itself, so past the ceiling a new connection is refused with "too many connections on this server" (HTTP 503) — before the document is loaded, so nothing is fetched from your endpoint for a connection that will not run — until one of the open ones closes. Inside your own ASP.NET app there is no ceiling unless you set CollabMaxConnections, where 0 means none. Give it the same number as Kestrel’s MaxConcurrentUpgradedConnections, which stays the backstop underneath and refuses later and less usefully: it lets the document load first and then answers 500.',
  },
  {
    id: 'collab-scale-out',
    title: 'To scale out, split the documents across processes',
    body: 'While a document is open, exactly one service process holds its working copy in memory, and every connection to that document must reach that same process. Two processes opening the same document would each keep a copy of their own and take turns overwriting each other’s work in storage. So more processes only help if each document belongs to one of them — and the split is simple, because the document id is right in the connection address: route by the document id, so every request whose path starts with /sync/{doc} lands on the same process. Anything deterministic works, from "ids starting with a through m go to the first process" to a hash of the id; and because the reset call lives under the same path, it automatically reaches the process that owns the document. Each process then carries its own share of the documents, with its own connection ceiling, and all of them may share one storage folder or bucket and one document endpoint, because no two of them ever open the same document. Uploads and link previews hold nothing in memory, so those requests may go to any process. There is no built-in coordination behind this — the processes do not know about each other, and nothing in the service stops a routing mistake from opening one document twice. The routing rule is the guarantee, and it is yours to keep.',
  },
  {
    id: 'collab-what-is-not-limited',
    title: 'What the service does not limit for you',
    body: 'There is no cap on how many documents one person may have open, on how large a document may grow, or on how often an unknown document id makes the service ask your document endpoint for a seed — those are your records and your rules, so if you need such limits, put them in your own backend, where the permission check already lives. What the service does bound is one connection: a single message is at most 1 MiB and a bigger one closes the connection; a browser that has stopped taking messages — a frozen tab, a dead network — is closed once the messages waiting for it pass 8 MiB, and catches up when it reconnects (inside your own ASP.NET app, CollabMaxMessageBytes moves both numbers together); a connection that floods the service — more than about 50 messages a second once a burst of 100 is used up, more than 60 requests a minute to resend the whole document or to ask everyone present to re-announce themselves, or one message split into an absurd number of pieces (the allowance is sixteen pieces plus one more for every 64 bytes the message carries, so a flood of empty fragments ends at the seventeenth) — is closed with "inbound rate exceeded" (code 1008), and the editor reconnects; presence is counted in bytes as well, about 128 KiB a second per connection after a burst of about 512 KiB, and flooding it earns that same close (inside your own ASP.NET app the knobs are CollabInboundFramesPerSecond, CollabInboundBurstFrames, CollabInboundResyncsPerMinute and CollabInboundAwarenessBytesPerSecond; 0 turns any of the rates off); and opening a connection spends the same per-minute --rate-limit budget as every other route. Beyond those five, an open connection is not limited. The service tells the editor the message-size limit when it connects, so the editor refuses to send something too big instead of being disconnected for it. One rule is about shape rather than size: the sync wire is binary, so a text message closes the connection with "binary frames only" (code 1003). Blok’s editor never sends one, so that close means something else is talking to the route.',
  },
  {
    id: 'collab-what-is-not-checked',
    title: 'What the service does not check for you',
    body: 'The service checks the shape of what a write pass sends, not its meaning, so three things pass through that are worth knowing. A lone surrogate — half of a UTF-16 pair, which typing never produces but a script can — becomes U+FFFD on the wire, so every replica, including that browser’s own copy after a reload, reads the replacement character. An update that integrates nothing because the changes it depends on never arrive is relayed and persisted like any other, not refused — a duplicate delivery and a legitimately out-of-order change look the same from outside — so a writer who keeps sending them grows the working copy until the document is evicted from memory, and nothing else bounds it. And anything arriving through the document — another browser, or an edit request — can place a block under a container whose childTools denies it: the editor places it where the document says and logs a warning naming the child and the container; it does not demote it, because demoting would write back and loop against the peer. The one thing that does not pass through is a block the reader cannot make sense of: one whose id or type is not text, or whose data is not a set of fields, is left out of the saved document with a warning naming it, and a value nested more than 256 levels deep is saved as null. The editor and the service do exactly the same thing here, so what a browser saves and what the service writes back to your records agree block for block.',
  },
  {
    id: 'collab-connection-states',
    title: 'Read-only until the first sync, editable through a dropped connection',
    body: 'A document opens read-only and stays that way until the first sync arrives: the editor never starts from a copy of its own, because two browsers each starting from their own copy and then syncing would duplicate every block. Once that first sync lands the document becomes editable — as long as the pass grants write and your app has not put the editor in read-only itself. After that the behaviour is deliberately asymmetric: if the connection drops, the document stays editable. What gets typed piles up in that tab and is shipped as one difference the moment it reconnects, so a tunnel or a sleeping laptop does not freeze the page under someone’s hands. The editor reports each step on the collaboration:status event — connecting, connected, offline while it keeps retrying, or error when it has stopped for good and will not reconnect by itself — with the list of people present, so you can render your own indicator in the shape your product already uses. Blok does not paint one for you.',
  },
  {
    id: 'collab-offline-reload',
    title: 'A reload while it says offline loses what was typed offline',
    body: 'By default those offline edits live in that tab and nowhere else until it reconnects: reload, close it or lose the browser before that happens and they are gone, because the tab was holding the only copy and nothing had reached the working copy or your records yet. Turning on the editor’s offline option changes that — it keeps a copy of the document in that browser, so a reload picks the work back up and sends it on the next connection. It is off unless you ask for it, because it writes document content into the visitor’s browser storage, which is a decision about your data rather than about the editor. Two things to know about the copy: nothing is kept until the first successful sync, so an editor that never reached the service still cannot start from a copy of its own; and the copy is thrown away whenever the service says its history no longer matches — after a reset, for instance — so a stale copy can never be mistaken for the live document. One thing to weigh before turning it on: that copy belongs to the browser, not to the person signed in, so on a shared computer the next person to open the page sees the previous one’s document on screen for a moment before the service turns them away. Without it, the guidance stays the plain one: while the editor says it is offline, leave the tab alone and let it reconnect.',
  },
  {
    id: 'collab-merge-granularity',
    title: 'Two people in one field: the last write wins',
    body: 'Edits to different blocks merge cleanly, and so do edits to different fields of the same block — one person retitling a heading while another ticks a checklist item never collide, and neither loses anything. Inside one field it is coarser. Two people typing in the same paragraph at the same moment do not get their letters woven together: whichever change lands last is the one everybody keeps, and the other is dropped. Notion behaves the same way, and so does every editor that syncs whole fields rather than characters. Character-by-character merging is a later phase. In practice two people rarely type in one sentence at once, and presence is there so they can see when they are about to.',
  },
  {
    id: 'collab-presence-identity',
    title: 'Who is here, and where they are',
    body: 'Blok draws presence itself: small avatars for the people in the document, a colored cursor where each of them is typing, and a small face with their initials parked in the margin beside the block they are in; the cursor pulses once they stop moving. Hover the face for the full name — the cursor itself carries no name tag, so a document with four people in it never becomes a wall of them. Both read the display identity you pass in the editor’s collaboration option — a name, and an optional color used for that person’s avatar, face and cursor. Leave it out and the person still shows up, just without a name on them. This is display only, and independent of the separate user option that stamps who last edited a block: one answers "whose cursor is that", the other answers "who gets the credit for this edit". Set either, both or neither. One thing the cursor does not do yet is shade the text somebody else has selected; that is a later phase.',
  },
  {
    id: 'collab-presence-unverified',
    title: 'Presence is not verified',
    body: 'The small avatars and cursors that show who is in the document are relayed exactly as each browser sends them, and the service never reads what they say — like every collaboration server built on the same sync protocol. It does check their shape, because a presence message the receiving browsers cannot read ends their session: every one is walked, and each person’s state has to be valid JSON. One that is not is dropped and written to the log, and the third bad one from a single connection closes it with "malformed awareness" (code 1008); the editor reconnects as it always does. What is never checked is what presence claims: any participant, including one holding a read-only pass, can announce any name and any position. Document content is what the pass protects: who may open a document and who may change it is checked at the door. Presence is a courtesy signal for the people in the room, not an identity check, so never build permissions or an audit trail on it.',
  },
  {
    id: 'collab-presence-room-size',
    title: 'Presence covers up to 256 people in one document',
    body: 'A document relays presence — the avatars, and the cursor showing where each person is typing — for up to 256 people at once. Past that the presence updates are dropped instead of passed on, and the service writes a line to its log saying so. That is a drop and nothing more: a crowded room costs nobody their connection, unlike a presence message the service cannot parse at all. Editing is untouched: everyone keeps typing, and every change still merges and reaches your records as usual. So if a document ever gets that crowded, what breaks is people seeing each other, not people working — this is a presence-only degradation, not a limit on how many may edit one document. There is no setting for the number; it is fixed inside the service.',
  },
  {
    id: 'collab-doc-id-shape',
    title: 'A document id is one path segment',
    body: 'The document id travels in the connection address (/sync/{doc}) and inside the pass, and the two must match character for character, so it has to be one path segment: letters, digits, dashes, underscores and dots are safe. A slash — even an encoded one — is refused at the door with a clear message, "document ids must be a single path segment", instead of failing later as a pass that mysteriously names another document. Use your own opaque ids; if your records are addressed by paths, map each path to a token on your side and hand the editor the token.',
  },
  {
    id: 'tls-termination',
    title: 'Terminate TLS before internet traffic reaches the service',
    body: 'The standalone host speaks plain HTTP and does not terminate TLS or manage certificates. An internet-facing deployment must sit behind a reverse proxy or hosting platform that accepts HTTPS and forwards HTTP over a private or loopback connection. Never send a ticket over plain internet traffic.',
  },
];
