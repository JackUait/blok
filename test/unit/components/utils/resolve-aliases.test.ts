import { describe, expect, it } from 'vitest';

import { resolveAliases } from '../../../../src/components/utils/resolve-aliases';

type MenuItem = {
  title?: string;
  label?: string;
  tooltip?: string;
  caption?: string;
  description?: string;
};

describe('resolveAliases', () => {
  it('maps alias value to the target property and omits the alias key', () => {
    const item: MenuItem = { label: 'Alias title' };

    const resolved = resolveAliases(item, { label: 'title' });

    expect(resolved).not.toBe(item);
    expect(resolved.title).toBe('Alias title');
    expect(resolved.label).toBeUndefined();
    expect(item).toEqual({ label: 'Alias title' });
  });

  it('does not override explicitly set target property', () => {
    const item: MenuItem = {
      title: 'Preferred',
      label: 'Fallback',
    };

    const resolved = resolveAliases(item, { label: 'title' });

    expect(resolved.title).toBe('Preferred');
    expect(resolved.label).toBeUndefined();
  });

  it('resolves multiple aliases while keeping other properties intact', () => {
    const item: MenuItem = {
      label: 'Title alias',
      caption: 'Tooltip alias',
      description: 'Keep me',
    };

    const resolved = resolveAliases(item, {
      label: 'title',
      caption: 'tooltip',
    });

    expect(resolved).toEqual({
      title: 'Title alias',
      tooltip: 'Tooltip alias',
      description: 'Keep me',
    });
  });

  it('ignores alias entries that are absent on the object', () => {
    const item: MenuItem = { description: 'Only field' };

    const resolved = resolveAliases(item, { label: 'title' });

    expect(resolved).toEqual({ description: 'Only field' });
  });
});
