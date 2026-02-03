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

  it('paste config handles TABLE, TR, TH, TD tags', () => {
    const config = Table.pasteConfig;

    expect(config.tags).toEqual(expect.arrayContaining(['TABLE', 'TR', 'TH', 'TD']));
  });
});
