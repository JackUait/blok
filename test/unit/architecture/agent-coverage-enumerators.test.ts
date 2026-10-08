import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBlockTools, defaultInlineTools } from '../../../src/tools';
import {
  enumerateInsert,
  enumerateTunes,
  formatIds,
  insertIds,
  tuneIdsFromBlockSettings,
  tuneIdsFromToolsModule,
} from './agent-coverage/enumerators';
import { BLOCK_TOOL_CLASSES } from './agent-coverage/registry';
import {
  REPO_ROOT,
  SRC_ROOT,
  lineOf,
  parseFile,
  parseSource,
  propertyNamed,
  staticNames,
  toRepoPath,
  visit,
  walkTs,
} from './agent-coverage/scan';
import type { Capability } from './agent-coverage/scan';

const ids = (list: Capability[]): string[] => list.map((capability) => capability.id).sort();

const firstExpression = (code: string): ts.Expression => {
  const statement = parseSource(code).statements[0];

  if (statement === undefined || !ts.isExpressionStatement(statement)) {
    throw new Error('fixture must be one expression statement');
  }

  return statement.expression;
};

describe('agent coverage enumerators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('staticNames reads literals, templates and two-branch conditionals', () => {
    expect(staticNames(firstExpression("'image-caption';"))).toEqual(['image-caption']);
    expect(staticNames(firstExpression('`image-alignment-${a.value}`;'))).toEqual(['image-alignment-*']);
    expect(staticNames(firstExpression("type === 'row' ? 'table-duplicate-row' : 'table-duplicate-column';")))
      .toEqual(['table-duplicate-row', 'table-duplicate-column']);
    expect(staticNames(firstExpression('id;'))).toBeNull();
  });

  it('staticNames unwraps parentheses and rejects a conditional with a dynamic branch', () => {
    expect(staticNames(firstExpression('(`caption`);'))).toEqual(['caption']);
    expect(staticNames(firstExpression("flag ? id : 'caption';"))).toBeNull();
    expect(staticNames(firstExpression("flag ? 'caption' : id;"))).toBeNull();
  });

  it('scan helpers find named properties and retain source positions', () => {
    const source = parseSource("\nconst item = { ...rest, name: 'duplicate', get title() { return 'Title'; } };", 'items.ts');
    let item: ts.ObjectLiteralExpression | undefined;

    visit(source, (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        item = node;
      }
    });

    if (item === undefined) {
      throw new Error('fixture must contain an object literal');
    }

    const name = propertyNamed(item, 'name');
    const title = propertyNamed(item, 'title');

    if (name === undefined || !ts.isPropertyAssignment(name) || title === undefined) {
      throw new Error('fixture must contain name and title properties');
    }

    expect(name.initializer.getText(source)).toBe("'duplicate'");
    expect(ts.isGetAccessorDeclaration(title)).toBe(true);
    expect(propertyNamed(item, 'missing')).toBeUndefined();
    expect(lineOf(source, name)).toBe(2);
    expect(source.fileName).toBe('items.ts');
  });

  it('visit traverses the root and nested nodes in source order', () => {
    const source = parseSource('const item = { name: nested };');
    const nodes: ts.Node[] = [];
    const identifiers: string[] = [];

    visit(source, (node) => {
      nodes.push(node);
      if (ts.isIdentifier(node)) {
        identifiers.push(node.text);
      }
    });

    expect(nodes[0]).toBe(source);
    expect(identifiers).toEqual(['item', 'name', 'nested']);
  });

  it('scan roots and file parsing resolve repository source', () => {
    const file = join(SRC_ROOT, 'tools/index.ts');

    expect(SRC_ROOT).toBe(join(REPO_ROOT, 'src'));
    expect(toRepoPath(file)).toBe('src/tools/index.ts');
    expect(parseFile(file).fileName).toBe(file);
    expect(parseFile(file).statements.length).toBeGreaterThan(0);
  });

  it('walkTs excludes declaration files and playground and story directories', () => {
    const files = walkTs(SRC_ROOT).map(toRepoPath);

    expect(files).toContain('src/tools/index.ts');
    expect(files.every((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))).toBe(true);
    expect(files.some((file) => /\/(playground|stories)\//.test(file))).toBe(false);
  });

  it('insert: one id per toolbox entry', () => {
    const registry = {
      solo: { toolbox: { title: 'Solo' } },
      named: { toolbox: { title: 'Named', name: 'named' } },
      alternate: { toolbox: { title: 'Alternate', name: 'variant' } },
      multi: { toolbox: [{ title: 'A', name: 'a' }, { title: 'B', name: 'b' }] },
      hidden: { toolbox: undefined },
      disabled: { toolbox: false },
    };

    expect(ids(insertIds(registry))).toEqual([
      'insert:alternate/variant',
      'insert:multi/a',
      'insert:multi/b',
      'insert:named',
      'insert:solo',
    ]);
    expect(insertIds({ solo: registry.solo })).toEqual([
      { id: 'insert:solo', file: 'src/tools/index.ts', line: 0 },
    ]);
  });

  it('insert: reads class getters and ignores absent or invalid toolboxes', () => {
    class FixtureTool {
      public static get toolbox(): { name: string }[] {
        return [{ name: 'first' }, { name: 'second' }];
      }
    }

    expect(ids(insertIds({
      fixture: FixtureTool,
      absent: {},
      nullTool: null,
      primitiveTool: 'not a tool',
      nullBox: { toolbox: null },
      empty: { toolbox: [] },
    }))).toEqual(['insert:fixture/first', 'insert:fixture/second']);
  });

  it('insert: the registry covers every default block tool plus page', () => {
    expect(Object.keys(BLOCK_TOOL_CLASSES).sort()).toEqual([...Object.keys(defaultBlockTools), 'page'].sort());
  });

  it('insert: enumerates real toolbox entries including the host-registered page', () => {
    const capabilities = enumerateInsert();

    expect(ids(capabilities)).toContain('insert:page');
    expect(ids(capabilities)).toContain('insert:table');
    expect(ids(capabilities)).toContain('insert:column_list/column_list-2');
    expect(capabilities).toEqual(insertIds(BLOCK_TOOL_CLASSES));
  });

  it('format: one id per default inline tool', () => {
    expect(ids(formatIds())).toEqual(Object.keys(defaultInlineTools).map((key) => `format:${key}`).sort());
    expect(ids(formatIds())).toContain('format:bold');
    expect(formatIds()).toHaveLength(10);
  });

  it('tune: reads internal tunes from the tools module', () => {
    const source = parseSource(`
      class Tools {
        private get internalTools() {
          return {
            stub: { class: toToolConstructable(Stub), isInternal: true },
            delete: { class: toToolConstructable(DeleteTune), isInternal: true },
            copyLink: { class: toToolConstructable(CopyLinkTune), isInternal: true },
            convertTo: { class: toToolConstructable(ConvertInlineTool), isInternal: true },
          };
        }
      }
    `);

    expect(tuneIdsFromToolsModule(source, 'src/components/modules/tools.ts')).toEqual([
      { id: 'tune:delete', file: 'src/components/modules/tools.ts', line: 6 },
      { id: 'tune:copyLink', file: 'src/components/modules/tools.ts', line: 7 },
    ]);
  });

  it('tune: ignores unrelated accessors and class expressions that are not tune references', () => {
    const source = parseSource(`
      class Tools {
        get unrelated() { return { outside: { class: OutsideTune } }; }
        get internalTools() {
          return {
            direct: { class: DirectTune },
            'quoted-key': { class: toToolConstructable(QuotedTune) },
            dynamic: { class: factory(tool) },
            callback: { class: () => FakeTune },
            spread: { ...settings },
          };
        }
      }
    `);

    expect(ids(tuneIdsFromToolsModule(source, 'fixture.ts'))).toEqual(['tune:direct', 'tune:quoted-key']);
  });

  it('tune: reads named block settings items', () => {
    const source = parseSource(`
      const items = [{ name: 'duplicate', onActivate: () => {} }, { title: 'no name', onActivate: () => {} }];
    `);

    expect(tuneIdsFromBlockSettings(source, 'src/components/modules/toolbar/blockSettings.ts')).toEqual([
      { id: 'tune:duplicate', file: 'src/components/modules/toolbar/blockSettings.ts', line: 2 },
    ]);
  });

  it('tune: ignores dynamic and shorthand block settings names', () => {
    const source = parseSource(`
      const items = [
        { name },
        { name: dynamicName, onActivate: () => {} },
        { ...settings, title: 'no name' },
        { name: 'footer' },
      ];
    `);

    expect(ids(tuneIdsFromBlockSettings(source, 'fixture.ts'))).toEqual(['tune:footer']);
  });

  it('tune: enumerates the real tools module and block settings source', () => {
    const capabilities = enumerateTunes();

    expect(ids(capabilities)).toContain('tune:copyLink');
    expect(ids(capabilities)).toContain('tune:duplicate');
    expect(capabilities.every((capability) => capability.line > 0)).toBe(true);
    expect([...new Set(capabilities.map((capability) => capability.file))].sort()).toEqual([
      'src/components/modules/toolbar/blockSettings.ts',
      'src/components/modules/tools.ts',
    ]);
  });
});
