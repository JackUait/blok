# Blok desktop

Tauri 2 hosts the shared sidebar and a real Blok editor. Its 40 px title bar follows
`notion-lab-desktop/apps/clean-client-2/src/shell/window-tabs.css`: the sidebar
controls occupy the sidebar width, followed by navigation, tabs, and an adjacent
new-tab button. The macOS window uses an overlay title bar with traffic lights at
16, 21 and starts at 1440×900.

## Local data

On this Mac, pages are saved under:

`/Users/joce/Library/Application Support/dev.notiooon.blok/workspace`

`index.json` holds page titles, hierarchy and the current page. Each page body is
saved as `<page-id>.json` in the same folder. Tauri resolves this location from
`app_data_dir`, so another macOS account or operating system uses its own data
directory. The sidebar's **Données sur cet appareil** button shows and copies the
actual path. Saves use a temporary file and rename on macOS.

The tab strip separately keeps its per-tab history in the webview's
`sessionStorage` under `blok:window-tabs:v1`; this is window state, not the page
storage. When running only the Vite preview in a browser, pages use that
browser's `localStorage` instead of native files.

The shared sidebar is imported from `src/shell/sidebar.ts` and editor code from
`src/full.ts`. Install the repository dependencies before building the desktop
package; Vite resolves those sources and their dependencies from the repository.
React Grab loads only in Vite/Tauri development, as in the reference desktop
project; it is excluded from the packaged app.

The app icon uses the Blok mascot from `docs/public/logo-no-sign.png`. Regenerate the source with `swift scripts/generate-icon.swift ../docs/public/logo-no-sign.png src-tauri/icons/icon-source.png`, then run `npx tauri icon src-tauri/icons/icon-source.png` to refresh the platform icons.

```bash
npm ci
cd desktop
npm ci
npm test
npm run tauri dev
npx tauri build --bundles app
```
