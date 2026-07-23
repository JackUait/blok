/**
 * LAW: every Tailwind class name written in src/ and packages/ must actually
 * compile to CSS under the installed Tailwind.
 *
 * Why this exists: `eslint-plugin-tailwindcss`'s `no-unnecessary-arbitrary-value`
 * rule pushes authors from `leading-[1.4]` to a bare-number utility, but in
 * Tailwind 4 a bare number is a SPACING MULTIPLE (`calc(var(--spacing) * n)`)
 * and must sit on the 0.25 grid — so `leading-1.4` matches nothing and emits
 * ZERO CSS. The counter-rule `no-custom-classname` is configured at severity
 * `warn`, and `yarn lint` runs `eslint . --cache` with no `--max-warnings`, so
 * that warning could never fail the gate. That is exactly how a dead
 * `leading-1.4` shipped in the Node 26 / Angular 22 upgrade sweep.
 *
 * The eslint rule is also unreliable in both directions (it missed
 * `text-primary` and `font-inherit`, and false-positives on the hand-authored
 * `max-w-blok-content`). So this gate asks the real compiler instead:
 * `__unstable__loadDesignSystem(...).candidatesToCss([token])` returns `null`
 * when a candidate resolves to nothing. No build, no PostCSS, no dist.
 *
 * SCOPE: the harvest only looks at CLASS CONTEXTS (see `collectSites`). A class
 * string held in a variable whose name says nothing about classes — e.g. the
 * `const map: Record<NotifierPosition, string>` in src/components/utils/notifier
 * — is invisible to it. Name such a constant `…Classes`/`…CSS` to bring it back
 * under the law. The dev playground (index.html) is not scanned for class USAGE
 * either: it is built against a different Tailwind entry, so this oracle would
 * judge it wrongly. Its `<style>` blocks ARE read, as declared class names.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const STYLES_ENTRY = resolve(REPO_ROOT, 'src/styles/main.css');

/**
 * Class names that are Tailwind-dead on purpose. Key = the token, value = the
 * reason. Seeded EMPTY on purpose: every entry is a hole in the law, so adding
 * one must be a deliberate, reviewed act with a written justification.
 */
const EXEMPTIONS: Record<string, string> = {
  'twitter-tweet': 'X/Twitter widgets.js hook — the blockquote is styled by the third-party embed script',
  'text-post-media': 'Threads embed hook — the blockquote is styled by the third-party embed script',
  'is-focused': 'behaviour marker read by Flipper/DomIterator; the visual state comes from [data-blok-focused]',
  className:
    'not a class at all — it is the VALUE of the `class` key in the HTML-attribute→React-prop map in packages/react/src/view-nodes-to-react.ts, which the harvest cannot tell apart from a class list',
};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

/**
 * A token that is SYNTHETIC: it can never be a Tailwind utility and can never be
 * declared in the repo's CSS, so no legitimate theme mapping or `@utility` can
 * flip it. That is why the guard below uses it instead of asserting the current
 * status of a real class name (the old guard hardcoded `border-border-primary`,
 * which would have gone red the day someone added a `--color-border-primary`).
 */
const CANARY = 'zz-blok-law-canary-not-a-utility';

/**
 * Every shape a class string is written in inside this repo. Each source plants
 * the canary; the harvest MUST report it for all of them. This is the property
 * that stops the law from silently narrowing — an oracle-only guard cannot tell
 * a working harvest from one that harvests nothing.
 */
const CANARY_PROBES: Record<string, string> = {
  'twJoin with only one living token': `x.className = twJoin('flex', '${CANARY}');`,
  'lone single-token literal': `x.className = '${CANARY}';`,
  'majority of the tokens dead': `x.className = twMerge('flex', '${CANARY}', '${CANARY}-2', '${CANARY}-3');`,
  'multi-line template constant': `const A_CLASSES = \`\n  flex items-center\n  ${CANARY}\n\`;`,
  'arbitrary variant containing >': `x.className = 'flex [&>svg]:size-4 ${CANARY}';`,
  'classList.add': `el.classList.add('flex', '${CANARY}');`,
  'class-named object literal': `export const css = { row: 'flex ${CANARY}' };`,
  'Dom.make second argument': `const wrapper = $.make('div', 'flex ${CANARY}');`,
  'setAttribute("class")': `el.setAttribute('class', 'flex ${CANARY}');`,
  'conditional branch': `x.className = cond ? 'flex' : '${CANARY}';`,
};

