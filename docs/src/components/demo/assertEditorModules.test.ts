import { describe, it, expect } from 'vitest';
import { assertEditorModulesComplete, REQUIRED_TOOL_EXPORTS } from './assertEditorModules';

const validReact = { BlokEditor: class {} };
const validTools = Object.fromEntries(
  REQUIRED_TOOL_EXPORTS.map((name) => [name, class {}]),
);

describe('assertEditorModulesComplete', () => {
  it('does not throw when every expected export is present', () => {
    expect(() => assertEditorModulesComplete(validReact, validTools)).not.toThrow();
  });

  it('throws when BlokEditor is missing from the react module', () => {
    expect(() => assertEditorModulesComplete({ BlokEditor: undefined }, validTools)).toThrow(
      /BlokEditor/,
    );
  });

  it('throws when a tool export is missing', () => {
    expect(() =>
      assertEditorModulesComplete(validReact, { ...validTools, Paragraph: undefined }),
    ).toThrow(/Paragraph/);
  });

  it('requires every tool the editor ships, not just the text basics', () => {
    // The demo must expose ALL editor features; a bundle lacking e.g. Table or
    // Image must be reported as stale rather than silently rendering a
    // reduced-feature demo.
    for (const tool of ['Table', 'Image', 'Video', 'Audio', 'Database', 'ColumnList', 'Embed', 'Bookmark', 'Marker', 'Equation']) {
      expect(REQUIRED_TOOL_EXPORTS).toContain(tool);
      expect(() =>
        assertEditorModulesComplete(validReact, { ...validTools, [tool]: undefined }),
      ).toThrow(new RegExp(tool));
    }
  });

  it('lists every missing export, not just the first one', () => {
    expect(() =>
      assertEditorModulesComplete(
        { BlokEditor: undefined },
        { ...validTools, Header: undefined, Paragraph: undefined, List: undefined },
      ),
    ).toThrow(/BlokEditor.*Paragraph.*Header.*List/);
  });

  it('mentions the dist build as the likely cause, so the fix is discoverable', () => {
    expect(() => assertEditorModulesComplete({ BlokEditor: undefined }, validTools)).toThrow(/dist/i);
  });
});
