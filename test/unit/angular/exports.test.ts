import { describe, it, expect } from 'vitest';
import * as AngularApi from '../../../src/angular/index';

describe('@jackuait/blok/angular exports', () => {
  it('exports BlokEditorComponent, BlokContentDirective, provideBlok, and BLOK_DEFAULT_CONFIG', () => {
    expect(AngularApi.BlokEditorComponent).toBeDefined();
    expect(AngularApi.BlokContentDirective).toBeDefined();
    expect(typeof AngularApi.provideBlok).toBe('function');
    expect(AngularApi.BLOK_DEFAULT_CONFIG).toBeDefined();
  });

  it('exports the block-authoring surface', () => {
    expect(typeof AngularApi.createAngularBlock).toBe('function');
    expect(typeof AngularApi.injectBlocks).toBe('function');
    expect(AngularApi.BLOK_BLOCK_CONTEXT).toBeDefined();
  });
});
