import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';

const normalize = (tool: string, data: Record<string, unknown>): Record<string, unknown> => {
  const run = BUILT_IN_TOOL_RUNTIMES.get(tool)?.normalize;

  if (run === undefined) {
    throw new Error(`${tool} has no normalize`);
  }

  return run(data);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('load defaults the editor saves', () => {
  it('fills code lineNumbers true, and keeps a given value', () => {
    expect(normalize('code', { code: '', language: 'plain text' })).toEqual({ code: '', language: 'plain text', lineNumbers: true });
    expect(normalize('code', { code: '', language: 'plain text', lineNumbers: false }).lineNumbers).toBe(false);
  });

  it('fills quote size "default", and keeps a given value', () => {
    expect(normalize('quote', { text: [] })).toEqual({ text: [], size: 'default' });
    expect(normalize('quote', { text: [], size: 'large' }).size).toBe('large');
  });

  it('fills callout colours with null, and keeps given ones', () => {
    expect(normalize('callout', { emoji: 'x' })).toEqual({ emoji: 'x', textColor: null, backgroundColor: null });
    expect(normalize('callout', { emoji: 'x', textColor: 'red' })).toEqual({ emoji: 'x', textColor: 'red', backgroundColor: null });
  });

  it('gives a checklist item checked false, and drops checked from other styles', () => {
    expect(normalize('list', { text: [], style: 'checklist' })).toEqual({ text: [], style: 'checklist', checked: false });
    expect(normalize('list', { text: [], style: 'checklist', checked: true }).checked).toBe(true);
    expect(normalize('list', { text: [], style: 'unordered', checked: true })).toEqual({ text: [], style: 'unordered' });
  });

  it('drops an ordered list start of 1, which the editor never saves', () => {
    expect(normalize('list', { text: [], style: 'ordered', start: 1 })).toEqual({ text: [], style: 'ordered' });
    expect(normalize('list', { text: [], style: 'ordered', start: 3 }).start).toBe(3);
  });

  it('gives each database its own empty automations slot', () => {
    const first = normalize('database', { schema: [], views: [] });
    const second = normalize('database', { schema: [], views: [] });

    expect(first.automations).toEqual({ version: 1, definitions: [] });
    expect(first.automations).not.toBe(second.automations);
    expect(normalize('database', { automations: { version: 1, definitions: [{ id: 'a' }] } }).automations)
      .toEqual({ version: 1, definitions: [{ id: 'a' }] });
  });
});
