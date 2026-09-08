import { describe, it, expect, afterEach } from 'vitest';

import { defineBlokSchema } from '../../../src/shared/sanitize-schema';

type ToolMap = Record<string, unknown>;

const schemaFor = (tools: ToolMap, extra: Record<string, unknown> = {}): ReturnType<typeof defineBlokSchema> =>
  defineBlokSchema({ tools, ...extra } as Parameters<typeof defineBlokSchema>[0]);

const toolNames = (tools: ToolMap, extra: Record<string, unknown> = {}): string[] =>
  Object.keys(schemaFor(tools, extra).viewSchema.tools);

const sanitizeKeys = (tools: ToolMap, extra: Record<string, unknown> = {}): string[] =>
  Object.keys(schemaFor(tools, extra).viewSchema.baseSanitize).sort();

class Paragraph {
  public static sanitize = { br: true };
}

class Bold {
  public static isInline = true;
  public static sanitize = { b: true };
  public render(): HTMLElement {
    return document.createElement('span');
  }
}

class Italic {
  public static isInline = true;
  public static sanitize = { i: true };
}

class Highlight {
  public static isTune = true;
  public static sanitize = { mark: true };
  public render(): HTMLElement {
    return document.createElement('span');
  }
}

class Child {
  public static sanitize = { code: true };
}

class Group {
  public static provides = { child: Child };
}

/**
 * Fifteen survivors are equivalent, and one measurement explains most of them:
 * with no user tools the composed base config is `{}` and the resolved tool map
 * is empty, so every bundled tool is internal and every internal tune's own
 * sanitize config is empty. Adding a name to `internalTuneNames`, or dropping
 * the whole list, therefore merges `{}` either way — which covers all five
 * mutants on the internal-tune guard.
 *
 * The rest are the same shape one level down: every phantom or unfiltered name
 * that a mutated fallback lets through is looked up in a Map that does not have
 * it, and `?? {}` merges nothing. That covers both `inlineToolbar` fallbacks,
 * both `tunes` fallbacks, the two dropped `.filter` calls, and the blanked
 * 'convertTo' seed.
 *
 * Two more are inert by construction: with no group settings to spread,
 * `{ class: providedClass }` and the bare class normalise to the same entry.
 */
describe('defineBlokSchema mutants', () => {
  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, 'pollutedTool');
  });

  describe('tool groups', () => {
    it('registers what a group provides, not the group handle', () => {
      expect(toolNames({ grp: Group })).toContain('child');
      expect(toolNames({ grp: Group })).not.toContain('grp');
    });

    it('carries the group entry settings onto every provided tool, minus class and isInternal', () => {
      const schema = schemaFor({ grp: { class: Group, foo: 'bar', isInternal: true } });

      expect(Object.keys(schema.viewSchema.tools)).toContain('child');
      expect(schema.viewSchema.tools.child.settings).toStrictEqual({ foo: 'bar' });
      expect(schema.viewSchema.tools.child.toolClass).toBe(Child);
    });

    it('registers the provided class directly when the group carries no settings', () => {
      expect(schemaFor({ grp: Group }).viewSchema.tools.child.settings).toStrictEqual({});
    });

    it('lets an explicit tool of the same name win over a group that provides it', () => {
      expect(schemaFor({ child: Paragraph, grp: Group }).viewSchema.tools.child.toolClass).toBe(Paragraph);
    });

    it('leaves an entry that names no class alone instead of dereferencing it', () => {
      expect(() => schemaFor({ broken: { foo: 1 } })).not.toThrow();
    });

    // The merged map is a plain object, so an enumerable key on Object.prototype
    // is walked by `for…in` but is not an own property — the only way to reach
    // either hasOwnProperty guard.
    it('ignores a tool name inherited from the object prototype', () => {
      Object.defineProperty(Object.prototype, 'pollutedTool', {
        value: Paragraph,
        enumerable: true,
        configurable: true,
        writable: true,
      });

      expect(toolNames({ para: Paragraph })).toStrictEqual(['para']);
    });
  });

  describe('which tools reach the view schema', () => {
    it('keeps a block tool and drops the internal ones', () => {
      const names = toolNames({ para: Paragraph });

      expect(names).toContain('para');
      expect(names).not.toContain('stub');
    });

    it('skips an entry whose class is not callable', () => {
      expect(toolNames({ para: Paragraph, broken: { class: 'not a class' } })).not.toContain('broken');
    });
  });

  describe('the composed base sanitize config', () => {
    it('takes the rules of an enabled inline tool', () => {
      expect(sanitizeKeys({ bold: Bold })).toContain('b');
    });

    it('ignores an inline tool that cannot render', () => {
      expect(sanitizeKeys({ italic: Italic })).not.toContain('i');
    });

    it('tolerates an inline tool with no prototype at all', () => {
      const arrowTool = Object.assign(() => undefined, { isInline: true, sanitize: { u: true } });

      expect(() => sanitizeKeys({ arrow: arrowTool })).not.toThrow();
    });

    it('ignores the rules of a block tool', () => {
      expect(sanitizeKeys({ para: Paragraph })).not.toContain('br');
    });

    it('takes nothing from any inline tool when the toolbar is off', () => {
      expect(sanitizeKeys({ bold: Bold }, { inlineToolbar: false })).not.toContain('b');
    });

    // A tune has to be BOTH not-inline and marked as a tune. With the inline
    // toolbar off, an inline tool contributes nothing on its own path, so the
    // only way `b` could appear is the tune path claiming it.
    it('never treats an inline tool as a tune', () => {
      expect(sanitizeKeys({ bold: Bold }, { inlineToolbar: false, tunes: ['bold'] })).not.toContain('b');
    });

    it('never treats a plain block tool as a tune', () => {
      expect(sanitizeKeys({ para: Paragraph }, { tunes: ['para'] })).not.toContain('br');
    });

    it('takes the rules of an enabled tune and not of a disabled one', () => {
      expect(sanitizeKeys({ hl: Highlight }, { tunes: ['hl'] })).toContain('mark');
      expect(sanitizeKeys({ hl: Highlight })).not.toContain('mark');
    });
  });
});
