# PDF preview on pdf.js — design

Date: 2026-11-13. Status: user decisions recorded 2026-11-13; awaiting approval of this document.

## Why

The file block's PDF preview shows only an "Open in new tab" link for any
http(s) PDF (commit `65211b09` stopped framing remote urls: an HTML response
ran script and could navigate the editor tab; a sandbox kills Chrome's PDF
viewer). Blob PDFs show in the browser's native viewer, which:

- looks different in every browser and has its own toolbar;
- cannot be tested headless (Chromium headless has no viewer, Playwright
  Firefox turns it off, Playwright WebKit crashes on framed PDFs);
- reportedly shows only page 1 on iOS (unverified, Apple forum reports).

The user wants Blok to show any PDF inline, and chose to do it with pdf.js.

## Goals

- PDFs render inside the preview modal with pdf.js, in a Blok-styled viewer,
  in Chromium, Firefox and WebKit.
- Remote http(s) PDFs show inline whenever Blok can get the bytes: directly,
  through a host hook, or through the Blok server.
- The viewer is testable headless (unit + e2e).

## Non-goals

- An in-house PDF engine (~55–60k lines; rejected).
- Isolating pdf.js in a sandboxed frame ("Option B"). Possible later.
- Third-party viewers (Google/Microsoft): unreliable and leak the url.
- Editing, annotating, form filling, printing.

## Anti-goals (a failure even if it "works")

- Framing an http(s) url again, in any form.
- Any blue selected state, any hint without hover delay, any raw colour
  outside a `--blok-*` token (CLAUDE.md laws).
- A link from inside a PDF that bypasses the URL-sink law.
- Keeping every rendered page in memory (one page canvas ≈ 13 MB at DPR 2).
- Shipping GPL files (pdf.js `standard_fonts` are Liberation/GPLv2).

## Approaches considered (isolation)

| | A. pdf.js in the editor page, parsing in a worker | B. pdf.js in a sandboxed opaque-origin frame |
|---|---|---|
| Containment of a pdf.js bug | none beyond the worker boundary | frame cannot reach the editor's origin |
| Complexity | low; MapLibre precedent | IIFE builds, nonce config, link/asset relays, worker fallbacks with timeouts |
| Strict host CSP | worker falls back to main thread, still renders | works only with a host nonce / allowed asset url |
| Hang in pdf.js | freezes the editor | also froze the editor (measured, shared thread) |

**Picked: A** (user, 2026-11-13). pdf.js 6.5 has no `eval`/`new Function`
path (the CVE-2024-4367 route is gone); risk is managed by pinning and
updating pdf.js. B stays a possible follow-up.

## Design

### 1. Packaging (my call, from research)

- `pdfjs-dist` as an exact-pinned devDependency compiled into `dist`, like
  `maplibre-gl` (`src/tools/database/maplibre-runtime.ts`, `maplibre-loader.ts`).
  No `dependencies`/`peerDependencies` (law: blok-scope-rename.test.ts).
- Use the **legacy** build. Load it only on first PDF open via `import()`.
- Worker: import its source with `?raw`, run it from a blob url
  (`GlobalWorkerOptions.workerSrc`). A strict CSP that forbids `worker-src blob:`
  makes pdf.js fall back to the main thread; that is acceptable. Add the
  blob-url-law exemption with a reason.
- Feature check: if `Promise.try` or `URL.parse` (after the legacy polyfills)
  or module workers are missing — i.e. below Chrome 125 / Safari 18 — keep
  today's native-viewer path for blob PDFs and the link for http(s).
  Exact check is left to the builder; it must be a capability test, not UA sniffing.
- Assets: ship none by default. cmaps, wasm decoders and iccs are optional,
  loaded from a host-set base url (`file.pdf.assetsUrl`, name is builder's
  call). Without them CJK-without-embedded-font, JPEG 2000 and JBIG2 PDFs
  degrade. Never ship `standard_fonts` (GPL); `useSystemFonts` stays on.
- `useWasm: false` unless `assetsUrl` is set (wasm needs `'wasm-unsafe-eval'`).
- License: vendor-license test must see pdfjs-dist (Apache-2.0); verify the
  `?raw` import is picked up, add the text by hand if not.
- Types: hand-written in `types/tools/file.d.ts`; never `import type` from
  `pdfjs-dist` (published-types law).
- Tests: a lazy-chunk non-vacuity test like `bundle-outputs.test.ts:485`.
  UMD/IIFE bundles inline everything (+~1.9 MB raw each) — accepted.
