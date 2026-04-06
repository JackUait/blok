import { describe, it, expect, beforeEach } from 'vitest';
import { createIdGenerator } from '../../../../../src/cli/commands/convert-html/id-generator';

describe('createIdGenerator', () => {
  let nextId: (prefix: string) => string;

  beforeEach(() => {
    nextId = createIdGenerator();
  });

  it('generates sequential IDs per prefix', () => {
    expect(nextId('paragraph')).toBe('paragraph-1');
    expect(nextId('paragraph')).toBe('paragraph-2');
    expect(nextId('header')).toBe('header-1');
    expect(nextId('paragraph')).toBe('paragraph-3');
  });

  it('resets counters for each new generator', () => {
    nextId('paragraph');
    nextId('paragraph');

    const fresh = createIdGenerator();

    expect(fresh('paragraph')).toBe('paragraph-1');
  });
});
