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
    expect(normalizeTitleConfig(true)).toEqual({ holder: null, placeholder: null, icon: true, cover: false, onChange: null, onIconChange: null, onCoverChange: null });
  });

  it('keeps given fields', () => {
    const onChange = vi.fn();

    expect(normalizeTitleConfig({ holder: '#t', placeholder: 'Untitled', icon: false, onChange })).toEqual({
      holder: '#t', placeholder: 'Untitled', icon: false, cover: false, onChange, onIconChange: null, onCoverChange: null,
    });
  });

  it('turns the cover on only when asked', () => {
    const onCoverChange = vi.fn();

    expect(normalizeTitleConfig({ cover: true, onCoverChange })).toMatchObject({ cover: true, onCoverChange });
  });

  it('treats an empty placeholder as the default', () => {
    expect(normalizeTitleConfig({ placeholder: '' })?.placeholder).toBeNull();
  });
});