function visit(entry: { name: string; isDirectory: () => boolean }, dir: string, pattern: RegExp, acc: string[]): void {
  if (SKIP_DIRS.has(entry.name)) return;

  const full = join(dir, entry.name);

  if (entry.isDirectory()) collect(full, pattern, acc);
  else if (pattern.test(entry.name)) acc.push(full);
}

function collect(dir: string, pattern: RegExp, acc: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) visit(entry, dir, pattern, acc);
  } catch {
    return acc;
  }

  return acc;
}

const CLASS_IN_SELECTOR = /\.(-?[A-Za-z_][\w-]*)/g;
const AMPERSAND_SUFFIX = /&([\w-]+)/g;

/**
 * Class names a selector introduces, composing `&__elem` / `&--mod` with the
 * class names of the enclosing rule.
 * @param {string} selector - selector text of the rule about to open
 * @param {Set<string>} parents - class names of the enclosing rule
 * @returns {Set<string>} class names this rule introduces
 */
function classNamesOfSelector(selector: string, parents: Set<string>): Set<string> {
  const own = new Set<string>();

  for (const match of selector.matchAll(CLASS_IN_SELECTOR)) own.add(match[1]);

  for (const match of selector.matchAll(AMPERSAND_SUFFIX)) {
    for (const parent of parents) own.add(parent + match[1]);
  }

  return own;
}

/**
 * Class names hand-authored in a stylesheet. Tracks the brace structure so that
 * CSS-nested `&__elem` / `&--mod` selectors compose with their parent — a flat
 * `/\.([\w-]+)/g` scan never sees `icon-lightbox__btn` and reports it as dead.
 * @param {string} source - stylesheet text
 * @param {Set<string>} declared - accumulator
 * @returns {void}
 */
function addDeclaredFrom(source: string, declared: Set<string>): void {
  for (const match of source.matchAll(/@utility\s+([\w-]+)/g)) declared.add(match[1]);

  const stack: Set<string>[] = [];
  let buffer = '';

  for (const char of source) {
    if (char === '}') {
      stack.pop();
      buffer = '';
      continue;
    }

    if (char === ';') {
      buffer = '';
      continue;
    }

    if (char !== '{') {
      buffer += char;
      continue;
    }

    const parents = stack.at(-1) ?? new Set<string>();
    const own = classNamesOfSelector(buffer, parents);

    for (const name of own) declared.add(name);
    stack.push(own.size > 0 ? own : parents);
    buffer = '';
  }
}

/**
 * Class names hand-authored in the repo's own CSS (`@layer utilities`,
 * `@utility`, plain and nested selectors) plus the `<style>` blocks in the dev
 * playground. Tailwind does not know them, but they are real — this is what
 * keeps `max-w-blok-content` (src/styles/colors.css) green.
 * @returns {Set<string>} declared class names
 */
function collectDeclaredClassNames(): Set<string> {
  const declared = new Set<string>();
  const sources = collect(resolve(REPO_ROOT, 'src'), /\.css$/).map((file) => readFileSync(file, 'utf-8'));

  try {
    const playground = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf-8');

    for (const match of playground.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) sources.push(match[1]);
  } catch {
    // no playground in a consumer checkout — nothing to add
  }

  for (const source of sources) addDeclaredFrom(source, declared);

  return declared;
}

/** Helpers whose arguments together form ONE class string. */
const TW_HELPERS = new Set(['twMerge', 'twJoin', 'clsx', 'classNames', 'cn', 'cx', 'cva', 'tv']);
const CLASSLIST_METHODS = new Set(['add', 'remove', 'toggle', 'replace']);
/**
 * Identifiers that hold class strings. PLURAL `STYLES` only — singular `Style`
 * names (`SR_ONLY_STYLE`, `timeStyle`, `style: 'ordered'`) hold inline CSS text
 * or enum values and produce nothing but false positives.
 */
const CLASS_NAME_RE =
  /^(?:css|styles|classes|classname)|(?:^|_)(?:CLASS|CLASSES|STYLES)$|(?:Class|Classes|ClassName|ClassNames|Styles)$/i;
/** Glued at every `${…}` boundary so an interpolated token is never judged. */
const DYNAMIC = String.fromCharCode(1);

type HarvestMode = 'keys' | 'values';

