import { describe, it, expect } from 'vitest';

import { normalizeReadOnlyConfig } from '../../../../src/components/utils/readonly-config';

describe('normalizeReadOnlyConfig', () => {
  it('treats undefined as disabled', () => {
    expect(normalizeReadOnlyConfig(undefined)).toEqual({ enabled: false, hideControls: false });
  });

  it('treats false as disabled', () => {
    expect(normalizeReadOnlyConfig(false)).toEqual({ enabled: false, hideControls: false });
  });

  it('treats true as enabled with controls visible', () => {
    expect(normalizeReadOnlyConfig(true)).toEqual({ enabled: true, hideControls: false });
  });

  it('treats an empty object as enabled with controls visible', () => {
    expect(normalizeReadOnlyConfig({})).toEqual({ enabled: true, hideControls: false });
  });

  it('treats { hideControls: true } as enabled with controls hidden', () => {
    expect(normalizeReadOnlyConfig({ hideControls: true })).toEqual({ enabled: true, hideControls: true });
  });

  it('treats { hideControls: false } as enabled with controls visible', () => {
    expect(normalizeReadOnlyConfig({ hideControls: false })).toEqual({ enabled: true, hideControls: false });
  });
});
