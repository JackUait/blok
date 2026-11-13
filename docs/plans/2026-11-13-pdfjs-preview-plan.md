# PDF preview on pdf.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every PDF Blok can get bytes for inside the file preview modal with pdf.js, in a Blok-styled viewer, and get bytes for remote PDFs through a direct fetch, a host hook or the Blok server.

**Architecture:** pdf.js (legacy build) is bundled like MapLibre: a lazy `import()` chunk whose worker runs from a blob url. A Blok-owned viewer drives the pdf.js core API (virtualized canvases, text layer, own link layer) and reuses the preview chrome and a generalized page pager. A source resolver picks bytes (blob → host hook → direct url → Blok server transport) and falls back to today's link. The Go, C# and Rust servers get a `/file-bytes` route behind its own option.

**Tech Stack:** TypeScript, pdfjs-dist 6.5.438 (legacy), Vitest + jsdom, Playwright, Go, C# (.NET), Rust.

**Spec:** `docs/plans/2026-11-13-pdfjs-preview-design.md`

## Global Constraints

- `pdfjs-dist` exact `6.5.438`, devDependency only; no `dependencies`/`peerDependencies`.
- Legacy build only (`pdfjs-dist/legacy/build/pdf.mjs`, `.../pdf.worker.min.mjs?raw` or unminified equivalent).
- Never ship `standard_fonts`; `useSystemFonts: true`; `useWasm: false` unless an assets url is set.
- Below the capability check (Chrome 125 / Safari 18 class browsers) keep today's behaviour: native iframe for blob PDFs, link for http(s).
- No `import type` from `pdfjs-dist` in `types/`.
- No blue selected states; hints via `onHover` (500 ms), never native `title` on new controls; colours only via `--blok-*` tokens.
- External links from a PDF go through `safeHttpHref`, `rel="noopener noreferrer"`, `target="_blank"`.
- Pages stay white paper with black ink in dark mode.
- Render only visible pages ±2; a page leaving the window frees its canvas (`width = height = 0`) and calls `page.cleanup()`.
- `loadingTask.destroy()` on modal close, including close mid-load.
- Server: every feature in Go, C# and Rust, shared fixtures under `test/unit/server-conformance/fixtures`.
- `/file-bytes` is off unless its own option is set; PDF check (`%PDF-` in first 1024 bytes of the resource) on every request; own stored files read from the store.
- Comments: short, only what silently breaks.
- Commits: one per task, pushed after its related tests pass; BREAKING commits labelled per CLAUDE.md.

## Review Focus

1. A PDF whose first page is huge (A0 poster, 14400 pt) — the canvas must cap via `canvasMaxAreaInBytes` and still draw, not throw. Test in Task 3.
2. Closing the modal while `getDocument` or a page render is still running — no render into a detached node, no unhandled rejection, worker destroyed. Test in Task 5.
3. A password PDF where the user cancels the prompt — shows the error card, not a spinner forever. Test in Task 5.
4. A link annotation with `javascript:`, `data:` or relative url — no anchor is created. Test in Task 4.
5. The direct fetch of an http(s) url that returns HTML with status 200 — pdf.js fails with `InvalidPDFException`, the viewer shows the error card, nothing is framed. Test in Task 7.

---

## Part 1 — Viewer for blob PDFs

### Task 1: Bundle pdf.js lazily

**Files:**
- Modify: `package.json` (devDependencies: `"pdfjs-dist": "6.5.438"`), `yarn.lock`
- Create: `src/tools/file/pdf/pdf-runtime.ts`, `src/tools/file/pdf/pdf-loader.ts`
- Modify: `test/unit/build/bundle-outputs.test.ts` (lazy-chunk test; budget raise), `test/unit/architecture/blob-url-law.test.ts` (exemption, if it flags the worker blob)
- Test: `test/unit/tools/file/pdf/pdf-loader.test.ts`

**Interfaces:**
- Produces:
  - `type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')` (internal only, in `pdf-loader.ts`)
  - `loadPdfJs(): Promise<PdfJs>` — memoized like `loadMapLibre`; a failed import clears the memo.
  - `supportsPdfJs(): boolean` — capability test: `typeof Worker === 'function'`, `typeof Promise.withResolvers === 'function' || legacy polyfill present`, canvas 2d context available. Must be false in jsdom unless the test stubs it. No UA sniffing.
  - `pdf-runtime.ts` `boot(): PdfJs` — sets `GlobalWorkerOptions.workerSrc` once to `createSafeObjectUrl(new Blob([workerSource], { type: 'text/javascript' }))` with the source-map line stripped (copy `maplibre-runtime.ts`).

