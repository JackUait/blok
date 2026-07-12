import { describe, it, expect } from 'vitest';
import { generateMethodId, generatePropertyId, generateOptionId } from './api-anchors';

describe('api-anchors', () => {
  it('generateMethodId strips params and dots', () => {
    expect(generateMethodId('blocks-api', 'blocks.clear()')).toBe('blocks-api-blocks-clear');
    expect(generateMethodId('caret-api', 'focus(atEnd?)')).toBe('caret-api-focus');
    expect(generateMethodId('blocks-api', 'blocks.move(toIndex, fromIndex?)')).toBe('blocks-api-blocks-move');
  });

  it('generatePropertyId lowercases and dashes', () => {
    expect(generatePropertyId('core', 'isReady')).toBe('core-prop-isready');
  });

  it('generateOptionId lowercases', () => {
    expect(generateOptionId('config', 'holder')).toBe('config-holder');
  });
});
