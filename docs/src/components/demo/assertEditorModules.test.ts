import { describe, it, expect } from 'vitest';
import { assertEditorModulesComplete } from './assertEditorModules';

const validReact = { BlokEditor: class {} };
const validTools = { Header: class {}, Paragraph: class {}, List: class {} };

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
      assertEditorModulesComplete(validReact, { Header: class {}, Paragraph: undefined, List: class {} }),
    ).toThrow(/Paragraph/);
  });

  it('lists every missing export, not just the first one', () => {
    expect(() =>
      assertEditorModulesComplete({ BlokEditor: undefined }, { Header: undefined, Paragraph: undefined, List: undefined }),
    ).toThrow(/BlokEditor.*Header.*Paragraph.*List/);
  });

  it('mentions the dist build as the likely cause, so the fix is discoverable', () => {
    expect(() => assertEditorModulesComplete({ BlokEditor: undefined }, validTools)).toThrow(/dist/i);
  });
});
