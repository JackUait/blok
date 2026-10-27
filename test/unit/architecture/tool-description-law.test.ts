import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../src/shared/agent/commands';

import { unknownKeywords } from '../../../src/shared/schema/validate';
import { BUILT_IN_RUNTIME_PARTS } from '../../../src/shared/tool-actions';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../src/shared/tool-descriptions';
import { BUILT_IN_INLINE_DESCRIPTIONS, BUILT_IN_TUNE_DESCRIPTIONS } from '../../../src/shared/tool-descriptions/inline';
import { richText } from '../../../src/shared/tool-descriptions/rich-text';
import { defaultBlockTools, defaultInlineTools } from '../../../src/tools';
import { BLOCK_CLASSES } from '../shared/tool-descriptions/built-in-tools';

const ROOT = resolve(__dirname, '../../..');
const BUILT_IN_BLOCKS = [...Object.keys(defaultBlockTools), 'page', 'page-link'];
const RESERVED_ARGS = ['id', 'parentId', 'position'];
const CORE_COMMANDS: string[] = Object.keys(COMMANDS);
/** runtime: 'editor' actions, each with a reason. None among built-ins (06 R3-2). */
const EDITOR_ONLY_ACTIONS: Record<string, string> = {
  'database.pressButton': 'Runs the host\'s buttons.onAction and onNotify after the writes land, which only the editor\'s database tool runs.',
  'database.submitForm': 'Calls the host\'s forms.onSubmit after the row lands, which only the editor\'s database tool runs.',
};

const CLASSES = new Map<string, unknown>(Object.entries(BLOCK_CLASSES));
const descriptions = BUILT_IN_BLOCKS.map(name => [name, BUILT_IN_BLOCK_DESCRIPTIONS[name]?.({})] as const);
const actions = descriptions.flatMap(([name, description]) => (description?.actions ?? []).map(action => ({ tool: name, action })));

// A planned folder (src/shared/database) may not exist yet; nothing to scan there.
const walk = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return walk(join(dir, entry.name));
    }

    return /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [];
  });
};

