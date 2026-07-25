#!/usr/bin/env node
/**
 * Generates `view.css` — the opt-in stylesheet that makes `@bloklabs/core/view`
 * output look like the read-only editor.
 *
 * WHY GENERATED: the view's emitters stamp the very same class strings the
 * editor's tools do (`src/shared/tool-classes/*`, `src/shared/block-scaffolding`).
 * Hand-maintaining a stylesheet for those classes would drift the moment a tool
 * gained one. So the sheet is compiled from the SAME Tailwind entry the editor
 * bundle uses (`src/styles/main.css`), fed exactly the classes the shared
 * modules can emit.
 *
 * WHY PRUNED: that entry also carries the entire editor chrome — toolbars,
 * popovers, drag indicators, the emoji picker. A static view can render none of
 * it. So every compiled rule is match-tested against a real DOM built by running
 * the fixture corpus below through `blocksToHtml`, and dropped if nothing it
 * could ever style is present. Rules that declare only custom properties are
 * kept wholesale: they apply by inheritance, so no selector match can prove
 * them dead.
 *
 * WHAT IS DELIBERATELY EXCLUDED: `fonts.css`. Its four `@font-face` rules embed
 * ~226 KB of base64 webfont — larger than everything else combined — and a view
 * should inherit the host's typography. Hosts that want Blok's monospace face in
 * code blocks point `--blok-font-mono` at their own copy.
 *
 * Run: `node scripts/generate-view-css.mjs`
 * Guarded by: `test/unit/architecture/view-stylesheet-law.test.ts` (class
 * coverage, regeneration freshness, byte budget).
 */
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compile } from '@tailwindcss/node';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES_ENTRY = join(REPO_ROOT, 'src/styles/main.css');
const OUTPUT = join(REPO_ROOT, 'view.css');
const CACHE_DIR = join(REPO_ROOT, 'node_modules/.cache');

mkdirSync(CACHE_DIR, { recursive: true });

/**
 * A document exercising every Phase A tool, in every variant whose classes
 * differ. The pruner keeps a rule only if it can style something here, so a
 * shape missing from this corpus is a shape the sheet will not style. Add to it
 * whenever a tool gains a variant.
 */
const FIXTURE_BLOCKS = [
  { id: 'p1', type: 'paragraph', data: { text: 'Text with <b>bold</b>, <i>italic</i>, <code>mono</code>, a <a href="https://example.com">link</a> and a <mark style="background-color: var(--blok-color-red-bg);">mark</mark>.' } },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({ id: `h${level}`, type: 'header', data: { text: `Heading ${level}`, level } })),
  { id: 'ht', type: 'header', data: { text: 'Toggleable heading', level: 2, isToggleable: true, isOpen: true } },
  { id: 'htc', type: 'paragraph', parent: 'ht', data: { text: 'Inside a toggleable heading' } },
  { id: 'q1', type: 'quote', data: { text: 'A quote' } },
  { id: 'q2', type: 'quote', data: { text: 'A large quote', size: 'large' } },
  { id: 'c1', type: 'code', data: { code: 'const answer = 42;', language: 'javascript' } },
  { id: 'd1', type: 'divider', data: {} },
  { id: 's1', type: 'spacer', data: {} },
  { id: 'u1', type: 'list', data: { text: 'Unordered item', style: 'unordered' } },
  { id: 'u2', type: 'list', data: { text: 'Nested item', style: 'unordered', depth: 1 } },
  { id: 'o1', type: 'list', data: { text: 'Ordered item', style: 'ordered' } },
  { id: 'k1', type: 'list', data: { text: 'Done', style: 'checklist', checked: true } },
  { id: 'k2', type: 'list', data: { text: 'Not done', style: 'checklist', checked: false } },
  { id: 'ca1', type: 'callout', data: { emoji: '💡', color: 'blue' } },
  { id: 'ca1c', type: 'paragraph', parent: 'ca1', data: { text: 'Callout body' } },
  /** A nested heading: main.css resets its root-level top margin in here. */
  { id: 'ca1h', type: 'header', parent: 'ca1', data: { text: 'Nested heading', level: 1 } },
  { id: 'tg1', type: 'toggle', data: { text: 'Open toggle', isOpen: true } },
  { id: 'tg1c', type: 'paragraph', parent: 'tg1', data: { text: 'Toggle body' } },
  { id: 'tg2', type: 'toggle', data: { text: 'Closed toggle', isOpen: false } },
  { id: 'tg2c', type: 'paragraph', parent: 'tg2', data: { text: 'Hidden body' } },
];

