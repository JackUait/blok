import { describe, it, expect } from 'vitest';
import * as ReactApi from '../src/index';

// This suite lives in the package's own vitest project (not test/unit/react)
// because the index imports the `@bloklabs/core/view` subpath, which the root
// vitest alias map cannot resolve — see packages/react/vitest.config.ts.

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

  it('exports the inline-tool-authoring surface (createReactInlineTool)', () => {
    expect(typeof ReactApi.createReactInlineTool).toBe('function');
  });

  it('exports the synchronous view surface (BlokView + useBlokView)', () => {
    expect(typeof ReactApi.BlokView).toBe('function');
    expect(typeof ReactApi.useBlokView).toBe('function');
  });

  it('exports the block-authoring surface (createReactBlock + portal host)', () => {
    expect(typeof ReactApi.createReactBlock).toBe('function');
    expect(typeof ReactApi.createBlockPortalRegistry).toBe('function');
    expect(typeof ReactApi.BlockPortalHost).toBe('function');
    expect(ReactApi.BLOK_PORTAL_REGISTRY_CONFIG_KEY).toBe('__blokPortalRegistry');
  });
});
