import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

import jsonAsStringPlugin from '../vite-plugin-json-as-string.mjs';
import scopeUtilitiesPlugin from '../scope-utilities/vite-plugin-scope-utilities.mjs';
import unfurlPlugin from '../unfurl/vite-plugin-unfurl.mjs';

import pkg from '../../package.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

export async function buildPayload({ watch = null } = {}) {
  const gitShort = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  const version = `${pkg.version}-dev.${gitShort}`;
  const builtAt = new Date().toISOString();
  const outDir = resolve(root, 'override-extension/payload/.build');

  const result = await build({
    configFile: false,
    root,
    mode: 'production',
    logLevel: 'warn',
    // Plugin list mirrors vite.config.mjs (order matters); css injection is
    // re-configured because the payload evaluates at document_start, where
    // document.head is null and the default injector's try/catch would
    // swallow the CSS silently.
    plugins: [
      jsonAsStringPlugin(),
      unfurlPlugin(),
      tailwindcss(),
      scopeUtilitiesPlugin(),
      cssInjectedByJsPlugin({
        injectCodeFunction: function injectWhenHeadExists(cssCode) {
          try {
            const inject = () => {
              const style = document.createElement('style');
              style.appendChild(document.createTextNode(cssCode));
              document.head.appendChild(style);
            };
            if (document.head) {
              inject();
            } else {
              document.addEventListener('readystatechange', function onReady() {
                if (document.head) {
                  document.removeEventListener('readystatechange', onReady);
                  inject();
                }
              });
            }
          } catch (e) {
            console.warn('[blok-override] css inject failed', e);
          }
        },
      }),
    ],
    define: {
      'NODE_ENV': JSON.stringify('production'),
      'VERSION': JSON.stringify(version),
      'process.env.NODE_ENV': JSON.stringify('production'),
      '__BLOK_OVERRIDE_VERSION__': JSON.stringify(version),
      '__BLOK_BUILT_AT__': JSON.stringify(builtAt),
    },
    resolve: { alias: { '@/types': resolve(root, 'types') } },
    build: {
      copyPublicDir: false,
      target: 'es2017',
      outDir,
      emptyOutDir: true,
      minify: true,
      watch,
      lib: {
        entry: resolve(__dirname, 'payload-entry.mjs'),
        name: '__BLOK_DEV_OVERRIDE_PAYLOAD__',
        formats: ['iife'],
        fileName: () => 'blok-override.js',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });

  return { result, outDir, version, builtAt };
}