- Code budget (USER, 2026-11-13): raise the ES parse-cost budget in
  `test/unit/build/bundle-outputs.test.ts` ("keeps the non-data ES code
  surface under the parse-cost budget", today 14.4 MiB) by what pdf.js
  measures after the build. Record the measured bytes and `USER, 2026-11-13`
  in its comment, like the MapLibre raise.

### 2. Viewer (my call, from research)

Own UI on the pdf.js core API (`getDocument`, `page.render`, `TextLayer`,
`AnnotationLayer`). Not `pdf_viewer.mjs`: its CSS sets blue defaults and
relative image urls.

- One scroller with placeholder boxes sized from `getViewport`; an
  IntersectionObserver renders visible pages ±2; pages that leave get a
  0-size canvas and `page.cleanup()`. Zoom re-renders visible pages only.
- Reuse `PreviewChrome` (`preview-chrome.ts`), `loadBinaryPreview`,
  `buildErrorInto`, the release pattern in `office-preview.ts`, and
  `preview-labels.ts` strings.
- Generalize `page-pager.ts` (today hard-wired to docx class names and
  measuring every page on scroll) so docx and PDF share it; PDF computes the
  current page from known sizes.
- Must:
  - fit width + zoom steps (same 50–200% as docx);
  - page counter and jump; PageUp/PageDown/Home/End;
  - text layer: selection and copy; own ~60 lines of CSS, selection via tokens;
  - links: own link service; external urls through `safeHttpHref`/`safeHref`,
    `rel="noopener noreferrer"`; internal links scroll by handler;
  - password prompt (NEED_PASSWORD / INCORRECT_PASSWORD);
  - error state for corrupt files (`InvalidPDFException`);
  - loading state with progress;
  - Download and Open in new tab in the header;
  - pages stay white paper in dark mode (like docx, `file.css`);
  - `aria-label` "Page N" per page;
  - `loadingTask.destroy()` on close; nothing left in memory.
- Should (same project, after must): find in PDF via `chrome.onKey`
  (Cmd/Ctrl+F), chunked text extraction; pinch zoom (`TouchManager`);
  thumbnail strip.
- Later: outline sidebar, print, renderer worker.
- Icon-button hints use Blok's delayed `onHover`, not native `title`.

### 3. Getting the bytes (my call, from research)

Order, first success wins:

1. `blob:` url → read → `getDocument({ data })` (pass a copy; keep the Blob
   for Download — `data` is transferred and detached).
2. Host hook `FileConfig.fetchPreview?(url, { signal }) => Promise<Blob | ArrayBuffer | Response>`
   (name is builder's call; shape matches `uploadByUrl` / `checkEmbed`).
3. Direct: `getDocument({ url })`, credentials same-origin (pdf.js default).
   pdf.js range-loads where the host exposes `Accept-Ranges`, else streams.
4. Blok server route (part 4) through a `PDFDataRangeTransport` that mints a
   fresh ticket per request.
5. Today's "Open in new tab" link.

A failed direct fetch logs a CORS error in the console; accepted.
Docx/pptx/xlsx/text previews may adopt the same chain later; not in scope.

### 4. Blok server (Go, C#, Rust — all three, shared conformance)

- `GET /file-bytes?url=` behind the same guard as `/unfurl` (origin, ticket,
  rate), but enabled by its **own server option**, off unless set (USER,
  2026-11-13). The `server` shorthand always fills the route in; a server
  with the option off answers 404 and the editor falls through to the link.
  Forwards one `Range`; 200/206.
- PDF-only, on every request (USER, 2026-11-13): before serving any range,
  the server confirms `%PDF-` within the first 1024 bytes of the resource.
  A range that does not start at 0 needs that check too: fetch the first
  1024 bytes, or hit a short-lived cache of urls already checked (cache size,
  TTL and key are the builder's call; key must include the final url after
  redirects). Not a PDF → 415.
- Own stored files (USER, 2026-11-13): when the url is one of this server's
  own stored files, read it straight from the blob store — no outbound
  fetch, so it works on localhost, intranet and custom ports. Same Range,
  PDF check and headers as the remote path. With S3 storage, the bucket is
  remote: use the outbound path.
- Response headers: `Content-Type: application/pdf`, `nosniff`,
  sandbox CSP, `Accept-Ranges` + `Content-Length` exposed, `Vary`, short
  private cache.
- The three outbound fetchers buffer whole bodies and Go's `Get` takes no
  request headers: add a streaming fetch with request headers in each.
- Own size cap option (not `MaxUploadBytes` 32 MiB).
- `server` shorthand (`server-config.ts`) fills the route in.
- Stored uploads: add an **opt-in** option to send CORS (allowed origin +
  `Expose-Headers: Accept-Ranges`) on `/files`. Default-on would be BREAKING
  (shipped in Go and C# before v2.1.0); opt-in is not.
- Fixtures: new `file-bytes-responses.json`; rows in
  `outbound-request-headers.json`; `local-file-responses.json` for the option.

### 5. Breaking changes (to tell the user and label commits)

- The preview no longer renders `<iframe class="blok-file-preview-frame"
  data-role="file-preview-frame">` for PDFs where pdf.js runs (shipped in
  v2.1.0). No opt-out (USER, 2026-11-13). Migration: target the new viewer's
  data roles.
- Hosts with a strict CSP must allow `worker-src blob:` for the fast path.

### 6. Docs and i18n

- New `tools.file.preview*` keys (password, wrong password, fit width,
  find, errors) in all locales (blok-translations skill).
- Docs site, both locales: viewer, hook, assets url, CSP note, server route,
  CORS option.

## Order of work

1. Packaging + minimal viewer (must list) for blob PDFs. Ships alone.
2. Byte chain 1–3 and 5 + hook type. Fixes the playground PDF.
3. Server route + stored-file CORS option, Go/C#/Rust + conformance.
4. Should list (find, pinch, thumbnails).

## Failure behaviour (my call)

pdf.js fails on a file that is not corrupt (worker error, render error) →
the error card with Download and Open in new tab. No fallback to the native
viewer, except in browsers below the feature check.

## Left to the builder

Config key names; exact feature-check expression; file layout under
`src/tools/file/pdf/`; chunk size for the server transport (~1 MiB,
`disableAutoFetch`) ; test fixtures (must include a multi-page PDF, a
password PDF, a corrupt file, a PDF with external and internal links).

## Unverified

iOS page-1-only; Notion's PDF behaviour; Safari canvas size cap (pass
`canvasMaxAreaInBytes`); whether rolldown's es2020 lowering of pdf.js
private fields changes behaviour; whether the license plugin sees `?raw`.
