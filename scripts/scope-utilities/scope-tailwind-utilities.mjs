import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * Blok injects its compiled stylesheet into the HOST page's <head>
 * (UI.loadStyles). The generated Tailwind utilities give editor content its
 * typography (heading sizes via `text-3xl`) and block spacing (margin
 * utilities like `mt-[26px]`). main.css imports them into `@layer utilities`
 * so a host Tailwind v4 app keeps control of its OWN utilities.
 *
 * The catch: per the cascade-layer spec, an UN-LAYERED author rule ALWAYS
 * beats a layered one, regardless of specificity or source order. Every
 * non-Tailwind host ships an un-layered reset (`* { margin: 0 }`,
 * `h1,h2,… { font-size: inherit }`). Against that, Blok's layered utilities
 * silently lose the moment the editor mounts — headings collapse to body size,
 * blocks jam together.
 *
 * This build-time transform resolves both constraints at once. It takes the
 * compiled `@layer utilities { … }` block and:
 *   1. hoists it OUT of the layer (un-layered → beats un-layered host resets), and
 *   2. scopes every selector to Blok's interface roots, so the utilities only
 *      ever match — and can only ever affect — Blok's own elements. A host's
 *      own `.text-3xl` / `.sm:text-4xl` on the host's own elements are never
 *      touched, so the host stays in full control of its cascade.
 *
 * `:where(...)` carries zero specificity, so each utility keeps its natural
 * specificity and utility-vs-utility ordering inside the editor is unchanged.
 */
export const SCOPE_SELECTOR =
  '[data-blok-interface], [data-blok-interface] *, [data-blok-popover], [data-blok-popover] *';

/**
 * Build a fresh `:where(<SCOPE_SELECTOR>)` pseudo node. A new node is created
 * per call because a selector-parser node can live in only one tree.
 */
function buildScopeWhere() {
  const where = selectorParser.pseudo({ value: ':where' });
  const inner = selectorParser().astSync(SCOPE_SELECTOR);
  // Reparent each scope Selector ([data-blok-interface], … *) under :where().
  inner.nodes.slice().forEach((sel) => where.append(sel));
  return where;
}

// CSS Level 1/2 pseudo-elements may be written with a single colon
// (`:before`, `:after`, `:first-line`, `:first-letter`). Tailwind v4 compiles
// the `before:` / `after:` variants to this legacy single-colon form, so
// detecting pseudo-elements by the `::` prefix alone misses them — and a
// misplaced scope (`:before:where(…)`) is an invalid selector the browser
// drops entirely (this silently broke every placeholder). Match both forms.
const LEGACY_PSEUDO_ELEMENTS = new Set([':before', ':after', ':first-line', ':first-letter']);

function isPseudoElement(node) {
  return (
    node.type === 'pseudo' &&
    (node.value.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(node.value.toLowerCase()))
  );
}

const scopeSelectorProcessor = selectorParser((root) => {
  root.each((selector) => {
    const nodes = selector.nodes;

    // The subject compound is everything after the last combinator.
    let lastCombinator = -1;
    nodes.forEach((node, i) => {
      if (node.type === 'combinator') lastCombinator = i;
    });

    // Insert the scope at the end of the subject compound, but BEFORE any
    // pseudo-element (`::before`, `:before`, `::placeholder`, …) — a compound
    // selector must not continue past a pseudo-element.
    let insertIdx = nodes.length;
    for (let i = lastCombinator + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (isPseudoElement(node)) {
        insertIdx = i;
        break;
      }
    }

    const where = buildScopeWhere();
    if (insertIdx >= nodes.length) {
      selector.append(where);
    } else {
      selector.insertBefore(nodes[insertIdx], where);
    }
  });
});

/**
 * Scope one selector string (comma-separated) to Blok's interface roots.
 * Exported for direct unit testing.
 */
export function scopeSelector(selector) {
  return scopeSelectorProcessor.processSync(selector);
}

/**
 * Rewrite compiled Tailwind CSS: hoist `@layer utilities { … }` to un-layered
 * top level and scope every utility selector to Blok's interface roots.
 * Rules outside `@layer utilities` are left untouched. Idempotent-safe no-op
 * when no utilities layer is present.
 */
export function scopeUtilitiesLayer(css) {
  const root = postcss.parse(css);

  const utilityLayers = [];
  root.walkAtRules('layer', (atRule) => {
    if (atRule.params.trim() === 'utilities') utilityLayers.push(atRule);
  });

  for (const atRule of utilityLayers) {
    atRule.walkRules((rule) => {
      rule.selector = scopeSelector(rule.selector);
    });
    // Hoist the layer's children up, dropping the @layer wrapper (un-layered).
    atRule.replaceWith(atRule.nodes);
  }

  return root.toString();
}
