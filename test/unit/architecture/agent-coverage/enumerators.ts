import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { defaultInlineTools } from '../../../../src/tools';
import { BLOCK_TOOL_CLASSES } from './registry';
import { REPO_ROOT, SRC_ROOT, lineOf, parseFile, propertyNamed, staticNames, toRepoPath, visit, walkTs } from './scan';
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

// Tool code the server runtime also loads lives in src/shared/<tool>.
const SHARED_TOOL_DIRS = ['database'];

export const toolOf = (repoPath: string): string => {
  const shared = SHARED_TOOL_DIRS.some((dir) => repoPath.startsWith(`src/shared/${dir}/`));
  const parts = repoPath.replace(shared ? /^src\/shared\// : /^src\/tools\//, '').split('/');

  if (parts[0] === 'link' && parts.length > 2) {
    return parts[1];
  }

  return parts[0].replace(/\.ts$/, '');
};

export interface MenuScan {
  capabilities: Capability[];
  unnamed: string[];
}

export const scanMenus = (source: ts.SourceFile, repoPath: string): MenuScan => {
  const tool = toolOf(repoPath);
  const capabilities: Capability[] = [];
  const unnamed: string[] = [];

  visit(source, (node) => {
    if (!ts.isObjectLiteralExpression(node) || propertyNamed(node, 'onActivate') === undefined) {
      return;
    }

    const line = lineOf(source, node);
    const name = propertyNamed(node, 'name');

    if (name === undefined) {
      // A spread may carry the name (toolbar/inline/index.ts does).
      if (!node.properties.some(ts.isSpreadAssignment)) {
        unnamed.push(`${repoPath}:${line}`);
      }

      return;
    }

    const names = ts.isPropertyAssignment(name) ? staticNames(name.initializer) : null;

    for (const itemName of names ?? [`*@${repoPath}`]) {
      capabilities.push({ id: `menu:${tool}/${itemName}`, file: repoPath, line });
    }
  });

  return { capabilities, unnamed };
};

export const scanToolMenus = (): MenuScan => {
  const scans = walkTs(join(SRC_ROOT, 'tools')).map((file) => scanMenus(parseFile(file), toRepoPath(file)));

  return {
    capabilities: scans.flatMap((scan) => scan.capabilities),
    unnamed: scans.flatMap((scan) => scan.unnamed),
  };
};

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const literalTypeText = (type: ts.TypeNode | undefined): string | null =>
  type !== undefined && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? type.literal.text : null;

const typeMemberValue = (member: ts.TypeNode): string | null => {
  if (!ts.isTypeLiteralNode(member)) {
    return null;
  }

  const typeProperty = member.members.find(
    (m): m is ts.PropertySignature => ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'type'
  );

  return literalTypeText(typeProperty?.type);
};

export const actionUnionIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const tool = toolOf(repoPath);

  return source.statements.flatMap((statement) => {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      !statement.name.text.endsWith('Action') ||
      !isExported(statement) ||
      !ts.isUnionTypeNode(statement.type)
    ) {
      return [];
    }

    return statement.type.types.flatMap((member) => {
      const value = typeMemberValue(member);

      return value === null ? [] : [{ id: `action:${tool}/${value}`, file: repoPath, line: lineOf(source, member) }];
    });
  });
};

const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

export const shortcutIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];
  const scope = repoPath.replace(/^src\//, '');

  visit(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'add' ||
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== 'Shortcuts'
    ) {
      return;
    }

    const options = node.arguments[0];
    const name = options !== undefined && ts.isObjectLiteralExpression(options) ? propertyNamed(options, 'name') : undefined;
    const initializer = name !== undefined && ts.isPropertyAssignment(name) ? name.initializer : undefined;
    const value = initializer !== undefined &&
      (ts.isStringLiteral(initializer) || (ts.isIdentifier(initializer) && CONSTANT_NAME.test(initializer.text)))
      ? initializer.text
      : '<dynamic>';

    out.push({ id: `shortcut:${scope}/${value}`, file: repoPath, line: lineOf(source, node) });
  });

  return out;
};

