# Versioned documentation — design

Date: 2026-10-05
Status: approved approach (A), awaiting spec review

## Goal

Readers can open the docs for the Blok version they actually run. A picker in
the header switches between versions and keeps them on the same page.

## Decisions (from the user)

- One entry per **minor**. Each shows the docs of that minor's latest patch.
- `blokeditor.com/` shows the **latest stable release**. Unreleased `main` moves
  to `/next/`, labelled "Next (unreleased)".
- **Backfill** from 1.7 to 1.15. **1.6 is dropped**: its docs build crashes on
  `/docs` at its own tag (pre-existing, `getTranslation` reads an undefined key).
- **Approach A**: snapshots stored as GitHub release assets, assembled on every
  deploy.

## Evidence from the spike

Each minor's latest tag was built with only `basename` (react-router config) and
`base` (vite) set to `/v/<minor>/`.

| Tag | Pages prerendered | Size | Build time incl. install + lib |
|---|---|---|---|
| v1.15.2 | 152 | 49 MB | 180 s |
| v1.14.0 | 152 | 48 MB | 96 s |
| v1.13.0 | 152 | 48 MB | 125 s |
| v1.12.0 | 152 | 47 MB | 75 s |
| v1.11.0 | 152 | 47 MB | 80 s |
| v1.10.1 | 146 | 47 MB | 47 s |
| v1.9.0 | 146 | 46 MB | 109 s |
| v1.8.0 | 146 | 46 MB | 70 s |
| v1.7.0 | 144 | 46 MB | 42 s |

- Every build fails only at the post-build `cp dist/client/404/index.html`. The
  file now sits under `v/<minor>/404/`.
- HTML lands in `dist/client/v/<minor>/`. Assets and `public/` files land at
  `dist/client/` root, but are referenced as `/v/<minor>/assets/...`. Assembly
  must move them under the version folder.
- Prerendered links stay inside the subpath. Only favicons, logos and the
  webmanifest point at the root, which also serves them.
- Canonical tags already point at the root page (`https://blokeditor.com/...`).
- A full snapshot gzips to about 11 MB.

**Not verified yet** (first gate of the plan):

- Client-side navigation after hydration under a basename, in a real browser.
- Upload and deploy time of an assembled ~530 MB site against the 10-minute
  Pages deploy timeout and the 7-minute CI job budget.

## URL layout

| Path | Content | Indexed |
|---|---|---|
| `/` and `/ru/` | latest stable release | yes, sitemap covers only this |
| `/next/` | current `main` | `noindex` |
| `/v/<minor>/` | latest patch of an older minor | `noindex` |
| `/versions.json` | the version list | — |

The `/v/` prefix cannot collide with a docs route. The latest minor appears
only at `/` and never also at `/v/<minor>/`. That avoids two copies of it.
Prereleases (betas) never become the root and never get an archive entry.

## Snapshots

At each **stable release publish**, CI builds the docs at the release tag twice:

1. `docs-root.tgz`, built with base `/`.
2. `docs-v<minor>.tgz`, built with base `/v/<minor>/`. It becomes active once
   the next minor ships.

Both are attached to the GitHub release (`gh release upload --clobber`). A patch
release attaches its own pair. The newest patch of each minor wins.

Each tarball carries a `pages.json` listing its prerendered paths. The picker
uses it to decide whether a page exists in the target version.

Release assets are durable. Actions artifacts expire, and a git branch would
add about 11 MB of permanent history per snapshot.

## Backfill

A one-off `workflow_dispatch` job builds 1.7 to 1.15 from their tags. Each build
gets a **versioning overlay** before it runs:

- `basename` + `base` set to the subpath.
- The `VersionPicker` component file copied from `main`, plus one line in `Nav`
  next to `LanguageSelector`.
- The `noindex` + archive banner.

`Nav.tsx`, `root.tsx` and `vite.config.ts` changed little between those tags.
So one overlay script should apply to all of them. The job fails loudly on any
tag where it does not.

The backfill uploads `docs-v<minor>.tgz` onto that minor's latest release.

## Assembly (every deploy)

The `build` job in `deploy-docs.yml`:

1. Builds `main` at base `/next/`.
2. Reads the stable releases with `gh release list`. It downloads the newest
   patch's `docs-root.tgz` for the root and `docs-v<minor>.tgz` for every older
   minor.
3. Unpacks them into one tree and writes `/versions.json`.
4. Copies `CHANGELOG.md`, `robots.txt`, `sitemap.xml` and `CNAME` from the root
   snapshot.
5. Uploads the tree once, as today.

On a release publish, step 2 uses the release that was just built.

The existing "Verify deploy artifact" step gains checks for `/next/` and one
archive. `scripts/verify-live-docs.mjs` gains the same probes against
production.

## `versions.json`

```json
{
  "latest": "1.15",
  "versions": [
    { "id": "next", "label": "Next", "path": "/next/" },
    { "id": "1.15", "label": "1.15", "path": "/" },
    { "id": "1.14", "label": "1.14", "path": "/v/1.14/" }
  ]
}
```

It is fetched at runtime from the root, so an old snapshot lists versions newer
than itself without a rebuild.

## Version picker

- Lives in the header next to `LanguageSelector` and uses the same dropdown
  pattern.
- Shows the current version. The current entry is marked with a checkmark and
  primary ink on a neutral surface. Never blue (project rule).
- Choosing a version keeps the current path, including the `/ru/` prefix, when
  the target's `pages.json` has it. Otherwise it goes to the target's home.
- The version a page belongs to comes from a build-time constant
  (`import.meta.env.BASE_URL`), not from parsing the URL.
- If `versions.json` fails to load, the picker shows only the current version
  and stays usable.

## Archive banner

`/next/` and every `/v/<minor>/` show a thin bar above the header:

- Archive: "You're viewing docs for 1.12. Go to the latest version."
- Next: "You're viewing docs for an unreleased version. Go to the latest
  release."

Both strings are added to `en.json` and `ru.json`.

## Size cap

- Today the site is about 11 copies × 48 MB ≈ 530 MB. The Pages limit is 1 GB.
  That leaves room for about 8 more minors.
- Assembly sums the unpacked size. Past 900 MB, it drops the oldest minor from
  the site and from `versions.json`. Its tarball stays on the release.

## Testing

- Unit tests (docs vitest):
  - the picker's path mapping (same page, locale kept, fallback to home)
  - the selected-state styling (neutral, no blue)
  - `versions.json` parsing and the failure fallback
  - the banner variants
- Unit tests (node): assembly ordering (newest patch wins, prereleases skipped,
  latest minor not duplicated under `/v/`), the size-cap pruning, and the
  asset relocation.
- Browser check of a locally assembled site, run with `playwright-cli`:
  navigation within `/v/1.12/`, switching versions, `/ru/` kept.

## Out of scope

- Per-patch entries.
- Searching across versions. Search stays inside the version being viewed.
- Changing the content of old snapshots beyond the overlay.
