# Blok desktop

Tauri 2 shell for the Blok window. The window is an overlay title bar (hidden title, traffic lights at 16, 21) at 1440×900.

The tab strip is window tabs for pages. The browser keeps a single history entry; each tab stores its own back/forward stack, title, icon and scroll position in `sessionStorage` under `blok:window-tabs:v1`. Back and forward do not call the webview's `history.back()`.

The page under the strip is a placeholder. The shared sidebar from `src/shell` lands later; this package does not import it. `setCanLeave` lets that page refuse a switch, a new tab, a close, or a history step.

The app icon uses the Blok mascot from `docs/public/logo-no-sign.png`. Regenerate the source with `swift scripts/generate-icon.swift ../docs/public/logo-no-sign.png src-tauri/icons/icon-source.png`, then run `npx tauri icon src-tauri/icons/icon-source.png` to refresh the platform icons.

```bash
cd desktop
npm install
npm test
npm run tauri dev
npx tauri build --bundles app
```