/**
 * Key handling with no registry. Each entry names the code it mirrors; keep in
 * sync by hand when those handlers change.
 */
export const HAND_KEYS: Record<string, string> = {
  'key:Mod+/': 'src/components/modules/blockEvents/index.ts:287 opens block settings',
  'key:Mod+Z': 'src/components/modules/uiControllers/controllers/keyboard.ts:75-77 undo',
  'key:Mod+Shift+Z': 'src/components/modules/uiControllers/controllers/keyboard.ts:75-77 redo',
  'key:Ctrl+Y': 'src/components/modules/uiControllers/controllers/keyboard.ts:77 redo on Windows/Linux',
  'key:Mod+F': 'src/components/modules/find/index.ts:466 find',
  'key:Replace': 'src/components/modules/find/index.ts:467-469 replace (Mod+Alt+F on macOS, Ctrl+H elsewhere)',
};

export const keyIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (
      ts.isCaseClause(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'keyCodes'
    ) {
      out.push({ id: `key:${node.expression.name.text}`, file: repoPath, line: lineOf(source, node) });
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'key' &&
      ts.isStringLiteral(node.right) &&
      node.right.text === '/'
    ) {
      out.push({ id: 'key:/', file: repoPath, line: lineOf(source, node) });
    }
  });

  return out;
};

const TYPING_HANDLER = /^handle[A-Z]\w*(Shortcut|Markdown)$/;

export const typingHandlerIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && TYPING_HANDLER.exec(node.name.text) !== null) {
      out.push({ id: `typing:${node.name.text}`, file: repoPath, line: lineOf(source, node) });
    }
  });

  return out;
};

/** Composer files that react to typed characters (`@`, `[[`, `:`). The other composers are key navigation. */
export const triggerFileIds = (dir: string): Capability[] =>
  readdirSync(dir)
    .filter((file) => /Trigger\.ts$/.test(file))
    .map((file) => ({ id: `typing:${file.replace(/\.ts$/, '')}`, file: toRepoPath(join(dir, file)), line: 0 }));

export const dragIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'DropTarget') {
      return;
    }

    const edge = node.members.find(
      (m): m is ts.PropertySignature => ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'edge'
    );

    if (edge?.type === undefined || !ts.isUnionTypeNode(edge.type)) {
      return;
    }

    for (const member of edge.type.types) {
      const value = literalTypeText(member);

      if (value !== null) {
        out.push({ id: `drag:${value}`, file: repoPath, line: lineOf(source, member) });
      }
    }
  });

  return out;
};

const fromFile = (relative: string, fn: (source: ts.SourceFile, repoPath: string) => Capability[]): Capability[] => {
  const file = join(SRC_ROOT, relative);

  return fn(parseFile(file), toRepoPath(file));
};

export const enumerateActionUnions = (): Capability[] =>
  [join(SRC_ROOT, 'tools'), ...SHARED_TOOL_DIRS.map((dir) => join(SRC_ROOT, 'shared', dir))]
    .flatMap((root) => walkTs(root))
    .flatMap((file) => actionUnionIds(parseFile(file), toRepoPath(file)));

export const enumerateShortcuts = (): Capability[] =>
  walkTs(SRC_ROOT).flatMap((file) => shortcutIds(parseFile(file), toRepoPath(file)));

export const enumerateKeys = (): Capability[] => [
  ...fromFile('components/modules/blockEvents/index.ts', keyIds),
  ...Object.entries(HAND_KEYS).map(([id, where]) => ({ id, file: where.split(':')[0], line: 0 })),
];

export const enumerateTyping = (): Capability[] => [
  ...fromFile('components/modules/blockEvents/composers/markdownShortcuts.ts', typingHandlerIds),
  ...triggerFileIds(join(SRC_ROOT, 'components/modules/blockEvents/composers')),
];

