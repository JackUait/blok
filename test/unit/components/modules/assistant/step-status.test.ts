import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stepStatusKey } from '../../../../../src/components/modules/assistant/step-status';

const execute = (...commands: unknown[]): unknown => ({ commands });
const noBlocks = (): string | undefined => undefined;

describe('stepStatusKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the step for thinking, reading and describing', () => {
    expect(stepStatusKey('thinking', undefined, noBlocks)).toBe('assistant.status.thinking');
    expect(stepStatusKey('blok_read', {}, noBlocks)).toBe('assistant.status.reading');
    expect(stepStatusKey('blok_describe', {}, noBlocks)).toBe('assistant.status.checking');
    expect(stepStatusKey('blok_unknown', {}, noBlocks)).toBe('assistant.status.working');
  });

  it('names the block being inserted', () => {
    const insert = (type: string): unknown => execute({ name: 'block.insert', args: { type, data: {} } });

    expect(stepStatusKey('blok_execute', insert('paragraph'), noBlocks)).toBe('assistant.status.paragraph');
    expect(stepStatusKey('blok_execute', insert('header'), noBlocks)).toBe('assistant.status.heading');
    expect(stepStatusKey('blok_execute', insert('table'), noBlocks)).toBe('assistant.status.table');
    expect(stepStatusKey('blok_execute', insert('column_list'), noBlocks)).toBe('assistant.status.columns');
    expect(stepStatusKey('blok_execute', insert('my-custom-tool'), noBlocks)).toBe('assistant.status.block');
  });

  it('names the target type of a convert', () => {
    expect(stepStatusKey('blok_execute', execute({ name: 'block.convert', args: { id: 'b1', type: 'callout' } }), noBlocks))
      .toBe('assistant.status.callout');
  });

  it('uses the first write command, skipping reads', () => {
    const input = execute(
      { name: 'doc.read', args: {} },
      { name: 'block.insert', args: { type: 'list', data: {} } },
      { name: 'block.insert', args: { type: 'paragraph', data: {} } }
    );

    expect(stepStatusKey('blok_execute', input, noBlocks)).toBe('assistant.status.list');
  });

  it('calls any write to a table structuring its cells', () => {
    const typeOf = (id: string): string | undefined => (id === 't1' ? 'table' : 'paragraph');

    expect(stepStatusKey('blok_execute', execute({ name: 'block.update', args: { id: 't1', data: {} } }), typeOf))
      .toBe('assistant.status.table');
    expect(stepStatusKey('blok_execute', execute({ name: 'table.addRow', args: { id: 't1' } }), typeOf))
      .toBe('assistant.status.table');
    expect(stepStatusKey('blok_execute', execute({ name: 'block.update', args: { id: 'p1', data: {} } }), typeOf))
      .toBe('assistant.status.edit');
  });

  it('names text edits, markdown, removals, moves and the title', () => {
    expect(stepStatusKey('blok_execute', execute({ name: 'text.replace', args: { id: 'p1', with: 'x' } }), noBlocks))
      .toBe('assistant.status.text');
    expect(stepStatusKey('blok_execute', execute({ name: 'markdown.insert', args: { markdown: '# Hi' } }), noBlocks))
      .toBe('assistant.status.markdown');
    expect(stepStatusKey('blok_execute', execute({ name: 'block.delete', args: { id: 'p1' } }), noBlocks))
      .toBe('assistant.status.remove');
    expect(stepStatusKey('blok_execute', execute({ name: 'block.move', args: { id: 'p1', position: 'end' } }), noBlocks))
      .toBe('assistant.status.move');
    expect(stepStatusKey('blok_execute', execute({ name: 'doc.setTitle', args: { title: 'Plan' } }), noBlocks))
      .toBe('assistant.status.title');
  });

  it('falls back to the plain line for input it cannot read', () => {
    expect(stepStatusKey('blok_execute', null, noBlocks)).toBe('assistant.status.editing');
    expect(stepStatusKey('blok_execute', { commands: 'nope' }, noBlocks)).toBe('assistant.status.editing');
    expect(stepStatusKey('blok_execute', execute({ name: 'block.insert' }), noBlocks)).toBe('assistant.status.block');
    expect(stepStatusKey('blok_execute', execute({ name: 'doc.read', args: {} }), noBlocks)).toBe('assistant.status.editing');
  });
});
