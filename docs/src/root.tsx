import type { ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './contexts/I18nContext';
import { FrameworkProvider } from './contexts/FrameworkContext';
import stylesheet from './index.css?url';

const GA_MEASUREMENT_ID = 'G-P4F8SK0C03';

// Keep local development out of the production property. This is gtag's
// official opt-out flag, so it must be set BEFORE the loader below runs; the
// tag still loads, it just stops sending. To check analytics locally, set
// window['ga-disable-G-P4F8SK0C03'] = false in the console.
const GTAG_OPT_OUT = `
if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  window['ga-disable-${GA_MEASUREMENT_ID}'] = true;
}`;

// send_page_view: false — this is a single-page app, so the router sends page
// views itself (src/hooks/usePageTracking.ts). Leaving the automatic one on
// would record only the entry URL and double-count it.
const GTAG_INIT = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });`;

// Applies the stored theme before the first paint so the page never flashes the
// wrong one. Must stay inline in <head>: a deferred module would run after paint.
const THEME_FLASH = `
(function() {
  const STORAGE_KEY = 'blok-docs-theme';
  const VALID_THEMES = ['light', 'dark', 'system'];

  const stored = localStorage.getItem(STORAGE_KEY);
  const theme = stored && VALID_THEMES.includes(stored) ? stored : 'system';

  let resolvedTheme = theme;
  if (theme === 'system') {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    resolvedTheme = systemPrefersDark ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', resolvedTheme);
  document.documentElement.classList.add(resolvedTheme);
})();`;

export const links = () => [
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
  { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
  { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48x48.png' },
  { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon-64x64.png' },
  { rel: 'icon', type: 'image/png', sizes: '128x128', href: '/favicon-128x128.png' },
  { rel: 'icon', type: 'image/png', sizes: '256x256', href: '/favicon-256x256.png' },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'apple-touch-icon', sizes: '192x192', href: '/android-chrome-192x192.png' },
  { rel: 'manifest', href: '/site.webmanifest' },
];

/** Site-wide default; per-route modules override it with their own `meta`. */
export const meta = () => [{ title: 'Blok — Block-Based Rich Text Editor' }];

export const Layout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <Meta />
      <Links />
      <script dangerouslySetInnerHTML={{ __html: GTAG_OPT_OUT }} />
      {/* No integrity hash on purpose: gtag.js is a mutable endpoint Google
          redeploys continuously, so any pinned SHA would break analytics for
          every visitor on their next release. */}
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} />
      <script dangerouslySetInnerHTML={{ __html: GTAG_INIT }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_FLASH }} />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

const Root = () => (
  <I18nProvider>
    <FrameworkProvider>
      <App>
        <Outlet />
      </App>
    </FrameworkProvider>
  </I18nProvider>
);

export default Root;
