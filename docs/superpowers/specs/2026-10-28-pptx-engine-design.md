# In-house PPTX engine (replaces `@aiden0z/pptx-renderer`)

Date: 2026-10-28
Status: approved direction (USER: "вариант 1 со своим движком"), research done

## Goal

The File block previews `.pptx` with `@aiden0z/pptx-renderer@1.3.0` plus ECharts.
Replace it with our own engine under `src/tools/file/pptx/`, derived from upstream
v1.4.0 (`8cd925a`, Apache-2.0). Keep everything that changes how a slide LOOKS in our
preview. Drop everything we never call. Drop ECharts.

## Our single use

`PptxViewer.open(buf, container, { fitMode: 'contain', zipLimits: RECOMMENDED, pdfjs: false })`
in `src/tools/file/office-loaders.ts`. Read-only list of all slides in the preview modal,
scaled to the container width and re-fit on resize. Nothing else.

## Measured facts (this session)

- Shipped chunk today: 1,174,065 B (356 KB gz). ECharts + zrender = 628 KB of it.
- Upstream 1.4.0 renderer alone, minified: 738 KB. Generated preset geometry is 244 KB of
  that (12 KB gz); it is plain data.
- Upstream src 1.4.0: 71 k lines (34 k of them generated geometry). Unit tests: ~105 files,
  vitest + jsdom, portable.
- Our lint rules flag 1,897 errors on upstream src (402 `let`, 397 max-depth, 383
  param-reassign, ~340 unsafe-*).
- Corpus: upstream's python-pptx generator builds 207 decks (text 64, shape-adj 31,
  flowchart 28, chart 24, composite 21, shape3d 20, table 8, formula 8, effects 3).
- No PowerPoint/LibreOffice/Keynote on this machine: the reference for "nothing broke" is
  upstream 1.4.0 itself.

## Bugs found in today's integration (fixed by this work)

1. External media: a deck's `TargetMode="External"` picture/background is fetched on open
   (IP leak, tracking pixel). Engine never fetches external media. No option.
2. `viewer.destroy()` is never called: blob URLs, ResizeObserver, chart instances outlive
   the modal. Engine handle is destroyed when the modal closes.

## Feature matrix

`must` = keep, same output as upstream 1.4.0. `own` = rewritten by us. `skip` = dropped.

| Area | Decision | Why |
| --- | --- | --- |
| Zip parse + limits (`ZipParser`, eager media) | must | input + DoS guard |
| XML/Rel parsing, units, booleans | must | core |
| Presentation/Theme/Master/Layout/Slide model, placeholders, template shapes, hidden nodes | must | inheritance drives every slide |
| Text (runs, bullets, autofit, line spacing, vertical text, tabs, links) | must | most of a deck |
| Shapes, StyleResolver (fills, gradients, lines, arrowheads, shadows, glow, soft edges), useBgFill | must | most of a deck |
| Preset geometry (hand presets + generated ECMA subset), custom geometry | must | every shape |
| Pictures (crop, effects, SVG blip via img, audio/video posters), EMF **bitmap** | must | common |
| Tables + predefined table styles | must | common |
| Groups, backgrounds, reflection | must | look |
| Static 3D (bevel, camera projection) | must | shipped today; dropping is a visible regression |
| OMML math | must | shipped today; 9 KB |
| Embedded fonts (MTX-compressed EOT) | must | 2 of 20 real decks embed fonts, all MTX-compressed; dropping them changed up to 4% of pixels per slide. Decoder vendored from mtx-decompressor 1.8.0 (MPL-2.0, file-level) with its 265 tests; no npm dependency |
| Charts | own | SVG renderer for bar/column, line, area, pie, doughnut, scatter; others get a titled frame. Removes ECharts (628 KB) |
| EMF → PDF via pdfjs | skip | we pass `pdfjs: false` today |
| Viewer: list, fit-to-width, resize re-fit, batched mount, destroy | own | ~200 lines instead of 1,331 |
| Viewer: slide mode, zoom, thumbnails, windowed mount, scroll tracking, events, search highlight | skip | never used |
| `PptxRenderer` API, `serializePresentation`, `TextSearch`, `lazyMedia`, `lazySlides`, configured font faces, `e2eCompare`, `previewScale` | skip | never used |
| External media | skip (blocked) | security |
| Hyperlinks | must, through Blok's URL gate | URL-sink law |

## Licensing

- Apache-2.0 (same as Blok). Every derived file carries a one-line header: derived from
  `@aiden0z/pptx-renderer` 1.4.0, modified. Attribution goes in `NOTICE`.
- Generated geometry is mechanically derived from ECMA-376: the ECMA copyright notice goes
  in `NOTICE` with the provenance hash.
- MPL-2.0 files: `src/tools/file/pptx/fonts/mtx/*` only, each with the MPL notice and its LICENSE beside it.

## Test strategy ("nothing breaks")

1. **Golden master first.** A vitest (jsdom) corpus test renders a committed fixture set
   (~25 decks picked from the 207 plus our two samples) and snapshots a normalized DOM
   serialization per slide. It is taken from the verbatim import, BEFORE any refactor, and
   must stay byte-identical through every refactor. Chart slides are excluded from the
   snapshot until the own chart renderer lands (then they get their own snapshots).
2. **Ported upstream unit tests** for every kept module, adapted to our lint rules.
3. **Pixel parity (one-time, local, Chromium)**: all 207 decks + our samples rendered by
   upstream 1.4.0 and by our engine; non-chart slides must match pixel for pixel (expected
   differences listed: charts, MTX fonts, external media). Uses replica-diff's comparison.
4. **E2E** in `test/playwright/tests/tools/file.spec.ts`: the modal renders slides, no
   request leaves for external media, closing the modal releases blob URLs.
5. **Security tests**: external media, `javascript:` links, zip bomb (declared vs real size),
   CSS/SVG injection through font names and colors, ReDoS inputs.
6. Architecture laws (`test/unit/architecture`) pass, including the URL-sink law.

## Plan of record

1. Vendor verbatim (minus skipped modules, minimal seam cuts) → port tests → golden master.
2. Lint-conformance refactor, file group by file group, golden master unchanged.
3. Own viewer + integration (destroy on close, no external media), e2e.
4. Own SVG charts (TDD).
5. Remove `@aiden0z/pptx-renderer` from `package.json`; drop the ECharts false-positive
   in `bundle-outputs.test.ts`; NOTICE.
6. Security + code review (parallel), fixes with regression tests first.
7. Pixel parity run; report.

## Outcome log (2026-10-28)

- Parity vs upstream 1.4.0 in Chromium: 209 synthetic + 20 real decks, 589 slides. Every non-chart
  slide identical in DOM and pixels; 0 crashes; 0 network requests.
- Security (audit with Chromium PoCs): DOCTYPE entity blow-up (68 s / 6.8 GB → 24 ms), zip size
  lies (2 GB heap → rejected in <250 ms), unbounded tables, prototype lookups in colour names,
  non-finite numbers, per-slide font budget. External media never fetched; viewer destroyed on close.
- Visible English placeholder text removed from slides (Blok has no i18n channel into the engine).
- Lint: the four style rules (`let`, max-depth, param-reassign, nested ternary) are disabled per
  vendored file with a reason; every other rule is fixed.