/**
 * Import first-party TypeScript from a plain `.mjs` script by bundling it to a
 * temporary ESM file. Node's built-in type stripping cannot do this: these
 * modules use extensionless relative specifiers, which its resolver rejects.
 * @param entry - repo-relative path to the TypeScript entry
 * @returns the entry's module namespace
 */
const importTs = async (entry) => {
  /**
   * Under `node_modules/.cache`, not the OS temp dir: the bundle keeps its
   * third-party imports bare (parse5), and Node resolves those relative to the
   * importing FILE. From /tmp there is no node_modules to walk up to.
   */
  const dir = mkdtempSync(join(CACHE_DIR, 'view-css-'));
  const file = join(dir, 'bundle.mjs');

  try {
    const result = await build({
      entryPoints: [join(REPO_ROOT, entry)],
      bundle: true,
      format: 'esm',
      platform: 'node',
      /** Keep node_modules external — only first-party code needs bundling. */
      packages: 'external',
      write: false,
    });

    writeFileSync(file, result.outputFiles[0].text);

    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Pseudo-elements a static DOM cannot carry. Stripping them lets the pruner
 * ask whether the OWNING element exists; interaction pseudo-classes
 * (`:hover`, `:focus-visible`) are deliberately NOT stripped, because a rule
 * that can only fire on interaction is dead in a read-only view.
 */
const PSEUDO_ELEMENT = /::[a-z-]+(\([^)]*\))?/g;

/**
 * Split a selector list on its TOP-LEVEL commas only.
 *
 * Naive `selector.split(',')` shreds `:is()`/`:where()` argument lists — and
 * because the fragments are then invalid, every such rule took the
 * keep-on-error path and survived pruning. That silently kept the entire editor
 * chrome, since almost every scoped rule in this codebase is written
 * `:where([data-blok-interface], [data-blok-popover]) …`.
 * @param selector - a rule's full selector
 */
const splitSelectors = (selector) => {
  const parts = [];

  selectorParser((selectors) => {
    /**
     * Rewrite `.\[\&_a\]\:text-link` to `[class~="[&_a]:text-link"]` before
     * handing anything to the matcher. jsdom's engine does not understand
     * backslash-escaped class selectors — it reports NO MATCH rather than
     * throwing, so every Tailwind arbitrary-variant utility (the whole
     * `[&_a]:text-link` / `[&>p:first-of-type]:mt-0` family, which is what
     * styles links, bold and italic inside a block) read as dead and was
     * pruned out of the sheet. Silent, and invisible in the output.
     */
    selectors.walkClasses((node) => {
      node.replaceWith(selectorParser.attribute({
        attribute: 'class',
        operator: '~=',
        value: node.value,
        quoteMark: '"',
      }));
    });

    selectors.each((sel) => parts.push(String(sel).trim()));
  }).processSync(selector);

  return parts;
};

/**
 * Does any of a rule's selectors match something in the rendered view?
 * @param selector - the rule's full (possibly comma-separated) selector
 * @param root - the rendered view's document element
 */
const matchesView = (selector, root) => {
  let parts;

  try {
    parts = splitSelectors(selector);
  } catch {
    return true;
  }

  return parts.some((part) => {
    const probe = part.replace(PSEUDO_ELEMENT, '').trim();

    if (probe === '') {
      return false;
    }

    try {
      return root.querySelector(probe) !== null;
    } catch {
      /** Unsupported by the matcher — keep the rule rather than guess it dead. */
      return true;
    }
  });
};

/**
 * A rule declaring only custom properties is a token carrier: it styles nothing
 * directly, so a selector match cannot prove it dead — a `--blok-*` value set on
 * `:root` or a theme wrapper reaches the view purely by inheritance, and the
 * fixture DOM carries neither `[data-blok-theme="dark"]` nor a host's own root.
 *
 * The class-selector exclusion keeps that exemption from becoming a hole. Blok's
 * theming surface is attribute-keyed throughout (`:root`, `[data-blok-theme]`,
 * `[data-blok-interface]`), so a token carrier hung off a CLASS is component
 * state — `.blok-image-crop-editor` and friends — and prunes like any other
 * rule.
 * @param rule - a postcss rule
 */
const isTokenCarrier = (rule) => {
  if (rule.selector.includes('.')) {
    return false;
  }

  let sawDeclaration = false;

  for (const node of rule.nodes ?? []) {
    if (node.type !== 'decl') {
      return false;
    }

    sawDeclaration = true;

    if (!node.prop.startsWith('--')) {
      return false;
    }
  }

  return sawDeclaration;
};

/** At-rules kept wholesale: they define reusable values, not element styling. */
const KEPT_AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'property', 'layer', 'media', 'supports', 'charset']);