interface ClassStringSite {
  file: string;
  line: number;
  value: string;
}

function calleeName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;

  return undefined;
}

function tokensOfBinary(node: ts.BinaryExpression, out: string[], mode: HarvestMode): void {
  const operator = node.operatorToken.kind;

  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
    tokensOfExpression(node.right, out, mode);

    return;
  }

  if (
    operator === ts.SyntaxKind.BarBarToken ||
    operator === ts.SyntaxKind.QuestionQuestionToken ||
    operator === ts.SyntaxKind.PlusToken
  ) {
    tokensOfExpression(node.left, out, mode);
    tokensOfExpression(node.right, out, mode);
  }
}

function tokensOfObject(node: ts.ObjectLiteralExpression, out: string[], mode: HarvestMode): void {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;

    // `clsx({ 'foo-bar': cond })` — the KEY is the class; `const css = { row: '…' }` — the VALUE is.
    if (mode === 'values') tokensOfExpression(property.initializer, out, 'values');
    else if (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name)) out.push(property.name.text);
  }
}

function tokensOfTemplate(node: ts.TemplateExpression, out: string[], mode: HarvestMode): void {
  out.push(node.head.text + DYNAMIC);

  for (const span of node.templateSpans) {
    const tail = span.literal.kind === ts.SyntaxKind.TemplateTail ? '' : DYNAMIC;

    out.push(DYNAMIC + span.literal.text + tail);
    // `${cond ? 'text-gray-text' : 'opacity-40'}` — the interpolation is class-valued too.
    tokensOfExpression(span.expression, out, mode);
  }
}

function tokensOfCall(node: ts.CallExpression, out: string[], mode: HarvestMode): void {
  const name = calleeName(node);

  if (name !== undefined && TW_HELPERS.has(name)) {
    for (const argument of node.arguments) tokensOfExpression(argument, out, mode);

    return;
  }

  // `[…].filter(Boolean).join(' ')` — walk back to the array.
  if ((name === 'join' || name === 'filter' || name === 'map') && ts.isPropertyAccessExpression(node.expression)) {
    tokensOfExpression(node.expression.expression, out, mode);
  }

  // Any other call is opaque: NEVER descend. That is what keeps
  // `getPlaceholderClasses('always')` inside a twMerge from contributing 'always'.
}

/**
 * Pull class tokens out of a class-VALUED expression. Never descends into a
 * non-helper call, and never into a conditional's CONDITION (which is how
 * `edge === 'bottom' ? … : …` used to report `bottom`).
 * @param {ts.Node | undefined} node - expression in class position
 * @param {string[]} out - accumulator
 * @param {HarvestMode} mode - whether object literals contribute keys or values
 * @returns {void}
 */
function tokensOfExpression(node: ts.Node | undefined, out: string[], mode: HarvestMode = 'keys'): void {
  if (node === undefined) return;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) tokensOfTemplate(node, out, mode);
  else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    tokensOfExpression(node.expression, out, mode);
  } else if (ts.isConditionalExpression(node)) {
    tokensOfExpression(node.whenTrue, out, mode);
    tokensOfExpression(node.whenFalse, out, mode);
  } else if (ts.isBinaryExpression(node)) tokensOfBinary(node, out, mode);
  else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      tokensOfExpression(ts.isSpreadElement(element) ? element.expression : element, out, mode);
    }
  } else if (ts.isObjectLiteralExpression(node)) tokensOfObject(node, out, mode);
  else if (ts.isCallExpression(node)) tokensOfCall(node, out, mode);
  // Identifier / property access / anything else: dynamic, unjudgeable.
}

function isClassListCall(node: ts.CallExpression, name: string | undefined): boolean {
  return (
    name !== undefined &&
    CLASSLIST_METHODS.has(name) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.name.text === 'classList'
  );
}

/**
 * The class-valued arguments of a call, or `undefined` when the call is not a
 * class context at all.
 * @param {ts.CallExpression} node - call to inspect
 * @returns {{ args: ts.Node[]; mode: HarvestMode } | undefined} class arguments
 */
