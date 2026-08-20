# Blok Version Override (dev extension)

Points any page that runs blok ≥ the seam version at your locally built blok —
including deployed apps this repo does not build. Design:
`docs/plans/2026-08-19-blok-version-override-extension-design.md`.

## Setup (once)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → this
   directory.
2. In the blok repo: `yarn override:sync` (add `--watch` to rebuild on change,
   or `--serve` to get a **Rebuild** button in the popup).

## Use

1. Open the page and click the extension icon. The popup detects blok on the
   active tab (bundled editors by their `data-blok-*` markers, CDN script
   tags by URL) — when nothing is detected, overriding is disabled.
2. Bundled blok → flip the switch (non-localhost sites ask for an inline
   confirmation), then reload the page. The badge shows ON; the banner and the
   popup show the running version; `-dev.<sha>` in `data-blok-version` on the
   editor root = override active.
3. Rebuild: with `--serve` (or `--watch`) running, hit **Rebuild** in the
   popup; otherwise rerun `override:sync`. New builds get a new payload
   filename; the extension picks it up within ~30s (or on popup open) with no
   extension reload.

## Tier 2: CDN / script-tag pages

Pages that load blok from a CDN need no seam — the extension serves your
`dist/` build itself (staged by `override:sync`, requires `yarn build` once):

- A detected CDN script gets a one-click **Use local** button in the popup.
- "Override another version" lists every published version of
  `@bloklabs/core` and `@jackuait/blok` (jsdelivr catalog, cached 6h) and
  intercepts that version's jsdelivr `/dist/` URLs on any page.

## Limits (by design — see the design doc)

- Apps bundling blok **below the seam version** are unreachable until they bump once.
- react/vue/angular adapter code is NOT overridden (core entries only).
- A reload is required after arming — the registry is read at module evaluation.
- Chrome/Chromium only.
