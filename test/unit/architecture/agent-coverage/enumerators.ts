import { join } from 'node:path';

import ts from 'typescript';

import { defaultInlineTools } from '../../../../src/tools';
import { BLOCK_TOOL_CLASSES } from './registry';
import { SRC_ROOT, lineOf, parseFile, propertyNamed, toRepoPath, visit } from './scan';
import type { Capability } from './scan';

type ToolboxEntry = { name?: string };

const toolboxOf = (tool: unknown): ToolboxEntry[] => {
  if (tool === null || (typeof tool !== 'object' && typeof tool !== 'function') || !('toolbox' in tool)) {
    return [];
  }

  const toolbox: unknown = tool.toolbox;
  const entries: unknown[] = Array.isArray(toolbox) ? toolbox : [toolbox];

  return entries.filter((entry): entry is ToolboxEntry =>
    typeof entry === 'object' && entry !== null &&
    (!('name' in entry) || entry.name === undefined || typeof entry.name === 'string')
  );
};

export const insertIds = (registry: Record<string, unknown>): Capability[] =>
  Object.entries(registry).flatMap(([key, tool]) => {
    const entries = toolboxOf(tool);

    return entries.map((entry) => {
      const single = entries.length === 1 && (entry.name === undefined || entry.name === key);

      return {
        id: single ? `insert:${key}` : `insert:${key}/${entry.name ?? key}`,
        file: 'src/tools/index.ts',
        line: 0,
      };
    });
  });

export const formatIds = (): Capability[] =>
  Object.keys(defaultInlineTools).map((key) => ({ id: `format:${key}`, file: 'src/tools/index.ts', line: 0 }));

export const tuneIdsFromToolsModule = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const capabilities: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isGetAccessorDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'internalTools') {
      return;
    }

    visit(node, (inner) => {
      if (!ts.isPropertyAssignment(inner) || !ts.isObjectLiteralExpression(inner.initializer)) {
        return;
      }

      const classProperty = propertyNamed(inner.initializer, 'class');

      if (classProperty === undefined || !ts.isPropertyAssignment(classProperty)) {
        return;
      }

      const expression = classProperty.initializer;
      const toolClass = ts.isCallExpression(expression) ? expression.arguments[0] : expression;

      if (toolClass !== undefined && ts.isIdentifier(toolClass) && toolClass.text.endsWith('Tune') &&
        (ts.isIdentifier(inner.name) || ts.isStringLiteral(inner.name))) {
        capabilities.push({ id: `tune:${inner.name.text}`, file: repoPath, line: lineOf(source, inner) });
      }
    });
  });

  return capabilities;
};

export const tuneIdsFromBlockSettings = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const capabilities: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) {
      return;
    }

    const name = propertyNamed(node, 'name');

    if (name !== undefined && ts.isPropertyAssignment(name) && ts.isStringLiteral(name.initializer)) {
      capabilities.push({ id: `tune:${name.initializer.text}`, file: repoPath, line: lineOf(source, node) });
    }
  });

  return capabilities;
};

export const enumerateTunes = (): Capability[] => {
  const tools = join(SRC_ROOT, 'components/modules/tools.ts');
  const settings = join(SRC_ROOT, 'components/modules/toolbar/blockSettings.ts');

  return [
    ...tuneIdsFromToolsModule(parseFile(tools), toRepoPath(tools)),
    ...tuneIdsFromBlockSettings(parseFile(settings), toRepoPath(settings)),
  ];
};

export const enumerateInsert = (): Capability[] => insertIds(BLOCK_TOOL_CLASSES);
