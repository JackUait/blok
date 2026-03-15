/**
 * Builds React + ReactDOM as local ESM vendor files for Playwright E2E tests.
 *
 * The react-test.html fixture uses an import map. In CI, external URLs (esm.sh)
 * are unreachable. This script produces local ESM bundles under
 * test/playwright/fixtures/vendor/ so the import map can point to local files.
 *
 * Output:
 *   test/playwright/fixtures/vendor/react.mjs          → React core + all named exports
 *   test/playwright/fixtures/vendor/react-dom-client.mjs → createRoot, hydrateRoot
 *   test/playwright/fixtures/vendor/react-jsx-runtime.mjs → jsx, jsxs, Fragment
 *
 * Strategy: build a single combined bundle containing react + react-dom/client +
 * react/jsx-runtime so they share one React instance (required for hooks to work).
 * Then write thin wrapper files for the other two import map entries that
 * re-export from the combined bundle.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, 'test/playwright/fixtures/vendor');

// Clean and recreate the vendor directory so stale files don't accumulate
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/**
 * Build a single combined bundle that exports all three packages' public APIs.
 * By bundling together, react-dom and jsx-runtime share the same React instance.
 */
await build({
  stdin: {
    contents: `
import React from 'react';
import ReactDOMClient from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';

// React named exports
export const {
  Children, Component, Fragment, Profiler, PureComponent,
  StrictMode, Suspense, act, cache, cloneElement,
  createContext, createElement, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, use,
  useCallback, useContext, useDebugValue, useDeferredValue,
  useEffect, useId, useImperativeHandle, useInsertionEffect,
  useLayoutEffect, useMemo, useOptimistic, useReducer,
  useRef, useState, useSyncExternalStore, useTransition,
  version,
} = React;
export { React as default };

// react-dom/client exports
export const createRoot = ReactDOMClient.createRoot;
export const hydrateRoot = ReactDOMClient.hydrateRoot;

// react/jsx-runtime exports
export const jsx = JsxRuntime.jsx;
export const jsxs = JsxRuntime.jsxs;
`,
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: path.resolve(outDir, '_react-bundle.mjs'),
});

/**
 * Write thin wrapper files that re-export from the combined bundle.
 * These are the files that the import map entries point to.
 */

// react.mjs — exports React default + all named hooks/utils
writeFileSync(
  path.resolve(outDir, 'react.mjs'),
  `export { default, Children, Component, Fragment, Profiler, PureComponent,
  StrictMode, Suspense, act, cache, cloneElement,
  createContext, createElement, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, use,
  useCallback, useContext, useDebugValue, useDeferredValue,
  useEffect, useId, useImperativeHandle, useInsertionEffect,
  useLayoutEffect, useMemo, useOptimistic, useReducer,
  useRef, useState, useSyncExternalStore, useTransition,
  version } from './_react-bundle.mjs';
`,
  'utf8'
);

// react-dom-client.mjs — exports createRoot, hydrateRoot
writeFileSync(
  path.resolve(outDir, 'react-dom-client.mjs'),
  `export { createRoot, hydrateRoot } from './_react-bundle.mjs';\n`,
  'utf8'
);

// react-jsx-runtime.mjs — exports jsx, jsxs, Fragment
writeFileSync(
  path.resolve(outDir, 'react-jsx-runtime.mjs'),
  `export { jsx, jsxs, Fragment } from './_react-bundle.mjs';\n`,
  'utf8'
);

console.log('React vendor bundles written to test/playwright/fixtures/vendor/');