- [ ] **Step 1:** Write `pdf-loader.test.ts`: `loadPdfJs` returns the same promise twice; a rejected import is retried on the next call (mock `./pdf-runtime` with `vi.mock`); `supportsPdfJs()` is false when `Worker` is undefined.
- [ ] **Step 2:** Run `yarn test test/unit/tools/file/pdf/pdf-loader.test.ts` — FAIL (module missing).
- [ ] **Step 3:** `yarn add -D -E pdfjs-dist@6.5.438`; implement both files.
- [ ] **Step 4:** Run the test — PASS.
- [ ] **Step 5:** `yarn build`, then add to `bundle-outputs.test.ts`: a chunk containing pdf.js's `GlobalWorkerOptions` exists and is not the entry chunk (copy the MapLibre lazy test near line 485). Measure code bytes; raise the parse-cost budget to the next 0.1 MiB above the measurement with comment `// N MiB (USER, 2026-11-13: bundle pdf.js): code went A -> B bytes.`
- [ ] **Step 6:** Run `yarn test test/unit/build test/unit/architecture` — PASS (add the blob-url-law exemption with a reason if it fails on `pdf-runtime.ts`). Check the vendor licence output lists pdfjs-dist; if the `?raw` import hides it, add pdfjs-dist's Apache-2.0 text to `NOTICE`.
- [ ] **Step 7:** Commit `feat(file): bundle pdf.js as a lazy chunk`.

### Task 2: Generalize the page pager

**Files:**
- Modify: `src/tools/file/page-pager.ts`, `src/tools/file/office-preview.ts` (docx call site)
- Test: `test/unit/tools/file/page-pager.test.ts` (existing; extend)

**Interfaces:**
- Produces:
  ```ts
  export interface PagedView {
    count: number;
    /** Index of the page at the reading line (a third down the scroller). */
    currentPage(): number;
    scrollToPage(index: number): void;
    /** Widest page width at 100%, in px. */
    naturalWidth(): number;
    /** Scale every page; 1 = natural size. */
    setScale(scale: number): void;
  }
  export function mountPager(scroller: HTMLElement, view: PagedView, chrome: PreviewChrome): void;
  export function docxPagedView(scroller: HTMLElement): PagedView | null;
  ```
  Zoom rules unchanged: 0.5–2, step 0.25, 100% = fit width (never larger than natural), `FIT_GUTTER` 48.
- [ ] **Step 1:** Extend the test: `mountPager` with a fake `PagedView` calls `setScale(fit * zoom)` on zoom-in, shows `Page 2 / 5` when `currentPage()` returns 1, and Prev calls `scrollToPage(current - 1)`. Existing docx assertions keep passing through `docxPagedView`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; docx behaviour identical (`--blok-docx-zoom`, pt widths).
- [ ] **Step 4:** Run `yarn test test/unit/tools/file` — PASS.
- [ ] **Step 5:** Commit `refactor(file): the page pager takes any paged view`.

### Task 3: Virtualized PDF page view

**Files:**
- Create: `src/tools/file/pdf/pdf-view.ts`, `src/tools/file/pdf/pdf-types.ts`
- Modify: `src/styles/file.css` (pdf view rules), plus whatever CSS gates need (`test/unit/styles`, `css-split` snapshots)
- Test: `test/unit/tools/file/pdf/pdf-view.test.ts`

