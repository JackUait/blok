import { describe, it, expect, beforeEach } from 'vitest';
import { setHolder, getHolder, removeHolder } from '../../../src/react/holder-map';

describe('holder-map', () => {
  let mockEditor: Record<string, unknown>;
  let mockDiv: HTMLDivElement;

  beforeEach(() => {
    mockEditor = {};
    mockDiv = document.createElement('div');
  });

  it('should store and retrieve a holder for an editor', () => {
    setHolder(mockEditor, mockDiv);
    expect(getHolder(mockEditor)).toBe(mockDiv);
  });

  it('should return undefined for an unknown editor', () => {
    expect(getHolder({})).toBeUndefined();
  });

  it('should remove a holder', () => {
    setHolder(mockEditor, mockDiv);
    removeHolder(mockEditor);
    expect(getHolder(mockEditor)).toBeUndefined();
  });
});
