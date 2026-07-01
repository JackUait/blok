import { describe, it, expect } from 'vitest';
import { FRAMEWORK_IDS } from '../../contexts/FrameworkContext';
import {
  QUICK_START_SNIPPETS,
  CONFIG_SNIPPETS,
  EDITOR_ACCESS_SNIPPETS,
} from './framework-snippets';

describe('framework-snippets', () => {
  it('provides a quick-start snippet set for every framework', () => {
    for (const id of FRAMEWORK_IDS) {
      expect(QUICK_START_SNIPPETS[id]).toBeDefined();
      expect(QUICK_START_SNIPPETS[id].create.code).toContain('@jackuait/blok');
      expect(QUICK_START_SNIPPETS[id].save.code).toContain('save');
      expect(QUICK_START_SNIPPETS[id].create.language).toBeTruthy();
    }
  });

  it('provides a config snippet for every framework', () => {
    for (const id of FRAMEWORK_IDS) {
      expect(CONFIG_SNIPPETS[id].code).toBeTruthy();
      expect(CONFIG_SNIPPETS[id].language).toBeTruthy();
    }
  });

  it('provides an editor-access snippet for every framework', () => {
    for (const id of FRAMEWORK_IDS) {
      expect(EDITOR_ACCESS_SNIPPETS[id].code).toContain('editor');
      expect(EDITOR_ACCESS_SNIPPETS[id].language).toBeTruthy();
    }
  });

  it('reaches the editor the way each adapter actually exposes it', () => {
    // Vanilla holds the constructed instance directly.
    expect(EDITOR_ACCESS_SNIPPETS.vanilla.code).toContain('new Blok(');
    // React returns Blok | null, so the example guards with optional chaining.
    expect(EDITOR_ACCESS_SNIPPETS.react.code).toContain('useBlok(');
    expect(EDITOR_ACCESS_SNIPPETS.react.code).toContain('editor?.');
    // Vue returns a ref, unwrapped with .value.
    expect(EDITOR_ACCESS_SNIPPETS.vue.code).toContain('editor.value');
    // Angular hands the instance over through its (ready) output.
    expect(EDITOR_ACCESS_SNIPPETS.angular.code).toContain('ready');
  });

  it('imports the matching adapter entry point per framework', () => {
    expect(QUICK_START_SNIPPETS.react.create.code).toContain('@jackuait/blok/react');
    expect(QUICK_START_SNIPPETS.vue.create.code).toContain('@jackuait/blok/vue');
    expect(QUICK_START_SNIPPETS.angular.create.code).toContain('@jackuait/blok/angular');
    // Vanilla uses the core package, not a framework adapter sub-path.
    expect(QUICK_START_SNIPPETS.vanilla.create.code).not.toContain('/react');
    expect(QUICK_START_SNIPPETS.vanilla.create.code).toContain('new Blok(');
  });
});
