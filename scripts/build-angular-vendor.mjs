/**
 * Builds Angular + RxJS as local browser-ESM vendor files for the Angular
 * adapter Playwright E2E fixture (`test/playwright/fixtures/angular-test.html`).
 *
 * Like `build-react-vendor.mjs`, this exists because the E2E fixture is a static
 * HTML page loaded by `npx serve` with an import map — it has no bundler, and CI
 * cannot reach a CDN. Each Angular package is bundled separately with its peer
 * Angular packages (+ rxjs + tslib) marked EXTERNAL, so the import map wires
 * every consumer to a SINGLE shared `@angular/core` (and rxjs) instance — Angular
 * breaks badly if `@angular/core` is duplicated.
 *
 * The adapter ships partial-Ivy (`ɵɵngDeclareComponent`); loading
 * `@angular/compiler` in the fixture lets Angular's runtime linker finalize the
 * declarations on first use (JIT), so no app-level build step is needed.
 *
 * Output: test/playwright/fixtures/vendor/angular/*.mjs
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(root, 'test/playwright/fixtures/vendor/angular');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/**
 * Source of the fixture's standalone Angular app. Embeds `<blok-editor>` driving
 * the REAL Blok core and exercises reactive `[readOnly]` + the `(ready)` /
 * `(dataChange)` outputs. esbuild downlevels the decorators; Angular's runtime
 * JIT linker (with `@angular/compiler` loaded by the page) finalizes both this
 * component and the adapter's partial-Ivy FESM at bootstrap.
 */
const APP_SOURCE = `
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { BlokEditorComponent } from '@jackuait/blok-angular';
import { Paragraph, Header } from '@jackuait/blok/tools';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [BlokEditorComponent],
  template: \`
    <div data-blok-testid="status">{{ status }}</div>
    <button data-blok-testid="toggle-readonly" (click)="readOnly = !readOnly">Toggle Read Only</button>
    <div id="editor-host" data-blok-testid="editor-host">
      <blok-editor
        [tools]="tools"
        [data]="data"
        [readOnly]="readOnly"
        (ready)="onReady()"
        (dataChange)="onData($event)"
      ></blok-editor>
    </div>
    <pre id="output" data-blok-testid="output">{{ output }}</pre>
  \`,
})
class AppComponent {
  status = 'loading';
  readOnly = false;
  output = '';
  tools = { paragraph: { class: Paragraph }, header: { class: Header } };
  data = { blocks: [{ id: 'block1', type: 'paragraph', data: { text: 'Hello from Angular' } }] };

  onReady() { this.status = 'ready'; }
  // (dataChange) fires the serialized content on every change batch (the real
  // core onSave -> adapter chain), proving the reactive serialize path E2E.
  onData(d) { this.output = JSON.stringify(d); }
}

bootstrapApplication(AppComponent).catch((err) => {
  const el = document.querySelector('[data-blok-testid="status"]');
  if (el) el.textContent = 'error: ' + (err && err.message ? err.message : String(err));
  console.error(err);
});
`;

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"development"', ngDevMode: 'true' },
  legalComments: 'none',
};

// rxjs + tslib are shared singletons too — every Angular bundle externalizes
// them and the import map points at these single copies.
const SHARED = ['rxjs', 'rxjs/operators', 'tslib'];

/** Bundle one package, externalizing the given peers so they stay shared. */
function vendor(entry, outfile, external) {
  return build({
    ...common,
    entryPoints: [entry],
    outfile: path.resolve(outDir, outfile),
    external,
  });
}

await Promise.all([
  // tslib + rxjs: the leaf singletons.
  vendor('tslib', 'tslib.mjs', []),
  vendor('rxjs', 'rxjs.mjs', ['tslib']),
  vendor('rxjs/operators', 'rxjs-operators.mjs', ['rxjs', 'tslib']),

  // @angular/core: depends only on rxjs + tslib.
  vendor('@angular/core', 'core.mjs', [...SHARED]),

  // The rest externalize core (and each other) so all share one core instance.
  vendor('@angular/common', 'common.mjs', ['@angular/core', ...SHARED]),
  // platform-browser pulls @angular/common/http (withHttpTransferCache).
  vendor('@angular/common/http', 'common-http.mjs', ['@angular/core', '@angular/common', ...SHARED]),
  vendor('@angular/compiler', 'compiler.mjs', ['@angular/core', ...SHARED]),
  vendor('@angular/platform-browser', 'platform-browser.mjs', [
    '@angular/core',
    '@angular/common',
    ...SHARED,
  ]),
  vendor('@angular/forms', 'forms.mjs', [
    '@angular/core',
    '@angular/common',
    '@angular/platform-browser',
    ...SHARED,
  ]),

  // zone.js is side-effecting (installs the global Zone). Bundle it as an ESM
  // module the fixture imports first.
  vendor('zone.js', 'zone.mjs', []),

  // The fixture's own standalone app (decorators + inline template). Kept as an
  // esbuild stdin string (like the React vendor bundle) so there is no committed
  // `.ts` fixture for the root tsc/eslint programs to choke on; esbuild downlevels
  // the decorators so the browser can parse it. Angular, the adapter, the core,
  // and the tools all stay external (import-map wired) so the app links against
  // the same shared instances the page already loaded.
  build({
    ...common,
    stdin: { contents: APP_SOURCE, resolveDir: root, loader: 'ts', sourcefile: 'angular-app.ts' },
    outfile: path.resolve(outDir, 'app.mjs'),
    external: [
      '@angular/core',
      '@angular/common',
      '@angular/forms',
      '@angular/platform-browser',
      '@jackuait/blok',
      '@jackuait/blok/tools',
      '@jackuait/blok-angular',
      ...SHARED,
    ],
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
  }),
]);

console.log(`Angular vendor bundles written to ${path.relative(root, outDir)}/`);
