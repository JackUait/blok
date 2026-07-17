import { describe, it, expect } from 'vitest';
import * as ReactApi from '../../../packages/react/src/index';

describe('@bloklabs/react exports', () => {
  it('exports useBlok, BlokContent, and BlokEditor', () => {
    expect(typeof ReactApi.useBlok).toBe('function');
    expect(ReactApi.BlokContent).toBeDefined();
    expect(ReactApi.BlokEditor).toBeDefined();
  });

  it('exports the provideBlok surface (BlokProvider + useBlokDefaults)', () => {
    expect(typeof ReactApi.BlokProvider).toBe('function');
    expect(typeof ReactApi.useBlokDefaults).toBe('function');
  });

  it('exports useBlocks', () => {
    expect(typeof ReactApi.useBlocks).toBe('function');
  });

  it('exports the block-authoring surface (createReactBlock + portal host)', () => {
    expect(typeof ReactApi.createReactBlock).toBe('function');
    expect(typeof ReactApi.createBlockPortalRegistry).toBe('function');
    expect(typeof ReactApi.BlockPortalHost).toBe('function');
    expect(ReactApi.BLOK_PORTAL_REGISTRY_CONFIG_KEY).toBe('__blokPortalRegistry');
  });
});
