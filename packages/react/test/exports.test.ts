import { describe, it, expect } from 'vitest';
import * as ReactApi from '../src/index';
import { USE_BLOK_CONFIG_KEYS } from '../src/config-keys';

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

  it('exports useBlokInstance (the live editor inside a block component)', () => {
    expect(typeof ReactApi.useBlokInstance).toBe('function');
  });

  it('exports useBlocks', () => {
    expect(typeof ReactApi.useBlocks).toBe('function');
  });

  it('exports useBlokReady', () => {
    expect(typeof ReactApi.useBlokReady).toBe('function');
  });

  it('exports useBlokHandle', () => {
    expect(typeof ReactApi.useBlokHandle).toBe('function');
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

  // `BlokEditor` spreads every prop whose key is NOT in this set onto the
  // container <div>. A host that filters props itself (an SSR wrapper, a design
  // system shim, a test double) has to know the same set; hand-copying it lets
  // an unknown key land on the DOM as an attribute instead of routing into the
  // config, which a unit test that never mounts cannot catch.

  it('exports USE_BLOK_CONFIG_KEYS, the config/DOM prop split', () => {
    expect(ReactApi.USE_BLOK_CONFIG_KEYS).toBe(USE_BLOK_CONFIG_KEYS);
    expect(ReactApi.USE_BLOK_CONFIG_KEYS).toContain('tools');
    expect(ReactApi.USE_BLOK_CONFIG_KEYS).toContain('collaboration');
  });
});
