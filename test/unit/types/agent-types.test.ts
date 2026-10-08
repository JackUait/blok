import { afterEach, beforeEach, describe, expectTypeOf, it, vi } from 'vitest';
import type {
  AgentBatch,
  AgentErrorCode,
  AgentResult,
  CoreCommandName,
  Edit,
  InsertSpec,
  RichText,
  RichTextHelpers,
  TextRange,
} from '../../../types';

describe('published agent types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names every core command from 06 §3.1', () => {
    expectTypeOf<CoreCommandName>().toEqualTypeOf<
      | 'doc.read' | 'doc.find' | 'doc.setTitle' | 'doc.setIcon'
      | 'block.insert' | 'block.update' | 'block.delete' | 'block.move'
      | 'block.convert' | 'block.duplicate'
      | 'text.insert' | 'text.delete' | 'text.replace' | 'text.format'
      | 'markdown.insert' | 'markdown.export'
      | 'history.undo' | 'history.redo'
    >();
    expectTypeOf<'caret.set'>().not.toMatchTypeOf<CoreCommandName>();
  });

  it('has no removed error codes', () => {
    expectTypeOf<'COMMAND_UNAVAILABLE'>().toMatchTypeOf<AgentErrorCode>();
    expectTypeOf<'DURABILITY_TIMEOUT'>().not.toMatchTypeOf<AgentErrorCode>();
    expectTypeOf<'SERVICE_UNAVAILABLE'>().not.toMatchTypeOf<AgentErrorCode>();
  });

  it('keeps revision optional only on failure', () => {
    expectTypeOf<Extract<AgentResult, { ok: true }>['revision']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentResult, { ok: false }>['revision']>().toEqualTypeOf<string | undefined>();
  });

  it('accepts a text range by offsets, by find, or all', () => {
    expectTypeOf<{ start: 0; end: 2 }>().toMatchTypeOf<TextRange>();
    expectTypeOf<{ find: 'x' }>().toMatchTypeOf<TextRange>();
    expectTypeOf<'all'>().toMatchTypeOf<TextRange>();
  });

  it('exposes the edit union and helpers 02 builds on', () => {
    expectTypeOf<Extract<Edit, { op: 'setPageField' }>['key']>().toEqualTypeOf<'title' | 'icon'>();
    expectTypeOf<InsertSpec['children']>().toEqualTypeOf<InsertSpec[] | undefined>();
    expectTypeOf<RichTextHelpers['plainText']>().parameters.toEqualTypeOf<[RichText]>();
    expectTypeOf<AgentBatch['commands'][number]['ref']>().toEqualTypeOf<string | undefined>();
  });
});
