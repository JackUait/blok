import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

export const REPO_ROOT = join(__dirname, '../../../..');
export const SRC_ROOT = join(REPO_ROOT, 'src');

export interface Capability {
  id: string;
  file: string;
  line: number;
}

// These directories do not ship editor capabilities.
const SKIPPED_DIRS = new Set(['playground', 'stories']);

export const walkTs = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory() && !SKIPPED_DIRS.has(entry)) {
      files.push(...walkTs(full));
    } else if (stat.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full);
    }
  }

  return files;
};

export const toRepoPath = (file: string): string => relative(REPO_ROOT, file).split(sep).join('/');

export const parseSource = (text: string, fileName = 'fixture.ts'): ts.SourceFile =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

export const parseFile = (file: string): ts.SourceFile => parseSource(readFileSync(file, 'utf8'), file);

export const visit = (node: ts.Node, fn: (node: ts.Node) => void): void => {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
};

export const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

export const propertyNamed = (
  literal: ts.ObjectLiteralExpression,
  key: string
): ts.ObjectLiteralElementLike | undefined =>
  literal.properties.find((property) =>
    !ts.isSpreadAssignment(property) && ts.isIdentifier(property.name) && property.name.text === key
  );

export const staticNames = (expr: ts.Expression): string[] | null => {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return [expr.text];
  }

  if (ts.isTemplateExpression(expr)) {
    // Dynamic suffixes share one capability prefix.
    return [`${expr.head.text}*`];
  }

  if (ts.isParenthesizedExpression(expr)) {
    return staticNames(expr.expression);
  }

  if (ts.isConditionalExpression(expr)) {
    const whenTrue = staticNames(expr.whenTrue);
    const whenFalse = staticNames(expr.whenFalse);

    return whenTrue !== null && whenFalse !== null ? [...whenTrue, ...whenFalse] : null;
  }

  return null;
};
