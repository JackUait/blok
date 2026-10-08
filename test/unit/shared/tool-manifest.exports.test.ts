import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import * as editorEntry from '../../../src/blok';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { buildToolManifest } from '../../../src/shared/tool-manifest';
import * as viewEntry from '../../../src/view';

import type * as editorTypes from '../../../types';
import type * as viewTypes from '../../../types/view';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent manifest exports', () => {
  const entries = [
    ['@bloklabs/core', editorEntry],
    ['@bloklabs/core/view', viewEntry],
  ] as const;

  it.each(entries)('%s exports the builder and the validator', (_name, entry) => {
    expect(entry).toHaveProperty('buildToolManifest', buildToolManifest);
    expect(entry).toHaveProperty('validateAgainst', validateAgainst);
  });

  it.each(entries)('%s keeps contract and runtime implementations internal', (_name, entry) => {
    expect(entry).not.toHaveProperty('buildAgentContract');
    expect(entry).not.toHaveProperty('ToolRuntime');
    expect(entry).not.toHaveProperty('BUILT_IN_TOOL_RUNTIMES');
  });

  it('declares both public function signatures', () => {
    expectTypeOf<typeof editorTypes.buildToolManifest>().toEqualTypeOf<typeof buildToolManifest>();
    expectTypeOf<typeof viewTypes.buildToolManifest>().toEqualTypeOf<typeof buildToolManifest>();
    expectTypeOf<typeof editorTypes.validateAgainst>().toEqualTypeOf<typeof validateAgainst>();
    expectTypeOf<typeof viewTypes.validateAgainst>().toEqualTypeOf<typeof validateAgainst>();
  });
});