/**
 * Drop every rule that cannot style the rendered view, depth-first so an
 * at-rule left empty by pruning is dropped with its children.
 * @param container - a postcss root or at-rule
 * @param root - the rendered view's document element
 */
const prune = (container, root) => {
  for (const node of [...(container.nodes ?? [])]) {
    if (node.type === 'rule') {
      /**
       * An empty rule is emitted when Tailwind's scoped preflight declares only
       * properties this build resolves away. It matches, but styles nothing.
       */
      if ((node.nodes?.length ?? 0) === 0) {
        node.remove();

        continue;
      }

      if (!isTokenCarrier(node) && !matchesView(node.selector, root)) {
        node.remove();
      }

      continue;
    }

    if (node.type !== 'atrule') {
      continue;
    }

    if (node.name === 'keyframes' || node.name === '-webkit-keyframes' || node.name === 'property') {
      continue;
    }

    if (!KEPT_AT_RULES.has(node.name)) {
      node.remove();

      continue;
    }

    /** A bodiless at-rule (`@layer a, b;`) has no nodes and must survive. */
    if (node.nodes === undefined) {
      continue;
    }

    prune(node, root);

    if (node.nodes.length === 0) {
      node.remove();
    }
  }
};

/**
 * `@keyframes` that nothing left in the sheet animates. Compiled Tailwind ships
 * every theme keyframe; the view uses at most one.
 * @param root - the pruned postcss root
 */
const dropUnusedKeyframes = (root) => {
  const used = new Set();

  root.walkDecls((decl) => {
    if (/^(-webkit-)?animation(-name)?$/.test(decl.prop)) {
      for (const token of decl.value.split(/[\s,]+/)) {
        used.add(token);
      }
    }
  });

  root.walkAtRules(/^(-webkit-)?keyframes$/, (rule) => {
    if (!used.has(rule.params.trim())) {
      rule.remove();
    }
  });
};

/**
 * Relocate the Tailwind-v4 border-colour compat rules into `@layer base`.
 *
 * main.css authors these UNLAYERED (`:where([data-blok-interface]) * {
 * border-color: var(--color-gray-200) }`), restoring v3's grey default now that
 * v4 defaults border-color to currentColor. Unlayered beats EVERY layered
 * utility regardless of specificity, so left as-is it overrides `.border-current`
 * and the view paints a grey quote bar where the read-only editor paints a black
 * one (the editor's build lands the same rule in a layer). These are semantic
 * base resets, so moving them into `@layer base` lets the per-tool border
 * utilities win — exactly the cascade the editor produces. Mirrors the
 * `:not([class])` guard the legacy baseline uses for the same unlayered-wins
 * hazard on `[data-blok-tool]`.
 * @param root - the pruned postcss root
 */
const layerizeBorderCompat = (root) => {
  const base = postcss.atRule({ name: 'layer', params: 'base' });
  const moved = [];

  root.each((node) => {
    if (node.type !== 'rule' || !node.nodes || node.nodes.length === 0) {
      return;
    }

    const everyDeclIsBorderCompat = node.nodes.every(
      (decl) => decl.type === 'decl' && decl.prop === 'border-color' && decl.value.includes('--color-gray-200')
    );

    if (everyDeclIsBorderCompat) {
      moved.push(node);
    }
  });

  for (const node of moved) {
    base.append(node.clone());
    node.remove();
  }

  if (base.nodes.length > 0) {
    root.append(base);
  }
};

/**
 * The legacy contract: `blocksToHtml(data, { toolAttributes: true })` with
 * classes OFF emits bare semantic tags whose only hook is `data-blok-tool`.
 * Those hand-written rules must survive verbatim — hr-platform ships against
 * them today, and the stylesheet law asserts them.
 *
 * `:not([class])` is load-bearing. With `classes: true` the same elements carry
 * per-tool Tailwind padding (quote's is `0.2em`, not `7px`), and an unlayered
 * `[data-blok-tool]` rule beats every layered utility regardless of specificity
 * — so without the guard this baseline would silently overwrite the parity
 * padding it exists to approximate.
 */