describe('tool description law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scans real registries (non-vacuity)', () => {
    expect(BUILT_IN_BLOCKS.length).toBeGreaterThanOrEqual(25);
    expect(actions.length).toBeGreaterThanOrEqual(50);
  });

  it('every built-in block tool, inline tool and tune is described', () => {
    descriptions.forEach(([name, description]) => expect(description, name).toBeDefined());
    Object.keys(defaultInlineTools).forEach(name => expect(BUILT_IN_INLINE_DESCRIPTIONS[name], name).toBeDefined());
    ['delete', 'copyLink'].forEach(name => expect(BUILT_IN_TUNE_DESCRIPTIONS[name], name).toBeDefined());
  });

  it('rich-text fields have the rich-text shape, and no other field does', () => {
    const shape = (value: unknown): string => JSON.stringify({ ...(value as Record<string, unknown>), description: undefined });
    const rich = shape(richText('x'));

    descriptions.forEach(([name, description]) => {
      const declared = new Set((CLASSES.get(name) as { richTextFields?: string[] }).richTextFields ?? []);
      const properties = (description?.data as { properties?: Record<string, unknown> }).properties ?? {};

      Object.entries(properties).forEach(([field, schema]) => expect(shape(schema) === rich, `${name}.${field}`).toBe(declared.has(field)));
    });
  });

  it('every schema uses only profile keywords', () => {
    descriptions.forEach(([name, description]) => expect(unknownKeywords(description?.data), name).toEqual([]));
    actions.forEach(({ tool, action }) => {
      expect(unknownKeywords(action.args), `${tool}.${action.name} args`).toEqual([]);
      expect(unknownKeywords(action.result ?? {}), `${tool}.${action.name} result`).toEqual([]);
    });
  });

  it('descriptions survive a JSON round trip', () => {
    descriptions.forEach(([name, description]) => expect(JSON.parse(JSON.stringify(description)), name).toEqual(description));
  });

  it('declarations and handlers match one to one, and the class carries the handlers', () => {
    descriptions.forEach(([name, description]) => {
      const declared = (description?.actions ?? []).map(action => action.name).sort();
      const handled = Object.keys(BUILT_IN_RUNTIME_PARTS[name]?.actions ?? {}).sort();

      expect(handled, name).toEqual(declared);
      expect(Object.keys((CLASSES.get(name) as { actionHandlers?: Record<string, unknown> }).actionHandlers ?? {}).sort(), name).toEqual(declared);
    });
  });

  it('action args never declare id, parentId or position', () => {
    actions.forEach(({ tool, action }) => {
      const properties = Object.keys((action.args as { properties?: Record<string, unknown> }).properties ?? {});

      expect(properties.filter(key => RESERVED_ARGS.includes(key)), `${tool}.${action.name}`).toEqual([]);
    });
  });

  it('names are camelCase and unique per tool', () => {
    descriptions.forEach(([name, description]) => {
      const names = (description?.actions ?? []).map(action => action.name);

      names.forEach(action => expect(action, `${name}.${action}`).toMatch(/^[a-z][a-zA-Z0-9]*$/));
      expect(new Set(names).size, name).toBe(names.length);
    });
  });

  it('runtime editor actions are listed with a reason; host-effect actions have prepare', () => {
    actions.forEach(({ tool, action }) => {
      const command = `${tool}.${action.name}`;

      expect(action.runtime === 'editor', command).toBe(command in EDITOR_ONLY_ACTIONS);
      if (action.effects === 'host') {
        expect(typeof BUILT_IN_RUNTIME_PARTS[tool]?.actions?.[action.name]?.prepare, command).toBe('function');
      }
    });
  });

  it('every handler run is synchronous', () => {
    Object.entries(BUILT_IN_RUNTIME_PARTS).forEach(([tool, parts]) => Object.entries(parts.actions ?? {}).forEach(([name, impl]) => {
      expect(impl.run.constructor.name, `${tool}.${name}`).not.toBe('AsyncFunction');
    }));
  });

  // A child block's field can be kept by its parent's action (database-row.properties → database.setRowValues).
  it('guardedFields name a core command, a <tool>.* family, a <tool>.*Suffix family or one tool action', () => {
    const actions = new Set(descriptions.flatMap(([tool, each]) => (each?.actions ?? []).map(action => `${tool}.${action.name}`)));

    descriptions.forEach(([name, description]) => Object.entries(description?.guardedFields ?? {}).forEach(([field, use]) => {
      const family = /^([a-z_-]+)\.\*(\w*)$/.exec(use);
      const ok = CORE_COMMANDS.includes(use) || actions.has(use)
        || (family !== null && family[1] === name && (description?.actions ?? []).some(action => action.name.endsWith(family[2])));

      expect(ok, `${name}.${field} → ${use}`).toBe(true);
    }));
  });

  it('every action is named as "<tool>.<action>" in some test file', () => {
    const tests = walk(join(ROOT, 'test', 'unit')).map(file => readFileSync(file, 'utf8')).join('\n');

    actions.forEach(({ tool, action }) => expect(tests.includes(`${tool}.${action.name}`), `${tool}.${action.name}`).toBe(true));
  });

  it('pure description and action modules import nothing from src/components or src/tools', () => {
    const pure = [
      ...walk(join(ROOT, 'src', 'shared', 'tool-descriptions')),
      ...walk(join(ROOT, 'src', 'shared', 'tool-actions')),
      ...walk(join(ROOT, 'src', 'shared', 'schema')),
      join(ROOT, 'src', 'shared', 'tool-manifest.ts'),
      join(ROOT, 'src', 'shared', 'built-in-snapshot.ts'),
      join(ROOT, 'src', 'shared', 'custom-tools-file.ts'),
    ];
    const forbidden = [join(ROOT, 'src', 'components') + sep, join(ROOT, 'src', 'tools') + sep];
    const offenders = pure.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)]
      .map(match => resolve(dirname(file), match[1]))
      .filter(target => forbidden.some(dir => `${target}${sep}`.startsWith(dir) || target.startsWith(dir)))
      .map(target => `${relative(ROOT, file)} → ${relative(ROOT, target)}`));

    expect(pure.length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  // The Jint realm has only ECMAScript globals (test/unit/scripts/build-server-runtime.test.ts). A host global fails there at call time.
  it('code the Jint bundle runs uses no host-only global', () => {
    const jintCode = [
      ...walk(join(ROOT, 'src', 'shared', 'tool-actions')),
      ...walk(join(ROOT, 'src', 'shared', 'table')),
      ...walk(join(ROOT, 'src', 'shared', 'database')),
      ...walk(join(ROOT, 'src', 'shared', 'image')),
      join(ROOT, 'src', 'shared', 'embed-registry.ts'),
      join(ROOT, 'src', 'shared', 'tool-manifest.ts'),
      join(ROOT, 'src', 'shared', 'built-in-snapshot.ts'),
      join(ROOT, 'src', 'shared', 'custom-tools-file.ts'),
    ];
    // Usages, not words: "document" is a provider type in the embed registry, and comments are stripped first.
    const USAGE = /\b(structuredClone\s*\(|new\s+TextDecoder|new\s+TextEncoder|Buffer\.|atob\s*\(|btoa\s*\(|document\.|window\.)/g;
    const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const offenders = jintCode.flatMap(file => [...code(file).matchAll(USAGE)].map(match => `${relative(ROOT, file)}: ${match[1]}`));

    expect(jintCode.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
