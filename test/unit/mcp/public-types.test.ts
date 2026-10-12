// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Public from '../../../packages/mcp/types/index';
import type { BlokMcpOptions as InternalOptions } from '../../../src/mcp/options';
import type { AgentActor } from '../../../types/agent';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

/*
 * Compile-time drift guard: `yarn lint:types` fails on an assignment below
 * when a copy in packages/mcp/types drifts from its source.
 */
const actorToPublic = (value: AgentActor): Public.AgentActor => value;
const actorFromPublic = (value: Public.AgentActor): AgentActor => value;
const overridesToPublic = (value: ManifestOverrides): Public.ManifestOverrides => value;
const overridesFromPublic = (value: Public.ManifestOverrides): ManifestOverrides => value;
// One way only: the copy loosens description and statics, so core values must fit it.
const customToolsToPublic = (value: BlokCustomToolsFile): Public.BlokCustomToolsFile => value;
const optionsToPublic = (value: InternalOptions): Public.BlokMcpOptions => value;
const optionsFromPublic = (value: Public.BlokMcpOptions): Omit<InternalOptions, 'manifest'> => value;

// Assignability misses a dropped optional field, so the key sets must match too.
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
type CustomBlock = BlokCustomToolsFile['blocks'][number];
type PublicCustomBlock = Public.BlokCustomToolsFile['blocks'][number];

const sameKeys: [
  SameKeys<AgentActor, Public.AgentActor>,
  SameKeys<ManifestOverrides[string], Public.ManifestOverrides[string]>,
  SameKeys<BlokCustomToolsFile, Public.BlokCustomToolsFile>,
  SameKeys<CustomBlock, PublicCustomBlock>,
  SameKeys<InternalOptions, Public.BlokMcpOptions>,
] = [true, true, true, true, true];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@bloklabs/mcp public types', () => {
  it('keeps the compile-time checks referenced', () => {
    expect([actorToPublic, actorFromPublic, overridesToPublic, overridesFromPublic, customToolsToPublic, optionsToPublic, optionsFromPublic])
      .toHaveLength(7);
    expect(sameKeys.every(Boolean)).toBe(true);
  });

  it('declares createBlokMcpServer and imports nothing', () => {
    const source = readFileSync(resolve(__dirname, '../../../packages/mcp/types/index.d.ts'), 'utf-8');

    expect(source).toContain('export declare function createBlokMcpServer');
    expect(source).not.toMatch(/\bfrom\s+['"]|\bimport\s*\(|\brequire\s*\(/);
  });
});
