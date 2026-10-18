import { describe, it, expect } from 'vitest';
import * as toolsEntry from '../../../src/tools/index';

/**
 * Read-only toggles in place only when EVERY registered block tool has an
 * instance setReadOnly (ReadOnly.prepare). One tool without it makes every
 * toggle save, clear and re-render the whole document, and a collaboration
 * session always boots read-only, so it re-renders on every load.
 * Companion tools count: registering `database` registers them too.
 */
const blockToolClasses = (): Array<[string, { prototype: Record<string, unknown> }]> => {
  const isBlockTool = (value: unknown): value is { prototype: Record<string, unknown> } =>
    typeof value === 'function' && typeof (value as { prototype?: { render?: unknown } }).prototype?.render === 'function'
    && (value as { isInline?: unknown }).isInline !== true;

  const found = new Map<string, { prototype: Record<string, unknown> }>();

  Object.entries(toolsEntry).forEach(([name, value]) => {
    if (isBlockTool(value)) {
      found.set(name, value);
    }
    const companions = (value as { companionTools?: Record<string, unknown> } | undefined)?.companionTools ?? {};

    Object.entries(companions).forEach(([blockType, companion]) => {
      if (isBlockTool(companion)) {
        found.set(`${name}.companionTools.${blockType}`, companion);
      }
    });
  });

  return Array.from(found.entries());
};

describe('every published block tool supports the in-place read-only toggle', () => {
  it('finds the database comment through the database companions', () => {
    expect(blockToolClasses().map(([name]) => name)).toContain('Database.companionTools.database-comment');
  });

  it.each(blockToolClasses())('%s has an instance setReadOnly', (_name, toolClass) => {
    expect(typeof toolClass.prototype.setReadOnly).toBe('function');
  });
});
