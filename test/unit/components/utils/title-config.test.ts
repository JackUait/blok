import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeTitleConfig } from '../../../../src/components/utils/title-config';

describe('normalizeTitleConfig', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('is off when absent or false', () => {
    expect(normalizeTitleConfig(undefined)).toBeNull();
    expect(normalizeTitleConfig(false)).toBeNull();
  });

  it('true gives the defaults', () => {
    expect(normalizeTitleConfig(true)).toEqual({ holder: null, placeholder: null, icon: true, onChange: null, onIconChange: null });
  });

  it('keeps given fields', () => {
    const onChange = vi.fn();

    expect(normalizeTitleConfig({ holder: '#t', placeholder: 'Untitled', icon: false, onChange })).toEqual({
      holder: '#t', placeholder: 'Untitled', icon: false, onChange, onIconChange: null,
    });
  });

  it('treats an empty placeholder as the default', () => {
    expect(normalizeTitleConfig({ placeholder: '' })?.placeholder).toBeNull();
  });
});
