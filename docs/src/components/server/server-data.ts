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
      'Run nothing. The browser uploads to the storage you already pay for, using a ready-made uploader from @bloklabs/presets. This is the cheapest path and it is the one most people should take. The one thing it cannot do is link previews: the browser is not allowed to fetch another site and read its page, so a preview needs some server somewhere. If you want previews too, keep this uploader and add the service for that one feature — the two do not conflict.',
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
    ],
  },
  {
    id: 'dotnet',
    title: 'Your app runs ASP.NET Core',
    situation: 'You want Blok routes inside the .NET app that already owns your users and deployment.',
    description:
      'Install the ASP.NET Core package and map the shared C# handlers in your existing process. There is no second host, port or container to operate. Your application authorization policy protects uploads and link previews. IBlokAuthorization is the document and database permission seam for later document routes; it is not the upload or link-preview gate. The editor calls the route prefix you choose, and database blocks and MySQL integration come later. The package also converts saved documents in-process — to Markdown, HTML or plain text, and back from Markdown — running Blok\'s own implementation rather than a C# port of it, which is how a port silently loses every block it was never taught.',
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

builder.Services
  .AddBlokServer(options =>
  {
    options.StorageDirectory = "./blok-uploads";
    options.PublicUrl = "https://uploads.example.com/files";
    options.UnfurlDisabled = false;
  })
  .UseAuthorization<AppBlokAuthorization>();

var app = builder.Build();

app.MapBlokServer("/api/blok").RequireAuthorization();`,
      },
      {
        label: 'Convert documents — no storage, no route',
        language: 'csharp',
        code: `using Blok.Server.Documents;

// Registers the converter on its own. AddBlokServer includes it, but a service
// that only reads documents does not have to configure a bucket to get one.
builder.Services.AddBlokDocuments();

// Anywhere you already have the saved JSON — an MCP tool, an agent, an export.
public sealed class ArticleExport(IBlokDocumentConverter blok)
{
  public async Task<string> ToMarkdownAsync(string contentJson, CancellationToken ct)
  {
    var conversion = await blok.ToMarkdownAsync(contentJson, ct);

    foreach (var warning in conversion.Warnings)
    {
      // e.g. block "callout", action "degraded", detail "rendered as a blockquote…"
      logger.LogInformation("{Block} {Action}: {Detail}", warning.Block, warning.Action, warning.Detail);
    }

    return conversion.Markdown;
  }
}`,
      },
    ],
    editorConfig: {
      label: 'Point the editor at the mapped routes',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';
import { fetchStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: fetchStorage({ baseUrl: '/api/blok' }),
  tools: {
    bookmark: { config: { endpoint: '/api/blok/unfurl' } },
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
    ],
  },
  {
    id: 'own-server',
    title: 'You run your own backend',
    situation: 'You have a Django, Rails, Laravel, Node or Go app running on a machine you control.',
    description:
      'Run the service next to your app, listening only on 127.0.0.1. That address is reachable from your own machine and from nowhere else, so nothing on the internet can call it. Your app gets one new route that passes the request through, and your existing login check guards that route the same way it guards everything else. There is no second set of users, no second password, and no domain or certificate to arrange.',
    runsService: true,
    whatToRun: [
      {
        label: 'Start the service beside your app',
        language: 'bash',
        code: `docker run --network host ghcr.io/jackuait/blok-server \\
  --listen 127.0.0.1:4000 \\
  --auth proxy \\
  --storage-dir /var/lib/blok-uploads \\
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
  createProxyMiddleware({ target: 'http://127.0.0.1:4000', pathRewrite: { '^/api/blok': '' } }),
);`,
      },
    ],
    editorConfig: {
      label: 'Point the editor at your own route',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';
import { fetchStorage } from '@bloklabs/presets';

new Blok({
  holder: 'editor',
  uploader: fetchStorage({ baseUrl: '/api/blok' }),
  tools: {
    bookmark: { config: { endpoint: '/api/blok/unfurl' } },
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
      'There is no machine to sit the service next to, so it is deployed on its own — Fly, Railway, Render, a small VPS — under a hostname you own. Because it is now reachable from the internet, it checks every request. Your app adds one route that hands the browser a short-lived pass naming the signed-in user. The service checks the pass by itself, with no call back to your app, and lets the request through or refuses it.',
    runsService: true,
    whatToRun: [
      {
        label: 'Deploy the service under a hostname you own',
        language: 'bash',
        // The secret rides an environment variable, not a flag: a flag lands in
        // the machine's process list, where anyone with a shell can read it.
        code: `docker run -p 4000:4000 -e BLOK_SECRET ghcr.io/jackuait/blok-server \\
  --listen 0.0.0.0:4000 \\
  --auth ticket \\
  --allow-origin https://myapp.com \\
  --storage-dir /var/lib/blok-uploads \\
  --public-url https://blok.myapp.com/files`,
      },
    ],
    appRoute: [
      {
        label: 'Add one route that hands out a pass',
        language: 'typescript',
        code: `// app/api/blok-ticket/route.ts
import { createHmac } from 'node:crypto';

const b64 = (value: string) => Buffer.from(value).toString('base64url');

export async function GET() {
  const session = await getSession();

  if (!session) {
    return new Response('Not signed in', { status: 401 });
  }

  // A standard JWT. Every language has a one-line library for this; it is
  // spelled out here so you can see there is no magic in it.
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

  return Response.json({ ticket: \`\${head}.\${body}.\${signature}\` });
}`,
      },
    ],
    editorConfig: {
      label: 'Point the editor at the service, carrying the pass',
      language: 'typescript',
      code: `import { Blok } from '@bloklabs/core';
import { fetchStorage } from '@bloklabs/presets';

const SERVICE = 'https://blok.myapp.com';

// Called before every upload, so an expired pass is replaced without a reload.
const authHeaders = async () => {
  const { ticket } = await fetch('/api/blok-ticket').then((r) => r.json());

  return { Authorization: \`Bearer \${ticket}\` };
};

new Blok({
  holder: 'editor',
  uploader: fetchStorage({ baseUrl: SERVICE, headers: authHeaders }),
  tools: {
    bookmark: { config: { endpoint: \`\${SERVICE}/unfurl\`, headers: await authHeaders() } },
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
    title: 'Your documents are never stored here',
    body: 'The service stores no documents. There is no database inside it and no route that saves one. That is on purpose: a document belongs to your users and your permissions, has to appear in your backups, and has to be deletable when someone asks you to delete their data. Every one of those turns into a piece of plumbing the moment the record lives in someone else’s system. Saving and loading stays a small endpoint in your own app — the same place your permission check already lives.',
  },
  {
    id: 'file-origin',
    title: 'Serve uploaded files from a different hostname than your app',
    body: 'A file someone uploads is served by whatever hostname you put it on, and a browser trusts a page by its hostname. So if uploads are served from the same hostname as your app, a file someone uploads can act as if it were one of your own pages — read the signed-in user’s session, call your API as them. The service sends Content-Disposition: attachment and X-Content-Type-Options: nosniff so a browser downloads such a file instead of running it, but putting uploads on a different hostname from your app (uploads.myapp.com, or an S3 bucket’s own address) is the only complete answer.',
  },
  {
    id: 's3-untested',
    title: 'The S3 support has not met a real bucket yet',
    body: 'Uploading to S3-compatible storage is built and covered by tests, but those tests check the request against our own reading of the specification — it has never been run against a real bucket, at AWS or anywhere else. Try it on a throwaway bucket before you rely on it. If the storage refuses a request, the service passes the storage’s own explanation through, so the message you see is the one that endpoint sent.',
  },
  {
    id: 'cors-preflight',
    title: 'A browser calling the service directly needs --allow-origin',
    body: 'Before sending a request with unusual headers, a browser first asks the destination whether it is allowed. The service answers that question only for addresses you listed with --allow-origin, and in loopback-only modes there is no such list by default. This never comes up on the second path, where the browser talks to your app and your app talks to the service. It comes up when you point the editor straight at the service and send a custom header — a plain GET needs no permission and works either way.',
  },
  {
    id: 'proxy-rate-limit',
    title: 'Behind your own app, the rate limit is one allowance for everybody',
    body: 'The service limits how often a caller may make it fetch a URL. It tells callers apart by the address the request came from, and when your app forwards every request, every request arrives from the same address — so the whole deployment shares one allowance and one busy user can use it up. Limiting per user belongs in your own app, on the forwarding route, where you already know who is signed in. This does not apply on the third path, where the pass names the user and each user is counted separately.',
  },
];