**Interfaces:**
- Consumes: `PagedView`, `mountPager` (Task 2).
- Produces (`pdf-types.ts`, the minimal slice of pdf.js Blok uses, so tests can fake it):
  ```ts
  export interface PdfViewport { width: number; height: number; scale: number }
  export interface PdfPageLike {
    getViewport(o: { scale: number }): PdfViewport;
    render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; transform?: number[] }): { promise: Promise<void>; cancel(): void };
    getTextContent(): Promise<unknown>;
    getAnnotations(): Promise<PdfAnnotationLike[]>;
    cleanup(): void;
  }
  export interface PdfAnnotationLike { subtype: string; rect: number[]; url?: string; dest?: unknown }
  export interface PdfDocumentLike { numPages: number; getPage(n: number): Promise<PdfPageLike>; getPageIndex?(ref: unknown): Promise<number>; getDestination?(name: string): Promise<unknown[] | null> }
  ```
  `mountPdfView(container: HTMLElement, doc: PdfDocumentLike, lib: { TextLayer?: unknown }, chrome: PreviewChrome): Promise<{ destroy(): void }>`
  - DOM: `div[data-role="file-preview-pdf"]` scroller → one `div[data-role="file-preview-pdf-page"][aria-label="Page N"]` per page sized from page 1's viewport until its own is known; each holds `canvas` + `div.textLayer` (own class name: `blok-file-preview-pdf-text`).
  - IntersectionObserver (`rootMargin` of two viewport heights) renders pages ±2, cancels in-flight renders that leave, frees canvas + `page.cleanup()`.
  - DPR-aware canvas; cap area at `16_777_216` px (pass `canvasMaxAreaInBytes` equivalent by scaling down).
  - Registers `chrome.setFacts([counted(numPages, pagesOne, pages)])` and `mountPager`.
  - Text layer CSS: transparent text, selection colour from tokens (no blue literal).
  - Dark mode: page background `#fff` via an existing paper token (copy docx rule in `file.css`).