export const enumerateDrag = (): Capability[] => [
  ...fromFile('components/modules/drag/target/DropTargetDetector.ts', dragIds),
  // DropTargetDetector.ts DropTarget.zone (named drop-into zone) and DragController.ts (Alt duplicates on drop).
  { id: 'drag:into', file: 'src/components/modules/drag/target/DropTargetDetector.ts', line: 21 },
  { id: 'drag:duplicate', file: 'src/components/modules/drag/DragController.ts', line: 829 },
];

export const apiIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const seen = new Set<string>();
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'Blocks') {
      return;
    }

    for (const member of node.members) {
      const isFunction =
        ts.isMethodSignature(member) ||
        (ts.isPropertySignature(member) && member.type !== undefined && ts.isFunctionTypeNode(member.type));

      if (!isFunction || member.name === undefined || !ts.isIdentifier(member.name) || seen.has(member.name.text)) {
        continue;
      }

      seen.add(member.name.text);
      out.push({ id: `api:blocks.${member.name.text}`, file: repoPath, line: lineOf(source, member) });
    }
  });

  return out;
};

const UI_EVENTS = new Set(['click', 'pointerdown', 'mousedown', 'keydown', 'change', 'input', 'submit', 'dblclick', 'contextmenu']);

// Input callbacks a control builder takes (`panelRow({ onClick })`). Not onActivate: a menu item, scanMenus
// owns it. Not every on*: onSettle, onProgress and the like are internal callbacks, not a person's input.
const HANDLER_PROPS = new Set(['onClick', 'onInput', 'onChange', 'onToggle', 'onSubmit']);

const isHandlerProp = (node: ts.Node): boolean => {
  if (ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent)) {
    return ts.isIdentifier(node.name) && HANDLER_PROPS.has(node.name.text);
  }

  return ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && HANDLER_PROPS.has(node.name.text) &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
};

export const uiFileIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  let line = 0;

  visit(source, (node) => {
    const listens = ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      UI_EVENTS.has(node.arguments[0].text);

    if (line === 0 && (listens || isHandlerProp(node))) {
      line = lineOf(source, node);
    }
  });

  return line === 0 ? [] : [{ id: `ui-file:${repoPath}`, file: repoPath, line }];
};

const isCallTo = (node: ts.Node, name: string): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;

const stringProp = (literal: ts.ObjectLiteralExpression, key: string): string | null => {
  const property = propertyNamed(literal, key);

  return property !== undefined && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
    ? property.initializer.text
    : null;
};

const modeKeysOf = (call: ts.CallExpression): string[] => {
  const options = call.arguments[0];
  const modes = options !== undefined && ts.isObjectLiteralExpression(options) ? propertyNamed(options, 'modes') : undefined;

  if (modes === undefined || !ts.isPropertyAssignment(modes) || !ts.isArrayLiteralExpression(modes.initializer)) {
    return [];
  }

  return modes.initializer.elements.flatMap((mode) => {
    const key = ts.isObjectLiteralExpression(mode) ? stringProp(mode, 'key') : null;

    return key === null ? [] : [key];
  });
};

/** Mode keys of every createColorPicker call in a file, in source order. */
export const colorPickerModes = (source: ts.SourceFile): string[] => {
  const keys: string[] = [];

  visit(source, (node) => {
    if (isCallTo(node, 'createColorPicker')) {
      keys.push(...modeKeysOf(node));
    }
  });

  return keys;
};

/**
 * Colour pickers inside a tool: the block settings Color menu (buildBlockColorTunes,
 * whose modes are `blockModes`) and a picker the tool builds itself. Neither is an
 * onActivate item, so scanMenus never sees them.
 */
export const colorIds = (source: ts.SourceFile, repoPath: string, blockModes: string[]): Capability[] => {
  const tool = toolOf(repoPath);
  const out: Capability[] = [];

  visit(source, (node) => {
    const keys = isCallTo(node, 'buildBlockColorTunes') ? [...blockModes] : [];

    if (isCallTo(node, 'createColorPicker')) {
      keys.push(...modeKeysOf(node));
    }

    keys.forEach((key) => out.push({ id: `color:${tool}/${key}`, file: repoPath, line: lineOf(source, node) }));
  });

  return out;
};

