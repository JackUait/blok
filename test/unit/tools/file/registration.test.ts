import { describe, it, expect } from 'vitest';
import { File as FileBlock, defaultBlockTools } from '../../../../src/tools';

describe('File tool registration', () => {
  it('is exported as File from the tools barrel', () => {
    expect(typeof FileBlock).toBe('function');
    expect(FileBlock.toolbox.titleKey).toBe('file');
  });

  it('is listed in defaultBlockTools', () => {
    expect(defaultBlockTools).toHaveProperty('file');
  });
});