- [ ] **Step 1:** Tests with a fake doc of 50 pages and a stubbed IntersectionObserver: only pages 1–3 rendered on mount; scrolling to page 30 renders 28–32 and frees 1–3 (`cleanup` called, canvas width 0); `destroy()` disconnects the observer and cancels renders; a 14400×14400 pt page renders with canvas area ≤ 16,777,216 (Review Focus 1); each page has `aria-label="Page N"`.
- [ ] **Step 2:** Run `yarn test test/unit/tools/file/pdf/pdf-view.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test plus `test/unit/styles test/unit/architecture` — PASS.
- [ ] **Step 5:** Commit `feat(file): a virtualized pdf page view`.

### Task 4: Safe link layer

**Files:**
- Create: `src/tools/file/pdf/pdf-links.ts`
- Test: `test/unit/tools/file/pdf/pdf-links.test.ts`

**Interfaces:**
- Consumes: `PdfAnnotationLike`, `PdfViewport` (Task 3).
- Produces: `renderPdfLinks(host: HTMLElement, annotations: PdfAnnotationLike[], viewport: PdfViewport, goTo: (dest: unknown) => void): void` — called by `pdf-view.ts` per rendered page.
- [ ] **Step 1:** Tests: `Link` with `url: 'https://a.test/x'` → `<a href target=_blank rel="noopener noreferrer">` positioned from `rect` (y flipped by viewport height); `javascript:alert(1)`, `data:text/html,..`, `/relative`, `mailto:x` → no anchor (Review Focus 4); `dest` → button-like anchor whose click calls `goTo(dest)` and never sets `href="#..."`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement with `safeHttpHref`; wire into `pdf-view.ts` (`goTo` resolves via `getDestination`/`getPageIndex`, then `scrollToPage`).
- [ ] **Step 4:** Run the test + `test/unit/architecture/url-sink-law.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat(file): pdf links open safely`.

### Task 5: Open blob PDFs with pdf.js (BREAKING)

**Files:**
- Create: `src/tools/file/pdf/pdf-preview.ts`, `src/tools/file/pdf/pdf-password.ts`
- Modify: `src/tools/file/preview-modal.ts` (startFill pdf branch, header links), `src/tools/file/preview-labels.ts`, `src/tools/file/index.ts` (labels), `src/components/i18n/locales/*.json` (3 keys, all locales via the blok-translations skill), `src/styles/file.css`
- Test: `test/unit/tools/file/pdf/pdf-preview.test.ts`, `test/unit/tools/file/preview-modal.test.ts` (update iframe expectations)

**Interfaces:**
- Consumes: `loadPdfJs`, `supportsPdfJs` (Task 1), `mountPdfView` (Task 3).
- Produces: `fillPdfBody(opts: FilePreviewOptions, chrome: PreviewChrome, source: PdfSource): Promise<void>` where
  `type PdfSource = { kind: 'data'; data: Uint8Array } | { kind: 'url'; url: string } | { kind: 'transport'; transport: unknown; length: number }` (Task 7 and 11 add producers; this task only uses `data`).
- New label keys: `tools.file.previewPdfPassword` ("This PDF is protected. Enter its password."), `tools.file.previewPdfPasswordWrong` ("That password is wrong. Try again."), `tools.file.previewPdfOpen` ("Open"). `PreviewLabels` gets `pdfPassword`, `pdfPasswordWrong`, `pdfOpen`.
- Behaviour:
  - `getDocument({ data: copy, useSystemFonts: true, useWasm: false, isOffscreenCanvasSupported: undefined })`; keep the original Blob for Download.
  - `onProgress` → loading text with percent when total known.
  - `onPassword(cb, reason)` → inline form in the body (password input + Open button); reason 2 shows the wrong-password line; closing/Escape-less cancel = error card (Review Focus 3).
  - Any failure (`InvalidPDFException`, worker error, render error) → `buildErrorInto` (Download + Open in new tab). No native fallback.
  - Release: `loadingTask.destroy()` + view `destroy()`; close mid-load leaves no rejection (Review Focus 2).
  - When `supportsPdfJs()` is false: today's `fillPdfBlobBody` stays.
  - Haze: PDF view scrolls inside `body`, so call `haze.init(body)` for pdf too.
- [ ] **Step 1:** Tests with a mocked `loadPdfJs` returning a fake lib: blob PDF → `file-preview-pdf` present, no `iframe`; password flow (reason 1 → form, submit calls the callback; reason 2 → wrong line); cancel → error card; corrupt (`getDocument` rejects with `{ name: 'InvalidPDFException' }`) → error card; close while `getDocument` pending → `destroy` called, no unhandled rejection; `supportsPdfJs()` false → iframe path unchanged.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; add keys to every locale (blok-translations skill; run its validation).
- [ ] **Step 4:** Run `yarn test test/unit/tools/file test/unit/components/i18n test/unit/styles test/unit/architecture` — PASS. `npx tsc --noEmit -p .` clean for changed files' project.
- [ ] **Step 4b (moved from Task 1, which landed as c81c9069 without them because nothing imported the loader yet):** `yarn build`; add the pdf.js lazy-chunk test to `bundle-outputs.test.ts` (copy the MapLibre one); raise the parse-cost budget by the measurement with comment `USER, 2026-11-13: bundle pdf.js`; check `dist/vendor.LICENSE.txt` lists pdfjs-dist, else add its Apache-2.0 text to `NOTICE`.
- [ ] **Step 5:** Commit `feat(file)!: BREAKING PDFs open in a Blok viewer built on pdf.js` with body `BREAKING CHANGE: the PDF preview no longer renders iframe.blok-file-preview-frame[data-role=file-preview-frame] where pdf.js runs. Old: the browser's PDF viewer in an iframe. New: div[data-role=file-preview-pdf] with one [data-role=file-preview-pdf-page] per page. Migration: target the new data roles. Hosts with a strict CSP should allow worker-src blob: for the fast path.` Tell the user in the reply.

### Task 6: E2E across engines

**Files:**
- Create: `test/playwright/tests/tools/file-pdf-preview.spec.ts`, fixtures under `test/playwright/fixtures/pdf/` (3-page text PDF with one external and one internal link; password PDF, password `blok`; corrupt file) — generate with a small committed script `test/playwright/fixtures/pdf/make-fixtures.mjs` (no new deps; write raw PDF syntax).
- [ ] **Step 1:** Specs (chromium, firefox, webkit): open preview from a file block with a blob PDF → 3 page landmarks, page 1 canvas non-blank (sample pixels), text "Blok PDF page 1" selectable via the text layer; Next button shows "Page 2 / 3"; internal link scrolls to page 3; external link has `rel="noopener noreferrer"`; password PDF → form, wrong then right password; corrupt → error card.
- [ ] **Step 2:** Run `yarn e2e test/playwright/tests/tools/file-pdf-preview.spec.ts` — PASS (fix code, not assertions).
- [ ] **Step 3:** Commit `test(file): pdf viewer e2e in three engines`.

## Part 2 — Bytes for remote PDFs

### Task 7: Source chain, host hook, direct url

**Files:**
- Create: `src/tools/file/pdf/pdf-source.ts`
- Modify: `types/tools/file.d.ts` (`fetchPreview`), `src/tools/file/index.ts` (pass config), `src/tools/file/preview-modal.ts` (`FilePreviewOptions.fetchPreview`, remove http(s) notice when pdf.js is supported), docs later in Task 12
- Test: `test/unit/tools/file/pdf/pdf-source.test.ts`, `test/unit/tools/file/preview-modal.test.ts`

**Interfaces:**
- Produces:
  - In `types/tools/file.d.ts`:
    ```ts
    /** Fetches a file's bytes for the preview when the browser cannot (no CORS). */
    fetchPreview?: (url: string, init: { signal: AbortSignal }) => Promise<Blob | ArrayBuffer | Response>;
    ```
  - `resolvePdfSources(url: string, hook: FileConfig['fetchPreview'], signal: AbortSignal): AsyncGenerator<PdfSource>` — yields in order: blob → `data`; hook → `data` (Response read fully in this task); http(s) via `safeHttpHref` → `{ kind: 'url' }`. `fillPdfBody` tries each until one opens; `getDocument({ url, withCredentials: false })` on the url source.
  - Also in `FileConfig`: `pdfAssetsUrl?: string` — base url holding pdf.js `cmaps/`, `wasm/`, `iccs/`. When set, pass `cMapUrl`, `cMapPacked: true`, `wasmUrl`, `iccUrl` and `useWasm: true`; when unset, none of them.
  - All sources failed for an http(s) url → today's "Open in new tab" notice (`data-role="file-preview-external"`), kept.
- [ ] **Step 1:** Tests: blob → one `data` source; hook returning Blob/ArrayBuffer/Response each → `data`; hook throws → falls to `url`; no hook → `url`; `javascript:` url → nothing → notice; direct url whose `getDocument` rejects with `InvalidPDFException` (server sent HTML) → error card, no iframe (Review Focus 5); abort on close stops the hook.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run file tests + `test/unit/architecture` (published-types laws) — PASS. Verify in the playground (`yarn serve --no-server`, playwright-cli headless) that `tracemonkey-paper.pdf` renders.
- [ ] **Step 5:** Commit `feat(file): remote PDFs open through a direct fetch or the fetchPreview hook`.

## Part 3 — Blok server `/file-bytes`

### Task 8: Conformance fixtures + Go

**Files:**
- Create: `test/unit/server-conformance/fixtures/file-bytes-responses.json`
- Modify: `test/unit/server-conformance/fixtures/outbound-request-headers.json`, `local-file-responses.json` (CORS option), the conformance runner cases (`scripts/test-server-conformance.mjs` and its TS suite)
- Go: `packages/server/go/internal/outbound/fetcher.go` (streaming `GetStream(ctx, url, headers) (*StreamResponse, error)` with request headers, same policy/redirect/rebinding guards), `.../blokserver/handlers.go` (`fileBytes`), `server.go` (route `GET /file-bytes` behind `FileBytesEnabled`), `options.go` (`FileBytesEnabled bool`, `FileBytesMaxBytes int64` default 100 MiB, `FilesCORS bool`), `localfile.go` (CORS when `FilesCORS`), Go tests.

**Behaviour (fixtures pin it):**
- Option off → 404.
- Guard identical to `/unfurl` (origin, ticket, rate).
- `url` is this server's own stored file → read from the blob store, no outbound fetch.
- Else outbound: first verify `%PDF-` within the resource's first 1024 bytes (fetch `bytes=0-1023`, or a hit in an LRU of 256 verified final urls, TTL 10 min); not PDF → 415; upstream non-2xx → 502; over `FileBytesMaxBytes` → 413.
- Forward one `Range` (`bytes=a-b` or `bytes=a-`); reply 200/206 streaming; headers: `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Accept-Ranges: bytes`, `Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range`, `Vary: Origin, Authorization`, `Cache-Control: private, max-age=300`.
- [ ] **Step 1:** Write fixtures + Go tests for each row above. Run `node scripts/test-server-conformance.mjs --target go` and Go unit tests — FAIL.
- [ ] **Step 2:** Implement Go. Run both — PASS.
- [ ] **Step 3:** Rebuild and commit the Go runtime bundle if `src` changed (memory: go-runtime-bundle-rebuild-after-src-change).
- [ ] **Step 4:** Commit `feat(server): /file-bytes serves PDF bytes for the preview (go)`.

### Task 9: C#

**Files:** `packages/server/dotnet/Blok.Server/Outbound/GuardedOutboundFetcher.cs` (streaming variant with request headers), new `FileBytesEndpoint.cs`, route builder, `BlokServerOptions.cs` (same three options, same defaults), `LocalFileEndpoint.cs` (CORS option), tests.
- [ ] **Step 1:** Run `node scripts/test-server-conformance.mjs --target csharp` — FAIL on the new fixtures.
- [ ] **Step 2:** Implement + C# unit tests mirroring Go's. Run — PASS.
- [ ] **Step 3:** Commit `feat(server): /file-bytes (c#)`.

### Task 10: Rust

**Files:** `packages/server/rust/crates/outbound/src/fetcher.rs` (streaming from `operator.rs`), `blokserver/src/server.rs` route, options, `localfile.rs` CORS option, tests.
- [ ] **Step 1:** `--target rust` — FAIL.
- [ ] **Step 2:** Implement + tests — PASS.
- [ ] **Step 3:** Commit `feat(server): /file-bytes (rust)`.

### Task 11: Editor transport + `server` shorthand

**Files:**
- Create: `src/tools/file/pdf/pdf-server-transport.ts`
- Modify: `src/components/utils/server-config.ts` (fill `tools.file.config.previewEndpoint`), `types/tools/file.d.ts` (`previewEndpoint?: { url: string; headers?: ... }` matching bookmark's `headers` shape), `pdf-source.ts` (yield `transport` after `url`)
- Test: `test/unit/tools/file/pdf/pdf-server-transport.test.ts`, `test/unit/components/utils/server-config.test.ts`

**Interfaces:**
- `createServerRangeSource(endpoint: string, url: string, headers: () => Promise<Record<string,string>> | Record<string,string>, signal: AbortSignal): Promise<PdfSource | null>` — HEAD-less: GET `bytes=0-1048575`, read `Content-Range` total; builds a `PDFDataRangeTransport` subclass (from the loaded lib) whose `requestDataRange(begin, end)` fetches with fresh headers each time; 404 → null (route off).
- `getDocument({ range: transport, length, rangeChunkSize: 1048576, disableAutoFetch: true })`.
- [ ] **Step 1:** Tests: shorthand fills `previewEndpoint` only when absent; transport fetches ranges with headers minted per request; 404 → null → link notice; 415 → error card.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run + `--target go` conformance (spawned server) — PASS.
- [ ] **Step 5:** Commit `feat(file): PDFs no host can serve open through the Blok server`.

### Task 12: Docs, both locales

**Files:** docs site pages for the file tool and server (`docs/src/...` data modules + `en.json`/`ru.json`), `docs/src/seo/lastmod-ledger.json` (run `node docs/scripts/update-lastmod-ledger.mjs`), `packages/server/README.md`.
- Content: the viewer, `fetchPreview`, `previewEndpoint`, assets url (if added), CSP note (`worker-src blob:`), server options `FileBytesEnabled`, `FileBytesMaxBytes`, `FilesCORS`; Prose grammar rules from `docs/CLAUDE.md`.
- [ ] **Step 1:** Write; run `cd docs && yarn test src/i18n/reference-prose.test.ts src/seo/lastmod-ledger.test.ts` and the coverage tests — PASS.
- [ ] **Step 2:** Commit `docs: pdf viewer, fetchPreview and /file-bytes`.

## Part 4 — Should list

### Task 13: Find in PDF
**Files:** `src/tools/file/pdf/pdf-find.ts`, test. Cmd/Ctrl+F via `chrome.onKey` opens a find field in the pill; text extracted page by page in idle chunks (`getTextContent`), matches via `findTextMatches` (`src/shared/text-match.ts`), highlight in the text layer, Enter/Shift+Enter next/prev, scrolls to the match page. Tests first; commit `feat(file): find in PDF`.

### Task 14: Pinch zoom
**Files:** `pdf-view.ts` + test. Ctrl+wheel and two-finger pinch change the pager zoom (clamped 0.5–2), re-render visible pages only. Commit `feat(file): pinch to zoom a PDF`.

### Task 15: Thumbnails
**Files:** `src/tools/file/pdf/pdf-thumbs.ts` + test + CSS. A rail of lazily rendered small canvases (scale 0.2), current page marked with primary ink (no blue fill), click jumps. Commit `feat(file): PDF page thumbnails`.
