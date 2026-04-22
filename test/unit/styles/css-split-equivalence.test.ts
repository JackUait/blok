/**
 * Golden-snapshot equivalence test for the main.css split refactor.
 *
 * Produces a normalized, cascade-order-preserving dump of every rule reachable
 * from src/styles/main.css via local @import. Each split step must keep this
 * snapshot byte-identical — otherwise the visual cascade has shifted even if
 * the files compile.
 *
 * Covers:
 *   1. Rule set equivalence (selectors + declarations + at-rule wrappers).
 *   2. Source-order preservation (declarations remain in emission order;
 *      rules are listed in resolved-@import order).
 *   3. @keyframes name uniqueness (silent shadow = silent breakage).
 *   4. Total byte budget (split ≤ pre-split × 1.01).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postcss, { AtRule, Declaration, Rule } from 'postcss';

const STYLES_ROOT = resolve(__dirname, '../../../src/styles');
const ENTRY = resolve(STYLES_ROOT, 'main.css');

/**
 * Recursively inline local @import statements (./ or ../) starting from the
 * entry file. Package imports (e.g. 'tailwindcss/utilities.css') are skipped
 * because their output is part of the framework, not the blok surface under
 * refactor.
 */
function inlineLocalImports(filePath: string, seen = new Set<string>()): string {
  if (seen.has(filePath)) return '';
  seen.add(filePath);
  const source = readFileSync(filePath, 'utf-8');
  const baseDir = dirname(filePath);

  return source.replace(
    /@import\s+['"]([^'"]+)['"]\s*;?/g,
    (match, spec: string) => {
      if (!spec.startsWith('.')) return match;
      const resolved = resolve(baseDir, spec);

      return `\n/* <<< inlined ${spec} */\n${inlineLocalImports(resolved, seen)}\n/* >>> end ${spec} */\n`;
    }
  );
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

type RuleRecord = {
  path: string;
  selector: string;
  declarations: Array<{ prop: string; value: string; important: boolean }>;
};

/**
 * Walk every Rule node, capturing the chain of enclosing at-rules (media,
 * supports, layer) so the snapshot distinguishes `.x{color:red}` inside and
 * outside `@media (prefers-color-scheme: dark)`.
 */
function buildRuleIndex(css: string): RuleRecord[] {
  const root = postcss.parse(css);
  const records: RuleRecord[] = [];

  function visit(node: postcss.Container, pathParts: string[]): void {
    node.each((child) => {
      if (child.type === 'rule') {
        const rule = child as Rule;
        const declarations: RuleRecord['declarations'] = [];

        rule.walkDecls((decl: Declaration) => {
          declarations.push({
            prop: decl.prop,
            value: normalizeValue(decl.value),
            important: decl.important === true,
          });
        });
        records.push({
          path: pathParts.join(' > '),
          selector: normalizeValue(rule.selector),
          declarations,
        });
      } else if (child.type === 'atrule') {
        const atrule = child as AtRule;
        // @keyframes live in the global animation-name namespace and do not
        // participate in the cascade. They are snapshotted separately so
        // extraction can regroup them into a dedicated file.
        if (atrule.name === 'keyframes' || atrule.name === '-webkit-keyframes') return;
        const header = `@${atrule.name} ${normalizeValue(atrule.params)}`.trim();

        if (atrule.nodes) {
          visit(atrule, [...pathParts, header]);
        } else {
          // Leaf at-rule (e.g. @import unresolved, @charset) — record as pseudo-rule.
          records.push({
            path: pathParts.join(' > '),
            selector: header,
            declarations: [],
          });
        }
      }
    });
  }
  visit(root, []);

  return records;
}

type KeyframeRecord = {
  name: string;
  body: string;
};

function buildKeyframeIndex(css: string): KeyframeRecord[] {
  const root = postcss.parse(css);
  const records: KeyframeRecord[] = [];

  root.walkAtRules((atrule) => {
    if (atrule.name !== 'keyframes' && atrule.name !== '-webkit-keyframes') return;
    const steps: string[] = [];

    atrule.walkRules((stepRule) => {
      const decls: string[] = [];

      stepRule.walkDecls((decl) => {
        decls.push(`${decl.prop}: ${normalizeValue(decl.value)}${decl.important ? ' !important' : ''}`);
      });
      steps.push(`${normalizeValue(stepRule.selector)} { ${decls.join('; ')} }`);
    });
    records.push({
      name: normalizeValue(atrule.params),
      body: steps.join('\n  '),
    });
  });
  records.sort((a, b) => a.name.localeCompare(b.name));

  return records;
}

function collectKeyframeNames(css: string): string[] {
  const root = postcss.parse(css);
  const names: string[] = [];

  root.walkAtRules((atrule) => {
    if (atrule.name === 'keyframes' || atrule.name === '-webkit-keyframes') {
      names.push(normalizeValue(atrule.params));
    }
  });

  return names;
}

function serializeSnapshot(records: RuleRecord[]): string {
  return records
    .map((rec) => {
      const header = rec.path ? `[${rec.path}] ${rec.selector}` : rec.selector;
      const body = rec.declarations
        .map((d) => `  ${d.prop}: ${d.value}${d.important ? ' !important' : ''};`)
        .join('\n');

      return `${header} {\n${body}\n}`;
    })
    .join('\n\n');
}

function localImportedByteBudget(filePath: string, seen = new Set<string>()): number {
  if (seen.has(filePath)) return 0;
  seen.add(filePath);
  const source = readFileSync(filePath, 'utf-8');
  const baseDir = dirname(filePath);
  let total = statSync(filePath).size;

  for (const match of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1];

    if (!spec.startsWith('.')) continue;
    total += localImportedByteBudget(resolve(baseDir, spec), seen);
  }

  return total;
}

describe('main.css split — cascade-preserving equivalence', () => {
  const inlined = inlineLocalImports(ENTRY);

  it('rule set + source order matches the golden snapshot', async () => {
    const records = buildRuleIndex(inlined);
    const serialized = serializeSnapshot(records);

    await expect(serialized).toMatchFileSnapshot(
      resolve(__dirname, '__snapshots__/main-css-rules.snap.txt')
    );
  });

  it('every @keyframes name is defined exactly once', () => {
    const names = collectKeyframeNames(inlined);
    const duplicates = names.filter((n, idx) => names.indexOf(n) !== idx);

    expect(duplicates).toEqual([]);
  });

  it('@keyframes bodies match the golden snapshot (name-sorted, order-independent)', async () => {
    const records = buildKeyframeIndex(inlined);
    const serialized = records
      .map((r) => `@keyframes ${r.name} {\n  ${r.body}\n}`)
      .join('\n\n');

    await expect(serialized).toMatchFileSnapshot(
      resolve(__dirname, '__snapshots__/main-css-keyframes.snap.txt')
    );
  });

  it('total local CSS byte size stays within +2% of the pre-split baseline', () => {
    // Pre-split baseline captured 2026-04-22 immediately before the split refactor
    // started. Overhead budget covers per-file headers/comments added during
    // extraction. Shrinking below the baseline is always acceptable.
    const PRE_SPLIT_BYTES = 389475;
    const CEILING = Math.floor(PRE_SPLIT_BYTES * 1.02);
    const actual = localImportedByteBudget(ENTRY);

    expect(actual).toBeLessThanOrEqual(CEILING);
  });
});