/** The "/" colour commands: one id per axis (`field`) of getBlockColorToolboxEntries. */
export const slashColorIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'getBlockColorToolboxEntries') {
      return;
    }

    visit(node, (inner) => {
      const field = ts.isObjectLiteralExpression(inner) ? stringProp(inner, 'field') : null;

      if (field !== null) {
        out.push({ id: `color:slash/${field}`, file: repoPath, line: lineOf(source, inner) });
      }
    });
  });

  return out;
};

const BLOCK_COLOR_FILE = 'components/shared/block-color.ts';

export const enumerateColor = (): Capability[] => {
  const blockColor = join(SRC_ROOT, BLOCK_COLOR_FILE);
  const blockModes = colorPickerModes(parseFile(blockColor));
  const toolbox = parseFile(join(SRC_ROOT, 'components/ui/toolbox.ts'));
  let slashShown = false;

  visit(toolbox, (node) => {
    slashShown ||= isCallTo(node, 'getBlockColorToolboxEntries');
  });

  return [
    ...walkTs(join(SRC_ROOT, 'tools')).flatMap((file) => colorIds(parseFile(file), toRepoPath(file), blockModes)),
    ...(slashShown ? slashColorIds(parseFile(blockColor), toRepoPath(blockColor)) : []),
  ];
};

/** Each paste handler: a class that extends BasePasteHandler. */
export const pasteHandlerIds = (source: ts.SourceFile, repoPath: string): Capability[] =>
  source.statements.flatMap((statement) => {
    const extendsBase = ts.isClassDeclaration(statement) && (statement.heritageClauses ?? []).some((clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword &&
      clause.types.some((type) => ts.isIdentifier(type.expression) && type.expression.text === 'BasePasteHandler'));

    return extendsBase && statement.name !== undefined
      ? [{ id: `paste:handler/${statement.name.text}`, file: repoPath, line: lineOf(source, statement) }]
      : [];
  });

/** Each step of the pasted-HTML chain: a value import of preprocess-pasted-html.ts, named by its file. */
export const pastePreprocessorIds = (source: ts.SourceFile, repoPath: string): Capability[] =>
  source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }

    const file = statement.moduleSpecifier.text.split('/').pop() ?? '';

    return [{ id: `paste:html/${file}`, file: repoPath, line: lineOf(source, statement) }];
  });

/** Each paste-as choice for a pasted URL: a member of PasteMenuActionType. */
export const pasteMenuIds = (source: ts.SourceFile, repoPath: string): Capability[] =>
  source.statements.flatMap((statement) => {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== 'PasteMenuActionType' || !ts.isUnionTypeNode(statement.type)) {
      return [];
    }

    return statement.type.types.flatMap((member) => {
      const value = literalTypeText(member);

      return value === null ? [] : [{ id: `paste:menu/${value}`, file: repoPath, line: lineOf(source, member) }];
    });
  });

const PASTE_DIR = 'components/modules/paste';

export const enumeratePaste = (): Capability[] => [
  ...walkTs(join(SRC_ROOT, PASTE_DIR, 'handlers')).flatMap((file) => pasteHandlerIds(parseFile(file), toRepoPath(file))),
  ...fromFile(`${PASTE_DIR}/preprocess-pasted-html.ts`, pastePreprocessorIds),
  ...fromFile('tools/link/paste-menu/options.ts', pasteMenuIds),
  // Pasted CSV text offers to make a database (paste/index.ts calls it with no listener of its own).
  { id: 'paste:csv-database-offer', file: `src/${PASTE_DIR}/csv-database-offer.ts`, line: 0 },
];

/**
 * Tool features with no UI of their own: a listener in a big file (database
 * index.ts) calls them. Keyed id → `<repo path>#<exported name>`; keep in sync
 * by hand, featureAnchorProblems fails when an anchor no longer resolves.
 */