const LEGACY_BASELINE = `
/*
 * ── Legacy baseline: classless output ────────────────────────────────────────
 * For \`blocksToHtml(data, { toolAttributes: true })\` WITHOUT \`classes\`, whose
 * output carries no class attribute at all. Everything above already styles the
 * classed output; these rules only reach the bare semantic tags.
 */
[data-blok-tool]:not([class]) {
  margin: 0;
  padding-top: var(--blok-block-padding-top, 7px);
  padding-bottom: var(--blok-block-padding-bottom, 7px);
  padding-inline: var(--blok-block-padding-inline, 2px);
}

/*
 * List runs carry the tool hook on their \`<ul>\`/\`<ol>\`; keep the block padding
 * but restore the marker indentation a reset \`padding-inline\` would collapse.
 */
[data-blok-tool="list"]:not([class]) {
  padding-inline-start: calc(var(--blok-block-padding-inline, 2px) + 1.5em);
}
`;

const HEADER = `/**
 * Blok view stylesheet — GENERATED by scripts/generate-view-css.mjs. Do not edit.
 *
 * Reproduces the read-only editor's appearance for \`@bloklabs/core/view\` output:
 *
 *   import '@bloklabs/core/view.css';
 *   blocksToHtml(data, { root: true, classes: true, toolAttributes: true })
 *
 * The React \`<BlokView>\` enables all three by default. The root wrapper carries
 * \`data-blok-interface="view"\`, which every scoped rule below keys on, so nothing
 * here can leak into the surrounding page.
 *
 * Ships no webfonts — the view inherits the host's typography. Point
 * \`--blok-font-mono\` at a monospace face to match the editor's code blocks.
 */
`;

/**
 * Canonical Tailwind cascade-layer order, byte-for-byte what UI.loadStyles
 * (src/components/modules/ui.ts) prepends before the editor's own sheet.
 *
 * The compiled output below registers `@layer utilities { }` BEFORE
 * `@layer base { }`, and CSS fixes layer precedence by first declaration — so
 * without this statement `base` outranks `utilities` and the scoped preflight
 * resets (`* { padding: 0; border: 0 solid }`) beat every padding/border
 * utility: block rhythm collapses, quote borders and list indents vanish. The
 * editor dodges this only because it prepends the same line at runtime; the
 * standalone sheet must carry it itself. Pins `base` before `utilities`.
 */
const LAYER_ORDER = '@layer properties;\n@layer theme, base, components, utilities;\n';

/**
 * Compile, prune and write the stylesheet.
 */
const main = async () => {
  const [{ blocksToHtml }, tools, scaffolding] = await Promise.all([
    importTs('src/view/index.ts'),
    importTs('src/shared/tool-classes/index.ts'),
    importTs('src/shared/block-scaffolding.ts'),
  ]);

  const candidates = [
    ...new Set([
      ...tools.ALL_STATIC_CLASSES,
      ...scaffolding.BLOCK_WRAPPER_CLASSES,
      ...scaffolding.BLOCK_CONTENT_CLASSES,
    ]),
  ].sort();

  const html = blocksToHtml({ blocks: FIXTURE_BLOCKS }, {
    root: true,
    classes: true,
    toolAttributes: true,
  });

  const { window } = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);

  /**
   * The compiled sheet is scoped to `[data-blok-interface]`, and the outermost
   * wrapper IS that element — so match against `documentElement`, not the body,
   * or every scoped rule reads as unmatched.
   */
  const root = window.document.documentElement;

  /**
   * `fonts.css` is stripped from the entry rather than pruned out of the
   * result: `@font-face` has no selector, so the pruner cannot judge it.
   */
  const entrySource = readFileSync(STYLES_ENTRY, 'utf-8').replace(/^@import '\.\/fonts\.css';$/m, '');

  const compiler = await compile(entrySource, {
    base: dirname(STYLES_ENTRY),
    onDependency() {},
  });

  const parsed = postcss.parse(compiler.build(candidates));

  prune(parsed, root);
  dropUnusedKeyframes(parsed);
  layerizeBorderCompat(parsed);

  writeFileSync(OUTPUT, `${HEADER}${LAYER_ORDER}${parsed.toString().trim()}\n${LEGACY_BASELINE}`);

  process.stdout.write(`view.css: ${candidates.length} candidates -> ${readFileSync(OUTPUT).byteLength} bytes\n`);
};

await main();
