# Blok Version Override (dev extension)

Points any page that runs blok ≥ the seam version at your locally built blok —
including deployed apps this repo does not build. Design:
`docs/plans/2026-08-19-blok-version-override-extension-design.md`.

## Setup (once)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → this
   directory.
2. In the blok repo: `yarn override:sync` (or `yarn override:sync --watch`).

## Use

1. Open the page, click the extension icon, arm the origin (non-localhost asks
   for confirmation).
2. Reload the page. The badge shows ON; the banner shows the running version.
   `-dev.<sha>` in `data-blok-version` on the editor root = override active.
3. Rebuild (`override:sync` again or `--watch`), reload the page. New builds
   get a new payload filename; the extension picks it up within ~30s (or on
   popup open) with no extension reload.

## Limits (by design — see the design doc)

- Apps bundling blok **below the seam version** are unreachable until they bump once.
- react/vue/angular adapter code is NOT overridden (core entries only).
- A reload is required after arming — the registry is read at module evaluation.
- Chrome/Chromium only.

## Tier 2: CDN / dev-server pages

For script-tag or dev-server pages (no seam needed), add a redirect pair in the
popup (e.g. `https://cdn.jsdelivr.net/npm/@bloklabs/core@x/dist/` →
`http://localhost:3000/dist/`) and serve `dist/` locally.
