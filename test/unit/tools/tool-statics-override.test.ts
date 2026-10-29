import { describe, expect, it } from 'vitest';

import { Database, Table } from '../../../src/tools';
import { BLOCK_CLASSES } from '../shared/tool-descriptions/built-in-tools';

/**
 * Built-in block tools declare `describe`, `actionHandlers` and `companionTools` as
 * accessors so consumer bundlers can drop unused tool classes. A subclass or a
 * host must still be able to replace each one, in every way it can be written.
 */

type StaticKey = 'describe' | 'actionHandlers' | 'companionTools';

type ToolClass = abstract new (...args: never[]) => unknown;

const CLASSES: Record<string, ToolClass> = BLOCK_CLASSES;

const KEYS: StaticKey[] = ['describe', 'actionHandlers', 'companionTools'];

const CASES = Object.entries(CLASSES).flatMap(([name, toolClass]) =>
  KEYS.filter((key) => key in toolClass).map((key) => [`${name}.${key}`, toolClass, key] as const)
);

const read = (target: ToolClass, key: StaticKey): unknown => Reflect.get(target, key);

/** A subclass built from source text, so the static field uses native define semantics. */
const nativeSubclass = (base: ToolClass, key: StaticKey, value: unknown): ToolClass => {
  // eslint-disable-next-line no-new-func -- source text keeps the field out of the es2017 transform
  const make = new Function('Base', 'value', `return class extends Base { static ${key} = value }`) as (b: ToolClass, v: unknown) => ToolClass;

  return make(base, value);
};

describe('built-in tool statics can be overridden', () => {
  it('covers every built-in that declares one (non-vacuity)', () => {
    expect(CASES.length).toBeGreaterThan(30);
    expect(CASES.map(([label]) => label)).toEqual(expect.arrayContaining([
      'paragraph.describe', 'table.actionHandlers', 'database.companionTools',
    ]));
  });

  it.each(CASES)('%s reads the same value every time', (_label, toolClass, key) => {
    expect(read(toolClass, key)).toBeDefined();
    expect(read(toolClass, key)).toBe(read(toolClass, key));
  });

  it.each(CASES)('%s is inherited by a subclass that does not override it', (_label, toolClass, key) => {
    const Sub = nativeSubclass(toolClass, 'describe' === key ? 'actionHandlers' : 'describe', undefined);

    expect(read(Sub, key)).toBe(read(toolClass, key));
  });

  it.each(CASES)('%s: a native static field in a subclass wins and leaves the base alone', (_label, toolClass, key) => {
    const before = read(toolClass, key);
    const value = { own: key };
    const Sub = nativeSubclass(toolClass, key, value);

    expect(read(Sub, key)).toBe(value);
    expect(Object.hasOwn(Sub, key)).toBe(true);
    expect(read(toolClass, key)).toBe(before);
  });

  it.each(CASES)('%s: an assignment on a subclass wins and leaves the base alone', (_label, toolClass, key) => {
    const before = read(toolClass, key);
    const value = { own: key };
    const Sub = nativeSubclass(toolClass, 'describe' === key ? 'actionHandlers' : 'describe', undefined);

    // The shape TypeScript emits for `static x = value` without define semantics.
    Reflect.set(Sub, key, value);

    expect(read(Sub, key)).toBe(value);
    expect(Object.getOwnPropertyDescriptor(Sub, key)).toEqual({ value, writable: true, enumerable: true, configurable: true });
    expect(read(toolClass, key)).toBe(before);
  });

  it.each(CASES)('%s: Object.assign onto a subclass wins', (_label, toolClass, key) => {
    const value = { own: key };
    const Sub = nativeSubclass(toolClass, 'describe' === key ? 'actionHandlers' : 'describe', undefined);

    Object.assign(Sub, { [key]: value });

    expect(read(Sub, key)).toBe(value);
  });

  it.each(CASES)('%s: a direct assignment on the built-in itself sticks', (_label, toolClass, key) => {
    const original = Object.getOwnPropertyDescriptor(toolClass, key);
    const value = { own: key };

    try {
      Reflect.set(toolClass, key, value);
      expect(read(toolClass, key)).toBe(value);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(toolClass, key, original);
      }
    }
  });

  it('a TypeScript subclass field overrides Table.describe', () => {
    const own: typeof Table.describe = (...args) => Table.describe(...args);

    class MyTable extends Table {
      public static describe = own;
    }

    expect(MyTable.describe).toBe(own);
    expect(Table.describe).not.toBe(own);
  });

  it('a TypeScript subclass field overrides Database.companionTools', () => {
    class MyDatabase extends Database {
      public static companionTools = {};
    }

    expect(MyDatabase.companionTools).toEqual({});
    expect(Object.keys(Database.companionTools)).toEqual(['database-row', 'database-comment']);
  });
});
