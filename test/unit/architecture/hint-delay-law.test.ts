import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MIN_HINT_DELAY } from '../../../src/components/utils/tooltip';

/**
 * ARCHITECTURE LAW — a hint never shows instantly.
 *
 * A hint (tooltip) appears only on hover, and only after a delay. The tooltip
 * module enforces it at runtime; this law keeps call sites from working around
 * it:
 *
 * 1. `showReadout` (no delay) is for live feedback during a gesture, never for
 *    a hover hint. Only the files in READOUT_USERS may import it, each with a
 *    reason.
 * 2. No `show` / `onHover` call passes a literal `delay` below MIN_HINT_DELAY.
 *    The runtime raises it anyway, so such a value only misleads the reader.
 * 3. No `focus` / `focusin` listener shows a hint. A click focuses its target,
 *    so a focus-driven hint opens at once on click.
 */

const SRC_ROOT = join(__dirname, '../../../src');
const TOOLTIP_MODULE = join(SRC_ROOT, 'components/utils/tooltip.ts');

const READOUT_USERS: Record<string, string> = {
  'tools/table/table-add-controls.ts': 'Live "cols×rows" size readout while dragging the add-row/add-column button.',
  'tools/table/table-corner-drag.ts': 'Live "cols×rows" size readout while dragging the table corner.',
  'tools/table/table-row-col-controls.ts': 'Says why a drag of a merge-locked row/column was refused, at the moment it is refused.',
};

const HINT_EXPORTS = new Set(['show', 'onHover']);
const FOCUS_EVENTS = new Set(['focus', 'focusin']);

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

const importsTooltip = (file: string, specifier: string): boolean =>
  specifier.startsWith('.') && resolve(dirname(file), `${specifier}.ts`) === TOOLTIP_MODULE;

interface FileScan {
  rel: string;
  /** Local name → tooltip export name, for every value imported from the tooltip module. */
  bindings: Map<string, string>;
  source: ts.SourceFile;
}

const scan = (file: string): FileScan => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const named = statement.importClause?.namedBindings;

    if (statement.importClause?.isTypeOnly || named === undefined || !ts.isNamedImports(named)) {
      continue;
    }

    if (!importsTooltip(file, statement.moduleSpecifier.text)) {
      continue;
    }

    for (const element of named.elements) {
      bindings.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }

  return { rel: relative(SRC_ROOT, file), bindings, source };
};

const files = collect(SRC_ROOT).map(scan);

const visit = (node: ts.Node, fn: (node: ts.Node) => void): void => {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
};

/** Name of the tooltip export a call goes to, if any (`show(...)`, `tooltipShow(...)`, `this.show(...)` inside the module). */
const hintCallee = (scanned: FileScan, call: ts.CallExpression): string | null => {
  if (ts.isIdentifier(call.expression)) {
    const exported = scanned.bindings.get(call.expression.text);

    return exported !== undefined && HINT_EXPORTS.has(exported) ? exported : null;
  }

  return null;
};

const callsHint = (scanned: FileScan, body: ts.Node): boolean => {
  let found = false;

  visit(body, (node) => {
    if (ts.isCallExpression(node) && hintCallee(scanned, node) !== null) {
      found = true;
    }
  });

  return found;
};

/** Body of a listener argument: an inline function, or a same-file `const name = () => …`. */
const listenerBody = (scanned: FileScan, handler: ts.Expression): ts.Node | null => {
  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    return handler.body;
  }

  if (!ts.isIdentifier(handler)) {
    return null;
  }

  let body: ts.Node | null = null;

  visit(scanned.source, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === handler.text &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      body = node.initializer.body;
    }
  });

  return body;
};

const lineOf = (scanned: FileScan, node: ts.Node): number =>
  scanned.source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

describe('hint delay law: hints show on hover only, after a delay', () => {
  it('scans the files that use the tooltip', () => {
    expect(files.filter((f) => f.bindings.size > 0).length).toBeGreaterThan(10);
  });

  it('lets only the listed readout files import showReadout', () => {
    const importers = files
      .filter((f) => [...f.bindings.values()].includes('showReadout'))
      .map((f) => f.rel)
      .sort();

    expect(importers).toStrictEqual(Object.keys(READOUT_USERS).sort());
  });

  it('passes no literal delay below the minimum hint delay', () => {
    const offenders: string[] = [];

    for (const scanned of files) {
      visit(scanned.source, (node) => {
        if (!ts.isCallExpression(node) || hintCallee(scanned, node) === null) {
          return;
        }

        const options = node.arguments[2];

        if (options === undefined || !ts.isObjectLiteralExpression(options)) {
          return;
        }

        for (const property of options.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'delay' &&
            ts.isNumericLiteral(property.initializer) &&
            Number(property.initializer.text) < MIN_HINT_DELAY
          ) {
            offenders.push(`${scanned.rel}:${lineOf(scanned, property)} delay ${property.initializer.text}`);
          }
        }
      });
    }

    expect(offenders).toStrictEqual([]);
  });

  it('shows no hint from a focus listener', () => {
    const offenders: string[] = [];

    for (const scanned of files) {
      const isTooltipModule = scanned.rel === relative(SRC_ROOT, TOOLTIP_MODULE);

      visit(scanned.source, (node) => {
        if (
          !ts.isCallExpression(node) ||
          !ts.isPropertyAccessExpression(node.expression) ||
          node.expression.name.text !== 'addEventListener'
        ) {
          return;
        }

        const [event, handler] = node.arguments;

        if (event === undefined || !ts.isStringLiteral(event) || !FOCUS_EVENTS.has(event.text) || handler === undefined) {
          return;
        }

        const body = listenerBody(scanned, handler);

        // Inside the tooltip module every listener belongs to a hint trigger.
        if (isTooltipModule || (body !== null && callsHint(scanned, body))) {
          offenders.push(`${scanned.rel}:${lineOf(scanned, node)} '${event.text}' listener`);
        }
      });
    }

    expect(offenders).toStrictEqual([]);
  });
});