function classArgumentsOf(node: ts.CallExpression): { args: readonly ts.Node[]; mode: HarvestMode } | undefined {
  const name = calleeName(node);
  const [first, second] = node.arguments;

  if (name !== undefined && TW_HELPERS.has(name)) return { args: node.arguments, mode: 'keys' };
  // `.toggle(name, force)` — the 2nd argument is a boolean, not a class.
  if (isClassListCall(node, name)) return { args: name === 'toggle' ? node.arguments.slice(0, 1) : node.arguments, mode: 'keys' };
  if (name === 'setAttribute' && second !== undefined && ts.isStringLiteral(first) && first.text === 'class') {
    return { args: [second], mode: 'keys' };
  }
  // `Dom.make(tag, classNames, attrs)` / `$.make(…)` — the 2nd argument is the class list.
  if (name === 'make' && second !== undefined && first !== undefined && ts.isStringLiteral(first)) {
    return { args: [second], mode: 'values' };
  }

  return undefined;
}

function isClassAssignment(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    (node.left.name.text === 'className' || node.left.name.text === 'class')
  );
}

function isClassNamedDeclaration(node: ts.Node): node is ts.VariableDeclaration | ts.PropertyDeclaration {
  return (
    (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
    ts.isIdentifier(node.name) &&
    CLASS_NAME_RE.test(node.name.text)
  );
}

function isClassNamedProperty(node: ts.Node): node is ts.PropertyAssignment {
  if (!ts.isPropertyAssignment(node) || !(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) return false;

  const key = node.name.text;

  return key === 'className' || key === 'class' || CLASS_NAME_RE.test(key);
}

/**
 * Harvest every CLASS CONTEXT in a source file. Restricting the harvest to
 * places that syntactically hold a class list is what lets the gate below judge
 * EVERY token it sees — the old regex harvest scraped arbitrary string literals
 * and had to guess with a "≥60% of the tokens resolve" confidence ratio, which
 * was anti-monotone: the more classes broke, the more sites it dropped.
 * @param {string} file - path being scanned (for reporting only)
 * @param {string} source - file contents
 * @returns {ClassStringSite[]} one site per class context
 */
function collectSites(file: string, source: string): ClassStringSite[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: ClassStringSite[] = [];
  const push = (node: ts.Node, out: string[]): void => {
    if (out.length === 0) return;

    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    sites.push({ file, line, value: out.join(' ') });
  };
  const walk = (node: ts.Node): void => {
    const call = ts.isCallExpression(node) ? classArgumentsOf(node) : undefined;

    if (call !== undefined) {
      const out: string[] = [];

      for (const argument of call.args) tokensOfExpression(argument, out, call.mode);
      push(node, out);
    }

    if (isClassAssignment(node)) {
      const out: string[] = [];

      tokensOfExpression(node.right, out, 'values');
      push(node, out);
    }

    if (isClassNamedDeclaration(node) || isClassNamedProperty(node)) {
      const out: string[] = [];

      tokensOfExpression(node.initializer, out, 'values');
      push(node, out);
    }

    ts.forEachChild(node, walk);
  };

  walk(sourceFile);

  return sites;
}

function collectClassStrings(): ClassStringSite[] {
  const roots = [resolve(REPO_ROOT, 'src'), resolve(REPO_ROOT, 'packages')];

  return roots
    .flatMap((root) => collect(root, /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/))
    .filter((file) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
    .flatMap((file) => collectSites(file, readFileSync(file, 'utf-8')));
}

/** Variant markers that are real Tailwind syntax but emit no CSS of their own. */
const VARIANT_MARKER = /^(?:group|peer)(?:\/[\w-]+)?$/;
/** Inline CSS TEXT (`cssText`, a console `%c` style, a CSS rule) — never a class list. */
const CSS_TEXT = /[;{}]|:\s/;

/**
 * Tokens of `site` that resolve to no CSS. There is deliberately NO confidence
 * ratio: every token in a class context is judged, so the law cannot weaken as
 * breakage widens.
 * @param {ClassStringSite} site - harvested class string
 * @param {(token: string) => boolean} emits - compiler oracle
 * @param {Set<string>} declared - hand-authored CSS class names
 * @returns {string[]} dead tokens
 */
function deadTokensOf(site: ClassStringSite, emits: (token: string) => boolean, declared: Set<string>): string[] {
  if (CSS_TEXT.test(site.value)) return [];

  return site.value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !token.includes(DYNAMIC))
    .filter((token) => {
      const bare = token.replace(/^.*:/, '').replace(/^-/, '').replace(/\/.*$/, '');

      // A utility always starts with a letter, `-`, `[`, `*` or `!` — never a digit.
      if (!/^[a-zA-Z[*!-]/.test(token)) return false;
      if (VARIANT_MARKER.test(token)) return false;
      // Repo-owned BEM hooks. Safe ONLY because no Tailwind utility can start with
      // `blok-`; adding an `@utility blok-*` would hide breakage behind this rule.
      if (/^blok-/.test(token)) return false;
      // A data-attribute NAME — Tailwind's data-variants always carry `[` or `:`.
      if (/^data-[a-z0-9-]+$/.test(token)) return false;
      // `Object.hasOwn`, not `in`: `in` walks Object.prototype, which would
      // silently exempt classes named `constructor`, `toString`, `__proto__`…
      if (emits(token) || Object.hasOwn(EXEMPTIONS, token)) return false;

      return !declared.has(token) && !declared.has(bare);
    });
}

async function loadOracle(): Promise<(token: string) => boolean> {
  // `@tailwindcss/node` destructures only `{ base }` — no `onDependency` hook exists here.
  const design = await __unstable__loadDesignSystem(readFileSync(STYLES_ENTRY, 'utf-8'), {
    base: dirname(STYLES_ENTRY),
  });
  const cache = new Map<string, boolean>();

  return (token: string): boolean => {
    const cached = cache.get(token);

    if (cached !== undefined) return cached;

    let result = false;

    try {
      result = design.candidatesToCss([token])[0] !== null;
    } catch {
      result = false;
    }
    cache.set(token, result);

    return result;
  };
}

// Explicit suite timeout. Every test here boots a real Tailwind design system and
// the first one additionally parses every .ts/.tsx/.html file under src/ and
// packages/ with the TypeScript compiler. That is ~1.2s wall-clock in isolation but
// runs concurrently with ~730 other test files, and under that CPU contention it
// blows past Vitest's 5000ms default (observed failing on two consecutive full-suite
// runs while passing standalone). Raise the ceiling rather than shrink the law.
describe('Tailwind class emits law', () => {
  it('every class name used in src/ and packages/ compiles to CSS', async () => {
    const emits = await loadOracle();
    const declared = collectDeclaredClassNames();
    const dead = new Map<string, Set<string>>();

    for (const site of collectClassStrings()) {
      const where = `${relative(REPO_ROOT, site.file)}:${site.line}`;

      for (const token of deadTokensOf(site, emits, declared)) {
        dead.set(token, (dead.get(token) ?? new Set()).add(where));
      }
    }

    const report = [...dead.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([token, where]) => `  ${token}  →  ${[...where].slice(0, 5).join(', ')}`)
      .join('\n');

    expect(
      report,
      `These class names emit ZERO CSS under the installed Tailwind:\n${report}\n` +
        'Use the arbitrary form (e.g. `leading-[1.4]`) or a real theme token. ' +
        'Bare-number utilities are spacing multiples on a 0.25 grid, not raw values — ' +
        'do NOT trust the tailwindcss/no-unnecessary-arbitrary-value autofix here.'
    ).toBe('');
  });

  it('the compiler oracle really can tell a dead class from a live one', async () => {
    const emits = await loadOracle();

    // Mutation guard: if these ever flip, the gate above is vacuous.
    expect(emits('leading-1.4')).toBe(false);
    expect(emits('leading-[1.4]')).toBe(true);
    expect(emits(CANARY)).toBe(false);
    expect(emits('flex')).toBe(true);
    expect(collectDeclaredClassNames().has(CANARY)).toBe(false);
  });

  it('the harvest catches a dead class in every shape a class string is written in', async () => {
    const emits = await loadOracle();
    const declared = collectDeclaredClassNames();
    const missed = Object.entries(CANARY_PROBES)
      .filter(
        ([, source]) =>
          !collectSites('probe.ts', source)
            .flatMap((site) => deadTokensOf(site, emits, declared))
            .includes(CANARY)
      )
      .map(([label]) => `  ${label}`)
      .join('\n');

    expect(missed, `The harvest does not see a dead class written like this:\n${missed}`).toBe('');

    // Negative control: an all-living site must report nothing.
    expect(
      collectSites('probe.ts', `x.className = twJoin('flex', 'leading-[1.4]');`).flatMap((site) =>
        deadTokensOf(site, emits, declared)
      )
    ).toEqual([]);
  });
}, 60_000);
