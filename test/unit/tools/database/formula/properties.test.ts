import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFormula, formatFormulaForDisplay, serializeFormula } from '../../../../../src/tools/database/formula';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';
import { compileError, run, schema, text } from './helpers';

const serialize = (source: string, against: PropertyDefinition[] = schema): string => {
  const compiled = compileFormula(source, against);

  if (!compiled.ok) throw new Error(compiled.error.message);

  return serializeFormula(compiled.formula);
};

describe('formula properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('prop() values (help: Properties)', () => {
    it('reads title and text as text', () => {
      expect(run('prop("Name").length()', { properties: { title: 'Hello' } })).toBe(5);
      expect(run('prop("Notes")', { properties: { notes: 'n' } })).toBe('n');
      expect(run('prop("Notes")')).toBe('');
    });

    it('reads a select as its option label', () => {
      expect(run('prop("Status") == "High"', { properties: { status: 'opt-high' } })).toBe(true);
      expect(run('prop("Status")')).toBe('');
    });

    it('reads a multi-select as a list of labels', () => {
      const properties = { tags: ['opt-fin', 'opt-ops'] };

      expect(run('prop("Tags").length()', { properties })).toBe(2);
      expect(run('prop("Tags").includes("Finance")', { properties })).toBe(true);
      expect(run('prop("Tags")')).toEqual([]);
    });

    it('reads a checkbox as a boolean', () => {
      expect(run('not prop("Done")', { properties: { done: true } })).toBe(false);
      expect(run('prop("Done")')).toBe(false);
    });

    it('reads url and rich text as text', () => {
      expect(run('link("Visit", prop("Site"))', { properties: { site: 'https://a.b' } }))
        .toEqual({ kind: 'richText', runs: [{ text: 'Visit', styles: [], link: 'https://a.b' }] });
      expect(run('prop("Body")', { properties: { body: 'plain' } })).toBe('plain');
      expect(run('prop("Body")', { properties: { body: { blocks: [] } } })).toBe('');
    });

    it('splits a unique id style text', () => {
      const properties = { taskId: 'TASK-42' };

      expect(run('prop("Task ID").split("-").first()', { properties })).toBe('TASK');
      expect(run('prop("Task ID").split("-").last()', { properties })).toBe('42');
    });

    it('reads numbers, including numeric text', () => {
      expect(run('prop("Price") / 2', { properties: { price: 10 } })).toBe(5);
      expect(run('prop("Price") * 2', { properties: { price: '8' } })).toBe(16);
    });

    it('matches the developer docs examples', () => {
      expect(run('if(prop("Done"), "yes", "no")', { properties: { done: true } })).toBe('yes');
      expect(run('format(prop("Task ID"))', { properties: { taskId: 'TASK-1' } })).toBe('TASK-1');
      expect(run('dateBetween(prop("Due"), prop("Start Date"), "days")', { properties: { due: '2026-09-15', start: '2026-09-09' } })).toBe(6);
    });

    it('reads person and relation properties as lists of refs', () => {
      const people = (id: string): { name: string; email: string } | undefined =>
        (id === 'u1' ? { name: 'Grace Hopper', email: 'grace@navy.mil' } : undefined);

      expect(run('prop("Owner").map(current.name()).join(", ")', { properties: { owner: ['u1'] }, people })).toBe('Grace Hopper');
      expect(run('prop("Owner").at(0).email()', { properties: { owner: ['u1'] }, people })).toBe('grace@navy.mil');
      expect(run('prop("Owner").first().name()', { properties: { owner: ['u9'] }, people })).toBeNull();
      expect(run('prop("Tasks").length()', { properties: { tasks: ['p1', 'p2'] } })).toBe(2);
      expect(run('id(prop("Tasks").first())', { properties: { tasks: ['p1'] } })).toBe('p1');
      expect(text('prop("Owner")', { properties: { owner: ['u1'] }, people })).toBe('Grace Hopper');
    });

    it('returns the id of the row the formula is on', () => {
      expect(run('id()')).toBe('row-1');
    });
  });

  describe('empty propagation', () => {
    it('propagates an empty number through arithmetic', () => {
      expect(run('prop("Price") + 1')).toBeNull();
      expect(run('prop("Price") * 2')).toBeNull();
      expect(run('round(prop("Price"))')).toBeNull();
    });

    it('treats empty as empty, false and blank text', () => {
      expect(run('empty(prop("Price"))')).toBe(true);
      expect(run('format(prop("Price"))')).toBe('');
      expect(run('"x" + prop("Price")')).toBe('x');
      expect(run('prop("Price") == empty()')).toBe(true);
    });
  });

  describe('compile errors', () => {
    it('reports an unknown property with its span', () => {
      expect(compileFormula('1 + prop("Nope")', schema)).toEqual({
        ok: false, error: { message: 'Unknown property "Nope"', start: 4, end: 16 },
      });
    });

    it('reports an unknown stored property id', () => {
      expect(compileError('{{property:gone}}')).toBe('Unknown property id "gone"');
    });

    it('rejects a property type formulas cannot read', () => {
      const odd: PropertyDefinition[] = [{ id: 'x', name: 'X', type: 'button' as PropertyDefinition['type'], position: 'a0' }];

      expect(compileFormula('prop("X")', odd)).toMatchObject({ ok: false, error: { message: 'Property "X" cannot be used in a formula' } });
    });

    it('rejects prop() on a related page for now', () => {
      expect(compileError('prop("Tasks").map(current.prop("Status"))')).toBe('prop() on a related page is not supported yet');
    });
  });

  describe('result types', () => {
    it.each([
      ['1 + 1', { kind: 'number' }],
      ['prop("Tags")', { kind: 'list', of: { kind: 'text' } }],
      ['prop("Owner")', { kind: 'list', of: { kind: 'person' } }],
      ['prop("Tasks").first()', { kind: 'page' }],
      ['now()', { kind: 'date' }],
      ['if(true, empty(), 1)', { kind: 'number' }],
      ['empty()', { kind: 'empty' }],
      ['', { kind: 'empty' }],
      ['style("a", "b")', { kind: 'text' }],
    ])('%s has type %j', (source, expected) => {
      const compiled = compileFormula(source, schema);

      expect(compiled.ok && compiled.resultType).toEqual(expected);
    });
  });

  describe('stable stored form', () => {
    it('stores property ids and keeps comments and spacing', () => {
      expect(serialize('prop("Price") * 2 /* tax */')).toBe('{{property:price}} * 2 /* tax */');
    });

    it('survives a rename', () => {
      const stored = serialize('prop("Price") * 2');
      const renamed = schema.map((p) => (p.id === 'price' ? { ...p, name: 'Cost' } : p));

      expect(formatFormulaForDisplay(stored, renamed)).toBe('prop("Cost") * 2');
      expect(compileFormula(stored, renamed)).toMatchObject({ ok: true });
    });

    it('escapes quotes and backslashes in names', () => {
      const odd: PropertyDefinition[] = [{ id: 'q', name: 'Say "hi" \\o/', type: 'number', position: 'a0' }];
      const display = formatFormulaForDisplay('{{property:q}} + 1', odd);

      expect(display).toBe('prop("Say \\"hi\\" \\\\o/") + 1');
      expect(serialize(display, odd)).toBe('{{property:q}} + 1');
    });

    it('leaves an unknown id as it is', () => {
      expect(formatFormulaForDisplay('{{property:gone}} + 1', schema)).toBe('{{property:gone}} + 1');
    });

    it('does not rewrite prop() text inside a string literal', () => {
      expect(serialize('"prop(\\"Price\\")" + prop("Price")')).toBe('"prop(\\"Price\\")" + {{property:price}}');
    });

    it('evaluates the same from source and stored form', () => {
      const stored = serialize('prop("Price") * 2');

      const compiled = compileFormula(stored, schema);

      expect(compiled.ok && serializeFormula(compiled.formula)).toBe(stored);
      expect(run(stored, { properties: { price: 4 } })).toBe(8);
    });
  });
});
