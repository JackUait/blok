import { describe, it, expect } from 'vitest';
import { defineTool } from '../../../src/tools/define-tool';

/**
 * `defineTool` is primarily a type-level helper (its config-typo guard is
 * covered by test/unit/types/define-tool-typecheck.ts). At runtime it must be a
 * faithful, non-lossy merge: attach the class and preserve every setting so the
 * result drops straight into the editor's `tools` map.
 */
describe('defineTool', () => {
  class StubTool {
    public constructor(_options: { config?: { placeholder?: string } }) {}
    public render(): HTMLElement {
      return document.createElement('div');
    }
  }

  it('attaches the tool class to the returned settings', () => {
    const settings = defineTool(StubTool);

    expect(settings.class).toBe(StubTool);
  });

  it('preserves the config and other settings verbatim', () => {
    const settings = defineTool(StubTool, {
      config: { placeholder: 'Type…' },
      inlineToolbar: false,
      shortcut: 'CMD+SHIFT+S',
    });

    expect(settings).toEqual({
      class: StubTool,
      config: { placeholder: 'Type…' },
      inlineToolbar: false,
      shortcut: 'CMD+SHIFT+S',
    });
  });

  it('does not mutate the passed settings object', () => {
    const original = { config: { placeholder: 'x' } };
    const settings = defineTool(StubTool, original);

    expect(original).not.toHaveProperty('class');
    expect(settings).not.toBe(original);
  });
});
