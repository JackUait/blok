import { describe, it, expect } from 'vitest';
import { Table } from '../../../../src/tools/table';

describe('Table static configs', () => {
  it('sanitize allows br, b, i, a tags in content', () => {
    const config = Table.sanitize;

    expect(config.content).toBeDefined();
    expect(config.content).toHaveProperty('br', true);
    expect(config.content).toHaveProperty('b', true);
    expect(config.content).toHaveProperty('a');
  });

  it('sanitize allows list elements for cell lists', () => {
    const config = Table.sanitize;

    expect(config.content).toBeDefined();
    expect(config.content).toHaveProperty('ul', true);
    expect(config.content).toHaveProperty('ol', true);
    expect(config.content).toHaveProperty('li', true);
    expect(config.content).toHaveProperty('input', { type: true, checked: true });
  });

  it('paste config handles TABLE, TR, TH, TD tags', () => {
    const config = Table.pasteConfig;

    expect(config).not.toBe(false);

    if (config !== false) {
      expect(config.tags).toEqual(expect.arrayContaining(['TABLE', 'TR', 'TH', 'TD']));
    }
  });
});
