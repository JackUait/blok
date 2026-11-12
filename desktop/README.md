# Blok desktop

Tauri 2 hosts the shared sidebar and a real Blok editor. Its 40 px title bar follows
`notion-lab-desktop/apps/clean-client-2/src/shell/window-tabs.css`: the sidebar
controls occupy the sidebar width, followed by navigation, tabs, and an adjacent
new-tab button. The macOS window uses an overlay title bar with traffic lights at
16, 21 and starts at 1440×900.

## Local data

On this Mac, pages are saved under:

`/Users/joce/Library/Application Support/dev.notiooon.blok/workspace`

`index.json` holds page titles, hierarchy, cover presets and the current page. Each page body is
saved as `<page-id>.json` in the same folder. Tauri resolves this location from
`app_data_dir`, so another macOS account or operating system uses its own data
directory. Saves use a temporary file and rename on macOS.
The sidebar footer opens an **Espace local** menu. **Profil local** changes the
display name on this device; it is not an online account. **Préférences** offers
a saved light, dark or system appearance; **Données locales** displays the path
and the Blok and app versions. The footer menu can copy the path directly.
Each page can have a bundled gradient or image cover. The choice and vertical
position are saved in `index.json`; adding, changing or removing a cover does
not change the editor body. The image presets come from the reference desktop
project's NASA/Webb cover assets.

## AI assistant

The Blok button opens the shared assistant panel with conversation history, page context and a provider/model picker. In **Paramètres → Assistant IA**, configure OpenAI with a personal key or (as workspace administrator) a shared key. Personal credentials take priority and never silently fall back after an API error. Keys are masked and never stored in browser localStorage. The selected model and key source appear in the assistant.

For remote workspaces, requests use the authenticated Go service and encrypted credentials in PostgreSQL. Local native workspaces use a separate credential in the operating system keychain and the Rust HTTPS client. Codex and Claude Code remain available in the native app via their existing CLI authentication. The browser cannot inspect or execute tools installed on the Mac.

## Sharing

Remote workspaces support email login, membership roles, join requests, invitations and durable real-time collaboration. Local workspaces remain separate and stored on this machine. See `../deploy/README.md` for the Docker stack, demo accounts, data volumes and backup/restore workflow. Switching workspaces waits for pending document writes before loading the new context.

The tab strip separately keeps its per-tab history in the webview's
`sessionStorage` under `blok:window-tabs:v1`; this is window state, not the page
storage. When running only the Vite preview in a browser, pages use that
browser's `localStorage` instead of native files.

The shared sidebar is imported from `src/shell/sidebar.ts` and editor code from
`src/full.ts`. Install the repository dependencies before building the desktop
package; Vite resolves those sources and their dependencies from the repository.
The desktop currently bundles the repository's Blok 2.1.0 source; its own Tauri
app version is 0.1.0. `defaultTools` contains only paragraphs, headings and
lists, so the desktop also registers Table, Database, DatabaseRow and
DatabaseComment explicitly for the slash menu and saved documents.
`src/editor.css` explicitly includes the root `src/` in Tailwind's source scan;
without it, editor controls and popovers lose their utility styles in desktop.
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