export const HAND_FEATURES: Record<string, string> = {
  'feature:database/button-press': 'src/shared/database/button-actions.ts#runButtonActions',
  'feature:database/csv-export': 'src/tools/database/database-csv.ts#serializeCsv',
  'feature:database/csv-paste': 'src/tools/database/csv-parse.ts#pastedTable',
  'feature:database/csv-import': 'src/tools/database/database-csv.ts#csvDatabaseBlocks',
  'feature:database/csv-merge': 'src/tools/database/database-csv.ts#planCsvMerge',
  'feature:database/ai-setup': 'src/tools/database/database-ai-setup.ts#planAiSetup',
  'feature:database/built-in-comments': 'src/tools/database/database-comments-store.ts#BuiltInComments',
};

const exportedNames = (source: ts.SourceFile): Set<string> => {
  const names = new Set<string>();

  source.statements.forEach((statement) => {
    if (!isExported(statement)) {
      return;
    }

    if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach((d) => ts.isIdentifier(d.name) && names.add(d.name.text));
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) {
      names.add(statement.name.text);
    }
  });

  return names;
};

export const featureAnchorProblems = (anchors: Record<string, string>): string[] =>
  Object.entries(anchors).flatMap(([id, anchor]) => {
    const [file, name] = anchor.split('#');
    const full = join(REPO_ROOT, file);

    if (!existsSync(full)) {
      return [`${id}: ${file} does not exist`];
    }

    return exportedNames(parseFile(full)).has(name) ? [] : [`${id}: ${file} exports no "${name}"`];
  });

export const enumerateFeatures = (): Capability[] =>
  Object.entries(HAND_FEATURES).map(([id, anchor]) => ({ id, file: anchor.split('#')[0], line: 0 }));

export type CapabilitySource =
  | 'insert' | 'format' | 'tune' | 'menu' | 'action' | 'shortcut' | 'key' | 'typing' | 'drag' | 'api' | 'ui-file'
  | 'color' | 'paste' | 'feature';

// walkTs skips .d.ts, so the api source is parsed directly.
const enumerateApi = (): Capability[] => {
  const file = join(REPO_ROOT, 'types/api/blocks.d.ts');

  return apiIds(parseFile(file), toRepoPath(file));
};

export const ENUMERATORS: Record<CapabilitySource, () => Capability[]> = {
  insert: enumerateInsert,
  format: formatIds,
  tune: enumerateTunes,
  menu: () => scanToolMenus().capabilities,
  action: enumerateActionUnions,
  shortcut: enumerateShortcuts,
  key: enumerateKeys,
  typing: enumerateTyping,
  drag: enumerateDrag,
  api: enumerateApi,
  'ui-file': () => walkTs(join(SRC_ROOT, 'tools')).flatMap((file) => uiFileIds(parseFile(file), toRepoPath(file))),
  color: enumerateColor,
  paste: enumeratePaste,
  feature: enumerateFeatures,
};

/**
 * Lower bounds so a broken walk cannot pass empty. Set at ~80% of the count on
 * 2026-10-08; raise them as features land, never lower them to make a scan pass.
 */
export const SCAN_FLOORS: Record<CapabilitySource, number> = {
  insert: 20,
  format: 10,
  tune: 5,
  menu: 60,
  action: 10,
  shortcut: 5,
  key: 8,
  typing: 9,
  drag: 6,
  api: 20,
  'ui-file': 50,
  // Set at ~80% of the count on 2026-10-25.
  color: 12,
  paste: 15,
  feature: 7,
};

export const enumerateAll = (): Map<string, Capability> => {
  const all = new Map<string, Capability>();

  const capabilities = Object.values(ENUMERATORS).flatMap((enumerate) => enumerate());

  for (const capability of capabilities) {
    if (!all.has(capability.id)) {
      all.set(capability.id, capability);
    }
  }

  return all;
};
