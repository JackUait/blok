// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBlokVersion } from '../../../src/components/utils/version';
import { COMMANDS } from '../../../src/shared/agent/commands';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';
import { invoke } from '../../../src/view/server-runtime';

describe('server runtime manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('equals the real manifest and Jint contract built directly in Node', async () => {
    const result: unknown = JSON.parse(await invoke('manifest', '{}'));
    const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: getBlokVersion() }));
    const contract = buildAgentContract(manifest, COMMANDS, { runtime: 'jint', services: [] });

    expect(result).toEqual({ manifest, contract });
  });
});
