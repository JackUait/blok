// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { shareRepeatedSchemas } from '../../../src/agent/schema-walk';

const ID = { type: 'string', minLength: 1, description: 'A block id.' };

describe('shareRepeatedSchemas', () => {
  it('moves a repeated schema into defs, named after the property it sits under', () => {
    const root = { type: 'object', properties: { a: { type: 'object', properties: { id: ID } }, b: { type: 'object', properties: { id: ID, n: {} } } } };
    const defs: Record<string, unknown> = {};

    shareRepeatedSchemas(root, defs, 20);

    expect(defs).toEqual({ id: ID });
    expect(root.properties.a.properties.id).toEqual({ $ref: '#/$defs/id' });
    expect(root.properties.b.properties.id).toEqual({ $ref: '#/$defs/id' });
  });

  it('leaves a schema that appears once, or is shorter than the minimum, in place', () => {
    const small = { type: 'integer' };
    const root = { type: 'object', properties: { a: ID, b: small, c: small } };
    const defs: Record<string, unknown> = {};

    shareRepeatedSchemas(root, defs, 20);

    expect(defs).toEqual({});
    expect(root.properties).toEqual({ a: ID, b: small, c: small });
  });

  it('shares the bigger repeat first and keeps an existing def name free', () => {
    const position = { oneOf: [{ type: 'object', properties: { before: ID } }, { type: 'object', properties: { after: ID } }] };
    const root = { type: 'object', properties: { x: { type: 'object', properties: { position } }, y: { type: 'object', properties: { position, n: {} } } } };
    const defs: Record<string, unknown> = { position: { type: 'null' } };

    shareRepeatedSchemas(root, defs, 20);

    expect(defs.position).toEqual({ type: 'null' });
    expect(root.properties.x.properties.position).toEqual({ $ref: '#/$defs/position_2' });
    expect(defs.position_2).toEqual({
      oneOf: [{ type: 'object', properties: { before: { $ref: '#/$defs/before' } } }, { type: 'object', properties: { after: { $ref: '#/$defs/before' } } }],
    });
  });
});
