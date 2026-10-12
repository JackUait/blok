// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { BUILT_IN_BLOCK_STATICS } from '../../../../src/shared/tool-descriptions/built-in-statics';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless text conversion for tools whose editor conversion is a function', () => {
  it('list converts through its text field headlessly, while its published statics stay function-only', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('list')?.conversion).toEqual({ export: 'text', import: 'text' });
    expect(BUILT_IN_BLOCK_STATICS.list?.statics.conversion).toEqual({});
  });

  it('tools with string conversion need no runtime copy', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('paragraph')).not.toHaveProperty('conversion');
  });
});
