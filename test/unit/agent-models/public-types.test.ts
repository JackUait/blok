import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as models from '../../../src/agent-models';

describe('agent-models public surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares every runtime export in types/agent-models.d.ts, and nothing else', () => {
    const declared = [...readFileSync(resolve(__dirname, '../../../types/agent-models.d.ts'), 'utf8')
      .matchAll(/export declare function (\w+)/g)].map((match) => match[1]).sort();

    expect(Object.keys(models).sort()).toEqual(['anthropicModel', 'geminiModel', 'openaiCompatibleModel', 'openaiModel']);
    expect(declared).toEqual(Object.keys(models).sort());
  });
});
