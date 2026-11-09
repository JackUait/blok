import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — every database popover opens and closes the same way.
 *
 * Notion's database menus and panels fade and scale in over 200ms, and close
 * by playing that in reverse (notion-motion.md "Popovers"). database.css gives
 * that motion to a popover with a database class, but the close only plays
 * when the popover is built with `animateClose: true`. Without it the card
 * vanishes at once, which is how Filter, Sort and a row page's menus drifted.
 *
 * So each `new PopoverDesktop(...)` under src/tools/database passes both a
 * `class` and `animateClose`.
 */

const DATABASE_ROOT = join(__dirname, '../../../src/tools/database');

const collect = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
};

/** Every variable initializer in the file, by name. */
const initializers = (source: ts.SourceFile): Map<string, ts.Expression> => {
  const found = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      found.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
};

/** The keys the params expression surely sets: spreads and plain variables followed, a ternary needs both sides. */
const keysOf = (expr: ts.Expression, vars: Map<string, ts.Expression>, seen = new Set<string>()): Set<string> => {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return keysOf(expr.expression, vars, seen);
  }
  if (ts.isIdentifier(expr)) {
    const init = vars.get(expr.text);

    if (init === undefined || seen.has(expr.text)) return new Set();

    return keysOf(init, vars, new Set([...seen, expr.text]));
  }
  if (ts.isConditionalExpression(expr)) {
    const a = keysOf(expr.whenTrue, vars, seen);
    const b = keysOf(expr.whenFalse, vars, seen);

    return new Set([...a].filter((key) => b.has(key)));
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return new Set(expr.properties.flatMap((prop): string[] => {
      if (ts.isSpreadAssignment(prop)) return [...keysOf(prop.expression, vars, seen)];

      return prop.name !== undefined && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? [prop.name.text] : [];
    }));
  }

  return new Set();
};

interface Site { at: string; keys: Set<string> }

const sites = (): Site[] => collect(DATABASE_ROOT).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const vars = initializers(source);
  const found: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'PopoverDesktop') {
      const arg = node.arguments?.[0];
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      found.push({ at: `${relative(DATABASE_ROOT, file)}:${line}`, keys: arg === undefined ? new Set() : keysOf(arg, vars) });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
});

describe('database popover motion law', () => {
  const all = sites();

  it('finds the database popovers', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it('every database popover closes with the motion it opened with', () => {
    expect(all.filter((site) => !site.keys.has('animateClose')).map((site) => site.at)).toEqual([]);
  });

  it('every database popover has a database class, so database.css gives it the motion', () => {
    expect(all.filter((site) => !site.keys.has('class')).map((site) => site.at)).toEqual([]);
  });
});
