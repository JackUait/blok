/**
 * @module Blok/Global
 *
 * Browser-global entry for `<script>`-tag / CDN consumers.
 *
 * Editor.js historically shipped a browser global where
 * `<script src="editor.js"></script>` exposes `window.EditorJS` as the
 * constructor, used directly as `new EditorJS({ ... })`. This entry preserves
 * that drop-in ergonomics for Blok.
 *
 * It deliberately re-exports ONLY the `Blok` class as the default export (no
 * named exports). Built as an IIFE with `output.exports: 'default'` and the
 * global name `EditorJS`, this makes `window.EditorJS` BE the constructor
 * itself — `new EditorJS({ ... })` — rather than a module namespace object that
 * would force `new EditorJS.default({ ... })`.
 *
 * The multi-export ES/CJS builds (`blok.mjs`/`blok.cjs`) and the
 * batteries-included `BlokEditor` namespace IIFE (`blok.iife.js`, built from
 * `full.ts`) are unaffected — this is an additional, separate output.
 *
 * @example
 * <!-- Pin a version and add Subresource Integrity in production. -->
 * <script
 *   src="https://unpkg.com/@jackuait/blok@0.15.1/dist/blok.umd.js"
 *   integrity="sha384-..."
 *   crossorigin="anonymous"
 * ></script>
 * <script>
 *   const editor = new EditorJS({ holder: 'editor' });
 * </script>
 */
import Blok from './blok';

export default Blok;
