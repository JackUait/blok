import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — a block made by a keystroke gets the caret.
 *
 * `api.blocks.splitBlock()` and `api.blocks.insert()` / `insertInsideParent()`
 * never move the caret. A keyboard handler that creates a block and stops there
 * leaves the caret in the OLD block, so the user's next keystrokes land in the
 * wrong place (toggle Enter typed "ZTitle"; code Shift+Enter typed into the
 * code). Nothing throws, so only a test notices.
 *
 * THE LAW: the created block is bound to a variable, and the same function
 * moves the caret into it — `caret.setToBlock(<block>.id | <block>, …)` or
 * `setCaretToBlockContent*(api, <block>, …)` — or the site is in EXEMPTIONS
 * with a reason.
 *
 * Scanned sites:
 * - every `splitBlock(` call under src/tools (a split is always a keystroke);
 * - every `insert(` / `insertInsideParent(` call in a `*-keyboard.ts` file, or
 *   in a function whose name says it handles a key (`…Enter…`, `exit…`).
 */

const TOOLS_ROOT = join(__dirname, '../../../src/tools');

const SPLIT_CALLS = new Set(['splitBlock']);
const INSERT_CALLS = new Set(['insert', 'insertInsideParent']);
const CARET_CALLS = new Set(['setToBlock', 'setCaretToBlockContent', 'setCaretToBlockContentOffset']);
const KEY_HANDLER_NAME = /enter|^exit/i;

/**
 * Sites exempt from the law, keyed `<file relative to src/tools>#<function>`,
 * with the reason the caret is placed elsewhere.
 */
const EXEMPTIONS: Record<string, string> = {
  'toggle/toggle-keyboard.ts#insertEmptyBlockAboveOnEnterAtStart':
    'Enter at the start of a title adds an empty block ABOVE; the caret stays at the start of the title (Notion).',
};

interface Site {
  key: string;
  call: string;
  line: number;
  ok: boolean;
}

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

const calleeName = (call: ts.CallExpression): string | null =>
  ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;

const enclosingFunction = (node: ts.Node): ts.FunctionLikeDeclaration | null => {
  for (let cursor = node.parent; cursor !== undefined; cursor = cursor.parent) {
    if (ts.isFunctionLike(cursor) && 'body' in cursor && cursor.body !== undefined) {
      return cursor;
    }
  }

  return null;
};

/** A function's own name, or the name of the variable/property it is assigned to. */
const functionName = (fn: ts.FunctionLikeDeclaration): string => {
  if (fn.name !== undefined && (ts.isIdentifier(fn.name) || ts.isPrivateIdentifier(fn.name))) {
    return fn.name.text;
  }

  const parent = fn.parent;

  if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  return '<anonymous>';
};

/** The `const x = [await] call(…)` declaration holding the call's result, if any. */
const bindingOf = (call: ts.CallExpression): ts.VariableDeclaration | null => {
  const parent = ts.isAwaitExpression(call.parent) ? call.parent.parent : call.parent;

  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent : null;
};

/**
 * True when a statement AFTER the declaration, in the same block, moves the
 * caret into the declared block. Scoped that way because a handler often has
 * two `newBlock`s in different branches: a match on the name alone would let
 * one branch's caret call cover the other's.
 */
const setsCaretInto = (declaration: ts.VariableDeclaration): boolean => {
  const name = (declaration.name as ts.Identifier).text;
  const statement = declaration.parent.parent;
  const container = statement.parent;

  if (!ts.isVariableStatement(statement) || !(ts.isBlock(container) || ts.isSourceFile(container))) {
    return false;
  }

  const refersTo = (arg: ts.Expression): boolean =>
    (ts.isIdentifier(arg) && arg.text === name) ||
    (ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === name && arg.name.text === 'id');

  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : calleeName(node);

      if (callee !== null && CARET_CALLS.has(callee) && node.arguments.some(refersTo)) {
        found = true;

        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  container.statements.slice(container.statements.indexOf(statement) + 1).forEach(visit);

  return found;
};

const scan = (): Site[] => {
  const sites: Site[] = [];

  for (const file of collect(TOOLS_ROOT)) {
    const rel = relative(TOOLS_ROOT, file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const keyboardFile = file.endsWith('-keyboard.ts');

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = calleeName(node);
        const fn = enclosingFunction(node);
        const name = fn === null ? '<module>' : functionName(fn);
        const isSplit = callee !== null && SPLIT_CALLS.has(callee);
        const isKeyInsert = callee !== null && INSERT_CALLS.has(callee) && (keyboardFile || KEY_HANDLER_NAME.test(name));

        if ((isSplit || isKeyInsert) && callee !== null) {
          const binding = bindingOf(node);

          sites.push({
            key: `${rel}#${name}`,
            call: callee,
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            ok: binding !== null && setsCaretInto(binding),
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return sites;
};

describe('split caret law', () => {
  it('finds the known keystroke sites (guards against the scan going stale)', () => {
    const keys = scan().map(site => `${site.key}:${site.call}`);

    expect(keys).toContain('toggle/toggle-keyboard.ts#handleToggleEnter:splitBlock');
    expect(keys).toContain('header/header-toggle-keyboard.ts#handleHeaderToggleEnter:splitBlock');
    expect(keys).toContain('list/list-keyboard.ts#handleEnter:splitBlock');
    expect(keys).toContain('code/index.ts#exitBlock:insert');
  });

  it('every keystroke that creates a block moves the caret into it (or is exempt with a reason)', () => {
    const violations = scan()
      .filter(site => !site.ok && !(site.key in EXEMPTIONS))
      .map(site => `  - ${site.key} (line ${site.line}, ${site.call})`);

    expect(
      violations,
      'These keyboard paths create a block but never move the caret into it, so ' +
      'the next keystrokes land in the old block:\n' +
      `${violations.join('\n')}\n` +
      'Bind the result (`const newBlock = api.blocks.splitBlock(…)`) and call ' +
      '`api.caret.setToBlock(newBlock.id, \'start\')`, or add an exemption with a reason.'
    ).toEqual([]);
  });

  it('every exemption still points at a scanned site (no stale entries)', () => {
    const keys = new Set(scan().map(site => site.key));

    for (const [key, reason] of Object.entries(EXEMPTIONS)) {
      expect(keys.has(key), `Stale exemption: ${key}`).toBe(true);
      expect(reason.length, `Exemption for ${key} needs a real reason`).toBeGreaterThan(20);
    }
  });
});
